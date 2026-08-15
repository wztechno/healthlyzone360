<?php

declare(strict_types=1);

namespace Healthy360\B2b\Http\Controllers;

use Healthy360\B2b\Http\Concerns\ResolvesAuthenticatedUser;
use Healthy360\B2b\Http\Concerns\ResolvesOffboarding;
use Healthy360\B2b\Presenters\OffboardingPresenter;
use Healthy360\B2b\Services\OffboardingService;
use Healthy360\Support\Api\ApiResponse;
use Healthy360\Support\Api\Exceptions\ApiException;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * POST /api/v1/platform/b2b/offboardings/{offboarding}/settlement-checks — run
 * every check and record what each one found.
 *
 * **A sub-collection rather than an action, because re-running is the normal
 * case.** The company pays, somebody runs the checks again, and
 * `settlement_pending → settlement_pending` is a legal transition for exactly
 * that reason. A `POST` to a collection reads as "add another run"; a `PUT` on
 * a `settlement` resource would read as "assert the answer", which is what the
 * waiver endpoint does and is a different authority.
 *
 * **The response is where the honesty lands.** `SettlementRegistry` reports
 * `not_applicable` with a reason for anything it could not check, rather than
 * `clear` — and until the integration wave bound the orders module's
 * `SellerOpenOrders`, the one check that can actually refuse was one of those.
 * `settlement.checks` carries every entry with its outcome and its reason, so a
 * screen renders "2 clear, 1 not checked (no payments module)" instead of "all
 * clear".
 *
 * A clear assessment moves the wind-up to `awaiting_signoff` in the same call
 * and writes **two** audit rows — "the checks ran" and "settlement resolved" are
 * separate facts, and a wind-up that jumped straight to `awaiting_signoff` would
 * leave no record that anything was ever checked.
 */
final class OffboardingSettlementCheckController
{
    use ResolvesAuthenticatedUser;
    use ResolvesOffboarding;

    public function __construct(
        private readonly OffboardingService $offboardings,
        private readonly OffboardingPresenter $presenter,
    ) {}

    /**
     * @throws ApiException
     */
    public function __invoke(Request $request, string $offboarding): JsonResponse
    {
        $record = $this->offboarding($offboarding);

        $assessed = $this->offboardings->runSettlementChecks($record, $this->currentUser($request));

        return ApiResponse::data(['offboarding' => $this->presenter->offboarding($assessed)])
            ->withHeaders(['ETag' => '"'.$assessed->lock_version.'"']);
    }
}
