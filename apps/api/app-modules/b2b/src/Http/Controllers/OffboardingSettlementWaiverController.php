<?php

declare(strict_types=1);

namespace Healthy360\B2b\Http\Controllers;

use Healthy360\B2b\Http\Concerns\ResolvesAuthenticatedUser;
use Healthy360\B2b\Http\Concerns\ResolvesOffboarding;
use Healthy360\B2b\Http\Requests\WaiveSettlementRequest;
use Healthy360\B2b\Presenters\OffboardingPresenter;
use Healthy360\B2b\Services\OffboardingService;
use Healthy360\Support\Api\ApiResponse;
use Healthy360\Support\Api\Exceptions\ApiException;
use Illuminate\Http\JsonResponse;
use Illuminate\Support\Facades\Gate;

/**
 * POST /api/v1/platform/b2b/offboardings/{offboarding}/settlement-waiver — set
 * aside an outstanding settlement position.
 *
 * **The callable authoriser, closed.** `OffboardingService::waiveSettlement()`
 * takes a `callable(): bool` rather than reading a permission code, on the
 * stated ground that B2's permission vocabulary was the integration wave's to
 * declare — and it made the argument **required**, precisely so that a call
 * site could not default it to true by omission. This is the call site, and the
 * gate it supplies is the real one: a fresh `Gate::allows()` against
 * `b2b_offboarding.waive_settlement_platform`.
 *
 * **A second code, not the one on the route.** Every other endpoint in this
 * family is gated by `b2b_offboarding.manage_platform`, and this one is gated
 * by that *and* by a narrower code stacked on top — the shape
 * `PlatformKycDocumentReviewController` uses when it demands the authority to
 * look at a passport *and* the authority to work the case. Driving a wind-up is
 * an operational job; deciding that a company may stop owing money and leave
 * anyway is a commercial concession, and the two are not the same person on any
 * organisation chart. A waiver reachable by everybody who can click through the
 * other eight steps would be the escape hatch quietly becoming the path.
 *
 * The check is performed **again here**, through the closure, even though the
 * route middleware has already run one. That is not redundant: the middleware
 * proves the caller may reach the endpoint, and the closure is what the service
 * insists on so that a *future* caller — a console command, a queued job, a
 * second controller — cannot reach `waiveSettlement()` without consulting
 * something. Passing `fn () => true` here would have satisfied the type and
 * defeated the design.
 *
 * `offboarding.waiver_not_permitted` is `403 authz.permission_denied`, and
 * `offboarding.waiver_needs_reason` is a `422` — the form request catches the
 * empty reason first, so the second is the backstop for a non-HTTP caller.
 *
 * The waiver writes its **own** audit action, never `settlement_cleared`. A
 * waiver recorded as a clearance erases the only difference a dispute turns on.
 */
final class OffboardingSettlementWaiverController
{
    use ResolvesAuthenticatedUser;
    use ResolvesOffboarding;

    /**
     * The narrower authority a waiver needs, over and above driving the wind-up.
     */
    private const string WAIVER_PERMISSION = 'b2b_offboarding.waive_settlement_platform';

    public function __construct(
        private readonly OffboardingService $offboardings,
        private readonly OffboardingPresenter $presenter,
    ) {}

    /**
     * @throws ApiException
     */
    public function __invoke(WaiveSettlementRequest $request, string $offboarding): JsonResponse
    {
        $record = $this->offboarding($offboarding);
        $actor = $this->currentUser($request);

        /** @var string $reason */
        $reason = $request->validated('reason');

        $waived = $this->offboardings->waiveSettlement(
            $record,
            $actor,
            $reason,
            static fn (): bool => Gate::forUser($actor)->allows(self::WAIVER_PERMISSION),
        );

        return ApiResponse::data(['offboarding' => $this->presenter->offboarding($waived)])
            ->withHeaders(['ETag' => '"'.$waived->lock_version.'"']);
    }
}
