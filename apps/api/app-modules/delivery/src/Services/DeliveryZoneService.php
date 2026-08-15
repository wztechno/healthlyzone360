<?php

declare(strict_types=1);

namespace Healthy360\Delivery\Services;

use Healthy360\Audit\Services\AuditRecorder;
use Healthy360\Delivery\Enums\DeliveryZoneStatus;
use Healthy360\Delivery\Models\DeliveryZone;
use Healthy360\Delivery\Models\DeliveryZoneArea;
use Healthy360\Organisations\Models\Organisation;
use Healthy360\Organisations\Models\OrganisationBranch;
use Healthy360\ReferenceData\Models\Currency;
use Healthy360\Support\Api\ErrorCode;
use Healthy360\Support\Api\Exceptions\ApiException;
use Healthy360\Support\Api\Exceptions\StaleLockVersion;
use Healthy360\Tenancy\TenantContext;
use Illuminate\Support\Facades\DB;

/**
 * Every write to a delivery zone's header.
 *
 * Three rules run through it.
 *
 * 1. **`code` is immutable.** The same rule a price list, a sales channel and
 *    a catalogue item slug follow: it is what an importer, a runbook and
 *    eventually a support ticket already wrote down. A request carrying `code`
 *    on update is refused rather than ignored, because a client that sent it
 *    believed it was writing something.
 *
 * 2. **`branch_id` is editable, and moving it moves the area claims with it.**
 *    A kitchen that drew one map and then opened a second location genuinely
 *    needs to re-scope a zone, and forbidding it would mean rebuilding the
 *    area set by hand. What makes it safe is that the denormalised
 *    `delivery_zone_areas.branch_id` is rewritten inside the same transaction,
 *    so the unique index that enforces "one area per branch" sees the new
 *    scope — and refuses the move if some other zone already serves one of
 *    those areas at the destination. That refusal is a `409` naming the
 *    occupying zone, not a silent partial move.
 *
 * 3. **Archiving releases the area claims.** `inactive` keeps them, because a
 *    suspension a kitchen means to reverse should not have to be rebuilt;
 *    `archived` is terminal, and a map nobody intends to return to holding
 *    areas hostage is how a kitchen ends up unable to serve a street it
 *    delivers to.
 *
 * **No customer-address check on archive**, and that is a real gap rather than
 * a decision that it does not matter. Customer addresses do not exist yet —
 * `customer_addresses` arrives in J1 — so there is nothing to consult, and a
 * blocker written against a table with no rows would be a permanently-green
 * check that quietly stops being true the day J1 lands. When it does, this
 * method gains the consultation: archiving the only zone serving an area a
 * live address references should be refused, and the refusal should name the
 * addresses. J1 owns that change; the docblock is the handover.
 */
final readonly class DeliveryZoneService
{
    public function __construct(
        private TenantContext $context,
        private AuditRecorder $audit,
    ) {}

    /**
     * @param  array{
     *     code: string,
     *     name_en: string,
     *     name_ar?: string|null,
     *     currency_code?: string|null,
     *     branch_id?: string|null,
     *     delivery_fee_minor?: int|null,
     *     minimum_order_minor?: int|null,
     *     estimated_minutes?: int|null
     * }  $attributes
     *
     * @throws ApiException
     */
    public function create(array $attributes): DeliveryZone
    {
        $organisationId = $this->requireOrganisation();
        $code = trim($attributes['code']);

        if (DeliveryZone::withoutTenancy()->where('organisation_id', $organisationId)->where('code', $code)->exists()) {
            throw new ApiException(
                ErrorCode::ResourceConflict,
                'This organisation already has a delivery zone with that code.',
                ['conflicting_field' => 'code'],
            );
        }

        $zone = new DeliveryZone;
        $zone->organisation_id = $organisationId;
        $zone->branch_id = $this->validatedBranchId($attributes['branch_id'] ?? null, $organisationId);
        $zone->code = $code;
        $zone->name_en = trim($attributes['name_en']);
        $zone->name_ar = $this->trimmedOrNull($attributes['name_ar'] ?? null) ?? '';
        $zone->currency_code = $this->validatedCurrency($attributes['currency_code'] ?? null, $organisationId);
        $zone->delivery_fee_minor = $this->validatedMinor($attributes['delivery_fee_minor'] ?? null, 'delivery_fee_minor');
        $zone->minimum_order_minor = $this->validatedMinor($attributes['minimum_order_minor'] ?? null, 'minimum_order_minor');
        $zone->estimated_minutes = $this->validatedMinutes($attributes['estimated_minutes'] ?? null);
        $zone->status = DeliveryZoneStatus::Active;
        $zone->lock_version = 0;
        $zone->created_by = $this->context->userId();
        $zone->updated_by = $this->context->userId();
        $zone->save();

        $this->audit->record(
            'catalogue.delivery_zone_created',
            actorUserId: $this->context->userId(),
            subjectType: 'delivery_zone',
            subjectId: (string) $zone->getKey(),
            metadata: [
                'currency' => $zone->currency_code,
                'branch_id' => $zone->branch_id,
                'status' => $zone->status->value,
            ],
        );

        return $zone;
    }

    /**
     * @param  array<string, mixed>  $attributes
     *
     * @throws ApiException
     */
    public function update(DeliveryZone $zone, array $attributes, int $expectedLockVersion): DeliveryZone
    {
        $this->assertEditable($zone);

        if (array_key_exists('code', $attributes)) {
            throw $this->invalid('code', 'A delivery zone code is fixed when the zone is created. Rename the zone instead.');
        }

        if (array_key_exists('status', $attributes)) {
            throw $this->invalid('status', 'A zone is archived through its own action, not by writing a status. Suspend it with is_active instead.');
        }

        $organisationId = $this->requireOrganisation();
        $changes = [];

        foreach (['name_en', 'name_ar'] as $field) {
            if (! array_key_exists($field, $attributes)) {
                continue;
            }

            $value = $attributes[$field];
            $changes[$field] = is_string($value) ? trim($value) : $value;
        }

        if (($changes['name_en'] ?? null) === '') {
            throw $this->invalid('name_en', 'A delivery zone must have a name.');
        }

        if (array_key_exists('currency_code', $attributes)) {
            $changes['currency_code'] = $this->validatedCurrency($attributes['currency_code'], $organisationId);
        }

        foreach (['delivery_fee_minor', 'minimum_order_minor'] as $field) {
            if (array_key_exists($field, $attributes)) {
                $changes[$field] = $this->validatedMinor($attributes[$field], $field);
            }
        }

        if (array_key_exists('estimated_minutes', $attributes)) {
            $changes['estimated_minutes'] = $this->validatedMinutes($attributes['estimated_minutes']);
        }

        if (array_key_exists('is_active', $attributes)) {
            $changes['status'] = $this->suspensionStatus($attributes['is_active'])->value;
        }

        $rescoped = array_key_exists('branch_id', $attributes);
        $branchId = $rescoped ? $this->validatedBranchId($attributes['branch_id'], $organisationId) : $zone->branch_id;

        if ($rescoped && $branchId !== $zone->branch_id) {
            $changes['branch_id'] = $branchId;
        }

        if ($changes === []) {
            return $zone;
        }

        $changes['updated_by'] = $this->context->userId();
        $movingScope = array_key_exists('branch_id', $changes);

        DB::transaction(function () use ($zone, $changes, $expectedLockVersion, $branchId, $movingScope): void {
            $this->compareAndSwap($zone, $changes, $expectedLockVersion);

            if (! $movingScope) {
                return;
            }

            // The denormalised copy travels with the zone, inside the same
            // transaction, so the "one area per branch" index judges the move
            // as a whole. A collision at the destination rolls the header
            // change back with it.
            $this->rescopeAreas($zone, $branchId);
        });

        $this->audit->record(
            'catalogue.delivery_zone_updated',
            actorUserId: $this->context->userId(),
            subjectType: 'delivery_zone',
            subjectId: (string) $zone->getKey(),
            metadata: [
                'changed_fields' => array_values(array_diff(array_keys($changes), ['updated_by'])),
                'lock_version' => $zone->lock_version,
            ],
        );

        return $zone;
    }

    /**
     * → archived, releasing the area claims.
     *
     * The release is the interesting half. An archived zone that kept its
     * claims would occupy every area it ever served, so a kitchen redrawing
     * its map would find the new zone refused by a zone nobody uses. Deleting
     * the join rows is safe in a way deleting a price row would not be:
     * nothing points at a claim, and the zone itself — the fee, the promise,
     * the name — survives intact and explains any delivery quoted from it.
     *
     * @throws ApiException
     */
    public function archive(DeliveryZone $zone, int $expectedLockVersion): DeliveryZone
    {
        if ($zone->status === DeliveryZoneStatus::Archived) {
            throw new ApiException(
                ErrorCode::ResourceConflict,
                'This delivery zone is already archived.',
                ['status' => $zone->status->value, 'current_lock_version' => $zone->lock_version],
            );
        }

        $released = DeliveryZoneArea::withoutTenancy()->where('delivery_zone_id', $zone->getKey())->count();

        DB::transaction(function () use ($zone, $expectedLockVersion): void {
            $this->compareAndSwap($zone, [
                'status' => DeliveryZoneStatus::Archived->value,
                'updated_by' => $this->context->userId(),
            ], $expectedLockVersion);

            DeliveryZoneArea::withoutTenancy()->where('delivery_zone_id', $zone->getKey())->delete();
        });

        $this->audit->record(
            'catalogue.delivery_zone_archived',
            actorUserId: $this->context->userId(),
            subjectType: 'delivery_zone',
            subjectId: (string) $zone->getKey(),
            metadata: [
                'status' => DeliveryZoneStatus::Archived->value,
                'released_area_count' => $released,
                'lock_version' => $zone->lock_version,
            ],
        );

        return $zone;
    }

    /**
     * An archived zone is frozen — its area set included.
     *
     * @throws ApiException
     */
    public function assertEditable(DeliveryZone $zone): void
    {
        if (! $zone->isEditable()) {
            throw new ApiException(
                ErrorCode::ResourceConflict,
                'An archived delivery zone cannot be changed. Create a replacement instead.',
                ['status' => $zone->status->value, 'current_lock_version' => $zone->lock_version],
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
    public function compareAndSwap(DeliveryZone $zone, array $changes, int $expectedLockVersion): void
    {
        $affected = DeliveryZone::withoutTenancy()
            ->whereKey($zone->getKey())
            ->where('lock_version', $expectedLockVersion)
            ->update($changes + [
                'lock_version' => $expectedLockVersion + 1,
                'updated_at' => now(),
            ]);

        if ($affected === 0) {
            $current = DeliveryZone::withoutTenancy()->whereKey($zone->getKey())->value('lock_version');

            throw new StaleLockVersion(is_numeric($current) ? (int) $current : $expectedLockVersion);
        }

        $zone->refresh();
    }

    /**
     * Carry the area claims to the zone's new scope, refusing the move rather
     * than half-performing it when the destination is already served.
     *
     * @throws ApiException
     */
    private function rescopeAreas(DeliveryZone $zone, ?string $branchId): void
    {
        /** @var list<string> $areaIds */
        $areaIds = DeliveryZoneArea::withoutTenancy()
            ->where('delivery_zone_id', $zone->getKey())
            ->pluck('delivery_area_id')
            ->all();

        if ($areaIds === []) {
            return;
        }

        $occupied = DeliveryZoneArea::withoutTenancy()
            ->where('organisation_id', $zone->organisation_id)
            ->where('delivery_zone_id', '!=', $zone->getKey())
            ->whereIn('delivery_area_id', $areaIds)
            ->when($branchId === null, fn ($query) => $query->whereNull('branch_id'))
            ->when($branchId !== null, fn ($query) => $query->where('branch_id', $branchId))
            ->get();

        $first = $occupied->first();

        if ($first instanceof DeliveryZoneArea) {
            throw new ApiException(
                ErrorCode::ResourceConflict,
                'Another zone already serves one of these areas at that scope. Move the area out of it first.',
                [
                    'reason' => 'area_already_served',
                    'delivery_area_id' => $first->delivery_area_id,
                    'occupying_delivery_zone_id' => $first->delivery_zone_id,
                    'occupied_area_count' => $occupied->count(),
                ],
            );
        }

        DeliveryZoneArea::withoutTenancy()
            ->where('delivery_zone_id', $zone->getKey())
            ->update(['branch_id' => $branchId, 'updated_at' => now()]);
    }

    /**
     * `is_active` is the suspension switch, and it is deliberately not a
     * `status` field: archiving has its own action and its own audit event, so
     * the only lifecycle move a PATCH can make is the reversible one.
     *
     * @throws ApiException
     */
    private function suspensionStatus(mixed $value): DeliveryZoneStatus
    {
        if (! is_bool($value)) {
            throw $this->invalid('is_active', 'A zone is either serving or suspended — is_active is true or false.');
        }

        return $value ? DeliveryZoneStatus::Active : DeliveryZoneStatus::Inactive;
    }

    /**
     * Defaults to the organisation's own currency. Unlike a price list — where
     * a default would silently produce a USD tariff in an AED kitchen —
     * a delivery fee is a single number in the kitchen's home market, and
     * making every zone restate the currency of the country it is in would be
     * ceremony rather than safety. An explicit value still wins, because a
     * kitchen quoting cross-border delivery is a real thing.
     *
     * @throws ApiException
     */
    private function validatedCurrency(mixed $value, string $organisationId): string
    {
        $code = is_string($value) ? mb_strtoupper(trim($value)) : '';

        if ($code === '') {
            $default = Organisation::query()->whereKey($organisationId)->value('default_currency_code');

            if (is_string($default) && $default !== '') {
                return $default;
            }

            throw $this->invalid('currency_code', 'This organisation has no default currency, so a zone has to state one.');
        }

        if (! Currency::query()->whereKey($code)->exists()) {
            throw $this->invalid('currency_code', 'This is not a currency the platform recognises.');
        }

        return $code;
    }

    /**
     * @throws ApiException
     */
    private function validatedMinor(mixed $value, string $field): ?int
    {
        if ($value === null || $value === '') {
            return null;
        }

        if (! is_int($value) || $value < 0) {
            throw $this->invalid($field, 'An amount is a whole number of minor units, zero or more. Leave it out entirely to say nobody has decided.');
        }

        return $value;
    }

    /**
     * @throws ApiException
     */
    private function validatedMinutes(mixed $value): ?int
    {
        if ($value === null || $value === '') {
            return null;
        }

        if (! is_int($value) || $value <= 0) {
            throw $this->invalid('estimated_minutes', 'A delivery estimate is a whole number of minutes above zero.');
        }

        return $value;
    }

    /**
     * @throws ApiException
     */
    private function validatedBranchId(mixed $value, string $organisationId): ?string
    {
        $branchId = $this->trimmedOrNull(is_string($value) ? $value : null);

        if ($branchId === null) {
            return null;
        }

        $belongs = OrganisationBranch::withoutTenancy()
            ->whereKey($branchId)
            ->where('organisation_id', $organisationId)
            ->exists();

        if (! $belongs) {
            throw $this->invalid('branch_id', 'This branch does not exist, or is not one you can use.');
        }

        return $branchId;
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

    private function trimmedOrNull(?string $value): ?string
    {
        if ($value === null) {
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
