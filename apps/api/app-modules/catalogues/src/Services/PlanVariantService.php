<?php

declare(strict_types=1);

namespace Healthy360\Catalogues\Services;

use Healthy360\Audit\Services\AuditRecorder;
use Healthy360\Catalogues\Enums\CatalogueItemType;
use Healthy360\Catalogues\Enums\ServiceTier;
use Healthy360\Catalogues\Enums\VariantStatus;
use Healthy360\Catalogues\Enums\VariantType;
use Healthy360\Catalogues\Models\CatalogueItem;
use Healthy360\Catalogues\Models\CatalogueItemVariant;
use Healthy360\Catalogues\Models\EnergyBand;
use Healthy360\Catalogues\Models\MealCombinationOption;
use Healthy360\Catalogues\Models\PlanVariantProfile;
use Healthy360\Support\Api\ErrorCode;
use Healthy360\Support\Api\Exceptions\ApiException;
use Healthy360\Tenancy\TenantContext;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

/**
 * The availability matrix of one subscription plan, replaced as a set.
 *
 * **Variant existence encodes the matrix** (appendix D). A client submits
 * *cells* — this combination, at this tier, in this band — and each cell
 * becomes, atomically, a `catalogue_item_variants` row of type
 * `plan_configuration` plus its `plan_variant_profiles` row. There is no
 * separate grid table with holes in it, because the cell and the priceable
 * thing have to be the same object: a plan configuration is priced exactly the
 * way a pack is, through `price_list_items.catalogue_item_variant_id`, and a
 * matrix modelled beside the variants would need a second pricing path to be
 * worth anything at all.
 *
 * **The code is derived, and derived deterministically.** K1.4 fixed variant
 * identity to `code` — it is what a price list names and what a resubmission
 * matches on — and a plan editor that made humans invent sixty codes for a
 * 4 × 2 × 5 matrix would get sixty typos. So the default code is
 * `combination-tier[-band]`, built from the vocabulary rows' own codes, which
 * means the same cell submitted from two clients on two days produces the same
 * code and therefore the same variant, and the same price keeps pointing at it.
 * An explicit `code` is still accepted for a kitchen migrating identifiers it
 * already uses elsewhere; what it may not do is address an existing cell under
 * a new name (see the conflict below).
 *
 * **Absent cells are archived, not deleted**, exactly as in K1.4: a price row
 * or an order may point at that variant forever. Their profile rows stay too,
 * which is what keeps a cell's coordinates occupied — reviving "premium, full
 * day, 1500–1800" means resubmitting *that* cell, not opening a second variant
 * at the same address.
 *
 * **One cell, one variant** is enforced three times over, and each layer
 * catches something the others cannot:
 *
 *  - within the submission (`422`), because a body that states a cell twice is
 *    a client contradiction and the second statement is not more true;
 *  - against the stored matrix (`409`), naming the code that already holds the
 *    cell — including an archived one, so a kitchen is told to revive rather
 *    than left guessing at a constraint violation;
 *  - by the `NULLS NOT DISTINCT` unique index underneath, which is what makes
 *    the rule true of an importer and a console session as well.
 *
 * The write is ordered so that a **swap** works: two cells trading coordinates
 * in one submission would otherwise trip the unique index halfway through. The
 * profile rows of every submitted variant are released before any are written,
 * so no intermediate state has two rows at one address.
 */
final readonly class PlanVariantService
{
    public function __construct(
        private TenantContext $context,
        private AuditRecorder $audit,
        private CatalogueItemService $items,
    ) {}

    /**
     * @param  list<array{
     *     meal_combination_option_id: string,
     *     service_tier?: string|null,
     *     energy_band_id?: string|null,
     *     includes_snacks?: bool|null,
     *     meals_per_day: int|string,
     *     snacks_per_day?: int|string|null,
     *     code?: string|null,
     *     name_en?: string|null,
     *     name_ar?: string|null,
     *     status?: string|null
     * }>  $cells
     *
     * @throws ApiException
     */
    public function replace(CatalogueItem $item, array $cells, int $expectedLockVersion): CatalogueItem
    {
        $this->assertPlan($item);
        $this->items->assertEditable($item);

        $prepared = $this->prepare($item, $cells);

        $counts = DB::transaction(function () use ($item, $prepared, $expectedLockVersion): array {
            $this->items->compareAndSwap($item, ['updated_by' => $this->context->userId()], $expectedLockVersion);

            /** @var array<string, CatalogueItemVariant> $existing */
            $existing = CatalogueItemVariant::withoutTenancy()
                ->where('catalogue_item_id', $item->getKey())
                ->get()
                ->keyBy('code')
                ->all();

            $submitted = array_column($prepared, 'code');
            $archived = 0;

            // Withdrawn cells first. The profile row stays where it is — the
            // cell remains occupied, because a price still points at the
            // variant and "we stopped selling this" is not "this never
            // existed".
            foreach ($existing as $code => $variant) {
                if (in_array($code, $submitted, true) || $variant->status === VariantStatus::Archived) {
                    continue;
                }

                $variant->status = VariantStatus::Archived;
                $variant->is_default = false;
                $variant->updated_by = $this->context->userId();
                $variant->lock_version = $variant->lock_version + 1;
                $variant->save();
                $archived++;
            }

            // Release every submitted variant's cell before writing any of
            // them, so a swap of two cells inside one submission does not trip
            // the unique index halfway through.
            $submittedIds = array_values(array_filter(array_map(
                static fn (string $code): ?string => isset($existing[$code]) ? (string) $existing[$code]->getKey() : null,
                $submitted,
            )));

            if ($submittedIds !== []) {
                PlanVariantProfile::withoutTenancy()->whereIn('catalogue_item_variant_id', $submittedIds)->delete();
            }

            $created = 0;

            foreach ($prepared as $attributes) {
                $variant = $existing[$attributes['code']] ?? new CatalogueItemVariant;

                if (! $variant->exists) {
                    $created++;
                }

                $variant->organisation_id = $item->organisation_id;
                $variant->catalogue_item_id = (string) $item->getKey();
                $variant->variant_type = VariantType::PlanConfiguration;
                $variant->code = $attributes['code'];
                $variant->name_en = $attributes['name_en'];
                $variant->name_ar = $attributes['name_ar'];
                $variant->status = $attributes['status'];

                // A plan has no "which one do we show first" question — the
                // matrix is a grid a customer picks a cell from, not a shelf
                // with a hero pack — so the partial unique index that permits
                // one default per item is simply left unused here.
                $variant->is_default = false;
                $variant->updated_by = $this->context->userId();

                if (! $variant->exists) {
                    $variant->created_by = $this->context->userId();
                    $variant->lock_version = 0;
                } else {
                    $variant->lock_version = $variant->lock_version + 1;
                }

                $variant->save();

                $profile = new PlanVariantProfile;
                $profile->catalogue_item_variant_id = (string) $variant->getKey();
                $profile->organisation_id = $item->organisation_id;
                $profile->catalogue_item_id = (string) $item->getKey();
                $profile->meal_combination_option_id = $attributes['meal_combination_option_id'];
                $profile->energy_band_id = $attributes['energy_band_id'];
                $profile->service_tier = $attributes['service_tier'];
                $profile->includes_snacks = $attributes['includes_snacks'];
                $profile->meals_per_day = $attributes['meals_per_day'];
                $profile->snacks_per_day = $attributes['snacks_per_day'];
                $profile->save();
            }

            return ['created' => $created, 'archived' => $archived];
        });

        $this->audit->record(
            'catalogue.plan_variants_replaced',
            actorUserId: $this->context->userId(),
            subjectType: 'catalogue_item',
            subjectId: (string) $item->getKey(),
            metadata: [
                'changed_fields' => ['plan_variants'],
                'cell_count' => count($prepared),
                'created_count' => $counts['created'],
                'archived_count' => $counts['archived'],
                'lock_version' => $item->lock_version,
            ],
        );

        return $item;
    }

    /**
     * The stored matrix, each cell paired with the variant that carries it.
     *
     * Archived cells are included, and that is the point of reading it at all:
     * a client rendering a grid has to show "we used to sell this" differently
     * from "this address is free", and the two are indistinguishable if
     * withdrawn cells simply vanish.
     *
     * Ordered by the variant's code, which — being derived from the cell's own
     * coordinates — groups the matrix by combination and then by tier without
     * needing a join to sort on.
     *
     * @return list<array{profile: PlanVariantProfile, variant: CatalogueItemVariant}>
     */
    public function cellsFor(CatalogueItem $item): array
    {
        $variants = CatalogueItemVariant::withoutTenancy()
            ->where('catalogue_item_id', $item->getKey())
            ->where('variant_type', VariantType::PlanConfiguration->value)
            ->orderBy('code')
            ->get();

        $profiles = PlanVariantProfile::withoutTenancy()
            ->whereIn('catalogue_item_variant_id', $variants->modelKeys())
            ->get()
            ->keyBy('catalogue_item_variant_id');

        $cells = [];

        foreach ($variants as $variant) {
            $profile = $profiles->get((string) $variant->getKey());

            // A plan configuration with no profile row cannot happen through
            // this service — the pair is written in one transaction — so it is
            // skipped rather than defended against with an invented cell.
            if ($profile instanceof PlanVariantProfile) {
                $cells[] = ['profile' => $profile, 'variant' => $variant];
            }
        }

        return $cells;
    }

    /**
     * Validate and normalise the submitted cells.
     *
     * @param  list<array<string, mixed>>  $cells
     * @return list<array{code: string, name_en: string|null, name_ar: string|null, status: VariantStatus, meal_combination_option_id: string, energy_band_id: string|null, service_tier: ServiceTier, includes_snacks: bool, meals_per_day: int, snacks_per_day: int}>
     *
     * @throws ApiException
     */
    private function prepare(CatalogueItem $item, array $cells): array
    {
        $prepared = [];

        /** @var array<string, int> $seenCells cell key → the index that claimed it */
        $seenCells = [];
        $seenCodes = [];

        /** @var list<array{index: int, cell_key: string, code: string, combination: MealCombinationOption, band: EnergyBand|null}> $coordinates */
        $coordinates = [];

        foreach ($cells as $index => $cell) {
            $combination = $this->usableCombination($item, $cell, $index);
            $band = $this->usableEnergyBand($item, $cell, $index);
            $tier = $this->serviceTier($cell['service_tier'] ?? null, $index);

            $cellKey = $this->cellKey(
                (string) $combination->getKey(),
                $tier,
                $band === null ? null : (string) $band->getKey(),
            );

            if (array_key_exists($cellKey, $seenCells)) {
                throw $this->invalid(
                    "cells.{$index}",
                    'This matrix cell is stated twice. One combination, one tier and one energy band are a single configuration.',
                );
            }

            $code = $this->code($cell, $combination, $tier, $band, $index);

            if (in_array($code, $seenCodes, true)) {
                throw $this->invalid(
                    "cells.{$index}.code",
                    'Two cells of one plan cannot share a code.',
                );
            }

            $seenCells[$cellKey] = $index;
            $seenCodes[] = $code;
            $coordinates[] = ['index' => $index, 'cell_key' => $cellKey, 'code' => $code, 'combination' => $combination, 'band' => $band];

            $mealsPerDay = $this->positiveInt($cell['meals_per_day'] ?? null, "cells.{$index}.meals_per_day");
            $snacksPerDay = $this->nonNegativeInt($cell['snacks_per_day'] ?? null, "cells.{$index}.snacks_per_day");
            $includesSnacks = (bool) ($cell['includes_snacks'] ?? false);

            // The two snack fields are one fact stated twice, so the
            // contradiction is refused rather than silently resolved. A
            // configuration that delivers two snacks while claiming to include
            // none would print one thing on a listing and pack another.
            if ($includesSnacks !== ($snacksPerDay > 0)) {
                throw $this->invalid(
                    "cells.{$index}.snacks_per_day",
                    'Snacks are either included with a count above zero or not included at all. "Includes snacks" and a count of zero contradict each other.',
                );
            }

            $status = VariantStatus::tryFrom((string) ($cell['status'] ?? VariantStatus::Active->value));

            if ($status === null) {
                throw $this->invalid("cells.{$index}.status", 'A plan configuration is a draft, active or archived.');
            }

            $prepared[] = [
                'code' => $code,
                'name_en' => $this->trimmedOrNull($cell['name_en'] ?? null),
                'name_ar' => $this->trimmedOrNull($cell['name_ar'] ?? null),
                'status' => $status,
                'meal_combination_option_id' => (string) $combination->getKey(),
                'energy_band_id' => $band === null ? null : (string) $band->getKey(),
                'service_tier' => $tier,
                'includes_snacks' => $includesSnacks,
                'meals_per_day' => $mealsPerDay,
                'snacks_per_day' => $snacksPerDay,
            ];
        }

        $this->assertCellsAreFree($item, $coordinates, $seenCodes);

        return $prepared;
    }

    /**
     * The occupancy check, run **after** every submitted code is known.
     *
     * That ordering is what lets two cells swap coordinates in one submission.
     * A stored cell occupied by a configuration the submission also mentions is
     * not a conflict — that configuration is being rewritten in the same
     * transaction, and the profile rows of everything submitted are released
     * before any is written. A stored cell occupied by a configuration the
     * submission does *not* mention is a real conflict, whether that
     * configuration is active or archived, because it is staying exactly where
     * it is.
     *
     * The vocabulary-activity rule rides along here for the same reason: "is
     * this cell new" is only answerable once occupancy is known.
     *
     * @param  list<array{index: int, cell_key: string, code: string, combination: MealCombinationOption, band: EnergyBand|null}>  $coordinates
     * @param  list<string>  $submittedCodes
     *
     * @throws ApiException
     */
    private function assertCellsAreFree(CatalogueItem $item, array $coordinates, array $submittedCodes): void
    {
        $occupied = $this->storedCells($item);

        foreach ($coordinates as $coordinate) {
            $holder = $occupied[$coordinate['cell_key']] ?? null;

            if ($holder !== null && $holder !== $coordinate['code'] && ! in_array($holder, $submittedCodes, true)) {
                throw new ApiException(
                    ErrorCode::ResourceConflict,
                    'This matrix cell already exists on this plan as configuration "'.$holder.'". Submit it under that code to keep it — a cell has one configuration, and a price may already point at the one that is there.',
                    ['cell_index' => $coordinate['index'], 'existing_configuration' => $holder],
                );
            }

            // A withdrawn vocabulary row may keep a cell a plan already sells,
            // and may not open a new one. The asymmetry is the point:
            // deactivating a combination means "stop offering this", not "lock
            // every plan that ever used it out of being edited". A kitchen
            // editing the rest of a matrix is not forced to archive cells it
            // did not come here to touch, and it still cannot start selling on
            // a row it withdrew.
            if ($holder !== null) {
                continue;
            }

            $this->assertOfferable(
                $coordinate['combination']->is_active,
                'cells.'.$coordinate['index'].'.meal_combination_option_id',
                'meal combination',
            );

            $this->assertOfferable(
                $coordinate['band'] === null || $coordinate['band']->is_active,
                'cells.'.$coordinate['index'].'.energy_band_id',
                'energy band',
            );
        }
    }

    /**
     * The cells this plan already holds, keyed by coordinates, valued by the
     * code of the configuration occupying each — archived ones included,
     * because an archived cell is still occupied.
     *
     * @return array<string, string>
     */
    private function storedCells(CatalogueItem $item): array
    {
        $codesById = CatalogueItemVariant::withoutTenancy()
            ->where('catalogue_item_id', $item->getKey())
            ->pluck('code', 'id');

        $cells = [];

        $profiles = PlanVariantProfile::withoutTenancy()
            ->where('catalogue_item_id', $item->getKey())
            ->get();

        foreach ($profiles as $profile) {
            $code = $codesById->get((string) $profile->catalogue_item_variant_id);

            if (! is_string($code)) {
                continue;
            }

            $cells[$this->cellKey(
                $profile->meal_combination_option_id,
                $profile->service_tier,
                $profile->energy_band_id,
            )] = $code;
        }

        return $cells;
    }

    /**
     * The identity of a matrix cell. The band's absence is spelled rather than
     * concatenated away, so a plan with no bands cannot collapse two cells into
     * one key — the string equivalent of the index's `NULLS NOT DISTINCT`.
     */
    private function cellKey(string $combinationId, ServiceTier $tier, ?string $bandId): string
    {
        return $combinationId.'|'.$tier->value.'|'.($bandId ?? '~');
    }

    /**
     * The deterministic code for a cell, or the caller's own.
     *
     * Built from the vocabulary rows' codes rather than their names: a code is
     * stable and a name is a caption somebody will rewrite, and a variant whose
     * identity moved when a band was renamed would take a price with it.
     *
     * @param  array<string, mixed>  $cell
     *
     * @throws ApiException
     */
    private function code(array $cell, MealCombinationOption $combination, ServiceTier $tier, ?EnergyBand $band, int $index): string
    {
        $explicit = $this->trimmedOrNull($cell['code'] ?? null);

        if ($explicit !== null) {
            return $explicit;
        }

        $parts = [$combination->code, $tier->value];

        if ($band !== null) {
            $parts[] = $band->code;
        }

        $code = Str::limit(Str::slug(implode('-', $parts)), 60, '');

        if ($code === '') {
            throw $this->invalid(
                "cells.{$index}.code",
                'A code could not be derived from this combination and band. Supply one explicitly.',
            );
        }

        return $code;
    }

    /**
     * @param  array<string, mixed>  $cell
     *
     * @throws ApiException
     */
    private function usableCombination(CatalogueItem $item, array $cell, int $index): MealCombinationOption
    {
        $id = $this->trimmedOrNull($cell['meal_combination_option_id'] ?? null);
        $field = "cells.{$index}.meal_combination_option_id";

        if ($id === null) {
            throw $this->invalid($field, 'A plan configuration has to say which meals of the day it delivers.');
        }

        $combination = MealCombinationOption::withoutTenancy()
            ->whereKey($id)
            ->where('organisation_id', $item->organisation_id)
            ->first();

        if (! $combination instanceof MealCombinationOption) {
            throw $this->invalid($field, 'This meal combination does not exist, or is not one you can use.');
        }

        return $combination;
    }

    /**
     * @param  array<string, mixed>  $cell
     *
     * @throws ApiException
     */
    private function usableEnergyBand(CatalogueItem $item, array $cell, int $index): ?EnergyBand
    {
        $id = $this->trimmedOrNull($cell['energy_band_id'] ?? null);

        // Genuinely optional. A kitchen that does not portion by calories has
        // cells with no band, which is a different fact from a band nobody
        // filled in — the same distinction the column's nullability records.
        if ($id === null) {
            return null;
        }

        $band = EnergyBand::withoutTenancy()
            ->whereKey($id)
            ->where('organisation_id', $item->organisation_id)
            ->first();

        if (! $band instanceof EnergyBand) {
            throw $this->invalid("cells.{$index}.energy_band_id", 'This energy band does not exist, or is not one you can use.');
        }

        return $band;
    }

    /**
     * @throws ApiException
     */
    private function serviceTier(mixed $value, int $index): ServiceTier
    {
        if ($value === null || $value === '') {
            return ServiceTier::Standard;
        }

        $tier = is_string($value) ? ServiceTier::tryFrom(trim($value)) : null;

        if ($tier === null) {
            throw $this->invalid("cells.{$index}.service_tier", 'A configuration is standard or premium.');
        }

        return $tier;
    }

    /**
     * @throws ApiException
     */
    private function assertOfferable(bool $isActive, string $field, string $subject): void
    {
        if ($isActive) {
            return;
        }

        throw $this->invalid(
            $field,
            'This '.$subject.' has been deactivated, so a new configuration cannot be built on it. Reactivate it, or choose another.',
        );
    }

    /**
     * @throws ApiException
     */
    private function assertPlan(CatalogueItem $item): void
    {
        if ($item->item_type === CatalogueItemType::SubscriptionPlan) {
            return;
        }

        throw $this->invalid(
            'item',
            'Only a subscription plan has a configuration matrix. A product has packs; a meal is sold as itself.',
        );
    }

    /**
     * @throws ApiException
     */
    private function positiveInt(mixed $value, string $field): int
    {
        if (! is_numeric($value) || (int) $value <= 0) {
            throw $this->invalid($field, 'This must be a whole number greater than zero.');
        }

        return (int) $value;
    }

    /**
     * @throws ApiException
     */
    private function nonNegativeInt(mixed $value, string $field): int
    {
        if ($value === null || $value === '') {
            return 0;
        }

        if (! is_numeric($value) || (int) $value < 0) {
            throw $this->invalid($field, 'This must be a whole number of zero or more.');
        }

        return (int) $value;
    }

    private function trimmedOrNull(mixed $value): ?string
    {
        if (! is_string($value)) {
            return null;
        }

        $trimmed = trim($value);

        return $trimmed === '' ? null : $trimmed;
    }

    private function invalid(string $field, string $message): ApiException
    {
        return new ApiException(
            ErrorCode::ValidationFailed,
            $message,
            ['fields' => [$field => [$message]]],
        );
    }
}
