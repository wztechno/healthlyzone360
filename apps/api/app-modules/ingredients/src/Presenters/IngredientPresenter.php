<?php

declare(strict_types=1);

namespace Healthy360\Ingredients\Presenters;

use Healthy360\Ingredients\Models\Ingredient;
use Healthy360\Ingredients\Models\IngredientAlias;
use Healthy360\Ingredients\Models\IngredientAllergen;
use Healthy360\Ingredients\Models\IngredientCategory;

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
 */
final class IngredientPresenter
{
    /**
     * @return array{
     *     id: string,
     *     organisation_id: string|null,
     *     is_platform: bool,
     *     slug: string,
     *     name_en: string,
     *     name_ar: string,
     *     ingredient_category_id: string|null,
     *     ingredient_subcategory_id: string|null,
     *     default_unit_id: string,
     *     default_unit_code: string|null,
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
     *     updated_at: string|null
     * }
     */
    public function ingredient(Ingredient $ingredient): array
    {
        return [
            'id' => (string) $ingredient->getKey(),
            'organisation_id' => $ingredient->organisation_id,
            'is_platform' => $ingredient->isPlatformRow(),
            'slug' => $ingredient->slug,
            'name_en' => $ingredient->name_en,
            'name_ar' => $ingredient->name_ar,
            'ingredient_category_id' => $ingredient->ingredient_category_id,
            'ingredient_subcategory_id' => $ingredient->ingredient_subcategory_id,
            'default_unit_id' => $ingredient->default_unit_id,
            'default_unit_code' => $ingredient->relationLoaded('defaultUnit') ? $ingredient->defaultUnit?->code : null,
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
