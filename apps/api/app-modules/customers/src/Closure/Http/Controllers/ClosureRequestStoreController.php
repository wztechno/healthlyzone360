<?php

declare(strict_types=1);

namespace Healthy360\Customers\Closure\Http\Controllers;

use Healthy360\Customers\Closure\Enums\ClosureScope;
use Healthy360\Customers\Closure\Http\Concerns\ResolvesClosureRequest;
use Healthy360\Customers\Closure\Http\Requests\OpenClosureRequest;
use Healthy360\Customers\Closure\Services\ClosureService;
use Healthy360\Support\Api\ApiResponse;
use Healthy360\Support\Api\Exceptions\ApiException;
use Illuminate\Http\JsonResponse;

/**
 * POST /api/v1/me/closure-requests — "stop emailing me", or "forget me".
 *
 * **One endpoint for both scopes, because it is one screen.** Somebody who has
 * decided to stop hearing from a service is frequently deciding whether to stop
 * being a customer, and making them find two different pages to say so is how a
 * platform ends up with an opt-out nobody could find and a closure nobody
 * meant. The response shape is the same for both — `ClosureAcknowledgement` —
 * so a client that had to branch on the response *type* to render the blocked
 * case cannot exist.
 *
 * **The status says which half happened.** A `marketing_opt_out` comes back
 * `200` already `completed`: the consents are withdrawn and the suppression is
 * written before the method returns, because a customer's expectation is that
 * "stop emailing me" has taken effect by the time the page reloads, and there
 * is nothing irreversible here for a delay to protect. A `full` closure comes
 * back `202` — accepted, passcode in flight, nothing erased yet — which is the
 * honest status for a request that is waiting on a human to read a message.
 *
 * **A blocked request is a `202`, not an error.** `blocked` and `blockers` are
 * fields in a successful body, and the request survives so somebody can come
 * back when their last order has arrived. `ErrorCode::ClosureRefused` says so
 * in its own docblock, and there is deliberately no `closure.blocked` code: a
 * blocker is information a customer acts on, and an error code would turn a
 * checklist into a failure. No passcode is sent for a request that cannot
 * proceed either — asking somebody to prove their identity for an act the
 * platform has already decided not to perform is friction for nothing.
 *
 * The refusals that *are* errors: a second request while one is in flight
 * (`409 closure.refused`, reason `closure_already_in_flight` — the existing one
 * is not silently returned, because the two may differ in scope and quietly
 * handing back an older request would answer a question nobody asked), and no
 * verified contact to send a passcode to.
 */
final class ClosureRequestStoreController
{
    use ResolvesClosureRequest;

    public function __construct(private readonly ClosureService $closures) {}

    /**
     * @throws ApiException
     */
    public function __invoke(OpenClosureRequest $request): JsonResponse
    {
        $user = $this->closingUser($request);

        $acknowledgement = $this->closures->request(
            $user,
            $request->reasonCode(),
            $request->scope(),
            $request->note(),
            $request->deliveryChannel(),
            // The `Accept-Language` the caller already sent, rather than a body
            // field. A locale is a property of the connection, and a client
            // that could name a different one in the body would have two ways
            // to say one thing.
            $request->getPreferredLanguage(),
            $this->requestIpHash($request),
        );

        return ApiResponse::data(
            ['closure_request' => $acknowledgement->toArray()],
            status: $request->scope() === ClosureScope::MarketingOptOut ? 200 : 202,
        );
    }

    /**
     * The keyed digest of the client address.
     *
     * Hashed from what the connection carried and never accepted in the body,
     * for the reason the guest journey states: a caller who can choose their
     * own fingerprint does not have one. It reaches `otp_challenges.request_ip_hash`,
     * where it is what makes "the same address is guessing at fifty accounts"
     * answerable without storing anybody's address.
     */
    private function requestIpHash(OpenClosureRequest $request): ?string
    {
        $address = $request->ip();

        if ($address === null || $address === '') {
            return null;
        }

        return hash_hmac('sha256', $address, (string) config('app.key'));
    }
}
