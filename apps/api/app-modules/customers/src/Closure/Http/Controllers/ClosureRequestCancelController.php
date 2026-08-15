<?php

declare(strict_types=1);

namespace Healthy360\Customers\Closure\Http\Controllers;

use Healthy360\Customers\Closure\Http\Concerns\ResolvesClosureRequest;
use Healthy360\Customers\Closure\Services\ClosureService;
use Healthy360\Support\Api\ApiResponse;
use Healthy360\Support\Api\Exceptions\ApiException;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * DELETE /api/v1/me/closure-requests/{closureRequest} — "actually, no".
 *
 * **A `DELETE` that stamps rather than removes**, which is the platform's rule
 * everywhere: the row is marked `cancelled` with `cancelled_because`, and who
 * asked to leave and then changed their mind is exactly the trail a
 * data-protection enquiry reads. Nothing is erased by cancelling an erasure.
 *
 * **It answers with the row rather than `204`.** The status matters here in a
 * way it does not on `/me/contacts/{contact}` — somebody is calling off an
 * account deletion and needs to see that it is off, not an empty body — so the
 * cancelled request comes back with `status: cancelled` and its timestamps.
 *
 * Legal up to and including `scheduled`. After finalisation there is nothing
 * left to cancel — the data is gone — and offering it would be an undo that
 * does not exist; that is `409 closure.refused` with reason
 * `closure_not_cancellable`.
 */
final class ClosureRequestCancelController
{
    use ResolvesClosureRequest;

    public function __construct(private readonly ClosureService $closures) {}

    /**
     * @throws ApiException
     */
    public function __invoke(Request $request, string $closureRequest): JsonResponse
    {
        $user = $this->closingUser($request);
        $record = $this->ownClosureRequest($user, $closureRequest);

        $cancelled = $this->closures->cancel($record);

        return ApiResponse::data([
            'closure_request' => [
                'request_id' => (string) $cancelled->getKey(),
                'scope' => $cancelled->scope->value,
                'status' => $cancelled->status->value,
                'cancelled_at' => $cancelled->cancelled_at?->toIso8601String(),
                'cancelled_because' => $cancelled->cancelled_because,
            ],
        ]);
    }
}
