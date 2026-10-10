<?php

declare(strict_types=1);

namespace Healthy360\Kitchens\Console;

use Healthy360\Audit\Services\AuditRecorder;
use Healthy360\Catalogues\Models\CatalogueItem;
use Healthy360\Kitchens\Console\Concerns\RunsInsideOneKitchen;
use Healthy360\Kitchens\Import\Runtime\BackfillStub;
use Healthy360\Kitchens\Import\Runtime\UnlinkedCookedItems;
use Healthy360\Recipes\Models\Recipe;
use Healthy360\Recipes\Services\RecipeService;
use Illuminate\Console\Command;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Support\Facades\DB;
use Throwable;

/**
 * Give every cooked item that has no recipe a placeholder one, so the whole
 * kitchen appears in the recipe book — and take the placeholders back out.
 *
 * The recipe book lists recipes beside the items selling them, so a meal,
 * sauce, dressing or frozen meal with no recipe is a dish the book cannot show.
 * The owner authorised placeholders for exactly this (24 Sep): a **draft**
 * recipe per item, carrying the item's names and description and nothing else —
 * no lines, no yield, never published — marked "Not formulated" in the book
 * until somebody completes it. Everything that reads a recipe for a customer
 * reads a *published* version, so an empty draft changes no label, no gate, no
 * deduction and no nutrition figure.
 *
 * ## The three modes
 *
 * - **Formulate** (the default). The set is {@see UnlinkedCookedItems}. Each
 *   item is one transaction: lock the row, re-check the predicate under the
 *   lock, create the recipe through `RecipeService` (stamped
 *   `catalogue_backfill`), and link it with a bare `recipe_id` update that
 *   leaves the item's `lock_version`, status and flags alone — the item's own
 *   `recipe_library_unlinked` flag stays until a real formulation replaces the
 *   placeholder. Two overlapping runs cannot both link one item, and a second
 *   run finds nothing to do.
 * - **`--check`** writes nothing and exits 1 while the same predicate matches
 *   anything: the rollout prerequisite, and the recovery check after any later
 *   import. Formulating processes exactly the set the check fails on, so a
 *   passing check after a run is true by construction.
 * - **`--undo`** deletes the placeholders nobody has touched
 *   ({@see BackfillStub}), each in its own transaction under a row lock:
 *   re-check, unlink the items pointing at it, delete the recipe (its version
 *   goes with it). A placeholder somebody has edited is kept and reported —
 *   this is the first hard delete of a recipe anywhere in the codebase, which is
 *   why it is behind the environment allowlist, one organisation per run, and a
 *   predicate that only matches what the backfill wrote and nobody changed.
 *
 * `--dry-run` reports what formulate or undo would do and writes nothing.
 *
 * Always name the kitchen with `--org`: the default is the configured
 * Healthy360 slug, not the v6 kitchen the reset scripts build.
 *
 * Local variables only. Artisan resolves a command once and reuses the
 * instance, so state kept on it would leak from one run into the next — the
 * trap `RelinkRecipeLinesCommand::reset()` exists for.
 */
final class FormulateUnlinkedCommand extends Command
{
    use RunsInsideOneKitchen;

    protected $signature = 'kitchen:formulate-unlinked
        {--org= : The kitchen organisation (defaults to the configured import slug — name it)}
        {--dry-run : Report what would be written or deleted and write nothing}
        {--check : Write nothing; exit 1 while any meal, sauce, dressing or frozen meal has no recipe}
        {--undo : Delete the placeholder recipes nobody has touched, unlinking their items}';

    protected $description = 'Give every recipe-less cooked item a placeholder draft recipe (or check, or undo).';

    public function handle(RecipeService $recipes, AuditRecorder $audit): int
    {
        if ($this->refusesThisEnvironment('kitchen:formulate-unlinked')) {
            return self::FAILURE;
        }

        $check = (bool) $this->option('check');
        $undo = (bool) $this->option('undo');
        $dryRun = (bool) $this->option('dry-run');

        if ($check && $undo) {
            $this->components->error('--check and --undo ask opposite questions; run them separately.');

            return self::FAILURE;
        }

        $organisation = $this->resolveOrganisation();

        if ($organisation === null) {
            return self::FAILURE;
        }

        $this->components->info(sprintf(
            'Formulate unlinked cooked items — mode: %s · organisation: %s · environment: %s',
            match (true) {
                $check => 'check',
                $undo => $dryRun ? 'undo, dry-run' : 'undo',
                default => $dryRun ? 'dry-run' : 'live',
            },
            $organisation->slug,
            $this->laravel->environment(),
        ));

        /** @var int $exit */
        $exit = $this->insideOrganisation($organisation, fn (string $organisationId): int => match (true) {
            $check => $this->check($organisationId, $organisation->slug),
            $undo => $this->undo($organisationId, $dryRun, $audit),
            default => $this->formulate($organisationId, $dryRun, $recipes, $audit),
        });

        return $exit;
    }

    private function check(string $organisationId, string $slug): int
    {
        $outstanding = UnlinkedCookedItems::query($organisationId)
            ->orderBy('item_type')
            ->orderBy('slug')
            ->get();

        if ($outstanding->isEmpty()) {
            $this->line('');
            $this->components->info('Every meal, sauce, dressing and frozen meal has a recipe.');

            return self::SUCCESS;
        }

        $this->section('Cooked items with no recipe ('.$outstanding->count().')');
        $this->table(['Item', 'Kind', 'Reference', 'Status'], $outstanding->map(static fn (CatalogueItem $item): array => [
            $item->name_en,
            $item->item_type->value,
            $item->source_ref ?? '—',
            $item->status->value,
        ])->all());

        $this->line('');
        $this->components->error(sprintf(
            '%d cooked item(s) have no recipe. Run kitchen:formulate-unlinked --org=%s to give each a placeholder.',
            $outstanding->count(),
            $slug,
        ));

        return self::FAILURE;
    }

    private function formulate(string $organisationId, bool $dryRun, RecipeService $recipes, AuditRecorder $audit): int
    {
        $candidates = UnlinkedCookedItems::query($organisationId)
            ->orderBy('item_type')
            ->orderBy('slug')
            ->get();

        $formulated = [];
        $skipped = [];
        $failed = [];

        foreach ($candidates as $candidate) {
            $label = [$candidate->name_en, $candidate->item_type->value, $candidate->source_ref ?? '—'];

            if ($dryRun) {
                $formulated[] = [...$label, '—'];

                continue;
            }

            try {
                $recipe = DB::transaction(function () use ($candidate, $organisationId, $recipes, $audit): ?Recipe {
                    $item = CatalogueItem::withoutTenancy()
                        ->where('organisation_id', $organisationId)
                        ->whereKey($candidate->getKey())
                        ->lockForUpdate()
                        ->first();

                    // Re-asked under the lock, through the same predicate: another run, an import
                    // or a person may have linked or retired the item since the scan.
                    if (! $item instanceof CatalogueItem || ! UnlinkedCookedItems::query($organisationId)->whereKey($item->getKey())->exists()) {
                        return null;
                    }

                    $created = $recipes->create([
                        'name_en' => $item->name_en,
                        'name_ar' => $item->name_ar,
                        'notes' => $item->description_en,
                        'source_system' => BackfillStub::SOURCE_SYSTEM,
                    ])['recipe'];

                    // A bare column write, not a save: the item's validator, status and flags are the
                    // item's, and an editor open on it must not meet a 409 for a change it cannot see.
                    CatalogueItem::withoutTenancy()
                        ->whereKey($item->getKey())
                        ->update(['recipe_id' => (string) $created->getKey(), 'updated_at' => now()]);

                    $audit->record(
                        'catalogue.item_recipe_backfilled',
                        subjectType: 'catalogue_item',
                        subjectId: (string) $item->getKey(),
                        metadata: [
                            'slug' => $item->slug,
                            'item_type' => $item->item_type->value,
                            'recipe_id' => (string) $created->getKey(),
                            'recipe_reference' => $created->source_ref,
                        ],
                    );

                    return $created;
                });
            } catch (Throwable $error) {
                $failed[] = [...$label, $error->getMessage()];

                continue;
            }

            if ($recipe === null) {
                $skipped[] = [...$label, 'linked or retired since the scan'];

                continue;
            }

            $formulated[] = [...$label, (string) $recipe->source_ref];
        }

        $this->section(($dryRun ? 'Would formulate' : 'Formulated').' ('.count($formulated).')');

        $formulated === []
            ? $this->line('  nothing to do — every cooked item already has a recipe')
            : $this->table(['Item', 'Kind', 'Reference', 'Placeholder recipe'], $formulated);

        if ($skipped !== []) {
            $this->section('Skipped ('.count($skipped).')');
            $this->table(['Item', 'Kind', 'Reference', 'Why'], $skipped);
        }

        if ($failed !== []) {
            $this->section('Failed ('.count($failed).')');
            $this->table(['Item', 'Kind', 'Reference', 'Error'], $failed);
        }

        $this->line('');
        $this->components->info(sprintf(
            '%d placeholder recipe(s) %s, %d skipped, %d failed. Each is a draft with no lines — "Not formulated" in the book until somebody completes it.',
            count($formulated),
            $dryRun ? 'would be written' : 'written',
            count($skipped),
            count($failed),
        ));

        return $failed === [] ? self::SUCCESS : self::FAILURE;
    }

    private function undo(string $organisationId, bool $dryRun, AuditRecorder $audit): int
    {
        $placeholders = Recipe::withoutTenancy()
            ->where('organisation_id', $organisationId)
            ->where('source_system', BackfillStub::SOURCE_SYSTEM)
            ->orderBy('source_ref')
            ->get();

        $deleted = [];
        $kept = [];
        $failed = [];

        foreach ($placeholders as $placeholder) {
            $label = [$placeholder->name_en, $placeholder->source_ref ?? '—'];

            if ($dryRun) {
                if (BackfillStub::query($organisationId)->whereKey($placeholder->getKey())->exists()) {
                    $deleted[] = [...$label, (string) $this->itemsSelling($organisationId, (string) $placeholder->getKey())->count()];
                } else {
                    $kept[] = $label;
                }

                continue;
            }

            try {
                $unlinked = DB::transaction(function () use ($placeholder, $organisationId, $audit): ?int {
                    $recipe = Recipe::withoutTenancy()
                        ->where('organisation_id', $organisationId)
                        ->whereKey($placeholder->getKey())
                        ->lockForUpdate()
                        ->first();

                    if (! $recipe instanceof Recipe || ! BackfillStub::query($organisationId)->whereKey($recipe->getKey())->exists()) {
                        return null;
                    }

                    $recipeId = (string) $recipe->getKey();

                    /** @var list<string> $itemIds */
                    $itemIds = array_values($this->itemsSelling($organisationId, $recipeId)
                        ->pluck('id')
                        ->map(static fn (mixed $id): string => (string) $id)
                        ->all());

                    // Unlinked first and explicitly, although the foreign key would null them: the
                    // audit row names them, and `updated_at` says when they lost the placeholder.
                    $this->itemsSelling($organisationId, $recipeId)
                        ->update(['recipe_id' => null, 'updated_at' => now()]);

                    // The version and anything hanging off it go by cascade. The two production
                    // keys that would refuse the delete are ones the stub predicate already excludes.
                    $recipe->delete();

                    $audit->record(
                        'catalogue.recipe_backfill_undone',
                        subjectType: 'recipe',
                        subjectId: $recipeId,
                        metadata: [
                            'slug' => $recipe->slug,
                            'recipe_reference' => $recipe->source_ref,
                            'catalogue_item_ids' => $itemIds,
                        ],
                    );

                    return count($itemIds);
                });
            } catch (Throwable $error) {
                $failed[] = [...$label, $error->getMessage()];

                continue;
            }

            if ($unlinked === null) {
                $kept[] = $label;
            } else {
                $deleted[] = [...$label, (string) $unlinked];
            }
        }

        $this->section(($dryRun ? 'Would delete' : 'Deleted').' ('.count($deleted).')');

        $deleted === []
            ? $this->line('  no untouched placeholder recipe to delete')
            : $this->table(['Placeholder recipe', 'Reference', 'Items unlinked'], $deleted);

        if ($kept !== []) {
            $this->section('Kept (edited) ('.count($kept).')');
            $this->line('  Somebody has worked on these — renamed, filed, formulated, versioned, archived or');
            $this->line('  produced from them — so they are recipes now, not placeholders, and stay.');
            $this->table(['Recipe', 'Reference'], $kept);
        }

        if ($failed !== []) {
            $this->section('Failed ('.count($failed).')');
            $this->table(['Placeholder recipe', 'Reference', 'Error'], $failed);
        }

        $this->line('');
        $this->components->info(sprintf(
            '%d placeholder recipe(s) %s, %d kept, %d failed.',
            count($deleted),
            $dryRun ? 'would be deleted' : 'deleted',
            count($kept),
            count($failed),
        ));

        return $failed === [] ? self::SUCCESS : self::FAILURE;
    }

    /**
     * @return Builder<CatalogueItem>
     */
    private function itemsSelling(string $organisationId, string $recipeId): Builder
    {
        return CatalogueItem::withoutTenancy()
            ->where('organisation_id', $organisationId)
            ->where('recipe_id', $recipeId);
    }
}
