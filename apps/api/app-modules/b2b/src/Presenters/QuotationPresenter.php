<?php

declare(strict_types=1);

namespace Healthy360\B2b\Presenters;

use Healthy360\B2b\Models\Quotation;
use Healthy360\B2b\Models\QuotationLine;
use Healthy360\Catalogues\Models\CatalogueItem;
use Healthy360\Orders\Models\Order;
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
     *     requested_delivery_date: string|null,
     *     recurring: bool,
     *     contact_name: string|null,
     *     contact_email: string|null,
     *     order_id: string|null,
     *     order_number: string|null,
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
            'requested_delivery_date' => $quotation->requested_delivery_date?->toDateString(),
            'recurring' => (bool) $quotation->recurring,
            'contact_name' => $quotation->contact_name,
            'contact_email' => $quotation->contact_email,
            'order_id' => $quotation->order_id,
            'order_number' => $quotation->order_id === null
                ? null
                : Order::query()->whereKey($quotation->order_id)->value('order_number'),
            'decline_reason' => $quotation->decline_reason,
            'submitted_at' => $quotation->submitted_at?->toIso8601String(),
            'quoted_at' => $quotation->quoted_at?->toIso8601String(),
            'expires_at' => $quotation->expires_at?->toIso8601String(),
            'decided_at' => $quotation->decided_at?->toIso8601String(),
            'lock_version' => $quotation->lock_version,
            'lines' => $this->lines($lines ?? $quotation->lines()->get()),
            'created_at' => $quotation->created_at?->toIso8601String(),
            'updated_at' => $quotation->updated_at?->toIso8601String(),
        ];
    }

    /**
     * The lines with their article names, read in one query. The articles are
     * the kitchen's, so the read crosses the buyer's tenant scope the same
     * way `writeLines()` does to validate them.
     *
     * @param  Collection<int, QuotationLine>  $lines
     * @return list<array<string, mixed>>
     */
    private function lines(Collection $lines): array
    {
        $items = CatalogueItem::withoutTenancy()
            ->whereIn('id', $lines->pluck('catalogue_item_id')->unique()->values()->all())
            ->get()
            ->keyBy(static fn (CatalogueItem $item): string => (string) $item->getKey());

        return array_values($lines->map(fn (QuotationLine $line): array => $this->line($line, $items->get((string) $line->catalogue_item_id)))->all());
    }

    /**
     * @return array{
     *     id: string,
     *     catalogue_item_name_en: string|null,
     *     catalogue_item_name_ar: string|null,
     *     line_number: int,
     *     catalogue_item_id: string,
     *     catalogue_item_variant_id: string|null,
     *     quantity: string,
     *     unit_amount_minor: int|null,
     *     line_total_minor: int|null,
     *     note: string|null
     * }
     */
    public function line(QuotationLine $line, ?CatalogueItem $item = null): array
    {
        $item ??= CatalogueItem::withoutTenancy()->whereKey($line->catalogue_item_id)->first();

        return [
            'id' => (string) $line->getKey(),
            'catalogue_item_name_en' => $item?->name_en,
            'catalogue_item_name_ar' => $item?->name_ar,
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
