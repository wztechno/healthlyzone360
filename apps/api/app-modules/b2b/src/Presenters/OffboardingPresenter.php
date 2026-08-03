<?php

declare(strict_types=1);

namespace Healthy360\B2b\Presenters;

use Healthy360\B2b\Models\B2bOffboarding;
use Healthy360\B2b\Models\RecordExport;

/**
 * The wire shape of a wind-up, and of the bundle it hands over.
 *
 * **One audience.** Unlike `B2bApplicationPresenter`, which has an applicant's
 * shape and a reviewer's, everything here is platform-side: an offboarding is
 * started by the platform, driven by the platform and read behind
 * `b2b_offboarding.manage_platform`. There is no organisation-facing variant to
 * keep narrow, and inventing one before the surface that needs it exists would
 * be a second shape nobody maintains.
 *
 * ## What is on the wire and what is not
 *
 * **The signatory block travels in full** — name, title, the consent wording
 * they accepted, the document digest. It is evidence of who bound a company to
 * ending a relationship, and evidence that cannot be read is not evidence. The
 * two **hashes** do not: `signoff_ip_hash` and `signoff_user_agent_hash` exist
 * for corroboration inside the platform ("did this come from the same session
 * as the rest of the conversation") and serving them would put a stable
 * pseudonymous identifier for a named person onto an API response, where the
 * only thing anybody could do with it is correlate.
 *
 * **`settlement_checks` travels as the registry wrote it**, including the
 * `not_applicable` entries and their reasons. That is the whole point of
 * `SettlementRegistry` being honest about what it cannot check: a screen that
 * showed only the outcomes would render "3 checks, all clear" over a summary
 * where two of them never ran.
 *
 * **`settlement_waiver_reason` travels too.** A waiver nobody can read is a
 * waiver nobody can review, and the reason it is separate from
 * `settlement_note` is that a waiver recorded as a clearance erases the only
 * difference a dispute turns on.
 *
 * The export shape carries **no path, no disk and no URL**. The object key is
 * not a credential but it is one half of one, and `ExportService` is careful to
 * keep both out of the audit trail for the same reason; the only way to the
 * bytes is the download endpoint, which mints a fresh signature and records who
 * took a copy. `sha256` does travel — it is what a recipient checks the
 * download against, and it names nothing.
 */
final class OffboardingPresenter
{
    /**
     * @return array<string, mixed>
     */
    public function offboarding(B2bOffboarding $offboarding): array
    {
        return [
            'id' => (string) $offboarding->getKey(),
            'organisation_id' => $offboarding->organisation_id,
            'b2b_agreement_id' => $offboarding->b2b_agreement_id,
            'status' => $offboarding->status->value,
            'trigger' => $offboarding->trigger?->value,
            'reason' => $offboarding->reason,
            'reason_note' => $offboarding->reason_note,

            'requested_by' => $offboarding->requested_by,
            'requested_at' => $offboarding->requested_at->toIso8601String(),

            // Copied onto the row at `start()` rather than read through the
            // agreement, so an amendment signed next week cannot shorten notice
            // already served. Serving both makes that visible.
            'notice_period_days' => $offboarding->notice_period_days,
            'notice_served_at' => $offboarding->notice_served_at?->toIso8601String(),
            'effective_on' => $offboarding->effective_on?->toDateString(),

            'settlement' => [
                'status' => $offboarding->settlement_status->value,
                'note' => $offboarding->settlement_note,
                'checks' => $offboarding->settlement_checks ?? [],
                'started_at' => $offboarding->settlement_started_at?->toIso8601String(),
                'resolved_at' => $offboarding->settlement_resolved_at?->toIso8601String(),
                'waived_by' => $offboarding->settlement_waived_by,
                'waiver_reason' => $offboarding->settlement_waiver_reason,
            ],

            'signoff' => [
                'awaiting_since' => $offboarding->awaiting_signoff_at?->toIso8601String(),
                'signed_off_at' => $offboarding->signed_off_at?->toIso8601String(),
                'signed_off_by' => $offboarding->signed_off_by,
                'signatory_name' => $offboarding->signoff_signatory_name,
                'signatory_title' => $offboarding->signoff_signatory_title,
                'consent_statement' => $offboarding->signoff_consent_statement,
                'document_sha256' => $offboarding->signoff_document_sha256,
                // Deliberately absent: `signoff_ip_hash` and
                // `signoff_user_agent_hash`. See the class docblock.
            ],

            'revocation' => [
                'started_at' => $offboarding->revocation_started_at?->toIso8601String(),
                'completed_at' => $offboarding->revocation_completed_at?->toIso8601String(),
                'memberships_revoked' => $offboarding->memberships_revoked,
                'tokens_deleted' => $offboarding->tokens_deleted,
            ],

            'archive' => [
                'started_at' => $offboarding->archiving_started_at?->toIso8601String(),
                'summary' => $offboarding->archive_summary,
                // Said out loud rather than left to be inferred from the
                // summary's silence, exactly as the audit row says it: keeping
                // the legal entity was a decision, not an omission.
                'legal_entity_retained' => $offboarding->archive_summary === null ? null : true,
            ],

            'completed_at' => $offboarding->completed_at?->toIso8601String(),
            'cancelled_at' => $offboarding->cancelled_at?->toIso8601String(),
            'cancelled_by' => $offboarding->cancelled_by,
            'cancellation_reason' => $offboarding->cancellation_reason,

            'lock_version' => $offboarding->lock_version,
            'allowed_transitions' => array_map(
                static fn ($status): string => $status->value,
                $offboarding->status->allowedTransitions(),
            ),
        ];
    }

    /**
     * A records bundle, without any route to its bytes.
     *
     * @return array<string, mixed>
     */
    public function export(RecordExport $export, ?string $downloadUrl = null, ?string $urlExpiresAt = null): array
    {
        $shape = [
            'id' => (string) $export->getKey(),
            'organisation_id' => $export->organisation_id,
            'b2b_offboarding_id' => $export->b2b_offboarding_id,
            'status' => $export->status->value,
            'format' => $export->format,

            'requested_by' => $export->requested_by,
            'requested_at' => $export->requested_at->toIso8601String(),
            'started_at' => $export->started_at?->toIso8601String(),
            'completed_at' => $export->completed_at?->toIso8601String(),

            'byte_size' => $export->byte_size,
            // The digest a recipient checks their download against. It names
            // nothing and is the only way to tell a truncated transfer from a
            // complete one.
            'sha256' => $export->sha256,
            'row_counts' => $export->row_counts,
            'manifest' => $export->manifest,

            'expires_at' => $export->expires_at?->toIso8601String(),
            'downloaded_at' => $export->downloaded_at?->toIso8601String(),
            'download_count' => $export->download_count,
            'purged_at' => $export->purged_at?->toIso8601String(),
            'failure_reason' => $export->failure_reason,
            // Deliberately absent: `disk` and `path`.
        ];

        if ($downloadUrl !== null) {
            $shape['download_url'] = $downloadUrl;
            $shape['download_url_expires_at'] = $urlExpiresAt;
        }

        return $shape;
    }
}
