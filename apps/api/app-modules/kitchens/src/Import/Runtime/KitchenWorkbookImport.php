<?php

declare(strict_types=1);

namespace Healthy360\Kitchens\Import\Runtime;

use Healthy360\Audit\Enums\PurposeOfUse;
use Healthy360\Audit\Services\AuditRecorder;
use Healthy360\Ingredients\Enums\IngredientVerificationStatus;
use Healthy360\Ingredients\Models\Ingredient;
use Healthy360\Kitchens\Import\Parsers\CustomerDataParser;
use Healthy360\Kitchens\Import\Parsers\IngredientWorkbookParser;
use Healthy360\Kitchens\Import\Parsers\MealPlanParser;
use Healthy360\Kitchens\Import\Parsers\ProductListParser;
use Healthy360\Kitchens\Import\Parsers\TechnicalSheetParser;
use Healthy360\Recipes\Enums\RecipeVersionStatus;
use Healthy360\Recipes\Models\RecipeVersion;
use Healthy360\Recipes\Models\RecipeVersionLine;
use Healthy360\Recipes\Services\RecipeCostingService;
use Healthy360\Tenancy\Database\DatabaseTenantContext;
use Healthy360\Tenancy\TenantContext;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Storage;
use RuntimeException;
use Throwable;

/**
 * The private Healthy360 kitchen workbook importer (master plan v2 §4.11, mechanism (c)).
 *
 * One run reads five confidential workbook exports and stands a whole kitchen
 * up: an organisation with a branch, two channels, three tariffs and a
 * catalogue; roughly fifty tenant ingredients; twenty-nine costed draft recipe
 * versions with their as-recorded cost snapshots; twenty-nine indicative sauce
 * and dressing recipes carrying declared allergen labels; sixty-four listings
 * with their packs and per-channel prices; seven commercial plans with their
 * configuration matrix and placeholder prices; and one delivery zone over the
 * Lebanese gazetteer.
 *
 * Four properties hold it together.
 *
 * 1. **Insert-if-absent, always.** Nothing is ever updated. Every entity has a
 *    unit of idempotency — the organisation's slug, a source reference, a code —
 *    and a second run finds it and moves on. An operator who corrected a
 *    quantity, repriced a pack or renamed an ingredient keeps that edit
 *    forever, which is the difference between an importer and a reseeder
 *    (risk R8).
 * 2. **Nothing is published.** Every recipe version, every listing and every
 *    plan lands `draft`. The publish gates are unchanged and unbypassed, and
 *    they refuse this data for good reasons — no allergen mapping, no Arabic
 *    name, no real price. Import is transcription; publication is a decision.
 * 3. **Report and continue, per line.** The one place this system does not
 *    fail loudly. An unresolved designation costs its own line and flags its
 *    sheet; it does not fabricate an ingredient and it does not abandon
 *    twenty-eight good sheets. §4.11 asks for created / skipped / failed
 *    counts, and those only mean something if a run survives a failure.
 * 4. **The report is the deliverable.** Counts, unresolved designations,
 *    data-quality findings, the allergen escalation, what landed quarantined
 *    and what the source simply does not contain.
 *
 * The whole run is **one transaction**. A half-imported kitchen is worse than
 * none: the counts would look plausible and the gaps would be invisible.
 */
final readonly class KitchenWorkbookImport
{
    public function __construct(
        private TenantContext $context,
        private DatabaseTenantContext $database,
        private AuditRecorder $audit,
        private RecipeCostingService $costing,
        private KitchenWorkbookWorld $world,
    ) {}

    /**
     * @throws RuntimeException when the environment is not allowlisted or the source folder is incomplete
     */
    public function run(ImportOptions $options, ImportReport $report): ImportReport
    {
        $manifest = SourceManifest::read($options->sourceDirectory, $this->previousChecksums());
        $report->manifest($manifest->entries());

        foreach ($manifest->changedFiles() as $file) {
            $report->finding(
                'source_file_changed_since_previous_run',
                sprintf(
                    '"%s" has a different sha256 from the last recorded run. Existing rows are left untouched; '
                    .'only rows the previous run did not create will be added.',
                    $file,
                ),
                $file,
            );
        }

        $parsed = $this->parse($manifest);

        if ($options->validateOnly) {
            $this->reportParseFindings($parsed, $report);
            $report->finish();

            return $report;
        }

        $dictionary = DesignationDictionary::load();

        /*
         | A dry run executes the **whole** write path and then rolls it back.
         |
         | The tempting alternative — walk the source, count what is missing,
         | touch nothing — produces a number that is only as good as a second
         | implementation of every insert-if-absent rule in the importer, and
         | the day those two implementations disagree is the day the dry run
         | stops being worth running. Doing the real work inside a transaction
         | that always rolls back makes "would create" mean exactly "did create,
         | and then did not". Nothing escapes: the rollback is in a `finally`,
         | and the test asserts row counts are identical either side of a run.
         */
        $run = function () use ($options, $report, $parsed, $dictionary): void {
            $world = $this->world->establish($options->organisationSlug, $report);
            $organisationId = (string) $world['organisation']->getKey();

            $this->context->restore(['organisation_id' => $organisationId]);
            $this->database->apply(null, $organisationId, null);

            $resolver = new DesignationResolver($dictionary, $organisationId);
            $resolver->refresh();

            (new IngredientWriter($dictionary, $resolver, $this->sourceSystem()))
                ->write($organisationId, $report);

            (new IndicativeRecipeWriter($resolver, $this->sourceSystem()))
                ->write($parsed['ingredients'], $organisationId, $report);

            (new TechnicalSheetWriter($resolver, $this->costing, $this->sourceSystem()))
                ->write($parsed['recipes'], $organisationId, $report);

            (new ProductWriter($dictionary, $resolver, $this->sourceSystem()))->write(
                $parsed['products'],
                $organisationId,
                $world['catalogue'],
                $world['channels'],
                $world['price_lists'],
                $report,
            );

            (new PlanWriter($this->sourceSystem()))->write(
                $parsed['plans'],
                $organisationId,
                $world['catalogue'],
                $world['price_lists'],
                $report,
            );

            (new DeliveryWriter($this->sourceSystem()))
                ->write($parsed['customers'], $organisationId, $report);

            $this->reportAllergenReview($organisationId, $report);
            $this->reportQuarantine($organisationId, $report);
        };

        $options->writes() ? DB::transaction($run) : $this->rollBackAfter($run);

        $report->finish();

        return $report;
    }

    /**
     * Parse every source file. No database, no writes — so a malformed workbook
     * fails before anything is established.
     *
     * @return array{
     *     ingredients: array{master: list<array<string, mixed>>, sauces: list<array<string, mixed>>, dressings: list<array<string, mixed>>, allergen_key: list<array{class: string, note: string}>, findings: list<array{code: string, detail: string, source_ref: string|null}>},
     *     recipes: array{sheets: list<array<string, mixed>>, findings: list<array{code: string, detail: string}>},
     *     products: array{rows: list<array<string, mixed>>, findings: list<array{code: string, detail: string, source_ref: string|null}>},
     *     plans: array<string, mixed>,
     *     customers: array{delivery_windows: list<array{code: string, name: string}>, delivery_area_count: int|null, findings: list<array{code: string, detail: string}>},
     * }
     */
    private function parse(SourceManifest $manifest): array
    {
        return [
            'ingredients' => IngredientWorkbookParser::parse($manifest->contentOf(SourceManifest::INGREDIENTS)),
            'recipes' => TechnicalSheetParser::parse($manifest->contentOf(SourceManifest::RECIPES)),
            'products' => ProductListParser::parse($manifest->contentOf(SourceManifest::PRODUCTS)),
            'plans' => MealPlanParser::parse($manifest->contentOf(SourceManifest::PLANS)),
            'customers' => CustomerDataParser::parse($manifest->contentOf(SourceManifest::CUSTOMERS)),
        ];
    }

    /**
     * @param  array<string, array<string, mixed>>  $parsed
     */
    private function reportParseFindings(array $parsed, ImportReport $report): void
    {
        $files = [
            SourceManifest::INGREDIENTS => $parsed['ingredients'],
            SourceManifest::RECIPES => $parsed['recipes'],
            SourceManifest::PRODUCTS => $parsed['products'],
            SourceManifest::PLANS => $parsed['plans'],
            SourceManifest::CUSTOMERS => $parsed['customers'],
        ];

        foreach ($files as $file => $document) {
            /** @var list<array{code: string, detail: string, source_ref?: string|null}> $findings */
            $findings = $document['findings'] ?? [];

            foreach ($findings as $finding) {
                $report->finding($finding['code'], $finding['detail'], $finding['source_ref'] ?? $file);
            }
        }

        /** @var list<array<string, mixed>> $sheets */
        $sheets = $parsed['recipes']['sheets'] ?? [];

        foreach ($sheets as $sheet) {
            /** @var list<array{code: string, detail: string}> $sheetFindings */
            $sheetFindings = $sheet['findings'];

            $report->findings($sheetFindings, SourceManifest::RECIPES.'#Sheet'.$sheet['sheet_index']);
        }
    }

    /**
     * The food-safety escalation, assembled from what actually landed.
     *
     * Two registers, both of which must reach a human before any label is
     * published: the ingredients the platform library itself flags
     * `requires_review` — the burghul and pita contradiction the source workbook
     * contains (risk R1) — and every ingredient a technical sheet uses that
     * carries no allergen mapping in any layer. The second list is long by
     * design: the technical sheets record no allergen data at all, so this is
     * the whole cost of importing formulations from a workbook that does not
     * carry them.
     */
    private function reportAllergenReview(string $organisationId, ImportReport $report): void
    {
        if ($organisationId === '') {
            return;
        }

        $quarantined = Ingredient::withoutTenancy()
            ->where('verification_status', IngredientVerificationStatus::RequiresReview->value)
            ->orderBy('name_en')
            ->get(['id', 'name_en', 'organisation_id', 'source_ref']);

        foreach ($quarantined as $ingredient) {
            $report->allergenReviewItem(
                'ingredient_requires_review',
                sprintf(
                    '"%s" (%s) is flagged requires_review. The source ingredient sheet tags it allergen class '
                    .'"None" while the same workbook\'s allergen key lists it under Cereals/Gluten. No recipe '
                    .'version using it can be published until a human resolves the contradiction (risk R1).',
                    $ingredient->name_en,
                    $ingredient->organisation_id === null ? 'platform library' : 'this kitchen',
                ),
                $ingredient->source_ref,
            );
        }

        $unmapped = DB::table('recipe_version_lines as l')
            ->join('recipe_versions as v', 'v.id', '=', 'l.recipe_version_id')
            ->join('ingredients as i', 'i.id', '=', 'l.ingredient_id')
            ->where('v.organisation_id', $organisationId)
            ->whereNotExists(function ($query) use ($organisationId): void {
                $query->select(DB::raw(1))
                    ->from('ingredient_allergens as m')
                    ->whereColumn('m.ingredient_id', 'i.id')
                    ->where(function ($scope) use ($organisationId): void {
                        $scope->whereNull('m.organisation_id')->orWhere('m.organisation_id', $organisationId);
                    });
            })
            ->where('i.verification_status', '!=', IngredientVerificationStatus::Verified->value)
            ->distinct()
            ->orderBy('i.name_en')
            ->pluck('i.name_en');

        if ($unmapped->isEmpty()) {
            return;
        }

        $report->allergenReviewItem(
            'technical_sheet_ingredients_unmapped',
            sprintf(
                '%d ingredients used by imported technical sheets carry no allergen mapping in any layer and are '
                .'not marked verified: %s. Every version using them is refused publication by the allergen gate '
                .'until somebody determines them.',
                $unmapped->count(),
                $unmapped->implode(', '),
            ),
        );
    }

    /**
     * What came in needing a human, separated from what came in merely
     * unfinished.
     *
     * Imported recipe versions and listings are **drafts, not quarantine**. A
     * draft is a thing nobody has finished; `review_required` is a thing
     * somebody has to look at. Conflating them would make the review queue
     * useless on the day it is most needed.
     */
    private function reportQuarantine(string $organisationId, ImportReport $report): void
    {
        if ($organisationId === '') {
            return;
        }

        $quarantined = RecipeVersion::withoutTenancy()
            ->where('organisation_id', $organisationId)
            ->where('status', RecipeVersionStatus::ReviewRequired->value)
            ->count();

        $report->quarantineItem(
            'imported_versions_are_drafts',
            sprintf(
                'Every imported recipe version landed as a draft. %d version(s) in this kitchen are in '
                .'review_required, and none of them was put there by this run.',
                $quarantined,
            ),
        );

        $lines = RecipeVersionLine::withoutTenancy()
            ->where('organisation_id', $organisationId)
            ->count();

        $report->quarantineItem(
            'imported_line_total',
            sprintf('%d recipe lines exist in this kitchen after the run.', $lines),
        );
    }

    /**
     * The checksums the last recorded run saw, read from the most recent report
     * on disk.
     *
     * @return array<string, string>
     */
    private function previousChecksums(): array
    {
        // The same disk the command writes to, resolved the same way. Building
        // the path by hand is how the comparison silently stopped working once:
        // the `local` disk roots at storage/app/private, and a hand-built
        // storage/app/import-reports found nothing and reported every file as
        // never having been seen before.
        $directory = Storage::disk('local')->path((string) config('kitchens.import.report_path', 'import-reports'));
        $files = is_dir($directory) ? (glob($directory.'/*.json') ?: []) : [];

        if ($files === []) {
            return [];
        }

        rsort($files);
        $raw = file_get_contents($files[0]);

        if ($raw === false) {
            return [];
        }

        try {
            /** @var array{manifest?: list<array{file?: string, sha256?: string}>} $document */
            $document = json_decode($raw, true, flags: JSON_THROW_ON_ERROR);
        } catch (Throwable) {
            return [];
        }

        $checksums = [];

        foreach ($document['manifest'] ?? [] as $entry) {
            if (isset($entry['file'], $entry['sha256'])) {
                $checksums[$entry['file']] = $entry['sha256'];
            }
        }

        return $checksums;
    }

    /**
     * Do the work and undo it.
     *
     * The context is cleared as well as the transaction rolled back, and that
     * is not tidiness: the organisation the run established no longer exists
     * once the rollback lands, so the finishing audit event would otherwise be
     * written against a foreign key pointing at nothing. A dry run belongs to
     * no tenant, which is exactly what a cleared context says.
     *
     * @param  callable(): void  $work
     */
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

    public function auditStart(ImportOptions $options): void
    {
        $this->audit->record(
            'catalogue.workbook_import_started',
            actorUserId: $this->context->userId(),
            subjectType: 'organisation',
            subjectId: $options->organisationSlug,
            purposeOfUse: PurposeOfUse::OrganisationAdministration->value,
            metadata: [
                'mode' => $options->mode(),
                'source_directory' => $options->sourceDirectory,
            ],
        );
    }

    /**
     * The finishing event: totals, and how many problems were found.
     *
     * Flat scalars and one list of strings, deliberately. Two reasons. The
     * audit metadata contract is scalars and lists of scalars, so a nested
     * per-entity map would not survive it — and it should not: an audit row is
     * readable with `audit.view_organisation`, and a full copy of the run
     * report there would be a second, less guarded copy of exactly the material
     * the report file is kept out of git for. What belongs in the trail is that
     * somebody ran the importer, in which mode, and roughly how much moved.
     */
    public function auditFinish(ImportOptions $options, ImportReport $report): void
    {
        $created = 0;
        $skipped = 0;
        $failed = 0;
        $wouldCreate = 0;
        $entities = [];

        foreach ($report->countsSnapshot() as $entity => $buckets) {
            $created += $buckets['created'];
            $skipped += $buckets['skipped_existing'];
            $failed += $buckets['failed'];
            $wouldCreate += $buckets['would_create'];
            $entities[] = $entity;
        }

        $this->audit->record(
            'catalogue.workbook_import_finished',
            actorUserId: $this->context->userId(),
            subjectType: 'organisation',
            subjectId: $options->organisationSlug,
            purposeOfUse: PurposeOfUse::OrganisationAdministration->value,
            metadata: [
                'mode' => $options->mode(),
                'entity_types' => $entities,
                'rows_created' => $created,
                'rows_would_create' => $wouldCreate,
                'rows_skipped_existing' => $skipped,
                'rows_failed' => $failed,
                'unresolved_designation_count' => count($report->unresolvedSnapshot()),
                'data_quality_finding_count' => count($report->findingsSnapshot()),
                'allergen_review_item_count' => count($report->allergenReviewSnapshot()),
            ],
        );
    }

    private function sourceSystem(): string
    {
        return (string) config('kitchens.import.source_system', 'healthy360_workbook');
    }
}
