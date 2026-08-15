<?php

declare(strict_types=1);

namespace Healthy360\Catalogues\Services;

use Carbon\CarbonImmutable;
use Healthy360\Audit\Services\AuditRecorder;
use Healthy360\Catalogues\Models\CatalogueItem;
use Healthy360\Catalogues\Models\CatalogueItemVariant;
use Healthy360\Catalogues\Models\ChannelCatalogueItem;
use Healthy360\Catalogues\Models\SalesChannel;
use Healthy360\Support\Api\ErrorCode;
use Healthy360\Support\Api\Exceptions\ApiException;
use Healthy360\Tenancy\TenantContext;
use Illuminate\Support\Facades\DB;

/**
 * Which channels offer one item, replaced as a set.
 *
 * Mirrors the admin contract's `setProductChannelAvailability(productId,
 * {availability})` — a dedicated, lock-versioned setter carrying the complete
 * list — rather than a per-row add/remove surface. Availability is judged as a
 * whole: "web shop yes, wholesale from March, marketplace no" is one decision,
 * and applying half of it leaves an offering nobody meant to make.
 *
 * A row may name a variant or not. Naming none offers the item as a whole
 * (the natural shape for a meal); naming one offers exactly that pack or
 * configuration, which is how a kitchen sells the 1 kg jar to wholesale and
 * the 250 g jar to the web shop. The unique key is NULLS NOT DISTINCT, so the
 * two statements cannot each be made twice.
 *
 * Assignments are **deleted** on replacement rather than archived, which is
 * the opposite of the rule variants follow, and deliberately: nothing points
 * at an assignment. It is a statement about an offering, not a thing that is
 * bought, so its history has no referent to protect — and the audit trail
 * already records that the set changed.
 */
final readonly class ChannelAvailabilityService
{
    public function __construct(
        private TenantContext $context,
        private AuditRecorder $audit,
        private CatalogueItemService $items,
    ) {}

    /**
     * @param  list<array{sales_channel_id: string, catalogue_item_variant_id?: string|null, is_available?: bool|null, available_from?: string|null, available_to?: string|null}>  $assignments
     *
     * @throws ApiException
     */
    public function replace(CatalogueItem $item, array $assignments, int $expectedLockVersion): CatalogueItem
    {
        $this->items->assertEditable($item);

        $prepared = [];
        $seen = [];

        foreach ($assignments as $index => $assignment) {
            $channel = $this->usableChannel($assignment['sales_channel_id'], "channels.{$index}.sales_channel_id");
            $variantId = $this->usableVariantId($item, $assignment, $index);

            $key = (string) $channel->getKey().'|'.($variantId ?? '');

            if (in_array($key, $seen, true)) {
                throw $this->invalid("channels.{$index}", 'This channel and variant pair is stated twice.');
            }

            $seen[] = $key;

            $from = $this->dateOrNull($assignment['available_from'] ?? null, "channels.{$index}.available_from");
            $to = $this->dateOrNull($assignment['available_to'] ?? null, "channels.{$index}.available_to");

            if ($from !== null && $to !== null && $to < $from) {
                throw $this->invalid("channels.{$index}.available_to", 'An availability window cannot end before it begins.');
            }

            $prepared[] = [
                'sales_channel_id' => (string) $channel->getKey(),
                'catalogue_item_variant_id' => $variantId,
                'is_available' => (bool) ($assignment['is_available'] ?? true),
                'available_from' => $from,
                'available_to' => $to,
            ];
        }

        DB::transaction(function () use ($item, $prepared, $expectedLockVersion): void {
            $this->items->compareAndSwap($item, ['updated_by' => $this->context->userId()], $expectedLockVersion);

            ChannelCatalogueItem::withoutTenancy()->where('catalogue_item_id', $item->getKey())->delete();

            foreach ($prepared as $attributes) {
                $row = new ChannelCatalogueItem;
                $row->organisation_id = $item->organisation_id;
                $row->sales_channel_id = $attributes['sales_channel_id'];
                $row->catalogue_item_id = (string) $item->getKey();
                $row->catalogue_item_variant_id = $attributes['catalogue_item_variant_id'];
                $row->is_available = $attributes['is_available'];
                $row->available_from = $attributes['available_from'];
                $row->available_to = $attributes['available_to'];
                $row->created_by = $this->context->userId();
                $row->save();
            }
        });

        $this->audit->record(
            'catalogue.item_channels_updated',
            actorUserId: $this->context->userId(),
            subjectType: 'catalogue_item',
            subjectId: (string) $item->getKey(),
            metadata: [
                'changed_fields' => ['channels'],
                'assignment_count' => count($prepared),
                'available_count' => count(array_filter($prepared, static fn (array $row): bool => $row['is_available'])),
                'lock_version' => $item->lock_version,
            ],
        );

        return $item;
    }

    /**
     * @throws ApiException
     */
    private function usableChannel(string $id, string $field): SalesChannel
    {
        $channel = SalesChannel::query()->whereKey(trim($id))->first();

        if (! $channel instanceof SalesChannel) {
            throw $this->invalid($field, 'This sales channel does not exist, or is not one you can use.');
        }

        return $channel;
    }

    /**
     * @param  array<string, mixed>  $assignment
     *
     * @throws ApiException
     */
    private function usableVariantId(CatalogueItem $item, array $assignment, int $index): ?string
    {
        $variantId = isset($assignment['catalogue_item_variant_id']) && is_string($assignment['catalogue_item_variant_id'])
            ? trim($assignment['catalogue_item_variant_id'])
            : '';

        if ($variantId === '') {
            return null;
        }

        $exists = CatalogueItemVariant::withoutTenancy()
            ->where('catalogue_item_id', $item->getKey())
            ->whereKey($variantId)
            ->exists();

        if (! $exists) {
            throw $this->invalid("channels.{$index}.catalogue_item_variant_id", 'This variant does not belong to this item.');
        }

        return $variantId;
    }

    /**
     * A calendar date, parsed here rather than left as a string for the cast
     * to deal with — so the shape this service builds and the shape the model
     * exposes are the same type, and a comparison of two windows is a date
     * comparison rather than a string one that happens to work for ISO 8601.
     *
     * @throws ApiException
     */
    private function dateOrNull(mixed $value, string $field): ?CarbonImmutable
    {
        if ($value === null || $value === '') {
            return null;
        }

        if (! is_string($value) || preg_match('/^\d{4}-\d{2}-\d{2}$/', $value) !== 1) {
            throw $this->invalid($field, 'A date is written YYYY-MM-DD. A channel decides "from Monday", not "from midnight in some timezone".');
        }

        return CarbonImmutable::createFromFormat('Y-m-d', $value)->startOfDay();
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
