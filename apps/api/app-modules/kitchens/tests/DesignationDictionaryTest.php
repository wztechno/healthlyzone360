<?php

declare(strict_types=1);

use Database\Seeders\KitchenReferenceSeeder;
use Healthy360\Ingredients\Models\Ingredient;
use Healthy360\Ingredients\Models\IngredientAlias;
use Healthy360\Ingredients\Models\IngredientCategory;
use Healthy360\Kitchens\Import\Runtime\DesignationDictionary;
use Healthy360\ReferenceData\Database\Seeders\ReferenceDataSeeder;
use Healthy360\ReferenceData\Models\MeasurementUnit;

/*
|--------------------------------------------------------------------------
| The curated designation dictionary is data, and data can be wrong (K1.8)
|--------------------------------------------------------------------------
|
| `greenlife-aliases.json` is hand-written, which is the point — no fuzzy
| matcher decides what "Cripsy Spice" means. The cost of that decision is that
| a typo in the dictionary is a silent failure at import time: an alias
| pointing at an ingredient nobody creates simply stops resolving, and the run
| reports an unresolved designation without anybody realising the dictionary
| is at fault rather than the workbook.
|
| So the file is tested like code. Every alias must land on something, every
| category code must exist, every unit must be one the platform knows, and the
| merges a curator refused must still be refused.
|
*/

beforeEach(function (): void {
    $this->seed([ReferenceDataSeeder::class, KitchenReferenceSeeder::class]);
});

function dictionary(): DesignationDictionary
{
    return DesignationDictionary::load();
}

/**
 * Every name the import could resolve onto: the platform library, plus the
 * tenant rows the dictionary itself declares.
 *
 * @return list<string>
 */
function resolvableNames(): array
{
    $names = array_map(
        IngredientAlias::normalise(...),
        array_map(strval(...), Ingredient::withoutTenancy()
            ->whereNull('organisation_id')
            ->pluck('name_en')
            ->all()),
    );

    foreach (dictionary()->tenantIngredients() as $tenant) {
        $names[] = IngredientAlias::normalise($tenant['name_en']);
    }

    return array_values(array_unique($names));
}

it('resolves every curated alias onto something that will exist', function (): void {
    $resolvable = resolvableNames();
    $dangling = [];

    foreach (dictionary()->aliases() as $designation => $target) {
        if (! in_array(IngredientAlias::normalise($target), $resolvable, true)) {
            $dangling[] = $designation.' → '.$target;
        }
    }

    expect($dangling)->toBe([], 'These curated aliases point at an ingredient nothing creates: '.implode(', ', $dangling));
});

it('files every tenant ingredient under a category the platform taxonomy has', function (): void {
    /** @var list<string> $codes */
    $codes = IngredientCategory::withoutTenancy()->whereNull('organisation_id')->pluck('code')->all();
    $unknown = [];

    foreach (dictionary()->tenantIngredients() as $tenant) {
        foreach (['category_code', 'subcategory_code'] as $field) {
            $code = $tenant[$field];

            if ($code !== null && ! in_array($code, $codes, true)) {
                $unknown[] = $tenant['name_en'].'.'.$field.' = '.$code;
            }
        }
    }

    expect($unknown)->toBe([]);
});

it('measures every tenant ingredient in a unit the platform knows', function (): void {
    /** @var list<string> $units */
    $units = MeasurementUnit::query()->pluck('code')->all();
    $unknown = [];

    foreach (dictionary()->tenantIngredients() as $tenant) {
        if (! in_array($tenant['default_unit'], $units, true)) {
            $unknown[] = $tenant['name_en'].' → '.$tenant['default_unit'];
        }
    }

    expect($unknown)->toBe([]);
});

it('keeps every tenant slug and name distinct', function (): void {
    $slugs = array_map(static fn (array $row): string => $row['slug'], dictionary()->tenantIngredients());
    $names = array_map(
        static fn (array $row): string => IngredientAlias::normalise($row['name_en']),
        dictionary()->tenantIngredients(),
    );

    expect(array_diff_assoc($slugs, array_unique($slugs)))->toBe([])
        ->and(array_diff_assoc($names, array_unique($names)))->toBe([]);
});

it('keeps case-only aliases inert, and every other alias load-bearing', function (): void {
    $inert = [];
    $loadBearing = [];

    foreach (dictionary()->aliases() as $designation => $target) {
        // Normalisation already folds case and collapses whitespace, so
        // "Worcestershire sauce → Worcestershire Sauce" changes nothing about
        // resolution. Those entries stay in the file anyway: the dictionary is
        // the record of how the workbook spells things, and a reader looking up
        // why a designation resolved should find the answer there rather than
        // having to know what the normaliser does.
        $designation === IngredientAlias::normalise($target)
            ? $inert[] = $designation
            : $loadBearing[] = $designation;
    }

    expect($loadBearing)->not->toBeEmpty()
        ->and($inert)->not->toBeEmpty();

    // The load-bearing half is what actually has to be right: a designation
    // that does not resolve to itself must name a different ingredient.
    foreach ($loadBearing as $designation) {
        expect(dictionary()->canonicalNameFor($designation))->not->toBeNull();
    }
});

it('keeps the paprikas apart', function (): void {
    $dictionary = dictionary();
    $names = array_map(
        static fn (array $row): string => $row['name_en'],
        $dictionary->tenantIngredients(),
    );

    expect($names)->toContain('Sweet Paprika')
        ->and($names)->toContain('Smoked Paprika')

        // And neither is aliased onto the platform library's plain Paprika,
        // which is the merge that would put smoked paprika in a dish that
        // asked for sweet (risk R4).
        ->and($dictionary->canonicalNameFor('Sweet Paprika'))->toBeNull()
        ->and($dictionary->canonicalNameFor('Smoked Paprika'))->toBeNull();
});

it('records the merges and the recipe links a curator refused', function (): void {
    $dictionary = dictionary();

    expect($dictionary->neverMerge())->not->toBeEmpty()
        ->and($dictionary->declinedRecipeLinks())->not->toBeEmpty();

    foreach ($dictionary->neverMerge() as $set) {
        expect($set['names'])->toHaveCount(count(array_unique($set['names'])))
            ->and(count($set['names']))->toBeGreaterThan(1)
            ->and($set['reason'])->not->toBe('');
    }

    foreach ($dictionary->declinedRecipeLinks() as $declined) {
        expect($declined['reason'])->not->toBe('')
            ->and($dictionary->recipeFor($declined['product']))->toBeNull();
    }
});

it('marks exactly the intermediates that have no technical sheet', function (): void {
    $names = array_map(
        static fn (array $row): string => $row['name_en'],
        dictionary()->intermediatesWithoutSheets(),
    );

    sort($names);

    // Named rather than counted: these three are the appendix D known gap, and
    // a fourth appearing silently would mean a sheet stopped being read.
    expect($names)->toBe(['Butter Mix', 'Chicken Breast Marination', 'Mix Cheese Preparation']);
});
