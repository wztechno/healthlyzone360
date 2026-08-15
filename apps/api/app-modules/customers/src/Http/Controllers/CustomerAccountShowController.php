<?php

declare(strict_types=1);

namespace Healthy360\Customers\Http\Controllers;

use Healthy360\Customers\Http\Concerns\ResolvesCustomerAccount;
use Healthy360\Customers\Models\CustomerAccount;
use Healthy360\Customers\Presenters\CustomerAccountPresenter;
use Healthy360\Customers\Services\AccountActivationEvaluator;
use Healthy360\Support\Api\ApiResponse;
use Healthy360\Support\Api\ErrorCode;
use Healthy360\Support\Api\Exceptions\ApiException;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * GET /api/v1/customer-account — the account and what still stands between it
 * and being usable.
 *
 * **404 when there is none**, rather than an empty object or a synthetic
 * provisional shape. A customer account is opened by a deliberate act — a
 * kitchen's chef signing in has an identity and no customer account, and
 * inventing one for them would put an onboarding checklist in front of somebody
 * who is not onboarding. The absence is the answer.
 *
 * The checklist is served with the account rather than behind a second call.
 * `outstanding` and `checklist` come from the same evaluator that guards
 * activation, so the screen and the gate cannot disagree; and the checklist
 * carries the satisfied items too, because a list that showed only what is
 * missing loses the sense of progress that makes people finish it.
 *
 * `status` is read-only here and everywhere. Nothing on this surface can set an
 * account `active`; the evaluator decides and `POST /customer-account` records
 * the verdict.
 */
final class CustomerAccountShowController
{
    use ResolvesCustomerAccount;

    public function __construct(
        private readonly AccountActivationEvaluator $evaluator,
        private readonly CustomerAccountPresenter $presenter,
    ) {}

    /**
     * @throws ApiException
     */
    public function __invoke(Request $request): JsonResponse
    {
        $user = $this->currentUser($request);
        $account = $this->customerAccountOrNull($user);

        if (! $account instanceof CustomerAccount) {
            throw new ApiException(ErrorCode::ResourceNotFound);
        }

        return ApiResponse::data(['account' => $this->presenter->account(
            $account,
            $this->evaluator->outstanding($account),
            $this->evaluator->checklist($account),
        )]);
    }
}
