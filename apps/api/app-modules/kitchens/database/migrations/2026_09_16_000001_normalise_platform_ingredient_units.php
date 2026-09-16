<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\DB;

/**
 * Every platform `ING-` ingredient stocks in kilograms or litres — the owner's unit table, September 2026.
 *
 * The seed document already says so: 293 rows in `kg`, 13 in `l`, and the purchase unit the same word as
 * the stock unit on all of them. A fresh install is therefore right before this runs, and this is a no-op
 * there. A database seeded earlier holds 25 rows in `piece`, `l`, `gallon`, `pack`, `bag` or `can`, and
 * the hard part is not those rows but everything denominated against them.
 *
 * ## Matched on three conditions, never the reference alone
 *
 * `organisation_id IS NULL`, `source_system = 'healthy360_platform'`, and a reference the table names. A
 * kitchen's fork takes the next `ING-` number in *its own* sequence with no source system, so a match on
 * the reference would rewrite a kitchen's row. The targets are read from the seed document rather than
 * restated here, so this and a fresh install cannot disagree about a row.
 *
 * ## One rule: restate what the data proves, never invent a weight
 *
 * A figure in unit U restates into the new unit T when U and T share a convertible dimension, or when T is
 * a mass and the ingredient's own `grams_per_unit` weighs U — ketchup's 1150 g a litre, an egg's 50 g. It is
 * the rule `kitchen:unit-report` applies, so the report lists exactly what this refuses.
 *
 * - **Cost balances.** A non-zero balance nothing can restate stops the migration before it changes
 *   anything: `ingredient_stock_costs` has no admin surface and no reset, and a receipt against a balance
 *   in a unit it cannot convert is refused for good. A bridged balance is restated with its averages moved
 *   the other way, so the value held does not change.
 * - **Shelves.** A non-zero level nothing can restate also stops it — count that shelf to zero first. A
 *   bridged shelf is restated with its thresholds. An empty shelf in a unit nothing restates takes the new
 *   unit and loses its thresholds, which were set in the old one. Movement history is not rewritten; it
 *   records what was counted at the time. Shelves already in a convertible unit, and shelves a resold
 *   product owns, are left as they are.
 * - **Recipe lines**, on every version not retired. A bridged line is restated in place, published
 *   versions included: the grams, the cost and so the label are the same figures, and a line left in
 *   litres against a kilogram ingredient would silently stop deducting from the shelf. A line nothing can
 *   weigh quarantines its version if it is a draft. A published version is left as it is — it keeps
 *   selling — and the report names it. Every version touched takes a new lock version, so an editor
 *   already open on it reloads rather than saving litres back over kilograms.
 *
 * `grams_per_unit` is cleared on every row that becomes a mass: a kilogram weighs what it weighs.
 *
 * Nothing is dispatched. The restated lines weigh and cost what they did, so there is no derivation to
 * redo, and a stale flag with no job behind it would put rows in the review queue nobody could clear.
 *
 * ## down() does nothing
 *
 * One-way for the data, like `merge_packaging_back_into_ingredients`. Putting the units back without the
 * lines, shelves and balances would produce a state neither side ever had, and it would look like a
 * rollback. Restore a backup to undo this.
 */
return new class extends Migration
{
    private const string SOURCE_SYSTEM = 'healthy360_platform';

    /** Dimensions whose `base_ratio` is a real factor. Mass is based on the gram, volume on the millilitre. */
    private const array CONVERTIBLE_DIMENSIONS = ['mass', 'volume'];

    private const int COST_SCALE = 6;

    private const int QUANTITY_SCALE = 4;

    private const int WORKING_SCALE = 12;

    /** @var Collection<string, object{id: string, code: string, dimension: string, base_ratio: string}> */
    private Collection $units;

    public function up(): void
    {
        $this->units = DB::table('measurement_units')->get(['id', 'code', 'dimension', 'base_ratio'])->keyBy('id');

        $moving = $this->movingIngredients();

        if ($moving === []) {
            return;
        }

        // Only a stock unit that changes moves anything denominated against it; a purchase unit alone does not.
        $restating = array_filter($moving, static fn (array $row): bool => $row['from'] !== $row['to']);

        $this->refuseWhatCannotBeRestated($restating);
        $this->restateCostBalances($restating);
        $this->restateShelves($restating);
        $this->restateRecipeLines($restating);

        foreach ($moving as $id => $ingredient) {
            DB::table('ingredients')->where('id', $id)->update([
                'default_unit_id' => $ingredient['to'],
                'purchase_unit_id' => $ingredient['to'],
                'grams_per_unit' => $this->unit($ingredient['to'])->dimension === 'mass' ? null : $ingredient['grams'],
                'lock_version' => DB::raw('lock_version + 1'),
                'updated_at' => now(),
            ]);
        }
    }

    public function down(): void
    {
        // Deliberately one-way; see the class docblock.
    }

    /**
     * The platform rows whose stock or purchase unit differs from the owner's table, keyed by id.
     *
     * @return array<string, array{ref: string, from: string|null, to: string, grams: string|null}>
     */
    private function movingIngredients(): array
    {
        $ingredients = DB::table('ingredients')
            ->whereNull('organisation_id')
            ->where('source_system', self::SOURCE_SYSTEM)
            ->where('source_ref', '~', '^ING-[0-9]+$')
            ->get(['id', 'source_ref', 'default_unit_id', 'purchase_unit_id', 'grams_per_unit']);

        // A fresh database: migrations run before the seeders, so there is no library and no unit table yet.
        if ($ingredients->isEmpty()) {
            return [];
        }

        $document = json_decode(
            (string) file_get_contents(dirname(__DIR__, 3).'/ingredients/database/data/platform-ingredients.json'),
            true,
            flags: JSON_THROW_ON_ERROR,
        );
        $targets = array_column($document['ingredients'], 'default_unit_code', 'source_ref');
        $unitIds = $this->units->pluck('id', 'code');
        $moving = [];

        foreach ($ingredients as $ingredient) {
            $code = $targets[$ingredient->source_ref] ?? null;

            // A reference the table no longer carries is not this migration's to move.
            if ($code === null) {
                continue;
            }

            $to = $unitIds[$code] ?? throw new RuntimeException("The unit table names a unit this database does not have [{$code}].");

            if ($ingredient->default_unit_id === $to && $ingredient->purchase_unit_id === $to) {
                continue;
            }

            $moving[(string) $ingredient->id] = [
                'ref' => (string) $ingredient->source_ref,
                'from' => $ingredient->default_unit_id,
                'to' => $to,
                'grams' => $ingredient->grams_per_unit === null ? null : (string) $ingredient->grams_per_unit,
            ];
        }

        return $moving;
    }

    /**
     * Stop before anything changes if a held quantity would be stranded.
     *
     * @param  array<string, array{ref: string, from: string|null, to: string, grams: string|null}>  $restating
     */
    private function refuseWhatCannotBeRestated(array $restating): void
    {
        $stranded = [];

        foreach (
            DB::table('ingredient_stock_costs')
                ->whereIn('ingredient_id', array_keys($restating))
                ->where('quantity_on_hand', '!=', 0)
                ->get(['ingredient_id', 'unit_id', 'quantity_on_hand']) as $cost
        ) {
            $ingredient = $restating[$cost->ingredient_id];

            if ($this->factor($cost->unit_id, $ingredient) === null) {
                $stranded[] = sprintf('%s: a cost balance of %s %s', $ingredient['ref'], $cost->quantity_on_hand, $this->unit($cost->unit_id)->code);
            }
        }

        foreach ($this->shelves($restating) as $shelf) {
            $ingredient = $restating[$shelf->ingredient_id];

            if ($shelf->unit_id !== null && $this->factor($shelf->unit_id, $ingredient) !== null) {
                continue;
            }

            $held = DB::table('stock_levels')->where('stock_item_id', $shelf->id)->where('quantity', '!=', 0)->exists();

            if ($held) {
                $stranded[] = sprintf('%s: shelf %s holds stock counted in %s', $ingredient['ref'], $shelf->code, $shelf->unit_code);
            }
        }

        if ($stranded !== []) {
            throw new RuntimeException(
                "Platform ingredient units were not normalised, and nothing was changed. These are held in a unit no recorded weight converts to the new one:\n  - "
                .implode("\n  - ", $stranded)
                ."\nCount each shelf to zero before running this. A cost balance has no reset in the app and needs a deliberate write-off. `php artisan kitchen:unit-report` lists every row with its value.",
            );
        }
    }

    /**
     * @param  array<string, array{ref: string, from: string|null, to: string, grams: string|null}>  $restating
     */
    private function restateCostBalances(array $restating): void
    {
        foreach (
            DB::table('ingredient_stock_costs')
                ->whereIn('ingredient_id', array_keys($restating))
                ->get(['id', 'ingredient_id', 'unit_id', 'quantity_on_hand', 'moving_average_cost_amount', 'last_purchase_cost_amount']) as $cost
        ) {
            $ingredient = $restating[$cost->ingredient_id];

            if ($this->needsNoRestatement($cost->unit_id, $ingredient['to'])) {
                continue;
            }

            $factor = $this->factor($cost->unit_id, $ingredient);

            // Empty, and in a unit nothing converts: the next receipt starts the balance again on its own.
            if ($factor === null) {
                continue;
            }

            DB::table('ingredient_stock_costs')->where('id', $cost->id)->update([
                'unit_id' => $ingredient['to'],
                'quantity_on_hand' => $this->times((string) $cost->quantity_on_hand, $factor, self::COST_SCALE),
                'moving_average_cost_amount' => $this->per($cost->moving_average_cost_amount, $factor),
                'last_purchase_cost_amount' => $this->per($cost->last_purchase_cost_amount, $factor),
                'updated_at' => now(),
            ]);
        }
    }

    /**
     * @param  array<string, array{ref: string, from: string|null, to: string, grams: string|null}>  $restating
     */
    private function restateShelves(array $restating): void
    {
        foreach ($this->shelves($restating) as $shelf) {
            $ingredient = $restating[$shelf->ingredient_id];

            if ($shelf->unit_id !== null && $this->needsNoRestatement($shelf->unit_id, $ingredient['to'])) {
                continue;
            }

            $factor = $shelf->unit_id === null ? null : $this->factor($shelf->unit_id, $ingredient);

            foreach (DB::table('stock_levels')->where('stock_item_id', $shelf->id)->get(['id', 'quantity', 'reorder_threshold', 'par_level']) as $level) {
                DB::table('stock_levels')->where('id', $level->id)->update($factor === null
                    // Refused above unless empty, so there is no quantity to carry — only thresholds nobody can restate.
                    ? ['reorder_threshold' => null, 'par_level' => null, 'updated_at' => now()]
                    : [
                        'quantity' => $this->times((string) $level->quantity, $factor, self::QUANTITY_SCALE),
                        'reorder_threshold' => $level->reorder_threshold === null ? null : $this->times((string) $level->reorder_threshold, $factor, self::QUANTITY_SCALE),
                        'par_level' => $level->par_level === null ? null : $this->times((string) $level->par_level, $factor, self::QUANTITY_SCALE),
                        'updated_at' => now(),
                    ]);
            }

            DB::table('stock_items')->where('id', $shelf->id)->update([
                'unit_id' => $ingredient['to'],
                'unit_code' => $this->unit($ingredient['to'])->code,
                'updated_at' => now(),
            ]);
        }
    }

    /**
     * @param  array<string, array{ref: string, from: string|null, to: string, grams: string|null}>  $restating
     */
    private function restateRecipeLines(array $restating): void
    {
        $lines = DB::table('recipe_version_lines')
            ->join('recipe_versions', 'recipe_versions.id', '=', 'recipe_version_lines.recipe_version_id')
            ->whereIn('recipe_version_lines.ingredient_id', array_keys($restating))
            ->whereNotNull('recipe_version_lines.unit_id')
            ->where('recipe_versions.status', '!=', 'retired')
            ->orderBy('recipe_version_lines.line_number')
            ->get([
                'recipe_version_lines.id',
                'recipe_version_lines.ingredient_id',
                'recipe_version_lines.unit_id',
                'recipe_version_lines.quantity',
                'recipe_version_lines.unit_cost_amount',
                'recipe_version_lines.line_number',
                'recipe_versions.id as version_id',
                'recipe_versions.status as version_status',
            ]);

        $touched = [];
        $unweighable = [];

        foreach ($lines as $line) {
            $ingredient = $restating[$line->ingredient_id];

            if ($this->needsNoRestatement($line->unit_id, $ingredient['to'])) {
                continue;
            }

            $factor = $this->factor($line->unit_id, $ingredient);
            $quantity = $factor === null || $line->quantity === null
                ? null
                : $this->times((string) $line->quantity, $factor, self::QUANTITY_SCALE);

            // A quantity too small to state in the new unit is as unweighable as no weight at all.
            if ($factor === null || ($quantity !== null && bccomp($quantity, '0', self::QUANTITY_SCALE) <= 0)) {
                if ($line->version_status === 'draft') {
                    $unweighable[$line->version_id][] = $line->line_number;
                }

                continue;
            }

            DB::table('recipe_version_lines')->where('id', $line->id)->update([
                'quantity' => $quantity,
                'unit_id' => $ingredient['to'],
                'unit_cost_amount' => $this->per($line->unit_cost_amount, $factor),
                'updated_at' => now(),
            ]);

            $touched[$line->version_id] = true;
        }

        foreach ($unweighable as $versionId => $lineNumbers) {
            DB::table('recipe_versions')->where('id', $versionId)->update([
                'status' => 'review_required',
                'review_reason' => mb_substr(sprintf(
                    'Stock units changed to kg or l: line %s has no recorded weight in its old unit. Restate it in the new unit.',
                    implode(', ', array_unique($lineNumbers)),
                ), 0, 200),
            ]);

            $touched[$versionId] = true;
        }

        if ($touched !== []) {
            DB::table('recipe_versions')->whereIn('id', array_keys($touched))->update([
                'lock_version' => DB::raw('lock_version + 1'),
                'updated_at' => now(),
            ]);
        }
    }

    /**
     * The shelves derivation keeps for these ingredients, with their unit resolved. A resold product's
     * shelf measures itself in what the product is bought in, so it is not the ingredient's to move.
     *
     * @param  array<string, array{ref: string, from: string|null, to: string, grams: string|null}>  $restating
     * @return Collection<int, object{id: string, code: string, ingredient_id: string, unit_id: string|null}>
     */
    private function shelves(array $restating): Collection
    {
        $unitIds = $this->units->pluck('id', 'code');

        return DB::table('stock_items')
            ->whereIn('ingredient_id', array_keys($restating))
            ->whereNull('catalogue_item_id')
            ->get(['id', 'code', 'ingredient_id', 'unit_id', 'unit_code'])
            ->map(static function (object $shelf) use ($unitIds): object {
                $shelf->unit_id ??= $unitIds[$shelf->unit_code] ?? null;

                return $shelf;
            });
    }

    /** Already in the new unit, or in one that converts to it by a real ratio — every reader handles it. */
    private function needsNoRestatement(string $unitId, string $toId): bool
    {
        return $unitId === $toId || $this->convertible($this->unit($unitId), $this->unit($toId));
    }

    /**
     * How many of the ingredient's new unit one `$unitId` is, or null when nothing recorded proves it.
     *
     * @param  array{ref: string, from: string|null, to: string, grams: string|null}  $ingredient
     * @return numeric-string|null
     */
    private function factor(string $unitId, array $ingredient): ?string
    {
        $from = $this->unit($unitId);
        $to = $this->unit($ingredient['to']);

        if ($from->id === $to->id) {
            return '1';
        }

        if ($this->convertible($from, $to)) {
            return bcdiv((string) $from->base_ratio, (string) $to->base_ratio, self::WORKING_SCALE);
        }

        $default = $ingredient['from'] === null ? null : $this->units->get($ingredient['from']);

        if ($ingredient['grams'] === null || bccomp($ingredient['grams'], '0', self::WORKING_SCALE) <= 0
            || $default === null || $to->dimension !== 'mass') {
            return null;
        }

        if ($from->id !== $default->id && ! $this->convertible($from, $default)) {
            return null;
        }

        // One `$from` in the old stock unit, weighed by that unit's grams, stated in the new unit's grams.
        $inDefault = $from->id === $default->id
            ? '1'
            : bcdiv((string) $from->base_ratio, (string) $default->base_ratio, self::WORKING_SCALE);

        return bcdiv(bcmul($inDefault, $ingredient['grams'], self::WORKING_SCALE), (string) $to->base_ratio, self::WORKING_SCALE);
    }

    private function convertible(object $from, object $to): bool
    {
        return $from->dimension === $to->dimension && in_array($from->dimension, self::CONVERTIBLE_DIMENSIONS, true);
    }

    /** @return object{id: string, code: string, dimension: string, base_ratio: string} */
    private function unit(string $id): object
    {
        return $this->units->get($id) ?? throw new RuntimeException("A row references a measurement unit that does not exist [{$id}].");
    }

    /**
     * @param  numeric-string  $factor
     * @return numeric-string
     */
    private function times(string $value, string $factor, int $scale): string
    {
        return $this->round(bcmul($value, $factor, self::WORKING_SCALE), $scale);
    }

    /**
     * A price per old unit, per new unit — the value of a unit's worth does not change.
     *
     * @param  numeric-string  $factor
     * @return numeric-string|null
     */
    private function per(mixed $amount, string $factor): ?string
    {
        return $amount === null ? null : $this->round(bcdiv((string) $amount, $factor, self::WORKING_SCALE), self::COST_SCALE);
    }

    /**
     * Half away from zero, once, the rule the stock and cost arithmetic uses everywhere else.
     *
     * @return numeric-string
     */
    private function round(string $value, int $scale): string
    {
        $half = bcdiv(str_starts_with($value, '-') ? '-5' : '5', bcpow('10', (string) ($scale + 1)), $scale + 1);

        return bcadd($value, $half, $scale);
    }
};
