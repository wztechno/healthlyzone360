<?php

declare(strict_types=1);

namespace Healthy360\Kitchens\Console;

use Healthy360\Audit\Services\AuditRecorder;
use Healthy360\Catalogues\Enums\CatalogueItemStatus;
use Healthy360\Catalogues\Models\CatalogueItem;
use Healthy360\Catalogues\Services\CatalogueItemReadiness;
use Healthy360\Catalogues\Services\CatalogueItemService;
use Healthy360\Catalogues\Services\DerivedAllergenService;
use Healthy360\Kitchens\Console\Concerns\RunsInsideOneKitchen;
use Healthy360\Recipes\Enums\RecipeVersionStatus;
use Healthy360\Recipes\Models\Recipe;
use Healthy360\Recipes\Models\RecipeVersion;
use Healthy360\Recipes\Services\RecipeVersionReadiness;
use Healthy360\Recipes\Services\RecipeVersionService;
use Illuminate\Console\Command;
use Throwable;

/**
 * Publish everything in one kitchen that passes its readiness gate (DEC1,
 * key 3).
 *
 * The owner's instruction was "publish everything that passes readiness" — not
 * "publish everything". The distinction is the whole command: it never lowers a
 * gate, never backfills a field to get past one, and never publishes a thing it
 * could not defend. It asks the same two evaluators the API asks
 * (`RecipeVersionReadiness`, `CatalogueItemReadiness`), publishes what returns
 * an empty list of reasons, and prints every refusal with the reasons attached.
 *
 * The refusals are the useful half of the output. Roughly half of the imported
 * technical sheets are indicative drafts with no quantities on their lines,
 * because the source workbook did not state any; those fail `no_lines` or
 * `line_quantity_missing` and they should. A run that published them would be
 * inventing formulations.
 *
 * **Order matters and is fixed**: recipe versions, then catalogue items. A meal
 * whose allergen basis is a published recipe version cannot pass its own gate
 * until that version is published, so publishing recipes second would refuse
 * items for a reason that had already been fixed.
 *
 * **On the permission stack.** The HTTP publish route additionally requires
 * `plan.publish_organisation` for a subscription plan, checked against the
 * authenticated caller. There is no authenticated caller here and no way to
 * invent one honestly, so this command performs the state transition itself
 * rather than through `PublishCatalogueItem` — the *same* readiness gate, the
 * same compare-and-swap, the same audit event, and no pretence that an RBAC
 * check was satisfied when nobody was there to satisfy it. Its authority is the
 * environment allowlist, exactly as the importer's is. That is a deviation from
 * the API path and it is recorded as one.
 */
final class PublishReadyCatalogueCommand extends Command
{
    use RunsInsideOneKitchen;

    protected $signature = 'kitchen:publish-ready
        {--org= : The kitchen organisation to publish within (defaults to the configured one)}
        {--dry-run : Report what would publish and what would be refused, and write nothing}';

    protected $description = 'Publish every recipe version and catalogue item of a kitchen that passes its readiness gate.';

    /** @var array<string, int> */
    private array $published = ['recipe_version' => 0, 'meal' => 0, 'product' => 0, 'subscription_plan' => 0];

    /** @var list<array{type: string, name: string, reasons: string}> */
    private array $refusals = [];

    /** @var list<array{type: string, name: string, detail: string}> */
    private array $failures = [];

    public function handle(
        RecipeVersionReadiness $versionReadiness,
        RecipeVersionService $versions,
        CatalogueItemReadiness $itemReadiness,
        CatalogueItemService $items,
        DerivedAllergenService $allergens,
        AuditRecorder $audit,
    ): int {
        // Artisan resolves a command once and reuses the instance, so two runs
        // in one process would otherwise accumulate one another's counts and
        // refusals.
        $this->published = ['recipe_version' => 0, 'meal' => 0, 'product' => 0, 'subscription_plan' => 0];
        $this->refusals = [];
        $this->failures = [];

        if ($this->refusesThisEnvironment('kitchen:publish-ready')) {
            return self::FAILURE;
        }

        $organisation = $this->resolveOrganisation();

        if ($organisation === null) {
            return self::FAILURE;
        }

        $dryRun = (bool) $this->option('dry-run');

        $this->components->info(sprintf(
            'Publication run — mode: %s · organisation: %s · environment: %s',
            $dryRun ? 'dry-run' : 'live',
            $organisation->slug,
            $this->laravel->environment(),
        ));
        $this->line('');

        $this->insideOrganisation($organisation, function (string $organisationId) use (
            $versionReadiness,
            $versions,
            $itemReadiness,
            $items,
            $allergens,
            $audit,
            $dryRun,
        ): void {
            $this->publishRecipeVersions($organisationId, $versionReadiness, $versions, $dryRun);
            $this->publishCatalogueItems($organisationId, $itemReadiness, $items, $allergens, $audit, $dryRun);
        });

        $this->render($dryRun);

        return self::SUCCESS;
    }

    /**
     * Every current draft version of every recipe in the kitchen.
     *
     * "Current draft" is the highest-numbered draft of each recipe. A recipe
     * with two drafts is a formulation somebody is still working on, and
     * publishing the older one would promote work that has been superseded.
     */
    private function publishRecipeVersions(
        string $organisationId,
        RecipeVersionReadiness $readiness,
        RecipeVersionService $versions,
        bool $dryRun,
    ): void {
        $recipes = Recipe::withoutTenancy()
            ->where('organisation_id', $organisationId)
            ->orderBy('name_en')
            ->get();

        $this->section(sprintf('Recipe versions (%d recipe(s))', $recipes->count()));

        foreach ($recipes as $recipe) {
            $version = RecipeVersion::withoutTenancy()
                ->where('recipe_id', $recipe->getKey())
                ->where('status', RecipeVersionStatus::Draft->value)
                ->orderByDesc('version_number')
                ->first();

            if (! $version instanceof RecipeVersion) {
                continue;
            }

            $reasons = $readiness->reasons($version);

            if ($reasons !== []) {
                $this->refusals[] = [
                    'type' => 'recipe_version',
                    'name' => sprintf('%s v%d', $recipe->name_en, $version->version_number),
                    'reasons' => $this->summarise($reasons),
                ];

                continue;
            }

            if ($dryRun) {
                $this->published['recipe_version']++;

                continue;
            }

            try {
                $versions->publish($version, $version->lock_version);
                $this->published['recipe_version']++;
            } catch (Throwable $exception) {
                $this->failures[] = [
                    'type' => 'recipe_version',
                    'name' => sprintf('%s v%d', $recipe->name_en, $version->version_number),
                    'detail' => $exception->getMessage(),
                ];
            }
        }

        $this->line(sprintf('  %d ready · %d refused', $this->published['recipe_version'], count($this->refusals)));
    }

    /**
     * Every draft catalogue item, in the order a kitchen would work through
     * them: meals, then products, then plans.
     */
    private function publishCatalogueItems(
        string $organisationId,
        CatalogueItemReadiness $readiness,
        CatalogueItemService $items,
        DerivedAllergenService $allergens,
        AuditRecorder $audit,
        bool $dryRun,
    ): void {
        $drafts = CatalogueItem::withoutTenancy()
            ->where('organisation_id', $organisationId)
            ->where('status', CatalogueItemStatus::Draft->value)
            ->orderBy('item_type')
            ->orderBy('name_en')
            ->get();

        $this->section(sprintf('Catalogue items (%d draft(s))', $drafts->count()));

        foreach ($drafts as $item) {
            $reasons = $readiness->reasons($item);
            $type = $item->item_type->value;

            if ($reasons !== []) {
                $this->refusals[] = [
                    'type' => $type,
                    'name' => $item->name_en,
                    'reasons' => $this->summarise($reasons),
                ];

                continue;
            }

            if ($dryRun) {
                $this->published[$type]++;

                continue;
            }

            try {
                $this->publishItem($item, $items, $allergens, $audit);
                $this->published[$type]++;
            } catch (Throwable $exception) {
                $this->failures[] = ['type' => $type, 'name' => $item->name_en, 'detail' => $exception->getMessage()];
            }
        }
    }

    /**
     * The transition `PublishCatalogueItem::publish()` performs, minus the RBAC
     * check there is no caller to satisfy — see the class docblock.
     */
    private function publishItem(
        CatalogueItem $item,
        CatalogueItemService $items,
        DerivedAllergenService $allergens,
        AuditRecorder $audit,
    ): void {
        $items->compareAndSwap($item, [
            'status' => CatalogueItemStatus::Published->value,
            'review_reason' => null,
        ], $item->lock_version);

        $derived = $allergens->forItem($item);

        $audit->record(
            'catalogue.item_published',
            subjectType: 'catalogue_item',
            subjectId: (string) $item->getKey(),
            metadata: [
                'slug' => $item->slug,
                'item_type' => $item->item_type->value,
                'allergen_basis' => $derived['basis'],

                // Never a key containing `code`: the audit redactor matches it
                // as a substring and would blank the value (OQ-036).
                'allergen_classes' => array_map(
                    static fn (array $row): string => $row['allergen_code'],
                    $derived['allergens'],
                ),
                'origin' => 'kitchen:publish-ready',
                'lock_version' => $item->lock_version,
            ],
        );
    }

    /**
     * @param  list<array{code: string, detail: string, context: array<string, mixed>}>  $reasons
     */
    private function summarise(array $reasons): string
    {
        return implode(', ', array_map(
            static function (array $reason): string {
                $context = $reason['context'];
                $counts = [];

                foreach ($context as $key => $value) {
                    if (is_array($value) && $value !== []) {
                        $counts[] = $key.'×'.count($value);
                    }
                }

                return $reason['code'].($counts === [] ? '' : ' ('.implode(' ', $counts).')');
            },
            $reasons,
        ));
    }

    private function render(bool $dryRun): void
    {
        $this->section($dryRun ? 'Would publish' : 'Published');

        foreach ($this->published as $type => $count) {
            $this->line(sprintf('  %-20s %d', $type, $count));
        }

        $this->section(sprintf('Refusals (%d)', count($this->refusals)));

        if ($this->refusals === []) {
            $this->line('  nothing was refused');
        } else {
            $this->table(
                ['Type', 'Name', 'Reasons'],
                array_map(
                    static fn (array $row): array => [$row['type'], $row['name'], $row['reasons']],
                    $this->refusals,
                ),
            );
        }

        if ($this->failures === []) {
            return;
        }

        $this->section(sprintf('Failures (%d)', count($this->failures)));

        foreach ($this->failures as $failure) {
            $this->components->error(sprintf('  %s "%s" — %s', $failure['type'], $failure['name'], $failure['detail']));
        }
    }
}
