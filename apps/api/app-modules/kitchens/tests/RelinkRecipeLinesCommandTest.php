<?php

declare(strict_types=1);

use Database\Seeders\KitchenReferenceSeeder;
use Healthy360\Ingredients\Models\Ingredient;
use Healthy360\Kitchens\Import\Runtime\ImportOptions;
use Healthy360\Kitchens\Import\Runtime\ImportReport;
use Healthy360\Kitchens\Import\Runtime\UnitMap;
use Healthy360\Kitchens\Import\V6\V6CatalogueWriter;
use Healthy360\Organisations\Database\Seeders\OrganisationTypeSeeder;
use Healthy360\Recipes\Enums\DerivationState;
use Healthy360\Recipes\Jobs\RecomputeRecipeDerivations;
use Healthy360\Recipes\Models\RecipeVersion;
use Healthy360\Recipes\Models\RecipeVersionLine;
use Healthy360\Recipes\Models\RecipeVersionOutput;
use Healthy360\ReferenceData\Database\Seeders\ReferenceDataSeeder;
use Healthy360\Tenancy\Database\DatabaseTenantContext;
use Healthy360\Tenancy\TenantContext;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Queue;

/*
|--------------------------------------------------------------------------
| kitchen:relink-recipe-lines
|--------------------------------------------------------------------------
|
| The maintenance half of the v6 recipe import: the writer skips an existing
| version wholesale, so a dictionary corrected after the sheets were imported
| never reaches the lines it was written for. This suite imports the synthetic
| fixture sheets with a dictionary that mints a duplicate raw material, then
| runs the command with the same dictionary aliased onto the platform library
| row instead — which is exactly the six-alias change the committed dictionary
| just made — and asserts the line moves, the version goes stale, the recompute
| is queued, and a second run is a genuine no-op.
|
| Same properties the DEC1 commands are held to: a dry run writes nothing, and
| applying twice is applying once.
|
*/

function relinkFixturePaths(): array
{
    return [
        'recipes' => __DIR__.'/Fixtures/v6/v6-recipes.json',
        'dictionary' => __DIR__.'/Fixtures/v6/v6-recipe-designations.json',
        'catalogue' => __DIR__.'/Fixtures/v6/v6-catalogue.json',
    ];
}

/**
 * The fixture dictionary with one extra alias — the C1 change in miniature.
 */
function relinkDictionaryAliasing(string $designation, string $target): string
{
    /** @var array{aliases: list<array<string, string>>} $document */
    $document = json_decode((string) file_get_contents(relinkFixturePaths()['dictionary']), true, flags: JSON_THROW_ON_ERROR);

    $document['aliases'][] = ['designation' => $designation, 'resolves_to' => $target];

    $path = sys_get_temp_dir().'/relink-dictionary-'.bin2hex(random_bytes(6)).'.json';
    file_put_contents($path, json_encode($document, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES));

    return $path;
}

/**
 * @param  array<string, mixed>  $options
 */
function runRelink(array $options = []): int
{
    return test()->artisan('kitchen:relink-recipe-lines', ['--org' => 'test-v6-kitchen'] + $options)->run();
}

/**
 * The counts one run recorded, and nothing else: the audit row is deleted by
 * the caller between runs so `sole()` always names the run under test.
 *
 * @return array<string, mixed>
 */
function relinkAuditMetadata(): array
{
    $row = DB::table('audit_logs')->where('action', 'catalogue.recipe_lines_relinked')->sole();

    /** @var array<string, mixed> $metadata */
    $metadata = json_decode((string) $row->metadata, true, flags: JSON_THROW_ON_ERROR);

    return $metadata;
}

function relinkForgetAudit(): void
{
    DB::table('audit_logs')->where('action', 'catalogue.recipe_lines_relinked')->delete();
}

/**
 * The sheet-1 line the fixture dictionary minted a tenant duplicate for.
 */
function relinkHotPasteLine(): RecipeVersionLine
{
    return RecipeVersionLine::withoutTenancy()
        ->where('source_designation', 'Fixture Hot Paste')
        ->sole();
}

/**
 * Pretend the kitchen is fully derived, so "went stale" is an assertion rather
 * than the state every imported version starts in.
 */
function relinkMarkEverythingCurrent(): void
{
    RecipeVersion::withoutTenancy()->update(['derivation_state' => DerivationState::Current->value]);
}

beforeEach(function (): void {
    $this->seed([ReferenceDataSeeder::class, KitchenReferenceSeeder::class, OrganisationTypeSeeder::class]);

    UnitMap::forget();

    config()->set('kitchens.import.environments', ['local', 'testing']);
    config()->set('kitchens.import.report_path', 'import-reports-test-'.bin2hex(random_bytes(6)));

    $paths = relinkFixturePaths();

    $options = new ImportOptions(
        sourceDirectory: $paths['catalogue'],
        organisationSlug: 'test-v6-kitchen',
        dryRun: false,
        validateOnly: false,
    );
    app(V6CatalogueWriter::class)->run($options, new ImportReport($options, 'testing'), $paths['catalogue']);

    // The world this command has to repair: sheets imported under a dictionary
    // that declares "Fixture Hot Paste" as a tenant raw material of its own.
    $this->artisan('kitchen:import-v6-recipes', [
        '--source' => $paths['recipes'],
        '--dictionary' => $paths['dictionary'],
        '--org' => 'test-v6-kitchen',
    ])->assertSuccessful();

    app(TenantContext::class)->clear();
    app(DatabaseTenantContext::class)->reset();

    // The test queue connection is `sync`, so an unfaked dispatch would run a
    // full re-derivation inside the command under test. Every test here fakes
    // again where it needs a fresh recording; this one stops the runs that are
    // only setting up a world from deriving it as a side effect.
    Queue::fake();
});

afterEach(function (): void {
    app(TenantContext::class)->clear();
    app(DatabaseTenantContext::class)->reset();

    foreach (glob(sys_get_temp_dir().'/relink-dictionary-*.json') ?: [] as $file) {
        unlink($file);
    }
});

it('re-points a line onto the library row the dictionary now names, and queues the recompute', function (): void {
    $crumb = Ingredient::withoutTenancy()->whereNull('organisation_id')->where('name_en', 'Crumb')->sole();
    $minted = Ingredient::withoutTenancy()->where('slug', 'fixture-hot-paste')->sole();

    $line = relinkHotPasteLine();
    expect($line->ingredient_id)->toBe((string) $minted->getKey());

    relinkMarkEverythingCurrent();
    Queue::fake();

    expect(runRelink(['--dictionary' => relinkDictionaryAliasing('Fixture Hot Paste', 'Crumb')]))->toBe(0);

    $relinked = relinkHotPasteLine();

    // The row it names changed; the formulation did not.
    expect($relinked->ingredient_id)->toBe((string) $crumb->getKey())
        ->and((string) $relinked->quantity)->toBe((string) $line->quantity)
        ->and($relinked->unit_id)->toBe($line->unit_id)
        ->and((string) $relinked->unit_cost_amount)->toBe((string) $line->unit_cost_amount);

    $version = RecipeVersion::withoutTenancy()->whereKey($relinked->recipe_version_id)->sole();

    expect($version->derivation_state)->toBe(DerivationState::Stale)
        // Only that version: nothing on the other two moved.
        ->and(RecipeVersion::withoutTenancy()->where('derivation_state', DerivationState::Stale->value)->count())->toBe(1);

    Queue::assertPushed(RecomputeRecipeDerivations::class, 1);

    // Compared loosely on purpose: jsonb hands an object's keys back in its own
    // order, and the order is not the contract here — the counts are.
    expect(relinkAuditMetadata())->toEqual([
        'versions_scanned' => 3,
        'lines_relinked' => 1,
        'outputs_written' => 0,
        'versions_marked' => 1,
        'still_unresolved_designations' => 0,
    ]);
});

it('changes nothing on a second run', function (): void {
    $dictionary = relinkDictionaryAliasing('Fixture Hot Paste', 'Crumb');

    runRelink(['--dictionary' => $dictionary]);

    $ingredientId = relinkHotPasteLine()->ingredient_id;

    relinkForgetAudit();
    relinkMarkEverythingCurrent();
    Queue::fake();

    expect(runRelink(['--dictionary' => $dictionary]))->toBe(0);

    expect(relinkHotPasteLine()->ingredient_id)->toBe($ingredientId)
        ->and(RecipeVersion::withoutTenancy()->where('derivation_state', DerivationState::Stale->value)->count())->toBe(0)
        ->and(relinkAuditMetadata())->toEqual([
            'versions_scanned' => 3,
            'lines_relinked' => 0,
            'outputs_written' => 0,
            'versions_marked' => 0,
            'still_unresolved_designations' => 0,
        ]);

    Queue::assertNothingPushed();
});

it('writes nothing at all on a dry run', function (): void {
    $line = relinkHotPasteLine();

    relinkMarkEverythingCurrent();
    Queue::fake();

    expect(runRelink([
        '--dictionary' => relinkDictionaryAliasing('Fixture Hot Paste', 'Crumb'),
        '--dry-run' => true,
    ]))->toBe(0);

    expect(relinkHotPasteLine()->ingredient_id)->toBe($line->ingredient_id)
        ->and(RecipeVersion::withoutTenancy()->where('derivation_state', DerivationState::Stale->value)->count())->toBe(0)
        ->and(DB::table('audit_logs')->where('action', 'catalogue.recipe_lines_relinked')->count())->toBe(0);

    Queue::assertNothingPushed();
});

it('reports a designation that resolves to nothing and leaves its line alone', function (): void {
    $line = relinkHotPasteLine();
    $lineId = (string) $line->getKey();

    // A dictionary entry withdrawn after the import is the honest shape of
    // this: the sheet text is still on the line and nothing answers to it.
    RecipeVersionLine::withoutTenancy()
        ->whereKey($lineId)
        ->update(['source_designation' => 'Fixture Demi Glace']);

    relinkMarkEverythingCurrent();

    $this->artisan('kitchen:relink-recipe-lines', [
        '--org' => 'test-v6-kitchen',
        '--dictionary' => relinkFixturePaths()['dictionary'],
    ])->expectsOutputToContain('Fixture Demi Glace')->assertSuccessful();

    expect(RecipeVersionLine::withoutTenancy()->whereKey($lineId)->sole()->ingredient_id)->toBe($line->ingredient_id)
        ->and(RecipeVersion::withoutTenancy()->where('derivation_state', DerivationState::Stale->value)->count())->toBe(0)
        ->and(relinkAuditMetadata()['still_unresolved_designations'])->toBe(1)
        ->and(relinkAuditMetadata()['lines_relinked'])->toBe(0);
});

it('gives a yield-less version the output its designation earns, at the mass it consumed', function (): void {
    $version = RecipeVersion::withoutTenancy()->where('source_ref', 'v6-recipes.json#Sheet3')->sole();

    // The world an import before the output rule existed left behind.
    RecipeVersionOutput::withoutTenancy()->where('recipe_version_id', $version->getKey())->delete();

    relinkMarkEverythingCurrent();
    Queue::fake();

    expect(runRelink(['--dictionary' => relinkFixturePaths()['dictionary']]))->toBe(0);

    $output = RecipeVersionOutput::withoutTenancy()->where('recipe_version_id', $version->getKey())->sole();

    expect((string) $output->output_quantity)->toBe('2.0000')
        ->and($output->unit_id)->toBe(UnitMap::idForCode('kg'))
        ->and($output->is_primary)->toBeTrue()
        ->and($output->ingredient_id)->toBe((string) Ingredient::withoutTenancy()->where('slug', 'fixture-no-yield')->sole()->getKey())
        ->and(RecipeVersion::withoutTenancy()->whereKey($version->getKey())->sole()->derivation_state)
        ->toBe(DerivationState::Stale)
        ->and(relinkAuditMetadata()['outputs_written'])->toBe(1);

    Queue::assertPushed(RecomputeRecipeDerivations::class, 1);
});

it('refuses to run outside the allowlisted environments', function (): void {
    config()->set('kitchens.import.environments', ['production']);

    $this->artisan('kitchen:relink-recipe-lines', ['--org' => 'test-v6-kitchen'])->assertFailed();

    expect(DB::table('audit_logs')->where('action', 'catalogue.recipe_lines_relinked')->count())->toBe(0);
});
