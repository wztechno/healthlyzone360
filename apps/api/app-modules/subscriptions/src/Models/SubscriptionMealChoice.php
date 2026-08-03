<?php

declare(strict_types=1);

namespace Healthy360\Subscriptions\Models;

use Carbon\CarbonImmutable;
use Healthy360\Catalogues\Models\CatalogueItem;
use Healthy360\Subscriptions\Enums\MealChoiceSource;
use Healthy360\Support\Attributes\Classified;
use Healthy360\Support\Enums\DataClassification;
use Healthy360\Support\Models\BaseModel;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * What fills one slot of one subscription day.
 *
 * `unsafe_allergen_classes` is `SpecialCategory`: a list of allergen classes
 * attached to a named person's delivery is health data, exactly as
 * `CustomerAllergenDeclaration` says of the same codes on the customer's own
 * profile. It is never rendered on a kitchen-facing surface without the
 * purpose-of-use path.
 *
 * @property string $id
 * @property string $subscription_id
 * @property string $organisation_id
 * @property string|null $subscription_delivery_id
 * @property CarbonImmutable $delivery_date
 * @property string $slot
 * @property int $sequence
 * @property string $catalogue_item_id
 * @property string|null $catalogue_item_variant_id
 * @property MealChoiceSource $source
 * @property string|null $replaced_catalogue_item_id
 * @property CarbonImmutable|null $safety_checked_at
 * @property list<string>|null $unsafe_allergen_classes
 * @property string|null $created_by
 * @property CarbonImmutable|null $created_at
 * @property CarbonImmutable|null $updated_at
 * @property-read Subscription|null $subscription
 * @property-read SubscriptionDelivery|null $delivery
 * @property-read CatalogueItem|null $meal
 */
#[Classified(DataClassification::SpecialCategory, 'unsafe_allergen_classes')]
class SubscriptionMealChoice extends BaseModel
{
    /**
     * @return array<string, string>
     */
    protected function casts(): array
    {
        return [
            'source' => MealChoiceSource::class,
            'delivery_date' => 'date',
            'sequence' => 'integer',
            'safety_checked_at' => 'datetime',
            'unsafe_allergen_classes' => 'array',
        ];
    }

    /**
     * @return BelongsTo<Subscription, $this>
     */
    public function subscription(): BelongsTo
    {
        return $this->belongsTo(Subscription::class);
    }

    /**
     * @return BelongsTo<SubscriptionDelivery, $this>
     */
    public function delivery(): BelongsTo
    {
        return $this->belongsTo(SubscriptionDelivery::class, 'subscription_delivery_id');
    }

    /**
     * @return BelongsTo<CatalogueItem, $this>
     */
    public function meal(): BelongsTo
    {
        return $this->belongsTo(CatalogueItem::class, 'catalogue_item_id');
    }
}
