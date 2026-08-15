<?php

declare(strict_types=1);

namespace Healthy360\Customers\Closure\Http\Controllers;

use App\Models\User;
use Healthy360\Customers\Closure\Enums\ClosureScope;
use Healthy360\Customers\Closure\Http\Concerns\ResolvesClosureRequest;
use Healthy360\Customers\Closure\Http\Requests\OpenClosureRequest;
use Healthy360\Customers\Closure\Services\ClosureService;
use Healthy360\Customers\Enums\CustomerAccountType;
use Healthy360\Customers\Models\CustomerAccount;
use Healthy360\Support\Api\ApiResponse;
use Healthy360\Support\Api\ErrorCode;
use Healthy360\Support\Api\Exceptions\ApiException;
use Illuminate\Http\JsonResponse;

/**
 * POST /api/v1/platform/customer-accounts/{account}/closure-requests — support
 * opening a closure on a customer's behalf.
 *
 * **Support may open one and may never finish one**, and that asymmetry is the
 * entire reason this endpoint is separate from the customer's own. There is no
 * platform `verify` route and there never will be: `ClosureService::verify()`
 * refuses when the caller is the support actor, the passcode goes to the
 * *customer's* verified destination, and the customer's inbox is the second
 * factor. An endpoint where staff could both start and finish an erasure would
 * be an endpoint where staff can erase anybody.
 *
 * **Two gates, the shape K1.1 and B1 both use.** `platform.context` asserts the
 * selected organisation *is* the platform operator; `permission:customer_account.close_platform`
 * asserts the member holds the code. A tenant that somehow acquired the
 * permission still cannot reach this route, because an organisation type is not
 * something a tenant can grant itself — and this is the one endpoint on the
 * platform that starts the deletion of a named person's data, so the second
 * gate is not ceremony.
 *
 * **Keyed on the customer account rather than the user.** A support agent is
 * looking at an account, not at a `users` row, and an endpoint that took a user
 * identifier would make "which person does this login belong to" a lookup they
 * would have to perform against a table they have no other reason to read. The
 * account is resolved to its owner here; an account with no `user_id` — an
 * ownerless guest — has no identity to close and is a `422`, because closure is
 * about an identity and G1's own deletion journey is the right door for a guest.
 *
 * `b2c` only, mirroring `ClosureService::accountFor()`. A corporate account
 * belongs to the company, outlives the individual who opened it, and is B2's to
 * offboard; anonymising it because one buyer left would close a business
 * relationship nobody ended.
 *
 * The actor is recorded in `initiated_by_user_id` and every audit row for this
 * request carries `purpose_of_use = support` rather than `self_service` — the
 * distinction the column exists for.
 */
final class PlatformClosureRequestStoreController
{
    use ResolvesClosureRequest;

    public function __construct(private readonly ClosureService $closures) {}

    /**
     * @throws ApiException
     */
    public function __invoke(OpenClosureRequest $request, string $account): JsonResponse
    {
        $actor = $this->closingUser($request);

        $record = CustomerAccount::query()
            ->where('account_type', CustomerAccountType::B2c)
            ->whereKey($account)
            ->first();

        if (! $record instanceof CustomerAccount) {
            throw new ApiException(ErrorCode::ResourceNotFound);
        }

        $owner = $record->user;

        if (! $owner instanceof User) {
            throw new ApiException(
                ErrorCode::ValidationFailed,
                'This account has no identity to close.',
                ['reason' => 'account_has_no_owner'],
            );
        }

        $acknowledgement = $this->closures->requestForCustomer(
            $actor,
            $owner,
            $request->reasonCode(),
            $request->scope(),
            $request->note(),
            $request->deliveryChannel(),
            // The *customer's* locale would be the right one and the platform
            // does not hold one; the agent's `Accept-Language` is the honest
            // fallback and is what `OtpService` already does with a null.
            $request->getPreferredLanguage(),
        );

        return ApiResponse::data(
            ['closure_request' => $acknowledgement->toArray()],
            status: $request->scope() === ClosureScope::MarketingOptOut ? 200 : 202,
        );
    }
}
