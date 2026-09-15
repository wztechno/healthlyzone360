<?php

declare(strict_types=1);

namespace Healthy360\Kitchens\Import\Runtime;

use Healthy360\Ingredients\Models\Ingredient;
use Healthy360\Recipes\Models\RecipeVersion;
use Healthy360\Recipes\Models\RecipeVersionOutput;

/**
 * A sheet that makes an ingredient gets an outputs row, so that a version
 * consuming it is traceably fed by the version that makes it (master plan
 * v2 §4.2).
 *
 * **Decided from the data, not from a list.** An intermediate is exactly
 * "an ingredient that appears in some version's outputs" — that is the
 * whole reason `recipe_version_outputs` replaced `produced_by_recipe_id` —
 * so the rule here is the mirror of it: if the sheet's own designation
 * resolves to one of this kitchen's ingredients, that version produces it.
 * Pesto Mix, Cordon Bleu Marination and Sour Cream come out of the real
 * workbook this way, and nothing had to be enumerated for them to.
 *
 * The intermediates that have **no sheet** — Mix Cheese Preparation,
 * Butter Mix — never reach here, because no version is named after them.
 * They get a known-gaps entry instead. An output row pointing at a
 * fabricated recipe is precisely the risk the outputs table was introduced
 * to avoid.
 *
 * **A sheet that states no yield still produces its output, at the mass it
 * consumed.** Chicken Breast Marination is the real case: its sheet names
 * one of the kitchen's own ingredients and leaves Quantity Produced empty,
 * and refusing an output for it left the whole marination chain
 * unreachable from the versions that eat it. So the input sum the same
 * sheet states becomes the output quantity, in kilograms, with the
 * {@see self::FROM_INPUT_MASS} finding saying so. That is not a fabricated
 * number — it is the sheet's own arithmetic under the assumption the sheet
 * itself makes by not mentioning a loss. The alternative, a yield of nothing,
 * is the one claim the document definitely does not make. A sheet with neither
 * figure is still refused.
 *
 * **Two callers, one rule.** `TechnicalSheetWriter` applies it to each sheet it
 * writes; `kitchen:relink-recipe-lines` applies it to the versions an earlier
 * import already wrote. That second caller exists because the writer skips an
 * existing version wholesale, so a correction to this rule never reaches the
 * rows a previous run made — which is exactly what happened to the yield-less
 * case above, decided after the kitchen had already been imported. Keeping the
 * decision in one place is what stops the maintenance command and the importer
 * disagreeing the first time either is corrected again.
 */
final readonly class RecipeOutputRule
{
    /** The sheet states no yield, so the output is the mass its own lines sum to. */
    public const string FROM_INPUT_MASS = 'intermediate_output_from_input_mass';

    /** The sheet produces an ingredient but states no amount at all. */
    public const string NOT_WRITTEN = 'intermediate_output_not_written';

    private function __construct(
        private string $recipeVersionId,
        private string $organisationId,
        public ?string $ingredientId,
        public ?string $quantity,
        public ?string $unitId,
        public ?string $findingCode,
        public ?string $findingDetail,
    ) {}

    /**
     * What this version produces, if anything — read from the version and the
     * designation its sheet carries, writing nothing.
     */
    public static function for(DesignationResolver $resolver, RecipeVersion $version, string $designation, string $organisationId): self
    {
        $nothing = fn (?string $code = null, ?string $detail = null): self => new self(
            (string) $version->getKey(),
            $organisationId,
            null,
            null,
            null,
            $code,
            $detail,
        );

        $ingredientId = $resolver->resolve($designation);

        if ($ingredientId === null) {
            // The overwhelmingly common case: a sheet makes a dish, and a dish
            // is not an ingredient of anything.
            return $nothing();
        }

        // **Tenant rows only.** An intermediate is something *this kitchen*
        // makes and then uses — Pesto Mix goes into Pesto Mayo. A platform
        // library row is a generic foodstuff the library defines for everybody,
        // and claiming that one kitchen's version produces it would be a much
        // larger statement than the sheet makes: several sheets share a name
        // with a library entry without being the thing that defines it.
        $owner = Ingredient::withoutTenancy()->whereKey($ingredientId)->value('organisation_id');

        if ($owner !== $organisationId) {
            return $nothing();
        }

        // The sheet's own line sum, already on the version: `input_quantity_total`
        // is assigned from `totals.input_quantity` before the lines are written.
        $fromInputMass = $version->yield_quantity === null;
        $quantity = $fromInputMass ? $version->input_quantity_total : $version->yield_quantity;
        $unitId = $fromInputMass ? UnitMap::idForCode('kg') : ($version->yield_unit_id ?? UnitMap::idForCode('kg'));

        if ($quantity === null || ! is_numeric($quantity) || bccomp($quantity, '0', 4) !== 1) {
            return $nothing(self::NOT_WRITTEN, sprintf(
                '"%s" names one of this kitchen\'s own ingredients, so the sheet produces it — but the sheet '
                .'states neither a yield quantity nor an input total, so there is no amount to record. No '
                .'outputs row was written.',
                $designation,
            ));
        }

        return new self(
            (string) $version->getKey(),
            $organisationId,
            $ingredientId,
            $quantity,
            $unitId,
            $fromInputMass ? self::FROM_INPUT_MASS : null,
            $fromInputMass ? sprintf(
                '"%s" states no yield, so the output is the input mass: %s kg, the sum of the sheet\'s own '
                .'lines. A sheet that records no loss claims none.',
                $designation,
                $quantity,
            ) : null,
        );
    }

    public function writesOutput(): bool
    {
        return $this->ingredientId !== null;
    }

    /**
     * The row itself. Always primary: a sheet produces the thing it is named
     * after, and no source in this import states a second output.
     */
    public function write(): void
    {
        if ($this->ingredientId === null || $this->quantity === null) {
            return;
        }

        $output = new RecipeVersionOutput;
        $output->recipe_version_id = $this->recipeVersionId;
        $output->organisation_id = $this->organisationId;
        $output->ingredient_id = $this->ingredientId;
        $output->output_quantity = $this->quantity;
        $output->unit_id = (string) $this->unitId;
        $output->is_primary = true;
        $output->save();
    }
}
