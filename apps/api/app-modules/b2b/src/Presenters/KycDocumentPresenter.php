<?php

declare(strict_types=1);

namespace Healthy360\B2b\Presenters;

use Healthy360\B2b\Models\KycDocument;

/**
 * The wire shapes of an identity document — its **metadata**, and nothing that
 * would locate its bytes.
 *
 * `disk` and `path` are hidden on the model for exactly this reason, and their
 * absence here is a second statement of the same rule rather than a
 * consequence of it: a presenter is a hand-written allowlist, so the only way
 * an object key reaches a client is if somebody types it into this file. There
 * is no `url` field either. `KycDocumentService::temporaryUrl()` is the sole
 * route to the bytes, it expires in minutes, and it records who asked and why
 * — a permanent link on a listing would defeat all three properties at once.
 *
 * **Two methods, not one shape with a flag.** `rejection_reason` is the half of
 * a rejection the applicant is shown — a closed vocabulary they can act on —
 * and `review_note` is the reviewer's own words, which stay internal. A single
 * shape with a boolean argument is one wrong call away from publishing the
 * note; two methods cannot be called wrongly. `purge_after` is on the internal
 * shape for a second reason: the retention window is a *placeholder* pending
 * OQ-029, and showing an applicant a deadline the platform has not decided
 * would present a guess as a commitment.
 *
 * **`scan_status` is served on both, and it reads `not_scanned` on every
 * document B1 stores.** Hiding it would be the comfortable choice and the
 * wrong one: an applicant and a reviewer are both entitled to know that
 * nothing has looked inside the file. Nothing here may be rendered as "safe";
 * only `clean` means that, and no code path produces it yet (INT-008).
 *
 * `sha256` is carried because it is what an agreement's signature evidence
 * names, so "is the document I am about to sign the one on file" is answerable
 * without downloading anything.
 */
final class KycDocumentPresenter
{
    /**
     * What the applicant is shown.
     *
     * @return array{
     *     id: string,
     *     document_kind: string,
     *     original_filename: string,
     *     mime_type: string,
     *     declared_mime_type: string|null,
     *     media_type_mismatch: bool,
     *     byte_size: int,
     *     sha256: string,
     *     scan_status: string,
     *     review_status: string,
     *     rejection_reason: string|null,
     *     reviewed_at: string|null,
     *     uploaded_by: string|null,
     *     uploaded_at: string,
     *     expires_on: string|null,
     *     has_expired: bool
     * }
     */
    public function document(KycDocument $document): array
    {
        return [
            'id' => (string) $document->getKey(),
            'document_kind' => $document->document_kind->value,
            'original_filename' => $document->original_filename,
            'mime_type' => $document->mime_type,
            'declared_mime_type' => $document->declared_mime_type,
            // The mismatch is evidence, so it is stated rather than left for a
            // client to compute from two fields it might not think to compare.
            'media_type_mismatch' => $document->declared_mime_type !== null
                && $document->declared_mime_type !== $document->mime_type,
            'byte_size' => $document->byte_size,
            'sha256' => $document->sha256,
            'scan_status' => $document->scan_status->value,
            'review_status' => $document->review_status->value,
            'rejection_reason' => $document->rejection_reason?->value,
            'reviewed_at' => $document->reviewed_at?->toIso8601String(),
            'uploaded_by' => $document->uploaded_by,
            'uploaded_at' => $document->uploaded_at->toIso8601String(),
            'expires_on' => $document->expires_on?->toDateString(),
            'has_expired' => $document->hasExpired(),
        ];
    }

    /**
     * The reviewer's view: the same document, plus the internal note, who
     * decided and when the retention window closes.
     *
     * @return array<string, mixed>
     */
    public function review(KycDocument $document): array
    {
        return $this->document($document) + [
            'review_note' => $document->review_note,
            'reviewed_by' => $document->reviewed_by,
            'owner_kind' => $document->ownerKind(),
            'b2b_application_id' => $document->b2b_application_id,
            'purge_after' => $document->purge_after->toIso8601String(),
        ];
    }
}
