<?php

declare(strict_types=1);

namespace Healthy360\B2b\Services;

use App\Models\User;
use Carbon\CarbonImmutable;
use Healthy360\Audit\Enums\PurposeOfUse;
use Healthy360\Audit\Services\AuditRecorder;
use Healthy360\B2b\Enums\RecordExportStatus;
use Healthy360\B2b\Exceptions\RecordExportRefused;
use Healthy360\B2b\Jobs\ExportBusinessRecords;
use Healthy360\B2b\Models\B2bOffboarding;
use Healthy360\B2b\Models\RecordExport;
use Healthy360\Organisations\Models\Organisation;
use Healthy360\Support\Enums\DataClassification;
use Healthy360\Support\Identifiers\IdentifierService;
use Illuminate\Support\Facades\Storage;
use Throwable;

/**
 * A company's own records, packaged, handed over once, and taken back.
 *
 * ## Requesting is not building
 *
 * `request()` writes a row and queues `ExportBusinessRecords`. Building the
 * bundle reads an organisation's whole history and hashes it; doing that
 * inside a request would make the endpoint's latency a function of how long a
 * company has been a customer.
 *
 * ## Where the bytes live
 *
 * The private disk, under a path composed from a fresh identifier — never from
 * anything a caller supplies, exactly as `KycDocumentService` composes a
 * document path. The disk has no URL configured, so there is no permanent
 * address to leak; the only route to the bundle is `downloadUrl()`.
 *
 * ## Handing it over
 *
 * `downloadUrl()` mints a **fifteen-minute** signed URL and records the access
 * as a `Confidential` read with a stated purpose. Fifteen rather than the five
 * minutes a KYC document gets, because a bundle is a large download over
 * whatever connection the recipient has and a URL that expires mid-transfer is
 * a failure the person cannot diagnose; and fifteen rather than a day, because
 * a signed URL is a bearer credential and every extra hour is another hour it
 * can be forwarded.
 *
 * `download_count` is incremented on every issue. The audit trail is the
 * record; the counter is what a list view can show without joining to it, and
 * a bundle fetched eleven times is a question somebody should be able to ask.
 *
 * ## Taking it back
 *
 * `purgeExpired()` deletes the object and **keeps the row**. `expired` is a
 * state rather than a comparison against `expires_at` because expiry here is
 * an act: the transition is what deletes the bytes, and the status is the
 * record of it having happened. The row survives because deleting it would
 * erase the evidence that an export was ever made — which is precisely the
 * thing a data-protection enquiry asks about.
 */
final readonly class ExportService
{
    public function __construct(
        private ExportBundleBuilder $builder,
        private IdentifierService $identifiers,
        private AuditRecorder $audit,
    ) {}

    /**
     * Ask for a bundle. Returns immediately; the work is queued.
     */
    public function request(Organisation $organisation, User $actor, ?B2bOffboarding $offboarding = null): RecordExport
    {
        $export = new RecordExport;
        $export->organisation_id = (string) $organisation->getKey();
        $export->b2b_offboarding_id = $offboarding?->getKey() === null ? null : (string) $offboarding->getKey();
        $export->status = RecordExportStatus::Requested;
        $export->format = 'zip';
        $export->requested_by = (string) $actor->getKey();
        $export->requested_at = CarbonImmutable::now();
        $export->download_count = 0;
        $export->save();

        $this->audit->record(
            'b2b.record_export_requested',
            actorUserId: (string) $actor->getKey(),
            subjectType: 'record_export',
            subjectId: (string) $export->getKey(),
            metadata: [
                'organisation_id' => (string) $organisation->getKey(),
                'b2b_offboarding_id' => $export->b2b_offboarding_id,
                'format' => $export->format,
            ],
        );

        ExportBusinessRecords::dispatch((string) $export->getKey());

        return $export;
    }

    /**
     * Build the bundle. Called by the job, and by nothing else in a request.
     *
     * A failure is recorded on the row rather than swallowed: `failed` with a
     * `failure_reason` is a state somebody can act on, whereas a row stuck in
     * `building` forever is a support ticket.
     */
    public function build(RecordExport $export): RecordExport
    {
        $organisation = $export->organisation;

        if (! $organisation instanceof Organisation) {
            return $this->fail($export, 'The organisation this export belongs to no longer exists.');
        }

        $export->status = RecordExportStatus::Building;
        $export->started_at = CarbonImmutable::now();
        $export->save();

        $localPath = null;

        try {
            $bundle = $this->builder->build($export, $organisation);
            $localPath = $bundle['path'];

            $disk = $this->disk();
            $path = $this->composePath((string) $organisation->getKey());

            $stream = fopen($localPath, 'rb');

            if ($stream === false) {
                return $this->fail($export, 'The assembled bundle could not be read back.');
            }

            Storage::disk($disk)->put($path, $stream, ['visibility' => 'private']);

            if (is_resource($stream)) {
                fclose($stream);
            }

            $export->disk = $disk;
            $export->path = $path;
            $export->byte_size = $bundle['byte_size'];
            $export->sha256 = $bundle['sha256'];
            $export->row_counts = $bundle['row_counts'];
            $export->manifest = $bundle['manifest'];
            $export->expires_at = CarbonImmutable::now()->addDays($this->ttlDays());
            $export->completed_at = CarbonImmutable::now();
            $export->status = RecordExportStatus::Ready;
            $export->save();
        } catch (Throwable $exception) {
            return $this->fail($export, mb_substr($exception->getMessage(), 0, 500));
        } finally {
            if (is_string($localPath) && file_exists($localPath)) {
                // The local copy is scratch. Leaving it behind would put a
                // company's whole record in a temp directory with none of the
                // controls the private disk has.
                @unlink($localPath);
            }
        }

        $this->audit->record(
            'b2b.record_export_built',
            subjectType: 'record_export',
            subjectId: (string) $export->getKey(),
            metadata: [
                'organisation_id' => (string) $organisation->getKey(),
                'byte_size' => $export->byte_size,
                'row_counts' => array_sum($export->row_counts ?? []),
                'expires_at' => $export->expires_at->toIso8601String(),
                // Deliberately absent: the path and the digest. The first is
                // the object key, and an audit row is read by more people than
                // the bundle is.
            ],
        );

        return $export;
    }

    /**
     * A short-lived signed URL, and the record that somebody took a copy.
     *
     * `$purpose` is required rather than optional, for the reason
     * `KycDocumentService::temporaryUrl()` gives: an access with no stated
     * reason is the access an audit trail cannot explain afterwards, and a
     * mandatory argument is what stops every call site defaulting it to
     * nothing.
     *
     * @throws RecordExportRefused
     */
    public function downloadUrl(RecordExport $export, User $actor, string $purpose): string
    {
        $trimmed = trim($purpose);

        if ($trimmed === '') {
            throw RecordExportRefused::purposeRequired();
        }

        if (! $export->isDownloadable() || $export->disk === null || $export->path === null) {
            throw RecordExportRefused::notDownloadable($export->status->value);
        }

        $expiresAt = CarbonImmutable::now()->addMinutes($this->urlTtlMinutes());
        $url = Storage::disk($export->disk)->temporaryUrl($export->path, $expiresAt);

        $export->downloaded_at = CarbonImmutable::now();
        $export->download_count = $export->download_count + 1;
        $export->last_downloaded_by = (string) $actor->getKey();

        if ($export->status === RecordExportStatus::Ready) {
            $export->status = RecordExportStatus::Delivered;
        }

        $export->save();

        $this->audit->recordAccess(
            'b2b.record_export_downloaded',
            PurposeOfUse::OrganisationAdministration,
            DataClassification::Confidential,
            actorUserId: (string) $actor->getKey(),
            subjectType: 'record_export',
            subjectId: (string) $export->getKey(),
            metadata: [
                'organisation_id' => $export->organisation_id,
                'download_count' => $export->download_count,
                'url_expires_at' => $expiresAt->toIso8601String(),
                'stated_purpose' => $trimmed,
                // Never the URL and never the path: writing either into an
                // audit row would put a live grant of access into a table read
                // by more people than the export is.
            ],
        );

        return $url;
    }

    /**
     * Delete the objects whose window has closed. The rows stay.
     *
     * Object first, row-status second — the same ordering
     * `KycDocumentService::purgeExpired()` uses and for the same reason: a
     * crash between the two leaves a row saying `ready` whose bytes are gone,
     * which the next run corrects, whereas the reverse leaves bytes in a
     * bucket that nothing knows about.
     *
     * @return int how many bundles were purged
     */
    public function purgeExpired(int $limit = 200, ?CarbonImmutable $now = null): int
    {
        $cutoff = $now ?? CarbonImmutable::now();

        $due = RecordExport::query()
            ->whereIn('status', [RecordExportStatus::Ready->value, RecordExportStatus::Delivered->value])
            ->whereNotNull('expires_at')
            ->where('expires_at', '<=', $cutoff)
            ->orderBy('expires_at')
            ->limit($limit)
            ->get();

        $purged = 0;

        foreach ($due as $export) {
            if ($export->disk !== null && $export->path !== null) {
                Storage::disk($export->disk)->delete($export->path);
            }

            $export->status = RecordExportStatus::Expired;
            $export->purged_at = CarbonImmutable::now();
            $export->save();

            $this->audit->record(
                'b2b.record_export_purged',
                subjectType: 'record_export',
                subjectId: (string) $export->getKey(),
                metadata: [
                    'organisation_id' => $export->organisation_id,
                    'download_count' => $export->download_count,
                    'expired_at' => $export->expires_at?->toIso8601String(),
                    // The manifest stays on the row. What the platform handed
                    // over remains answerable after the bytes are gone.
                ],
            );

            $purged++;
        }

        return $purged;
    }

    private function fail(RecordExport $export, string $reason): RecordExport
    {
        $export->status = RecordExportStatus::Failed;
        $export->failure_reason = $reason;
        $export->save();

        $this->audit->record(
            'b2b.record_export_failed',
            subjectType: 'record_export',
            subjectId: (string) $export->getKey(),
            metadata: ['organisation_id' => $export->organisation_id],
        );

        return $export;
    }

    /**
     * The object key. Composed from a fresh identifier, never from a caller.
     */
    private function composePath(string $organisationId): string
    {
        $prefix = trim((string) config('b2b.exports.path_prefix', 'record-exports'), '/');

        return implode('/', [$prefix, $organisationId, $this->identifiers->generate().'.zip']);
    }

    private function disk(): string
    {
        $disk = config('b2b.exports.disk', 'private');

        return is_string($disk) ? $disk : 'private';
    }

    private function ttlDays(): int
    {
        return (int) config('b2b.exports.ttl_days', 7);
    }

    private function urlTtlMinutes(): int
    {
        return (int) config('b2b.exports.temporary_url_ttl_minutes', 15);
    }
}
