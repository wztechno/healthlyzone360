<?php

declare(strict_types=1);

namespace Healthy360\Catalogues\Models;

use Carbon\CarbonImmutable;
use Healthy360\Support\Attributes\Classified;
use Healthy360\Support\Enums\DataClassification;
use Healthy360\Support\Models\BaseModel;
use Healthy360\Tenancy\Concerns\BelongsToOrganisation;
use Healthy360\Tenancy\Contracts\OrganisationScoped;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * What one pack of one dish earns on one place, as of the last run. Written by
 * `DishMargins`; the migration explains why this is stored.
 *
 * Confidential, as the recipe's own costs are.
 *
 * @property string $id
 * @property string $organisation_id
 * @property string $catalogue_item_id
 * @property string|null $catalogue_item_variant_id the pack; null on a dish's one row saying it has no pack, recipe or price
 * @property string|null $pack_label the pack's name as of the run
 * @property string $channel the place: `home` | `business`
 * @property numeric-string|null $price_amount per pack, in major units
 * @property numeric-string|null $contents_amount what the pack's fill costs, stated even while its packaging is unknown
 * @property numeric-string|null $cost_amount per pack: contents plus packaging
 * @property string|null $currency_code
 * @property numeric-string|null $margin_percent
 * @property string|null $withheld_reason `no_recipe` | `no_pack` | `no_price` | `packaging_unknown` | `cost_incomplete` | `currency_mismatch`
 * @property CarbonImmutable|null $below_target_since
 * @property CarbonImmutable $computed_at
 * @property CarbonImmutable|null $created_at
 * @property CarbonImmutable|null $updated_at
 * @property-read CatalogueItem|null $catalogueItem
 */
#[Classified(DataClassification::Confidential, 'price_amount', 'contents_amount', 'cost_amount', 'margin_percent')]
#[Classified(DataClassification::Internal, 'pack_label', 'channel', 'currency_code', 'withheld_reason', 'below_target_since', 'computed_at')]
class DishMargin extends BaseModel implements OrganisationScoped
{
    use BelongsToOrganisation;

    /**
     * @return array<string, string>
     */
    protected function casts(): array
    {
        return [
            'price_amount' => 'decimal:6',
            'contents_amount' => 'decimal:6',
            'cost_amount' => 'decimal:6',
            'margin_percent' => 'decimal:2',
            'below_target_since' => 'immutable_datetime',
            'computed_at' => 'immutable_datetime',
        ];
    }

    /**
     * @return BelongsTo<CatalogueItem, $this>
     */
    public function catalogueItem(): BelongsTo
    {
        return $this->belongsTo(CatalogueItem::class);
    }
}
