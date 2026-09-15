<?php

declare(strict_types=1);

namespace Healthy360\Kitchens\Import\Runtime;

use Healthy360\Ingredients\Models\IngredientAlias;
use RuntimeException;

/**
 * The curated designation dictionary, read from
 * `app-modules/ingredients/database/data/kitchen-workbook-aliases.json`.
 *
 * **Human-authored, never algorithmic** (master plan v2 §4.11). There is no
 * fuzzy match anywhere in the import path, and this class is why: every
 * equivalence the importer believes was typed by somebody who read the
 * workbook. The reason is not tidiness. "Sweet Paprika", "Smoked Paprika" and
 * "Paprika" are three products; "Cripsy Spice" and "Crispy Spice" are one
 * product spelled two ways. No edit distance separates those two cases, and a
 * matcher that got it wrong would not produce a wrong report — it would produce
 * a wrong allergen label on a dish.
 *
 * The file ships with the **ingredients** module because that is the module
 * that owns designation resolution, even though the importer that reads it
 * lives here. Moving it would put a food-safety dictionary in the module that
 * happens to run the command rather than the one that owns the concept.
 *
 * A `tenant_ingredients` entry may carry two optional keys, both written onto
 * the minted row by {@see IngredientWriter} and both omitted rather than
 * guessed: `nutrition_per_100g`, the slim envelope `ingredients
 * .nutrition_per_100g` holds (basis `per_100g` plus a flat `amounts` list in
 * the canonical units), and `grams_per_unit`, the mass in grams of one
 * `default_unit`. The envelope's shape is checked here rather than at the
 * write: a malformed one is a broken *document*, and the document is refused
 * before a single row is created.
 *
 * @phpstan-type TenantIngredient array{name_en: string, slug: string, category_code: string|null, subcategory_code: string|null, default_unit: string, note: string|null, intermediate: bool, sheet_missing: bool, nutrition_per_100g: array<string, mixed>|null, grams_per_unit: numeric-string|null}
 */
final readonly class DesignationDictionary
{
    /**
     * @param  array<string, string>  $aliases  normalised designation → canonical `name_en`
     * @param  list<TenantIngredient>  $tenantIngredients
     * @param  array<string, string>  $recipeLinks  normalised product name → technical-sheet designation
     * @param  list<array{product: string, candidate: string, reason: string}>  $declinedLinks
     * @param  list<array{names: list<string>, reason: string}>  $neverMerge
     */
    private function __construct(
        private array $aliases,
        private array $tenantIngredients,
        private array $recipeLinks,
        private array $declinedLinks,
        private array $neverMerge,
    ) {}

    /**
     * @throws RuntimeException
     */
    public static function load(?string $path = null): self
    {
        $path ??= self::defaultPath();
        $raw = is_file($path) ? file_get_contents($path) : false;

        if ($raw === false) {
            throw new RuntimeException("The curated workbook designation dictionary was not found at [{$path}].");
        }

        /** @var array{aliases?: list<array<string, mixed>>, tenant_ingredients?: list<array<string, mixed>>, recipe_links?: list<array<string, mixed>>, recipe_links_declined?: list<array<string, mixed>>, never_merge?: list<array<string, mixed>>} $document */
        $document = json_decode($raw, true, flags: JSON_THROW_ON_ERROR);

        $aliases = [];

        foreach ($document['aliases'] ?? [] as $entry) {
            $designation = self::stringOf($entry, 'designation');
            $target = self::stringOf($entry, 'resolves_to');

            $aliases[IngredientAlias::normalise($designation)] = $target;
        }

        $tenant = [];

        foreach ($document['tenant_ingredients'] ?? [] as $entry) {
            $tenant[] = [
                'name_en' => self::stringOf($entry, 'name_en'),
                'slug' => self::stringOf($entry, 'slug'),
                'category_code' => self::nullableStringOf($entry, 'category_code'),
                'subcategory_code' => self::nullableStringOf($entry, 'subcategory_code'),
                'default_unit' => self::nullableStringOf($entry, 'default_unit') ?? 'kg',
                'note' => self::nullableStringOf($entry, 'note'),
                'intermediate' => (bool) ($entry['intermediate'] ?? false),
                'sheet_missing' => (bool) ($entry['sheet_missing'] ?? false),
                'nutrition_per_100g' => self::envelopeOf($entry),
                'grams_per_unit' => self::numericOf($entry, 'grams_per_unit'),
            ];
        }

        $recipeLinks = [];

        foreach ($document['recipe_links'] ?? [] as $entry) {
            $recipeLinks[IngredientAlias::normalise(self::stringOf($entry, 'product'))] = self::stringOf($entry, 'recipe');
        }

        $declined = [];

        foreach ($document['recipe_links_declined'] ?? [] as $entry) {
            $declined[] = [
                'product' => self::stringOf($entry, 'product'),
                'candidate' => self::stringOf($entry, 'candidate'),
                'reason' => self::stringOf($entry, 'reason'),
            ];
        }

        $neverMerge = [];

        foreach ($document['never_merge'] ?? [] as $entry) {
            /** @var list<string> $names */
            $names = array_values(array_map(strval(...), (array) ($entry['names'] ?? [])));

            $neverMerge[] = ['names' => $names, 'reason' => self::stringOf($entry, 'reason')];
        }

        return new self($aliases, $tenant, $recipeLinks, $declined, $neverMerge);
    }

    public static function defaultPath(): string
    {
        return base_path('app-modules/ingredients/database/data/kitchen-workbook-aliases.json');
    }

    /**
     * The canonical name a designation is curated onto, or null when the
     * dictionary is silent about it.
     */
    public function canonicalNameFor(string $designation): ?string
    {
        return $this->aliases[IngredientAlias::normalise($designation)] ?? null;
    }

    /**
     * @return array<string, string> normalised designation → canonical name
     */
    public function aliases(): array
    {
        return $this->aliases;
    }

    /**
     * @return list<TenantIngredient>
     */
    public function tenantIngredients(): array
    {
        return $this->tenantIngredients;
    }

    /**
     * The tenant ingredients the dictionary marks as intermediates with no
     * technical sheet behind them. They exist so that a line referencing them
     * resolves; **no recipe is fabricated for them** (master plan v2 §4.2), and
     * the known-gaps report names every one.
     *
     * @return list<TenantIngredient>
     */
    public function intermediatesWithoutSheets(): array
    {
        return array_values(array_filter(
            $this->tenantIngredients,
            static fn (array $row): bool => $row['sheet_missing'],
        ));
    }

    /**
     * The technical-sheet designation that makes a product, or null when the
     * dictionary declines the link.
     */
    public function recipeFor(string $product): ?string
    {
        return $this->recipeLinks[IngredientAlias::normalise($product)] ?? null;
    }

    /**
     * Product-to-recipe links a human looked at and refused. Recorded so a
     * later curator sees a decision rather than an omission.
     *
     * @return list<array{product: string, candidate: string, reason: string}>
     */
    public function declinedRecipeLinks(): array
    {
        return $this->declinedLinks;
    }

    /**
     * @return list<array{names: list<string>, reason: string}>
     */
    public function neverMerge(): array
    {
        return $this->neverMerge;
    }

    /**
     * @param  array<string, mixed>  $entry
     */
    private static function stringOf(array $entry, string $key): string
    {
        $value = $entry[$key] ?? null;

        if (! is_string($value) || trim($value) === '') {
            throw new RuntimeException("The designation dictionary has an entry with no '{$key}'.");
        }

        return trim($value);
    }

    /**
     * @param  array<string, mixed>  $entry
     */
    private static function nullableStringOf(array $entry, string $key): ?string
    {
        $value = $entry[$key] ?? null;

        return is_string($value) && trim($value) !== '' ? trim($value) : null;
    }

    /**
     * A declared per-100 g envelope, checked only for the two things the
     * database cannot check for itself: the basis it claims and the fact that
     * `amounts` is a list. The nutrient ids and units are deliberately not
     * validated here — `StoreIngredientRequest::nutritionRules()` owns that
     * vocabulary on the write path, and duplicating it would give the platform
     * two answers to the same question.
     *
     * @param  array<string, mixed>  $entry
     * @return array<string, mixed>|null
     *
     * @throws RuntimeException
     */
    private static function envelopeOf(array $entry): ?array
    {
        $value = $entry['nutrition_per_100g'] ?? null;

        if ($value === null) {
            return null;
        }

        $name = is_string($entry['name_en'] ?? null) ? $entry['name_en'] : '(unnamed)';

        $amounts = is_array($value) ? ($value['amounts'] ?? null) : null;

        if (! is_array($value) || ($value['basis'] ?? null) !== 'per_100g' || ! is_array($amounts) || ! array_is_list($amounts)) {
            throw new RuntimeException(
                "The designation dictionary declares nutrition for [{$name}] that is not a per_100g envelope with a list of amounts."
            );
        }

        /** @var array<string, mixed> $value */
        return $value;
    }

    /**
     * @param  array<string, mixed>  $entry
     * @return numeric-string|null
     *
     * @throws RuntimeException
     */
    private static function numericOf(array $entry, string $key): ?string
    {
        $value = $entry[$key] ?? null;

        if ($value === null) {
            return null;
        }

        if (! is_numeric($value)) {
            $name = is_string($entry['name_en'] ?? null) ? $entry['name_en'] : '(unnamed)';

            throw new RuntimeException("The designation dictionary gives [{$name}] a non-numeric '{$key}'.");
        }

        return (string) $value;
    }
}
