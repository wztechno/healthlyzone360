<?php

declare(strict_types=1);

namespace Healthy360\B2b\Services;

use Carbon\CarbonImmutable;
use Healthy360\Audit\Models\AuditLog;
use Healthy360\B2b\Models\B2bAgreement;
use Healthy360\B2b\Models\B2bApplication;
use Healthy360\B2b\Models\B2bApplicationContact;
use Healthy360\B2b\Models\B2bApplicationLocation;
use Healthy360\B2b\Models\KycDocument;
use Healthy360\B2b\Models\RecordExport;
use Healthy360\Consent\Models\ConsentGrant;
use Healthy360\Organisations\Models\Organisation;
use Healthy360\Organisations\Models\OrganisationBranch;
use Healthy360\Organisations\Models\OrganisationMembership;
use RuntimeException;
use ZipArchive;

/**
 * Assembling one company's own records into a file it can take away.
 *
 * ## What goes in
 *
 * Eight entries, and one of them is the point of the other seven:
 *
 * | file | contents |
 * |---|---|
 * | `manifest.json` | every file, its digest, its row count, and what is *absent* |
 * | `organisation.json` | the tenant record and its branches |
 * | `memberships.json` | who was a member, in what status, since when |
 * | `agreements.json` | every version, not only the one in force — the terms history |
 * | `application.json` | the application and its named contacts |
 * | `locations.json` | the delivery locations the application declared |
 * | `kyc-documents.json` | **metadata and digests only. Never the files.** |
 * | `consent-grants.json` | what was consented to, when, and what was withdrawn |
 * | `audit-log.json` | the organisation-scoped audit extract |
 *
 * ## Why the identity documents are a list rather than files
 *
 * A KYC bundle is passports and commercial registrations. Putting the bytes
 * into a ZIP that travels by signed URL would take documents the platform
 * holds behind per-access audit and per-document expiry and turn them into a
 * file on somebody's laptop. The manifest lists what exists, its kind, its
 * size and its **sha256**, which is exactly enough for the company to verify
 * that the copy it already has is the copy the platform held — and for the
 * platform to answer "what did you have of ours". A company that wants the
 * documents themselves asks for them one at a time, through the path that
 * records each access.
 *
 * ## Why the manifest names what is missing
 *
 * `row_counts` was B1's honesty column: a bundle listing zero orders because
 * the module did not exist reads differently from one that omits the key. The
 * manifest carries that further with `absent`, an explicit list of record
 * kinds this export does **not** contain and why. Orders and invoices are the
 * two that matter today, and neither is quietly omitted.
 *
 * ## Digests
 *
 * Every entry is hashed before it is zipped, and the ZIP is hashed after. The
 * per-entry digests are what let a recipient verify one file without the
 * bundle; the bundle digest is what `record_exports.sha256` holds.
 */
final readonly class ExportBundleBuilder
{
    /** Audit rows past which an extract is truncated, with the truncation declared. */
    private const int AUDIT_ROW_CAP = 5000;

    /**
     * Build the bundle on disk and return the path of the local temporary file
     * plus the manifest describing it.
     *
     * A local file first, then a stream to the private disk. `ZipArchive`
     * writes to a filesystem path and nothing else, so the alternative is
     * building the archive in memory — which for an organisation with years of
     * audit history is a memory limit waiting to be hit on the one job that
     * must not fail halfway.
     *
     * @return array{path: string, sha256: string, byte_size: int, row_counts: array<string, int>, manifest: array<string, mixed>}
     */
    public function build(RecordExport $export, Organisation $organisation): array
    {
        $organisationId = (string) $organisation->getKey();
        $application = $this->applicationFor($organisationId);

        $entries = [
            'organisation.json' => $this->organisationRecord($organisation),
            'memberships.json' => $this->memberships($organisationId),
            'agreements.json' => $this->agreements($organisationId),
            'application.json' => $this->application($application),
            'locations.json' => $this->locations($application),
            'kyc-documents.json' => $this->kycManifest($organisationId, $application),
            'consent-grants.json' => $this->consentGrants($organisationId),
            'audit-log.json' => $this->auditExtract($organisationId),
        ];

        $files = [];
        $rowCounts = [];
        $payloads = [];

        foreach ($entries as $name => $entry) {
            $json = $this->encode($entry['rows']);
            $payloads[$name] = $json;
            $rowCounts[$entry['key']] = $entry['count'];
            $files[] = [
                'file' => $name,
                'record_kind' => $entry['key'],
                'rows' => $entry['count'],
                'sha256' => hash('sha256', $json),
                'byte_size' => strlen($json),
                'note' => $entry['note'],
            ];
        }

        $manifest = [
            'export_id' => (string) $export->getKey(),
            'organisation_id' => $organisationId,
            'organisation_name' => $organisation->name,
            'generated_at' => CarbonImmutable::now()->toIso8601String(),
            'format' => $export->format,
            'files' => $files,
            'row_counts' => $rowCounts,
            'absent' => $this->absentRecordKinds(),
            'notes' => [
                'Identity documents are listed with their digests, not included. Request each one individually; every access is recorded.',
                'The legal entity record is retained after offboarding; the personal data around it is purged.',
            ],
        ];

        $payloads['manifest.json'] = $this->encode($manifest);

        $path = $this->writeArchive($payloads);
        $digest = hash_file('sha256', $path);
        $size = filesize($path);

        if ($digest === false || $size === false) {
            throw new RuntimeException('The export bundle could not be fingerprinted.');
        }

        return [
            'path' => $path,
            'sha256' => $digest,
            'byte_size' => $size,
            'row_counts' => $rowCounts,
            'manifest' => $manifest,
        ];
    }

    /**
     * The record kinds this bundle does not contain, each with a reason.
     *
     * Declared rather than omitted. An export that silently lacked an orders
     * file would look complete to a recipient who did not know to expect one,
     * which is exactly the failure B1's `row_counts` column was added to make
     * visible.
     *
     * @return list<array{record_kind: string, reason: string}>
     */
    private function absentRecordKinds(): array
    {
        return [
            ['record_kind' => 'orders', 'reason' => 'A corporate buyer\'s order history is exported by the orders module; this bundle predates that binding.'],
            ['record_kind' => 'invoices', 'reason' => 'No invoicing module exists (PAY1).'],
            ['record_kind' => 'payments', 'reason' => 'No payment module exists (PAY1).'],
            ['record_kind' => 'kyc_document_files', 'reason' => 'Deliberate: documents are listed with digests and fetched one at a time, so each access is recorded.'],
        ];
    }

    /**
     * @return array{key: string, rows: array<string, mixed>|list<array<string, mixed>>, count: int, note: string|null}
     */
    private function organisationRecord(Organisation $organisation): array
    {
        $organisation->loadMissing('type');

        // Branches through `withoutTenancy()`: `OrganisationBranch` is
        // organisation-scoped and fails closed with no ambient context, and
        // this runs on a queue worker that has none. The organisation is named
        // explicitly instead, which is the isolation this read needs anyway.
        $branches = OrganisationBranch::withoutTenancy()
            ->where('organisation_id', $organisation->getKey())
            ->orderBy('created_at')
            ->get();

        return [
            'key' => 'organisation',
            'count' => 1,
            'note' => null,
            'rows' => [
                'id' => (string) $organisation->getKey(),
                'name' => $organisation->name,
                'slug' => $organisation->slug,
                'organisation_type' => $organisation->type?->code,
                'country' => $organisation->country_code,
                'default_currency' => $organisation->default_currency_code,
                'default_language' => $organisation->default_language_code,
                'status' => $organisation->status->value,
                'created_at' => $organisation->created_at?->toIso8601String(),
                'branches' => array_values($branches->map(static fn (OrganisationBranch $branch): array => [
                    'id' => (string) $branch->getKey(),
                    'name' => $branch->name,
                    'city' => $branch->city,
                    'timezone' => $branch->timezone,
                    'status' => $branch->status->value,
                ])->all()),
            ],
        ];
    }

    /**
     * @return array{key: string, rows: list<array<string, mixed>>, count: int, note: string|null}
     */
    private function memberships(string $organisationId): array
    {
        $rows = OrganisationMembership::withoutTenancy()
            ->where('organisation_id', $organisationId)
            ->with('user')
            ->orderBy('created_at')
            ->get()
            ->map(static fn (OrganisationMembership $membership): array => [
                'id' => (string) $membership->getKey(),
                'user_id' => $membership->user_id,
                'email' => $membership->user?->email,
                'branch_id' => $membership->branch_id,
                'status' => $membership->status->value,
                'joined_at' => $membership->joined_at?->toIso8601String(),
            ])
            ->all();

        return ['key' => 'memberships', 'rows' => array_values($rows), 'count' => count($rows), 'note' => null];
    }

    /**
     * Every version, because the terms history is what an agreement means.
     *
     * The signature evidence travels with each version — a company taking its
     * records away is entitled to the proof of what it accepted — but the
     * session hashes do not. Those exist to corroborate a dispute inside the
     * platform, and they are one-way values that tell the recipient nothing.
     *
     * @return array{key: string, rows: list<array<string, mixed>>, count: int, note: string|null}
     */
    private function agreements(string $organisationId): array
    {
        $rows = B2bAgreement::query()
            ->where('organisation_id', $organisationId)
            ->orderBy('version')
            ->get()
            ->map(static fn (B2bAgreement $agreement): array => [
                'id' => (string) $agreement->getKey(),
                'version' => $agreement->version,
                'supersedes_agreement_id' => $agreement->supersedes_agreement_id,
                'status' => $agreement->status->value,
                'title' => $agreement->title,
                'currency' => $agreement->currency_code,
                'payment_terms' => $agreement->payment_terms?->value,
                'credit_limit_minor' => $agreement->credit_limit_minor,
                'minimum_order_minor' => $agreement->minimum_order_minor,
                'delivery_lead_time_days' => $agreement->delivery_lead_time_days,
                'notice_period_days' => $agreement->notice_period_days,
                'starts_on' => $agreement->starts_on?->toDateString(),
                'ends_on' => $agreement->ends_on?->toDateString(),
                'auto_renews' => $agreement->auto_renews,
                'terms_summary' => $agreement->terms_summary,
                'signatory_name' => $agreement->signatory_name,
                'signatory_title' => $agreement->signatory_title,
                'signature_document_sha256' => $agreement->signature_document_sha256,
                'signature_consent_statement' => $agreement->signature_consent_statement,
                'signed_at' => $agreement->signed_at?->toIso8601String(),
                'activated_at' => $agreement->activated_at?->toIso8601String(),
                'terminated_at' => $agreement->terminated_at?->toIso8601String(),
                'termination_reason' => $agreement->termination_reason,
            ])
            ->all();

        return ['key' => 'agreements', 'rows' => array_values($rows), 'count' => count($rows), 'note' => 'Every version, including superseded ones.'];
    }

    /**
     * @return array{key: string, rows: list<array<string, mixed>>, count: int, note: string|null}
     */
    private function application(?B2bApplication $application): array
    {
        if (! $application instanceof B2bApplication) {
            return ['key' => 'application', 'rows' => [], 'count' => 0, 'note' => 'No application is linked to this organisation.'];
        }

        $contacts = B2bApplicationContact::query()
            ->where('b2b_application_id', $application->getKey())
            ->orderBy('created_at')
            ->get()
            ->map(static fn (B2bApplicationContact $contact): array => [
                'role' => $contact->role->value,
                'name' => $contact->name,
                'title' => $contact->title,
                'email' => $contact->email,
                'phone' => $contact->phone,
            ])
            ->all();

        return [
            'key' => 'application',
            'count' => 1,
            'note' => 'Contacts reflect the record as it stands; an offboarded organisation\'s contacts are purged.',
            'rows' => [[
                'id' => (string) $application->getKey(),
                'reference' => $application->reference,
                'status' => $application->status->value,
                'legal_name' => $application->legal_name,
                'legal_name_ar' => $application->legal_name_ar,
                'trading_name' => $application->trading_name,
                'business_type' => $application->business_type,
                'country' => $application->country_code,
                'commercial_registration_number' => $application->commercial_registration_number,
                'tax_registration_number' => $application->tax_registration_number,
                'incorporated_on' => $application->incorporated_on?->toDateString(),
                'website' => $application->website,
                'submitted_at' => $application->submitted_at?->toIso8601String(),
                'decided_at' => $application->decided_at?->toIso8601String(),
                'contacts' => $contacts,
            ]],
        ];
    }

    /**
     * @return array{key: string, rows: list<array<string, mixed>>, count: int, note: string|null}
     */
    private function locations(?B2bApplication $application): array
    {
        if (! $application instanceof B2bApplication) {
            return ['key' => 'locations', 'rows' => [], 'count' => 0, 'note' => null];
        }

        // Field by field rather than `attributesToArray()`: an export is the
        // last place a column added later should appear by default, and a
        // named list is what makes "what did we hand over" reviewable.
        $rows = B2bApplicationLocation::query()
            ->where('b2b_application_id', $application->getKey())
            ->orderBy('created_at')
            ->get()
            ->map(static fn (B2bApplicationLocation $location): array => [
                'id' => (string) $location->getKey(),
                'label' => $location->label,
                'delivery_area_id' => $location->delivery_area_id,
                'address_line1' => $location->address_line1,
                'address_line2' => $location->address_line2,
                'city' => $location->city,
                'country' => $location->country_code,
                'contact_name' => $location->contact_name,
                'contact_phone' => $location->contact_phone,
                'delivery_notes' => $location->delivery_notes,
                'is_primary' => $location->is_primary,
                'is_billing_address' => $location->is_billing_address,
                'expected_headcount' => $location->expected_headcount,
            ])
            ->all();

        return ['key' => 'locations', 'rows' => array_values($rows), 'count' => count($rows), 'note' => null];
    }

    /**
     * The documents, described. Never the documents.
     *
     * @return array{key: string, rows: list<array<string, mixed>>, count: int, note: string|null}
     */
    private function kycManifest(string $organisationId, ?B2bApplication $application): array
    {
        $query = KycDocument::query()->where('organisation_id', $organisationId);

        if ($application instanceof B2bApplication) {
            $query->orWhere('b2b_application_id', $application->getKey());
        }

        $rows = $query->orderBy('uploaded_at')
            ->get()
            ->map(static fn (KycDocument $document): array => [
                'id' => (string) $document->getKey(),
                'document_kind' => $document->document_kind->value,
                'original_filename' => $document->original_filename,
                'media_type' => $document->mime_type,
                'byte_size' => $document->byte_size,
                // The digest, so the recipient can verify a copy they hold.
                // Never `disk` or `path`: those turn knowledge of a row into
                // access to a passport scan.
                'sha256' => $document->sha256,
                'review_status' => $document->review_status->value,
                'uploaded_at' => $document->uploaded_at->toIso8601String(),
                'expires_on' => $document->expires_on?->toDateString(),
                'purge_after' => $document->purge_after->toIso8601String(),
            ])
            ->all();

        return [
            'key' => 'kyc_documents',
            'rows' => array_values($rows),
            'count' => count($rows),
            'note' => 'Metadata and digests only. The files themselves are fetched one at a time so that each access is recorded.',
        ];
    }

    /**
     * @return array{key: string, rows: list<array<string, mixed>>, count: int, note: string|null}
     */
    private function consentGrants(string $organisationId): array
    {
        $rows = ConsentGrant::withoutTenancy()
            ->where('organisation_id', $organisationId)
            ->orderBy('granted_at')
            ->get()
            ->map(static fn (ConsentGrant $grant): array => [
                'id' => (string) $grant->getKey(),
                'user_id' => $grant->user_id,
                'consent_definition_id' => $grant->consent_definition_id,
                'status' => $grant->status->value,
                'granted_at' => $grant->granted_at->toIso8601String(),
                'withdrawn_at' => $grant->withdrawn_at?->toIso8601String(),
                'channel' => $grant->channel,
            ])
            ->all();

        return [
            'key' => 'consent_grants',
            'rows' => array_values($rows),
            'count' => count($rows),
            'note' => 'Organisation-contextual grants only. Platform-level consents belong to the person, not the company.',
        ];
    }

    /**
     * The organisation's own audit trail.
     *
     * Capped, and the cap declares itself. An organisation with years of
     * history would otherwise produce a bundle whose size is unbounded and
     * whose build time is unpredictable — on a job that must not fail halfway
     * through writing a company's records.
     *
     * @return array{key: string, rows: list<array<string, mixed>>, count: int, note: string|null}
     */
    private function auditExtract(string $organisationId): array
    {
        $total = AuditLog::query()->where('organisation_id', $organisationId)->count();

        $rows = AuditLog::query()
            ->where('organisation_id', $organisationId)
            ->orderByDesc('occurred_at')
            ->limit(self::AUDIT_ROW_CAP)
            ->get()
            ->map(static fn (AuditLog $log): array => [
                'id' => (string) $log->getKey(),
                'action' => $log->action,
                'actor_user_id' => $log->actor_user_id,
                'subject_type' => $log->subject_type,
                'subject_id' => $log->subject_id,
                'purpose_of_use' => $log->purpose_of_use,
                'occurred_at' => $log->occurred_at->toIso8601String(),
                'metadata' => $log->metadata,
            ])
            ->all();

        $note = $total > self::AUDIT_ROW_CAP
            ? 'Truncated to the '.self::AUDIT_ROW_CAP.' most recent of '.$total.' events. Ask for the remainder if it is needed.'
            : null;

        return ['key' => 'audit_events', 'rows' => array_values($rows), 'count' => count($rows), 'note' => $note];
    }

    private function applicationFor(string $organisationId): ?B2bApplication
    {
        return B2bApplication::query()
            ->where('provisioned_organisation_id', $organisationId)
            ->first();
    }

    /**
     * @param  array<string, mixed>|list<array<string, mixed>>  $value
     */
    private function encode(array $value): string
    {
        $json = json_encode($value, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);

        if ($json === false) {
            throw new RuntimeException('An export entry could not be encoded.');
        }

        return $json;
    }

    /**
     * @param  array<string, string>  $payloads
     */
    private function writeArchive(array $payloads): string
    {
        $path = tempnam(sys_get_temp_dir(), 'h360export');

        if ($path === false) {
            throw new RuntimeException('A temporary file for the export bundle could not be created.');
        }

        $zip = new ZipArchive;

        if ($zip->open($path, ZipArchive::CREATE | ZipArchive::OVERWRITE) !== true) {
            throw new RuntimeException('The export bundle could not be opened for writing.');
        }

        foreach ($payloads as $name => $contents) {
            $zip->addFromString($name, $contents);
        }

        $zip->close();

        return $path;
    }
}
