<?php

declare(strict_types=1);

namespace Healthy360\Kitchens\Import\Runtime;

use Healthy360\Ingredients\Models\Ingredient;
use Healthy360\Recipes\Enums\CostBasis;
use Healthy360\Recipes\Enums\DerivationState;
use Healthy360\Recipes\Enums\RecipeCompleteness;
use Healthy360\Recipes\Enums\RecipeConfidentiality;
use Healthy360\Recipes\Enums\RecipeStatus;
use Healthy360\Recipes\Enums\RecipeVersionStatus;
use Healthy360\Recipes\Models\Recipe;
use Healthy360\Recipes\Models\RecipeVersion;
use Healthy360\Recipes\Models\RecipeVersionLine;
use Healthy360\Recipes\Models\RecipeVersionOutput;
use Healthy360\Recipes\Services\CostComputation;
use Healthy360\Recipes\Services\RecipeCostingService;
use Illuminate\Support\Str;

/**
 * The 29 confidential technical sheets: one recipe per designation, one draft
 * version per sheet, one `as_recorded` cost snapshot per version.
 *
 * **Everything lands as a draft, and nothing is published.** An imported
 * formulation has never been through a publish gate: its ingredients carry no
 * allergen mapping, so `RecipeVersionService::publish()` would refuse it
 * anyway, and a version that appeared published because an importer said so
 * would be a frozen allergen label nobody derived. Publication stays a human
 * act with an audit trail.
 *
 * **The duplicate Caesar Sauce is one recipe with two versions** (appendix D).
 * Sheets 1 and 25 both say "Caesar Sauce" and disagree about the formulation —
 * different lines, different yields, different totals. They are versions of the
 * same product, and the workbook does not say which is current, so both are
 * drafts and neither is published. Merging them would destroy evidence;
 * creating two recipes would claim the kitchen sells two Caesar sauces.
 *
 * **Line totals are written verbatim.** `unit_cost_amount` and
 * `line_cost_amount` both come off the sheet even where the sheet's own
 * arithmetic is wrong — sheet 25 costs 0.08 kg of Dijon mustard at $6 and
 * writes $0.45. The mismatch is a finding in the report; it is not a correction
 * in the data. A source document that adds up wrong is evidence, and evidence
 * that has been silently fixed is no longer evidence. (The management API takes
 * the opposite view and derives the line total, because there the caller is a
 * person typing now, not a document from last spring.)
 *
 * **An unresolved designation costs its line, not the sheet.** The line is
 * excluded, the failure is reported by designation with its sheet, and the
 * sheet is flagged incomplete. No ingredient is fabricated and no file is
 * abandoned — the §4.11 report-and-continue deviation, stated in
 * `DesignationResolver`.
 */
final readonly class TechnicalSheetWriter
{
    public function __construct(
        private DesignationResolver $resolver,
        private RecipeCostingService $costing,
        private string $sourceSystem,
        private string $sourceFile = SourceManifest::RECIPES,
    ) {}

    /**
     * @param  array{sheets: list<array<string, mixed>>, findings: list<array{code: string, detail: string}>}  $parsed
     */
    public function write(array $parsed, string $organisationId, ImportReport $report): void
    {
        $report->findings($parsed['findings'], $this->sourceFile);

        /** @var array<string, Recipe> $recipes designation → recipe */
        $recipes = [];

        foreach ($parsed['sheets'] as $sheet) {
            $this->writeSheet($sheet, $organisationId, $recipes, $report);
        }
    }

    /**
     * @param  array<string, mixed>  $sheet
     * @param  array<string, Recipe>  $recipes
     */
    private function writeSheet(array $sheet, string $organisationId, array &$recipes, ImportReport $report): void
    {
        /** @var int $index */
        $index = $sheet['sheet_index'];
        /** @var string $designation */
        $designation = $sheet['designation'];
        $sheetRef = $this->sourceFile.'#Sheet'.$index;

        /** @var list<array{code: string, detail: string}> $sheetFindings */
        $sheetFindings = $sheet['findings'];
        $report->findings($sheetFindings, $sheetRef);

        $recipe = $recipes[mb_strtolower($designation)] ?? $this->recipe($designation, $organisationId, $report);
        $recipes[mb_strtolower($designation)] = $recipe;

        $existing = RecipeVersion::withoutTenancy()
            ->where('organisation_id', $organisationId)
            ->where('source_system', $this->sourceSystem)
            ->where('source_ref', $sheetRef)
            ->first();

        if ($existing instanceof RecipeVersion) {
            // The version is the unit of idempotency: its lines, outputs and
            // snapshot carry no source reference of their own, so re-reading
            // the sheet and rewriting them would be exactly the operator-edit
            // clobbering insert-if-absent exists to prevent. The lines are
            // counted as skipped so the report says how much was protected
            // rather than only that one version was.
            $report->skipped('recipe_version');
            $report->skipped('recipe_version_line', RecipeVersionLine::withoutTenancy()
                ->where('recipe_version_id', $existing->getKey())
                ->count());

            return;
        }

        /** @var array{raw: ?string, label: ?string, shape: string, quantity: ?string, unit: ?string, piece_count: ?int} $yield */
        $yield = $sheet['yield'];
        /** @var array{input_quantity: ?string, input_total: ?string} $totals */
        $totals = $sheet['totals'];
        /** @var list<array<string, mixed>> $rawLines */
        $rawLines = $sheet['lines'];

        $lines = $this->resolveLines($rawLines, $sheetRef, $report);

        $report->created('recipe_version');

        $version = new RecipeVersion;
        $version->recipe_id = (string) $recipe->getKey();
        $version->organisation_id = $organisationId;
        $version->version_number = $this->nextVersionNumber($recipe);
        $version->status = RecipeVersionStatus::Draft;
        $version->completeness = $lines === [] ? RecipeCompleteness::Indicative : RecipeCompleteness::Costed;
        $version->yield_quantity = $yield['quantity'];
        $version->yield_unit_id = $yield['quantity'] === null ? null : UnitMap::idForCode($yield['unit'] ?? 'kg');
        $version->yield_piece_count = $yield['piece_count'];
        $version->input_quantity_total = $totals['input_quantity'];
        $version->waste_coefficient_percent = $this->wastePercent($sheet);
        $version->derivation_state = DerivationState::Stale;
        $version->notes = $this->notes($sheet);
        $version->source_system = $this->sourceSystem;
        $version->source_ref = $sheetRef;
        $version->seeded_at = now();
        $version->lock_version = 0;
        $version->save();

        foreach ($lines as $number => $line) {
            $row = new RecipeVersionLine;
            $row->recipe_version_id = (string) $version->getKey();
            $row->organisation_id = $organisationId;
            $row->line_number = $number + 1;
            $row->ingredient_id = $line['ingredient_id'];
            $row->quantity = $line['quantity'];
            $row->unit_id = $line['unit_id'];
            $row->unit_cost_amount = $line['unit_price'];
            $row->line_cost_amount = $line['line_total'];
            $row->cost_currency_code = $line['unit_price'] === null ? null : KitchenWorkbookWorld::CURRENCY;
            $row->source_designation = $line['designation'];
            $row->comment = $line['comment'];
            $row->save();

            $report->created('recipe_version_line');
        }

        $this->reportYieldAgainstInput($version, $sheetRef, $report);
        $this->writeOutput($version, $designation, $organisationId, $report);
        $this->writeSnapshot($version, $sheet, $report);
    }

    /**
     * A yield larger than the inputs that made it.
     *
     * **Shrinkage is not flagged.** A sheet that puts 2.56 kg of ingredients in
     * and gets 1.7 kg out is a grilled pepper losing water, and the workbook
     * says so in its own margin note. That is the expected case and flagging it
     * would produce twenty-odd findings a reviewer learns to scroll past.
     *
     * The other direction is not a process, it is an error — matter is not
     * created in a kitchen — and it is how the ambiguous bare-integer yields
     * give themselves away: one sheet claims to produce 80 units of something
     * from 47.17 kg of input while labelling the result a per-kilogram cost.
     */
    private function reportYieldAgainstInput(RecipeVersion $version, string $sheetRef, ImportReport $report): void
    {
        $yield = $version->yield_quantity;
        $input = $version->input_quantity_total;

        if ($yield === null || $input === null || ! is_numeric($yield) || ! is_numeric($input)) {
            return;
        }

        if (bccomp($yield, $input, 4) !== 1) {
            return;
        }

        $report->finding(
            'yield_exceeds_input',
            sprintf(
                '%s states a yield of %s against an input total of %s. A kitchen does not create matter, so either '
                .'the yield is in different units from the inputs or one of the two figures is wrong.',
                $sheetRef,
                (string) $yield,
                (string) $input,
            ),
            $sheetRef,
        );
    }

    /**
     * The recipe a sheet belongs to, created once per designation.
     */
    private function recipe(string $designation, string $organisationId, ImportReport $report): Recipe
    {
        $sourceRef = $this->sourceFile.'#'.Str::slug($designation);

        $existing = Recipe::withoutTenancy()
            ->where('organisation_id', $organisationId)
            ->where('source_system', $this->sourceSystem)
            ->where('source_ref', $sourceRef)
            ->first();

        if ($existing instanceof Recipe) {
            $report->skipped('recipe');

            return $existing;
        }

        $report->created('recipe');

        $recipe = new Recipe;
        $recipe->organisation_id = $organisationId;
        $recipe->branch_id = null;
        $recipe->slug = Str::slug($designation);
        $recipe->name_en = $designation;
        $recipe->name_ar = $designation;
        $recipe->recipe_category = null;
        $recipe->source_kind = 'technical_sheet';

        // Confidential without exception. The sheets carry the sentence "Those
        // informations are private and it's restricted to share it with the
        // outside" on every page, and this column is where that instruction
        // becomes enforceable.
        $recipe->confidentiality = RecipeConfidentiality::Confidential;
        $recipe->status = RecipeStatus::Active;
        $recipe->source_system = $this->sourceSystem;
        $recipe->source_ref = $sourceRef;
        $recipe->seeded_at = now();
        $recipe->lock_version = 0;
        $recipe->save();

        return $recipe;
    }

    /**
     * Resolve every line's designation, dropping the ones the curated
     * dictionary does not cover.
     *
     * @param  list<array<string, mixed>>  $rawLines
     * @return list<array{designation: string, ingredient_id: string, quantity: string|null, unit_id: string|null, unit_price: string|null, line_total: string|null, comment: string|null}>
     */
    private function resolveLines(array $rawLines, string $sheetRef, ImportReport $report): array
    {
        $resolved = [];

        foreach ($rawLines as $line) {
            /** @var string $designation */
            $designation = $line['designation'];
            $ingredientId = $this->resolver->resolve($designation);

            if ($ingredientId === null) {
                $report->failed('recipe_version_line');
                $report->unresolvedDesignation(
                    $designation,
                    $sheetRef.'/row-'.$line['row'],
                    'line excluded from the imported version; the sheet is flagged incomplete',
                );
                $report->incompleteSheet($sheetRef, sprintf('row %s — "%s"', $line['row'], $designation));

                continue;
            }

            /** @var string|null $unit */
            $unit = $line['unit'] ?? null;
            $unitId = UnitMap::idFor($unit);

            if ($unit !== null && $unitId === null) {
                $report->finding(
                    'unit_unmapped',
                    sprintf('Line %s of %s uses the unit "%s", which is not one the platform knows. The quantity is kept and the unit is left blank.', $line['row'], $sheetRef, $unit),
                    $sheetRef,
                );
            }

            /** @var string|null $comment */
            $comment = $line['comment'] ?? null;

            $quantity = $this->stringOrNull($line['quantity'] ?? null);

            // A quantity of zero is not a quantity, and the column's CHECK says
            // so. The sheet still wrote something — sheet 25 records 0.00 kg of
            // black pepper and then charges 0.03 for it — so the line is kept
            // with its price and its stated total as evidence, the amount is
            // NULL rather than a fabricated fraction, and the publish gate's
            // `line_quantity_missing` refusal is what stops the version being
            // published on a formulation nobody can reproduce.
            if ($quantity !== null && bccomp($quantity, '0', 6) !== 1) {
                $report->finding(
                    'line_quantity_not_positive',
                    sprintf(
                        'Line %s of %s ("%s") states a quantity of %s. Zero is not a quantity, so the amount is '
                        .'recorded as unknown; the unit price and the stated line total are kept as written.',
                        $line['row'],
                        $sheetRef,
                        $designation,
                        $quantity,
                    ),
                    $sheetRef,
                );

                $quantity = null;
            }

            $resolved[] = [
                'designation' => $designation,
                'ingredient_id' => $ingredientId,
                'quantity' => $quantity,
                'unit_id' => $unitId,
                'unit_price' => $this->stringOrNull($line['unit_price'] ?? null),
                'line_total' => $this->stringOrNull($line['line_total'] ?? null),
                'comment' => $comment === null || trim($comment) === '' ? null : mb_substr(trim($comment), 0, 255),
            ];
        }

        return $resolved;
    }

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
     * The intermediates that have **no sheet** — Chicken Breast Marination,
     * Mix Cheese Preparation, Butter Mix — reach here at all, because no
     * version is named after them. They get a known-gaps entry instead. An
     * output row pointing at a fabricated recipe is precisely the risk the
     * outputs table was introduced to avoid.
     */
    private function writeOutput(RecipeVersion $version, string $designation, string $organisationId, ImportReport $report): void
    {
        $ingredientId = $this->resolver->resolve($designation);

        if ($ingredientId === null) {
            // The overwhelmingly common case: a sheet makes a dish, and a dish
            // is not an ingredient of anything.
            return;
        }

        // **Tenant rows only.** An intermediate is something *this kitchen*
        // makes and then uses — Pesto Mix goes into Pesto Mayo. A platform
        // library row is a generic foodstuff the library defines for everybody,
        // and claiming that one kitchen's version produces it would be a much
        // larger statement than the sheet makes: several sheets share a name
        // with a library entry without being the thing that defines it.
        $owner = Ingredient::withoutTenancy()->whereKey($ingredientId)->value('organisation_id');

        if ($owner !== $organisationId) {
            return;
        }

        if ($version->yield_quantity === null) {
            $report->finding(
                'intermediate_output_not_written',
                sprintf(
                    '"%s" names one of this kitchen\'s own ingredients, so the sheet produces it — but the sheet '
                    .'states no yield quantity, so there is no amount to record. No outputs row was written.',
                    $designation,
                ),
                (string) $version->source_ref,
            );

            return;
        }

        $output = new RecipeVersionOutput;
        $output->recipe_version_id = (string) $version->getKey();
        $output->organisation_id = $organisationId;
        $output->ingredient_id = $ingredientId;
        $output->output_quantity = $version->yield_quantity;
        $output->unit_id = $version->yield_unit_id ?? (string) UnitMap::idForCode('kg');
        $output->is_primary = true;
        $output->save();

        $report->created('recipe_version_output');
    }

    /**
     * The sheet's own cost block, recorded as an `as_recorded` snapshot.
     *
     * Not a recalculation. The figures are the sheet's, including the rounding
     * it did and the per-unit basis it claims; what this system contributes is
     * `basis_mismatch`, which says whether the claim can be true given the yield
     * the same sheet states. Five sheets label a per-piece cost over a yield
     * with no piece count in it, and that flag is the only place a reviewer will
     * ever see it.
     *
     * @param  array<string, mixed>  $sheet
     */
    private function writeSnapshot(RecipeVersion $version, array $sheet, ImportReport $report): void
    {
        /** @var list<array{label: string, amount: string|null}> $labels */
        $labels = $sheet['cost_labels'];

        $total = $this->labelAmount($labels, static fn (string $label): bool => str_contains(mb_strtolower($label), 'total production cost'));

        if ($total === null) {
            $report->finding(
                'cost_block_absent',
                sprintf('%s states no total production cost, so no as-recorded snapshot was written.', (string) $version->source_ref),
                (string) $version->source_ref,
            );

            return;
        }

        // What the sheet *claims*. A sheet may claim both — the `130 (7 kg)`
        // shape does, and its cost block carries a per-piece row and a per-kilo
        // row with a waste row after each.
        $claimedPiece = $this->claimedAmount($labels, piece: true);
        $claimedMass = $this->claimedAmount($labels, piece: false);

        // What the *version* can support. This is the appendix D rule and the
        // reason `basis_mismatch` exists at all: a per-piece cost is only a
        // per-piece cost if there is a piece count to have divided by, and a
        // per-kilo cost needs a measured yield in a unit. Four sheets label a
        // per-piece cost over a yield with no piece count in it — the label is
        // kept in `source_label` as evidence, and the *amount* is not stored
        // against a denominator the sheet never provided.
        $supportsPiece = $version->yield_piece_count !== null;
        $supportsMass = $version->yield_quantity !== null && $version->yield_unit_id !== null;

        $perPiece = $supportsPiece ? $claimedPiece : null;
        $perMass = $supportsMass ? $claimedMass : null;

        $mismatch = ($claimedPiece !== null && ! $supportsPiece) || ($claimedMass !== null && ! $supportsMass);
        $perUnit = $this->perUnitLabel($labels);

        $computation = CostComputation::asRecorded(
            currencyCode: KitchenWorkbookWorld::CURRENCY,
            totalInputCostAmount: $total,
            wasteCoefficientPercent: $this->wastePercent($sheet),
            costPerYieldUnitAmount: $perMass,
            yieldUnitId: $perMass === null ? null : $version->yield_unit_id,
            costPerPieceAmount: $perPiece,
            costPerYieldUnitWithWasteAmount: $perMass === null ? null : $this->wasteAmount($labels, false),
            costPerPieceWithWasteAmount: $perPiece === null ? null : $this->wasteAmount($labels, true),
        );

        $this->costing->writeSnapshot(
            $version,
            CostBasis::AsRecorded,
            $computation,
            sourceLabel: $perUnit === null ? null : mb_substr($perUnit['label'], 0, 60),
            basisMismatch: $mismatch,
        );

        $report->created('cost_snapshot');

        if ($mismatch) {
            $report->finding(
                'cost_basis_mismatch',
                sprintf(
                    '%s labels a cost per %s ("%s") while its yield states %s. The label is kept as evidence, the '
                    .'figure is not stored against a denominator the sheet never gave, and the snapshot is flagged.',
                    (string) $version->source_ref,
                    $claimedPiece !== null && ! $supportsPiece ? 'piece' : 'unit of weight',
                    $perUnit['label'] ?? 'unknown',
                    match (true) {
                        $version->yield_piece_count === null && ! $supportsMass => 'no yield at all',
                        $version->yield_piece_count === null => 'a measured yield with no piece count',
                        default => 'a piece count with no measured yield',
                    },
                ),
                (string) $version->source_ref,
            );
        }
    }

    /**
     * The amount on the sheet's per-piece row, or on its per-weight row.
     *
     * @param  list<array{label: string, amount: string|null}>  $labels
     */
    private function claimedAmount(array $labels, bool $piece): ?string
    {
        foreach ($labels as $label) {
            if ($this->isPerUnitLabel($label['label']) && $this->claimsPiece($label['label']) === $piece) {
                return $label['amount'];
            }
        }

        return null;
    }

    /**
     * @param  array<string, mixed>  $sheet
     * @return numeric-string
     */
    private function wastePercent(array $sheet): string
    {
        $waste = $sheet['waste_percent'] ?? null;

        return is_string($waste) && is_numeric($waste) ? $waste : '0';
    }

    /**
     * @param  list<array{label: string, amount: string|null}>  $labels
     */
    private function wasteAmount(array $labels, bool $piece): ?string
    {
        $seenPerUnit = false;

        foreach ($labels as $label) {
            if ($this->isPerUnitLabel($label['label'])) {
                $seenPerUnit = $this->claimsPiece($label['label']) === $piece;

                continue;
            }

            // The waste row always follows the per-unit row it applies to; the
            // sheets carry two of each when they state both bases.
            if ($seenPerUnit && str_contains(mb_strtolower($label['label']), 'waste')) {
                return $label['amount'];
            }
        }

        return null;
    }

    /**
     * @param  list<array{label: string, amount: string|null}>  $labels
     * @return array{label: string, amount: string|null, claims_piece: bool}|null
     */
    private function perUnitLabel(array $labels): ?array
    {
        foreach ($labels as $label) {
            if ($this->isPerUnitLabel($label['label'])) {
                return [
                    'label' => $label['label'],
                    'amount' => $label['amount'],
                    'claims_piece' => $this->claimsPiece($label['label']),
                ];
            }
        }

        return null;
    }

    /**
     * A cost-block row that states a cost **per unit of yield**.
     *
     * Matched on shape rather than on an exact phrase, because the sheets do
     * not agree on one: "1 kg Production Cost", "1 Piece Production Cost" and
     * "Cost of 1 kg" all appear, and one of them puts the noun first. The three
     * exclusions are what keep it honest — the grand total is not a per-unit
     * figure, a waste row is a *derivative* of one, and a row naming neither a
     * mass nor a piece is not making a per-unit claim at all.
     */
    private function isPerUnitLabel(string $label): bool
    {
        $lower = mb_strtolower($label);

        if (! str_contains($lower, 'cost') || str_contains($lower, 'total') || str_contains($lower, 'waste')) {
            return false;
        }

        return $this->claimsPiece($lower)
            || str_contains($lower, 'kg')
            || str_contains($lower, 'kilo');
    }

    private function claimsPiece(string $label): bool
    {
        return str_contains(mb_strtolower($label), 'piece');
    }

    /**
     * @param  list<array{label: string, amount: string|null}>  $labels
     * @param  callable(string): bool  $matches
     */
    private function labelAmount(array $labels, callable $matches): ?string
    {
        foreach ($labels as $label) {
            if ($matches($label['label']) && $label['amount'] !== null) {
                return $label['amount'];
            }
        }

        return null;
    }

    /**
     * @param  array<string, mixed>  $sheet
     */
    private function notes(array $sheet): string
    {
        $kind = $sheet['kind'] ?? null;
        $yield = $sheet['yield']['raw'] ?? null;

        return trim(sprintf(
            'Imported from %s#Sheet%s. Sheet kind: %s. Quantity produced as written: %s.',
            $this->sourceFile,
            $sheet['sheet_index'],
            is_string($kind) && $kind !== '' ? $kind : 'not stated',
            is_string($yield) && $yield !== '' ? $yield : 'not stated',
        ));
    }

    private function nextVersionNumber(Recipe $recipe): int
    {
        return (int) (RecipeVersion::withoutTenancy()
            ->where('recipe_id', $recipe->getKey())
            ->max('version_number') ?? 0) + 1;
    }

    /**
     * A numeric cell as the string bcmath and the decimal columns both take, or
     * null. Anything the source wrote that is not a number is not a number.
     *
     * @return numeric-string|null
     */
    private function stringOrNull(mixed $value): ?string
    {
        return is_string($value) && is_numeric($value) ? $value : null;
    }
}
