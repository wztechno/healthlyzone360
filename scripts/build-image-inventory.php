<?php

declare(strict_types=1);

/**
 * Builds the authoritative image inventory — the single source of truth for
 * "which records need a photograph".
 *
 * ## Why this exists rather than a count in a plan
 *
 * Coverage claims are only honest against an enumerated list. The platform
 * ingredient library is one document, but recipes are imported from a private
 * workbook and meals from the catalogue, so "every ingredient and recipe" is
 * not a question any single committed file answers.
 *
 * ## Why PHP rather than Python
 *
 * Recipe slugs are `Str::slug($designation)` (TechnicalSheetWriter.php:236),
 * and Laravel's slugger is not interchangeable with anyone else's — `Sweet &
 * Sour Sauce` becomes `sweet-sour-sauce` here and `sweet-and-sour-sauce` under
 * most other implementations. Getting that wrong produces an image file that
 * never resolves and a gap nothing detects. So the inventory is built with the
 * same slugger the importer uses, and the sourcing pipeline only ever *reads*
 * slugs from it.
 *
 * Ingredient slugs are taken verbatim, because the seeder does the same:
 * IngredientMasterSeeder.php:228 reads `slug` from the document rather than
 * deriving it.
 *
 * ## What is deliberately not here
 *
 * The demonstration world is off by default outside the test suite (owner
 * decision 2026-08-26, `DatabaseSeeder::demoWorld()`) — "the development world
 * is the one real kitchen". Its ingredients and recipes are test fixtures, not
 * platform data, so they are not enumerated and not required to carry a
 * photograph. Under `SEED_DEMO_WORLD=true` they fall back to the generated
 * pattern placeholder, which is the designed behaviour for an unmapped record.
 *
 * The private recipe source is read for designations only. Nothing numeric —
 * no formulation, no yield, no cost — reaches the output. That is the same line
 * `v6-recipe-designations.json` already draws, and the reason names and slugs
 * are safe to commit while the workbook is not.
 *
 * Usage: php scripts/build-image-inventory.php [--recipes=PATH] [--check]
 */

require __DIR__ . '/../apps/api/vendor/autoload.php';

use Illuminate\Support\Str;

const OUT = __DIR__ . '/../apps/universal/assets/images/image-inventory.json';

/**
 * @return array<string, mixed>
 */
function readJson(string $path): array
{
    if (! is_file($path)) {
        fwrite(STDERR, "missing input: {$path}\n");
        exit(1);
    }

    $decoded = json_decode((string) file_get_contents($path), true, 512, JSON_THROW_ON_ERROR);

    return is_array($decoded) ? $decoded : [];
}

$args = array_slice($argv, 1);
$check = in_array('--check', $args, true);
$recipesPath = __DIR__ . '/../apps/api/storage/app/v6-recipes.json';

foreach ($args as $arg) {
    if (str_starts_with($arg, '--recipes=')) {
        $recipesPath = substr($arg, strlen('--recipes='));
    }
}

/** @var list<array<string, mixed>> $records */
$records = [];

/* ---- Ingredients: the platform library, slugs verbatim ------------------- */

$platform = readJson(__DIR__ . '/../apps/api/app-modules/ingredients/database/data/platform-ingredients.json');

foreach ($platform['ingredients'] as $row) {
    $records[] = [
        'ref' => $row['source_ref'],
        'kind' => 'ingredient',
        'name_en' => $row['name_en'],
        'slug' => $row['slug'],
        'scope' => 'platform',
        'category' => $row['category_code'] ?? null,
        'subcategory' => $row['subcategory_code'] ?? null,
        'family' => 'ingredients',
        'variants' => ['thumb'],
    ];
}

/* ---- Ingredients: raw materials the recipe import declares --------------- */

$designations = readJson(__DIR__ . '/../apps/api/app-modules/kitchens/database/data/v6-recipe-designations.json');

foreach ($designations['tenant_ingredients'] as $index => $row) {
    $records[] = [
        'ref' => sprintf('TIN-%03d', $index + 1),
        'kind' => 'ingredient',
        'name_en' => $row['name_en'],
        'slug' => $row['slug'],
        'scope' => 'tenant',
        'category' => $row['category_code'] ?? null,
        'subcategory' => $row['subcategory_code'] ?? null,
        'family' => 'ingredients',
        'variants' => ['thumb'],
    ];
}

/* ---- Recipes: private designations, slugged exactly as the importer does -- */

$recipes = readJson($recipesPath);

foreach ($recipes['sheets'] as $sheet) {
    $designation = $sheet['designation'];

    $records[] = [
        'ref' => 'RCP-' . Str::slug($designation),
        'kind' => 'recipe',
        'name_en' => $designation,
        'slug' => Str::slug($designation),
        'scope' => 'tenant',
        'category' => $sheet['family'] ?? null,
        'subcategory' => null,
        'family' => 'dishes',
        'variants' => ['card', 'detail'],
    ];
}

/* ---- Meals: the catalogue rows that currently borrow a photograph -------- */

$catalogue = readJson(__DIR__ . '/../apps/api/app-modules/kitchens/database/data/v6-catalogue.json');

foreach ($catalogue['items'] as $item) {
    if (($item['sheet_item_type'] ?? null) !== 'meal') {
        continue;
    }

    $records[] = [
        'ref' => $item['source_ref'],
        'kind' => 'meal',
        'name_en' => $item['name_en'],
        'slug' => $item['slug'],
        'scope' => 'tenant',
        'category' => $item['kitchen_category'] ?? null,
        'subcategory' => $item['kitchen_subcategory'] ?? null,
        'family' => 'meals',
        'variants' => ['card', 'detail'],
    ];
}

/* ---- Integrity: a duplicate key silently collapses two records onto one --- */

$seen = [];

foreach ($records as $record) {
    $key = $record['family'] . '/' . $record['slug'];

    if (isset($seen[$key])) {
        fwrite(STDERR, "duplicate image key {$key}: {$seen[$key]} and {$record['ref']}\n");
        exit(1);
    }

    $seen[$key] = $record['ref'];
}

usort($records, static fn (array $a, array $b): int => [$a['kind'], $a['slug']] <=> [$b['kind'], $b['slug']]);

$counts = array_count_values(array_column($records, 'kind'));
ksort($counts);

$fileCount = array_sum(array_map(static fn (array $r): int => count($r['variants']), $records));

$payload = [
    '_comment' => 'AUTOGENERATED by scripts/build-image-inventory.php — do not edit by hand. '
        . 'The authoritative list of records that need a photograph, and the exact slug each image '
        . 'file must be named after. Recipe slugs come from Laravel Str::slug, the same slugger '
        . 'TechnicalSheetWriter uses; ingredient slugs are verbatim from the seed document. Names '
        . 'and slugs only — no formulation and no cost reaches this file, so it is safe to commit '
        . 'while the source workbook is not. Regenerate: php scripts/build-image-inventory.php',
    'generated_by' => 'scripts/build-image-inventory.php',
    'counts' => $counts,
    'records_total' => count($records),
    'files_expected' => $fileCount,
    'records' => $records,
];

$json = json_encode($payload, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE) . "\n";
$existing = is_file(OUT) ? (string) file_get_contents(OUT) : null;

if ($existing === $json) {
    printf("unchanged  image-inventory.json (%d records)\n", count($records));
    exit(0);
}

if ($check) {
    fwrite(STDERR, "DRIFT  image-inventory.json is out of date. Run: php scripts/build-image-inventory.php\n");
    exit(1);
}

file_put_contents(OUT, $json);

printf(
    "written    image-inventory.json (%d records %s, %d files expected)\n",
    count($records),
    json_encode($counts),
    $fileCount,
);
