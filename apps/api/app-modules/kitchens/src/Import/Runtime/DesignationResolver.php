<?php

declare(strict_types=1);

namespace Healthy360\Kitchens\Import\Runtime;

use Healthy360\Ingredients\Models\Ingredient;
use Healthy360\Ingredients\Models\IngredientAlias;

/**
 * Turns a raw-material designation from a workbook into an ingredient
 * identifier, or into an honest failure.
 *
 * The order is fixed and it matters:
 *
 * 1. **The curated dictionary.** A human decided that "Cripsy Spice" is
 *    "Crispy Spice"; nothing computed may overrule that.
 * 2. **The tenant's own ingredients**, by name and by alias. A kitchen that has
 *    edited an imported row — renamed it, added an alias — keeps resolving,
 *    which is the whole point of insert-if-absent.
 * 3. **The platform library**, by name and by alias.
 *
 * Nothing else. There is no substring match, no plural stripping, no
 * transliteration and no edit distance. A designation that reaches the end
 * unmatched is a **failure**, reported by name with every sheet it appears on,
 * and the line it belongs to is excluded from the import.
 *
 * **The deviation, stated plainly.** Everywhere else this system fails loudly
 * and refuses the whole operation. Here it does not: §4.11 asks the importer
 * for created / skipped / failed counts, which only means something if a run
 * continues past a failure. So an unresolved designation costs its own line and
 * flags its sheet incomplete — it does not abandon the file and it certainly
 * does not invent an ingredient. The alternative was one unknown spice
 * discarding twenty-eight correctly-read technical sheets, and an operator who
 * fixes one dictionary entry per run for a fortnight.
 */
final class DesignationResolver
{
    /** @var array<string, string> normalised designation → ingredient id */
    private array $index = [];

    /** @var array<string, string> normalised name → ingredient id, tenant rows only */
    private array $tenantByName = [];

    public function __construct(
        private readonly DesignationDictionary $dictionary,
        private readonly ?string $organisationId,
    ) {}

    /**
     * Build the lookup once. Called again after the importer creates the
     * tenant ingredients the dictionary declares, so the second pass sees them.
     */
    public function refresh(): void
    {
        $this->index = [];
        $this->tenantByName = [];

        $ingredients = Ingredient::withoutTenancy()
            ->where(function ($query): void {
                $query->whereNull('organisation_id');

                if ($this->organisationId !== null) {
                    $query->orWhere('organisation_id', $this->organisationId);
                }
            })
            // Platform rows first so a tenant row of the same name wins the
            // later write: a kitchen's own definition beats the library's.
            ->orderByRaw('organisation_id nulls first')
            ->get(['id', 'organisation_id', 'name_en']);

        foreach ($ingredients as $ingredient) {
            $key = IngredientAlias::normalise($ingredient->name_en);
            $this->index[$key] = (string) $ingredient->getKey();

            if ($ingredient->organisation_id !== null) {
                $this->tenantByName[$key] = (string) $ingredient->getKey();
            }
        }

        $aliases = IngredientAlias::query()
            ->whereIn('ingredient_id', $ingredients->modelKeys())
            ->get(['ingredient_id', 'alias_normalised']);

        foreach ($aliases as $alias) {
            // An alias never displaces a real name: two ingredients may
            // legitimately alias the same string, and the name is the stronger
            // claim.
            $this->index[$alias->alias_normalised] ??= $alias->ingredient_id;
        }
    }

    /**
     * The ingredient a designation names, or null.
     */
    public function resolve(string $designation): ?string
    {
        $curated = $this->dictionary->canonicalNameFor($designation);

        if ($curated !== null) {
            $key = IngredientAlias::normalise($curated);

            // The curated target is looked up as a *name*, tenant rows first.
            // Resolving it through the alias index would let one curated entry
            // chain into another and quietly build a merge nobody wrote down.
            $resolved = $this->tenantByName[$key] ?? $this->index[$key] ?? null;

            if ($resolved !== null) {
                return $resolved;
            }
        }

        return $this->index[IngredientAlias::normalise($designation)] ?? null;
    }

    /**
     * The identifier of an ingredient by its exact name — how the importer
     * finds the rows it has just created.
     */
    public function byName(string $name): ?string
    {
        $key = IngredientAlias::normalise($name);

        return $this->tenantByName[$key] ?? $this->index[$key] ?? null;
    }

    public function knows(string $designation): bool
    {
        return $this->resolve($designation) !== null;
    }
}
