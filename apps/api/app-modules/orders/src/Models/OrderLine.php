<?php

declare(strict_types=1);

namespace Healthy360\Orders\Models;

use Carbon\CarbonImmutable;
use Healthy360\Catalogues\Models\CatalogueItem;
use Healthy360\Catalogues\Models\CatalogueItemVariant;
use Healthy360\Orders\Database\Factories\OrderLineFactory;
use Healthy360\Support\Attributes\Classified;
use Healthy360\Support\Enums\DataClassification;
use Healthy360\Support\Models\BaseModel;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * One article on an order, as it stood the moment the order was placed.
 *
 * The names, the pack label and the allergen statement are `Public` — they are
 * literally what the customer was shown, and a receipt, a courier manifest and
 * a marketplace confirmation all carry them. The amounts are `Internal`: what
 * somebody was charged is their own business and the kitchen's, not a
 * marketplace partner's. Nothing here is `Confidential`, because nothing
 * confidential is copied onto an order line — that is the point of the table.
 *
 * `price_list_id` and `price_list_item_id` are `Internal` and never leave the
 * server: they exist so that "why was this the price?" is answerable a year
 * later, and the anonymous-surface sweep denylists exactly those keys.
 *
 * @property string $id
 * @property string $order_id
 * @property string $catalogue_item_id
 * @property string|null $catalogue_item_variant_id
 * @property string $name_en
 * @property string $name_ar
 * @property string|null $variant_label
 * @property string $quantity
 * @property int $unit_price_minor
 * @property int $line_total_minor
 * @property string $currency_code
 * @property list<array{allergen_code: string, containment: string}> $allergens
 * @property array<string, mixed>|null $pack_summary
 * @property string|null $price_list_id
 * @property string|null $price_list_item_id
 * @property CarbonImmutable|null $created_at
 * @property CarbonImmutable|null $updated_at
 * @property-read Order|null $order
 */
#[Classified(DataClassification::Public, 'name_en', 'name_ar', 'variant_label', 'quantity', 'allergens', 'pack_summary')]
#[Classified(DataClassification::Internal, 'unit_price_minor', 'line_total_minor', 'price_list_id', 'price_list_item_id')]
class OrderLine extends BaseModel
{
    /** @use HasFactory<OrderLineFactory> */
    use HasFactory;

    /**
     * @return array<string, string>
     */
    protected function casts(): array
    {
        return [
            'quantity' => 'decimal:4',
            'unit_price_minor' => 'integer',
            'line_total_minor' => 'integer',
            'allergens' => 'array',
            'pack_summary' => 'array',
        ];
    }

    /**
     * @return BelongsTo<Order, $this>
     */
    public function order(): BelongsTo
    {
        return $this->belongsTo(Order::class);
    }

    /**
     * The article as it is *now* — deliberately separate from the snapshot.
     * Reading a name through this relation instead of from `name_en` would
     * undo the whole reason the column exists.
     *
     * @return BelongsTo<CatalogueItem, $this>
     */
    public function item(): BelongsTo
    {
        return $this->belongsTo(CatalogueItem::class, 'catalogue_item_id');
    }

    /**
     * @return BelongsTo<CatalogueItemVariant, $this>
     */
    public function variant(): BelongsTo
    {
        return $this->belongsTo(CatalogueItemVariant::class, 'catalogue_item_variant_id');
    }
}
