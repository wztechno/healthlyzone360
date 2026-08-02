<?php

declare(strict_types=1);

namespace Healthy360\Recipes\Services;

use Healthy360\Audit\Services\AuditRecorder;
use Healthy360\Recipes\Enums\DerivationState;
use Healthy360\Recipes\Enums\RecipeCompleteness;
use Healthy360\Recipes\Enums\RecipeConfidentiality;
use Healthy360\Recipes\Enums\RecipeStatus;
use Healthy360\Recipes\Enums\RecipeVersionStatus;
use Healthy360\Recipes\Exceptions\RecipeInUse;
use Healthy360\Recipes\Exceptions\StaleLockVersion;
use Healthy360\Recipes\Models\Recipe;
use Healthy360\Recipes\Models\RecipeVersion;
use Healthy360\Support\Api\ErrorCode;
use Healthy360\Support\Api\Exceptions\ApiException;
use Healthy360\Tenancy\TenantContext;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

/**
 * Every write to a recipe *identity* — the row a kitchen names and searches
 * for. Version content belongs to `RecipeVersionService`.
 *
 * The one non-obvious behaviour is `create()`: it also writes version 1 as a
 * draft, in the same transaction. A recipe with no versions is a name with
 * nothing behind it — every read path would have to handle "no versions yet"
 * and every client would have to make two calls to reach an editable thing.
 * The version is the unit of work, so creating a recipe creates one.
 */
final readonly class RecipeService
{
    public function __construct(
        private TenantContext $context,
        private AuditRecorder $audit,
    ) {}

    /**
     * @param  array{
     *     name_en: string,
     *     name_ar?: string|null,
     *     slug?: string|null,
     *     branch_id?: string|null,
     *     recipe_category?: string|null,
     *     source_kind?: string|null,
     *     confidentiality?: string|null,
     *     notes?: string|null
     * }  $attributes
     * @return array{recipe: Recipe, version: RecipeVersion}
     *
     * @throws ApiException
     */
    public function create(array $attributes): array
    {
        $organisationId = $this->requireOrganisation();
        $nameEn = trim($attributes['name_en']);

        return DB::transaction(function () use ($attributes, $organisationId, $nameEn): array {
            $recipe = new Recipe;
            $recipe->organisation_id = $organisationId;
            $recipe->branch_id = $attributes['branch_id'] ?? null;
            $recipe->slug = $this->uniqueSlug($attributes['slug'] ?? $nameEn, $organisationId);
            $recipe->name_en = $nameEn;
            $recipe->name_ar = $this->trimmedOrNull($attributes['name_ar'] ?? null) ?? $nameEn;
            $recipe->recipe_category = $this->trimmedOrNull($attributes['recipe_category'] ?? null);
            $recipe->source_kind = $this->trimmedOrNull($attributes['source_kind'] ?? null);
            $recipe->confidentiality = RecipeConfidentiality::tryFrom((string) ($attributes['confidentiality'] ?? ''))
                ?? RecipeConfidentiality::Confidential;
            $recipe->status = RecipeStatus::Active;
            $recipe->notes = $this->trimmedOrNull($attributes['notes'] ?? null);
            $recipe->lock_version = 0;
            $recipe->created_by = $this->context->userId();
            $recipe->updated_by = $this->context->userId();
            $recipe->save();

            $version = new RecipeVersion;
            $version->recipe_id = (string) $recipe->getKey();
            $version->organisation_id = $organisationId;
            $version->version_number = 1;
            $version->status = RecipeVersionStatus::Draft;
            $version->completeness = RecipeCompleteness::Indicative;

            // Nothing has been derived for a brand-new version, and `current`
            // on an empty label is the most dangerous default available.
            $version->derivation_state = DerivationState::Stale;
            $version->lock_version = 0;
            $version->created_by = $this->context->userId();
            $version->updated_by = $this->context->userId();
            $version->save();

            $this->audit->record(
                'catalogue.recipe_created',
                actorUserId: $this->context->userId(),
                subjectType: 'recipe',
                subjectId: (string) $recipe->getKey(),
                metadata: ['slug' => $recipe->slug, 'status' => $recipe->status->value],
            );

            $this->audit->record(
                'catalogue.recipe_version_created',
                actorUserId: $this->context->userId(),
                subjectType: 'recipe_version',
                subjectId: (string) $version->getKey(),
                metadata: ['recipe_id' => (string) $recipe->getKey(), 'version_number' => 1, 'origin' => 'recipe_created'],
            );

            return ['recipe' => $recipe, 'version' => $version];
        });
    }

    /**
     * @param  array<string, mixed>  $attributes
     *
     * @throws ApiException
     */
    public function update(Recipe $recipe, array $attributes, int $expectedLockVersion): Recipe
    {
        $changes = [];

        foreach (['name_en', 'name_ar', 'branch_id', 'recipe_category', 'source_kind', 'confidentiality', 'notes'] as $field) {
            if (! array_key_exists($field, $attributes)) {
                continue;
            }

            $value = $attributes[$field];

            if (is_string($value)) {
                $value = trim($value);
            }

            if ($value === '' && in_array($field, ['notes', 'recipe_category', 'source_kind'], true)) {
                $value = null;
            }

            $changes[$field] = $value;
        }

        if ($changes === []) {
            return $recipe;
        }

        $changes['updated_by'] = $this->context->userId();

        $this->compareAndSwap($recipe, $changes, $expectedLockVersion);

        $this->audit->record(
            'catalogue.recipe_updated',
            actorUserId: $this->context->userId(),
            subjectType: 'recipe',
            subjectId: (string) $recipe->getKey(),
            metadata: [
                'changed_fields' => array_values(array_diff(array_keys($changes), ['updated_by'])),
                'lock_version' => $recipe->lock_version,
            ],
        );

        return $recipe;
    }

    /**
     * Archive a recipe — a lifecycle action with its own route and its own
     * audit event (master plan v2 §4.15).
     *
     * Refused while a published version exists. Archiving is not a way to
     * withdraw something from sale: retiring the version is, and it has its
     * own permission. Allowing archive to do it implicitly would let a
     * manager pull a live recipe with a route that never mentions
     * publication, and the audit trail would say "archived" where the
     * meaningful event was "withdrawn".
     *
     * @throws ApiException
     */
    public function archive(Recipe $recipe, int $expectedLockVersion): Recipe
    {
        if ($recipe->status === RecipeStatus::Archived) {
            throw new ApiException(
                ErrorCode::ResourceConflict,
                'This recipe is already archived.',
                ['current_lock_version' => $recipe->lock_version, 'status' => $recipe->status->value],
            );
        }

        $published = array_values(RecipeVersion::query()
            ->where('recipe_id', $recipe->getKey())
            ->where('status', RecipeVersionStatus::Published->value)
            ->pluck('id')
            ->map(static fn (mixed $id): string => (string) $id)
            ->all());

        if ($published !== []) {
            throw new RecipeInUse($published);
        }

        $this->compareAndSwap($recipe, [
            'status' => RecipeStatus::Archived->value,
            'updated_by' => $this->context->userId(),
        ], $expectedLockVersion);

        $this->audit->record(
            'catalogue.recipe_archived',
            actorUserId: $this->context->userId(),
            subjectType: 'recipe',
            subjectId: (string) $recipe->getKey(),
            metadata: ['slug' => $recipe->slug, 'lock_version' => $recipe->lock_version],
        );

        return $recipe;
    }

    /**
     * The conditional update that makes `If-Match` mean something: a single
     * `UPDATE … WHERE lock_version = ?`, never a read followed by a write,
     * because the gap between the two is precisely the race the header exists
     * to close.
     *
     * @param  array<string, mixed>  $changes
     *
     * @throws StaleLockVersion
     */
    private function compareAndSwap(Recipe $recipe, array $changes, int $expectedLockVersion): void
    {
        $affected = DB::transaction(fn (): int => Recipe::withoutTenancy()
            ->whereKey($recipe->getKey())
            ->where('lock_version', $expectedLockVersion)
            ->update($changes + [
                'lock_version' => $expectedLockVersion + 1,
                'updated_at' => now(),
            ]));

        if ($affected === 0) {
            $current = Recipe::withoutTenancy()->whereKey($recipe->getKey())->value('lock_version');

            throw new StaleLockVersion(is_numeric($current) ? (int) $current : $expectedLockVersion);
        }

        $recipe->refresh();
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
            $base = 'recipe';
        }

        $slug = $base;
        $suffix = 2;

        while (Recipe::withoutTenancy()->where('organisation_id', $organisationId)->where('slug', $slug)->exists()) {
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
