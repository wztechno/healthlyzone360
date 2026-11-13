<?php

declare(strict_types=1);

namespace Healthy360\Recipes\Services;

use Healthy360\Audit\Enums\PurposeOfUse;
use Healthy360\Audit\Services\AuditRecorder;
use Healthy360\Recipes\Enums\CostBasis;
use Healthy360\Recipes\Exceptions\MixedCostCurrency;
use Healthy360\Recipes\Http\Controllers\RecipeTechnicalSheetController;
use Healthy360\Recipes\Http\Controllers\RecipeVersionShowController;
use Healthy360\Recipes\Models\RecipeCostSnapshot;
use Healthy360\Recipes\Models\RecipeVersion;
use Healthy360\Recipes\Models\RecipeVersionAllergen;
use Healthy360\Recipes\Models\RecipeVersionLine;
use Healthy360\Recipes\Models\RecipeVersionOutput;
use Healthy360\Recipes\Models\RecipeVersionPackaging;
use Healthy360\Recipes\Models\RecipeVersionStep;
use Healthy360\Recipes\Presenters\RecipeVersionPresenter;
use Healthy360\Recipes\Presenters\TechnicalSheetPresenter;
use Healthy360\Support\Enums\DataClassification;
use Healthy360\Tenancy\TenantContext;

/**
 * The two whole-version reads — the version itself and its technical sheet — built once, so the
 * single-version routes and the batch sheet read answer the identical body.
 *
 * {@see RecipeVersionShowController} and {@see RecipeTechnicalSheetController} carry the reasoning
 * behind each shape; this class only holds the code.
 */
final readonly class RecipeVersionReads
{
    public function __construct(
        private RecipeVersionPresenter $versions,
        private TechnicalSheetPresenter $sheets,
        private RecipeCostingService $costing,
        private WeeklyRecipeCostingService $weeklyCosting,
        private AuditRecorder $audit,
        private TenantContext $context,
    ) {}

    /**
     * Header, lines, packaging, outputs, steps and allergens. `$withIngredientNames` adds
     * `ingredient_name_en` / `ingredient_name_ar` to each line, for a reader printing the sheet
     * without the ingredient catalogue in hand.
     *
     * @return array<string, mixed>
     */
    public function show(RecipeVersion $record, bool $withIngredientNames = false): array
    {
        $lines = RecipeVersionLine::query()->where('recipe_version_id', $record->getKey())->orderBy('line_number')->get();
        $outputs = RecipeVersionOutput::query()->where('recipe_version_id', $record->getKey())->orderByDesc('is_primary')->orderBy('id')->get();
        $steps = RecipeVersionStep::query()->where('recipe_version_id', $record->getKey())->orderBy('step_number')->get();
        $packaging = RecipeVersionPackaging::query()->where('recipe_version_id', $record->getKey())->orderBy('line_number')->get();
        $allergens = RecipeVersionAllergen::query()->where('recipe_version_id', $record->getKey())->orderBy('allergen_code')->get();

        if ($withIngredientNames) {
            $lines->load('ingredient');
        }

        return [
            'version' => $this->versions->version($record),
            'lines' => $lines->map(fn (RecipeVersionLine $line): array => $withIngredientNames
                ? $this->versions->line($line) + [
                    'ingredient_name_en' => $line->ingredient?->name_en,
                    'ingredient_name_ar' => $line->ingredient?->name_ar,
                ]
                : $this->versions->line($line))->all(),
            'packaging' => $packaging->map(fn (RecipeVersionPackaging $row): array => $this->versions->packaging($row))->all(),
            'outputs' => $outputs->map(fn (RecipeVersionOutput $output): array => $this->versions->output($output))->all(),
            'steps' => $steps->map(fn (RecipeVersionStep $step): array => $this->versions->step($step))->all(),
            'allergens' => $allergens->map(fn (RecipeVersionAllergen $row): array => $this->versions->allergen($row))->all(),
        ];
    }

    /**
     * The costed sheet, and the `catalogue.technical_sheet_viewed` access event its read writes.
     * The caller has already established the reader may see costs.
     *
     * @return array<string, mixed>
     */
    public function technicalSheet(RecipeVersion $record): array
    {
        $lines = RecipeVersionLine::query()
            ->where('recipe_version_id', $record->getKey())
            ->orderBy('line_number')
            ->get();

        $packaging = RecipeVersionPackaging::query()
            ->where('recipe_version_id', $record->getKey())
            ->orderBy('line_number')
            ->get();

        $uncosted = $this->costing->uncostedLineNumbers($lines);
        $currencies = $this->costing->currenciesOf($lines);

        // A formulation in two currencies drops the live block and keeps the rest of the sheet,
        // which is what a person needs in order to see the problem.
        try {
            $production = $this->costing->computeRecalculated($record, $lines);
            $packagingCost = $this->costing->computePackaging($record, $packaging);

            $computed = $this->sheets->computed(
                $production,
                $packagingCost,
                $this->costing->totalCostPerYieldUnit($production, $packagingCost),
                $this->costing->costPerPackage($record, $production, $packagingCost, $packaging),
                $this->costing->lineCostsOf($lines),
                $this->costing->lineCostsOf($packaging),
            );
        } catch (MixedCostCurrency) {
            $computed = null;
        }

        $weekly = $this->sheets->weekly(
            $this->weeklyCosting->cost($this->context->organisationId(), $record, $lines, $packaging),
        );

        $snapshots = [];

        foreach (CostBasis::cases() as $basis) {
            $snapshot = RecipeCostSnapshot::latestFor((string) $record->getKey(), $basis);

            $snapshots[$basis->value] = $snapshot instanceof RecipeCostSnapshot
                ? $this->sheets->snapshot($snapshot)
                : null;
        }

        $this->audit->recordAccess(
            'catalogue.technical_sheet_viewed',
            PurposeOfUse::OrganisationAdministration,
            DataClassification::Confidential,
            actorUserId: $this->context->userId(),
            subjectType: 'recipe_version',
            subjectId: (string) $record->getKey(),

            // Identifiers and counts only. An audit row is readable with
            // `audit.view_organisation`, which is not the cost permission, so
            // a single amount here would route around the whole split.
            metadata: [
                'recipe_id' => $record->recipe_id,
                'version_number' => $record->version_number,
                'line_count' => $lines->count(),
                'packaging_line_count' => $packaging->count(),
                'uncosted_line_count' => count($uncosted),
            ],
        );

        return [
            'version' => $this->versions->version($record),
            'completeness' => $record->completeness->value,

            // The one currency the costed lines share, or null when nothing is
            // costed *or* when an import left more than one behind. The flag
            // beside it says which of those two it is, because "no currency"
            // and "several currencies" need different fixes.
            'currency_code' => count($currencies) === 1 ? $currencies[0] : null,
            'currency_conflict' => count($currencies) > 1,
            'lines' => $lines->map(fn (RecipeVersionLine $line): array => $this->sheets->line($line))->all(),
            'packaging_lines' => $packaging->map(
                fn (RecipeVersionPackaging $row): array => $this->sheets->packagingLine($row),
            )->all(),
            'uncosted_line_numbers' => $uncosted,
            'snapshots' => $snapshots,

            // Null only when the formulation carries two currencies, which the
            // `currency_conflict` flag above already reports.
            'computed' => $computed,

            // Beside `computed`, never instead of it: what the sheet was costed
            // at against what the same formulation costs at this week's prices.
            'weekly' => $weekly,
        ];
    }
}
