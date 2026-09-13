<?php

declare(strict_types=1);

namespace Healthy360\Catalogues\Services;

use Healthy360\Catalogues\Models\CatalogueItem;
use Healthy360\Recipes\Models\RecipeVersion;
use Healthy360\Recipes\Services\RecipeNutritionService;

/**
 * What one sold unit of a catalogue item contains, computed on read.
 *
 * **Three steps, in order of authority**, each returning or falling through to
 * the next:
 *
 * 1. **The item's own `nutrition_facts`.** A kitchen-recorded declaration or a
 *    laboratory analysis, and it is returned **unchanged, untouched and not
 *    re-encoded** — not rescaled, not re-rounded, not reshaped. Somebody
 *    measured this dish; a derivation is a calculation *about* a dish, and the
 *    measurement wins. Returning the stored array verbatim is also what keeps
 *    an integer an integer all the way to the wire, which the marketplace read
 *    tests assert on literally (`value === 500`, `grams === 340`): a payload
 *    that took a trip through the scaler would come back as `500.0`.
 * 2. **The published recipe version's snapshot, divided down.** `recipe_versions
 *    .nutrition_facts` holds the per-recipe figures at six places, refreshed
 *    whenever an input moves. One sold unit is **one yield piece × the item's
 *    portion factor**, which is the same definition `MealExplosion` consumes
 *    stock by — one arithmetic, so what a customer is told and what the kitchen
 *    deducts cannot describe different portions.
 * 3. **Null.** No linked published version, no snapshot on it, or no piece
 *    count to divide by.
 *
 * The piece-count refusal is `MealExplosion::explode()`'s, word for word and for
 * its reason: without a divisor there is no "per sold unit", and a null piece
 * count means "the kitchen has not stated one", never "assume one". A
 * batch of forty portions labelled as a single serving is not a smaller error
 * than no label at all.
 *
 * **Nothing is stored**, which is {@see DerivedAllergenService}'s rule and this
 * class is its sibling: a copy on `catalogue_items` would go stale the moment
 * an ingredient's reference facts changed, and the version-level snapshot
 * already has `RecomputeRecipeDerivations` keeping it honest.
 */
final readonly class DerivedNutritionService
{
    /**
     * What the envelope's `calculation.method` says this figure is: the whole
     * recipe divided by the pieces it yields, times the fraction of a piece
     * this listing sells.
     */
    public const string METHOD_PER_SOLD_UNIT = 'catalogue.nutrition.per_sold_unit';

    public function __construct(
        private DerivedAllergenService $allergens,
        private RecipeNutritionService $nutrition,
    ) {}

    /**
     * The per-serving envelope for one sold unit, or null when nothing can say.
     *
     * @return array<string, mixed>|null
     */
    public function forItem(CatalogueItem $item): ?array
    {
        if ($item->nutrition_facts !== null) {
            return $item->nutrition_facts;
        }

        $version = $this->allergens->publishedVersion($item);

        if (! $version instanceof RecipeVersion) {
            return null;
        }

        $facts = $version->nutrition_facts;

        if ($facts === null) {
            return null;
        }

        $pieces = $version->yield_piece_count;

        if ($pieces === null || $pieces <= 0) {
            return null;
        }

        $scaled = $this->nutrition->scale(
            $facts,
            bcdiv((string) $item->portion_factor, (string) $pieces, RecipeNutritionService::WORKING_SCALE),
            'per_serving',
            self::METHOD_PER_SOLD_UNIT,
            null,
            RecipeNutritionService::TRANSPORT_SCALE,
        );

        $scaled['serving'] = [
            // Empty, never "1 portion": the client's own `UNSTATED_SERVING`
            // rule (`packages/api-client/src/api/marketplace-mappers.ts`). A
            // screen printing this shows nothing rather than a phrase the
            // kitchen never wrote.
            'label' => '',
            'quantity' => 1,

            // In the `MarketplaceServing` unit enum. Every row on this surface
            // is sold as one portion by construction; what that portion weighs
            // is the part that had to be computed.
            'unit' => 'portion',

            // The scaled `total_grams` itself rather than a second
            // multiplication: on a per-serving envelope those *are* the same
            // figure — the finished mass this listing sells — and computing it
            // twice is how two roundings of one number end up disagreeing.
            'grams' => $scaled['total_grams'],
            'millilitres' => null,
            'household_measure' => null,
        ];

        return $scaled;
    }
}
