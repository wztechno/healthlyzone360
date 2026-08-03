<?php

declare(strict_types=1);

namespace Healthy360\Orders\Http\Controllers;

use Healthy360\Customers\Guest\Http\Middleware\ResolveGuestSession;
use Healthy360\Customers\Guest\Models\GuestSession;
use Healthy360\Orders\Models\Order;
use Healthy360\Orders\Presenters\GuestOrderPresenter;
use Healthy360\Support\Api\ApiResponse;
use Healthy360\Support\Api\ErrorCode;
use Healthy360\Support\Api\Exceptions\ApiException;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * GET /api/v1/guest/orders/{order} — `guest.session`.
 *
 * "Where is my food?" for somebody who never made an account.
 *
 * ## Why the token is enough, and why the signed URL is deferred
 *
 * The obvious alternative is a signed link — the pattern used for an order
 * confirmation email, where the recipient may be reading on a device that never
 * held the token. It is deliberately **not** built in G1, and the reason is
 * that it is a *second* credential for the same data with a different lifetime,
 * a different revocation story and a different leak surface: a signed URL
 * survives in mail archives, forwarded threads and referrer headers long after
 * the guest session it was minted beside has lapsed, and revoking a session
 * would not revoke it.
 *
 * Token-auth reading is sufficient for the journey this phase actually serves:
 * the guest is in the browser that placed the order, holding the token that
 * placed it, and the token outlives the checkout by days. When the confirmation
 * email arrives (the phase that owns customer messaging), the right shape is a
 * signed, short-lived, single-order link issued *by that message* and expiring
 * with it — not a general-purpose read credential invented here in advance of
 * the surface that needs it.
 *
 * ## Scoped, and `404` for everything else
 *
 * The order is loaded `where customer_account_id = <this session's account>`.
 * An identifier that names nobody's order, another guest's order and a
 * registered customer's order all answer the same `404` — the same stance
 * `PublicKitchenShowController` takes, for the same reason: any other answer
 * would let a caller holding one token enumerate orders they cannot read.
 *
 * The identifier is shape-checked before it reaches the query. An arbitrary
 * path segment against a `uuid` column is a PostgreSQL cast error, and a `500`
 * for a caller who typed nonsense is both wrong and, since it differs from the
 * `404` a well-formed miss gets, an oracle about the column type.
 *
 * ## Note for the anonymous-surface sweep
 *
 * A `GET` under `/api/v1` without `auth:sanctum`, so the sweep discovers it and
 * needs a fixture for `{order}`. Reached without a header it answers `401` and
 * carries only the error envelope; see `GuestSessionShowController` for the
 * longer version of the same note.
 */
final class GuestOrderShowController
{
    public function __construct(private readonly GuestOrderPresenter $presenter) {}

    /**
     * @throws ApiException
     */
    public function __invoke(Request $request, string $order): JsonResponse
    {
        /** @var GuestSession $session */
        $session = $request->attributes->get(ResolveGuestSession::ATTRIBUTE_SESSION);

        $found = preg_match('/^[0-9a-f-]{36}$/i', $order) === 1
            ? Order::query()
                ->whereKey($order)
                ->where('customer_account_id', $session->customer_account_id)
                ->with('lines')
                ->first()
            : null;

        if (! $found instanceof Order) {
            throw new ApiException(ErrorCode::ResourceNotFound, 'No order with that identifier belongs to this session.');
        }

        return ApiResponse::data(
            ['order' => $this->presenter->order($found, $this->locale($request))],
        );
    }

    /**
     * See `GuestOrderStoreController::locale()` — the same two-value choice,
     * because the two endpoints render the same frozen snapshot.
     */
    private function locale(Request $request): string
    {
        return str_starts_with(strtolower((string) $request->header('Accept-Language')), 'ar') ? 'ar' : 'en';
    }
}
