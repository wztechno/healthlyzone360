<?php

declare(strict_types=1);

use Database\Seeders\KitchenReferenceSeeder;
use Healthy360\Ingredients\Models\Ingredient;
use Healthy360\Ingredients\Services\IngredientNutritionImporter;
use Healthy360\ReferenceData\Database\Seeders\ReferenceDataSeeder;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

/*
|--------------------------------------------------------------------------
| ingredients:import-nutrition
|--------------------------------------------------------------------------
|
| The question the fingerprint exists to answer: when a corrected nutrition
| document has to be re-applied to a database that already holds the old one,
| which rows may be rewritten and which belong to whoever edited them?
|
| Every case below is one answer to it. A row still holding exactly what the
| last seeding wrote is the importer's to rewrite; a row somebody has typed a
| supplier's label into is not, and the difference is decided by a hash of the
| values rather than by a version stamp that would stay truthful through the
| very edit it has to catch.
|
| `beforeEach` seeds the two reference layers rather than the whole database:
| the platform ingredient library and its nutrition are all this command reads,
| and `$this->seed()` would build a demonstration world for each of seven cases
| to ignore.
|
*/

beforeEach(function (): void {
    $this->seed([ReferenceDataSeeder::class, KitchenReferenceSeeder::class]);
});

function nutritionImportRow(string $sourceRef): Ingredient
{
    return Ingredient::withoutTenancy()
        ->whereNull('organisation_id')
        ->where('source_ref', $sourceRef)
        ->sole();
}

/**
 * Edit a platform row the way nothing in the application can.
 *
 * Written through the query builder on purpose. The point of each case is a
 * row that already sits in a particular state — curated, stamped, unstamped,
 * derived — and reaching those states through the catalogue service would test
 * the service rather than the importer, and could not reach the unstamped one
 * at all.
 *
 * @param  array<string, mixed>  $attributes
 */
function nutritionImportSet(string $sourceRef, array $attributes): void
{
    DB::table('ingredients')->where('id', nutritionImportRow($sourceRef)->getKey())->update($attributes);
}

/**
 * The same envelope with one figure moved — the smallest edit that is
 * unambiguously an edit.
 *
 * @param  array<string, mixed>  $envelope
 * @return array<string, mixed>
 */
function nutritionImportEnvelopeWithEnergy(array $envelope, int $value): array
{
    /** @var list<array<string, mixed>> $amounts */
    $amounts = $envelope['amounts'];

    foreach ($amounts as $index => $amount) {
        if (($amount['nutrient_id'] ?? null) === 'energy') {
            $amounts[$index]['value'] = $value;
        }
    }

    $envelope['amounts'] = $amounts;

    return $envelope;
}

function nutritionImportEnergy(string $sourceRef): int|float
{
    /** @var array{amounts: list<array{nutrient_id: string, value: int|float}>} $envelope */
    $envelope = nutritionImportRow($sourceRef)->nutrition_per_100g;

    foreach ($envelope['amounts'] as $amount) {
        if ($amount['nutrient_id'] === 'energy') {
            return $amount['value'];
        }
    }

    throw new RuntimeException("[{$sourceRef}] carries no energy figure.");
}

/**
 * The counts the one run under test recorded, or null where it recorded
 * nothing — which is itself the assertion a dry run has to pass.
 *
 * @return array<string, mixed>|null
 */
function nutritionImportAudit(): ?array
{
    $row = DB::table('audit_logs')->where('action', 'catalogue.ingredient_nutrition_imported')->first();

    if ($row === null) {
        return null;
    }

    /** @var array<string, mixed> $metadata */
    $metadata = json_decode((string) $row->metadata, true, flags: JSON_THROW_ON_ERROR);

    return $metadata;
}

it('changes nothing when the library already holds what the document says', function (): void {
    // Ordered, so a failure reads as the row that moved rather than as two
    // arrays a sequential scan happened to hand back differently.
    $fingerprints = static fn (): array => Ingredient::withoutTenancy()
        ->whereNull('organisation_id')
        ->orderBy('source_ref')
        ->pluck('nutrition_seed_fingerprint', 'source_ref')
        ->all();

    // Packaging is in here too, with a NULL fingerprint each: the document has
    // no bin liners, so nothing ever stamped one. They are part of the
    // no-op — a run that started stamping them would be a run inventing facts.
    $before = $fingerprints();

    $this->artisan('ingredients:import-nutrition')
        ->expectsOutputToContain('Envelopes filled')
        ->assertSuccessful();

    // The seeder has already run once inside KitchenReferenceSeeder, so this is
    // the second application of the same document — and the property that makes
    // the command safe to run on a whim is that the second one is a no-op.
    expect($fingerprints())
        ->toBe($before)
        ->and(nutritionImportAudit())->toMatchArray([
            'overwrite' => false,
            'rows' => 306,
            'filled' => 0,
            'densities_filled' => 0,
            'rewritten' => 0,
            'left_curated' => 0,
            'left_derived' => 0,
            'skipped_unit_mismatch' => 0,
            'versions_marked' => 0,
        ]);
});

it('fills an emptied envelope on a plain run and stamps the fingerprint of what it wrote', function (): void {
    // A row as it would have arrived from the master seeder, on a database old
    // enough never to have been stamped.
    nutritionImportSet('ING-001', ['nutrition_per_100g' => null, 'nutrition_seed_fingerprint' => null]);

    $this->artisan('ingredients:import-nutrition')->assertSuccessful();

    $row = nutritionImportRow('ING-001');

    expect(nutritionImportEnergy('ING-001'))->toBe(53)
        ->and($row->nutrition_seed_fingerprint)
        ->toBe(IngredientNutritionImporter::fingerprint($row->nutrition_per_100g, $row->grams_per_unit))
        ->and(nutritionImportAudit())->toMatchArray(['filled' => 1, 'rewritten' => 0, 'left_curated' => 0]);
});

it('rewrites a row the document has moved on from and names it in the report', function (): void {
    $row = nutritionImportRow('ING-001');
    $seeded = nutritionImportEnvelopeWithEnergy($row->nutrition_per_100g, 1);

    // "The file moved on": the row holds exactly what the last seeding wrote —
    // proved by a fingerprint of those very figures — and the document now says
    // something else. Nobody has curated anything, so there is nothing to lose.
    nutritionImportSet('ING-001', [
        'nutrition_per_100g' => json_encode($seeded, JSON_THROW_ON_ERROR),
        'nutrition_seed_fingerprint' => IngredientNutritionImporter::fingerprint($seeded, $row->grams_per_unit),
    ]);

    $this->artisan('ingredients:import-nutrition', ['--overwrite' => true])
        ->expectsOutputToContain('Rows rewritten')
        ->expectsOutputToContain('ING-001')
        ->assertSuccessful();

    $rewritten = nutritionImportRow('ING-001');

    expect(nutritionImportEnergy('ING-001'))->toBe(53)
        ->and($rewritten->nutrition_seed_fingerprint)
        ->toBe(IngredientNutritionImporter::fingerprint($rewritten->nutrition_per_100g, $rewritten->grams_per_unit))
        ->and(nutritionImportAudit())->toMatchArray([
            'overwrite' => true,
            'rewritten' => 1,
            'left_curated' => 0,
        ]);
});

it('leaves a curated row exactly as somebody curated it', function (): void {
    $row = nutritionImportRow('ING-001');
    $stamped = (string) $row->nutrition_seed_fingerprint;
    $curated = nutritionImportEnvelopeWithEnergy($row->nutrition_per_100g, 1);

    // Only the figures move. The fingerprint still describes what the seeder
    // wrote, and that disagreement is the whole signal: somebody edited this.
    nutritionImportSet('ING-001', ['nutrition_per_100g' => json_encode($curated, JSON_THROW_ON_ERROR)]);

    $this->artisan('ingredients:import-nutrition', ['--overwrite' => true])
        ->expectsOutputToContain('Left curated')
        ->assertSuccessful();

    expect(nutritionImportEnergy('ING-001'))->toBe(1)
        ->and(nutritionImportRow('ING-001')->nutrition_seed_fingerprint)->toBe($stamped)
        ->and(nutritionImportAudit())->toMatchArray(['rewritten' => 0, 'left_curated' => 1]);
});

it('stamps a row seeded before the column existed rather than rewriting it', function (): void {
    // The 306 rows on every database deployed before C4: the right figures and
    // nothing to prove it with. A NULL fingerprint is the pre-column past, not
    // a curation signal, and resolving it must not cost the run a write.
    nutritionImportSet('ING-001', ['nutrition_seed_fingerprint' => null]);

    $this->artisan('ingredients:import-nutrition', ['--overwrite' => true])->assertSuccessful();

    $row = nutritionImportRow('ING-001');

    expect($row->nutrition_seed_fingerprint)
        ->toBe(IngredientNutritionImporter::fingerprint($row->nutrition_per_100g, $row->grams_per_unit))
        ->and(nutritionImportEnergy('ING-001'))->toBe(53)
        ->and(nutritionImportAudit())->toMatchArray(['rewritten' => 0, 'left_curated' => 0]);
});

it('writes nothing and audits nothing on a dry run', function (): void {
    $row = nutritionImportRow('ING-001');
    $seeded = nutritionImportEnvelopeWithEnergy($row->nutrition_per_100g, 1);
    $fingerprint = IngredientNutritionImporter::fingerprint($seeded, $row->grams_per_unit);

    nutritionImportSet('ING-001', [
        'nutrition_per_100g' => json_encode($seeded, JSON_THROW_ON_ERROR),
        'nutrition_seed_fingerprint' => $fingerprint,
    ]);

    // The same row the case above rewrites, so the only difference between the
    // two outcomes is the flag.
    $this->artisan('ingredients:import-nutrition', ['--overwrite' => true, '--dry-run' => true])
        ->expectsOutputToContain('Rows that would be rewritten')
        ->expectsOutputToContain('ING-001')
        ->assertSuccessful();

    expect(nutritionImportEnergy('ING-001'))->toBe(1)
        ->and(nutritionImportRow('ING-001')->nutrition_seed_fingerprint)->toBe($fingerprint)
        ->and(nutritionImportAudit())->toBeNull();
});

it('never writes a row whose facts a published recipe version derives', function (): void {
    $row = nutritionImportRow('ING-001');
    $derived = nutritionImportEnvelopeWithEnergy($row->nutrition_per_100g, 1);

    // No foreign key by design — Ingredients must not know what a recipe is —
    // so the column holds the version's identifier and nothing enforces it.
    nutritionImportSet('ING-001', [
        'nutrition_per_100g' => json_encode($derived, JSON_THROW_ON_ERROR),
        'nutrition_seed_fingerprint' => IngredientNutritionImporter::fingerprint($derived, $row->grams_per_unit),
        'nutrition_derived_from_version_id' => (string) Str::uuid7(),
    ]);

    // Fingerprinted as untouched *and* different from the document, which is
    // precisely the state --overwrite exists to rewrite. The derivation wins
    // anyway: the next recompute would overwrite the figure, and in between the
    // ingredient would disagree with the formulation that defines it.
    $this->artisan('ingredients:import-nutrition', ['--overwrite' => true])->assertSuccessful();

    expect(nutritionImportEnergy('ING-001'))->toBe(1)
        ->and(nutritionImportAudit())->toMatchArray([
            'left_derived' => 1,
            'rewritten' => 0,
            'left_curated' => 0,
        ]);
});
