<?php

declare(strict_types=1);

namespace Healthy360\Ingredients\Services;

use Healthy360\Audit\Services\AuditRecorder;
use Healthy360\Ingredients\Enums\AvailabilityTier;
use Healthy360\Ingredients\Enums\IngredientStatus;
use Healthy360\Ingredients\Enums\IngredientVerificationStatus;
use Healthy360\Ingredients\Exceptions\PlatformRowImmutable;
use Healthy360\Ingredients\Exceptions\StaleLockVersion;
use Healthy360\Ingredients\Models\Ingredient;
use Healthy360\Ingredients\Models\IngredientAlias;
use Healthy360\Ingredients\Models\IngredientCategory;
use Healthy360\Support\Api\ErrorCode;
use Healthy360\Support\Api\Exceptions\ApiException;
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
    public function __construct(
        private TenantContext $context,
        private AuditRecorder $audit,
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
        $ingredient->ingredient_category_id = $attributes['ingredient_category_id'] ?? null;
        $ingredient->ingredient_subcategory_id = $attributes['ingredient_subcategory_id'] ?? null;
        $ingredient->default_unit_id = $attributes['default_unit_id'];
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
     * Update a tenant ingredient, guarded by `lock_version`.
     *
     * @param  array<string, mixed>  $attributes
     *
     * @throws ApiException
     */
    public function update(Ingredient $ingredient, array $attributes, int $expectedLockVersion): Ingredient
    {
        $this->assertWritable($ingredient);

        $changes = [];

        foreach (['name_en', 'name_ar', 'ingredient_category_id', 'ingredient_subcategory_id', 'default_unit_id', 'yield_factor', 'availability_tier', 'notes'] as $field) {
            if (! array_key_exists($field, $attributes)) {
                continue;
            }

            $value = $attributes[$field];

            if (is_string($value)) {
                $value = trim($value);
            }

            if ($field === 'notes' && $value === '') {
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

        $aliasMatches = Ingredient::withoutTenancy()
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
     * A tenant may write only its own rows. Platform rows are readable, and
     * the fork endpoint (a later slice) is how a kitchen makes one its own.
     *
     * @throws PlatformRowImmutable
     */
    public function assertWritable(Ingredient|IngredientCategory $record): void
    {
        if ($record->organisation_id === null) {
            throw new PlatformRowImmutable;
        }
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
}
