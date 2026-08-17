<?php

declare(strict_types=1);

namespace Healthy360\Orders\OrderDesk\Http\Controllers;

use Healthy360\Customers\Models\CustomerAccount;
use Healthy360\Customers\Services\CustomerAccountLifecycle;
use Healthy360\Identity\Enums\ContactChannel;
use Healthy360\Identity\Services\ContactPointRegistry;
use Healthy360\Orders\OrderDesk\Http\Concerns\RequiresIdempotencyKey;
use Healthy360\Orders\OrderDesk\Http\Requests\StoreOrderDeskCustomerRequest;
use Healthy360\Orders\OrderDesk\Presenters\OrderDeskCustomerPresenter;
use Healthy360\Orders\OrderDesk\Services\DeskCustomerDirectory;
use Healthy360\Orders\OrderDesk\Services\OrderDeskQueue;
use Healthy360\Orders\Services\OrderLocator;
use Healthy360\Support\Api\ApiResponse;
use Healthy360\Support\Api\ErrorCode;
use Healthy360\Support\Api\Exceptions\ApiException;
use Healthy360\Tenancy\TenantContext;
use Illuminate\Http\JsonResponse;
use Illuminate\Support\Facades\DB;

/**
 * POST /api/v1/catalogue/order-desk/customers — the kitchen writes down
 * somebody who has never used the platform.
 *
 * The cold caller. Every other way a `customer_accounts` row comes into being is
 * the customer doing it — registering, checking out as a guest, being
 * provisioned with a corporate buyer. This is the one path where a member of
 * staff creates a record **about a member of the public who is not at a
 * keyboard**, which is why it has its own permission code
 * (`customer.create_on_behalf_organisation`) rather than riding on the one that
 * sells them lunch: an account outlives the sale, and a kitchen may reasonably
 * want an agent who can take an order for somebody already on file without being
 * able to add people to the file.
 *
 * ## What is written, in one transaction
 *
 * A `b2c` account with **no user**, `origin = staff`, `provisional`, and no
 * `provisional_expires_at` — see `CustomerAccountLifecycle::
 * openStaffProvisionedAccount()` for why each of those is what it is, and
 * `2026_08_16_003006` for the shape CHECK that admits it. Then the caller's
 * telephone number as an **account-owned** contact point: `source = staff`,
 * **unverified**, primary.
 *
 * *Unverified* because nobody proved anything. The desk heard a number over a
 * telephone; that is provenance, not proof, and `source = staff` is the column
 * that records the difference. The platform's uniqueness rule bites only
 * verified rows (`contact_points_verified_value_unique`), which is what makes a
 * duplicate legal — see below — and marking a heard number verified would both
 * lie and let a desk claim a number away from the person who really holds it.
 *
 * *Account-owned* rather than user-owned because there is no user, and that is
 * also what keeps the row readable: the desk queue resolves a number from either
 * ownership arm, and a cold caller's number has only one place to hang.
 *
 * The two writes are one transaction. A customer written down without the number
 * that was the entire point of writing them down is worse than a refusal, and
 * the refusal an agent would see (a number already **verified** by somebody
 * else) is one they can act on.
 *
 * ## `Idempotency-Key` is mandatory
 *
 * Nothing in the schema would notice a second identical customer. The `b2c`
 * unique index is partial on `user_id` and a staff-provisioned row has none, so
 * a double tap is two perfectly legal accounts and no row anywhere says which
 * was the mistake. The key is the only guard there is — the same argument the
 * placement endpoint makes, and the reason both share
 * `RequiresIdempotencyKey`.
 *
 * ## Duplicates are surfaced, not refused
 *
 * **Search first** is the workflow, and the search endpoint exists so that an
 * agent finds the regular rather than creating them again. But two customers
 * genuinely do share a telephone number — a household, a reception desk, an
 * office floor — so a number already on file is not an error and this endpoint
 * creates the account anyway.
 *
 * What it does instead is **say so**: `possible_duplicates` carries every
 * in-scope account already holding that exact normalised number, in the same
 * shape the search returns, computed **before** the new row exists so the new
 * customer is never listed as a duplicate of themselves. The agent sees "we
 * already have a Ramy on this number" while the customer is still on the line,
 * which is the only moment merging is cheap. It is cheap honesty rather than a
 * refusal because refusing would make the flatmate of an existing customer
 * unserveable, and would do it at a counter with somebody waiting.
 *
 * The list is scoped exactly as the search is — this kitchen's customers only.
 * Answering "somebody, somewhere on the platform, has this number" would turn a
 * duplicate warning into an oracle over every telephone number the platform
 * holds.
 */
final class OrderDeskCustomerStoreController
{
    use RequiresIdempotencyKey;

    public function __construct(
        private readonly OrderLocator $locator,
        private readonly DeskCustomerDirectory $directory,
        private readonly CustomerAccountLifecycle $lifecycle,
        private readonly ContactPointRegistry $contacts,
        private readonly OrderDeskQueue $queue,
        private readonly OrderDeskCustomerPresenter $presenter,
        private readonly TenantContext $context,
    ) {}

    /**
     * @throws ApiException
     */
    public function __invoke(StoreOrderDeskCustomerRequest $request): JsonResponse
    {
        $this->requiredIdempotencyKey(
            $request,
            'Nothing in the schema would notice a second identical customer, so a retry with no key would write the same caller down twice. Send an Idempotency-Key.',
        );

        $payload = $request->payload();

        $organisationId = $this->locator->sellerId();
        $agentId = $this->agentId();

        // Asked before the account exists, so the new customer cannot appear in
        // their own duplicate list.
        $duplicates = $this->directory->holdersOfNormalisedPhone($organisationId, $request->normalisedPhone());

        $account = DB::transaction(function () use ($payload, $agentId): CustomerAccount {
            $account = $this->lifecycle->openStaffProvisionedAccount(
                displayName: $payload['display_name'],
                actorUserId: $agentId,
                preferredLanguageCode: $payload['preferred_language_code'],
                countryCode: $payload['country_code'],
            );

            $this->contacts->rememberForCustomerAccount(
                customerAccountId: (string) $account->getKey(),
                channel: ContactChannel::Phone,
                value: $payload['phone'],
                isPrimary: true,
                source: 'staff',
                createdBy: $agentId,
            );

            return $account;
        });

        return ApiResponse::data([
            // A brand-new account has no orders anywhere, so the flag is a
            // stated false rather than a second query asking a question with one
            // possible answer.
            'customer' => $this->presenter->customer($account, $request->normalisedPhone(), false),
            'possible_duplicates' => $this->rows($duplicates),
        ], status: 201);
    }

    /**
     * The member of staff writing this person down.
     *
     * `TenantContext` rather than `$request->user()`, matching the placement
     * endpoint: `created_by` on the account and `created_by` on the contact are
     * written from here, and two columns on one relationship disagreeing about
     * who did the work would be worse than either being wrong.
     *
     * The identifier is also load-bearing beyond provenance — it is arm (b) of
     * the scoping rule, so an account created with no actor would be invisible
     * to the kitchen that just created it. Unreachable behind `auth:sanctum` and
     * `db.context`; present so a routing mistake refuses rather than orphaning a
     * customer.
     *
     * @throws ApiException
     */
    private function agentId(): string
    {
        $userId = $this->context->userId();

        if ($userId === null || $userId === '') {
            throw new ApiException(ErrorCode::AuthUnauthenticated);
        }

        return $userId;
    }

    /**
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
                (bool) $account->getAttribute('has_orders_with_org'),
            );
        }

        return $rows;
    }
}
