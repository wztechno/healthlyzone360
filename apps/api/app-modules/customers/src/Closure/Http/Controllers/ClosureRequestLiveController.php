<?php

declare(strict_types=1);

namespace Healthy360\Customers\Closure\Http\Controllers;

use Healthy360\Customers\Closure\Http\Concerns\ResolvesClosureRequest;
use Healthy360\Customers\Closure\Models\AccountClosureRequest;
use Healthy360\Customers\Closure\Results\ClosureAcknowledgement;
use Healthy360\Customers\Closure\Services\ClosureService;
use Healthy360\Customers\Enums\CustomerAccountType;
use Healthy360\Customers\Models\CustomerAccount;
use Healthy360\Support\Api\ApiResponse;
use Healthy360\Support\Api\Exceptions\ApiException;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * GET /api/v1/me/closure-requests/live — the request in flight, if there is
 * one, and what stands in its way either way.
 *
 * **`/live` rather than an index, because there is at most one.** The
 * one-live-request index on the table says so, and `ClosureService` refuses a
 * second. A collection endpoint would be a list that is always empty or a
 * singleton, and every client would have to write `[0]`. Completed and
 * cancelled requests are deliberately not listed at all: a history of somebody's
 * previous attempts to leave is not something the platform has a reason to hand
 * back, and the one that matters is the one that is still going somewhere.
 *
 * **`data.closure_request` is null when nothing is in flight, and
 * `data.blockers` is filled in regardless.** That pairing is the endpoint. A
 * closure screen has to render *before* anybody asks — "here is what would stand
 * in your way" — and re-evaluating on render is what makes it truthful: a
 * subscription started this morning is exactly what a verdict cached on the
 * request row would miss. `ClosureService::evaluateBlockers()` exists for
 * precisely this call.
 *
 * The verdicts include `advisory` ones — an unsettled credit memo does not stop
 * a closure and does have to be said out loud — so a client must branch on
 * `status` rather than on the presence of a row. `blocked` is the summary of
 * the `blocking` ones alone.
 */
final class ClosureRequestLiveController
{
    use ResolvesClosureRequest;

    public function __construct(private readonly ClosureService $closures) {}

    /**
     * @throws ApiException
     */
    public function __invoke(Request $request): JsonResponse
    {
        $user = $this->closingUser($request);
        $live = $this->closures->liveRequestFor($user);

        $account = CustomerAccount::query()
            ->where('user_id', $user->getKey())
            ->where('account_type', CustomerAccountType::B2c)
            ->first();

        $verdicts = $this->closures->evaluateBlockers($user, $account instanceof CustomerAccount ? $account : null);

        $acknowledgement = $live instanceof AccountClosureRequest
            ? ClosureAcknowledgement::for(
                $live,
                $verdicts,
                // A `requested` full closure is still waiting on a passcode; a
                // `verified` or `scheduled` one is not. Recomputed from the
                // status rather than stored, because the row is the fact and a
                // second copy of a derived flag is a second thing to get wrong.
                verificationRequired: $live->status->isLive() && $live->verified_at === null && $live->scope->requiresStepUp(),
            )
            : null;

        return ApiResponse::data([
            'closure_request' => $acknowledgement?->toArray(),
            'blockers' => array_map(
                static fn (object $verdict): array => $verdict->toArray(),
                $verdicts,
            ),
        ]);
    }
}
