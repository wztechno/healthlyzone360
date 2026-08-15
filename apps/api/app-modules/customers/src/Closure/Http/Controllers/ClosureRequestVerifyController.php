<?php

declare(strict_types=1);

namespace Healthy360\Customers\Closure\Http\Controllers;

use Healthy360\Customers\Closure\Http\Concerns\ResolvesClosureRequest;
use Healthy360\Customers\Closure\Http\Requests\VerifyClosureRequest;
use Healthy360\Customers\Closure\Services\ClosureService;
use Healthy360\Support\Api\ApiResponse;
use Healthy360\Support\Api\Exceptions\ApiException;
use Illuminate\Http\JsonResponse;

/**
 * POST /api/v1/me/closure-requests/{closureRequest}/verify — the passcode that
 * makes an erasure real.
 *
 * **The authenticated user is passed as the actor, always.** That argument is
 * not decoration: `ClosureService::verify()` refuses when the actor is not the
 * person the request is about, which is the rule the support-initiated variant
 * exists to enforce. Support may *open* a closure on somebody's behalf — a
 * phone call, an accessibility need — and may never finish one, because staff
 * who could both start and finish an erasure would be staff who can erase
 * anybody. The customer's inbox is the second factor and it is the only one
 * they have.
 *
 * The service also refuses a support-initiated request whose actor is *absent*,
 * so a controller that forgot to pass one fails closed rather than sliding
 * through the guard. This controller cannot forget — there is no path here that
 * does not resolve the caller — and the belt is worth the braces anyway.
 *
 * **There is no separate `/challenges` endpoint.** `ClosureService::request()`
 * issues the passcode as part of opening the request and binds it to the row,
 * which is what stops a code obtained for one closure finalising another. A
 * client that needs a new code uses the generic
 * `POST /verification/challenges/{challenge}/resend`, which already serves every
 * purpose in the table — a second issuing surface here would be a second place
 * for the binding to be got wrong.
 *
 * **A blocked request comes back `200` and stays `verified`.** The person
 * proved who they were; making them do it again after their last order arrives
 * would be punishing them for the platform's scheduling. The body says
 * `blocked: true` with the verdicts, and nothing is scheduled.
 *
 * Otherwise the request moves to `scheduled` and `FinaliseAccountClosure` is
 * queued for the moment the grace window closes — zero-length by default, so
 * "immediately" in this deployment. `scheduled_for` in the response is the
 * moment after which there is nothing left to cancel.
 */
final class ClosureRequestVerifyController
{
    use ResolvesClosureRequest;

    public function __construct(private readonly ClosureService $closures) {}

    /**
     * @throws ApiException
     */
    public function __invoke(VerifyClosureRequest $request, string $closureRequest): JsonResponse
    {
        $user = $this->closingUser($request);
        $record = $this->ownClosureRequest($user, $closureRequest);

        /** @var string $code */
        $code = $request->validated('code');

        $acknowledgement = $this->closures->verify($record, $code, $user);

        return ApiResponse::data(['closure_request' => $acknowledgement->toArray()]);
    }
}
