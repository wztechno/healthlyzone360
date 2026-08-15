<?php

declare(strict_types=1);

namespace Healthy360\Orders\OrderDesk\Http\Controllers;

use Healthy360\Customers\Models\CustomerAccount;
use Healthy360\Orders\OrderDesk\Presenters\OrderDeskCustomerPresenter;
use Healthy360\Orders\OrderDesk\Services\DeskCustomerDirectory;
use Healthy360\Orders\OrderDesk\Services\OrderDeskQueue;
use Healthy360\Orders\Services\OrderLocator;
use Healthy360\Support\Api\ApiResponse;
use Healthy360\Support\Api\Exceptions\ApiException;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * GET /api/v1/catalogue/order-desk/customers — "who is this on the telephone?"
 *
 * The first thing a desk agent does on every call that is not a walk-in, and
 * the door every customer identifier the desk uses comes through. The placement
 * endpoint, the quote and the address endpoint all take a
 * `customer_account_id`; **this is where one legitimately comes from**, which is
 * the reason `ResolvesDeskParty` can trust an identifier without an
 * organisation filter of its own.
 *
 * ## `order.view_customer_contact_organisation`, not the creation code
 *
 * The permission on this route is the *reading* one, and the split is the whole
 * point of having two codes. Opening an account
 * (`customer.create_on_behalf_organisation`) writes down somebody who told you
 * their details; **searching reads back the name and telephone number of people
 * who never spoke to you**, one query at a time, which is precisely the
 * disclosure the contact code was minted for. A kitchen may reasonably want an
 * agent who can take an order for a caller already on file without being able to
 * add people to the file — and the reverse pairing, a code that could create but
 * not read, would be an agent creating a duplicate for every caller because they
 * cannot see the one that exists.
 *
 * It is the same code the queue row's `customer` object is behind, and that is
 * deliberate rather than convenient: the two surfaces disclose the same pair,
 * and a search revealing more than the queue would make the queue's gating
 * pointless.
 *
 * ## Three characters, twenty rows, no cursor
 *
 * A two-character query matches a meaningful fraction of any kitchen's customer
 * list, which is a directory dump wearing a search box, so a shorter query is a
 * `422` naming the field rather than an empty list pretending nothing matched.
 * Twenty rows is the cap and there is no second page: the agent has somebody on
 * the telephone, and the answer to twenty matches is a longer query.
 *
 * ## What is searched, and what is scoped
 *
 * The name, case-insensitively as a substring; and the telephone number,
 * normalised through the same class that wrote it. Both are described where they
 * are implemented (`DeskCustomerDirectory`), including why a raw local number
 * finds nothing.
 *
 * The scoping rule — has-an-order-with-this-kitchen, **or** staff-provisioned by
 * one of its active members — lives there too, and it is the whole control:
 * `customer_accounts` has no organisation column to filter on, and its
 * row-level-security policy admits every ownerless row to every kitchen session.
 * The migration that made staff-provisioned rows possible
 * (`2026_08_16_003006`) names this endpoint as the reason that is acceptable.
 *
 * ## `X-Organisation-Id`, and no `branch_id`
 *
 * A customer is not a branch's. Every other desk endpoint takes an optional
 * `branch_id` because a branch decides cut-offs, zones and clocks; none of those
 * exist here, and offering the parameter would invite a client to believe it
 * narrowed something.
 */
final class OrderDeskCustomerIndexController
{
    public function __construct(
        private readonly OrderLocator $locator,
        private readonly DeskCustomerDirectory $directory,
        private readonly OrderDeskQueue $queue,
        private readonly OrderDeskCustomerPresenter $presenter,
    ) {}

    /**
     * @throws ApiException
     */
    public function __invoke(Request $request): JsonResponse
    {
        $validated = $request->validate([
            'query' => ['required', 'string', 'min:'.DeskCustomerDirectory::MIN_QUERY_LENGTH, 'max:60'],
        ]);

        $organisationId = $this->locator->sellerId();

        $accounts = $this->directory->search($organisationId, (string) $validated['query']);

        return ApiResponse::data($this->rows($accounts), [
            'count' => count($accounts),
            'limit' => DeskCustomerDirectory::MAX_ROWS,
        ]);
    }

    /**
     * The matched accounts as wire rows, with their numbers resolved in one
     * statement.
     *
     * `OrderDeskQueue::contactsFor()` is reused rather than reimplemented, and it
     * is the right shape by construction: it resolves a phone across **both**
     * ownership arms — account-owned for a caller the desk wrote down, user-owned
     * for a registered customer — batched over the whole page. A second
     * implementation of "the number to ring this account on" would eventually
     * disagree with the queue's, on the one screen where the two sit side by
     * side.
     *
     * @param  list<CustomerAccount>  $accounts
     * @return list<array{id: string, display_name: string|null, phone: string|null, origin: string, has_orders_with_org: bool}>
     */
    private function rows(array $accounts): array
    {
        if ($accounts === []) {
            return [];
        }

        $contacts = $this->queue->contactsFor(array_map(
            static fn (CustomerAccount $account): string => (string) $account->getKey(),
            $accounts,
        ));

        $rows = [];

        foreach ($accounts as $account) {
            $id = (string) $account->getKey();

            $rows[] = $this->presenter->customer(
                $account,
                $contacts[$id]['phone'] ?? null,
                // The selected column from the scoping query. Cast rather than
                // trusted: PostgreSQL hands a boolean back as a boolean through
                // PDO, but the attribute is not in the model's casts and a
                // string `'t'` reaching the wire as a truthy value would be a
                // silent contract break.
                (bool) $account->getAttribute('has_orders_with_org'),
            );
        }

        return $rows;
    }
}
