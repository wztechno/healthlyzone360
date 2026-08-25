<?php

declare(strict_types=1);

use Database\Seeders\KitchenReferenceSeeder;
use Healthy360\Catalogues\Enums\CatalogueItemStatus;
use Healthy360\Catalogues\Enums\CatalogueItemType;
use Healthy360\Catalogues\Models\CatalogueItem;
use Healthy360\Catalogues\Models\CatalogueItemVariant;
use Healthy360\Catalogues\Models\ChannelCatalogueItem;
use Healthy360\Catalogues\Services\CatalogueItemReadiness;
use Healthy360\Ingredients\Models\Ingredient;
use Healthy360\Ingredients\Models\IngredientAllergen;
use Healthy360\Kitchens\Import\Runtime\ImportOptions;
use Healthy360\Kitchens\Import\Runtime\ImportReport;
use Healthy360\Kitchens\Import\Runtime\UnitMap;
use Healthy360\Kitchens\Import\V6\V6CatalogueWriter;
use Healthy360\Kitchens\Services\MarketplaceMeals;
use Healthy360\Organisations\Database\Seeders\OrganisationTypeSeeder;
use Healthy360\Organisations\Models\Organisation;
use Healthy360\Pricing\Models\PriceListItem;
use Healthy360\ReferenceData\Database\Seeders\ReferenceDataSeeder;
use Healthy360\Tenancy\Database\DatabaseTenantContext;
use Healthy360\Tenancy\TenantContext;

/*
|--------------------------------------------------------------------------
| The committed v6 catalogue importer, end to end
|--------------------------------------------------------------------------
|
| Driven by the synthetic fixture at `tests/Fixtures/v6/v6-catalogue.json` —
| seven invented rows covering every family (two sauces, a dressing, two
| meals, two resale products), one representative of each post-normalization
| state: priced/unpriced, Ingredient?=Yes/No, a blank-role meal, the
| recipe-library reference, the may-contain sulphites marker and the US-only
| coconut scope.
|
| What is asserted is what would be expensive to learn in production: a
| second run changes nothing, a dry run writes nothing, everything lands
| draft, the ingredient_id link is a truthful allergen basis where a recipe
| does not exist, and an unpriced item — published or not — never reaches
| the marketplace.
|
*/

const V6_FIXTURE = __DIR__.'/Fixtures/v6/v6-catalogue.json';

beforeEach(function (): void {
    $this->seed([ReferenceDataSeeder::class, KitchenReferenceSeeder::class, OrganisationTypeSeeder::class]);

    UnitMap::forget();

    config()->set('kitchens.import.environments', ['local', 'testing']);
    config()->set('kitchens.import.report_path', 'import-reports-test-'.bin2hex(random_bytes(6)));
});

afterEach(function (): void {
    app(TenantContext::class)->clear();
    app(DatabaseTenantContext::class)->reset();
});

function runV6Import(bool $dryRun = false): ImportReport
{
    $options = new ImportOptions(
        sourceDirectory: V6_FIXTURE,
        organisationSlug: 'test-v6-kitchen',
        dryRun: $dryRun,
        validateOnly: false,
    );

    $report = new ImportReport($options, 'testing');

    return app(V6CatalogueWriter::class)->run($options, $report, V6_FIXTURE);
}

function v6Org(): Organisation
{
    return Organisation::query()->where('slug', 'test-v6-kitchen')->sole();
}

it('imports every family with its ingredient rows, allergens and prices', function (): void {
    $report = runV6Import();

    expect($report->countOf('catalogue_item', 'created'))->toBe(7)
        ->and($report->countOf('ingredient', 'created'))->toBe(5)
        ->and($report->countOf('ingredient_allergen', 'created'))->toBe(5)
        ->and($report->countOf('catalogue_item_variant', 'created'))->toBe(9)
        ->and($report->countOf('price_list_item', 'created'))->toBe(5)
        ->and($report->countOf('channel_catalogue_item', 'created'))->toBe(5);

    $org = v6Org();
    $items = CatalogueItem::withoutTenancy()->where('organisation_id', $org->getKey())->get()->keyBy('source_ref');

    expect($items)->toHaveCount(7)
        ->and($items['SAC-901']->item_type)->toBe(CatalogueItemType::Sauce)
        ->and($items['DRS-901']->item_type)->toBe(CatalogueItemType::Dressing)
        ->and($items['PRD-901']->item_type)->toBe(CatalogueItemType::Meal)
        ->and($items['RSL-901']->item_type)->toBe(CatalogueItemType::Product)
        ->and($items->pluck('status')->unique()->all())->toBe([CatalogueItemStatus::Draft]);

    $sauce = $items['SAC-901'];

    expect($sauce->composition)->toBe('Garlic, oil, lemon, salt')
        ->and($sauce->kitchen_category)->toBe('Sauce')
        ->and($sauce->kitchen_subcategory)->toBe('Cold sauce / dip')
        ->and($sauce->data_quality_flags)->toContain('recipe_library_unlinked')
        ->and($sauce->data_quality_flags)->toContain('source: Recipe Library')
        ->and($sauce->ingredient_id)->not->toBeNull();

    // The sauce's own ingredient row: kitchen-managed, allergen-bearing.
    $ingredient = Ingredient::withoutTenancy()->whereKey($sauce->ingredient_id)->sole();

    expect($ingredient->organisation_id)->toBe((string) $org->getKey())
        ->and($ingredient->composition)->toBe('Garlic, oil, lemon, salt')
        ->and($ingredient->source_ref)->toBe('SAC-901');

    $mappings = IngredientAllergen::withoutTenancy()
        ->where('ingredient_id', $ingredient->getKey())
        ->get()
        ->keyBy('allergen_code');

    expect($mappings)->toHaveCount(2)
        ->and($mappings['sulphites']->containment->value)->toBe('may_contain')
        ->and($mappings['sulphites']->verification_status->value)->toBe('requires_supplier_confirmation')
        ->and($mappings['egg']->evidence)->toBe('Eggs - mayonnaise base')
        ->and($mappings->pluck('source')->unique()->first()->value)->toBe('kitchen_declared');

    // A blank-role meal (Ingredient? blank) carries no ingredient link.
    expect($items['PRD-902']->ingredient_id)->toBeNull()
        ->and($items['PRD-902']->data_quality_flags)->toContain('source_blank_role_flags');

    // The Ingredient?=No resale row relies on derivation's hidden anchor.
    expect($items['RSL-902']->ingredient_id)->toBeNull();

    // Prices are confirmed rows on the right tariffs, sheet ID as source ref.
    $b2c = PriceListItem::withoutTenancy()
        ->where('organisation_id', $org->getKey())
        ->where('source_ref', 'SAC-901/b2c')
        ->sole();

    expect($b2c->unit_amount_minor)->toBe(300)
        ->and($b2c->price_status->value)->toBe('confirmed');
});

it('changes nothing on a second run', function (): void {
    runV6Import();

    $countRows = fn (): array => [
        CatalogueItem::withoutTenancy()->count(),
        Ingredient::withoutTenancy()->count(),
        CatalogueItemVariant::withoutTenancy()->count(),
        PriceListItem::withoutTenancy()->count(),
        ChannelCatalogueItem::withoutTenancy()->count(),
    ];

    $before = $countRows();
    $report = runV6Import();

    expect($countRows())->toBe($before)
        ->and($report->countOf('catalogue_item', 'created'))->toBe(0)
        ->and($report->countOf('catalogue_item', 'skipped_existing'))->toBe(7)
        ->and($report->countOf('ingredient', 'created'))->toBe(0);
});

it('writes nothing at all on a dry run', function (): void {
    $report = runV6Import(dryRun: true);

    expect($report->countOf('catalogue_item', 'would_create'))->toBe(7)
        ->and(Organisation::query()->where('slug', 'test-v6-kitchen')->exists())->toBeFalse()
        ->and(CatalogueItem::withoutTenancy()->where('source_system', 'healthy360_workbook_v6')->count())->toBe(0)
        ->and(Ingredient::withoutTenancy()->where('source_system', 'healthy360_workbook_v6')->count())->toBe(0);
});

it('reports the recipe-library references it deliberately leaves unlinked', function (): void {
    $report = runV6Import();

    $gap = collect($report->knownGapsSnapshot())->firstWhere('code', 'recipe_library_unlinked');

    expect($gap)->not->toBeNull()
        ->and($gap['detail'])->toContain('5 rows')
        ->and(CatalogueItem::withoutTenancy()->whereNotNull('recipe_id')->count())->toBe(0);
});

it('treats the ingredient link as a truthful allergen basis and refuses items without one', function (): void {
    runV6Import();

    $items = CatalogueItem::withoutTenancy()
        ->where('organisation_id', v6Org()->getKey())
        ->get()
        ->keyBy('source_ref');

    $readiness = app(CatalogueItemReadiness::class);
    $codes = fn (string $ref): array => array_column($readiness->reasons($items[$ref]), 'code');

    // A sauce that is exactly one ingredient answers "what is in this".
    expect($codes('SAC-901'))->not->toContain('no_allergen_basis')
        // The blank-role meal has no ingredient, no recipe, no member list —
        // honestly unpublishable until one exists.
        ->and($codes('PRD-902'))->toContain('no_allergen_basis')
        // A resale product never needed a basis; its rule is the active pack.
        ->and($codes('RSL-902'))->not->toContain('no_allergen_basis');
});

it('keeps unpriced items away from customers even once published', function (): void {
    runV6Import();

    $org = v6Org();

    // Activate the tariffs through the real command (it also assigns the
    // lists to their channels), then force-publish two priced rows and one
    // unpriced one, bypassing readiness — the marketplace gate must hold on
    // its own, not only behind publish-ready.
    $this->artisan('kitchen:activate-imported-tariffs', ['--org' => 'test-v6-kitchen'])->assertExitCode(0);

    CatalogueItem::withoutTenancy()
        ->where('organisation_id', $org->getKey())
        ->whereIn('source_ref', ['SAC-901', 'SAC-902', 'DRS-901'])
        ->update(['status' => CatalogueItemStatus::Published->value]);

    $meals = app(MarketplaceMeals::class);
    $items = CatalogueItem::withoutTenancy()
        ->where('organisation_id', $org->getKey())
        ->get()
        ->keyBy('source_ref');

    $channels = $meals->listingChannelsOf((string) $org->getKey());

    expect($meals->priceOf($items['SAC-901'], $channels))->not->toBeNull()
        ->and($meals->priceOf($items['SAC-902'], $channels))->toBeNull();
});
