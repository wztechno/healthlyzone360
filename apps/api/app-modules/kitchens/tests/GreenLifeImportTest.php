<?php

declare(strict_types=1);

use Database\Seeders\KitchenReferenceSeeder;
use Healthy360\Catalogues\Enums\CatalogueItemStatus;
use Healthy360\Catalogues\Enums\CatalogueItemType;
use Healthy360\Catalogues\Models\CatalogueItem;
use Healthy360\Catalogues\Models\CatalogueItemVariant;
use Healthy360\Catalogues\Models\MealCombinationOption;
use Healthy360\Catalogues\Models\PlanDuration;
use Healthy360\Catalogues\Models\SalesChannel;
use Healthy360\Catalogues\Services\CatalogueItemReadiness;
use Healthy360\Delivery\Models\DeliveryWindow;
use Healthy360\Delivery\Models\DeliveryZone;
use Healthy360\Delivery\Models\DeliveryZoneArea;
use Healthy360\Ingredients\Models\Ingredient;
use Healthy360\Kitchens\Import\Runtime\GreenLifeImport;
use Healthy360\Kitchens\Import\Runtime\GreenLifeWorld;
use Healthy360\Kitchens\Import\Runtime\ImportOptions;
use Healthy360\Kitchens\Import\Runtime\ImportReport;
use Healthy360\Kitchens\Import\Runtime\UnitMap;
use Healthy360\Organisations\Database\Seeders\OrganisationTypeSeeder;
use Healthy360\Organisations\Models\Organisation;
use Healthy360\Organisations\Models\OrganisationBranch;
use Healthy360\Pricing\Enums\PriceStatus;
use Healthy360\Pricing\Models\PriceList;
use Healthy360\Pricing\Models\PriceListItem;
use Healthy360\Recipes\Enums\CostBasis;
use Healthy360\Recipes\Enums\RecipeVersionStatus;
use Healthy360\Recipes\Models\Recipe;
use Healthy360\Recipes\Models\RecipeCostSnapshot;
use Healthy360\Recipes\Models\RecipeVersion;
use Healthy360\Recipes\Models\RecipeVersionAllergen;
use Healthy360\Recipes\Models\RecipeVersionLine;
use Healthy360\Recipes\Models\RecipeVersionOutput;
use Healthy360\ReferenceData\Database\Seeders\ReferenceDataSeeder;
use Healthy360\Tenancy\Database\DatabaseTenantContext;
use Healthy360\Tenancy\TenantContext;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Storage;

/*
|--------------------------------------------------------------------------
| The private GreenLife importer, end to end (K1.8)
|--------------------------------------------------------------------------
|
| Driven by a **synthetic** mini-workbook committed under
| `tests/Fixtures/workbook/`. The real files are confidential and are never in
| this repository (data register, D-046), so the fixture's job is to exercise
| every parser rule and every writer decision with invented products and
| invented numbers — a "Demo Dip Sauce" that costs $1.11.
|
| What is asserted here is the behaviour that would be expensive to discover in
| production: that a second run changes nothing, that an operator's edit
| survives one, that a dry run writes nothing at all, that an imported plan is
| honestly unpublishable, and that the arithmetic on a cost snapshot is the
| sheet's own.
|
*/

beforeEach(function (): void {
    $this->seed([ReferenceDataSeeder::class, KitchenReferenceSeeder::class, OrganisationTypeSeeder::class]);

    UnitMap::forget();

    config()->set('kitchens.import.environments', ['local', 'testing']);

    // A private report directory per test. The importer compares a run's
    // checksums against the most recent report on disk, so a leftover report —
    // from an earlier test, or from a developer's real local import — would
    // silently change what "changed_since_previous" says. Pointing the path at
    // a throwaway directory isolates the comparison and, just as importantly,
    // means the suite never deletes somebody's actual run reports.
    config()->set('kitchens.import.report_path', 'import-reports-test-'.bin2hex(random_bytes(6)));
});

afterEach(function (): void {
    app(TenantContext::class)->clear();
    app(DatabaseTenantContext::class)->reset();

    $directory = (string) config('kitchens.import.report_path');

    if (str_starts_with($directory, 'import-reports-test-')) {
        Storage::disk('local')->deleteDirectory($directory);
    }
});

/**
 * The committed synthetic workbook.
 */
function fixtureWorkbook(): string
{
    return __DIR__.'/Fixtures/workbook';
}

function importOptions(bool $dryRun = false, bool $validateOnly = false): ImportOptions
{
    return new ImportOptions(
        sourceDirectory: fixtureWorkbook(),
        organisationSlug: 'green-life-kitchen',
        dryRun: $dryRun,
        validateOnly: $validateOnly,
    );
}

function runImport(bool $dryRun = false, bool $validateOnly = false): ImportReport
{
    $options = importOptions($dryRun, $validateOnly);
    $report = new ImportReport($options, 'testing');

    app(GreenLifeImport::class)->run($options, $report);

    app(TenantContext::class)->clear();
    app(DatabaseTenantContext::class)->reset();

    return $report;
}

/**
 * Every row this import could have touched, counted without any tenant context
 * in the way.
 *
 * @return array<string, int>
 */
function importedRowCounts(): array
{
    $tables = [
        'organisations', 'organisation_branches', 'sales_channels', 'price_lists', 'catalogues',
        'ingredients', 'ingredient_aliases', 'recipes', 'recipe_versions', 'recipe_version_lines',
        'recipe_version_outputs', 'recipe_version_allergens', 'recipe_cost_snapshots',
        'catalogue_items', 'catalogue_item_variants', 'catalogue_item_pack_variants',
        'catalogue_item_ingredients', 'channel_catalogue_items', 'price_list_items',
        'meal_combination_options', 'energy_bands', 'plan_durations', 'subscription_plan_profiles',
        'plan_variant_profiles', 'plan_variant_durations', 'delivery_zones', 'delivery_zone_areas',
        'delivery_windows',
    ];

    $counts = [];

    foreach ($tables as $table) {
        $counts[$table] = DB::table($table)->count();
    }

    return $counts;
}

function greenLifeOrganisation(): Organisation
{
    return Organisation::query()->where('slug', 'green-life-kitchen')->sole();
}

/**
 * Put the process into the imported kitchen's tenant context — what the
 * importer does for itself and what a test asserting on RLS-protected rows
 * needs afterwards.
 */
function inGreenLifeContext(Closure $work): mixed
{
    $organisationId = (string) greenLifeOrganisation()->getKey();

    app(TenantContext::class)->restore(['organisation_id' => $organisationId]);

    try {
        return $work($organisationId);
    } finally {
        app(TenantContext::class)->clear();
        app(DatabaseTenantContext::class)->reset();
    }
}

it('stands the whole GreenLife world up from the workbook', function (): void {
    $report = runImport();

    $organisation = greenLifeOrganisation();

    expect($organisation->name)->toBe(GreenLifeWorld::ORGANISATION_NAME)
        ->and($organisation->country_code)->toBe('LB')
        ->and($organisation->default_currency_code)->toBe('USD')
        ->and($organisation->default_language_code)->toBe('en');

    inGreenLifeContext(function (string $organisationId): void {
        $branch = OrganisationBranch::query()->where('organisation_id', $organisationId)->sole();

        expect($branch->name)->toBe(GreenLifeWorld::BRANCH_NAME)
            ->and($branch->city)->toBe('Beirut')
            ->and($branch->timezone)->toBe('Asia/Beirut')
            ->and($branch->address)->toBeNull();

        expect(SalesChannel::query()->pluck('code')->sort()->values()->all())
            ->toBe([GreenLifeWorld::CHANNEL_B2C, GreenLifeWorld::CHANNEL_B2B])
            ->and(PriceList::query()->pluck('code')->sort()->values()->all())
            ->toBe([
                GreenLifeWorld::PRICE_LIST_B2B,
                GreenLifeWorld::PRICE_LIST_B2C,
                GreenLifeWorld::PRICE_LIST_PLANS,
            ]);

        // Every tariff lands as a draft: a draft list is not consulted by the
        // price resolver, so nothing imported can reach a customer until a
        // human activates it.
        expect(PriceList::query()->pluck('status')->map->value->unique()->all())->toBe(['draft']);
    });

    expect($report->countOf('organisation', 'created'))->toBe(1)
        ->and($report->countOf('branch', 'created'))->toBe(1)
        ->and($report->countOf('sales_channel', 'created'))->toBe(2)
        ->and($report->countOf('price_list', 'created'))->toBe(3)
        ->and($report->countOf('catalogue', 'created'))->toBe(1);
});

it('creates only the tenant ingredients the curated dictionary declares, unverified and unmapped', function (): void {
    runImport();

    inGreenLifeContext(function (string $organisationId): void {
        $tenantIngredients = Ingredient::withoutTenancy()
            ->where('organisation_id', $organisationId)
            ->get();

        expect($tenantIngredients)->not->toBeEmpty();

        foreach ($tenantIngredients as $ingredient) {
            expect($ingredient->verification_status->value)->toBe('unverified')
                ->and($ingredient->source_system)->toBe('greenlife_phase1')
                ->and($ingredient->availability_tier)->toBeNull()

                // English in the Arabic column, visibly. A machine translation
                // on an allergen label is worse than an obvious fallback.
                ->and($ingredient->name_ar)->toBe($ingredient->name_en);
        }

        // No allergen mapping is invented for any of them: the technical sheets
        // record none, and the allergen-review report is what says so.
        $mapped = DB::table('ingredient_allergens')
            ->where('organisation_id', $organisationId)
            ->count();

        expect($mapped)->toBe(0);
    });
});

it('imports every recipe version as a draft and never publishes one', function (): void {
    runImport();

    inGreenLifeContext(function (string $organisationId): void {
        $versions = RecipeVersion::withoutTenancy()->where('organisation_id', $organisationId)->get();

        expect($versions)->not->toBeEmpty()
            ->and($versions->pluck('status')->unique()->all())->toBe([RecipeVersionStatus::Draft]);

        expect(Recipe::withoutTenancy()->where('organisation_id', $organisationId)->count())->toBeGreaterThan(0);
    });
});

it('keeps a duplicated designation as one recipe with two draft versions', function (): void {
    runImport();

    inGreenLifeContext(function (string $organisationId): void {
        $duplicated = Recipe::withoutTenancy()
            ->where('organisation_id', $organisationId)
            ->get()
            ->first(fn (Recipe $recipe): bool => RecipeVersion::withoutTenancy()
                ->where('recipe_id', $recipe->getKey())
                ->count() > 1);

        expect($duplicated)->not->toBeNull('the fixture workbook must repeat one designation across two sheets');

        $versions = RecipeVersion::withoutTenancy()
            ->where('recipe_id', $duplicated->getKey())
            ->orderBy('version_number')
            ->get();

        expect($versions)->toHaveCount(2)
            ->and($versions->pluck('version_number')->all())->toBe([1, 2])
            ->and($versions->pluck('status')->unique()->all())->toBe([RecipeVersionStatus::Draft]);
    });
});

it('writes line totals verbatim, including the sheet arithmetic that does not add up', function (): void {
    $report = runImport();

    inGreenLifeContext(function (string $organisationId): void {
        $lines = RecipeVersionLine::withoutTenancy()->where('organisation_id', $organisationId)->get();

        expect($lines)->not->toBeEmpty();

        // Every costed line carries the source's own designation and its own
        // currency; nothing was recomputed on the way in.
        foreach ($lines->whereNotNull('unit_cost_amount') as $line) {
            expect($line->cost_currency_code)->toBe('USD')
                ->and($line->source_designation)->not->toBeNull();
        }

        $mismatched = $lines->first(function (RecipeVersionLine $line): bool {
            if ($line->quantity === null || $line->unit_cost_amount === null || $line->line_cost_amount === null) {
                return false;
            }

            return bccomp(
                bcmul((string) $line->quantity, (string) $line->unit_cost_amount, 6),
                (string) $line->line_cost_amount,
                4,
            ) !== 0;
        });

        expect($mismatched)->not->toBeNull('the fixture must contain a line whose stated total disagrees with its own arithmetic');
    });

    $codes = array_column($report->findingsSnapshot(), 'code');

    expect($codes)->toContain('line_total_mismatch');
});

it('records the source sheet cost block as an as_recorded snapshot with its basis flag', function (): void {
    runImport();

    inGreenLifeContext(function (string $organisationId): void {
        $snapshots = RecipeCostSnapshot::withoutTenancy()->where('organisation_id', $organisationId)->get();

        expect($snapshots)->not->toBeEmpty()
            ->and($snapshots->pluck('basis')->unique()->all())->toBe([CostBasis::AsRecorded]);

        foreach ($snapshots as $snapshot) {
            expect($snapshot->currency_code)->toBe('USD')
                ->and($snapshot->total_input_cost_amount)->not->toBeNull();

            $version = RecipeVersion::withoutTenancy()->whereKey($snapshot->recipe_version_id)->sole();

            // The whole appendix D finding #1/#2 rule, asserted rather than
            // described: a per-piece figure exists only where the version
            // carries a piece count, a per-unit figure only where it carries a
            // measured yield, and a snapshot that claims otherwise is flagged.
            if ($snapshot->cost_per_piece_amount !== null && $version->yield_piece_count === null) {
                expect($snapshot->basis_mismatch)->toBeTrue();
            }

            if ($snapshot->cost_per_yield_unit_amount !== null && $version->yield_quantity === null) {
                expect($snapshot->basis_mismatch)->toBeTrue();
            }
        }

        expect($snapshots->where('basis_mismatch', true))
            ->not->toBeEmpty('the fixture must contain a sheet whose cost label contradicts its yield');
    });
});

it('gives a produced intermediate an outputs row and gives a sheetless one nothing', function (): void {
    $report = runImport();

    inGreenLifeContext(function (string $organisationId): void {
        expect(RecipeVersionOutput::withoutTenancy()->where('organisation_id', $organisationId)->count())
            ->toBeGreaterThan(0);
    });

    $gapCodes = array_column($report->knownGapsSnapshot(), 'code');

    expect($gapCodes)->toContain('intermediate_without_technical_sheet');
});

it('imports the sauce sheets as indicative recipes with declared allergen rows and no lines', function (): void {
    runImport();

    inGreenLifeContext(function (string $organisationId): void {
        $indicative = Recipe::withoutTenancy()
            ->where('organisation_id', $organisationId)
            ->where('source_kind', 'indicative_formulation')
            ->get();

        expect($indicative)->not->toBeEmpty();

        foreach ($indicative as $recipe) {
            $version = RecipeVersion::withoutTenancy()->where('recipe_id', $recipe->getKey())->sole();

            expect($version->completeness->value)->toBe('indicative')
                ->and(RecipeVersionLine::withoutTenancy()->where('recipe_version_id', $version->getKey())->count())->toBe(0)
                ->and($version->notes)->toContain('Typical ingredients as the source writes them');
        }

        $declared = RecipeVersionAllergen::withoutTenancy()
            ->where('organisation_id', $organisationId)
            ->get();

        expect($declared)->not->toBeEmpty()
            ->and($declared->pluck('derivation')->unique()->map->value->all())->toBe(['declared']);
    });
});

it('turns a dual pack into two variants and a single-priced dual pack into one price', function (): void {
    $report = runImport();

    inGreenLifeContext(function (): void {
        $dual = CatalogueItem::withoutTenancy()
            ->where('item_type', CatalogueItemType::Product->value)
            ->get()
            ->first(fn (CatalogueItem $item): bool => CatalogueItemVariant::withoutTenancy()
                ->where('catalogue_item_id', $item->getKey())
                ->count() > 1);

        expect($dual)->not->toBeNull('the fixture must contain a dual-pack product');
    });

    $codes = array_column($report->findingsSnapshot(), 'code');

    expect($codes)->toContain('product_dual_pack_single_price')
        ->and($codes)->toContain('product_price_cell_is_pack_text');
});

it('writes a market-priced product as a NULL-amount row and never as a zero', function (): void {
    runImport();

    inGreenLifeContext(function (): void {
        $marketPriced = CatalogueItem::withoutTenancy()->where('is_market_priced', true)->get();

        expect($marketPriced)->not->toBeEmpty('the fixture must contain a "depends on each day" product');

        foreach ($marketPriced as $item) {
            $rows = PriceListItem::withoutTenancy()->where('catalogue_item_id', $item->getKey())->get();

            foreach ($rows as $row) {
                expect($row->price_status)->toBe(PriceStatus::MarketPriced)
                    ->and($row->unit_amount_minor)->toBeNull();
            }
        }
    });
});

it('keeps an assorted row as one listing with its members expanded', function (): void {
    runImport();

    inGreenLifeContext(function (): void {
        $assorted = CatalogueItem::withoutTenancy()->where('is_assorted', true)->get();

        expect($assorted)->not->toBeEmpty('the fixture must contain an assorted vegetable row');

        foreach ($assorted as $item) {
            expect(DB::table('catalogue_item_ingredients')->where('catalogue_item_id', $item->getKey())->count())
                ->toBeGreaterThan(0);
        }
    });
});

it('leaves an imported plan honestly unpublishable, and says the prices are why', function (): void {
    runImport();

    inGreenLifeContext(function (): void {
        $plan = CatalogueItem::withoutTenancy()
            ->where('item_type', CatalogueItemType::SubscriptionPlan->value)
            ->orderBy('slug')
            ->first();

        expect($plan)->not->toBeNull()
            ->and($plan->status)->toBe(CatalogueItemStatus::Draft);

        $reasons = app(CatalogueItemReadiness::class)->reasons($plan);
        $codes = array_column($reasons, 'code');

        expect($codes)->toContain('plan_prices_incomplete');

        // Every configuration carries a placeholder row: the schema's CHECK is
        // what makes "we have not priced this" representable without a number.
        $variantIds = CatalogueItemVariant::withoutTenancy()
            ->where('catalogue_item_id', $plan->getKey())
            ->pluck('id');

        $placeholders = PriceListItem::withoutTenancy()
            ->whereIn('catalogue_item_variant_id', $variantIds)
            ->get();

        expect($placeholders)->toHaveCount($variantIds->count())
            ->and($placeholders->pluck('price_status')->unique()->all())->toBe([PriceStatus::Placeholder])
            ->and($placeholders->pluck('unit_amount_minor')->unique()->all())->toBe([null]);
    });
});

it('builds the plan vocabularies and never a zero-day duration', function (): void {
    runImport();

    inGreenLifeContext(function (): void {
        expect(MealCombinationOption::withoutTenancy()->count())->toBe(9);

        $durations = PlanDuration::withoutTenancy()->get();

        expect($durations)->toHaveCount(5)
            ->and($durations->where('duration_kind.value', 'one_off')->pluck('duration_days')->unique()->all())->toBe([null])
            ->and($durations->whereNotNull('duration_days')->pluck('duration_days')->sort()->values()->all())
            ->toBe([5, 20, 40, 60]);
    });
});

it('does not import the example meal-to-plan map, and says so', function (): void {
    $report = runImport();

    $gapCodes = array_column($report->knownGapsSnapshot(), 'code');

    expect($gapCodes)->toContain('meal_to_plan_map_not_imported')
        ->and($gapCodes)->toContain('plan_prices_are_placeholders')
        ->and($gapCodes)->toContain('plan_duration_discounts_absent');
});

it('claims every Lebanese area in one zone with no fee and no minimum', function (): void {
    runImport();

    inGreenLifeContext(function (string $organisationId): void {
        $zone = DeliveryZone::withoutTenancy()->where('organisation_id', $organisationId)->sole();

        expect($zone->code)->toBe('greenlife-delivery')
            ->and($zone->branch_id)->toBeNull()
            ->and($zone->delivery_fee_minor)->toBeNull()
            ->and($zone->minimum_order_minor)->toBeNull();

        $areas = DB::table('delivery_areas')->where('country_code', 'LB')->count();

        expect(DeliveryZoneArea::withoutTenancy()->where('delivery_zone_id', $zone->getKey())->count())
            ->toBe($areas);

        $windows = DeliveryWindow::withoutTenancy()->where('organisation_id', $organisationId)->get();

        expect($windows->pluck('code')->sort()->values()->all())->toBe(['afternoon', 'evening', 'morning']);

        foreach ($windows as $window) {
            expect($window->starts_at)->toBeNull()
                ->and($window->ends_at)->toBeNull()
                ->and($window->weekdays)->toBe([]);
        }
    });
});

it('reports an unresolved designation, excludes its line and flags its sheet', function (): void {
    $report = runImport();

    $unresolved = $report->unresolvedSnapshot();

    expect($unresolved)->not->toBeEmpty('the fixture must contain a designation the curated dictionary does not cover');

    foreach ($unresolved as $row) {
        expect($row['occurrences'])->not->toBeEmpty()
            ->and($row['effect'])->not->toBe('');
    }

    expect($report->incompleteSheetsSnapshot())->not->toBeEmpty()
        ->and($report->countOf('recipe_version_line', 'failed'))->toBeGreaterThan(0);

    // And no ingredient was invented to make the failure go away.
    $invented = Ingredient::withoutTenancy()
        ->whereIn('name_en', array_column($unresolved, 'designation'))
        ->count();

    expect($invented)->toBe(0);
});

it('records a sha256 for every source file', function (): void {
    $report = runImport();

    $manifest = $report->toArray()['manifest'];

    expect($manifest)->toHaveCount(5);

    foreach ($manifest as $entry) {
        expect($entry['sha256'])->toHaveLength(64)
            ->and($entry['bytes'])->toBeGreaterThan(0)

            // Nothing to compare against on a first run, and the report says
            // that rather than claiming the file is unchanged.
            ->and($entry['changed_since_previous'])->toBeNull();
    }
});

it('changes nothing on a second run', function (): void {
    runImport();

    $before = importedRowCounts();

    $second = runImport();

    expect(importedRowCounts())->toBe($before);

    foreach (['organisation', 'branch', 'sales_channel', 'price_list', 'catalogue', 'ingredient', 'recipe', 'recipe_version', 'catalogue_item', 'delivery_zone', 'delivery_window'] as $entity) {
        expect($second->countOf($entity, 'created'))->toBe(0, "{$entity} was created again on a re-run")
            ->and($second->countOf($entity, 'skipped_existing'))->toBeGreaterThan(0, "{$entity} reported no skipped_existing on a re-run");
    }
});

it('never overwrites an operator edit', function (): void {
    runImport();

    [$lineId, $priceId, $ingredientId] = inGreenLifeContext(function (string $organisationId): array {
        $line = RecipeVersionLine::withoutTenancy()
            ->where('organisation_id', $organisationId)
            ->whereNotNull('unit_cost_amount')
            ->orderBy('recipe_version_id')
            ->orderBy('line_number')
            ->first();

        $price = PriceListItem::withoutTenancy()
            ->where('organisation_id', $organisationId)
            ->where('price_status', PriceStatus::Confirmed->value)
            ->orderBy('source_ref')
            ->first();

        $ingredient = Ingredient::withoutTenancy()
            ->where('organisation_id', $organisationId)
            ->orderBy('slug')
            ->first();

        // The three edits a kitchen actually makes: a corrected quantity, a
        // repriced pack, a renamed ingredient.
        RecipeVersionLine::withoutTenancy()->whereKey($line->getKey())->update(['quantity' => '42.0000']);
        PriceListItem::withoutTenancy()->whereKey($price->getKey())->update(['unit_amount_minor' => 999_99]);
        Ingredient::withoutTenancy()->whereKey($ingredient->getKey())->update(['name_en' => 'Operator renamed this']);

        return [(string) $line->getKey(), (string) $price->getKey(), (string) $ingredient->getKey()];
    });

    $report = runImport();

    inGreenLifeContext(function () use ($lineId, $priceId, $ingredientId): void {
        expect((string) RecipeVersionLine::withoutTenancy()->whereKey($lineId)->value('quantity'))->toBe('42.0000')
            ->and(PriceListItem::withoutTenancy()->whereKey($priceId)->value('unit_amount_minor'))->toBe(99999)
            ->and(Ingredient::withoutTenancy()->whereKey($ingredientId)->value('name_en'))->toBe('Operator renamed this');
    });

    expect($report->countOf('recipe_version', 'skipped_existing'))->toBeGreaterThan(0)
        ->and($report->countOf('price_list_item', 'skipped_existing'))->toBeGreaterThan(0)
        ->and($report->countOf('ingredient', 'skipped_existing'))->toBeGreaterThan(0);
});

it('writes nothing at all on a dry run', function (): void {
    $before = importedRowCounts();

    $report = runImport(dryRun: true);

    expect(importedRowCounts())->toBe($before);

    // And it still says what it would have done — from having actually done it
    // and rolled it back, which is why the number cannot drift from the real
    // run's.
    expect($report->countOf('organisation', 'would_create'))->toBe(1)
        ->and($report->countOf('recipe_version', 'would_create'))->toBeGreaterThan(0)
        ->and($report->countOf('catalogue_item', 'would_create'))->toBeGreaterThan(0)
        ->and($report->countOf('organisation', 'created'))->toBe(0);
});

it('reports findings without touching the database in validate-only mode', function (): void {
    $before = importedRowCounts();

    $report = runImport(validateOnly: true);

    expect(importedRowCounts())->toBe($before)
        ->and($report->findingsSnapshot())->not->toBeEmpty()
        ->and($report->countsSnapshot())->toBe([]);
});

it('surfaces the allergen escalation and the burghul contradiction', function (): void {
    $report = runImport();

    $review = $report->allergenReviewSnapshot();
    $codes = array_column($review, 'code');

    expect($review)->not->toBeEmpty()
        ->and($codes)->toContain('ingredient_requires_review')
        ->and($codes)->toContain('technical_sheet_ingredients_unmapped');

    $contradiction = collect($review)->firstWhere('code', 'ingredient_requires_review');

    expect($contradiction['detail'])->toContain('requires_review')
        ->and($contradiction['detail'])->toContain('Cereals/Gluten');
});

it('separates imported drafts from quarantine in the report', function (): void {
    $report = runImport();

    $codes = array_column($report->quarantineSnapshot(), 'code');

    expect($codes)->toContain('imported_versions_are_drafts');
});

it('refuses to run outside the allowlisted environments', function (): void {
    config()->set('kitchens.import.environments', ['production-only-nonsense']);

    $before = importedRowCounts();

    $this->artisan('kitchen:import-greenlife', ['--source' => fixtureWorkbook()])
        ->expectsOutputToContain('refuses to run')
        ->assertExitCode(1);

    expect(importedRowCounts())->toBe($before);
});

it('refuses a source folder that is missing a workbook export', function (): void {
    $incomplete = sys_get_temp_dir().'/greenlife-incomplete-'.bin2hex(random_bytes(4));
    mkdir($incomplete);
    file_put_contents($incomplete.'/Actual Data_Recipes.md', "Sheet1:Technical Sheet\n");

    $options = new ImportOptions($incomplete, 'green-life-kitchen');

    expect(fn () => app(GreenLifeImport::class)->run($options, new ImportReport($options, 'testing')))
        ->toThrow(RuntimeException::class, 'missing');

    expect(Organisation::query()->where('slug', 'green-life-kitchen')->exists())->toBeFalse();
});

it('runs from the console and writes a JSON report', function (): void {
    $this->artisan('kitchen:import-greenlife', ['--source' => fixtureWorkbook()])
        ->expectsOutputToContain('GreenLife import')
        ->assertExitCode(0);

    expect(Organisation::query()->where('slug', 'green-life-kitchen')->exists())->toBeTrue();

    $reports = glob(Storage::disk('local')->path((string) config('kitchens.import.report_path')).'/*.json') ?: [];

    expect($reports)->not->toBeEmpty();

    /** @var array<string, mixed> $document */
    $document = json_decode((string) file_get_contents((string) end($reports)), true, flags: JSON_THROW_ON_ERROR);

    expect($document)->toHaveKeys([
        'run', 'manifest', 'counts', 'unresolved_designations', 'incomplete_sheets',
        'data_quality_findings', 'allergen_review', 'quarantine', 'known_gaps',
    ]);

});

it('audits the run at both ends without carrying the findings into the audit trail', function (): void {
    $this->artisan('kitchen:import-greenlife', ['--source' => fixtureWorkbook()])->assertExitCode(0);

    $events = DB::table('audit_logs')
        ->whereIn('action', ['catalogue.greenlife_import_started', 'catalogue.greenlife_import_finished'])
        ->get();

    expect($events)->toHaveCount(2);

    $finished = $events->firstWhere('action', 'catalogue.greenlife_import_finished');

    /** @var array<string, mixed> $metadata */
    $metadata = json_decode((string) $finished->metadata, true, flags: JSON_THROW_ON_ERROR);

    expect($finished->purpose_of_use)->toBe('organisation_administration')
        ->and($metadata)->toHaveKeys([
            'mode', 'entity_types', 'rows_created', 'rows_skipped_existing', 'rows_failed',
            'unresolved_designation_count', 'data_quality_finding_count', 'allergen_review_item_count',
        ])

        // Counts of problems, never the problems: an audit row is readable with
        // `audit.view_organisation` and must not become a second copy of the
        // report.
        ->and($metadata)->not->toHaveKey('unresolved_designations')
        ->and($metadata)->not->toHaveKey('data_quality_findings');

    // afterEach removes the whole throwaway directory.
});
