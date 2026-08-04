<?php

declare(strict_types=1);

namespace Healthy360\Catalogues\Services;

use Carbon\CarbonImmutable;
use Healthy360\Audit\Services\AuditRecorder;
use Healthy360\Catalogues\Enums\CatalogueItemType;
use Healthy360\Catalogues\Models\CatalogueItem;
use Healthy360\Catalogues\Models\CatalogueItemAvailabilityDay;
use Healthy360\Support\Api\ErrorCode;
use Healthy360\Support\Api\Exceptions\ApiException;
use Healthy360\Tenancy\TenantContext;
use Illuminate\Support\Facades\DB;

/**
 * Per-day availability for one meal, replaced as a set.
 */
final readonly class MealAvailabilityService
{
    public function __construct(
        private TenantContext $context,
        private AuditRecorder $audit,
        private CatalogueItemService $items,
    ) {}

    /**
     * @param  list<array{date: string, is_available: bool, remaining?: int|null, order_cut_off_at?: string|null}>  $days
     *
     * @throws ApiException
     */
    public function replace(CatalogueItem $item, array $days, int $expectedLockVersion): CatalogueItem
    {
        $this->items->assertEditable($item);

        if ($item->item_type !== CatalogueItemType::Meal) {
            throw new ApiException(
                ErrorCode::ValidationFailed,
                'Only a meal carries per-day availability.',
                ['item_type' => $item->item_type->value],
            );
        }

        $prepared = [];
        $seen = [];

        foreach ($days as $index => $day) {
            $date = $this->dateOrFail($day['date'], "days.{$index}.date");

            if (in_array($date, $seen, true)) {
                throw $this->invalid("days.{$index}.date", 'This date is stated twice.');
            }

            $seen[] = $date;

            $prepared[] = [
                'date' => $date,
                'is_available' => (bool) $day['is_available'],
                'remaining_portions' => array_key_exists('remaining', $day) ? $day['remaining'] : null,
                'order_cut_off_at' => $this->timeOrNull($day['order_cut_off_at'] ?? null, "days.{$index}.order_cut_off_at"),
            ];
        }

        DB::transaction(function () use ($item, $prepared, $expectedLockVersion): void {
            $this->items->compareAndSwap($item, ['updated_by' => $this->context->userId()], $expectedLockVersion);

            CatalogueItemAvailabilityDay::withoutTenancy()->where('catalogue_item_id', $item->getKey())->delete();

            foreach ($prepared as $attributes) {
                $row = new CatalogueItemAvailabilityDay;
                $row->organisation_id = $item->organisation_id;
                $row->catalogue_item_id = (string) $item->getKey();
                $row->date = CarbonImmutable::createFromFormat('Y-m-d', $attributes['date'])->startOfDay();
                $row->is_available = $attributes['is_available'];
                $row->remaining_portions = $attributes['remaining_portions'];
                $row->order_cut_off_at = $attributes['order_cut_off_at'];
                $row->created_by = $this->context->userId();
                $row->save();
            }
        });

        $this->audit->record(
            'catalogue.item_availability_days_updated',
            actorUserId: $this->context->userId(),
            subjectType: 'catalogue_item',
            subjectId: (string) $item->getKey(),
            metadata: [
                'changed_fields' => ['availability_days'],
                'day_count' => count($prepared),
                'available_count' => count(array_filter($prepared, static fn (array $row): bool => $row['is_available'])),
                'lock_version' => $item->lock_version,
            ],
        );

        return $item;
    }

    /**
     * @throws ApiException
     */
    private function dateOrFail(string $value, string $field): string
    {
        if (preg_match('/^\d{4}-\d{2}-\d{2}$/', $value) !== 1) {
            throw $this->invalid($field, 'A date is written YYYY-MM-DD.');
        }

        return $value;
    }

    /**
     * @throws ApiException
     */
    private function timeOrNull(mixed $value, string $field): ?string
    {
        if ($value === null || $value === '') {
            return null;
        }

        if (! is_string($value)) {
            throw $this->invalid($field, 'A cut-off time is written HH:MM.');
        }

        if (preg_match('/^\d{2}:\d{2}$/', $value) === 1) {
            return $value.':00';
        }

        if (preg_match('/^\d{2}:\d{2}:\d{2}$/', $value) === 1) {
            return $value;
        }

        throw $this->invalid($field, 'A cut-off time is written HH:MM.');
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
