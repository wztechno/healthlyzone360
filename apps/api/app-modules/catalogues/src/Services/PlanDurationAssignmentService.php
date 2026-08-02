<?php

declare(strict_types=1);

namespace Healthy360\Catalogues\Services;

use Healthy360\Audit\Services\AuditRecorder;
use Healthy360\Catalogues\Enums\CatalogueItemType;
use Healthy360\Catalogues\Models\CatalogueItem;
use Healthy360\Catalogues\Models\CatalogueItemVariant;
use Healthy360\Catalogues\Models\PlanDuration;
use Healthy360\Catalogues\Models\PlanVariantDuration;
use Healthy360\Support\Api\ErrorCode;
use Healthy360\Support\Api\Exceptions\ApiException;
use Healthy360\Tenancy\TenantContext;
use Illuminate\Support\Facades\DB;

/**
 * Which runs each configuration of a plan may be bought for, replaced as a set
 * across the whole plan.
 *
 * **One endpoint for the whole plan, not one per configuration.** A kitchen
 * decides "every cell runs 5, 20 and 40 days, and the premium tier also runs
 * 60" in a single sitting, and splitting that across N calls would make the
 * intermediate states — half the matrix on the new durations — reachable and
 * publishable.
 *
 * **`discount_percent` NULL survives the round trip.** It is not defaulted, not
 * coalesced, and not written as `0.00` when the field is absent. The source
 * sheets have empty discount cells, and "no discount applies" and "the discount
 * was never recorded" are commercially different answers: the first is a
 * position a kitchen stands behind, the second is a question somebody still
 * owes. Writing zero for both would answer the question permanently and
 * silently — the same failure `price_list_items` refuses when it declines to
 * render a placeholder as `0` (decision OD-2, risk R9).
 *
 * **Absent rows are deleted, and the asymmetry with the matrix is deliberate.**
 * A matrix cell is archived rather than removed because a price points at the
 * variant; an assignment row carries nothing but itself, so there is nothing to
 * preserve and an archived-assignment state would be a second, quieter way of
 * saying `is_available: false`. What `is_available` buys is the ability to say
 * "we still run 40 days, just not this month" without discarding the discount
 * somebody negotiated for it.
 *
 * Rows name their variant and their duration by identifier **or by code**, for
 * the reason K1.4 matched variants on codes: an importer and a human hold codes,
 * a client that walked the matrix holds identifiers, and requiring the second
 * would force a round trip through this API to use the first.
 *
 * `If-Match` carries the **item's** validator: the assignments are one document
 * even though they span every configuration, and per-row validators would let
 * two merchandisers each replace half of it.
 */
final readonly class PlanDurationAssignmentService
{
    public function __construct(
        private TenantContext $context,
        private AuditRecorder $audit,
        private CatalogueItemService $items,
    ) {}

    /**
     * @param  list<array{
     *     catalogue_item_variant_id?: string|null,
     *     variant_code?: string|null,
     *     plan_duration_id?: string|null,
     *     duration_code?: string|null,
     *     discount_percent?: int|float|string|null,
     *     is_available?: bool|null
     * }>  $assignments
     *
     * @throws ApiException
     */
    public function replace(CatalogueItem $item, array $assignments, int $expectedLockVersion): CatalogueItem
    {
        $this->assertPlan($item);
        $this->items->assertEditable($item);

        $prepared = $this->prepare($item, $assignments);

        $counts = DB::transaction(function () use ($item, $prepared, $expectedLockVersion): array {
            $this->items->compareAndSwap($item, ['updated_by' => $this->context->userId()], $expectedLockVersion);

            $variantIds = CatalogueItemVariant::withoutTenancy()
                ->where('catalogue_item_id', $item->getKey())
                ->pluck('id')
                ->all();

            /** @var array<string, PlanVariantDuration> $existing */
            $existing = PlanVariantDuration::withoutTenancy()
                ->whereIn('catalogue_item_variant_id', $variantIds)
                ->get()
                ->keyBy(fn (PlanVariantDuration $row): string => $this->assignmentKey(
                    $row->catalogue_item_variant_id,
                    $row->plan_duration_id,
                ))
                ->all();

            $written = 0;
            $removed = 0;

            foreach ($prepared as $key => $attributes) {
                $row = $existing[$key] ?? new PlanVariantDuration;

                $row->organisation_id = $item->organisation_id;
                $row->catalogue_item_variant_id = $attributes['catalogue_item_variant_id'];
                $row->plan_duration_id = $attributes['plan_duration_id'];
                $row->discount_percent = $attributes['discount_percent'];
                $row->is_available = $attributes['is_available'];

                if (! $row->exists) {
                    $row->created_by = $this->context->userId();
                }

                $row->save();
                $written++;
            }

            foreach ($existing as $key => $row) {
                if (array_key_exists($key, $prepared)) {
                    continue;
                }

                $row->delete();
                $removed++;
            }

            return ['written' => $written, 'removed' => $removed];
        });

        $this->audit->record(
            'catalogue.plan_durations_replaced',
            actorUserId: $this->context->userId(),
            subjectType: 'catalogue_item',
            subjectId: (string) $item->getKey(),
            metadata: [
                'changed_fields' => ['plan_variant_durations'],
                'assignment_count' => $counts['written'],
                'removed_count' => $counts['removed'],

                // How many of the submitted rows still carry no stated
                // discount. Recorded because it is the number that says whether
                // the import gap has been closed, and because a reader of this
                // trail should never have to infer it from a zero.
                'unstated_discount_count' => count(array_filter(
                    $prepared,
                    static fn (array $row): bool => $row['discount_percent'] === null,
                )),
                'lock_version' => $item->lock_version,
            ],
        );

        return $item;
    }

    /**
     * Every assignment on the plan, each paired with the configuration it
     * belongs to so a client can render the grid without a second call.
     *
     * @return list<array{assignment: PlanVariantDuration, variant: CatalogueItemVariant}>
     */
    public function assignmentsFor(CatalogueItem $item): array
    {
        $variants = CatalogueItemVariant::withoutTenancy()
            ->where('catalogue_item_id', $item->getKey())
            ->orderBy('code')
            ->get()
            ->keyBy(static fn (CatalogueItemVariant $variant): string => (string) $variant->getKey());

        $rows = PlanVariantDuration::withoutTenancy()
            ->whereIn('catalogue_item_variant_id', $variants->keys()->all())
            ->orderBy('catalogue_item_variant_id')
            ->orderBy('plan_duration_id')
            ->get();

        $assignments = [];

        foreach ($rows as $row) {
            $variant = $variants->get($row->catalogue_item_variant_id);

            if ($variant instanceof CatalogueItemVariant) {
                $assignments[] = ['assignment' => $row, 'variant' => $variant];
            }
        }

        return $assignments;
    }

    /**
     * @param  list<array<string, mixed>>  $assignments
     * @return array<string, array{catalogue_item_variant_id: string, plan_duration_id: string, discount_percent: string|null, is_available: bool}>
     *
     * @throws ApiException
     */
    private function prepare(CatalogueItem $item, array $assignments): array
    {
        $prepared = [];

        foreach ($assignments as $index => $assignment) {
            $variant = $this->usableVariant($item, $assignment, $index);
            $duration = $this->usableDuration($item, $assignment, $index);

            $key = $this->assignmentKey((string) $variant->getKey(), (string) $duration->getKey());

            if (array_key_exists($key, $prepared)) {
                throw $this->invalid(
                    "assignments.{$index}",
                    'This configuration and duration are paired twice. One pairing carries one discount.',
                );
            }

            $prepared[$key] = [
                'catalogue_item_variant_id' => (string) $variant->getKey(),
                'plan_duration_id' => (string) $duration->getKey(),
                'discount_percent' => $this->discountPercent($assignment['discount_percent'] ?? null, $index),
                'is_available' => (bool) ($assignment['is_available'] ?? true),
            ];
        }

        return $prepared;
    }

    /**
     * The discount, or NULL — and NULL is a value here, never a default that
     * stands in for zero.
     *
     * An absent key and an explicit `null` mean the same thing and both survive:
     * nobody has stated a discount for this run. A client that means "there is
     * no discount" sends `0`, which is stored as `0.00` and is a different row
     * from a NULL one for every reader afterwards.
     *
     * @throws ApiException
     */
    private function discountPercent(mixed $value, int $index): ?string
    {
        if ($value === null || $value === '') {
            return null;
        }

        $field = "assignments.{$index}.discount_percent";

        if (! is_numeric($value)) {
            throw $this->invalid($field, 'A discount is a percentage, or nothing at all if none has been agreed.');
        }

        $percent = (float) $value;

        if ($percent < 0 || $percent >= 100) {
            throw $this->invalid(
                $field,
                'A discount is between zero and one hundred per cent. Leave it out entirely if none has been agreed — that is not the same as zero.',
            );
        }

        return number_format($percent, 2, '.', '');
    }

    /**
     * @param  array<string, mixed>  $assignment
     *
     * @throws ApiException
     */
    private function usableVariant(CatalogueItem $item, array $assignment, int $index): CatalogueItemVariant
    {
        $id = $this->trimmedOrNull($assignment['catalogue_item_variant_id'] ?? null);
        $code = $this->trimmedOrNull($assignment['variant_code'] ?? null);
        $field = "assignments.{$index}.catalogue_item_variant_id";

        if ($id === null && $code === null) {
            throw $this->invalid($field, 'An assignment has to say which configuration it is for, by identifier or by code.');
        }

        $query = CatalogueItemVariant::withoutTenancy()->where('catalogue_item_id', $item->getKey());

        $id !== null ? $query->whereKey($id) : $query->where('code', $code);

        $variant = $query->first();

        if (! $variant instanceof CatalogueItemVariant) {
            throw $this->invalid($field, 'This configuration does not belong to this plan.');
        }

        return $variant;
    }

    /**
     * @param  array<string, mixed>  $assignment
     *
     * @throws ApiException
     */
    private function usableDuration(CatalogueItem $item, array $assignment, int $index): PlanDuration
    {
        $id = $this->trimmedOrNull($assignment['plan_duration_id'] ?? null);
        $code = $this->trimmedOrNull($assignment['duration_code'] ?? null);
        $field = "assignments.{$index}.plan_duration_id";

        if ($id === null && $code === null) {
            throw $this->invalid($field, 'An assignment has to say which duration it is for, by identifier or by code.');
        }

        $query = PlanDuration::withoutTenancy()->where('organisation_id', $item->organisation_id);

        $id !== null ? $query->whereKey($id) : $query->where('code', $code);

        $duration = $query->first();

        if (! $duration instanceof PlanDuration) {
            throw $this->invalid($field, 'This duration does not exist, or is not one you can use.');
        }

        if (! $duration->is_active) {
            throw $this->invalid(
                $field,
                'This duration has been deactivated and cannot be offered. Reactivate it, or drop the assignment.',
            );
        }

        return $duration;
    }

    private function assignmentKey(string $variantId, string $durationId): string
    {
        return $variantId.'|'.$durationId;
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
            'Only a subscription plan is bought for a run of days. A product has packs; a meal is sold as itself.',
        );
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
