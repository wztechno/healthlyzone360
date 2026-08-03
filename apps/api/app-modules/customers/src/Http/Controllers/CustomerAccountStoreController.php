<?php

declare(strict_types=1);

namespace Healthy360\Customers\Http\Controllers;

use Healthy360\Customers\Enums\CustomerAccountStatus;
use Healthy360\Customers\Http\Concerns\ResolvesCustomerAccount;
use Healthy360\Customers\Presenters\CustomerAccountPresenter;
use Healthy360\Customers\Services\AccountActivationEvaluator;
use Healthy360\Customers\Services\CustomerAccountLifecycle;
use Healthy360\Support\Api\ApiResponse;
use Healthy360\Support\Api\Exceptions\ApiException;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Random\RandomException;

/**
 * POST /api/v1/customer-account — start, or resume, becoming a customer.
 *
 * **An unmet requirement is not an error here**, and that is the whole shape of
 * this endpoint. Onboarding is interruptible by design: `provisional` is a real
 * state in which an account exists, holds addresses and declarations, and
 * cannot order. Answering a caller who has not yet verified a phone with a 422
 * would turn a checklist into a form that must be completed in one sitting, and
 * would give the client nothing to render. So the account comes back with its
 * outstanding list and the client shows the next step.
 *
 * **Idempotent, and 200 says so.** The partial unique index permits one `b2c`
 * account per person and the lifecycle converges on the existing row rather
 * than colliding with it, so a client that retries — or a person who taps twice
 * — gets one account. The status code distinguishes the two outcomes because
 * that is what a status code is for: 201 the first time, 200 every time after.
 *
 * **Activation is attempted, never requested.** The caller does not ask for
 * `active` and could not: the evaluator is consulted, and only if nothing is
 * outstanding does the account move. That is the server-authority property J1
 * exists to hold — an account that were active without meeting the
 * requirements is an account that can order food with no deliverable address
 * and no answer to the allergy question.
 *
 * The move is guarded on `provisional` rather than left to the lifecycle's own
 * refusal, because closure is terminal: a closed account whose requirements
 * happen to still be satisfied must not be quietly reopened by somebody posting
 * to this endpoint, and reaching the guard's exception to find that out would
 * turn a successful read into a 409.
 */
final class CustomerAccountStoreController
{
    use ResolvesCustomerAccount;

    public function __construct(
        private readonly CustomerAccountLifecycle $lifecycle,
        private readonly AccountActivationEvaluator $evaluator,
        private readonly CustomerAccountPresenter $presenter,
    ) {}

    /**
     * @throws ApiException
     * @throws RandomException
     */
    public function __invoke(Request $request): JsonResponse
    {
        $user = $this->currentUser($request);
        $existed = $this->customerAccountOrNull($user) !== null;

        $account = $this->lifecycle->openConsumerAccount($user);

        if ($account->status === CustomerAccountStatus::Provisional && $this->evaluator->isReady($account)) {
            $account = $this->lifecycle->activate($account, (string) $user->getKey());
        }

        return ApiResponse::data(
            ['account' => $this->presenter->account(
                $account,
                $this->evaluator->outstanding($account),
                $this->evaluator->checklist($account),
            )],
            status: $existed ? 200 : 201,
        );
    }
}
