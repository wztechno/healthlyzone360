<?php

declare(strict_types=1);

use Database\Seeders\KitchenReferenceSeeder;
use Healthy360\Ingredients\Enums\IngredientVerificationStatus;
use Healthy360\Ingredients\Models\Ingredient;
use Healthy360\Ingredients\Models\IngredientAllergen;
use Healthy360\Kitchens\Import\Runtime\ImportOptions;
use Healthy360\Kitchens\Import\Runtime\ImportReport;
use Healthy360\Kitchens\Import\Runtime\KitchenWorkbookImport;
use Healthy360\Kitchens\Import\Runtime\UnitMap;
use Healthy360\Organisations\Database\Seeders\OrganisationTypeSeeder;
use Healthy360\Organisations\Models\Organisation;
use Healthy360\Pricing\Enums\PriceStatus;
use Healthy360\Pricing\Models\PriceList;
use Healthy360\Pricing\Models\PriceListItem;
use Healthy360\ReferenceData\Database\Seeders\ReferenceDataSeeder;
use Healthy360\Tenancy\Database\DatabaseTenantContext;
use Healthy360\Tenancy\TenantContext;
use Illuminate\Support\Facades\DB;

/*
|--------------------------------------------------------------------------
| The three DEC1 data commands (owner decisions → database)
|--------------------------------------------------------------------------
|
| Smoke coverage of the two properties that matter on a command an operator
| runs by hand against a live kitchen: **a dry run writes nothing**, and
| **applying twice is applying once**. Everything else these commands do is
| arithmetic the console output shows in full and a human reads.
|
| Driven by the same synthetic fixture workbook the importer's own suite uses,
| against a determinations file written per test — the committed one names the
| real workbook ingredients, which are confidential and are not in this
| repository (data register, D-046).
|
*/

beforeEach(function (): void {
    $this->seed([ReferenceDataSeeder::class, KitchenReferenceSeeder::class, OrganisationTypeSeeder::class]);

    UnitMap::forget();

    config()->set('kitchens.import.environments', ['local', 'testing']);
    config()->set('kitchens.import.report_path', 'import-reports-test-'.bin2hex(random_bytes(6)));

    $options = new ImportOptions(
        sourceDirectory: __DIR__.'/Fixtures/workbook',
        organisationSlug: 'healthy360-kitchen',
        dryRun: false,
        validateOnly: false,
    );

    app(KitchenWorkbookImport::class)->run($options, new ImportReport($options, 'testing'));

    app(TenantContext::class)->clear();
    app(DatabaseTenantContext::class)->reset();
});

afterEach(function (): void {
    app(TenantContext::class)->clear();
    app(DatabaseTenantContext::class)->reset();

    if (isset($this->determinationsFile) && is_file($this->determinationsFile)) {
        unlink($this->determinationsFile);
    }
});

/**
 * The two tenant ingredients the fixture import happens to have created, in a
 * stable order — named at runtime rather than hard-coded, because which of the
 * dictionary's declarations the fixture's technical sheets reach is a property
 * of the fixture rather than something this test should assert.
 *
 * @return array{0: string, 1: string}
 */
function fixtureTenantIngredientNames(): array
{
    /** @var list<string> $names */
    $names = Ingredient::withoutTenancy()
        ->whereNotNull('organisation_id')
        ->orderBy('name_en')
        ->pluck('name_en')
        ->all();

    expect($names)->toHaveCount(count($names))->and(count($names))->toBeGreaterThanOrEqual(2);

    return [$names[0], $names[1]];
}

/**
 * A determinations file naming ingredients the fixture workbook creates: one
 * that carries a class, and one that carries none and so has to be recorded by
 * verifying the ingredient itself.
 */
function fixtureDeterminations(string $none, string $withClass): string
{
    $path = sys_get_temp_dir().'/dec1-determinations-'.bin2hex(random_bytes(6)).'.json';

    file_put_contents($path, json_encode([
        'schema_version' => 1,
        'decision_ref' => 'fixture',
        'defaults' => [
            'source_tenant' => 'kitchen_declared',
            'source_platform' => 'master_list',
            'verification_status' => 'requires_supplier_confirmation',
            'market_scope' => 'all',
        ],
        'verified_note' => 'fixture: assessed and found to carry no allergen class.',
        'determinations' => [
            [
                'designation' => $none,
                'allergens' => [],
                'evidence' => 'Fixture: a single unprocessed component.',
            ],
            [
                'designation' => $withClass,
                'allergens' => [['code' => 'sulphites', 'containment' => 'may_contain']],
                'evidence' => 'Fixture: a brined component.',
            ],
        ],
        'platform_corrections' => [],
    ], JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES));

    return $path;
}

/**
 * Every table these commands can write, counted with no tenant context in the
 * way — so a dry run that wrote one row anywhere is caught, not just a dry run
 * that wrote the row the test was thinking about.
 *
 * @return array<string, int>
 */
function dec1RowCounts(): array
{
    $counts = [];

    foreach ([
        'ingredient_allergens', 'price_list_items', 'channel_price_lists',
        'recipe_version_allergens', 'audit_logs',
    ] as $table) {
        $counts[$table] = (int) DB::table($table)->count();
    }

    // The columns these commands flip, counted as well: a row count alone
    // would miss an in-place update, which is most of what they do.
    $counts['verified_ingredients'] = (int) DB::table('ingredients')
        ->where('verification_status', IngredientVerificationStatus::Verified->value)
        ->count();

    $counts['published_items'] = (int) DB::table('catalogue_items')->where('status', 'published')->count();
    $counts['published_versions'] = (int) DB::table('recipe_versions')->where('status', 'published')->count();
    $counts['duration_discounts'] = (int) DB::table('plan_variant_durations')->whereNotNull('discount_percent')->count();
    $counts['active_price_lists'] = (int) DB::table('price_lists')->where('status', 'active')->count();

    return $counts;
}

it('writes nothing at all on a dry run of every DEC1 command', function (): void {
    [$none, $withClass] = fixtureTenantIngredientNames();
    $this->determinationsFile = fixtureDeterminations($none, $withClass);

    $before = dec1RowCounts();

    $this->artisan('kitchen:apply-allergen-determinations', [
        '--org' => 'healthy360-kitchen',
        '--file' => $this->determinationsFile,
        '--dry-run' => true,
    ])->assertSuccessful();

    $this->artisan('kitchen:seed-approximate-plan-prices', [
        '--org' => 'healthy360-kitchen',
        '--dry-run' => true,
    ])->assertSuccessful();

    $this->artisan('kitchen:publish-ready', [
        '--org' => 'healthy360-kitchen',
        '--dry-run' => true,
    ])->assertSuccessful();

    $this->artisan('kitchen:activate-imported-tariffs', [
        '--org' => 'healthy360-kitchen',
        '--dry-run' => true,
    ])->assertSuccessful();

    expect(dec1RowCounts())->toBe($before);
});

it('applies the determinations once and changes nothing on a second run', function (): void {
    [$none, $withClass] = fixtureTenantIngredientNames();
    $this->determinationsFile = fixtureDeterminations($none, $withClass);

    $this->artisan('kitchen:apply-allergen-determinations', [
        '--org' => 'healthy360-kitchen',
        '--file' => $this->determinationsFile,
    ])->assertSuccessful();

    $clear = Ingredient::withoutTenancy()->where('name_en', $none)->sole();
    $brined = Ingredient::withoutTenancy()->where('name_en', $withClass)->sole();

    // "Assessed and carries nothing" is the ingredient's own verification
    // status; there is no mapping row that could say it.
    expect($clear->verification_status)->toBe(IngredientVerificationStatus::Verified)
        ->and($clear->notes)->toContain('assessed and found to carry no allergen class');

    $mapping = IngredientAllergen::withoutTenancy()
        ->where('ingredient_id', $brined->getKey())
        ->where('allergen_code', 'sulphites')
        ->sole();

    expect($mapping->containment->value)->toBe('may_contain')
        ->and($mapping->verification_status->value)->toBe('requires_supplier_confirmation')
        ->and($mapping->source->value)->toBe('kitchen_declared')
        ->and($mapping->organisation_id)->toBe((string) Organisation::query()->where('slug', 'healthy360-kitchen')->sole()->getKey());

    $after = dec1RowCounts();
    $mappingId = (string) $mapping->getKey();

    $this->artisan('kitchen:apply-allergen-determinations', [
        '--org' => 'healthy360-kitchen',
        '--file' => $this->determinationsFile,
    ])->assertSuccessful();

    $second = dec1RowCounts();

    // The audit trail is append-only and a second run genuinely happened, so
    // it gains exactly one row — the command's own event — and nothing else
    // moves. Asserting the count rather than excluding the table is the point:
    // a re-run that recomputed the kitchen's labels would leave far more than
    // one, which is how the first version of this command was caught doing it.
    expect($second['audit_logs'])->toBe($after['audit_logs'] + 1);

    unset($second['audit_logs'], $after['audit_logs']);

    // Not merely "the same number of rows": the same *rows*. A re-run that
    // deleted and re-inserted an identical mapping would keep the count and
    // would re-mark every dependent label stale, which is the churn the
    // skip-if-identical path exists to prevent.
    expect($second)->toBe($after)
        ->and(IngredientAllergen::withoutTenancy()->whereKey($mappingId)->exists())->toBeTrue();
});

it('replaces plan placeholders with confirmed rows and does not churn them on a second run', function (): void {
    $this->artisan('kitchen:seed-approximate-plan-prices', ['--org' => 'healthy360-kitchen'])->assertSuccessful();

    $priceList = PriceList::withoutTenancy()->where('code', 'like', '%-plans-%')->sole();

    $confirmed = PriceListItem::withoutTenancy()
        ->where('price_list_id', $priceList->getKey())
        ->whereNull('effective_to')
        ->get();

    expect($confirmed)->not->toBeEmpty()
        ->and($confirmed->every(fn (PriceListItem $row): bool => $row->price_status === PriceStatus::Confirmed))->toBeTrue()
        ->and($confirmed->every(fn (PriceListItem $row): bool => $row->unit_amount_minor > 0))->toBeTrue();

    // The placeholders are closed and superseded rather than deleted: what a
    // plan was priced at is evidence, and the history has to survive.
    $closed = PriceListItem::withoutTenancy()
        ->where('price_list_id', $priceList->getKey())
        ->whereNotNull('effective_to')
        ->get();

    expect($closed->every(fn (PriceListItem $row): bool => $row->price_status === PriceStatus::Placeholder))->toBeTrue()
        ->and($closed->every(fn (PriceListItem $row): bool => $row->superseded_by_id !== null))->toBeTrue();

    $after = dec1RowCounts();

    $this->artisan('kitchen:seed-approximate-plan-prices', ['--org' => 'healthy360-kitchen'])->assertSuccessful();

    expect(dec1RowCounts()['price_list_items'])->toBe($after['price_list_items']);
});

it('refuses to run outside the allowlisted environments', function (): void {
    config()->set('kitchens.import.environments', ['production']);

    $this->artisan('kitchen:apply-allergen-determinations', ['--org' => 'healthy360-kitchen'])->assertFailed();
    $this->artisan('kitchen:seed-approximate-plan-prices', ['--org' => 'healthy360-kitchen'])->assertFailed();
    $this->artisan('kitchen:publish-ready', ['--org' => 'healthy360-kitchen'])->assertFailed();
});
