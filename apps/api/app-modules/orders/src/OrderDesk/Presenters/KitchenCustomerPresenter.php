<?php

declare(strict_types=1);

namespace Healthy360\Orders\OrderDesk\Presenters;

use Carbon\CarbonImmutable;
use Healthy360\Customers\Models\CustomerAccount;

/**
 * A customer as the kitchen's customer book shows them — the reference page,
 * not the desk.
 *
 * This shape discloses more than `OrderDeskCustomerPresenter` on purpose: the
 * page exists so a kitchen can look up who it sells to, with their contacts,
 * addresses and (for a corporate buyer) company record. It sits behind the same
 * `order.view_customer_contact_organisation` code, whose description and label
 * were widened to say so. The order figures are always the asking kitchen's own.
 *
 * Contacts, addresses and company arrive as arguments rather than being read
 * here, so the presenter never goes to the database per row.
 */
final class KitchenCustomerPresenter
{
    /**
     * @param  list<array{channel: string, value: string, label: string|null, is_primary: bool, verified: bool}>  $contacts
     * @return array{
     *     id: string,
     *     account_number: string,
     *     account_type: string,
     *     display_name: string|null,
     *     status: string,
     *     primary_phone: string|null,
     *     primary_email: string|null,
     *     order_count: int,
     *     last_ordered_at: string|null
     * }
     */
    public function row(CustomerAccount $account, array $contacts): array
    {
        return [
            'id' => (string) $account->getKey(),
            'account_number' => $account->account_number,
            'account_type' => $account->account_type->value,
            'display_name' => $account->display_name,
            'status' => $account->status->value,
            'primary_phone' => $this->first($contacts, 'phone'),
            'primary_email' => $this->first($contacts, 'email'),
            'order_count' => (int) $account->getAttribute('order_count'),
            'last_ordered_at' => $this->instant($account->getAttribute('last_ordered_at')),
        ];
    }

    /**
     * @param  list<array{channel: string, value: string, label: string|null, is_primary: bool, verified: bool}>  $contacts
     * @param  list<array<string, mixed>>  $addresses
     * @param  array<string, mixed>|null  $company
     * @return array<string, mixed>
     */
    public function detail(CustomerAccount $account, array $contacts, array $addresses, ?array $company): array
    {
        return [
            ...$this->row($account, $contacts),
            'origin' => $account->origin->value,
            'preferred_language_code' => $account->preferred_language_code,
            'created_at' => $this->instant($account->created_at),
            'contacts' => $contacts,
            'addresses' => $addresses,
            'company' => $company,
        ];
    }

    /**
     * @param  list<array{channel: string, value: string, label: string|null, is_primary: bool, verified: bool}>  $contacts
     */
    private function first(array $contacts, string $channel): ?string
    {
        foreach ($contacts as $contact) {
            if ($contact['channel'] === $channel) {
                return $contact['value'];
            }
        }

        return null;
    }

    private function instant(mixed $raw): ?string
    {
        if ($raw === null || $raw === '') {
            return null;
        }

        return CarbonImmutable::parse($raw)->utc()->toIso8601String();
    }
}
