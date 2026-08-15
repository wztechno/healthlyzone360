<?php

declare(strict_types=1);

namespace Healthy360\Pricing\Services;

use Healthy360\Audit\Services\AuditRecorder;
use Healthy360\Catalogues\Models\SalesChannel;
use Healthy360\Pricing\Models\ChannelPriceList;
use Healthy360\Pricing\Models\PriceList;
use Healthy360\Support\Api\ErrorCode;
use Healthy360\Support\Api\Exceptions\ApiException;
use Healthy360\Tenancy\TenantContext;
use Illuminate\Support\Facades\DB;

/**
 * Which channels price from one list, replaced as a set.
 *
 * The same set-replace shape the catalogue's channel availability uses, and
 * for the same reason: "web shop yes, wholesale yes, marketplace no" is one
 * decision, and applying half of it leaves a channel quoting from a tariff
 * nobody meant it to have.
 *
 * **The array order is the priority.** Index 0 is consulted first. A
 * merchandiser listing the negotiated sheet above the standing tariff is
 * stating the override they mean; asking them to also invent non-colliding
 * integers would be asking them to do the machine's arithmetic, and the first
 * time two lists shared a number the resolution would go quiet rather than
 * wrong, which is worse. A caller may still send an explicit `priority` and it
 * is honoured — an importer restoring a known configuration should not have to
 * reconstruct it from array order — but the default is the order submitted.
 *
 * Assignments are **deleted** on replacement rather than archived, the same
 * decision `ChannelAvailabilityService` makes: nothing points at an
 * assignment. It is a statement about where a tariff applies, not a thing that
 * is bought, so its history has no referent to protect — and unlike a price
 * row, removing it changes nothing about what anybody was charged. The audit
 * trail records that the set changed.
 */
final readonly class ChannelPriceListService
{
    public function __construct(
        private TenantContext $context,
        private AuditRecorder $audit,
        private PriceListService $lists,
    ) {}

    /**
     * @param  list<array{sales_channel_id: string, priority?: int|string|null}>  $assignments
     *
     * @throws ApiException
     */
    public function replace(PriceList $priceList, array $assignments, int $expectedLockVersion): PriceList
    {
        $this->lists->assertEditable($priceList);

        $prepared = [];
        $seen = [];

        foreach ($assignments as $index => $assignment) {
            $channel = $this->usableChannel($assignment['sales_channel_id'], "channels.{$index}.sales_channel_id");
            $channelId = (string) $channel->getKey();

            if (in_array($channelId, $seen, true)) {
                throw $this->invalid(
                    "channels.{$index}.sales_channel_id",
                    'This channel is named twice. One channel states its relationship with one list once — twice at two priorities is a contradiction, not a richer configuration.',
                );
            }

            $seen[] = $channelId;

            $prepared[] = [
                'sales_channel_id' => $channelId,
                'priority' => $this->priority($assignment['priority'] ?? null, $index),
            ];
        }

        DB::transaction(function () use ($priceList, $prepared, $expectedLockVersion): void {
            $this->lists->compareAndSwap($priceList, ['updated_by' => $this->context->userId()], $expectedLockVersion);

            ChannelPriceList::withoutTenancy()->where('price_list_id', $priceList->getKey())->delete();

            foreach ($prepared as $attributes) {
                $row = new ChannelPriceList;
                $row->organisation_id = $priceList->organisation_id;
                $row->sales_channel_id = $attributes['sales_channel_id'];
                $row->price_list_id = (string) $priceList->getKey();
                $row->priority = $attributes['priority'];
                $row->created_by = $this->context->userId();
                $row->save();
            }
        });

        $this->audit->record(
            'catalogue.price_list_channels_updated',
            actorUserId: $this->context->userId(),
            subjectType: 'price_list',
            subjectId: (string) $priceList->getKey(),
            metadata: [
                'changed_fields' => ['channels'],
                'assignment_count' => count($prepared),
                'sales_channel_ids' => array_column($prepared, 'sales_channel_id'),
                'lock_version' => $priceList->lock_version,
            ],
        );

        return $priceList;
    }

    /**
     * @throws ApiException
     */
    private function usableChannel(mixed $id, string $field): SalesChannel
    {
        $channelId = is_string($id) ? trim($id) : '';

        if ($channelId === '') {
            throw $this->invalid($field, 'An assignment has to name a channel.');
        }

        // The tenant scope narrows this already; a channel from another
        // organisation is simply not found, and the message says nothing about
        // whether it exists elsewhere.
        $channel = SalesChannel::query()->whereKey($channelId)->first();

        if (! $channel instanceof SalesChannel) {
            throw $this->invalid($field, 'This sales channel does not exist, or is not one you can use.');
        }

        return $channel;
    }

    /**
     * @throws ApiException
     */
    private function priority(mixed $value, int $index): int
    {
        if ($value === null || $value === '') {
            return $index;
        }

        if (! is_int($value) && (! is_string($value) || preg_match('/^-?\d+$/', $value) !== 1)) {
            throw $this->invalid("channels.{$index}.priority", 'A priority is a whole number — lower is consulted first.');
        }

        return (int) $value;
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
