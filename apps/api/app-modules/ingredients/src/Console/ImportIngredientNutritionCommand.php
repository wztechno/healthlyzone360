<?php

declare(strict_types=1);

namespace Healthy360\Ingredients\Console;

use Healthy360\Audit\Services\AuditRecorder;
use Healthy360\Ingredients\Services\IngredientNutritionImporter;
use Healthy360\Ingredients\Services\IngredientNutritionImportReport;
use Illuminate\Console\Command;

/**
 * Re-apply `platform-ingredient-nutrition.json` to the platform ingredient
 * library on demand.
 *
 * **Why a command as well as a seeder.** The seeder runs on deployment and
 * fills empty columns. That is the right thing for a deployment to do and the
 * wrong thing for the case this command exists for: the owner has corrected the
 * nutrition document, the figures already in the database came from the old one,
 * and somebody has to decide — deliberately, at a moment of their choosing —
 * that the new figures should replace the old. `--overwrite` is that decision,
 * and it is a command rather than a flag on the seeder so that no deployment can
 * take it by accident.
 *
 * Without `--overwrite` this is the seeder, exactly: fill-empty, per column,
 * independently. Both modes leave a derived row to the recipe version that owns
 * it, and both refuse to write a density against a unit the row no longer stocks
 * in. {@see IngredientNutritionImporter} holds all of it; there is nothing in
 * here for the two paths to disagree about.
 *
 * **`--overwrite` never touches a curated row.** It rewrites a row only while
 * that row still holds exactly what the last seeding wrote — proved by the
 * fingerprint, not assumed from a version stamp. A supplier's label somebody
 * typed over a generic figure is left where it is and counted, and the report
 * names every row that was rewritten so the change is reviewable afterwards.
 *
 * **No environment gate, and no tenant context.** The two are the same reason.
 * The kitchen commands are gated because they write into one kitchen's private
 * formulations, which is not a thing to do to production by mistake. This writes
 * platform reference data — the nutrition of baking powder — which is
 * legitimate, and occasionally necessary, to correct on a production database.
 * Nothing here belongs to an organisation, so there is no organisation to run
 * inside; the fan-out to the tenants that inherit the rows is the invalidator's
 * job and it restores the ambient context itself.
 *
 * **The queue worker has to be up.** Marking the dependent versions stale is
 * synchronous, because a label whose basis has moved must not look current for
 * even one read. Recomputing them is queued. With no worker running, every
 * published version built on a changed row stays stale until one is started or
 * the version is republished.
 *
 * ```
 * php artisan ingredients:import-nutrition --dry-run --overwrite   # what would change
 * php artisan ingredients:import-nutrition --overwrite             # change it
 * ```
 */
final class ImportIngredientNutritionCommand extends Command
{
    protected $signature = 'ingredients:import-nutrition
        {--overwrite : Rewrite rows still holding exactly what the seeder last wrote}
        {--dry-run : Report what would change and write nothing}';

    protected $description = 'Apply the platform ingredient nutrition document to the ingredient library.';

    public function handle(IngredientNutritionImporter $importer, AuditRecorder $audit): int
    {
        $overwrite = (bool) $this->option('overwrite');
        $dryRun = (bool) $this->option('dry-run');

        $this->components->info(sprintf(
            'Ingredient nutrition — mode: %s · %s · environment: %s',
            $dryRun ? 'dry-run' : 'live',
            $overwrite ? 'fill empty and rewrite untouched seeded rows' : 'fill empty only',
            $this->laravel->environment(),
        ));

        $report = $importer->apply($overwrite, $dryRun);

        $this->render($report, $dryRun);

        if (! $dryRun) {
            // Counts only, and no source refs: which reference rows changed is
            // the report's business, and an audit trail is a record that the
            // operation happened rather than a copy of what it did.
            $audit->record(
                'catalogue.ingredient_nutrition_imported',
                subjectType: 'ingredient_library',
                subjectId: 'platform',
                metadata: ['overwrite' => $overwrite] + $report->counts(),
            );
        }

        return self::SUCCESS;
    }

    private function render(IngredientNutritionImportReport $report, bool $dryRun): void
    {
        $this->line('');
        $this->line(sprintf('  %-34s %d', 'Document rows', $report->rows));
        $this->line(sprintf('  %-34s %d', $dryRun ? 'Envelopes that would fill' : 'Envelopes filled', $report->filled));
        $this->line(sprintf('  %-34s %d', $dryRun ? 'Densities that would fill' : 'Densities filled', $report->densitiesFilled));
        $this->line(sprintf('  %-34s %d', $dryRun ? 'Rows that would be rewritten' : 'Rows rewritten', $report->rewritten));
        $this->line(sprintf('  %-34s %d', 'Left curated', $report->leftCurated));
        $this->line(sprintf('  %-34s %d', 'Left derived', $report->leftDerived));
        $this->line(sprintf('  %-34s %d', 'Skipped, unit mismatch', $report->skippedUnitMismatch));
        $this->line(sprintf('  %-34s %d', 'Versions marked stale', $report->versionsMarked));
        $this->line(sprintf('  %-34s %d', 'Widest fan-out (organisations)', $report->organisationsReached));
        $this->line('');

        if ($report->rewrittenRefs === []) {
            $this->line($report->rewritten === 0
                ? '  No row was rewritten — every untouched row already says what the document says.'
                : '  Rewritten rows are counted above.');

            return;
        }

        $this->line($dryRun
            ? '  These rows still hold exactly what the seeder wrote, and the document has since changed them:'
            : '  These rows were rewritten from the document:');

        foreach ($report->rewrittenRefs as $sourceRef) {
            $this->line('  · '.$sourceRef);
        }
    }
}
