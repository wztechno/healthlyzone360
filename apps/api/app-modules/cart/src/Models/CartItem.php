<?php

declare(strict_types=1);

namespace Healthy360\Cart\Models;

use Carbon\CarbonImmutable;
use Healthy360\Cart\Database\Factories\CartItemFactory;
use Healthy360\Catalogues\Models\CatalogueItem;
use Healthy360\Catalogues\Models\CatalogueItemVariant;
use Healthy360\Support\Attributes\Classified;
use Healthy360\Support\Enums\DataClassification;
use Healthy360\Support\Models\BaseModel;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * One line of a basket: an article, optionally a pack, a quantity, and the day
 * it is wanted.
 *
 * `quantity` is cast to a string by `decimal:4` and left that way on purpose.
 * It is matched against pricing tiers, which are decimals of the same scale,
 * and rounding it through a float on the way in is how a 0.3 kg line becomes
 * a 0.29999999 one at exactly the tier boundary.
 *
 * @property string $id
 * @property string $cart_id
 * @property string $catalogue_item_id
 * @property string|null $catalogue_item_variant_id
 * @property string $quantity
 * @property CarbonImmutable|null $delivery_date
 * @property CarbonImmutable|null $created_at
 * @property CarbonImmutable|null $updated_at
 * @property-read Cart|null $cart
 * @property-read CatalogueItem|null $item
 * @property-read CatalogueItemVariant|null $variant
 */
#[Classified(DataClassification::Internal, 'quantity', 'delivery_date')]
class CartItem extends BaseModel
{
    /** @use HasFactory<CartItemFactory> */
    use HasFactory;

    /**
     * @return array<string, string>
     */
    protected function casts(): array
    {
        return [
            'quantity' => 'decimal:4',
            'delivery_date' => 'immutable_date',
        ];
    }

    /**
     * @return BelongsTo<Cart, $this>
     */
    public function cart(): BelongsTo
    {
        return $this->belongsTo(Cart::class);
    }

    /**
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
