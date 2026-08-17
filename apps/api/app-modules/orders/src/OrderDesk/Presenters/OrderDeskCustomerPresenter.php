<?php

declare(strict_types=1);

namespace Healthy360\Orders\OrderDesk\Presenters;

use Healthy360\Customers\Models\CustomerAccount;

/**
 * A customer as the order desk sees them: enough to pick the right one out of a
 * list of five, and nothing more.
 *
 * ## Five fields, and each absence is a decision
 *
 * `display_name` and `phone` are the disclosure this shape exists for, and they
 * are the same pair the queue row carries behind the same permission code
 * (`order.view_customer_contact_organisation`) — a name and a number are the
 * least somebody can be identified and called back on. The two surfaces
 * deliberately agree: a search that revealed more than the queue would make the
 * queue's careful gating pointless.
 *
 * `origin` is here because it answers the agent's actual question — is this
 * somebody who registered themselves, or somebody we wrote down at this desk —
 * and it is a fact about the *record*, not about the person.
 *
 * `has_orders_with_org` is the same distinction from the other side: a regular
 * versus a name in the book. It is scoped to the asking kitchen and says
 * nothing about anybody else's trade.
 *
 * **What is deliberately absent.** No email — a number is what a desk rings and
 * an address is what a marketing list is built from. No `account_number`: it is
 * `Confidential`, it is what a person quotes to *support*, and a desk that could
 * read one could quote it back to a caller who is not the account holder. No
 * addresses: a street somebody lives on is the sharpest fact on the account, and
 * it belongs to the order that is going there, not to a search result. No order
 * history and no count of other kitchens — a person ordering from four kitchens
 * holds one account, and this shape must not become the surface on which one
 * kitchen reads another's customer relationships. No `status`, no
 * `provisional_expires_at`: the desk bypasses the activation checklist, so
 * neither field would change anything an agent could do.
 *
 * `has_orders_with_org` arrives as a selected column on the model rather than
 * being computed here, and `phone` arrives as an argument, both for the reason
 * `OrderDeskPresenter` states: a presenter that went to the database per row
 * turns a list into one round trip per entry.
 */
final class OrderDeskCustomerPresenter
{
    /**
     * @return array{
     *     id: string,
     *     display_name: string|null,
     *     phone: string|null,
     *     origin: string,
     *     has_orders_with_org: bool
     * }
     */
    public function customer(CustomerAccount $account, ?string $phone, bool $hasOrdersWithOrganisation): array
    {
        return [
            'id' => (string) $account->getKey(),
            'display_name' => $account->display_name,
            'phone' => $phone,
            'origin' => $account->origin->value,
            'has_orders_with_org' => $hasOrdersWithOrganisation,
        ];
    }
}
