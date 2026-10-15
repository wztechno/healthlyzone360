<?php

declare(strict_types=1);

namespace Healthy360\Orders\OrderDesk\Http\Controllers;

use Healthy360\Audit\Services\AuditRecorder;
use Healthy360\Customers\Models\CustomerAccount;
use Healthy360\Identity\Enums\ContactChannel;
use Healthy360\Identity\Models\ContactPoint;
use Healthy360\Identity\Services\ContactPointRegistry;
use Healthy360\Orders\OrderDesk\Http\Requests\UpdateOrderDeskCustomerRequest;
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
 * PATCH /api/v1/catalogue/order-desk/customers/{account} — correct a customer
 * the desk sells to: the name, the number, or both.
 *
 * Without it a misheard name or a mistyped number could only be fixed by
 * writing the person down a second time, which left two customers on the desk
 * for one human and split their order history between them.
 *
 * ## Who can be corrected
 *
 * Exactly the customers the desk can pick for a collection or a delivery: the
 * account is put through `DeskCustomerDirectory::isInScope()`, the rule the
 * search and the address endpoint apply, and anything outside it answers
 * `404 resource.not_found` for the reason those two give.
 *
 * ## The name is the account's
 *
 * `customer_accounts.display_name` — the name this relationship goes by. A
 * registered customer's own profile is not touched.
 *
 * ## A new number is added, the wrong one retired
 *
 * The corrected number is remembered as the account's **primary** phone, and
 * every other live phone the *account* owns is retired. Retired rather than
 * rewritten, because an order already placed points at the contact it was given
 * — its docket and its driver's run sheet keep showing the number that order
 * carried, which is the fact the snapshot exists to keep. A phone the customer's
 * own login owns is left alone: the account-owned primary outranks it for the
 * desk and the driver (see `OrderDeskQueue::phoneRows()`), and the person's
 * sign-in is theirs to change.
 *
 * A number already verified on somebody else's account is refused by the
 * registry as `contact.already_verified`, as on create. A number other desk
 * customers merely share comes back in `possible_duplicates`, as on create.
 */
final class OrderDeskCustomerUpdateController
{
    public function __construct(
        private readonly OrderLocator $locator,
        private readonly DeskCustomerDirectory $directory,
        private readonly ContactPointRegistry $contacts,
        private readonly OrderDeskQueue $queue,
        private readonly OrderDeskCustomerPresenter $presenter,
        private readonly AuditRecorder $audit,
        private readonly TenantContext $context,
    ) {}

    /**
     * @throws ApiException
     */
    public function __invoke(UpdateOrderDeskCustomerRequest $request, string $account): JsonResponse
    {
        $organisationId = $this->locator->sellerId();
        $customer = $this->inScopeAccount($organisationId, $account);
        $agentId = $this->agentId();
        $payload = $request->payload();
        $normalisedPhone = $request->normalisedPhone();

        $duplicates = $normalisedPhone === null
            ? []
            : array_values(array_filter(
                $this->directory->holdersOfNormalisedPhone($organisationId, $normalisedPhone),
                static fn (CustomerAccount $holder): bool => (string) $holder->getKey() !== (string) $customer->getKey(),
            ));

        DB::transaction(function () use ($customer, $payload, $agentId): void {
            $changed = [];

            if (isset($payload['display_name']) && $payload['display_name'] !== $customer->display_name) {
                $customer->display_name = $payload['display_name'];
                $customer->save();
                $changed[] = 'display_name';
            }

            if (isset($payload['phone'])) {
                $kept = $this->contacts->rememberForCustomerAccount(
                    customerAccountId: (string) $customer->getKey(),
                    channel: ContactChannel::Phone,
                    value: $payload['phone'],
                    isPrimary: true,
                    source: 'staff',
                    createdBy: $agentId,
                );

                $replaced = ContactPoint::query()
                    ->where('customer_account_id', $customer->getKey())
                    ->where('channel', ContactChannel::Phone)
                    ->whereNull('retired_at')
                    ->whereKeyNot($kept->getKey())
                    ->get();

                foreach ($replaced as $old) {
                    $this->contacts->retire($old);
                }

                if ($replaced->isNotEmpty() || $kept->wasRecentlyCreated) {
                    $changed[] = 'phone';
                }
            }

            // Which fields, never their values: the old and new number are
            // personal data in a table read by people with no reason to see them.
            if ($changed !== []) {
                $this->audit->record(
                    'customer.updated_by_desk',
                    actorUserId: $agentId,
                    subjectType: 'customer_account',
                    subjectId: (string) $customer->getKey(),
                    metadata: ['fields' => $changed],
                );
            }
        });

        $customer->refresh();
        $id = (string) $customer->getKey();
        $contacts = $this->queue->contactsFor([$id]);

        return ApiResponse::data([
            'customer' => $this->presenter->customer(
                $customer,
                $contacts[$id]['phone'] ?? null,
                $this->hasOrdersWith($organisationId, $id),
            ),
            'possible_duplicates' => $this->rows($duplicates),
        ]);
    }

    /**
     * @throws ApiException
     */
    private function inScopeAccount(string $organisationId, string $accountId): CustomerAccount
    {
        $account = CustomerAccount::query()->whereKey($accountId)->first();

        if (! $account instanceof CustomerAccount || ! $this->directory->isInScope($organisationId, $account)) {
            throw new ApiException(ErrorCode::ResourceNotFound, 'That customer account could not be read.');
        }

        return $account;
    }

    private function hasOrdersWith(string $organisationId, string $accountId): bool
    {
        return DB::table('orders')
            ->where('customer_account_id', $accountId)
            ->where('organisation_id', $organisationId)
            ->exists();
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

        return array_map(fn (CustomerAccount $account): array => $this->presenter->customer(
            $account,
            $contacts[(string) $account->getKey()]['phone'] ?? null,
            (bool) $account->getAttribute('has_orders_with_org'),
        ), $accounts);
    }

    /**
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
}
