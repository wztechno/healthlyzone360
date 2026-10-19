<?php

declare(strict_types=1);

namespace Healthy360\B2b\Presenters;

use Healthy360\B2b\Models\CorporateProgramme;
use Healthy360\B2b\Models\Quotation;
use Healthy360\B2b\Models\QuotationLine;
use Healthy360\Catalogues\Models\CatalogueItem;
use Illuminate\Support\Collection;

/**
 * The wire shape of a quotation and its lines.
 *
 * Money is an integer of minor units beside its currency code, never
 * formatted (§4.4). `unit_amount_minor` and `line_total_minor` are simply
 * `null` on an unpriced line — the absence *is* the statement that the
 * kitchen has not quoted it yet, the same convention `price_list_items`
 * draws for a placeholder row.
 *
 * The programme's and each article's names ride along so neither side has to
 * render a bare identifier. They are read with the tenant scope bypassed: the
 * programme and the quotation belong to the buyer while the articles belong to
 * the kitchen, so from either side one of the two is in a foreign tenant. The
 * caller has already proven access to the quotation itself, and a name is
 * public catalogue data.
 */
final class QuotationPresenter
{
    /** @var array<string, array{name_en: string, name_ar: string}|null> */
    private array $programmeNames = [];

    /**
     * @param  Collection<int, QuotationLine>|null  $lines
     * @return array{
     *     id: string,
     *     organisation_id: string,
     *     corporate_programme_id: string,
     *     programme_name_en: string|null,
     *     programme_name_ar: string|null,
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
        $lines ??= $quotation->lines()->get();
        $programme = $this->programmeName($quotation->corporate_programme_id);
        $items = $this->itemNames($lines);

        return [
            'id' => (string) $quotation->getKey(),
            'organisation_id' => $quotation->organisation_id,
            'corporate_programme_id' => $quotation->corporate_programme_id,
            'programme_name_en' => $programme['name_en'] ?? null,
            'programme_name_ar' => $programme['name_ar'] ?? null,
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
                $lines->map(fn (QuotationLine $line): array => $this->line($line, $items[$line->catalogue_item_id] ?? null))->all(),
            ),
            'created_at' => $quotation->created_at?->toIso8601String(),
            'updated_at' => $quotation->updated_at?->toIso8601String(),
        ];
    }

    /**
     * @param  array{name_en: string, name_ar: string}|null  $item
     * @return array{
     *     id: string,
     *     line_number: int,
     *     catalogue_item_id: string,
     *     item_name_en: string|null,
     *     item_name_ar: string|null,
     *     catalogue_item_variant_id: string|null,
     *     quantity: string,
     *     unit_amount_minor: int|null,
     *     line_total_minor: int|null,
     *     note: string|null
     * }
     */
    public function line(QuotationLine $line, ?array $item = null): array
    {
        return [
            'id' => (string) $line->getKey(),
            'line_number' => $line->line_number,
            'catalogue_item_id' => $line->catalogue_item_id,
            'item_name_en' => $item['name_en'] ?? null,
            'item_name_ar' => $item['name_ar'] ?? null,
            'catalogue_item_variant_id' => $line->catalogue_item_variant_id,
            'quantity' => (string) $line->quantity,
            'unit_amount_minor' => $line->unit_amount_minor,
            'line_total_minor' => $line->line_total_minor,
            'note' => $line->note,
        ];
    }

    /**
     * @return array{name_en: string, name_ar: string}|null
     */
    private function programmeName(string $programmeId): ?array
    {
        if (! array_key_exists($programmeId, $this->programmeNames)) {
            $programme = CorporateProgramme::withoutTenancy()->whereKey($programmeId)->first(['id', 'name_en', 'name_ar']);

            $this->programmeNames[$programmeId] = $programme instanceof CorporateProgramme
                ? ['name_en' => $programme->name_en, 'name_ar' => $programme->name_ar]
                : null;
        }

        return $this->programmeNames[$programmeId];
    }

    /**
     * @param  Collection<int, QuotationLine>  $lines
     * @return array<string, array{name_en: string, name_ar: string}>
     */
    private function itemNames(Collection $lines): array
    {
        if ($lines->isEmpty()) {
            return [];
        }

        return CatalogueItem::withoutTenancy()
            ->whereIn('id', $lines->pluck('catalogue_item_id')->unique()->values())
            ->get(['id', 'name_en', 'name_ar'])
            ->mapWithKeys(fn (CatalogueItem $item): array => [
                (string) $item->getKey() => ['name_en' => $item->name_en, 'name_ar' => $item->name_ar],
            ])
            ->all();
    }
}
