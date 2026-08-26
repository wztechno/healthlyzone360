<?php

declare(strict_types=1);

namespace Healthy360\Kitchens\Console;

use Healthy360\Audit\Enums\PurposeOfUse;
use Healthy360\Audit\Services\AuditRecorder;
use Healthy360\Catalogues\Enums\ProductionMode;
use Healthy360\Catalogues\Models\CatalogueItem;
use Healthy360\Kitchens\Import\Runtime\DesignationDictionary;
use Healthy360\Kitchens\Import\Runtime\DesignationResolver;
use Healthy360\Kitchens\Import\Runtime\ImportOptions;
use Healthy360\Kitchens\Import\Runtime\ImportReport;
use Healthy360\Kitchens\Import\Runtime\IngredientWriter;
use Healthy360\Kitchens\Import\Runtime\TechnicalSheetWriter;
use Healthy360\Organisations\Models\Organisation;
use Healthy360\Recipes\Models\Recipe;
use Healthy360\Recipes\Services\RecipeCostingService;
use Healthy360\Tenancy\Database\DatabaseTenantContext;
use Healthy360\Tenancy\TenantContext;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;
use RuntimeException;
use Throwable;

/**
 * Imports the v6 recipe technical sheets (sauces, dressings, meals) into one
 * kitchen organisation, and links each catalogue item to the sheet that
 * produces it.
 *
 * **The source is private.** `--source` points at the `v6-recipes.json` the
 * converter writes beside the confidential workbooks — formulations and unit
 * costs, never committed (the sheets carry the sentence themselves). What IS
 * committed is the curated designation dictionary
 * (`v6-recipe-designations.json`): names, aliases, raw-material declarations
 * and item↔sheet links — human decisions, no numbers.
 *
 * The write path is the proven one: `IngredientWriter` creates the dictionary's
 * declared raw materials (never inventing one from a sheet),
 * `TechnicalSheetWriter` writes each sheet as one draft costed version with
 * verbatim figures and an as-recorded snapshot, and everything stays draft —
 * publication remains a human act behind the readiness gates.
 */
final class ImportV6RecipesCommand extends Command
{
    private const string SOURCE_SYSTEM = 'healthy360_workbook_v6';

    private const string DICTIONARY_FILE = 'v6-recipe-designations.json';

    private const string SOURCE_FILE = 'v6-recipes.json';

    protected $signature = 'kitchen:import-v6-recipes
        {--source= : Path to the PRIVATE v6-recipes.json the converter wrote beside the workbooks}
        {--org=green-life-kitchen : The organisation slug to import into}
        {--dictionary= : Override the committed curated dictionary (used by tests)}
        {--dry-run : Do everything and roll it back; report what would be created}';

    protected $description = 'Import the v6 recipe technical sheets (private source) and link catalogue items to them.';

    public function __construct(
        private readonly TenantContext $context,
        private readonly DatabaseTenantContext $database,
        private readonly RecipeCostingService $costing,
        private readonly AuditRecorder $audit,
    ) {
        parent::__construct();
    }

    public function handle(): int
    {
        $allowed = $this->allowedEnvironments();
        $environment = (string) $this->laravel->environment();

        if (! in_array($environment, $allowed, true)) {
            $this->components->error(sprintf('kitchen:import-v6-recipes refuses to run in the "%s" environment.', $environment));
            $this->line('  It reads confidential formulations and unit costs from a file on the operator\'s own disk.');
            $this->line('  Allowlisted to: '.implode(', ', $allowed).'.');

            return self::FAILURE;
        }

        $source = $this->stringOption('source');

        if ($source === null || ! is_file($source)) {
            $this->components->error('--source is required: the path to the private v6-recipes.json (converter output).');

            return self::FAILURE;
        }

        $options = new ImportOptions(
            sourceDirectory: $source,
            organisationSlug: $this->stringOption('org') ?? 'green-life-kitchen',
            dryRun: (bool) $this->option('dry-run'),
            validateOnly: false,
        );

        $report = new ImportReport($options, $environment);

        $this->components->info(sprintf(
            'v6 recipe import — mode: %s · organisation: %s · environment: %s',
            $options->mode(),
            $options->organisationSlug,
            $environment,
        ));
        $this->line('  Source: '.$source);
        $this->line('  Dictionary: '.$this->dictionaryPath());
        $this->line('');

        $this->audit->record(
            'catalogue.v6_recipes_import_started',
            actorUserId: $this->context->userId(),
            subjectType: 'organisation',
            subjectId: $options->organisationSlug,
            purposeOfUse: PurposeOfUse::OrganisationAdministration->value,
            metadata: ['mode' => $options->mode()],
        );

        try {
            $parsed = $this->loadSource($source);
            $run = function () use ($parsed, $options, $report): void {
                $this->write($parsed, $options, $report);
            };

            $options->writes() ? DB::transaction($run) : $this->rollBackAfter($run);

            $report->finish();
        } catch (Throwable $exception) {
            $this->components->error('The import failed and nothing was written.');
            $this->line('  '.$exception->getMessage());

            return self::FAILURE;
        }

        $this->render($report, $options);

        $path = $this->writeReport($report, $options);

        if ($path !== null) {
            $this->line('');
            $this->components->info('Full report written to '.$path);
        }

        $this->audit->record(
            'catalogue.v6_recipes_import_finished',
            actorUserId: $this->context->userId(),
            subjectType: 'organisation',
            subjectId: $options->organisationSlug,
            purposeOfUse: PurposeOfUse::OrganisationAdministration->value,
            metadata: ['mode' => $options->mode()],
        );

        if ($options->writes()) {
            $this->line('');
            $this->line('  Every imported version is a draft. Publication stays behind the readiness gates');
            $this->line('  (kitchen:publish-ready), and versions consuming unmapped minted ingredients will');
            $this->line('  refuse until their allergen determinations are made.');
        }

        return self::SUCCESS;
    }

    /**
     * @param  array{sheets: list<array<string, mixed>>, findings: list<array{code: string, detail: string}>}  $parsed
     */
    private function write(array $parsed, ImportOptions $options, ImportReport $report): void
    {
        $organisation = Organisation::query()->where('slug', $options->organisationSlug)->first();

        if (! $organisation instanceof Organisation) {
            throw new RuntimeException(sprintf(
                'The organisation [%s] does not exist. Run kitchen:import-v6 first — the recipes land in the same kitchen the catalogue did.',
                $options->organisationSlug,
            ));
        }

        $organisationId = (string) $organisation->getKey();

        $this->context->restore(['organisation_id' => $organisationId]);
        $this->database->apply(null, $organisationId, null);

        $dictionary = DesignationDictionary::load($this->dictionaryPath());
        $resolver = new DesignationResolver($dictionary, $organisationId);
        $resolver->refresh();

        (new IngredientWriter($dictionary, $resolver, self::SOURCE_SYSTEM, self::DICTIONARY_FILE))
            ->write($organisationId, $report);

        (new TechnicalSheetWriter($resolver, $this->costing, self::SOURCE_SYSTEM, self::SOURCE_FILE))
            ->write($parsed, $organisationId, $report);

        $this->linkRecipes($dictionary, $organisationId, $report);
    }

    /**
     * Tie each catalogue item to the technical sheet that produces it, by the
     * dictionary's curated links — and strip the `recipe_library_unlinked`
     * flag the catalogue import left on the row, because it is no longer true.
     */
    private function linkRecipes(DesignationDictionary $dictionary, string $organisationId, ImportReport $report): void
    {
        $items = CatalogueItem::withoutTenancy()
            ->where('organisation_id', $organisationId)
            ->where('source_system', self::SOURCE_SYSTEM)
            ->get();

        foreach ($items as $item) {
            $designation = $dictionary->recipeFor($item->name_en);

            if ($designation === null) {
                continue;
            }

            // A bought-in article shares a name with the kitchen-made one —
            // the resale "Cordon bleu" beside the produced Cordon Bleu — and
            // a supplier-mode item must not claim a production sheet.
            if ($item->production_mode === ProductionMode::Supplier) {
                $report->skipped('catalogue_item_recipe_link');

                continue;
            }

            $recipe = Recipe::withoutTenancy()
                ->where('organisation_id', $organisationId)
                ->where('source_system', self::SOURCE_SYSTEM)
                ->where('source_ref', self::SOURCE_FILE.'#'.Str::slug($designation))
                ->first();

            if (! $recipe instanceof Recipe) {
                $report->finding(
                    'recipe_link_target_missing',
                    sprintf('"%s" is linked to sheet "%s", which this run did not import.', $item->name_en, $designation),
                    (string) $item->source_ref,
                );

                continue;
            }

            if ($item->recipe_id !== null) {
                $report->skipped('catalogue_item_recipe_link');

                continue;
            }

            $item->recipe_id = (string) $recipe->getKey();
            $item->data_quality_flags = $this->withoutUnlinkedFlag($item->data_quality_flags);
            $item->save();

            $report->created('catalogue_item_recipe_link');
        }

        foreach ($dictionary->declinedRecipeLinks() as $declined) {
            $report->knownGap(
                'recipe_link_declined',
                sprintf('%s ↛ %s — %s', $declined['product'], $declined['candidate'], $declined['reason']),
            );
        }
    }

    /**
     * @param  list<string>|null  $flags
     * @return list<string>|null
     */
    private function withoutUnlinkedFlag(?array $flags): ?array
    {
        if ($flags === null) {
            return null;
        }

        $kept = array_values(array_filter($flags, static fn (string $flag): bool => $flag !== 'recipe_library_unlinked'));

        return $kept === [] ? null : $kept;
    }

    /**
     * @return array{sheets: list<array<string, mixed>>, findings: list<array{code: string, detail: string}>}
     */
    private function loadSource(string $path): array
    {
        $raw = file_get_contents($path);

        if ($raw === false) {
            throw new RuntimeException("The recipes document at [{$path}] could not be read.");
        }

        $decoded = json_decode($raw, true);

        if (! is_array($decoded) || ! is_array($decoded['sheets'] ?? null)) {
            throw new RuntimeException("The recipes document at [{$path}] is not the expected shape (sheets + findings).");
        }

        foreach ($decoded['sheets'] as $index => $sheet) {
            foreach (['sheet_index', 'designation', 'yield', 'totals', 'lines', 'cost_labels'] as $key) {
                if (! isset($sheet[$key])) {
                    throw new RuntimeException("Sheet [{$index}] of the recipes document is missing [{$key}].");
                }
            }
        }

        /** @var array{sheets: list<array<string, mixed>>, findings: list<array{code: string, detail: string}>} $decoded */
        return ['sheets' => $decoded['sheets'], 'findings' => (array) ($decoded['findings'] ?? [])];
    }

    private function render(ImportReport $report, ImportOptions $options): void
    {
        $this->line('');
        $this->line('── Counts '.str_repeat('─', 64));

        $rows = [];

        foreach ($report->countsSnapshot() as $entity => $buckets) {
            $rows[] = [
                $entity,
                $options->writes() ? (string) $buckets['created'] : '—',
                $options->writes() ? '—' : (string) $buckets['would_create'],
                (string) $buckets['skipped_existing'],
                (string) $buckets['failed'],
            ];
        }

        $rows === []
            ? $this->line('  (nothing — the run did not reach the write stage)')
            : $this->table(['Entity', 'Created', 'Would create', 'Skipped (existing)', 'Failed'], $rows);

        $this->listSection('Unresolved designations', array_map(
            static fn (array $row): string => sprintf('%s — %s (%s)', $row['designation'], $row['effect'], implode(', ', $row['occurrences'])),
            $report->unresolvedSnapshot(),
        ), 'every designation resolved');

        $this->listSection('Incomplete sheets', array_map(
            static fn (array $row): string => sprintf('%s — %d line(s) excluded: %s', $row['sheet'], count($row['excluded_lines']), implode('; ', $row['excluded_lines'])),
            $report->incompleteSheetsSnapshot(),
        ), 'no sheet lost a line');

        $this->listSection('Data-quality findings', array_map(
            static fn (array $row): string => sprintf('[%s] %s', $row['code'], $row['detail']),
            $report->findingsSnapshot(),
        ), 'no findings');

        $this->listSection('Known gaps — what the source does not contain', array_map(
            static fn (array $row): string => sprintf('[%s] %s', $row['code'], $row['detail']),
            $report->knownGapsSnapshot(),
        ), 'no gaps recorded');
    }

    /**
     * @param  list<string>  $lines
     */
    private function listSection(string $title, array $lines, string $emptyMessage): void
    {
        $this->line('');
        $this->line('── '.$title.' ('.count($lines).') '.str_repeat('─', max(3, 60 - mb_strlen($title))));

        if ($lines === []) {
            $this->line('  '.$emptyMessage);

            return;
        }

        foreach ($lines as $line) {
            $this->line('  · '.$line);
        }
    }

    private function writeReport(ImportReport $report, ImportOptions $options): ?string
    {
        $directory = (string) config('kitchens.import.report_path', 'import-reports');
        $name = sprintf('%s/%s-v6-recipes-%s.json', $directory, now()->format('Ymd-His'), $options->mode());

        $json = json_encode($report->toArray(), JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);

        if ($json === false) {
            $this->components->warn('The run report could not be serialised, so no JSON file was written.');

            return null;
        }

        Storage::disk('local')->put($name, $json);

        return Storage::disk('local')->path($name);
    }

    private function dictionaryPath(): string
    {
        return $this->stringOption('dictionary')
            ?? dirname(__DIR__, 2).'/database/data/'.self::DICTIONARY_FILE;
    }

    private function rollBackAfter(callable $work): void
    {
        DB::beginTransaction();

        try {
            $work();
        } finally {
            DB::rollBack();

            $this->context->clear();
            $this->database->reset();
        }
    }

    /**
     * @return list<string>
     */
    private function allowedEnvironments(): array
    {
        /** @var array<int, mixed> $allowed */
        $allowed = (array) config('kitchens.import.environments', ['local', 'testing']);

        return array_values(array_map(strval(...), $allowed));
    }

    private function stringOption(string $name): ?string
    {
        $value = $this->option($name);

        return is_string($value) && trim($value) !== '' ? trim($value) : null;
    }
}
