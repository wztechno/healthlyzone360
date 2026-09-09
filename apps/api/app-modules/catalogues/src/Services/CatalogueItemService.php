<?php

declare(strict_types=1);

namespace Healthy360\Catalogues\Services;

use Healthy360\Audit\Services\AuditRecorder;
use Healthy360\Catalogues\Enums\CatalogueItemStatus;
use Healthy360\Catalogues\Enums\CatalogueItemType;
use Healthy360\Catalogues\Enums\CatalogueStatus;
use Healthy360\Catalogues\Enums\ProductionMode;
use Healthy360\Catalogues\Models\Catalogue;
use Healthy360\Catalogues\Models\CatalogueItem;
use Healthy360\Catalogues\Models\CatalogueItemDietClassification;
use Healthy360\Catalogues\Models\CatalogueItemIngredient;
use Healthy360\Catalogues\Models\ProductCategory;
use Healthy360\Ingredients\Enums\IngredientStatus;
use Healthy360\Ingredients\Models\Ingredient;
use Healthy360\Recipes\Models\Recipe;
use Healthy360\ReferenceData\Models\DietClassification;
use Healthy360\ReferenceData\Models\MeasurementUnit;
use Healthy360\Support\Api\ErrorCode;
use Healthy360\Support\Api\Exceptions\ApiException;
use Healthy360\Support\Api\Exceptions\StaleLockVersion;
use Healthy360\Tenancy\TenantContext;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

/**
 * Every write to a catalogue item — the identity a kitchen sells.
 *
 * Three rules run through it.
 *
 * 1. **The slug is immutable** (master plan v2 §4). It is derived once, from
 *    the English name or an explicit value, and after that a rename changes
 *    `name_en`/`name_ar` and nothing else. A slug is what a link, a
 *    marketplace listing and a partner's integration hold; a system that lets
 *    it move quietly breaks other people's bookmarks on a typo fix. A request
 *    that carries `slug` on update is refused rather than ignored, because a
 *    client that sent it believed it was writing something.
 * 2. **`name_ar` may be empty, and empty is a state.** Unlike a recipe — where
 *    the Arabic name falls back to the English one so drafting stays
 *    frictionless — a catalogue item is customer-facing, so an untranslated
 *    name has to be visible *as* untranslated rather than silently English.
 *    The empty string is the "not yet translated" state, and the publish gate
 *    refuses it. That is exactly what the admin contract means by "both
 *    languages required, because the readiness evaluator refuses to publish a
 *    row whose translations are incomplete".
 * 3. **Sellable items retire; they never archive.** There is no `archive()`
 *    here and no `deleted` state anywhere: an order or a price snapshot may
 *    point at an item forever. Withdrawal is `PublishCatalogueItem::retire()`,
 *    with its own route, its own permission and its own audit action.
 *
 * There is deliberately **no price, cost or margin anywhere in this class**.
 * Money is K1.5's `price_lists`; the admin contract's confidential
 * `marginPercent` is a presentation figure computed from a price and a cost,
 * and has no server-side home in this slice.
 */
final readonly class CatalogueItemService
{
    /**
     * The series each sellable kind is numbered in, and what the v6 sheets already wrote.
     *
     * These handles are the kitchen's own — `SAC-001`, `DRS-019` — and the import put the same one
     * on the item *and* on the ingredient twin it writes beside it, so a sauce is quotable whether
     * a cook is looking at what is sold or at what a recipe consumes. A row created here joins the
     * series rather than arriving without a handle.
     *
     * Products and meals are absent on purpose. The sheets number them `RSL-`/`PRD-`, but not all
     * of them — a fifth of the products carry a source path instead of a handle — so a generated
     * `RSL-056` would sit in a column where the existing values do not agree on what a reference
     * is. That is a decision about those two families, and it is not this change's to make.
     */
    private const array REFERENCE_SERIES = [
        'sauce' => 'SAC-',
        'dressing' => 'DRS-',
    ];

    public function __construct(
        private TenantContext $context,
        private AuditRecorder $audit,
    ) {}

    /**
     * @param  array{
     *     item_type: string,
     *     name_en: string,
     *     name_ar?: string|null,
     *     slug?: string|null,
     *     catalogue_id?: string|null,
     *     description_en?: string|null,
     *     description_ar?: string|null,
     *     composition?: string|null,
     *     kitchen_category?: string|null,
     *     kitchen_subcategory?: string|null,
     *     product_category_id?: string|null,
     *     production_mode?: string|null,
     *     recipe_id?: string|null,
     *     ingredient_id?: string|null,
     *     purchasing_unit_id?: string|null,
     *     usage_unit_id?: string|null,
     *     is_market_priced?: bool|null,
     *     is_assorted?: bool|null,
     *     image_placeholder_id?: string|null
     * }  $attributes
     *
     * @throws ApiException
     */
    public function create(array $attributes): CatalogueItem
    {
        $organisationId = $this->requireOrganisation();
        $nameEn = trim($attributes['name_en']);

        $type = CatalogueItemType::tryFrom($attributes['item_type']);

        if ($type === null) {
            throw $this->invalid('item_type', 'An item is a product, a meal or a subscription plan.');
        }

        $catalogue = $this->resolveCatalogue($attributes['catalogue_id'] ?? null, $organisationId);
        $links = $this->validatedLinks($attributes, $organisationId);

        return DB::transaction(function () use ($attributes, $organisationId, $nameEn, $type, $catalogue, $links): CatalogueItem {
            $item = new CatalogueItem;
            $item->organisation_id = $organisationId;
            $item->catalogue_id = (string) $catalogue->getKey();
            $item->item_type = $type;
            $item->slug = $this->uniqueSlug($attributes['slug'] ?? $nameEn, $organisationId);
            $item->name_en = $nameEn;

            // Empty, not the English name: an untranslated customer-facing
            // name must be visible as untranslated, and the publish gate is
            // what makes that consequential.
            $item->name_ar = $this->trimmedOrNull($attributes['name_ar'] ?? null) ?? '';
            $item->description_en = $this->trimmedOrNull($attributes['description_en'] ?? null);
            $item->composition = $this->trimmedOrNull($attributes['composition'] ?? null);
            $item->kitchen_category = $this->trimmedOrNull($attributes['kitchen_category'] ?? null);
            $item->kitchen_subcategory = $this->trimmedOrNull($attributes['kitchen_subcategory'] ?? null);
            $item->description_ar = $this->trimmedOrNull($attributes['description_ar'] ?? null);
            $item->product_category_id = $links['product_category_id'];
            $item->production_mode = $links['production_mode'];
            $item->recipe_id = $links['recipe_id'];
            $item->ingredient_id = $links['ingredient_id'];
            $item->purchasing_unit_id = $links['purchasing_unit_id'];
            $item->usage_unit_id = $links['usage_unit_id'];
            $item->is_market_priced = (bool) ($attributes['is_market_priced'] ?? false);
            $item->is_assorted = (bool) ($attributes['is_assorted'] ?? false);
            $item->status = CatalogueItemStatus::Draft;
            $item->image_placeholder_id = $this->trimmedOrNull($attributes['image_placeholder_id'] ?? null);
            $item->lock_version = 0;
            // The kitchen's own handle, where its kind has a series. `source_system` stays null, so
            // nothing here is mistaken for an imported row: the import matches on the pair.
            $prefix = self::REFERENCE_SERIES[$type->value] ?? null;
            if ($prefix !== null) {
                $item->source_ref = $this->nextReferenceFor($organisationId, $prefix);
            }
            $item->created_by = $this->context->userId();
            $item->updated_by = $this->context->userId();
            $item->save();

            $this->audit->record(
                'catalogue.item_created',
                actorUserId: $this->context->userId(),
                subjectType: 'catalogue_item',
                subjectId: (string) $item->getKey(),
                metadata: [
                    'slug' => $item->slug,
                    'item_type' => $type->value,
                    'status' => $item->status->value,
                ],
            );

            return $item;
        });
    }

    /**
     * @param  array<string, mixed>  $attributes
     *
     * @throws ApiException
     */
    public function update(CatalogueItem $item, array $attributes, int $expectedLockVersion): CatalogueItem
    {
        $this->assertEditable($item);

        if (array_key_exists('slug', $attributes)) {
            throw $this->invalid('slug', 'A slug is fixed when the item is created. Rename the item instead.');
        }

        if (array_key_exists('item_type', $attributes)) {
            throw $this->invalid('item_type', 'An item cannot change what kind of thing it is. Create the new one and retire this.');
        }

        $organisationId = $this->requireOrganisation();
        $links = $this->validatedLinks($attributes, $organisationId);

        $changes = [];

        foreach (['name_en', 'name_ar', 'description_en', 'description_ar', 'composition', 'kitchen_category', 'kitchen_subcategory', 'image_placeholder_id'] as $field) {
            if (! array_key_exists($field, $attributes)) {
                continue;
            }

            $value = $attributes[$field];

            if (is_string($value)) {
                $value = trim($value);
            }

            // `name_ar` keeps the empty string it was given: unlike a
            // description, "" is the meaningful "not yet translated" state
            // that the publish gate reads.
            if ($value === '' && $field !== 'name_ar') {
                $value = null;
            }

            $changes[$field] = $value;
        }

        foreach (['is_market_priced', 'is_assorted'] as $field) {
            if (array_key_exists($field, $attributes)) {
                $changes[$field] = (bool) $attributes[$field];
            }
        }

        foreach (['product_category_id', 'production_mode', 'recipe_id', 'ingredient_id', 'purchasing_unit_id', 'usage_unit_id'] as $field) {
            if (array_key_exists($field, $attributes)) {
                $changes[$field] = $field === 'production_mode' ? $links[$field]?->value : $links[$field];
            }
        }

        if ($changes === []) {
            return $item;
        }

        if (($changes['name_en'] ?? null) === '') {
            throw $this->invalid('name_en', 'An item must have a name.');
        }

        $changes['updated_by'] = $this->context->userId();

        $this->compareAndSwap($item, $changes, $expectedLockVersion);

        $this->audit->record(
            'catalogue.item_updated',
            actorUserId: $this->context->userId(),
            subjectType: 'catalogue_item',
            subjectId: (string) $item->getKey(),
            metadata: [
                'changed_fields' => array_values(array_diff(array_keys($changes), ['updated_by'])),
                'lock_version' => $item->lock_version,
            ],
        );

        return $item;
    }

    /**
     * Replace the public ingredient list.
     *
     * A PUT because the body is the complete list, for the reason the recipe
     * line editor gives: a PATCH surface makes "I removed the sesame" and "I
     * forgot to send the sesame" the same request, and on something a diner
     * reads to decide whether they can eat it, that difference is the whole
     * point.
     *
     * The array order **is** `display_order`: the sequence ingredients are
     * named in is a labelling convention (descending by weight, in most
     * regimes), not a detail to re-sort alphabetically on the way in.
     *
     * @param  list<array{ingredient_id: string, is_representative?: bool}>  $ingredients
     *
     * @throws ApiException
     */
    public function setIngredients(CatalogueItem $item, array $ingredients, int $expectedLockVersion): CatalogueItem
    {
        $this->assertEditable($item);

        $prepared = [];
        $seen = [];

        foreach ($ingredients as $index => $row) {
            $ingredient = $this->usableIngredient((string) $row['ingredient_id'], "ingredients.{$index}.ingredient_id");
            $ingredientId = (string) $ingredient->getKey();

            if (in_array($ingredientId, $seen, true)) {
                throw $this->invalid("ingredients.{$index}.ingredient_id", 'An ingredient may be listed once per item.');
            }

            $seen[] = $ingredientId;

            $prepared[] = [
                'ingredient_id' => $ingredientId,
                'is_representative' => (bool) ($row['is_representative'] ?? false),
                'display_order' => $index + 1,
            ];
        }

        DB::transaction(function () use ($item, $prepared, $expectedLockVersion): void {
            $this->compareAndSwap($item, ['updated_by' => $this->context->userId()], $expectedLockVersion);

            CatalogueItemIngredient::withoutTenancy()->where('catalogue_item_id', $item->getKey())->delete();

            foreach ($prepared as $attributes) {
                $row = new CatalogueItemIngredient;
                $row->organisation_id = $item->organisation_id;
                $row->catalogue_item_id = (string) $item->getKey();
                $row->ingredient_id = $attributes['ingredient_id'];
                $row->is_representative = $attributes['is_representative'];
                $row->display_order = $attributes['display_order'];
                $row->created_by = $this->context->userId();
                $row->save();
            }
        });

        $this->audit->record(
            'catalogue.item_updated',
            actorUserId: $this->context->userId(),
            subjectType: 'catalogue_item',
            subjectId: (string) $item->getKey(),
            metadata: [
                'changed_fields' => ['ingredients'],
                'ingredient_count' => count($prepared),
                'lock_version' => $item->lock_version,
            ],
        );

        return $item;
    }

    /**
     * Replace the diet tags, addressed by their platform codes.
     *
     * Codes rather than identifiers because that is what the admin contract
     * carries (`dietClassifications: DietClassification[]`, a closed union of
     * codes) and what a human reads. The vocabulary is platform reference
     * data, so a code that does not resolve is a validation failure and never
     * an invitation to create one.
     *
     * @param  list<string>  $codes
     *
     * @throws ApiException
     */
    public function setDietClassifications(CatalogueItem $item, array $codes, int $expectedLockVersion): CatalogueItem
    {
        $this->assertEditable($item);

        /** @var list<string> $wanted */
        $wanted = array_values(array_unique(array_map(static fn (string $value): string => trim($value), $codes)));

        $resolved = DietClassification::query()
            ->whereIn('code', $wanted)
            ->where('is_active', true)
            ->pluck('id', 'code');

        $unknown = array_values(array_diff($wanted, $resolved->keys()->all()));

        if ($unknown !== []) {
            throw new ApiException(
                ErrorCode::ValidationFailed,
                'These are not active diet classifications the platform recognises.',
                ['fields' => ['diet_classifications' => ['These are not active diet classifications the platform recognises.']], 'unknown' => $unknown],
            );
        }

        DB::transaction(function () use ($item, $wanted, $resolved, $expectedLockVersion): void {
            $this->compareAndSwap($item, ['updated_by' => $this->context->userId()], $expectedLockVersion);

            CatalogueItemDietClassification::withoutTenancy()->where('catalogue_item_id', $item->getKey())->delete();

            foreach ($wanted as $code) {
                $row = new CatalogueItemDietClassification;
                $row->organisation_id = $item->organisation_id;
                $row->catalogue_item_id = (string) $item->getKey();
                $row->diet_classification_id = (string) $resolved[$code];
                $row->save();
            }
        });

        $this->audit->record(
            'catalogue.item_updated',
            actorUserId: $this->context->userId(),
            subjectType: 'catalogue_item',
            subjectId: (string) $item->getKey(),
            metadata: [
                'changed_fields' => ['diet_classifications'],
                'diet_classifications' => $wanted,
                'lock_version' => $item->lock_version,
            ],
        );

        return $item;
    }

    /**
     * A retired item is frozen. Everything else — including a published one —
     * stays editable, which is the deliberate difference from a recipe
     * version: a version is a frozen formulation whose label a customer has
     * already been shown, so a change is a new version; an item is a listing,
     * and fixing a typo in a live description must not require withdrawing it
     * from sale.
     *
     * @throws ApiException
     */
    public function assertEditable(CatalogueItem $item): void
    {
        if (! $item->isEditable()) {
            throw new ApiException(
                ErrorCode::ResourceConflict,
                'A retired catalogue item cannot be changed. Create a replacement instead.',
                ['status' => $item->status->value, 'current_lock_version' => $item->lock_version],
            );
        }
    }

    /**
     * The conditional update that makes `If-Match` mean something: a single
     * `UPDATE … WHERE lock_version = ?`, never a read followed by a write.
     *
     * @param  array<string, mixed>  $changes
     *
     * @throws StaleLockVersion
     */
    public function compareAndSwap(CatalogueItem $item, array $changes, int $expectedLockVersion): void
    {
        $affected = CatalogueItem::withoutTenancy()
            ->whereKey($item->getKey())
            ->where('lock_version', $expectedLockVersion)
            ->update($changes + [
                'lock_version' => $expectedLockVersion + 1,
                'updated_at' => now(),
            ]);

        if ($affected === 0) {
            $current = CatalogueItem::withoutTenancy()->whereKey($item->getKey())->value('lock_version');

            throw new StaleLockVersion(is_numeric($current) ? (int) $current : $expectedLockVersion);
        }

        $item->refresh();
    }

    /**
     * The catalogue an item belongs to.
     *
     * A caller may name one; most will not, because a kitchen with a single
     * range should not have to know the concept exists to add a product to it.
     * The organisation's `default` catalogue is created on demand — active,
     * organisation-wide, no branch — so "add an item" is one call rather than
     * two and the container is still a real row that a second range can sit
     * beside later.
     *
     * @throws ApiException
     */
    private function resolveCatalogue(?string $catalogueId, string $organisationId): Catalogue
    {
        if ($catalogueId !== null && trim($catalogueId) !== '') {
            $catalogue = Catalogue::query()->whereKey(trim($catalogueId))->first();

            if (! $catalogue instanceof Catalogue) {
                throw $this->invalid('catalogue_id', 'This catalogue does not exist, or is not one you can use.');
            }

            if ($catalogue->status === CatalogueStatus::Archived) {
                throw $this->invalid('catalogue_id', 'This catalogue is archived and cannot take new items.');
            }

            return $catalogue;
        }

        $existing = Catalogue::withoutTenancy()
            ->where('organisation_id', $organisationId)
            ->where('code', 'default')
            ->first();

        if ($existing instanceof Catalogue) {
            return $existing;
        }

        $catalogue = new Catalogue;
        $catalogue->organisation_id = $organisationId;
        $catalogue->code = 'default';
        $catalogue->name_en = 'Default catalogue';
        $catalogue->name_ar = 'الكتالوج الافتراضي';
        $catalogue->status = CatalogueStatus::Active;
        $catalogue->lock_version = 0;
        $catalogue->created_by = $this->context->userId();
        $catalogue->updated_by = $this->context->userId();
        $catalogue->save();

        return $catalogue;
    }

    /**
     * Resolve and validate every foreign key a submission may carry.
     *
     * Collected in one place so the create and update paths cannot disagree
     * about what a valid link is — the failure mode where an item can be
     * *edited* into a state it could never have been *created* in. Every
     * value is validated whether or not the caller sent it; which of them are
     * then *applied* is the caller's business, and the update path applies
     * only the keys the request actually carried.
     *
     * @param  array<string, mixed>  $attributes
     * @return array{product_category_id: string|null, production_mode: ProductionMode|null, recipe_id: string|null, ingredient_id: string|null, purchasing_unit_id: string|null, usage_unit_id: string|null}
     *
     * @throws ApiException
     */
    private function validatedLinks(array $attributes, string $organisationId): array
    {
        $categoryId = $this->trimmedOrNull($this->asString($attributes['product_category_id'] ?? null));

        if ($categoryId !== null && ! ProductCategory::query()->whereKey($categoryId)->where('is_active', true)->exists()) {
            throw $this->invalid('product_category_id', 'This product category does not exist, or is not one you can use.');
        }

        $mode = null;

        if (($raw = $this->trimmedOrNull($this->asString($attributes['production_mode'] ?? null))) !== null) {
            $mode = ProductionMode::tryFrom($raw);

            if ($mode === null) {
                throw $this->invalid('production_mode', 'An item is produced, supplied, or both.');
            }
        }

        $recipeId = $this->trimmedOrNull($this->asString($attributes['recipe_id'] ?? null));

        if ($recipeId !== null && ! Recipe::query()->whereKey($recipeId)->where('organisation_id', $organisationId)->exists()) {
            throw $this->invalid('recipe_id', 'This recipe does not exist, or is not one you can use.');
        }

        $ingredientId = $this->trimmedOrNull($this->asString($attributes['ingredient_id'] ?? null));

        if ($ingredientId !== null) {
            $this->usableIngredient($ingredientId, 'ingredient_id');
        }

        $units = [];

        foreach (['purchasing_unit_id', 'usage_unit_id'] as $field) {
            $unitId = $this->trimmedOrNull($this->asString($attributes[$field] ?? null));

            if ($unitId !== null && ! MeasurementUnit::query()->whereKey($unitId)->exists()) {
                throw $this->invalid($field, 'This measurement unit does not exist.');
            }

            $units[$field] = $unitId;
        }

        return [
            'product_category_id' => $categoryId,
            'production_mode' => $mode,
            'recipe_id' => $recipeId,
            'ingredient_id' => $ingredientId,
            'purchasing_unit_id' => $units['purchasing_unit_id'],
            'usage_unit_id' => $units['usage_unit_id'],
        ];
    }

    /**
     * @throws ApiException
     */
    private function usableIngredient(string $id, string $field): Ingredient
    {
        /*
         * Food only.
         *
         * Packaging shares this table — a recipe has to be able to cost the box its meal
         * ships in — but a catalogue item's ingredient list names a raw material. Without the scope a
         * bin liner is a legal answer here, and the roll-up would then be asked to derive
         * nutrition and allergens from it.
         */
        $ingredient = Ingredient::query()->excludingPackaging()->whereKey($id)->first();

        if (! $ingredient instanceof Ingredient) {
            throw $this->invalid($field, 'This ingredient does not exist, or is not one you can use.');
        }

        if ($ingredient->status === IngredientStatus::Archived) {
            throw $this->invalid($field, 'This ingredient is archived and cannot be added to a catalogue item.');
        }

        // Inactive is the operator's "do not use this" switch: the row stays
        // visible (greyed) in the kitchen tables, but nothing new may be
        // built on it until somebody flips it back.
        if ($ingredient->status === IngredientStatus::Inactive) {
            throw $this->invalid($field, 'This ingredient is inactive and cannot be added to a catalogue item until it is reactivated.');
        }

        return $ingredient;
    }

    /**
     * @throws ApiException
     */
    /**
     * The next number in one series, for this kitchen.
     *
     * Scanned over the items rather than over a counter column, and over *this* table rather than
     * the recipes': `SAC-043` and `DRS-019` are here, written by the import, and a series that
     * counted somewhere else would hand out `SAC-001` again to a kitchen that already has one.
     *
     * Public because a create form draws the handle before it saves, and the only way the number it
     * shows can be the one the record takes is for the same scan to answer both. A preview, not a
     * reservation — two forms open at once are both told 044, and the second save lands at 045.
     */
    public function nextReferenceFor(string $organisationId, string $prefix): string
    {
        $highest = 0;

        $existing = CatalogueItem::withoutTenancy()
            ->where('organisation_id', $organisationId)
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
        $base = Str::limit(Str::slug($source), 130, '');

        if ($base === '') {
            $base = 'item';
        }

        $slug = $base;
        $suffix = 2;

        while (CatalogueItem::withoutTenancy()->where('organisation_id', $organisationId)->where('slug', $slug)->exists()) {
            $slug = $base.'-'.$suffix;
            $suffix++;
        }

        return $slug;
    }

    private function asString(mixed $value): ?string
    {
        return is_string($value) ? $value : null;
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
     * @param  array<string, mixed>  $extra
     */
    private function invalid(string $field, string $message, array $extra = []): ApiException
    {
        return new ApiException(
            ErrorCode::ValidationFailed,
            $message,
            ['fields' => [$field => [$message]]] + $extra,
        );
    }
}
