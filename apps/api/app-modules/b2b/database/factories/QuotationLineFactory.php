<?php

declare(strict_types=1);

namespace Healthy360\B2b\Database\Factories;

use Healthy360\B2b\Models\Quotation;
use Healthy360\B2b\Models\QuotationLine;
use Healthy360\Catalogues\Models\CatalogueItem;
use Illuminate\Database\Eloquent\Factories\Factory;

/**
 * @extends Factory<QuotationLine>
 */
class QuotationLineFactory extends Factory
{
    /** @var class-string<QuotationLine> */
    protected $model = QuotationLine::class;

    /**
     * @return array<string, mixed>
     */
    public function definition(): array
    {
        return [
            'quotation_id' => Quotation::factory(),
            'organisation_id' => fn (array $attributes): ?string => Quotation::withoutTenancy()
                ->whereKey($attributes['quotation_id'] ?? null)
                ->value('organisation_id'),
            'line_number' => 1,
            'catalogue_item_id' => CatalogueItem::factory(),
            'catalogue_item_variant_id' => null,
            'quantity' => '10.0000',
            'unit_amount_minor' => null,
            'line_total_minor' => null,
            'note' => null,
        ];
    }

    public function priced(int $unitAmountMinor = 2200): self
    {
        return $this->state(fn (array $attributes): array => [
            'unit_amount_minor' => $unitAmountMinor,
            'line_total_minor' => (int) round(((float) ($attributes['quantity'] ?? 1)) * $unitAmountMinor),
        ]);
    }
}
