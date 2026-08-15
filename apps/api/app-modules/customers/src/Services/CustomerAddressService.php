<?php

declare(strict_types=1);

namespace Healthy360\Customers\Services;

use Healthy360\Audit\Services\AuditRecorder;
use Healthy360\Customers\Contracts\AreaServiceLookup;
use Healthy360\Customers\Enums\CustomerAddressType;
use Healthy360\Customers\Exceptions\AreaNotServed;
use Healthy360\Customers\Models\CustomerAccount;
use Healthy360\Customers\Models\CustomerAddress;
use Illuminate\Support\Facades\DB;

/**
 * The address book.
 *
 * Two rules live here and nowhere else.
 *
 * **A delivery address must be in a served area.** Checked through the
 * `AreaServiceLookup` port at save time — see `AreaNotServed` for why then
 * rather than at checkout. A billing address is not checked at all: an invoice
 * goes wherever the customer says, and applying the delivery rule to it would
 * refuse a perfectly good billing address in a city no kitchen reaches.
 *
 * **One default per type, and the switch is atomic.** Demoting the incumbent
 * and promoting the replacement happen in one transaction, because the partial
 * unique index means a caller doing it in two statements would collide with
 * itself. Setting the *first* address of a type default automatically is
 * deliberate: an address book with no default makes the checkout ask a
 * question that has only one possible answer.
 */
final class CustomerAddressService
{
    public function __construct(
        private readonly AreaServiceLookup $areas,
        private readonly AuditRecorder $audit,
    ) {}

    /**
     * @param  array{label?: string|null, line_one: string, line_two?: string|null, building?: string|null, floor?: string|null, apartment?: string|null, directions?: string|null, postal_code?: string|null, contact_point_id?: string|null, is_default?: bool}  $attributes
     *
     * @throws AreaNotServed
     */
    public function add(
        CustomerAccount $account,
        CustomerAddressType $type,
        string $deliveryAreaId,
        array $attributes,
        ?string $actorUserId = null,
    ): CustomerAddress {
        $this->assertServed($type, $deliveryAreaId);

        return DB::transaction(function () use ($account, $type, $deliveryAreaId, $attributes, $actorUserId): CustomerAddress {
            $isFirst = ! CustomerAddress::query()
                ->where('customer_account_id', $account->getKey())
                ->where('address_type', $type)
                ->exists();

            $shouldDefault = ($attributes['is_default'] ?? false) || $isFirst;

            if ($shouldDefault) {
                $this->demoteDefaults($account, $type);
            }

            $address = CustomerAddress::query()->create([
                'customer_account_id' => $account->getKey(),
                'address_type' => $type,
                'delivery_area_id' => $deliveryAreaId,
                'label' => $attributes['label'] ?? null,
                'line_one' => $attributes['line_one'],
                'line_two' => $attributes['line_two'] ?? null,
                'building' => $attributes['building'] ?? null,
                'floor' => $attributes['floor'] ?? null,
                'apartment' => $attributes['apartment'] ?? null,
                'directions' => $attributes['directions'] ?? null,
                'postal_code' => $attributes['postal_code'] ?? null,
                'contact_point_id' => $attributes['contact_point_id'] ?? null,
                'is_default' => $shouldDefault,
                'created_by' => $actorUserId,
            ]);

            // No address content in the metadata — an audit trail that
            // recorded the street would put personal data in a table read by
            // people who have no reason to see it.
            $this->audit->record(
                'customer.address_added',
                actorUserId: $actorUserId,
                subjectType: 'customer_account',
                subjectId: (string) $account->getKey(),
                metadata: [
                    'customer_address_id' => (string) $address->getKey(),
                    'address_type' => $type->value,
                    'delivery_area_id' => $deliveryAreaId,
                    'is_default' => $shouldDefault,
                ],
            );

            return $address;
        });
    }

    /**
     * @param  array<string, mixed>  $attributes
     *
     * @throws AreaNotServed
     */
    public function update(CustomerAddress $address, array $attributes, ?string $actorUserId = null): CustomerAddress
    {
        $areaId = $attributes['delivery_area_id'] ?? $address->delivery_area_id;

        if (! is_string($areaId)) {
            $areaId = $address->delivery_area_id;
        }

        $this->assertServed($address->address_type, $areaId);

        $address->forceFill($attributes + ['updated_by' => $actorUserId])->save();

        return $address;
    }

    public function makeDefault(CustomerAddress $address, ?string $actorUserId = null): CustomerAddress
    {
        return DB::transaction(function () use ($address, $actorUserId): CustomerAddress {
            $account = $address->customerAccount()->first();

            if ($account instanceof CustomerAccount) {
                $this->demoteDefaults($account, $address->address_type);
            }

            $address->forceFill(['is_default' => true, 'updated_by' => $actorUserId])->save();

            return $address;
        });
    }

    /**
     * Remove an address, promoting a replacement if the default went.
     *
     * The promotion is not a nicety: leaving an account with addresses and no
     * default makes the checkout ask which one, every time, for no reason.
     */
    public function remove(CustomerAddress $address): void
    {
        DB::transaction(function () use ($address): void {
            $accountId = $address->customer_account_id;
            $type = $address->address_type;
            $wasDefault = $address->is_default;

            $address->delete();

            if (! $wasDefault) {
                return;
            }

            $replacement = CustomerAddress::query()
                ->where('customer_account_id', $accountId)
                ->where('address_type', $type)
                ->orderBy('created_at')
                ->first();

            $replacement?->forceFill(['is_default' => true])->save();
        });
    }

    /**
     * Whether an address can be delivered to today — the checklist's question,
     * asked without refusing anything.
     */
    public function isDeliverable(CustomerAddress $address): bool
    {
        return $address->address_type->requiresService()
            ? $this->areas->isServed($address->delivery_area_id)
            : true;
    }

    /**
     * @throws AreaNotServed
     */
    private function assertServed(CustomerAddressType $type, string $deliveryAreaId): void
    {
        if ($type->requiresService() && ! $this->areas->isServed($deliveryAreaId)) {
            throw new AreaNotServed($deliveryAreaId);
        }
    }

    private function demoteDefaults(CustomerAccount $account, CustomerAddressType $type): void
    {
        CustomerAddress::query()
            ->where('customer_account_id', $account->getKey())
            ->where('address_type', $type)
            ->where('is_default', true)
            ->update(['is_default' => false, 'updated_at' => now()]);
    }
}
