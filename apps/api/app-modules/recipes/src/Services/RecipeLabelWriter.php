<?php

declare(strict_types=1);

namespace Healthy360\Recipes\Services;

use Healthy360\Ingredients\Enums\AllergenContainment;
use Healthy360\Recipes\Enums\AllergenDerivation;
use Healthy360\Recipes\Models\RecipeVersion;
use Healthy360\Recipes\Models\RecipeVersionAllergen;
use Healthy360\Recipes\Models\RecipeVersionLine;
use Illuminate\Database\Eloquent\Collection;

/**
 * The one place a frozen allergen label is written, fingerprinted and compared
 * against what it used to say.
 *
 * Extracted from `RecipeVersionService` in K1.8 rather than copied, and that is
 * the whole reason it exists. Publication freezes a label; the reactive
 * recompute (`RecomputeRecipeDerivations`) re-freezes it when the mappings
 * underneath move. Two implementations of "derived never weakens declared"
 * would be two answers to a food-safety question, and the one a diner reads
 * would depend on which code path last touched the row.
 *
 * Nothing here decides *whether* to write. It has no audit trail, no
 * transaction and no opinion about publication state: the callers own those,
 * because freezing a label is a decision and this is the arithmetic underneath
 * it.
 */
final readonly class RecipeLabelWriter
{
    /**
     * The longest a `review_reason` may be — `recipe_versions.review_reason` is
     * `varchar(200)`, and a sentence that overflowed the column would fail the
     * write rather than the quarantine, which is the wrong thing to lose.
     */
    private const int REASON_LIMIT = 200;

    /**
     * Write the frozen label.
     *
     * Declared rows survive: a chef who knows the fryer is shared has said
     * something no mapping implies, and a recomputation must not erase it. A
     * derived row replaces a declaration only when it is *stronger*, so the
     * label always carries the strongest claim anybody has made about each
     * class. Weakening a human's statement by computation is the one thing
     * this method will not do.
     *
     * @param  list<array{allergen_code: string, containment: AllergenContainment, source_ingredient_id: string, market_scopes: list<string>}>  $rolled
     */
    public function freeze(RecipeVersion $version, array $rolled, mixed $now): void
    {
        /** @var Collection<int, RecipeVersionAllergen> $existing */
        $existing = RecipeVersionAllergen::withoutTenancy()
            ->where('recipe_version_id', $version->getKey())
            ->get();

        /** @var array<string, RecipeVersionAllergen> $declared */
        $declared = $existing
            ->filter(static fn (RecipeVersionAllergen $row): bool => $row->derivation === AllergenDerivation::Declared)
            ->keyBy('allergen_code')
            ->all();

        foreach ($existing as $row) {
            if ($row->derivation === AllergenDerivation::Derived) {
                $row->delete();
            }
        }

        foreach ($rolled as $entry) {
            $incumbent = $declared[$entry['allergen_code']] ?? null;

            if ($incumbent !== null) {
                if ($entry['containment']->strength() <= $incumbent->containment->strength()) {
                    continue;
                }

                $incumbent->delete();
            }

            $row = new RecipeVersionAllergen;
            $row->recipe_version_id = (string) $version->getKey();
            $row->organisation_id = $version->organisation_id;
            $row->allergen_code = $entry['allergen_code'];
            $row->containment = $entry['containment'];
            $row->derivation = AllergenDerivation::Derived;
            $row->source_ingredient_id = $entry['source_ingredient_id'];

            // The market scopes live in the note rather than in a column: the
            // label is one row per class (UNIQUE on recipe_version_id,
            // allergen_code), so a scope column would either duplicate rows or
            // pick one scope and lose the rest. Recording them keeps a
            // US-only determination visible to a human reviewing the label.
            $row->source_note = 'Market scope: '.implode(', ', $entry['market_scopes']);
            $row->created_at = $now;
            $row->save();
        }
    }

    /**
     * What the label says right now, as class → containment.
     *
     * Deliberately flattens `declared` and `derived` into one map. The question
     * the quarantine asks is "has the promise to a diner changed", and a diner
     * reads one warning per class without caring which layer authored it. The
     * table's UNIQUE `(recipe_version_id, allergen_code)` is what makes one row
     * per class the honest shape rather than a lossy summary.
     *
     * @return array<string, AllergenContainment>
     */
    public function snapshot(RecipeVersion $version): array
    {
        /** @var array<string, AllergenContainment> $label */
        $label = [];

        $rows = RecipeVersionAllergen::withoutTenancy()
            ->where('recipe_version_id', $version->getKey())
            ->orderBy('allergen_code')
            ->get();

        foreach ($rows as $row) {
            $label[$row->allergen_code] = $row->containment;
        }

        return $label;
    }

    /**
     * How two labels differ, in the four ways that matter to a diner.
     *
     * Weakening is reported separately from strengthening even though both
     * quarantine, because they are different failures and a reviewer needs to
     * know which one happened. A label that gained `contains: peanut` was
     * under-declaring; a label that dropped to `may_contain` was
     * over-declaring, which costs a customer a menu option rather than an
     * ambulance — still a change to a published promise, still a human's
     * decision to accept.
     *
     * @param  array<string, AllergenContainment>  $before
     * @param  array<string, AllergenContainment>  $after
     * @return array{added: list<string>, removed: list<string>, strengthened: list<string>, weakened: list<string>}
     */
    public function diff(array $before, array $after): array
    {
        $added = array_values(array_diff(array_keys($after), array_keys($before)));
        $removed = array_values(array_diff(array_keys($before), array_keys($after)));

        $strengthened = [];
        $weakened = [];

        foreach ($after as $code => $containment) {
            $incumbent = $before[$code] ?? null;

            if ($incumbent === null || $incumbent === $containment) {
                continue;
            }

            $containment->strength() > $incumbent->strength()
                ? $strengthened[] = $code
                : $weakened[] = $code;
        }

        sort($added);
        sort($removed);
        sort($strengthened);
        sort($weakened);

        return ['added' => $added, 'removed' => $removed, 'strengthened' => $strengthened, 'weakened' => $weakened];
    }

    /**
     * The classes whose containment moved, either way — the shape the audit
     * event's `changed_allergen_classes` carries.
     *
     * @param  array{added: list<string>, removed: list<string>, strengthened: list<string>, weakened: list<string>}  $diff
     * @return list<string>
     */
    public function changedClasses(array $diff): array
    {
        $changed = array_values(array_unique([...$diff['strengthened'], ...$diff['weakened']]));
        sort($changed);

        return $changed;
    }

    /**
     * @param  array{added: list<string>, removed: list<string>, strengthened: list<string>, weakened: list<string>}  $diff
     */
    public function isMaterial(array $diff): bool
    {
        return $diff['added'] !== [] || $diff['removed'] !== [] || $diff['strengthened'] !== [] || $diff['weakened'] !== [];
    }

    /**
     * The quarantine reason, in the words a reviewer needs.
     *
     * A plain sentence naming the classes, because the person opening the
     * review queue is deciding whether a dish can go back on sale and "the
     * derivation changed" tells them nothing about what to check. The classes
     * are named rather than counted for the same reason.
     *
     * Truncated to the column's 200 characters rather than left to the
     * database: a label change on a formulation with a dozen moving classes is
     * exactly the case where the write must not fail, and a reason clipped with
     * an ellipsis still names the first and most urgent classes. The audit
     * event beside it carries the complete lists.
     *
     * @param  array{added: list<string>, removed: list<string>, strengthened: list<string>, weakened: list<string>}  $diff
     */
    public function describe(array $diff): string
    {
        $clauses = [];

        if ($diff['added'] !== []) {
            $clauses[] = 'now declares '.implode(', ', $diff['added']);
        }

        if ($diff['removed'] !== []) {
            $clauses[] = 'no longer declares '.implode(', ', $diff['removed']);
        }

        if ($diff['strengthened'] !== []) {
            $clauses[] = 'strengthened '.implode(', ', $diff['strengthened']);
        }

        if ($diff['weakened'] !== []) {
            $clauses[] = 'weakened '.implode(', ', $diff['weakened']);
        }

        return $this->fit('Allergen recompute changed the published label: '.implode('; ', $clauses).'.');
    }

    /**
     * A fingerprint of everything the label was computed from, so an identical
     * republish produces an identical hash and a changed input cannot
     * masquerade as an unchanged one.
     *
     * Ordered line tuples plus each line's effective allergen set — and
     * nothing else. No identifiers of the version, no timestamps, no actor:
     * two versions with the same formulation and the same mappings *are* the
     * same derivation, and a hash that said otherwise would make "has anything
     * really changed" unanswerable.
     *
     * @param  Collection<int, RecipeVersionLine>  $lines
     * @param  array<string, array<string, array{containment: AllergenContainment, market_scopes: list<string>}>>  $effective
     */
    public function derivationHash(Collection $lines, array $effective): string
    {
        $payload = [];

        foreach ($lines as $line) {
            $allergens = [];

            foreach ($effective[$line->ingredient_id] ?? [] as $code => $mapping) {
                $allergens[] = $code.':'.$mapping['containment']->value.':'.implode('|', $mapping['market_scopes']);
            }

            sort($allergens);

            $payload[] = [
                'line_number' => $line->line_number,
                'ingredient_id' => $line->ingredient_id,
                'quantity' => $line->quantity === null ? null : (string) $line->quantity,
                'unit_id' => $line->unit_id,
                'allergens' => $allergens,
            ];
        }

        return hash('sha256', json_encode($payload, JSON_THROW_ON_ERROR));
    }

    private function fit(string $sentence): string
    {
        return mb_strlen($sentence) <= self::REASON_LIMIT
            ? $sentence
            : mb_substr($sentence, 0, self::REASON_LIMIT - 1).'…';
    }
}
