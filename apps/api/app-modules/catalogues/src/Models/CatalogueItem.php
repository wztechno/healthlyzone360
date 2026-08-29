<?php

declare(strict_types=1);

namespace Healthy360\Catalogues\Models;

use App\Models\User;
use Carbon\CarbonImmutable;
use Healthy360\Catalogues\Database\Factories\CatalogueItemFactory;
use Healthy360\Catalogues\Enums\CatalogueItemStatus;
use Healthy360\Catalogues\Enums\CatalogueItemType;
use Healthy360\Catalogues\Enums\ProductionMode;
use Healthy360\Ingredients\Models\Ingredient;
use Healthy360\Recipes\Models\Recipe;
use Healthy360\ReferenceData\Models\MeasurementUnit;
use Healthy360\Support\Attributes\Classified;
use Healthy360\Support\Enums\DataClassification;
use Healthy360\Support\Models\BaseModel;
use Healthy360\Tenancy\Concerns\BelongsToOrganisation;
use Healthy360\Tenancy\Contracts\OrganisationScoped;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Database\Eloquent\Relations\HasOne;

/**
 * A sellable thing: a retail product, a meal, or a subscription plan.
 *
 * Classified `Public`, which is the point of the whole table. A catalogue
 * item's name, description, ingredient list and allergen set are *meant* to
 * reach a diner — that is what publishing one does. What is confidential
 * about a catalogue is the price, and no price column exists here: money
 * lives in K1.5's `price_lists`. The frontend contract's confidential
 * `marginPercent` has no server-side home at all, by construction.
 *
 * `slug` is immutable after creation (master plan v2 §4): a rename changes
 * the names and nothing else, because a slug is what a link, a marketplace
 * listing and a partner's integration hold.
 *
 * @property string $id
 * @property string $organisation_id
 * @property string $catalogue_id
 * @property CatalogueItemType $item_type
 * @property string $slug
 * @property string $name_en
 * @property string $name_ar
 * @property string|null $description_en
 * @property string|null $description_ar
 * @property string|null $product_category_id
 * @property string|null $composition
 * @property string|null $kitchen_category
 * @property string|null $kitchen_subcategory
 * @property ProductionMode|null $production_mode
 * @property string|null $recipe_id
 * @property string|null $ingredient_id
 * @property string|null $purchasing_unit_id
 * @property string|null $usage_unit_id
 * @property bool $is_market_priced
 * @property bool $is_assorted
 * @property CatalogueItemStatus $status
 * @property string|null $review_reason
 * @property string|null $image_placeholder_id
 * @property array<string, mixed>|null $nutrition_facts
 * @property list<string>|null $data_quality_flags
 * @property string|null $source_system
 * @property string|null $source_ref
 * @property CarbonImmutable|null $seeded_at
 * @property string|null $created_by
 * @property string|null $updated_by
 * @property int $lock_version
 * @property CarbonImmutable|null $created_at
 * @property CarbonImmutable|null $updated_at
 */
#[Classified(DataClassification::Public, 'slug', 'name_en', 'name_ar', 'description_en', 'description_ar')]
#[Classified(DataClassification::Public, 'nutrition_facts')]
#[Classified(DataClassification::Internal, 'review_reason', 'data_quality_flags', 'source_system', 'source_ref')]
class CatalogueItem extends BaseModel implements OrganisationScoped
{
    use BelongsToOrganisation;

    /** @use HasFactory<CatalogueItemFactory> */
    use HasFactory;

    /**
     * @return array<string, string>
     */
    protected function casts(): array
    {
        return [
            'item_type' => CatalogueItemType::class,
            'production_mode' => ProductionMode::class,
            'status' => CatalogueItemStatus::class,
            'is_market_priced' => 'boolean',
            'is_assorted' => 'boolean',
            'nutrition_facts' => 'array',
            'data_quality_flags' => 'array',
            'seeded_at' => 'immutable_datetime',
            'lock_version' => 'integer',
        ];
    }

    /**
     * @return BelongsTo<Catalogue, $this>
     */
    public function catalogue(): BelongsTo
    {
        return $this->belongsTo(Catalogue::class);
    }

    /**
     * @return BelongsTo<ProductCategory, $this>
     */
    public function category(): BelongsTo
    {
        return $this->belongsTo(ProductCategory::class, 'product_category_id');
    }

    /**
     * @return BelongsTo<Recipe, $this>
     */
    public function recipe(): BelongsTo
    {
        return $this->belongsTo(Recipe::class);
    }

    /**
     * @return BelongsTo<Ingredient, $this>
     */
    public function ingredient(): BelongsTo
    {
        return $this->belongsTo(Ingredient::class);
    }

    /**
     * @return BelongsTo<MeasurementUnit, $this>
     */
    public function purchasingUnit(): BelongsTo
    {
        return $this->belongsTo(MeasurementUnit::class, 'purchasing_unit_id');
    }

    /**
     * @return BelongsTo<MeasurementUnit, $this>
     */
    public function usageUnit(): BelongsTo
    {
        return $this->belongsTo(MeasurementUnit::class, 'usage_unit_id');
    }

    /**
     * @return HasMany<CatalogueItemVariant, $this>
     */
    public function variants(): HasMany
    {
        return $this->hasMany(CatalogueItemVariant::class);
    }

    /**
     * The commercial terms, present only on a subscription plan.
     *
     * @return HasOne<SubscriptionPlanProfile, $this>
     */
    public function planProfile(): HasOne
    {
        return $this->hasOne(SubscriptionPlanProfile::class, 'catalogue_item_id');
    }

    /**
     * The cells of the availability matrix, present only on a subscription
     * plan. A cell is a variant; this is the commercial half of it.
     *
     * @return HasMany<PlanVariantProfile, $this>
     */
    public function planVariantProfiles(): HasMany
    {
        return $this->hasMany(PlanVariantProfile::class, 'catalogue_item_id');
    }

    /**
     * @return HasMany<CatalogueItemIngredient, $this>
     */
    public function ingredients(): HasMany
    {
        return $this->hasMany(CatalogueItemIngredient::class);
    }

    /**
     * @return HasMany<CatalogueItemDietClassification, $this>
     */
    public function dietClassifications(): HasMany
    {
        return $this->hasMany(CatalogueItemDietClassification::class);
    }

    /**
     * @return HasMany<ChannelCatalogueItem, $this>
     */
    public function channelAssignments(): HasMany
    {
        return $this->hasMany(ChannelCatalogueItem::class);
    }

    /**
     * @return BelongsTo<User, $this>
     */
    public function creator(): BelongsTo
    {
        return $this->belongsTo(User::class, 'created_by');
    }

    /**
     * @return BelongsTo<User, $this>
     */
    public function updater(): BelongsTo
    {
        return $this->belongsTo(User::class, 'updated_by');
    }

    public function isEditable(): bool
    {
        return $this->status->isEditable();
    }
}
