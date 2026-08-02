<?php

declare(strict_types=1);

namespace Healthy360\Catalogues\Services;

use Healthy360\Audit\Services\AuditRecorder;
use Healthy360\Catalogues\Enums\SalesChannelKind;
use Healthy360\Catalogues\Enums\SalesChannelStatus;
use Healthy360\Catalogues\Models\SalesChannel;
use Healthy360\Support\Api\ErrorCode;
use Healthy360\Support\Api\Exceptions\ApiException;
use Healthy360\Support\Api\Exceptions\StaleLockVersion;
use Healthy360\Tenancy\TenantContext;
use Illuminate\Support\Facades\DB;

/**
 * Every write to a sales channel — the routes to market an organisation
 * sells through.
 *
 * `code` is immutable after creation, like a catalogue item's slug and for the
 * same reason: a channel code is what a price list, an availability rule and
 * (from C1) an order's provenance will name. A channel is renamed by changing
 * `name_en`/`name_ar`; the code stays what everything else already wrote down.
 *
 * `channel_kind` is immutable too, and that one is not about references. A
 * channel's kind decides whether its prices are contract-private
 * (`SalesChannelKind::hasPrivatePricing()`); flipping a live b2b desk to
 * `b2c_web` would reclassify every price behind it in one write, with no
 * record of what had been private. Changing the kind means creating the new
 * channel and retiring the old one, which is what actually happened.
 */
final readonly class SalesChannelService
{
    public function __construct(
        private TenantContext $context,
        private AuditRecorder $audit,
    ) {}

    /**
     * @param  array{code: string, channel_kind: string, name_en: string, name_ar?: string|null, order_source?: string|null}  $attributes
     *
     * @throws ApiException
     */
    public function create(array $attributes): SalesChannel
    {
        $organisationId = $this->requireOrganisation();
        $code = trim($attributes['code']);

        $kind = SalesChannelKind::tryFrom($attributes['channel_kind']);

        if ($kind === null) {
            throw $this->invalid('channel_kind', 'This is not a channel kind the platform recognises.');
        }

        if (SalesChannel::withoutTenancy()->where('organisation_id', $organisationId)->where('code', $code)->exists()) {
            throw new ApiException(
                ErrorCode::ResourceConflict,
                'This organisation already has a sales channel with that code.',
                ['conflicting_field' => 'code'],
            );
        }

        $channel = new SalesChannel;
        $channel->organisation_id = $organisationId;
        $channel->code = $code;
        $channel->channel_kind = $kind;
        $channel->name_en = trim($attributes['name_en']);
        $channel->name_ar = $this->trimmedOrNull($attributes['name_ar'] ?? null) ?? '';
        $channel->order_source = $this->trimmedOrNull($attributes['order_source'] ?? null);
        $channel->status = SalesChannelStatus::Active;
        $channel->lock_version = 0;
        $channel->created_by = $this->context->userId();
        $channel->updated_by = $this->context->userId();
        $channel->save();

        $this->audit->record(
            'catalogue.sales_channel_created',
            actorUserId: $this->context->userId(),
            subjectType: 'sales_channel',
            subjectId: (string) $channel->getKey(),
            metadata: ['channel_kind' => $kind->value, 'status' => $channel->status->value],
        );

        return $channel;
    }

    /**
     * @param  array<string, mixed>  $attributes
     *
     * @throws ApiException
     */
    public function update(SalesChannel $channel, array $attributes, int $expectedLockVersion): SalesChannel
    {
        $changes = [];

        foreach (['name_en', 'name_ar', 'order_source', 'status'] as $field) {
            if (! array_key_exists($field, $attributes)) {
                continue;
            }

            $value = $attributes[$field];

            if (is_string($value)) {
                $value = trim($value);
            }

            if ($value === '' && $field === 'order_source') {
                $value = null;
            }

            $changes[$field] = $value;
        }

        if (isset($changes['status']) && is_string($changes['status']) && SalesChannelStatus::tryFrom($changes['status']) === null) {
            throw $this->invalid('status', 'A sales channel is either active or inactive.');
        }

        if ($changes === []) {
            return $channel;
        }

        $changes['updated_by'] = $this->context->userId();

        $this->compareAndSwap($channel, $changes, $expectedLockVersion);

        $this->audit->record(
            'catalogue.sales_channel_updated',
            actorUserId: $this->context->userId(),
            subjectType: 'sales_channel',
            subjectId: (string) $channel->getKey(),
            metadata: [
                'changed_fields' => array_values(array_diff(array_keys($changes), ['updated_by'])),
                'lock_version' => $channel->lock_version,
            ],
        );

        return $channel;
    }

    /**
     * @param  array<string, mixed>  $changes
     *
     * @throws StaleLockVersion
     */
    private function compareAndSwap(SalesChannel $channel, array $changes, int $expectedLockVersion): void
    {
        $affected = DB::transaction(fn (): int => SalesChannel::withoutTenancy()
            ->whereKey($channel->getKey())
            ->where('lock_version', $expectedLockVersion)
            ->update($changes + [
                'lock_version' => $expectedLockVersion + 1,
                'updated_at' => now(),
            ]));

        if ($affected === 0) {
            $current = SalesChannel::withoutTenancy()->whereKey($channel->getKey())->value('lock_version');

            throw new StaleLockVersion(is_numeric($current) ? (int) $current : $expectedLockVersion);
        }

        $channel->refresh();
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

    private function invalid(string $field, string $message): ApiException
    {
        return new ApiException(
            ErrorCode::ValidationFailed,
            $message,
            ['fields' => [$field => [$message]]],
        );
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
