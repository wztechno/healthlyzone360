<?php

declare(strict_types=1);

namespace Healthy360\Ingredients\Presenters;

use Healthy360\Ingredients\Models\Ingredient;
use Healthy360\Ingredients\Models\IngredientAlias;
use Healthy360\Ingredients\Models\IngredientAllergen;
use Healthy360\Ingredients\Models\IngredientCategory;
use Healthy360\Ingredients\Services\IngredientCatalogueService;

/**
 * The administrative wire shapes of the ingredient catalogue.
 *
 * Both names are always carried and `Accept-Language` is ignored for them:
 * a bilingual editor needs to see what it is editing (master plan v2 §4.18).
 * There is no public ingredient projection in K1.1 — nothing here reaches an
 * anonymous caller — so no denylist sweep applies to these shapes yet.
 *
 * `is_platform` is on the wire because the client has to know which rows it
 * may not edit before it offers an edit control; discovering it from a 403 is
 * a worse experience and a worse contract.
 *
 * `is_editable` is the answer that flag was being asked for and could not
 * give. "Platform row" is a fact about the row; "you may not edit it" is a
 * fact about the row *and the caller*, because the platform operator writes
 * exactly the rows a kitchen may not. Clients read `is_editable`;
 * `is_platform` stays for what it actually says — which library the row is in.
 */
final class IngredientPresenter
{
    public function __construct(private readonly IngredientCatalogueService $catalogue) {}

    /**
     * @param  iterable<IngredientAllergen>|null  $allergens  the mappings visible to this caller,
     *                                                        when the endpoint has already loaded
     *                                                        them; omitted from the shape entirely
     *                                                        rather than sent as an empty list,
     *                                                        because "none declared" and "not
     *                                                        loaded" are different answers and a
     *                                                        client must not render the second as
     *                                                        the first
     * @return array{
     *     id: string,
     *     organisation_id: string|null,
     *     is_platform: bool,
     *     is_editable: bool,
     *     slug: string,
     *     name_en: string,
     *     name_ar: string,
     *     ingredient_category_id: string|null,
     *     ingredient_subcategory_id: string|null,
     *     default_unit_id: string,
     *     default_unit_code: string|null,
     *     purchase_unit_id: string|null,
     *     purchase_unit_code: string|null,
     *     composition: string|null,
     *     items_per_unit: string|null,
     *     purchase_price_amount: string|null,
     *     purchase_price_currency: string|null,
     *     waste_percent: string|null,
     *     capacity_quantity: string|null,
     *     capacity_unit_code: string|null,
     *     nutrition_per_100g: array<string, mixed>|null,
     *     b2b_price_amount: string|null,
     *     b2c_price_amount: string|null,
     *     unit_price_amount: string|null,
     *     price_currency_code: string|null,
     *     is_sellable: bool,
     *     yield_factor: string,
     *     forked_from_ingredient_id: string|null,
     *     availability_tier: string|null,
     *     status: string,
     *     verification_status: string,
     *     notes: string|null,
     *     source_system: string|null,
     *     source_ref: string|null,
     *     lock_version: int,
     *     created_at: string|null,
     *     updated_at: string|null,
     *     allergens?: list<array<string, mixed>>
     * }
     */
    public function ingredient(Ingredient $ingredient, ?iterable $allergens = null): array
    {
        $presented = [
            'id' => (string) $ingredient->getKey(),
            'organisation_id' => $ingredient->organisation_id,
            'is_platform' => $ingredient->isPlatformRow(),
            'is_editable' => $this->catalogue->isWritable($ingredient),
            'slug' => $ingredient->slug,
            'name_en' => $ingredient->name_en,
            'name_ar' => $ingredient->name_ar,
            'ingredient_category_id' => $ingredient->ingredient_category_id,
            'ingredient_subcategory_id' => $ingredient->ingredient_subcategory_id,
            'default_unit_id' => $ingredient->default_unit_id,
            'default_unit_code' => $ingredient->relationLoaded('defaultUnit') ? $ingredient->defaultUnit?->code : null,
            'purchase_unit_id' => $ingredient->purchase_unit_id,
            'purchase_unit_code' => $ingredient->relationLoaded('purchaseUnit') ? $ingredient->purchaseUnit?->code : null,
            'composition' => $ingredient->composition,
            'items_per_unit' => $ingredient->items_per_unit === null ? null : (string) $ingredient->items_per_unit,
            /*
             * The three figures packaging brought with it when it came back into this table.
             *
             * `purchase_price_amount` is per **purchase pack**, not per issued unit — a sleeve at
             * $6.50, never a bag at $0.065 — which is why it is a separate field from
             * `unit_price_amount` beside it rather than the same one wearing two hats. Confusing
             * the two scales a cost by `items_per_unit`, and does it silently.
             *
             * All three are null on food, and that is not the same as zero: a null
             * `waste_percent` says nobody has measured this one, a `0` says they did and there is
             * none.
             */
            'purchase_price_amount' => $ingredient->purchase_price_amount === null ? null : (string) $ingredient->purchase_price_amount,
            'purchase_price_currency' => $ingredient->purchase_price_currency,
            'waste_percent' => $ingredient->waste_percent === null ? null : (string) $ingredient->waste_percent,
            'capacity_quantity' => $ingredient->capacity_quantity === null ? null : (string) $ingredient->capacity_quantity,
            'capacity_unit_code' => $ingredient->relationLoaded('capacityUnit') ? $ingredient->capacityUnit?->code : null,
            'nutrition_per_100g' => $ingredient->nutrition_per_100g,
            'b2b_price_amount' => $ingredient->b2b_price_amount === null ? null : (string) $ingredient->b2b_price_amount,
            'b2c_price_amount' => $ingredient->b2c_price_amount === null ? null : (string) $ingredient->b2c_price_amount,
            'unit_price_amount' => $ingredient->unit_price_amount === null ? null : (string) $ingredient->unit_price_amount,
            'price_currency_code' => $ingredient->price_currency_code,
            'is_sellable' => $ingredient->is_sellable,
            'yield_factor' => (string) $ingredient->yield_factor,
            'forked_from_ingredient_id' => $ingredient->forked_from_ingredient_id,
            'availability_tier' => $ingredient->availability_tier?->value,
            'status' => $ingredient->status->value,
            'verification_status' => $ingredient->verification_status->value,
            'notes' => $ingredient->notes,
            'source_system' => $ingredient->source_system,
            'source_ref' => $ingredient->source_ref,
            'lock_version' => $ingredient->lock_version,
            'created_at' => $ingredient->created_at?->toIso8601String(),
            'updated_at' => $ingredient->updated_at?->toIso8601String(),
        ];

        // Added rather than spread in: a conditional spread leaves the shape of what comes back
        // unknowable, and this array is the documented one every catalogue response is built on.
        if ($allergens !== null) {
            $presented['allergens'] = array_values(array_map(
                fn (IngredientAllergen $mapping): array => $this->mapping($mapping),
                is_array($allergens) ? $allergens : iterator_to_array($allergens),
            ));
        }

        return $presented;
    }

    /**
     * @return array{
     *     id: string,
     *     organisation_id: string|null,
     *     is_platform: bool,
     *     parent_id: string|null,
     *     code: string,
     *     name_en: string,
     *     name_ar: string,
     *     display_order: int,
     *     is_active: bool
     * }
     */
    public function category(IngredientCategory $category): array
    {
        return [
            'id' => (string) $category->getKey(),
            'organisation_id' => $category->organisation_id,
            'is_platform' => $category->isPlatformRow(),
            'parent_id' => $category->parent_id,
            'code' => $category->code,
            'name_en' => $category->name_en,
            'name_ar' => $category->name_ar,
            'display_order' => $category->display_order,
            'is_active' => $category->is_active,
        ];
    }

    /**
     * @return array{id: string, alias: string, alias_normalised: string, locale: string|null, source_system: string|null, source_ref: string|null}
     */
    public function alias(IngredientAlias $alias): array
    {
        return [
            'id' => (string) $alias->getKey(),
            'alias' => $alias->alias,
            'alias_normalised' => $alias->alias_normalised,
            'locale' => $alias->locale,
            'source_system' => $alias->source_system,
            'source_ref' => $alias->source_ref,
        ];
    }

    /**
     * `layer` is derived, not stored: the client needs to render a baseline
     * row as read-only and its own overlay as editable, and asking it to
     * infer that from a nullable identifier is how a UI ends up offering an
     * edit control that always 403s.
     *
     * @return array{
     *     id: string,
     *     allergen_code: string,
     *     layer: string,
     *     organisation_id: string|null,
     *     containment: string,
     *     market_scope: string,
     *     source: string,
     *     verification_status: string,
     *     evidence: string|null
     * }
     */
    public function mapping(IngredientAllergen $mapping): array
    {
        return [
            'id' => (string) $mapping->getKey(),
            'allergen_code' => $mapping->allergen_code,
            'layer' => $mapping->isPlatformBaseline() ? 'platform_baseline' : 'organisation_overlay',
            'organisation_id' => $mapping->organisation_id,
            'containment' => $mapping->containment->value,
            'market_scope' => $mapping->market_scope->value,
            'source' => $mapping->source->value,
            'verification_status' => $mapping->verification_status->value,
            'evidence' => $mapping->evidence,
        ];
    }
}
