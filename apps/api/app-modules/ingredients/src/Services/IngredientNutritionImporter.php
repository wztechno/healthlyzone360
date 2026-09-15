<?php

declare(strict_types=1);

namespace Healthy360\Ingredients\Services;

use Healthy360\Ingredients\Database\Seeders\IngredientMasterSeeder;
use Healthy360\Ingredients\Models\Ingredient;
use Healthy360\ReferenceData\Database\Seeders\SeedDataFile;
use Illuminate\Support\Facades\DB;
use RuntimeException;
use Throwable;

/**
 * Apply `platform-ingredient-nutrition.json` to the platform ingredient
 * library: the row logic, extracted from the seeder that used to hold it.
 *
 * Two callers, one behaviour. `IngredientNutritionSeeder` calls
 * `apply(overwrite: false)` on every deployment, and
 * `ingredients:import-nutrition` calls it on demand — with `--overwrite` when
 * the document itself has changed, and `--dry-run` when somebody wants the
 * report before the writes. The seeder and the command cannot drift because
 * there is nothing left in either of them to drift.
 *
 * ## Fill-empty, per column, independently
 *
 * Insert-if-absent (risk R8): a null column takes the document's value and a
 * filled one keeps what it has. The columns are decided separately — an
 * ingredient can have curated nutrition and no density, or the reverse, and
 * neither answer blocks the other.
 *
 * The two provenance columns — `nutrition_estimated` and `nutrition_note` —
 * follow the same rule with one addition: a pass that writes or rewrites the
 * envelope writes them whatever they held, because they describe the figures
 * that just landed rather than the row. See the block that sets them.
 *
 * ## Overwrite rewrites only what nobody has touched
 *
 * `--overwrite` is not an upsert. A row is rewritten only when its stored
 * fingerprint still matches a fingerprint of its current values, which is the
 * one thing that means "this row is exactly what the last seeding put here".
 * A row somebody has curated has a fingerprint that no longer matches, and it
 * is left alone and counted, whatever the document now says: reference data is
 * a starting point and a supplier's label beats it.
 *
 * A NULL fingerprint is the pre-column past rather than a curation signal, and
 * it is resolved conservatively — the row is stamped from its own current
 * values, but only when those are still exactly what the document would write.
 * Anything else is treated as curated. So the first `--overwrite` after this
 * column ships rewrites nothing; it establishes the baseline the next one reads.
 *
 * ## The density is written only while the unit still agrees
 *
 * `grams_per_unit` is grams per one `default_unit`, and the document states
 * which unit each figure was measured against (`grams_per_unit_of`). If a
 * kitchen has since re-stocked soya sauce by the millilitre, writing 1080 would
 * be wrong by a factor of a thousand and would look exactly like a correct row.
 * Those rows are skipped and counted, never relabelled — the same rule
 * `IngredientCatalogueService::update()` applies from the other end.
 *
 * ## Derived rows belong to their recipe
 *
 * A row whose facts a published recipe version derives is that recipe's to
 * state. Reference data must not write over a derivation: the next recompute
 * would overwrite the figure anyway, and in between the ingredient would
 * disagree with the formulation that defines it.
 *
 * ## It invalidates what it changed, after the commit
 *
 * A published version's derived figures are only as good as the ingredient
 * facts behind them, so every row whose facts this run changed is pushed
 * through {@see IngredientDerivationInvalidator}. Never a row that only had its
 * fingerprint stamped — nothing downstream can have moved. Never on a dry run,
 * and never inside the transaction: a queued recompute that raced a rollback
 * would derive a version from facts that no longer exist.
 */
final readonly class IngredientNutritionImporter
{
    /**
     * The seven nutrients an envelope carries, in the order they are written:
     * document key → `nutrient_id` and its canonical unit.
     *
     * Canonical, not merely conventional. The roll-up that reads these treats
     * an ingredient stating energy in kJ as unusable rather than converting it,
     * so the unit written here is part of the contract and not a label.
     * `saturated_fat` is absent because the source table has no column for it,
     * and a nutrient nobody supplied must be missing rather than zero.
     *
     * @var array<string, array{string, string}>
     */
    private const array NUTRIENTS = [
        'energy_kcal' => ['energy', 'kcal'],
        'protein_g' => ['protein', 'g'],
        'carbohydrate_g' => ['carbohydrate', 'g'],
        'fat_g' => ['fat', 'g'],
        'fibre_g' => ['fibre', 'g'],
        'sugars_g' => ['sugars', 'g'],
        'sodium_mg' => ['sodium', 'mg'],
    ];

    public function __construct(
        private IngredientDerivationInvalidator $invalidator,
    ) {}

    /**
     * "Is this row still exactly what the seeder wrote?" — the hash that decides it.
     *
     * The one place the fingerprint is computed, because a second copy would be
     * the kind of duplicate that diverges in exactly the branch nobody tests:
     * both columns, in one hash, in a canonical form.
     *
     * **Canonical means the keys are sorted.** PostgreSQL stores `jsonb` with
     * object keys ordered by length and then bytewise, so the envelope this
     * class writes (`nutrient_id`, `unit`, `value`) comes back from the database
     * as (`unit`, `value`, `nutrient_id`). Hashing the written order would make
     * every row read as curated on the very next run — the values identical, the
     * bytes not. Sorting recursively makes the hash a function of the content,
     * which is the only thing it is supposed to be about. Amounts are a list and
     * keep their order.
     *
     * The density arrives already canonical: the model's `decimal:4` cast
     * renders it as `1080.0000` whether it was just assigned or just read.
     *
     * **Callers pass the model's own accessors** — `$ingredient->nutrition_per_100g`
     * and `$ingredient->grams_per_unit`, never a raw column or a hand-built
     * array. Both casts are what make the two sides of the comparison the same
     * shape, and the sorting above is what makes the side that came back from
     * `jsonb` agree with the side that never left memory.
     *
     * **`nutrition_estimated` and `nutrition_note` are deliberately not in it.**
     * The question this hash answers is "are these *figures* still the ones we
     * seeded", and the two provenance columns are not figures: nothing
     * downstream computes with them, and a note somebody reworded — or an
     * operator ticking "this one is an estimate" — is not a curated *value* and
     * must not make the row unrewritable. Folding them in would also break every
     * fingerprint already stamped on a deployed database, for nothing. They are
     * written beside the envelope instead, on the runs that own it.
     *
     * @param  array<string, mixed>|null  $envelope
     * @param  numeric-string|null  $gramsPerUnit
     */
    public static function fingerprint(?array $envelope, ?string $gramsPerUnit): string
    {
        return hash('sha256', (string) json_encode(
            [self::canonical($envelope), $gramsPerUnit],
            JSON_THROW_ON_ERROR,
        ));
    }

    /**
     * Apply the document to the library and say what happened.
     *
     * One transaction for the whole pass, rolled back on a dry run, and driven
     * by hand for the reason the kitchen commands state: a closure that rolls
     * back the transaction its own wrapper is about to commit is a trick rather
     * than a control flow.
     */
    public function apply(bool $overwrite, bool $dryRun = false): IngredientNutritionImportReport
    {
        $document = SeedDataFile::documentIn(dirname(__DIR__, 2).'/database/data', 'platform-ingredient-nutrition');
        $rows = SeedDataFile::rowList($document, 'ingredients');

        $library = Ingredient::withoutTenancy()
            ->whereNull('organisation_id')
            ->where('source_system', IngredientMasterSeeder::SOURCE_SYSTEM)
            ->with('defaultUnit')
            ->get()
            ->keyBy('source_ref');

        $filled = 0;
        $densities = 0;
        $unitMismatches = 0;
        $estimated = 0;
        $rewritten = 0;
        $leftCurated = 0;
        $leftDerived = 0;

        /** @var list<string> $rewrittenRefs */
        $rewrittenRefs = [];

        /** @var list<Ingredient> $touched */
        $touched = [];

        DB::beginTransaction();

        try {
            foreach ($rows as $row) {
                $sourceRef = SeedDataFile::string($row, 'source_ref');
                $ingredient = $library->get($sourceRef);

                if (! $ingredient instanceof Ingredient) {
                    throw new RuntimeException(
                        "Nutrition document names ingredient [{$sourceRef}], which the platform library does not carry."
                    );
                }

                if ($row['estimated'] ?? false) {
                    $estimated++;
                }

                // No platform row is ever in this position — outputs are a
                // kitchen's own intermediates — so this is a guard against the
                // day one is, not a case being handled.
                if ($ingredient->nutrition_derived_from_version_id !== null) {
                    $leftDerived++;

                    continue;
                }

                $fileEnvelope = $this->envelope($row);
                $documentGrams = $row['grams_per_unit'] ?? null;
                $unitAgrees = $ingredient->defaultUnit?->code === ($row['grams_per_unit_of'] ?? null);

                $currentEnvelope = $ingredient->nutrition_per_100g;
                $currentGrams = $ingredient->grams_per_unit;
                $stored = $ingredient->nutrition_seed_fingerprint;

                // Asked before anything is written, because a fill changes the
                // very values the answer is about.
                $untouched = $stored !== null && $stored === self::fingerprint($currentEnvelope, $currentGrams);

                $wrote = false;
                // Tracked separately from `$wrote`, which also goes true for a
                // density: the provenance below describes the *envelope*, so it
                // is the envelope's own writes that own it.
                $wroteEnvelope = false;

                if ($currentEnvelope === null) {
                    $ingredient->nutrition_per_100g = $fileEnvelope;
                    $filled++;
                    $wrote = true;
                    $wroteEnvelope = true;
                }

                if (is_numeric($documentGrams) && ($currentGrams === null || $overwrite)) {
                    if (! $unitAgrees) {
                        // Counted whenever the figure was in play: on a fill
                        // because the column is empty and cannot be filled, and
                        // under --overwrite because the drift is worth naming
                        // even where a stale figure is already sitting there.
                        $unitMismatches++;
                    } elseif ($currentGrams === null) {
                        $ingredient->grams_per_unit = (string) $documentGrams;
                        $densities++;
                        $wrote = true;
                    }
                }

                if ($overwrite && $untouched) {
                    $changed = false;

                    if ($currentEnvelope !== null && self::canonical($currentEnvelope) !== self::canonical($fileEnvelope)) {
                        $ingredient->nutrition_per_100g = $fileEnvelope;
                        $changed = true;
                        $wroteEnvelope = true;
                    }

                    if ($currentGrams !== null && $unitAgrees && is_numeric($documentGrams)
                        && ! $this->sameDensity($currentGrams, $documentGrams)) {
                        $ingredient->grams_per_unit = (string) $documentGrams;
                        $changed = true;
                    }

                    if ($changed) {
                        $rewritten++;
                        $rewrittenRefs[] = $sourceRef;
                        $wrote = true;
                    }
                }

                /*
                 * The provenance travels with the figures it describes.
                 *
                 * Two moments own it. A pass that **wrote or rewrote the
                 * envelope** owns both columns outright: the sentence and the
                 * flag are about the numbers that just landed, so carrying the
                 * previous row's ones over would leave a note describing a
                 * figure that is no longer there. And a **plain run over a row
                 * still holding exactly the file's envelope** fills whichever
                 * column is still NULL — that is the fill-empty rule the rest of
                 * this class applies, reaching the 306 rows seeded before these
                 * columns existed without disturbing anything an operator has
                 * since said about them.
                 *
                 * Per column, independently, for the same reason the envelope
                 * and the density are: an operator who ticked "estimated" and
                 * left the sentence blank has answered one question, not both.
                 *
                 * Deliberately does **not** set `$wrote`. Nothing derives from
                 * either column — no roll-up reads them, no label is computed
                 * from them — so marking a published version stale over a note
                 * would queue a recompute that cannot change a single number.
                 */
                if ($wroteEnvelope || self::canonical($ingredient->nutrition_per_100g) === self::canonical($fileEnvelope)) {
                    if ($wroteEnvelope || $ingredient->nutrition_estimated === null) {
                        $ingredient->nutrition_estimated = (bool) ($row['estimated'] ?? false);
                    }

                    if ($wroteEnvelope || $ingredient->nutrition_note === null) {
                        // Straight through at the document's own length. The
                        // column holds 300 and the longest note in the file is
                        // 58, so a truncation here would only ever fire on a
                        // document nobody has reviewed — and silently shortening
                        // a caveat is worse than the loud write that refuses it.
                        $note = $row['note'] ?? null;
                        $ingredient->nutrition_note = is_string($note) && trim($note) !== '' ? trim($note) : null;
                    }
                }

                // Stamped from what the row holds *now*, after whatever this
                // pass wrote, and only while that is exactly what the document
                // says. Asked of the row rather than of which branch ran,
                // because the two disagree in the case that matters: a run that
                // fills an empty density beside an envelope somebody curated has
                // written something, and stamping on the strength of that would
                // record the curation as pristine and let the next --overwrite
                // destroy it. A row the document has no density for is compared
                // against NULL, and so is one whose unit no longer agrees —
                // there is no figure to hold in either case, and a row holding
                // one anyway is a curation.
                //
                // This is also what resolves a NULL fingerprint: a row seeded
                // before the column existed is stamped where it still matches
                // and treated as curated where it does not, without anything
                // being rewritten to make it so.
                if (self::canonical($ingredient->nutrition_per_100g) === self::canonical($fileEnvelope)
                    && $this->sameDensity($ingredient->grams_per_unit, $unitAgrees ? $documentGrams : null)) {
                    // Read back through the casts, so the stamp is of the
                    // canonical form the next run will see.
                    $ingredient->nutrition_seed_fingerprint = self::fingerprint(
                        $ingredient->nutrition_per_100g,
                        $ingredient->grams_per_unit,
                    );
                } elseif ($overwrite) {
                    // Only `--overwrite` was offering to change these figures,
                    // so only `--overwrite` can be said to have left them.
                    $leftCurated++;
                }

                if (! $ingredient->isDirty()) {
                    continue;
                }

                $ingredient->save();

                if ($wrote) {
                    $touched[] = $ingredient;
                }
            }

            $dryRun ? DB::rollBack() : DB::commit();
        } catch (Throwable $exception) {
            DB::rollBack();

            throw $exception;
        }

        [$versions, $organisations] = $dryRun ? [0, 0] : $this->invalidate($touched);

        return new IngredientNutritionImportReport(
            rows: count($rows),
            filled: $filled,
            rewritten: $rewritten,
            leftCurated: $leftCurated,
            leftDerived: $leftDerived,
            skippedUnitMismatch: $unitMismatches,
            densitiesFilled: $densities,
            estimated: $estimated,
            versionsMarked: $versions,
            organisationsReached: $organisations,
            rewrittenRefs: $rewrittenRefs,
        );
    }

    /**
     * The slim per-100 g envelope `ingredients.nutrition_per_100g` holds, in
     * the shape `StoreIngredientRequest::nutritionRules()` validates on the
     * write path: a basis and a flat list of amounts, nothing nested.
     *
     * @param  array<array-key, mixed>  $row
     * @return array{basis: string, amounts: list<array{nutrient_id: string, unit: string, value: float|int}>}
     */
    private function envelope(array $row): array
    {
        $amounts = [];

        foreach (self::NUTRIENTS as $key => [$nutrientId, $unit]) {
            $value = $row[$key] ?? null;

            if (! is_int($value) && ! is_float($value)) {
                throw new RuntimeException(sprintf(
                    'Nutrition document row [%s] has no numeric [%s].',
                    SeedDataFile::string($row, 'source_ref'),
                    $key,
                ));
            }

            $amounts[] = ['nutrient_id' => $nutrientId, 'unit' => $unit, 'value' => $value];
        }

        return ['basis' => 'per_100g', 'amounts' => $amounts];
    }

    /**
     * Is the stored density the document's figure?
     *
     * Compared numerically rather than as strings: the column is `decimal:4`
     * and reads back as `1080.0000`, while the document states `1080`. Both
     * NULL is a match — the 286 rows the document has no density for, sitting
     * beside a column nobody has filled, are as untouched as a row can be.
     *
     * @param  numeric-string|null  $current  as the `decimal:4` cast renders it
     */
    private function sameDensity(?string $current, mixed $document): bool
    {
        if ($current === null || ! is_numeric($document)) {
            return $current === null && ! is_numeric($document);
        }

        return bccomp($current, (string) $document, 4) === 0;
    }

    /**
     * The same value with every object's keys in one fixed order.
     *
     * @see self::fingerprint() for why this exists at all.
     */
    private static function canonical(mixed $value): mixed
    {
        if (! is_array($value)) {
            return $value;
        }

        $canonical = array_map(static fn (mixed $item): mixed => self::canonical($item), $value);

        ksort($canonical);

        return $canonical;
    }

    /**
     * Mark every derivation built on the rows this run changed.
     *
     * The layer passed is the row's own owner, which is NULL for all 306 of
     * them: a change to a platform ingredient's facts reaches every kitchen
     * that uses it, so the invalidator fans out across tenants rather than
     * marking inside the (absent) console context.
     *
     * The second figure is the widest single fan-out rather than the union:
     * the invalidator reports how many organisations a change reached, never
     * which, so there is nothing to take a union of. It is a sense of scale for
     * an operator watching the run, and the version count beside it is exact.
     *
     * @param  list<Ingredient>  $ingredients
     * @return array{0: int, 1: int} versions marked, widest fan-out
     */
    private function invalidate(array $ingredients): array
    {
        $versions = 0;
        $organisations = 0;

        foreach ($ingredients as $ingredient) {
            [$marked, $reached] = $this->invalidator->invalidate($ingredient, $ingredient->organisation_id);

            $versions += count($marked);
            $organisations = max($organisations, $reached);
        }

        return [$versions, $organisations];
    }
}
