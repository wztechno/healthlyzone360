<?php

declare(strict_types=1);

use Database\Seeders\KitchenReferenceSeeder;
use Healthy360\Cart\Services\CartService;
use Healthy360\Catalogues\Enums\CatalogueItemStatus;
use Healthy360\Catalogues\Enums\CatalogueItemType;
use Healthy360\Catalogues\Enums\SalesChannelKind;
use Healthy360\Catalogues\Models\CatalogueItem;
use Healthy360\Catalogues\Models\CatalogueItemPackVariant;
use Healthy360\Catalogues\Models\CatalogueItemVariant;
use Healthy360\Catalogues\Models\ChannelCatalogueItem;
use Healthy360\Catalogues\Models\SalesChannel;
use Healthy360\Catalogues\Services\CatalogueItemReadiness;
use Healthy360\Customers\Models\CustomerAccount;
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
        // Eight packs: the priced meal sells by weight, so it has its two; the
        // unpriced meal is a dish sold as itself and gets no placeholder pack.
        ->and($report->countOf('catalogue_item_variant', 'created'))->toBe(8)
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
        ->and($ingredient->source_ref)->toBe('SAC-901')
        // The catalogue's list prices restated per kilogram: $5.00 for 1 kg
        // B2B, $3.00 for a 300 g bottle B2C.
        ->and($ingredient->b2b_price_amount)->toBe('5.000000')
        ->and($ingredient->b2c_price_amount)->toBe('10.000000')
        ->and($ingredient->price_currency_code)->toBe('USD');

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

    // The sauce's price sits on its B2C pack, and so does the priced meal's:
    // the sheet gives it a weight per channel, and a price with no size is a
    // price per nothing.
    $mealB2c = PriceListItem::withoutTenancy()
        ->where('organisation_id', $org->getKey())
        ->where('source_ref', 'PRD-901/b2c')
        ->sole();

    $mealPacks = CatalogueItemVariant::withoutTenancy()
        ->where('catalogue_item_id', $items['PRD-901']->getKey())
        ->get()
        ->keyBy('code');

    expect($b2c->catalogue_item_variant_id)->not->toBeNull()
        ->and($mealPacks->keys()->sort()->values()->all())->toBe(['b2b', 'b2c'])
        ->and($mealB2c->catalogue_item_variant_id)->toBe((string) $mealPacks['b2c']->getKey())
        ->and(CatalogueItemPackVariant::sizeOf((string) $mealPacks['b2b']->getKey()))->toBe(['size' => '1', 'unit' => 'kg'])
        ->and(CatalogueItemVariant::withoutTenancy()->where('catalogue_item_id', $items['PRD-902']->getKey())->count())->toBe(0);
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

    // A sauce that is exactly one ingredient answers "what is in this" — and
    // the LABEL answers with the same basis the gate accepted: the derived
    // allergen list reads the linked ingredient's declarations.
    expect($codes('SAC-901'))->not->toContain('no_allergen_basis')
        ->and(app(MarketplaceMeals::class)->allergenCodesOf($items['SAC-901']))
        ->toBe(['egg', 'sulphites'])
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
        ->whereIn('source_ref', ['SAC-901', 'SAC-902', 'DRS-901', 'PRD-901'])
        ->update(['status' => CatalogueItemStatus::Published->value]);

    $meals = app(MarketplaceMeals::class);
    $items = CatalogueItem::withoutTenancy()
        ->where('organisation_id', $org->getKey())
        ->get()
        ->keyBy('source_ref');

    $channels = $meals->listingChannelsOf((string) $org->getKey());

    $saucePrice = $meals->priceOf($items['SAC-901'], $channels);
    $mealPrice = $meals->priceOf($items['PRD-901'], $channels);

    expect($saucePrice)->not->toBeNull()
        ->and($meals->priceOf($items['SAC-902'], $channels))->toBeNull()
        // A priced meal lists too, on its B2C pack.
        ->and($mealPrice)->not->toBeNull()
        // And each listing says what its price buys: the 300 g bottle, the 1 kg tray.
        ->and($meals->packSizeOf($items['SAC-901'], $saucePrice))->toBe(['size' => '0.3', 'unit' => 'kg'])
        ->and($mealPrice?->amountMinor)->toBe(1000)
        ->and($meals->packSizeOf($items['PRD-901'], $mealPrice))->toBe(['size' => '1', 'unit' => 'kg']);
});

it('lets a customer add a pack-priced sauce without naming its pack', function (): void {
    runV6Import();

    $org = v6Org();

    $this->artisan('kitchen:activate-imported-tariffs', ['--org' => 'test-v6-kitchen'])->assertExitCode(0);

    $sauce = CatalogueItem::withoutTenancy()
        ->where('organisation_id', $org->getKey())
        ->where('source_ref', 'SAC-901')
        ->sole();
    $sauce->status = CatalogueItemStatus::Published;
    $sauce->save();

    $channel = SalesChannel::withoutTenancy()
        ->where('organisation_id', $org->getKey())
        ->where('channel_kind', SalesChannelKind::B2cWeb->value)
        ->sole();

    $carts = app(CartService::class);
    $cart = $carts->getOrCreate(CustomerAccount::factory()->active()->create(), $channel);

    // The app names the article, never the pack — the marketplace showed one
    // price, and that price sits on the retail pack. The basket must land on
    // that pack rather than refuse the article as unpriced at item level.
    $line = $carts->addItem($cart, (string) $sauce->getKey());

    $retailPack = CatalogueItemVariant::withoutTenancy()
        ->where('catalogue_item_id', $sauce->getKey())
        ->where('code', 'b2c')
        ->sole();

    expect($line->catalogue_item_variant_id)->toBe((string) $retailPack->getKey());

    // A repeat add merges into that line instead of opening a second one.
    $again = $carts->addItem($cart, (string) $sauce->getKey());

    expect($again->getKey())->toBe($line->getKey())
        ->and((float) $again->quantity)->toBe(2.0);
});
