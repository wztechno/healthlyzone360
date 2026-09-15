<?php

declare(strict_types=1);

use Database\Seeders\KitchenReferenceSeeder;
use Healthy360\Kitchens\Import\Runtime\ImportOptions;
use Healthy360\Kitchens\Import\Runtime\ImportReport;
use Healthy360\Kitchens\Import\Runtime\UnitMap;
use Healthy360\Kitchens\Import\V6\V6CatalogueWriter;
use Healthy360\Organisations\Database\Seeders\OrganisationTypeSeeder;
use Healthy360\Recipes\Enums\RecipeVersionStatus;
use Healthy360\Recipes\Models\Recipe;
use Healthy360\Recipes\Models\RecipeVersion;
use Healthy360\ReferenceData\Database\Seeders\ReferenceDataSeeder;
use Healthy360\Tenancy\Database\DatabaseTenantContext;
use Healthy360\Tenancy\TenantContext;

/*
|--------------------------------------------------------------------------
| kitchen:price-recipes-from-catalogue
|--------------------------------------------------------------------------
|
| The command that carries a catalogue item's B2B/B2C list price back onto
| the recipe version that produces it — the two figures the editor's Costing
| tab reads its gross margin from.
|
| Driven by the same synthetic v6 fixtures the importer tests use. The
| fixture catalogue is built for this: `Fixture Garlic Sauce` is priced B2B by
| the kilo and B2C in a 300 g pack, which is the whole reason the command
| divides — the raw pack prices read $5.00 and $3.00, and the honest per-kilo
| figures are $5.00 and $10.00.
|
*/

const PRICING_RECIPES_FIXTURE = __DIR__.'/Fixtures/v6/v6-recipes.json';
const PRICING_RECIPES_DICTIONARY = __DIR__.'/Fixtures/v6/v6-recipe-designations.json';
const PRICING_CATALOGUE_FIXTURE = __DIR__.'/Fixtures/v6/v6-catalogue.json';

beforeEach(function (): void {
    $this->seed([ReferenceDataSeeder::class, KitchenReferenceSeeder::class, OrganisationTypeSeeder::class]);

    UnitMap::forget();

    config()->set('kitchens.import.environments', ['local', 'testing']);
    config()->set('kitchens.import.report_path', 'import-reports-test-'.bin2hex(random_bytes(6)));

    // The catalogue first, then the recipes — the order the real sequence runs
    // in, and the order that leaves an item pointing at a recipe for this
    // command to find.
    $options = new ImportOptions(
        sourceDirectory: PRICING_CATALOGUE_FIXTURE,
        organisationSlug: 'test-v6-kitchen',
        dryRun: false,
        validateOnly: false,
    );
    app(V6CatalogueWriter::class)->run($options, new ImportReport($options, 'testing'), PRICING_CATALOGUE_FIXTURE);

    test()->artisan('kitchen:import-v6-recipes', [
        '--source' => PRICING_RECIPES_FIXTURE,
        '--dictionary' => PRICING_RECIPES_DICTIONARY,
        '--org' => 'test-v6-kitchen',
    ])->run();
});

afterEach(function (): void {
    app(TenantContext::class)->clear();
    app(DatabaseTenantContext::class)->reset();
});

/**
 * @param  array<string, mixed>  $extra
 */
function runRecipePricing(array $extra = []): int
{
    return test()->artisan('kitchen:price-recipes-from-catalogue', ['--org' => 'test-v6-kitchen'] + $extra)->run();
}

function pricedVersion(string $slug): RecipeVersion
{
    $recipe = Recipe::withoutTenancy()->where('slug', $slug)->sole();

    return RecipeVersion::withoutTenancy()
        ->where('recipe_id', $recipe->getKey())
        ->orderByDesc('version_number')
        ->sole();
}

it('divides a pack price down to one unit of the version yield', function (): void {
    expect(runRecipePricing())->toBe(0);

    $sauce = pricedVersion('fixture-garlic-sauce');

    /*
     * $5.00 for a 1 kg trade pack and $3.00 for a 300 g consumer bottle. Stored
     * as the per-kilo figures, which is what makes the two comparable: the pack
     * prices alone say B2C is the cheaper channel, and it is not.
     */
    expect((string) $sauce->b2b_price_amount)->toBe('5.000000')
        ->and((string) $sauce->b2c_price_amount)->toBe('10.000000')
        ->and($sauce->price_currency_code)->toBe('USD');
});

it('writes through the version service, so the lock bumps and the version stays a draft', function (): void {
    $before = pricedVersion('fixture-garlic-sauce');
    $lockBefore = (int) $before->lock_version;

    expect(runRecipePricing())->toBe(0);

    $after = pricedVersion('fixture-garlic-sauce');

    expect((int) $after->lock_version)->toBe($lockBefore + 1)
        ->and($after->status)->toBe(RecipeVersionStatus::Draft);
});

it('leaves a recipe alone when the linked item carries no price', function (): void {
    expect(runRecipePricing())->toBe(0);

    // `Fixture Piece Prep` is linked to `Fixture Frozen Fries`, a resale row the
    // fixture prices at nothing. No price is not a price of nothing.
    $pieces = pricedVersion('fixture-piece-prep');

    expect($pieces->b2b_price_amount)->toBeNull()
        ->and($pieces->b2c_price_amount)->toBeNull()
        ->and($pieces->price_currency_code)->toBeNull();
});

it('writes nothing on a dry run', function (): void {
    expect(runRecipePricing(['--dry-run' => true]))->toBe(0);

    $sauce = pricedVersion('fixture-garlic-sauce');

    expect($sauce->b2b_price_amount)->toBeNull()
        ->and($sauce->b2c_price_amount)->toBeNull();
});

it('fills an empty price but never overwrites one without being asked', function (): void {
    expect(runRecipePricing())->toBe(0);

    // A figure somebody typed by hand outranks the tariff, so a second run is a
    // no-op — the lock version is the proof that nothing was written at all.
    $edited = pricedVersion('fixture-garlic-sauce');
    $edited->b2b_price_amount = '9.500000';
    $edited->save();

    $lockAfterEdit = (int) pricedVersion('fixture-garlic-sauce')->lock_version;

    expect(runRecipePricing())->toBe(0);

    $rerun = pricedVersion('fixture-garlic-sauce');

    expect((string) $rerun->b2b_price_amount)->toBe('9.500000')
        ->and((int) $rerun->lock_version)->toBe($lockAfterEdit);

    // ...and --overwrite is how the operator says to take the tariff anyway.
    expect(runRecipePricing(['--overwrite' => true]))->toBe(0);

    expect((string) pricedVersion('fixture-garlic-sauce')->b2b_price_amount)->toBe('5.000000');
});
