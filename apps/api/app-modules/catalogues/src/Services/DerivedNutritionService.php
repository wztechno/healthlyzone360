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
 * 3. **The same snapshot per 100 g.** A version that states a finished mass but
 *    no piece count — a bottled sauce, a dressing, anything sold by weight —
 *    has no portion to divide into, and per 100 g is what the back of a bottle
 *    prints. See {@see perHundredGrams()}.
 * 4. **Null.** No linked published version, no snapshot on it, or no mass on
 *    that snapshot to re-base onto.
 *
 * A piece count is never invented. Where one is stated it wins outright, for
 * `MealExplosion::explode()`'s reason: a null piece count means "the kitchen has
 * not stated one", never "assume one", and a batch of forty portions labelled as
 * a single serving is not a smaller error than no label at all. What changed is
 * only what its absence falls through *to* — a figure on a second, plainly
 * labelled basis rather than silence about figures already computed.
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

    /**
     * What the envelope's `calculation.method` says the fallback figure is: the
     * whole recipe re-expressed on a hundred grams of itself.
     */
    public const string METHOD_PER_100G = 'catalogue.nutrition.per_100g';

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
            return $this->perHundredGrams($facts);
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

    /**
     * The snapshot re-expressed per 100 g, or null when its mass is unknown.
     *
     * A bottled sauce or a dressing states what the bottle holds and never how
     * many pieces it is, because it is not sold in pieces. There is no portion
     * to divide into, so "per sold unit" has no answer for it — but per 100 g
     * does, it is the honest figure for a thing sold by weight, and it is the
     * comparison basis a printed label uses. Refusing here would leave a whole
     * shelf silent about figures the kitchen has already computed.
     *
     * `serving` stays null, because there still is not one. The basis is what
     * the client reads to decide between a serving panel and a single per-100 g
     * view; a `serving` invented to fill the field would be the same fabrication
     * the piece-count refusal exists to prevent.
     *
     * `total_grams` comes out as 100 by construction — the envelope says on its
     * face what its amounts are a hundred grams of — and every amount is scaled
     * by the same factor, so the basis and the numbers cannot drift apart.
     *
     * @param  array<string, mixed>  $facts
     * @return array<string, mixed>|null
     */
    private function perHundredGrams(array $facts): ?array
    {
        $totalGrams = $this->nutrition->decimalString($facts['total_grams'] ?? null);

        // No mass, or a mass of zero: nothing to divide a hundred grams by, and
        // this is where the refusal moves to rather than disappearing.
        if ($totalGrams === null || bccomp($totalGrams, '0', RecipeNutritionService::WORKING_SCALE) <= 0) {
            return null;
        }

        return $this->nutrition->scale(
            $facts,
            bcdiv('100', $totalGrams, RecipeNutritionService::WORKING_SCALE),
            'per_100g',
            self::METHOD_PER_100G,
            null,
            RecipeNutritionService::TRANSPORT_SCALE,
        );
    }
}
