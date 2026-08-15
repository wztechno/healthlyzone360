<?php

declare(strict_types=1);

namespace Healthy360\B2b\Presenters;

use Healthy360\B2b\Models\Quotation;
use Healthy360\B2b\Models\QuotationLine;
use Illuminate\Support\Collection;

/**
 * The wire shape of a quotation and its lines.
 *
 * Money is an integer of minor units beside its currency code, never
 * formatted (§4.4). `unit_amount_minor` and `line_total_minor` are simply
 * `null` on an unpriced line — the absence *is* the statement that the
 * kitchen has not quoted it yet, the same convention `price_list_items`
 * draws for a placeholder row.
 */
final class QuotationPresenter
{
    /**
     * @param  Collection<int, QuotationLine>|null  $lines
     * @return array{
     *     id: string,
     *     organisation_id: string,
     *     corporate_programme_id: string,
     *     reference: string,
     *     status: string,
     *     currency_code: string,
     *     notes: string|null,
     *     decline_reason: string|null,
     *     submitted_at: string|null,
     *     quoted_at: string|null,
     *     expires_at: string|null,
     *     decided_at: string|null,
     *     lock_version: int,
     *     lines: list<array<string, mixed>>,
     *     created_at: string|null,
     *     updated_at: string|null
     * }
     */
    public function quotation(Quotation $quotation, ?Collection $lines = null): array
    {
        return [
            'id' => (string) $quotation->getKey(),
            'organisation_id' => $quotation->organisation_id,
            'corporate_programme_id' => $quotation->corporate_programme_id,
            'reference' => $quotation->reference,
            'status' => $quotation->status->value,
            'currency_code' => $quotation->currency_code,
            'notes' => $quotation->notes,
            'decline_reason' => $quotation->decline_reason,
            'submitted_at' => $quotation->submitted_at?->toIso8601String(),
            'quoted_at' => $quotation->quoted_at?->toIso8601String(),
            'expires_at' => $quotation->expires_at?->toIso8601String(),
            'decided_at' => $quotation->decided_at?->toIso8601String(),
            'lock_version' => $quotation->lock_version,
            'lines' => array_values(
                ($lines ?? $quotation->lines()->get())->map($this->line(...))->all(),
            ),
            'created_at' => $quotation->created_at?->toIso8601String(),
            'updated_at' => $quotation->updated_at?->toIso8601String(),
        ];
    }

    /**
     * @return array{
     *     id: string,
     *     line_number: int,
     *     catalogue_item_id: string,
     *     catalogue_item_variant_id: string|null,
     *     quantity: string,
     *     unit_amount_minor: int|null,
     *     line_total_minor: int|null,
     *     note: string|null
     * }
     */
    public function line(QuotationLine $line): array
    {
        return [
            'id' => (string) $line->getKey(),
            'line_number' => $line->line_number,
            'catalogue_item_id' => $line->catalogue_item_id,
            'catalogue_item_variant_id' => $line->catalogue_item_variant_id,
            'quantity' => (string) $line->quantity,
            'unit_amount_minor' => $line->unit_amount_minor,
            'line_total_minor' => $line->line_total_minor,
            'note' => $line->note,
        ];
    }
}
