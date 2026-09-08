<?php

declare(strict_types=1);

namespace Healthy360\Ingredients\Services;

use Healthy360\Audit\Services\AuditRecorder;
use Healthy360\Ingredients\Contracts\IngredientUsageRegistry;
use Healthy360\Ingredients\Enums\AvailabilityTier;
use Healthy360\Ingredients\Enums\IngredientStatus;
use Healthy360\Ingredients\Enums\IngredientVerificationStatus;
use Healthy360\Ingredients\Exceptions\PlatformRowImmutable;
use Healthy360\Ingredients\Models\Ingredient;
use Healthy360\Ingredients\Models\IngredientAlias;
use Healthy360\Ingredients\Models\IngredientAllergen;
use Healthy360\Ingredients\Models\IngredientCategory;
use Healthy360\Support\Api\ErrorCode;
use Healthy360\Support\Api\Exceptions\ApiException;
use Healthy360\Support\Api\Exceptions\StaleLockVersion;
use Healthy360\Tenancy\TenantContext;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

/**
 * Every write to the ingredient catalogue goes through here.
 *
 * Three responsibilities the controllers deliberately do not carry:
 *
 * 1. **The platform/tenant boundary.** A tenant may read the platform library
 *    and may not write it. Enforced once, here, rather than remembered in six
 *    controllers.
 * 2. **Optimistic concurrency.** The compare-and-swap is a single conditional
 *    `UPDATE … WHERE lock_version = ?`, not a read-then-write: a read
 *    followed by a write leaves a window in which the row changes, which is
 *    precisely the race `If-Match` exists to close. Zero affected rows means
 *    somebody else won, and the caller is told what they lost to.
 * 3. **The audit trail.** A catalogue mutation that is not audited did not
 *    happen as far as a food-safety review is concerned, so recording is part
 *    of the write, not an optional decoration on the call site.
 */
final readonly class IngredientCatalogueService
{
    /**
     * The ingredient library's own series.
     *
     * `PKG-` exists in the same column — the import numbered the thirty-one packaging rows that way
     * — and is deliberately *not* generated here. Packaging and food share this table and this
     * endpoint now, so a create cannot tell which it is being asked for without reading the
     * taxonomy, and a boxed lid filed as `ING-307` is a worse answer than a considered one. When
     * the packaging form grows a create, it names its series the way the sauce routes name theirs.
     */
    private const string REFERENCE_PREFIX = 'ING-';

    public function __construct(
        private TenantContext $context,
        private AuditRecorder $audit,
        private IngredientUsageRegistry $usage,
        private PlatformLibraryAccess $platform,
    ) {}

    /**
     * Create a tenant ingredient. New rows start `active` and `unverified`:
     * something a kitchen just typed in is real enough to use and has not
     * been checked by anyone.
     *
     * @param  array{
     *     name_en: string,
     *     name_ar?: string|null,
     *     slug?: string|null,
     *     ingredient_category_id?: string|null,
     *     ingredient_subcategory_id?: string|null,
     *     default_unit_id: string,
     *     purchase_unit_id?: string|null,
     *     composition?: string|null,
     *     items_per_unit?: float|string|null,
     *     nutrition_per_100g?: array<string, mixed>|null,
     *     b2b_price_amount?: float|string|null,
     *     b2c_price_amount?: float|string|null,
     *     unit_price_amount?: float|string|null,
     *     price_currency_code?: string|null,
     *     is_sellable?: bool,
     *     yield_factor?: float|string|null,
     *     availability_tier?: string|null,
     *     notes?: string|null
     * }  $attributes
     *
     * @throws ApiException
     */
    public function create(array $attributes): Ingredient
    {
        $organisationId = $this->requireOrganisation();
        $nameEn = trim($attributes['name_en']);

        $ingredient = new Ingredient;
        $ingredient->organisation_id = $organisationId;
        $ingredient->slug = $this->uniqueSlug($attributes['slug'] ?? $nameEn, $organisationId);
        $ingredient->name_en = $nameEn;
        $ingredient->name_ar = $this->trimmedOrNull($attributes['name_ar'] ?? null) ?? $nameEn;
        $this->assertSubcategoryBelongsToCategory(
            $attributes['ingredient_category_id'] ?? null,
            $attributes['ingredient_subcategory_id'] ?? null,
        );

        $ingredient->ingredient_category_id = $attributes['ingredient_category_id'] ?? null;
        $ingredient->ingredient_subcategory_id = $attributes['ingredient_subcategory_id'] ?? null;
        $ingredient->default_unit_id = $attributes['default_unit_id'];
        $ingredient->purchase_unit_id = $attributes['purchase_unit_id'] ?? null;
        $ingredient->composition = $this->trimmedOrNull($attributes['composition'] ?? null);
        $ingredient->items_per_unit = isset($attributes['items_per_unit']) ? (string) $attributes['items_per_unit'] : null;
        $ingredient->nutrition_per_100g = $attributes['nutrition_per_100g'] ?? null;
        $ingredient->b2b_price_amount = isset($attributes['b2b_price_amount']) ? (string) $attributes['b2b_price_amount'] : null;
        $ingredient->b2c_price_amount = isset($attributes['b2c_price_amount']) ? (string) $attributes['b2c_price_amount'] : null;
        $ingredient->unit_price_amount = isset($attributes['unit_price_amount']) ? (string) $attributes['unit_price_amount'] : null;
        $ingredient->price_currency_code = $this->trimmedOrNull($attributes['price_currency_code'] ?? null);
        // The column defaults to false, so an omitted flag creates a raw
        // material rather than something already on sale.
        $ingredient->is_sellable = (bool) ($attributes['is_sellable'] ?? false);
        $ingredient->yield_factor = (string) ($attributes['yield_factor'] ?? 1);
        $ingredient->availability_tier = AvailabilityTier::tryFrom((string) ($attributes['availability_tier'] ?? ''));

        // Written rather than left to the column defaults: a new row is usable
        // immediately (a kitchen that cannot use what it just typed keeps a
        // spreadsheet instead) and unchecked by anyone, and the response has
        // to be able to say both without a round trip to the database.
        $ingredient->status = IngredientStatus::Active;
        $ingredient->verification_status = IngredientVerificationStatus::Unverified;
        $ingredient->lock_version = 0;
        $ingredient->notes = $this->trimmedOrNull($attributes['notes'] ?? null);
        $ingredient->created_by = $this->context->userId();
        $ingredient->updated_by = $this->context->userId();
        // The kitchen's own handle. `source_ref` is where the v6 import wrote `ING-001..306`, and a
        // row typed in by hand joins the same sequence at 307 rather than arriving without one —
        // which is what a column of references a cook reads down is for. `source_system` stays null,
        // so nothing here can be mistaken for an imported row: the import matches on the pair.
        $ingredient->source_ref = $this->nextReferenceFor($organisationId, self::REFERENCE_PREFIX);
        $ingredient->save();

        $this->audit->record(
            'catalogue.ingredient_created',
            actorUserId: $this->context->userId(),
            subjectType: 'ingredient',
            subjectId: (string) $ingredient->getKey(),
            metadata: ['slug' => $ingredient->slug, 'status' => $ingredient->status->value],
        );

        return $ingredient;
    }

    /**
     * Make a platform-library row this kitchen's own, so it can be edited.
     *
     * Copy-on-write, which is the model the schema was built for:
     * `forked_from_ingredient_id`, the `(organisation_id, slug)` unique index
     * that lets a fork keep its parent's slug, and `preferTenantRow()` in
     * {@see resolveDesignation()} all pre-date this method and only make sense
     * with it. The alternative — a per-field override table read as an overlay
     * — would keep one identity and keep tracking platform corrections, at the
     * cost of a merge layer in every read path. Not what this schema wants.
     *
     * **The allergen baseline is copied, not inherited.** A fork is a new
     * `ingredient_id`, and `AllergenMappingService::mappingsFor()` filters on
     * that column alone, so a fork with nothing copied would start with *no*
     * mappings — "Tahini" would silently lose its Sesame baseline the moment a
     * kitchen forked it to change a price. Both layers come across: the
     * platform baseline stays `organisation_id NULL`, which keeps it
     * unweakenable under `assertUpgradeOnly()`, and any overlay this kitchen
     * had already put on the library row comes with it. The cost of copying
     * rather than inheriting is that a later platform correction to the
     * baseline does not reach the fork; the cost of the alternative was a read
     * path change in four places, and this is the safer default of the two.
     *
     * **Existing recipes keep pointing at the library row.** The fork applies
     * to new use. Repointing published recipe versions and their cost
     * snapshots is a bulk write against a food-safety record and needs its own
     * decision, not a side effect of pressing an edit button.
     *
     * Idempotent: a kitchen that already forked this row gets the fork it
     * already has, rather than a second copy competing with the first in every
     * search. `source_system` is dropped — it says "this row came from the v6
     * workbook", which stops being true the moment a kitchen owns a copy — and
     * `source_ref` is replaced rather than cleared: the fork takes the next
     * `ING-` handle, because a copy with no handle is invisible to a list that
     * shows the series, and a fork exists to be edited.
     *
     * @throws ApiException
     */
    public function fork(Ingredient $source): Ingredient
    {
        $organisationId = $this->requireOrganisation();

        if (! $source->isPlatformRow()) {
            throw new ApiException(
                ErrorCode::RequestInvalid,
                'Only a platform-library ingredient can be forked; this row already belongs to a kitchen.',
            );
        }

        $existing = $this->existingFork($source);

        if ($existing instanceof Ingredient) {
            return $existing;
        }

        $fork = DB::transaction(function () use ($source, $organisationId): Ingredient {
            $fork = new Ingredient;
            $fork->organisation_id = $organisationId;
            $fork->forked_from_ingredient_id = $source->getKey();
            // The parent's slug, kept: the unique index is
            // `(organisation_id, slug)`, so there is no collision, and a fork
            // whose slug drifted to `olive-oil-2` would be harder to recognise
            // in every place a slug is read by a human.
            $fork->slug = $this->uniqueSlug($source->slug, $organisationId);
            $fork->name_en = $source->name_en;
            $fork->name_ar = $source->name_ar;
            $fork->ingredient_category_id = $source->ingredient_category_id;
            $fork->ingredient_subcategory_id = $source->ingredient_subcategory_id;
            $fork->default_unit_id = $source->default_unit_id;
            $fork->purchase_unit_id = $source->purchase_unit_id;
            $fork->composition = $source->composition;
            $fork->items_per_unit = $source->items_per_unit;
            $fork->nutrition_per_100g = $source->nutrition_per_100g;
            $fork->b2b_price_amount = $source->b2b_price_amount;
            $fork->b2c_price_amount = $source->b2c_price_amount;
            $fork->unit_price_amount = $source->unit_price_amount;
            $fork->price_currency_code = $source->price_currency_code;
            $fork->is_sellable = $source->is_sellable;
            $fork->yield_factor = $source->yield_factor;
            $fork->availability_tier = $source->availability_tier;
            $fork->notes = $source->notes;

            // Active because the library row was usable and the copy has to be
            // too; unverified because nobody has checked *this* kitchen's copy,
            // whatever the platform had decided about the original.
            $fork->status = IngredientStatus::Active;
            $fork->verification_status = IngredientVerificationStatus::Unverified;
            $fork->source_system = null;
            // The kitchen's own handle, not the platform's provenance. `source_ref` on a library
            // row says "this came from the v6 workbook", which stops being true the moment a
            // kitchen owns a copy — but leaving it empty is what made a fork invisible to a list
            // that shows the `ING-` series, and a fork exists precisely to be edited. So the copy
            // joins the sequence at the next number, the same way a typed-in row does.
            $fork->source_ref = $this->nextReferenceFor($organisationId, self::REFERENCE_PREFIX);
            $fork->lock_version = 0;
            $fork->created_by = $this->context->userId();
            $fork->updated_by = $this->context->userId();
            $fork->save();

            $this->copyAliases($source, $fork);
            $this->copyAllergenMappings($source, $fork);

            return $fork;
        });

        $this->audit->record(
            'catalogue.ingredient_forked',
            actorUserId: $this->context->userId(),
            subjectType: 'ingredient',
            subjectId: (string) $fork->getKey(),
            metadata: [
                'forked_from_ingredient_id' => (string) $source->getKey(),
                'slug' => $fork->slug,
            ],
        );

        return $fork;
    }

    /**
     * This kitchen's existing fork of a library row, or `null`.
     *
     * Public because the fork endpoint has to distinguish "created" from
     * "you already had one" *before* calling {@see fork()}, and asking after
     * the fact cannot tell the two apart — `fork()` returns the same row
     * either way, which is exactly what makes it safe to retry.
     */
    public function existingFork(Ingredient $source): ?Ingredient
    {
        $organisationId = $this->context->organisationId();

        if ($organisationId === null || ! $source->isPlatformRow()) {
            return null;
        }

        return Ingredient::withoutTenancy()
            ->where('organisation_id', $organisationId)
            ->where('forked_from_ingredient_id', $source->getKey())
            ->first();
    }

    /**
     * The parent's alternative designations, carried over.
     *
     * Without them a fork stops answering to the supplier wording its parent
     * answered to, and `resolveDesignation()` — which consults aliases before
     * names — would keep resolving that wording to the library row the kitchen
     * has just replaced.
     */
    private function copyAliases(Ingredient $source, Ingredient $fork): void
    {
        foreach (IngredientAlias::query()->where('ingredient_id', $source->getKey())->get() as $alias) {
            $copy = new IngredientAlias;
            $copy->ingredient_id = $fork->getKey();
            $copy->alias = $alias->alias;
            $copy->alias_normalised = $alias->alias_normalised;
            $copy->locale = $alias->locale;
            $copy->source_system = $alias->source_system;
            $copy->source_ref = $alias->source_ref;
            $copy->save();
        }
    }

    /**
     * Both allergen layers, carried over with their layer intact.
     *
     * The layer is the point. A baseline row has to arrive on the fork as a
     * baseline row — `organisation_id NULL` — because that is what
     * `assertUpgradeOnly()` reads to refuse a downgrade. Land it as an overlay
     * instead and the copy still *declares* the allergen but no longer protects
     * it: the kitchen could quietly weaken "contains milk" to "may contain" on
     * its own copy, which is the exact edit the two-layer model exists to stop.
     *
     * Hence {@see BelongsToOrganisation::asPlatformRow()} around the baseline
     * half. Without it the trait's create hook fills the caller's organisation
     * into any NULL `organisation_id`, and every baseline mapping would be
     * demoted on the way in — silently, because the mapping list would look
     * complete either way.
     *
     * The NULL rows are private in practice despite the column saying
     * "platform": they are only reachable through the fork's own
     * `ingredient_id`, which is a tenant row no other kitchen can see.
     */
    private function copyAllergenMappings(Ingredient $source, Ingredient $fork): void
    {
        $organisationId = $this->context->organisationId();

        $mappings = IngredientAllergen::withoutTenancy()
            ->where('ingredient_id', $source->getKey())
            ->where(function ($query) use ($organisationId): void {
                $query->whereNull('organisation_id');

                if ($organisationId !== null) {
                    $query->orWhere('organisation_id', $organisationId);
                }
            })
            ->get();

        foreach ($mappings as $mapping) {
            $write = function () use ($mapping, $fork): void {
                $copy = new IngredientAllergen;
                $copy->ingredient_id = $fork->getKey();
                $copy->allergen_code = $mapping->allergen_code;
                $copy->organisation_id = $mapping->organisation_id;
                $copy->containment = $mapping->containment;
                $copy->market_scope = $mapping->market_scope;
                $copy->source = $mapping->source;
                $copy->verification_status = $mapping->verification_status;
                $copy->evidence = $mapping->evidence;
                $copy->created_by = $this->context->userId();
                $copy->save();
            };

            if ($mapping->isPlatformBaseline()) {
                IngredientAllergen::asPlatformRow($write);

                continue;
            }

            $write();
        }
    }

    /**
     * Update a tenant ingredient, guarded by `lock_version`.
     *
     * @param  array<string, mixed>  $attributes
     *
     * @throws ApiException
     */
    public function update(Ingredient $ingredient, array $attributes, int $expectedLockVersion): Ingredient
    {
        $this->assertWritable($ingredient);

        // A PATCH may move either half of the pair on its own, so the check has
        // to be against the *effective* pair — what is being sent, falling back
        // to what is already stored — rather than against the payload alone.
        $this->assertSubcategoryBelongsToCategory(
            array_key_exists('ingredient_category_id', $attributes)
                ? $attributes['ingredient_category_id']
                : $ingredient->ingredient_category_id,
            array_key_exists('ingredient_subcategory_id', $attributes)
                ? $attributes['ingredient_subcategory_id']
                : $ingredient->ingredient_subcategory_id,
        );

        $changes = [];

        foreach (['name_en', 'name_ar', 'ingredient_category_id', 'ingredient_subcategory_id', 'default_unit_id', 'purchase_unit_id', 'composition', 'items_per_unit', 'nutrition_per_100g', 'b2b_price_amount', 'b2c_price_amount', 'unit_price_amount', 'price_currency_code', 'is_sellable', 'yield_factor', 'availability_tier', 'notes'] as $field) {
            if (! array_key_exists($field, $attributes)) {
                continue;
            }

            $value = $attributes[$field];

            if (is_string($value)) {
                $value = trim($value);
            }

            if (in_array($field, ['notes', 'composition'], true) && $value === '') {
                $value = null;
            }

            $changes[$field] = $value;
        }

        if ($changes === []) {
            return $ingredient;
        }

        $changes['updated_by'] = $this->context->userId();

        $this->compareAndSwap($ingredient, $changes, $expectedLockVersion);

        $this->audit->record(
            'catalogue.ingredient_updated',
            actorUserId: $this->context->userId(),
            subjectType: 'ingredient',
            subjectId: (string) $ingredient->getKey(),
            metadata: [
                'changed_fields' => array_values(array_diff(array_keys($changes), ['updated_by'])),
                'lock_version' => $ingredient->lock_version,
            ],
        );

        return $ingredient;
    }

    /**
     * Archive an ingredient — a lifecycle action, never a `PATCH status`
     * (master plan v2 §4.15): it has its own route, its own audit action and
     * (later) its own permission.
     *
     * **Refused while a live recipe version still names it** (K1.2) **or a
     * live catalogue item lists it** (K1.4). An archived ingredient a
     * published formulation depends on would leave that recipe pointing at
     * history, and one a published dish names on its ingredient list would
     * leave a customer reading a label whose source is gone. The list endpoint
     * hides archived rows precisely so nobody builds either out of one.
     * Retired versions and retired items are not blockers: history is allowed
     * to reference an archived ingredient, and treating it as one would mean a
     * kitchen could never retire an ingredient it had ever used.
     *
     * The question is asked through `IngredientUsageRegistry` rather than by
     * querying recipe or catalogue tables here: the dependency edges run
     * Recipes → Ingredients and Catalogues → Ingredients, and this module must
     * not learn that either of them exists.
     *
     * @throws ApiException
     */
    public function archive(Ingredient $ingredient, int $expectedLockVersion): Ingredient
    {
        $this->assertWritable($ingredient);

        if ($ingredient->status === IngredientStatus::Archived) {
            throw new ApiException(
                ErrorCode::ResourceConflict,
                'This ingredient is already archived.',
                ['current_lock_version' => $ingredient->lock_version, 'status' => $ingredient->status->value],
            );
        }

        $references = $this->usage->activeReferences($ingredient);

        if ($references['recipe_version_ids'] !== [] || $references['catalogue_item_ids'] !== []) {
            throw new ApiException(
                ErrorCode::CatalogueInUse,
                'This ingredient is still used by a recipe version or a catalogue item that has not been retired.',
                $references,
            );
        }

        $this->compareAndSwap($ingredient, [
            'status' => IngredientStatus::Archived->value,
            'updated_by' => $this->context->userId(),
        ], $expectedLockVersion);

        $this->audit->record(
            'catalogue.ingredient_archived',
            actorUserId: $this->context->userId(),
            subjectType: 'ingredient',
            subjectId: (string) $ingredient->getKey(),
            metadata: ['slug' => $ingredient->slug, 'lock_version' => $ingredient->lock_version],
        );

        return $ingredient;
    }

    /**
     * @throws ApiException
     */
    public function addAlias(Ingredient $ingredient, string $alias, ?string $locale = null): IngredientAlias
    {
        $this->assertWritable($ingredient);

        $normalised = IngredientAlias::normalise($alias);

        if ($normalised === '') {
            throw new ApiException(ErrorCode::ValidationFailed, details: ['fields' => ['alias' => ['The alias field is required.']]]);
        }

        $existing = IngredientAlias::query()
            ->where('ingredient_id', $ingredient->getKey())
            ->where('alias_normalised', $normalised)
            ->first();

        if ($existing instanceof IngredientAlias) {
            throw new ApiException(
                ErrorCode::ResourceConflict,
                'This ingredient already answers to that name.',
                ['alias' => $existing->alias],
            );
        }

        $record = new IngredientAlias;
        $record->ingredient_id = (string) $ingredient->getKey();
        $record->alias = $alias;
        $record->locale = $locale;
        $record->save();

        $this->audit->record(
            'catalogue.ingredient_updated',
            actorUserId: $this->context->userId(),
            subjectType: 'ingredient',
            subjectId: (string) $ingredient->getKey(),
            metadata: ['changed_fields' => ['aliases'], 'alias_added' => $record->alias],
        );

        return $record;
    }

    /**
     * @throws ApiException
     */
    public function removeAlias(Ingredient $ingredient, IngredientAlias $alias): void
    {
        $this->assertWritable($ingredient);

        $removed = $alias->alias;
        $alias->delete();

        $this->audit->record(
            'catalogue.ingredient_updated',
            actorUserId: $this->context->userId(),
            subjectType: 'ingredient',
            subjectId: (string) $ingredient->getKey(),
            metadata: ['changed_fields' => ['aliases'], 'alias_removed' => $removed],
        );
    }

    /**
     * Resolve a free-text designation — a supplier's wording, a line on a
     * technical sheet, a search box — to an ingredient.
     *
     * Aliases are consulted before names, because an alias is an explicit
     * human decision that "this text means this ingredient" and a name match
     * is only a coincidence of spelling. Within each step the tenant's own
     * rows win over the platform library: a kitchen that has forked "Olive
     * oil" means its own.
     *
     * Nothing here guesses. There is no fuzzy match, no stemming and no
     * "closest" result, because an over-eager resolver silently attaches the
     * wrong allergen profile to a dish (risk R4). An unresolved designation
     * is a report line for a human, not a best effort.
     */
    public function resolveDesignation(string $designation, ?string $organisationId): ?Ingredient
    {
        $normalised = IngredientAlias::normalise($designation);

        if ($normalised === '') {
            return null;
        }

        /*
         * Food only, on both passes below.
         *
         * This resolves a *raw material* by the name a technical sheet wrote down, and packaging
         * shares the table. "Bag" and "Cup" are both plausible sheet designations and both are
         * packaging rows; resolving one here would put a bin liner on a recipe line, which is the
         * one place the two families must never be interchangeable.
         */
        $aliasMatches = Ingredient::withoutTenancy()
            ->excludingPackaging()
            ->whereIn('id', IngredientAlias::query()->where('alias_normalised', $normalised)->select('ingredient_id'))
            ->where(function ($query) use ($organisationId): void {
                $query->whereNull('organisation_id');

                if ($organisationId !== null) {
                    $query->orWhere('organisation_id', $organisationId);
                }
            })
            ->get();

        $resolved = $this->preferTenantRow($aliasMatches->all(), $organisationId);

        if ($resolved instanceof Ingredient) {
            return $resolved;
        }

        $nameMatches = Ingredient::withoutTenancy()
            ->excludingPackaging()
            ->where(function ($query) use ($normalised): void {
                $query->whereRaw('lower(name_en) = ?', [$normalised])
                    ->orWhereRaw('lower(name_ar) = ?', [$normalised]);
            })
            ->where(function ($query) use ($organisationId): void {
                $query->whereNull('organisation_id');

                if ($organisationId !== null) {
                    $query->orWhere('organisation_id', $organisationId);
                }
            })
            ->get();

        return $this->preferTenantRow($nameMatches->all(), $organisationId);
    }

    /**
     * A tenant may write only its own rows. Platform rows belong to the
     * platform operator, which may write them; a kitchen reads them, and the
     * fork endpoint (a later slice) is how it makes one its own.
     *
     * @throws PlatformRowImmutable
     */
    public function assertWritable(Ingredient|IngredientCategory $record): void
    {
        if (! $this->isWritable($record)) {
            throw new PlatformRowImmutable;
        }
    }

    /**
     * The same rule as a predicate, so a client can be told which rows it may
     * edit instead of discovering it from a 403 — the claim `is_platform` has
     * always made on the wire and could not keep, because whether a platform
     * row is editable depends on who is asking.
     */
    public function isWritable(Ingredient|IngredientCategory $record): bool
    {
        return $record->organisation_id !== null || $this->platform->mayWritePlatformRows();
    }

    /**
     * The conditional update that makes `If-Match` mean something.
     *
     * @param  array<string, mixed>  $changes
     *
     * @throws StaleLockVersion
     */
    private function compareAndSwap(Ingredient $ingredient, array $changes, int $expectedLockVersion): void
    {
        $affected = DB::transaction(function () use ($ingredient, $changes, $expectedLockVersion): int {
            return Ingredient::withoutTenancy()
                ->whereKey($ingredient->getKey())
                ->where('lock_version', $expectedLockVersion)
                ->update($changes + [
                    'lock_version' => $expectedLockVersion + 1,
                    'updated_at' => now(),
                ]);
        });

        if ($affected === 0) {
            $current = Ingredient::withoutTenancy()->whereKey($ingredient->getKey())->value('lock_version');

            throw new StaleLockVersion(is_numeric($current) ? (int) $current : $expectedLockVersion);
        }

        $ingredient->refresh();
    }

    /**
     * @param  array<int, Ingredient>  $candidates
     */
    private function preferTenantRow(array $candidates, ?string $organisationId): ?Ingredient
    {
        if ($candidates === []) {
            return null;
        }

        foreach ($candidates as $candidate) {
            if ($organisationId !== null && $candidate->organisation_id === $organisationId) {
                return $candidate;
            }
        }

        foreach ($candidates as $candidate) {
            if ($candidate->organisation_id === null) {
                return $candidate;
            }
        }

        return $candidates[0];
    }

    /**
     * The next number in one series, for this kitchen.
     *
     * The recipe library's `nextReferenceFor` in every respect — same scan, same reason it is a
     * scan rather than a counter column: an imported row that already carries `ING-306` is
     * respected, and the next one lands at 307 instead of at whatever a separate counter happened
     * to hold. Public because the create form asks for it before it saves, and the only way the
     * number it draws can be the real one is for the same scan to answer both questions.
     *
     * A preview, not a reservation. Two people starting an ingredient at the same moment both see
     * 307 and the second saves at 308 — which is the honest behaviour here, and better than a
     * counter that hands out reservations nobody may use and leaves permanent holes in a sequence
     * somebody reads down a column.
     *
     * Zero-padded to three, matching the `ING-001` the import wrote. A library past 999 simply gets
     * a four-digit reference; nothing breaks, the number just grows.
     */
    public function nextReferenceFor(string $organisationId, string $prefix): string
    {
        $highest = 0;

        $existing = Ingredient::withoutTenancy()
            ->where(function ($query) use ($organisationId): void {
                // Platform rows carry no organisation and are what `ING-001..306` are: the series a
                // kitchen's own first ingredient continues rather than restarts.
                $query->where('organisation_id', $organisationId)->orWhereNull('organisation_id');
            })
            ->whereNotNull('source_ref')
            ->pluck('source_ref');

        foreach ($existing as $reference) {
            if (preg_match('/^'.preg_quote($prefix, '/').'(\d+)$/', (string) $reference, $matches) !== 1) {
                continue;
            }

            $highest = max($highest, (int) $matches[1]);
        }

        return $prefix.str_pad((string) ($highest + 1), 3, '0', STR_PAD_LEFT);
    }

    /**
     * @throws ApiException
     */
    private function requireOrganisation(): string
    {
        $organisationId = $this->context->organisationId();

        if ($organisationId === null) {
            throw new ApiException(ErrorCode::ContextOrganisationRequired);
        }

        return $organisationId;
    }

    private function uniqueSlug(string $source, string $organisationId): string
    {
        $base = Str::limit(Str::slug($source), 110, '');

        if ($base === '') {
            $base = 'ingredient';
        }

        $slug = $base;
        $suffix = 2;

        while (Ingredient::withoutTenancy()->where('organisation_id', $organisationId)->where('slug', $slug)->exists()) {
            $slug = $base.'-'.$suffix;
            $suffix++;
        }

        return $slug;
    }

    private function trimmedOrNull(?string $value): ?string
    {
        if ($value === null) {
            return null;
        }

        $trimmed = trim($value);

        return $trimmed === '' ? null : $trimmed;
    }

    /**
     * A sub-category has to be a child *of the category it is filed under*.
     *
     * `ingredient_categories` is one self-referencing table, so both columns
     * point at the same place and `Rule::exists` on either of them proves only
     * that the row is *a* category. Nothing stopped a caller filing an
     * ingredient under `herb-spice` with a sub-category belonging to `dairy`,
     * or under a top-level category used as if it were a leaf — and the client
     * reads the pair back as one code, so the mismatch would surface much later
     * as a category that silently changed.
     *
     * It lives in the service rather than in the form requests because the
     * PATCH path needs the *persisted* parent to decide, and the route hands
     * the controller an id rather than a bound model — a form request would
     * have to repeat the locator lookup, and with it the tenancy rules.
     *
     * Raised as `validation.failed` with a field entry, matching how
     * {@see addAlias()} reports an empty alias: this is a bad request, not a
     * conflict.
     *
     * @throws ApiException
     */
    private function assertSubcategoryBelongsToCategory(?string $categoryId, ?string $subcategoryId): void
    {
        if ($subcategoryId === null) {
            return;
        }

        if ($categoryId === null) {
            throw new ApiException(ErrorCode::ValidationFailed, details: ['fields' => [
                'ingredient_subcategory_id' => ['A sub-category cannot be set without its category.'],
            ]]);
        }

        $belongs = IngredientCategory::query()
            ->whereKey($subcategoryId)
            ->where('parent_id', $categoryId)
            ->exists();

        if (! $belongs) {
            throw new ApiException(ErrorCode::ValidationFailed, details: ['fields' => [
                'ingredient_subcategory_id' => ['The selected sub-category does not belong to the selected category.'],
            ]]);
        }
    }
}
