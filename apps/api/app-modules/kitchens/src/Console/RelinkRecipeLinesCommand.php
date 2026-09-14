<?php

declare(strict_types=1);

namespace Healthy360\Kitchens\Console;

use Healthy360\Audit\Services\AuditRecorder;
use Healthy360\Ingredients\Models\Ingredient;
use Healthy360\Kitchens\Console\Concerns\RunsInsideOneKitchen;
use Healthy360\Kitchens\Import\Runtime\DesignationDictionary;
use Healthy360\Kitchens\Import\Runtime\DesignationResolver;
use Healthy360\Kitchens\Import\Runtime\RecipeOutputRule;
use Healthy360\Recipes\Enums\DerivationState;
use Healthy360\Recipes\Enums\RecipeVersionStatus;
use Healthy360\Recipes\Jobs\RecomputeRecipeDerivations;
use Healthy360\Recipes\Models\Recipe;
use Healthy360\Recipes\Models\RecipeVersion;
use Healthy360\Recipes\Models\RecipeVersionLine;
use Healthy360\Recipes\Models\RecipeVersionOutput;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\DB;
use Throwable;

/**
 * Apply the *current* designation dictionary to recipe lines an earlier import
 * already wrote.
 *
 * **Why this exists.** `TechnicalSheetWriter` is idempotent at the version: a
 * sheet whose version is already in the database is skipped whole, lines and
 * outputs included, because those rows carry no source reference of their own
 * and rewriting them would be exactly the operator-edit clobbering
 * insert-if-absent exists to prevent. That is the right default and it has one
 * consequence: a correction to the dictionary, or to the output rule, never
 * reaches the kitchen it was written for. Six designations were just pointed at
 * platform library rows instead of minted duplicates, and the yield-less output
 * rule was decided after the sheets were imported. Re-running the importer
 * changes neither. This command is how a curated decision reaches the rows.
 *
 * **Published versions are re-pointed too, and that is deliberate.** Everywhere
 * else a published version is frozen, because a label a diner has already been
 * shown must stay reconstructable. This is not an edit to a formulation: the
 * quantities, units and costs are untouched, and the line goes on naming the
 * same raw material the sheet always named. What changes is *which database row
 * that name is stored against* — from a duplicate this importer minted to the
 * library row the kitchen confirmed it was all along. The version's lines were
 * always meant to name these rows; leaving a published version pointing at an
 * orphaned duplicate would keep its allergen and nutrition derivation reading
 * from a row nobody maintains, which is the opposite of preserving the label.
 * Retired versions are left alone: they are history, not a promise still being
 * kept.
 *
 * **Never onto packaging.** The resolver builds its index with
 * `excludingPackaging()`, so no designation can resolve to a packaging row and
 * this command inherits the guarantee rather than restating it.
 *
 * **A designation that resolves to nothing is reported, not guessed at.** Same
 * deviation the importer states: no substring match, no edit distance, and
 * certainly no invented ingredient. The line keeps whatever it has and the
 * designation is named in the report with the number of lines waiting on it.
 *
 * **Recompute is dispatched per touched version**, not routed through
 * `RecipeIngredientUsageRegistry::markDependentDerivationsStale()`. That method
 * asks a different question — "which versions consume *this ingredient*" — and
 * answering it once per re-pointed line would walk the kitchen repeatedly to
 * arrive at a set this loop already holds exactly. The effect is the same one it
 * produces: mark stale synchronously, queue the recompute, and let the job's
 * `ShouldBeUnique` key collapse whatever duplicates a burst produces.
 */
final class RelinkRecipeLinesCommand extends Command
{
    use RunsInsideOneKitchen;

    private const string DICTIONARY_FILE = 'v6-recipe-designations.json';

    protected $signature = 'kitchen:relink-recipe-lines
        {--org=healthzone360-kitchen : The kitchen organisation whose recipe lines to re-resolve}
        {--dictionary= : Override the committed curated dictionary (used by tests)}
        {--dry-run : Report what would change and write nothing}';

    protected $description = 'Re-resolve imported recipe lines and outputs through the current designation dictionary.';

    private int $versionsScanned = 0;

    private int $linesRelinked = 0;

    private int $outputsWritten = 0;

    /** @var array<string, true> version id → marked, deduplicated */
    private array $touched = [];

    /** @var array<string, array{designation: string, lines: int}> */
    private array $unresolved = [];

    /** @var list<array{version: string, designation: string, detail: string}> */
    private array $log = [];

    /** @var array<string, string> ingredient id → name, so the report reads in words */
    private array $names = [];

    public function handle(AuditRecorder $audit): int
    {
        $this->reset();

        if ($this->refusesThisEnvironment('kitchen:relink-recipe-lines')) {
            return self::FAILURE;
        }

        $organisation = $this->resolveOrganisation();

        if ($organisation === null) {
            return self::FAILURE;
        }

        try {
            $dictionary = DesignationDictionary::load($this->dictionaryPath());
        } catch (Throwable $exception) {
            $this->components->error('The designation dictionary could not be read.');
            $this->line('  '.$exception->getMessage());

            return self::FAILURE;
        }

        $dryRun = (bool) $this->option('dry-run');

        $this->components->info(sprintf(
            'Relink recipe lines — mode: %s · organisation: %s · environment: %s',
            $dryRun ? 'dry-run' : 'live',
            $organisation->slug,
            $this->laravel->environment(),
        ));
        $this->line('  Dictionary: '.$this->dictionaryPath());
        $this->line('');

        $this->insideOrganisation($organisation, function (string $organisationId) use ($dictionary, $dryRun): void {
            $resolver = new DesignationResolver($dictionary, $organisationId);
            $resolver->refresh();

            // One transaction for the whole pass, rolled back on a dry run, and
            // driven by hand for the reason the DEC1 commands state: a closure
            // that rolls back the transaction its own wrapper is about to commit
            // is a trick rather than a control flow.
            DB::beginTransaction();

            try {
                $this->relink($resolver, $organisationId);

                $dryRun ? DB::rollBack() : DB::commit();
            } catch (Throwable $exception) {
                DB::rollBack();

                throw $exception;
            }

            $this->render($dryRun);

            // After the commit, never inside it. A queued recompute that raced a
            // rollback would derive a version from lines that no longer point
            // where the job was told they do — and on a dry run there is nothing
            // to recompute at all.
            if ($dryRun) {
                return;
            }

            foreach (array_keys($this->touched) as $versionId) {
                RecomputeRecipeDerivations::dispatch($versionId, $organisationId);
            }
        });

        if (! $dryRun) {
            // Counts only. Which row a line was moved onto is confidential
            // formulation detail, and an audit trail is not where it belongs.
            $audit->record(
                'catalogue.recipe_lines_relinked',
                subjectType: 'organisation',
                subjectId: (string) $organisation->getKey(),
                metadata: [
                    'versions_scanned' => $this->versionsScanned,
                    'lines_relinked' => $this->linesRelinked,
                    'outputs_written' => $this->outputsWritten,
                    'versions_marked' => count($this->touched),
                    'still_unresolved_designations' => count($this->unresolved),
                ],
            );
        }

        return self::SUCCESS;
    }

    /**
     * Artisan resolves a command once and reuses the instance, so two runs in
     * one process would otherwise share these — and a second run inheriting the
     * first run's touched set re-queues a recompute of the whole kitchen.
     */
    private function reset(): void
    {
        $this->versionsScanned = 0;
        $this->linesRelinked = 0;
        $this->outputsWritten = 0;
        $this->touched = [];
        $this->unresolved = [];
        $this->log = [];
        $this->names = [];
    }

    private function relink(DesignationResolver $resolver, string $organisationId): void
    {
        /** @var array<string, string> $designations recipe id → the sheet designation the recipe is named after */
        $designations = [];

        $versions = RecipeVersion::withoutTenancy()
            ->where('organisation_id', $organisationId)
            ->where('status', '!=', RecipeVersionStatus::Retired->value)
            ->orderBy('recipe_id')
            ->orderBy('version_number')
            ->get();

        if ($versions->isNotEmpty()) {
            /** @var array<string, string> $designations */
            $designations = Recipe::withoutTenancy()
                ->whereIn('id', $versions->pluck('recipe_id')->unique())
                ->pluck('name_en', 'id')
                ->all();
        }

        foreach ($versions as $version) {
            $this->versionsScanned++;

            $designation = $designations[(string) $version->recipe_id] ?? null;

            $changed = $this->relinkLines($version, $resolver, $designation);

            if ($designation !== null) {
                $changed = $this->writeMissingOutput($version, $resolver, $designation, $organisationId) || $changed;
            }

            if ($changed) {
                $this->touched[(string) $version->getKey()] = true;
            }
        }

        if ($this->touched === []) {
            return;
        }

        // Marked synchronously: a label whose basis has just moved must not look
        // current for even one read.
        RecipeVersion::withoutTenancy()
            ->whereIn('id', array_keys($this->touched))
            ->where('derivation_state', '!=', DerivationState::Stale->value)
            ->update([
                'derivation_state' => DerivationState::Stale->value,
                'updated_at' => now(),
            ]);
    }

    /**
     * Re-resolve every line that carries the sheet text it came from.
     *
     * Quantity, unit and cost are not touched — the formulation is the sheet's
     * and this command has no opinion about it.
     */
    private function relinkLines(RecipeVersion $version, DesignationResolver $resolver, ?string $designation): bool
    {
        $changed = false;

        $lines = RecipeVersionLine::withoutTenancy()
            ->where('recipe_version_id', $version->getKey())
            ->whereNotNull('source_designation')
            ->orderBy('line_number')
            ->get();

        foreach ($lines as $line) {
            $sourceDesignation = (string) $line->source_designation;
            $target = $resolver->resolve($sourceDesignation);

            if ($target === null) {
                $key = mb_strtolower(trim($sourceDesignation));
                $this->unresolved[$key] ??= ['designation' => $sourceDesignation, 'lines' => 0];
                $this->unresolved[$key]['lines']++;

                continue;
            }

            if ($target === $line->ingredient_id) {
                continue;
            }

            $this->log[] = [
                'version' => sprintf('%s v%d', $designation ?? '(unnamed recipe)', $version->version_number),
                'designation' => $sourceDesignation,
                'detail' => sprintf('%s → %s', $this->nameOf((string) $line->ingredient_id), $this->nameOf($target)),
            ];

            $line->ingredient_id = $target;
            $line->save();

            $this->linesRelinked++;
            $changed = true;
        }

        return $changed;
    }

    /**
     * The output row the current rule says this version should have, for a
     * version imported before the rule said so.
     *
     * Only ever an insert. A version that already has an output row states what
     * it produces, and replacing that would be the clobbering this command is at
     * pains to avoid everywhere else.
     */
    private function writeMissingOutput(RecipeVersion $version, DesignationResolver $resolver, string $designation, string $organisationId): bool
    {
        $exists = RecipeVersionOutput::withoutTenancy()
            ->where('recipe_version_id', $version->getKey())
            ->exists();

        if ($exists) {
            return false;
        }

        $rule = RecipeOutputRule::for($resolver, $version, $designation, $organisationId);

        if ($rule->findingCode !== null) {
            $this->log[] = [
                'version' => sprintf('%s v%d', $designation, $version->version_number),
                'designation' => $rule->findingCode,
                'detail' => (string) $rule->findingDetail,
            ];
        }

        if (! $rule->writesOutput()) {
            return false;
        }

        $rule->write();

        $this->outputsWritten++;

        return true;
    }

    private function nameOf(string $ingredientId): string
    {
        return $this->names[$ingredientId] ??= (string) (Ingredient::withoutTenancy()
            ->whereKey($ingredientId)
            ->value('name_en') ?? $ingredientId);
    }

    private function render(bool $dryRun): void
    {
        $this->section($dryRun ? 'Would change' : 'Changed');

        $rows = array_map(
            static fn (array $row): array => [$row['version'], $row['designation'], $row['detail']],
            $this->log,
        );

        $rows === []
            ? $this->line('  nothing — every line already names the row the dictionary points at')
            : $this->table(['Version', 'Designation', $dryRun ? 'Would become' : 'Became'], $rows);

        $this->section('Counts');
        $this->line(sprintf('  %-26s %d', 'Versions scanned', $this->versionsScanned));
        $this->line(sprintf('  %-26s %d', $dryRun ? 'Lines that would relink' : 'Lines relinked', $this->linesRelinked));
        $this->line(sprintf('  %-26s %d', $dryRun ? 'Outputs that would be written' : 'Outputs written', $this->outputsWritten));
        $this->line(sprintf('  %-26s %d', $dryRun ? 'Versions that would mark' : 'Versions marked stale', count($this->touched)));
        $this->line(sprintf('  %-26s %d', 'Still unresolved', count($this->unresolved)));

        $this->section('Designations that still resolve to nothing');

        if ($this->unresolved === []) {
            $this->line('  none — every line\'s designation names an ingredient');

            return;
        }

        $this->line('  Each one is a curated dictionary entry somebody has to decide; the lines are left as they are.');

        foreach ($this->unresolved as $row) {
            $this->line(sprintf('  · %s — %d line(s)', $row['designation'], $row['lines']));
        }
    }

    private function dictionaryPath(): string
    {
        return $this->stringOption('dictionary')
            ?? dirname(__DIR__, 2).'/database/data/'.self::DICTIONARY_FILE;
    }
}
