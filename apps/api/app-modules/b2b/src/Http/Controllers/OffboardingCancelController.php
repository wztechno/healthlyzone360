<?php

declare(strict_types=1);

namespace Healthy360\B2b\Http\Controllers;

use Healthy360\B2b\Http\Concerns\ResolvesAuthenticatedUser;
use Healthy360\B2b\Http\Concerns\ResolvesOffboarding;
use Healthy360\B2b\Http\Requests\CancelOffboardingRequest;
use Healthy360\B2b\Presenters\OffboardingPresenter;
use Healthy360\B2b\Services\OffboardingService;
use Healthy360\Support\Api\ApiResponse;
use Healthy360\Support\Api\Exceptions\ApiException;
use Illuminate\Http\JsonResponse;

/**
 * POST /api/v1/platform/b2b/offboardings/{offboarding}/cancel — call the whole
 * thing off.
 *
 * **A POST rather than a DELETE**, unlike the closure request one module over,
 * and the difference is what the caller is doing. A customer cancelling their
 * own closure is withdrawing *their own* request, which reads as removing
 * something they created. An operator cancelling a wind-up is recording a
 * commercial decision about a relationship that continues — the company keeps
 * trading — and it needs a written reason, which a `DELETE` has nowhere to put.
 *
 * Legal right up to the moment memberships start ending, and not afterwards.
 * A late attempt is `409 offboarding.refused` with `allowed_transitions`, and
 * from `revoking` that list contains only `archiving`: the honest answer to
 * "can we undo this" is no, and re-granting access somebody deliberately
 * removed is a different act needing a different door.
 */
final class OffboardingCancelController
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
    public function __invoke(CancelOffboardingRequest $request, string $offboarding): JsonResponse
    {
        $record = $this->offboarding($offboarding);

        /** @var string $reason */
        $reason = $request->validated('reason');

        $cancelled = $this->offboardings->cancel($record, $this->currentUser($request), $reason);

        return ApiResponse::data(['offboarding' => $this->presenter->offboarding($cancelled)])
            ->withHeaders(['ETag' => '"'.$cancelled->lock_version.'"']);
    }
}
