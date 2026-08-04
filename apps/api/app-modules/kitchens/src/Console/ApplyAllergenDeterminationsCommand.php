<?php

declare(strict_types=1);

namespace Healthy360\Kitchens\Console;

use Healthy360\Audit\Services\AuditRecorder;
use Healthy360\Ingredients\Enums\AllergenContainment;
use Healthy360\Ingredients\Enums\AllergenMappingSource;
use Healthy360\Ingredients\Enums\AllergenMarketScope;
use Healthy360\Ingredients\Enums\AllergenVerificationStatus;
use Healthy360\Ingredients\Enums\IngredientVerificationStatus;
use Healthy360\Ingredients\Models\Ingredient;
use Healthy360\Ingredients\Models\IngredientAllergen;
use Healthy360\Kitchens\Console\Concerns\RunsInsideOneKitchen;
use Healthy360\Kitchens\Import\Runtime\DesignationDictionary;
use Healthy360\Kitchens\Import\Runtime\DesignationResolver;
use Healthy360\Recipes\Jobs\RecomputeRecipeDerivations;
use Healthy360\Recipes\Models\RecipeVersion;
use Healthy360\Recipes\Models\RecipeVersionLine;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\DB;
use RuntimeException;
use Throwable;

/**
 * Apply the owner's standard-knowledge allergen determinations (DEC1, key 1).
 *
 * The K1.8 import left 73 ingredients with no allergen determination in any
 * layer — not "assessed and found clear", simply unassessed — and the publish
 * gate refuses every recipe version built on one of them. It also quarantined
 * two platform rows, Burghul and Pita bread, because the source workbook
 * contradicted itself about whether they contain gluten.
 *
 * Neither is a bug to fix in code. Both are questions only a person can answer,
 * and a product owner answered them: derive the ordinary reading of what each
 * foodstuff contains, write it down, and mark every single row as still owing a
 * supplier confirmation. That last part is the whole design of this command.
 *
 * **Nothing written here claims to be verified.** Every mapping lands
 * `requires_supplier_confirmation`, because a determination made from general
 * food knowledge is a considered opinion and not a supplier's declaration.
 * Where an ingredient carries no class at all the row that records it is the
 * *ingredient's* `verification_status = verified` — which is how this system
 * spells "somebody assessed this and it carries nothing" — and the reason is
 * appended to the ingredient's notes so the flip is never a bare state change
 * nobody can account for later.
 *
 * **Idempotent by comparison, not by insert-ignore.** A second run reads what
 * is already there and skips every ingredient whose stored set already says
 * exactly what the file says. That matters more than saving writes: a command
 * that re-wrote identical mappings would re-mark every dependent label stale
 * and re-queue every recompute, turning a no-op re-run into a full
 * re-derivation of the kitchen.
 *
 * **Layer follows the ingredient.** A tenant ingredient gets the kitchen's own
 * overlay row; a platform-library ingredient gets a platform-baseline row,
 * because "vinegar may carry sulphites" is a fact about vinegar rather than
 * about this kitchen. The blast radius of the baseline half is real and the
 * report states it.
 */
final class ApplyAllergenDeterminationsCommand extends Command
{
    use RunsInsideOneKitchen;

    protected $signature = 'kitchen:apply-allergen-determinations
        {--org= : The kitchen organisation to apply them to (defaults to the configured one)}
        {--file= : The determinations file (defaults to the committed one)}
        {--dry-run : Report what would change and write nothing}';

    protected $description = 'Apply the owner-approved standard-knowledge allergen determinations to a kitchen.';

    /** @var list<array{designation: string, layer: string, action: string, detail: string}> */
    private array $log = [];

    private int $applied = 0;

    private int $skipped = 0;

    private int $noneVerified = 0;

    private int $unresolved = 0;

    /** @var list<string> */
    private array $unresolvedNames = [];

    public function handle(AuditRecorder $audit): int
    {
        $this->reset();

        if ($this->refusesThisEnvironment('kitchen:apply-allergen-determinations')) {
            return self::FAILURE;
        }

        $organisation = $this->resolveOrganisation();

        if ($organisation === null) {
            return self::FAILURE;
        }

        try {
            $file = $this->readFile();
        } catch (Throwable $exception) {
            $this->components->error('The determinations file could not be read.');
            $this->line('  '.$exception->getMessage());

            return self::FAILURE;
        }

        $dryRun = (bool) $this->option('dry-run');

        $this->components->info(sprintf(
            'Allergen determinations — mode: %s · organisation: %s · environment: %s',
            $dryRun ? 'dry-run' : 'live',
            $organisation->slug,
            $this->laravel->environment(),
        ));
        $this->line('  Source: '.$this->filePath());
        $this->line('');

        $this->insideOrganisation($organisation, function (string $organisationId) use ($file, $dryRun): void {
            $dictionary = DesignationDictionary::load();
            $resolver = new DesignationResolver($dictionary, $organisationId);
            $resolver->refresh();

            // One transaction for the whole set, rolled back on a dry run. The
            // determinations are one decision; half of them applied is not a
            // safer outcome than none of them, it is an outcome nobody chose.
            // Driven by hand rather than through `DB::transaction()` because a
            // dry run ends in a deliberate rollback, and a closure that rolls
            // back the transaction its own wrapper is about to commit is a
            // trick rather than a control flow.
            DB::beginTransaction();

            try {
                foreach ($file['determinations'] as $entry) {
                    $this->applyDetermination($entry, $resolver, $organisationId, $file);
                }

                foreach ($file['platform_corrections'] as $entry) {
                    $this->applyPlatformCorrection($entry, $resolver, $file);
                }

                $dryRun ? DB::rollBack() : DB::commit();
            } catch (Throwable $exception) {
                DB::rollBack();

                throw $exception;
            }

            $this->render($organisationId, $dryRun);

            if (! $dryRun && $this->applied > 0) {
                $this->recompute($organisationId);
            }
        });

        if (! $dryRun) {
            $audit->record(
                'catalogue.allergen_determinations_applied',
                subjectType: 'organisation',
                subjectId: (string) $organisation->getKey(),
                metadata: [
                    'decision_ref' => $file['decision_ref'],
                    'applied_count' => $this->applied,
                    'skipped_count' => $this->skipped,
                    'none_verified_count' => $this->noneVerified,
                    'unresolved_count' => $this->unresolved,
                ],
            );
        }

        return self::SUCCESS;
    }

    /**
     * Clear the run accumulators.
     *
     * Artisan resolves a command once and reuses the instance, so two
     * invocations in one process share these properties. A long-lived process
     * would otherwise see the second run inherit the first run's counts —
     * which, on the `applied > 0` test that decides whether to recompute every
     * label in the kitchen, turns a genuine no-op into a full re-derivation.
     */
    private function reset(): void
    {
        $this->log = [];
        $this->applied = 0;
        $this->skipped = 0;
        $this->noneVerified = 0;
        $this->unresolved = 0;
        $this->unresolvedNames = [];
    }

    /**
     * One ingredient: resolve it, compare, write only a difference.
     *
     * @param  array{designation: string, allergens: list<array{code: string, containment: string}>, evidence: string}  $entry
     * @param  array{verified_note: string, defaults: array<string, string>, ...}  $file
     */
    private function applyDetermination(array $entry, DesignationResolver $resolver, string $organisationId, array $file): void
    {
        $ingredientId = $resolver->resolve($entry['designation']);

        if ($ingredientId === null) {
            $this->unresolved++;
            $this->unresolvedNames[] = $entry['designation'];

            return;
        }

        $ingredient = Ingredient::withoutTenancy()->whereKey($ingredientId)->first();

        if (! $ingredient instanceof Ingredient) {
            $this->unresolved++;
            $this->unresolvedNames[] = $entry['designation'];

            return;
        }

        // A tenant row's determination is that kitchen's overlay; a platform
        // row's is the baseline everybody inherits.
        $isPlatform = $ingredient->organisation_id === null;
        $layer = $isPlatform ? null : $organisationId;
        $layerName = $isPlatform ? 'platform baseline' : 'kitchen overlay';

        $desired = $this->desiredSet($entry['allergens']);
        $stored = $this->storedSet($ingredient, $layer);

        $mappingsMatch = $desired === $stored;
        $verificationNeeded = $desired === [] && $ingredient->verification_status !== IngredientVerificationStatus::Verified;

        if ($mappingsMatch && ! $verificationNeeded) {
            $this->skipped++;
            $this->log[] = [
                'designation' => $entry['designation'],
                'layer' => $layerName,
                'action' => 'skipped',
                'detail' => $desired === [] ? 'already verified, no classes' : $this->describe($desired),
            ];

            return;
        }

        if (! $mappingsMatch) {
            $this->writeMappings($ingredient, $layer, $entry, $file);
        }

        if ($desired === []) {
            // No mapping row can record "assessed and clear" — the absence of a
            // row is indistinguishable from nobody having looked. The
            // ingredient's own verification status is where that statement
            // lives, and the note is what stops it being a bare flag.
            $this->markVerified($ingredient, $file['verified_note'], $entry['evidence']);
            $this->noneVerified++;
        }

        $this->applied++;
        $this->log[] = [
            'designation' => $entry['designation'],
            'layer' => $layerName,
            'action' => 'applied',
            'detail' => $desired === [] ? 'no classes → ingredient verified' : $this->describe($desired),
        ];
    }

    /**
     * Burghul and Pita bread: add the gluten the workbook's own allergen key
     * states, and lift the quarantine the contradiction caused.
     *
     * The quarantine goes to `unverified` rather than `verified`, and that is
     * the point of the owner's answer: the contradiction is settled, the
     * supplier confirmation is not.
     *
     * @param  array{designation: string, source_ref: string, allergens: list<array{code: string, containment: string}>, resolve_verification_status: string, note: string, evidence: string}  $entry
     * @param  array{defaults: array<string, string>, ...}  $file
     */
    private function applyPlatformCorrection(array $entry, DesignationResolver $resolver, array $file): void
    {
        $ingredientId = $resolver->resolve($entry['designation']);
        $ingredient = $ingredientId === null
            ? null
            : Ingredient::withoutTenancy()->whereKey($ingredientId)->whereNull('organisation_id')->first();

        if (! $ingredient instanceof Ingredient) {
            $this->unresolved++;
            $this->unresolvedNames[] = $entry['designation'].' (platform)';

            return;
        }

        $desired = $this->desiredSet($entry['allergens']);
        $stored = $this->storedSet($ingredient, null);
        $status = IngredientVerificationStatus::from($entry['resolve_verification_status']);

        if ($desired === $stored && $ingredient->verification_status === $status) {
            $this->skipped++;
            $this->log[] = [
                'designation' => $entry['designation'],
                'layer' => 'platform baseline',
                'action' => 'skipped',
                'detail' => $this->describe($desired).' · already '.$status->value,
            ];

            return;
        }

        if ($desired !== $stored) {
            $this->writeMappings($ingredient, null, $entry, $file);
        }

        Ingredient::withoutTenancy()->whereKey($ingredient->getKey())->update([
            'verification_status' => $status->value,
            'notes' => $this->appendNote($ingredient->notes, $entry['note'].' — '.$entry['evidence']),
            'updated_at' => now(),
        ]);

        $this->applied++;
        $this->log[] = [
            'designation' => $entry['designation'],
            'layer' => 'platform baseline',
            'action' => 'applied',
            'detail' => $this->describe($desired).' · '.$ingredient->verification_status->value.' → '.$status->value,
        ];
    }

    /**
     * Replace one layer's mapping rows for the `all` market scope.
     *
     * Written directly rather than through `AllergenMappingService` for the
     * reason the importer's writers are: there is no authenticated caller here,
     * and that service derives the layer it writes from the caller's
     * organisation type precisely so that a caller cannot choose it. A command
     * that has to write both layers in one pass cannot express itself through
     * an API whose whole design is that the layer is not the caller's to pick.
     * The staleness the service would have marked is handled by the recompute
     * this command dispatches at the end, which is the effect that actually
     * matters.
     *
     * @param  array{designation: string, allergens: list<array{code: string, containment: string}>, evidence: string}  $entry
     * @param  array{defaults: array<string, string>, ...}  $file
     */
    private function writeMappings(Ingredient $ingredient, ?string $layer, array $entry, array $file): void
    {
        $query = IngredientAllergen::withoutTenancy()
            ->where('ingredient_id', $ingredient->getKey())
            ->where('market_scope', AllergenMarketScope::All->value);

        $layer === null ? $query->whereNull('organisation_id') : $query->where('organisation_id', $layer);

        foreach ($query->get() as $stale) {
            $stale->delete();
        }

        $source = AllergenMappingSource::from($layer === null
            ? $file['defaults']['source_platform']
            : $file['defaults']['source_tenant']);

        $status = AllergenVerificationStatus::from($file['defaults']['verification_status']);

        $write = function () use ($ingredient, $layer, $entry, $source, $status): void {
            foreach ($entry['allergens'] as $mapping) {
                $row = new IngredientAllergen;
                $row->ingredient_id = (string) $ingredient->getKey();
                $row->organisation_id = $layer;
                $row->allergen_code = $mapping['code'];
                $row->market_scope = AllergenMarketScope::All;
                $row->containment = AllergenContainment::from($mapping['containment']);
                $row->source = $source;
                $row->verification_status = $status;
                $row->evidence = $entry['evidence'];
                $row->save();
            }
        };

        // A baseline row belongs to nobody. Without this the tenancy auto-fill
        // stamps the ambient organisation on it and quietly turns the platform
        // baseline into one kitchen's private overlay.
        $layer === null ? IngredientAllergen::asPlatformRow($write) : $write();
    }

    /**
     * "Assessed, and it carries nothing" — the only way this system can say it.
     */
    private function markVerified(Ingredient $ingredient, string $note, string $evidence): void
    {
        Ingredient::withoutTenancy()->whereKey($ingredient->getKey())->update([
            'verification_status' => IngredientVerificationStatus::Verified->value,
            'notes' => $this->appendNote($ingredient->notes, $note.' '.$evidence),
            'updated_at' => now(),
        ]);
    }

    /**
     * Re-derive every draft label the determinations may have changed.
     *
     * Run synchronously on the sync connection rather than pushed at whatever
     * queue the environment happens to have: an operator who has just applied
     * seventy-three food-safety determinations needs the labels to be current
     * when the command returns, not whenever a worker is next started.
     */
    private function recompute(string $organisationId): void
    {
        $versionIds = RecipeVersion::withoutTenancy()
            ->where('organisation_id', $organisationId)
            ->whereIn('id', RecipeVersionLine::withoutTenancy()->select('recipe_version_id'))
            ->orderBy('id')
            ->pluck('id')
            ->map(static fn (mixed $id): string => (string) $id)
            ->all();

        if ($versionIds === []) {
            return;
        }

        $this->section('Recompute');
        $this->line(sprintf('  Re-deriving %d recipe version(s) synchronously…', count($versionIds)));

        foreach ($versionIds as $versionId) {
            RecomputeRecipeDerivations::dispatchSync($versionId, $organisationId);
        }

        $this->line('  Done.');
    }

    private function render(string $organisationId, bool $dryRun): void
    {
        $this->section('Determinations');

        $rows = array_map(
            static fn (array $row): array => [$row['designation'], $row['layer'], $row['action'], $row['detail']],
            $this->log,
        );

        $this->table(['Ingredient', 'Layer', $dryRun ? 'Would' : 'Action', 'Determination'], $rows);

        $this->section('Counts');
        $this->line(sprintf('  %-24s %d', $dryRun ? 'Would apply' : 'Applied', $this->applied));
        $this->line(sprintf('  %-24s %d', 'Skipped (already stated)', $this->skipped));
        $this->line(sprintf('  %-24s %d', 'None → verified', $this->noneVerified));
        $this->line(sprintf('  %-24s %d', 'Unresolved designations', $this->unresolved));

        foreach ($this->unresolvedNames as $name) {
            $this->components->warn('  · '.$name.' — no ingredient of that name in either layer');
        }

        $this->section('Remaining undetermined');

        $remaining = $this->remainingUndetermined($organisationId);

        if ($remaining === []) {
            $this->line('  none — every ingredient on a recipe line of this kitchen now carries a determination');

            return;
        }

        // On a dry run the transaction is already rolled back, so this counts
        // what is still undetermined *before* the write — which is the honest
        // thing for a dry run to report and would be misleading to dress up.
        $this->line(sprintf('  %d ingredient(s) still carry no determination:', count($remaining)));

        foreach ($remaining as $name) {
            $this->components->warn('  · '.$name);
        }
    }

    /**
     * Ingredients on a recipe line of this kitchen with neither a mapping in
     * any visible layer nor a `verified` status — the same test the publish
     * gate applies, asked of the whole kitchen at once.
     *
     * @return list<string>
     */
    private function remainingUndetermined(string $organisationId): array
    {
        /** @var list<string> $ids */
        $ids = RecipeVersionLine::withoutTenancy()
            ->whereIn('recipe_version_id', RecipeVersion::withoutTenancy()
                ->where('organisation_id', $organisationId)
                ->select('id'))
            ->distinct()
            ->pluck('ingredient_id')
            ->map(static fn (mixed $id): string => (string) $id)
            ->all();

        if ($ids === []) {
            return [];
        }

        /** @var list<string> */
        return Ingredient::withoutTenancy()
            ->whereIn('id', $ids)
            ->where('verification_status', '!=', IngredientVerificationStatus::Verified->value)
            ->whereNotExists(function ($query) use ($organisationId): void {
                $query->selectRaw('1')
                    ->from('ingredient_allergens as m')
                    ->whereColumn('m.ingredient_id', 'ingredients.id')
                    ->where(function ($scope) use ($organisationId): void {
                        $scope->whereNull('m.organisation_id')->orWhere('m.organisation_id', $organisationId);
                    });
            })
            ->orderBy('name_en')
            ->pluck('name_en')
            ->all();
    }

    /**
     * The mapping set as a comparable shape: class → containment, sorted.
     *
     * @param  list<array{code: string, containment: string}>  $allergens
     * @return array<string, string>
     */
    private function desiredSet(array $allergens): array
    {
        $set = [];

        foreach ($allergens as $mapping) {
            $set[$mapping['code']] = $mapping['containment'];
        }

        ksort($set);

        return $set;
    }

    /**
     * @return array<string, string>
     */
    private function storedSet(Ingredient $ingredient, ?string $layer): array
    {
        $query = IngredientAllergen::withoutTenancy()
            ->where('ingredient_id', $ingredient->getKey())
            ->where('market_scope', AllergenMarketScope::All->value);

        $layer === null ? $query->whereNull('organisation_id') : $query->where('organisation_id', $layer);

        $set = [];

        foreach ($query->get() as $row) {
            $set[$row->allergen_code] = $row->containment->value;
        }

        ksort($set);

        return $set;
    }

    /**
     * @param  array<string, string>  $set
     */
    private function describe(array $set): string
    {
        if ($set === []) {
            return 'no classes';
        }

        $parts = [];

        foreach ($set as $code => $containment) {
            $parts[] = $containment === AllergenContainment::Contains->value ? $code : $code.'?';
        }

        return implode(', ', $parts);
    }

    private function appendNote(?string $existing, string $addition): string
    {
        $existing = trim((string) $existing);

        if ($existing === '') {
            return $addition;
        }

        return str_contains($existing, $addition) ? $existing : $existing."\n\n".$addition;
    }

    /**
     * @return array{decision_ref: string, verified_note: string, defaults: array<string, string>, determinations: list<array{designation: string, allergens: list<array{code: string, containment: string}>, evidence: string}>, platform_corrections: list<array{designation: string, source_ref: string, allergens: list<array{code: string, containment: string}>, resolve_verification_status: string, note: string, evidence: string}>}
     */
    private function readFile(): array
    {
        $path = $this->filePath();

        if (! is_file($path)) {
            throw new RuntimeException('No such file: '.$path);
        }

        $decoded = json_decode((string) file_get_contents($path), true, 512, JSON_THROW_ON_ERROR);

        if (! is_array($decoded)) {
            throw new RuntimeException('The determinations file is not a JSON object.');
        }

        /** @var array{decision_ref: string, verified_note: string, defaults: array<string, string>, determinations: list<array{designation: string, allergens: list<array{code: string, containment: string}>, evidence: string}>, platform_corrections: list<array{designation: string, source_ref: string, allergens: list<array{code: string, containment: string}>, resolve_verification_status: string, note: string, evidence: string}>} */
        return $decoded;
    }

    private function filePath(): string
    {
        return $this->stringOption('file')
            ?? base_path('app-modules/allergens/database/data/kitchen-workbook-allergen-determinations.json');
    }
}
