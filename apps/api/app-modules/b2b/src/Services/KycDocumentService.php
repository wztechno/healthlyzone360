<?php

declare(strict_types=1);

namespace Healthy360\B2b\Services;

use App\Models\User;
use Carbon\CarbonImmutable;
use Healthy360\Audit\Services\AuditRecorder;
use Healthy360\B2b\Enums\DocumentKind;
use Healthy360\B2b\Enums\DocumentRejectionReason;
use Healthy360\B2b\Enums\DocumentReviewStatus;
use Healthy360\B2b\Enums\DocumentScanStatus;
use Healthy360\B2b\Models\KycDocument;
use Healthy360\Support\Api\ErrorCode;
use Healthy360\Support\Api\Exceptions\ApiException;
use Healthy360\Support\Identifiers\IdentifierService;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Storage;
use Throwable;

/**
 * Everything that happens to an identity document: how it is taken in, how it
 * is looked at, how it is handed back, and how it goes away.
 *
 * ## Taking one in
 *
 * Five things happen before a row exists, in this order, and the order is the
 * design:
 *
 *  1. **Size**, checked before anything reads the file. The bound exists partly
 *     to stop a large upload occupying memory, so checking it after reading
 *     would defeat half the purpose.
 *  2. **Sniff**, from the leading bytes. The result — not the client's
 *     `Content-Type`, not the extension — becomes `mime_type`. The claim is
 *     kept in `declared_mime_type` because a mismatch is evidence.
 *  3. **Accept-list**, applied to the sniffed type. An unrecognised or
 *     unaccepted format is refused; nothing unidentifiable reaches the bucket
 *     or a reviewer's browser.
 *  4. **Hash**, over the file's bytes. It deduplicates re-uploads and it is
 *     what an agreement's signature evidence names.
 *  5. **Store**, under a path this service composes from a fresh identifier
 *     and the sniffed type's extension. **The client's filename never touches
 *     the path** — it is kept in `original_filename` for a human to read and
 *     is otherwise inert. That is the whole answer to path traversal and to
 *     the collision an honest reused filename would cause.
 *
 * The row is written inside a transaction that rolls back if anything after
 * the upload fails; the object is removed on the way out, so a failure cannot
 * leave bytes in a bucket that nothing points at.
 *
 * ## Handing one back
 *
 * `temporaryUrl()` is the only route to the bytes. It mints a short-lived
 * signed URL from the private disk — the disk has no `url` configured, so
 * there is no permanent one to mint — and records an access event naming who
 * asked and why. A document read that leaves no trace is the thing an audit
 * trail exists to prevent.
 *
 * ## Authorisation
 *
 * Every method takes an explicit `$actor`, and **the caller is responsible for
 * having authorised it** (master plan v2 §4.16: permissions are introduced by
 * the phase that uses them, and B1's platform codes are deferred to the
 * integrator's permission wave). What this service does check is the thing
 * that is not a permission — that a document belongs to the application it is
 * being filed against — because that is a fact about the data rather than a
 * policy about the actor.
 */
final readonly class KycDocumentService
{
    public function __construct(
        private DocumentTypeSniffer $sniffer,
        private IdentifierService $identifiers,
        private AuditRecorder $audit,
    ) {}

    /**
     * Take in a document, or refuse it.
     *
     * @throws ApiException
     */
    public function store(
        UploadedFile $file,
        DocumentOwner $owner,
        DocumentKind $kind,
        User $actor,
        ?CarbonImmutable $expiresOn = null,
    ): KycDocument {
        $maxBytes = $this->maxBytes();
        $size = $file->getSize();

        if ($size === false || $size <= 0) {
            throw $this->invalid('file', 'This file appears to be empty.');
        }

        if ($size > $maxBytes) {
            throw $this->invalid('file', 'A document may be at most '.(int) round($maxBytes / 1048576).' MB.');
        }

        $realPath = $file->getRealPath();

        if ($realPath === false) {
            throw $this->invalid('file', 'The upload could not be read.');
        }

        $declared = $file->getClientMimeType();
        $sniffed = $this->sniffer->sniffPath($realPath);

        if ($sniffed === null || ! in_array($sniffed, $this->acceptedMimeTypes(), true)) {
            // The refusal names what the platform accepts, never what it
            // thought this file was: telling an uploader "we detected an
            // executable" is a probe result, and this endpoint is not a
            // scanner people should be able to query.
            throw $this->invalid(
                'file',
                'A document must be a PDF or a photograph (JPEG, PNG, WebP or HEIC).',
            );
        }

        $digest = hash_file('sha256', $realPath);

        if ($digest === false) {
            throw $this->invalid('file', 'The upload could not be read.');
        }

        $existing = $this->findDuplicate($owner, $digest);

        if ($existing instanceof KycDocument) {
            // The same bytes against the same owner is one document. Returning
            // the existing row rather than refusing is what makes a retried
            // upload — a flaky connection, a double-tapped button — harmless.
            return $existing;
        }

        $disk = $this->disk();
        $path = $this->composePath($owner, $sniffed);

        $stream = fopen($realPath, 'rb');

        if ($stream === false) {
            throw $this->invalid('file', 'The upload could not be read.');
        }

        Storage::disk($disk)->put($path, $stream, ['visibility' => 'private']);

        if (is_resource($stream)) {
            fclose($stream);
        }

        try {
            $document = DB::transaction(function () use ($owner, $kind, $disk, $path, $file, $sniffed, $declared, $size, $digest, $actor, $expiresOn): KycDocument {
                $document = new KycDocument;
                $document->forceFill($owner->columns());
                $document->document_kind = $kind;
                $document->disk = $disk;
                $document->path = $path;
                $document->original_filename = $this->safeFilename($file->getClientOriginalName());
                $document->mime_type = $sniffed;
                $document->declared_mime_type = $declared;
                $document->byte_size = $size;
                $document->sha256 = $digest;
                $document->scan_status = DocumentScanStatus::NotScanned;
                $document->uploaded_by = (string) $actor->getKey();
                $document->uploaded_at = CarbonImmutable::now();
                $document->review_status = DocumentReviewStatus::Pending;
                $document->expires_on = $kind->expires() ? $expiresOn : null;
                $document->purge_after = CarbonImmutable::now()->addDays($this->retentionDays());
                $document->save();

                return $document;
            });
        } catch (Throwable $exception) {
            // No orphan bytes. A row that failed to write must not leave a
            // document in the bucket that nothing can find, review or purge.
            Storage::disk($disk)->delete($path);

            throw $exception;
        }

        $this->audit->record(
            'b2b.kyc_document_stored',
            actorUserId: (string) $actor->getKey(),
            subjectType: 'kyc_document',
            subjectId: (string) $document->getKey(),
            metadata: [
                'owner_kind' => $owner->kind(),
                'owner_id' => $owner->id(),
                'document_kind' => $kind->value,
                'byte_size' => $size,
                'sniffed_media_type' => $sniffed,
                'declared_media_type' => $declared,
                'media_type_mismatch' => $declared !== $sniffed,
                'scan_status' => DocumentScanStatus::NotScanned->value,
            ],
        );

        return $document;
    }

    /**
     * A reviewer's verdict.
     *
     * Accepting supersedes the previously accepted document of the same kind
     * for the same owner: a company that re-uploads a clearer scan of its
     * registration has one current registration document, and the old row
     * stays as the trail of what was looked at and when.
     *
     * @throws ApiException
     */
    public function review(
        KycDocument $document,
        DocumentReviewStatus $verdict,
        User $reviewer,
        ?DocumentRejectionReason $reason = null,
        ?string $note = null,
    ): KycDocument {
        if (! $verdict->isDecided()) {
            throw $this->invalid('review_status', 'A review is an acceptance or a rejection.');
        }

        if ($document->review_status->isDecided()) {
            throw new ApiException(
                ErrorCode::ResourceConflict,
                'This document has already been reviewed.',
                ['review_status' => $document->review_status->value],
            );
        }

        if ($verdict === DocumentReviewStatus::Rejected && ! $reason instanceof DocumentRejectionReason) {
            throw $this->invalid('rejection_reason', 'A rejection has to say why, so the applicant knows what to send instead.');
        }

        $superseded = DB::transaction(function () use ($document, $verdict, $reviewer, $reason, $note): int {
            $superseded = 0;

            if ($verdict === DocumentReviewStatus::Accepted) {
                $superseded = $this->ownerScope($document)
                    ->where('document_kind', $document->document_kind->value)
                    ->where('review_status', DocumentReviewStatus::Accepted->value)
                    ->whereKeyNot($document->getKey())
                    ->update([
                        'review_status' => DocumentReviewStatus::Superseded->value,
                        'updated_at' => now(),
                    ]);
            }

            $document->review_status = $verdict;
            $document->reviewed_by = (string) $reviewer->getKey();
            $document->reviewed_at = CarbonImmutable::now();
            $document->rejection_reason = $verdict === DocumentReviewStatus::Rejected ? $reason : null;
            $document->review_note = $note;
            $document->save();

            return $superseded;
        });

        $this->audit->record(
            'b2b.kyc_document_reviewed',
            actorUserId: (string) $reviewer->getKey(),
            subjectType: 'kyc_document',
            subjectId: (string) $document->getKey(),
            metadata: [
                'review_status' => $verdict->value,
                'rejection_reason' => $reason?->value,
                'owner_kind' => $document->ownerKind(),
                'superseded_count' => $superseded,
            ],
        );

        return $document;
    }

    /**
     * A short-lived signed URL for the bytes, and the record that somebody
     * asked for them.
     *
     * `$purpose` is required rather than optional. A document access with no
     * stated reason is the access an audit trail cannot explain afterwards,
     * and the argument being mandatory is what stops every call site
     * defaulting it to nothing.
     *
     * @throws ApiException
     */
    public function temporaryUrl(KycDocument $document, User $actor, string $purpose): string
    {
        $trimmedPurpose = trim($purpose);

        if ($trimmedPurpose === '') {
            throw $this->invalid('purpose', 'A document access has to say what it is for.');
        }

        $expiresAt = CarbonImmutable::now()->addMinutes($this->temporaryUrlTtlMinutes());

        $url = Storage::disk($document->disk)->temporaryUrl($document->path, $expiresAt);

        $this->audit->record(
            'b2b.kyc_document_accessed',
            actorUserId: (string) $actor->getKey(),
            subjectType: 'kyc_document',
            subjectId: (string) $document->getKey(),
            metadata: [
                'owner_kind' => $document->ownerKind(),
                'document_kind' => $document->document_kind->value,
                'expires_at' => $expiresAt->toIso8601String(),
                // Deliberately absent: the path, and the URL itself. Writing
                // either into an audit row would put a live grant of access
                // into a table read by more people than the document is.
            ],
            purposeOfUse: $trimmedPurpose,
        );

        return $url;
    }

    /**
     * Delete the documents whose retention window has closed — object first,
     * row second.
     *
     * That order is deliberate. If the process dies between the two, the row
     * survives pointing at bytes that are gone, and the next run tries again
     * and succeeds; the reverse order would leave bytes in a bucket that
     * nothing knows about, which is the failure nobody discovers.
     *
     * @return int how many documents were purged
     */
    public function purgeExpired(int $limit = 500, ?CarbonImmutable $now = null): int
    {
        $cutoff = $now ?? CarbonImmutable::now();

        $due = KycDocument::query()
            ->where('purge_after', '<=', $cutoff)
            ->orderBy('purge_after')
            ->limit($limit)
            ->get();

        $purged = 0;

        foreach ($due as $document) {
            Storage::disk($document->disk)->delete($document->path);

            $this->audit->record(
                'b2b.kyc_document_purged',
                subjectType: 'kyc_document',
                subjectId: (string) $document->getKey(),
                metadata: [
                    'owner_kind' => $document->ownerKind(),
                    'document_kind' => $document->document_kind->value,
                    'retained_days' => $this->retentionDays(),
                ],
            );

            $document->delete();
            $purged++;
        }

        return $purged;
    }

    /**
     * The documents an owner has filed that still count — pending or
     * accepted, never rejected or superseded.
     *
     * @return list<KycDocument>
     */
    public function currentDocuments(DocumentOwner $owner): array
    {
        return array_values($this->scopedToOwner($owner->columns())
            ->whereIn('review_status', [
                DocumentReviewStatus::Pending->value,
                DocumentReviewStatus::Accepted->value,
            ])
            ->orderBy('uploaded_at')
            ->get()
            ->all());
    }

    /**
     * The object key. Composed here from a fresh identifier and the sniffed
     * type — never from anything the uploader chose.
     */
    private function composePath(DocumentOwner $owner, string $mimeType): string
    {
        $prefix = trim((string) config('b2b.kyc.path_prefix', 'kyc'), '/');

        return implode('/', [
            $prefix,
            $owner->kind(),
            $owner->id(),
            $this->identifiers->generate().'.'.$this->extensionFor($mimeType),
        ]);
    }

    private function extensionFor(string $mimeType): string
    {
        return match ($mimeType) {
            'application/pdf' => 'pdf',
            'image/jpeg' => 'jpg',
            'image/png' => 'png',
            'image/webp' => 'webp',
            'image/heic' => 'heic',
            default => 'bin',
        };
    }

    /**
     * The uploader's filename, kept for a human to read and stripped of
     * anything that could be read as a path. It is never used to locate the
     * object; this is about what a reviewer's screen renders.
     */
    private function safeFilename(string $name): string
    {
        $base = basename(str_replace('\\', '/', $name));
        $base = preg_replace('/[^\p{L}\p{N}._ -]+/u', '', $base) ?? '';
        $base = trim($base);

        return $base === '' ? 'document' : mb_substr($base, 0, 255);
    }

    private function findDuplicate(DocumentOwner $owner, string $digest): ?KycDocument
    {
        return $this->scopedToOwner($owner->columns())->where('sha256', $digest)->first();
    }

    /**
     * @return Builder<KycDocument>
     */
    private function ownerScope(KycDocument $document): Builder
    {
        return $this->scopedToOwner([
            'user_id' => $document->user_id,
            'b2b_application_id' => $document->b2b_application_id,
            'organisation_id' => $document->organisation_id,
        ]);
    }

    /**
     * Match all three owner columns, nulls included.
     *
     * `where($column, null)` compiles to `= NULL`, which matches nothing —
     * so a loop that used it would silently return no rows for every owner
     * kind. The null-aware branch is what makes "the same owner" mean the
     * same thing here as it does in the database CHECK.
     *
     * @param  array{user_id: string|null, b2b_application_id: string|null, organisation_id: string|null}  $columns
     * @return Builder<KycDocument>
     */
    private function scopedToOwner(array $columns): Builder
    {
        $query = KycDocument::query();

        foreach ($columns as $column => $value) {
            $value === null
                ? $query->whereNull($column)
                : $query->where($column, $value);
        }

        return $query;
    }

    private function disk(): string
    {
        $disk = config('b2b.kyc.disk', 'private');

        return is_string($disk) ? $disk : 'private';
    }

    /**
     * @return list<string>
     */
    private function acceptedMimeTypes(): array
    {
        $accepted = config('b2b.kyc.accepted_mime_types', []);

        return is_array($accepted) ? array_values(array_filter($accepted, is_string(...))) : [];
    }

    private function maxBytes(): int
    {
        return (int) config('b2b.kyc.max_bytes', 10485760);
    }

    private function retentionDays(): int
    {
        return (int) config('b2b.kyc.retention_days', 1825);
    }

    private function temporaryUrlTtlMinutes(): int
    {
        return (int) config('b2b.kyc.temporary_url_ttl_minutes', 5);
    }

    private function invalid(string $field, string $message): ApiException
    {
        return new ApiException(
            ErrorCode::ValidationFailed,
            $message,
            ['fields' => [$field => [$message]]],
        );
    }
}
