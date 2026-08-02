<?php

declare(strict_types=1);

namespace Healthy360\Catalogues\Services;

use Healthy360\Catalogues\Enums\CatalogueItemStatus;
use Healthy360\Catalogues\Models\CatalogueItem;
use Healthy360\Catalogues\Models\CatalogueItemIngredient;
use Healthy360\Ingredients\Contracts\IngredientUsageRegistry;
use Healthy360\Ingredients\Models\Ingredient;
use Healthy360\Tenancy\TenantContext;

/**
 * The catalogue module's half of the ingredients module's usage question.
 *
 * **A decorator, not a replacement.** The recipes module already answers
 * "which formulations name this ingredient"; this adds "and which listings
 * name it on their public ingredient list", then hands back one merged answer.
 * Composing rather than replacing is what keeps both facts true at once — a
 * registry that overwrote the recipe implementation would make an ingredient
 * used by a live formulation archivable, which is a regression K1.2 already
 * paid for.
 *
 * Bound by `CataloguesServiceProvider` from an `app->booted()` callback, so it
 * wraps whatever the recipes module put in place regardless of which provider
 * booted first. Ordering by luck is how one of these bindings silently
 * disappears.
 *
 * "Live" excludes **retired** items, the same rule the recipe implementation
 * applies to retired versions: history is allowed to point at an archived
 * ingredient, and treating it as a live reference would mean a kitchen could
 * never retire an ingredient it had ever sold. Draft and quarantined items do
 * block — they are work in progress on something intended to go live, and an
 * archived ingredient underneath one is a listing that can never be published.
 */
final readonly class CatalogueIngredientUsageRegistry implements IngredientUsageRegistry
{
    public function __construct(
        private IngredientUsageRegistry $inner,
        private TenantContext $context,
    ) {}

    /**
     * @return array{recipe_ids: list<string>, recipe_version_ids: list<string>, catalogue_item_ids: list<string>}
     */
    public function activeReferences(Ingredient $ingredient): array
    {
        $references = $this->inner->activeReferences($ingredient);

        if (! $this->context->hasOrganisation()) {
            return $references;
        }

        $items = CatalogueItem::query()
            ->where('status', '!=', CatalogueItemStatus::Retired->value)
            ->whereIn('id', CatalogueItemIngredient::query()
                ->where('ingredient_id', $ingredient->getKey())
                ->select('catalogue_item_id'))
            ->orderBy('slug')
            ->pluck('id')
            ->map(static fn (mixed $id): string => (string) $id)
            ->all();

        $references['catalogue_item_ids'] = array_values(array_unique([...$references['catalogue_item_ids'], ...$items]));

        return $references;
    }

    /**
     * Nothing to mark. Catalogue items hold **no stored allergen roll-up** —
     * the derivation is computed on read from a published recipe version's
     * frozen label or from the item's own ingredient list — so there is no
     * cached conclusion for a mapping change to invalidate. The delegation is
     * not a formality: the recipe labels underneath are stored, they do go
     * stale, and this call is what marks them and schedules their recompute.
     *
     * A listing whose recipe label really did change *is* pulled off sale, but
     * that happens on the other edge — the recompute job asks
     * `RecipeUsageRegistry` once it knows the label moved, rather than every
     * mapping edit quarantining a menu speculatively.
     *
     * @return list<string>
     */
    public function markDependentDerivationsStale(Ingredient $ingredient): array
    {
        return $this->inner->markDependentDerivationsStale($ingredient);
    }

    /**
     * Delegated whole. The question is "which organisations hold a formulation
     * using this ingredient", and a catalogue listing is not a formulation —
     * an item's ingredient list carries no version to recompute, because there
     * is nothing stored to recompute.
     *
     * @return list<string>
     */
    public function dependentOrganisationIds(Ingredient $ingredient): array
    {
        return $this->inner->dependentOrganisationIds($ingredient);
    }
}
