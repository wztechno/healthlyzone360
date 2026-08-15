<?php

declare(strict_types=1);

namespace Healthy360\Customers\Guest\Http\Controllers;

use Healthy360\Customers\Guest\Http\Requests\ConfirmGuestDeletionRequest;
use Healthy360\Customers\Guest\Results\GuestPurgeReport;
use Healthy360\Customers\Guest\Services\GuestDeletionService;
use Healthy360\Identity\Enums\ContactChannel;
use Healthy360\Support\Api\ApiResponse;
use Healthy360\Support\Api\Exceptions\ApiException;
use Illuminate\Http\JsonResponse;

/**
 * POST /api/v1/guest/deletion-requests/verify — anonymous.
 *
 * The passcode comes back and, if it holds, the erasure happens.
 *
 * ## Enumeration resistance survives the second step or it was never there
 *
 * Step one told the caller nothing. If step two answered differently for "a
 * wrong code against an address we hold" and "any code against one we do not",
 * an attacker would simply skip step one's response, submit six digits and read
 * the refusal instead. So there is exactly **one** failure shape, and the list
 * it covers is the point: a wrong code, any code against an unknown address, an
 * expired challenge, and a contact point that is locked out after repeated
 * failures. The last is the least obvious and the most important — a distinct
 * "locked out" is a perfect oracle, because only a real contact point can
 * produce it. `GuestDeletionService` enforces the lockout and declines to
 * describe it; this controller does not reintroduce the distinction by mapping
 * a reason onto a status.
 *
 * Hence `202` for a refusal as well as for a purge, and hence no error envelope
 * anywhere on this path: a `422` for a bad code would be a different-shaped
 * response, and a different shape is a different answer.
 *
 * ## The success shape *is* allowed to differ
 *
 * `purged: true` and the counts appear only when the passcode verified, which
 * means the caller demonstrably received a message at that destination. They
 * have proven they hold the address; telling them what became of their own data
 * is the erasure being accountable to the person who asked for it, not a
 * disclosure to a stranger. Every path an unproven caller can reach still ends
 * at the identical `{accepted: true, purged: false}`.
 *
 * `purged` is always present, so the two refusal cases cannot be told apart by
 * key set either — an absent field is as readable as a false one.
 *
 * ## The counts, and the honest half of them
 *
 * `GuestPurgeReport` carries counts and never identities: an erasure that
 * recorded what it erased would have rebuilt in the response exactly what it
 * removed from the tables. `orders_retained` is the part that matters most —
 * a guest order is a commercial and tax record with a statutory retention of
 * its own and is deliberately **not** deleted, and saying so is what stops
 * "purged" being read as "everything is gone".
 */
final class GuestDeletionVerifyController
{
    public function __construct(private readonly GuestDeletionService $deletions) {}

    /**
     * @throws ApiException
     */
    public function __invoke(ConfirmGuestDeletionRequest $request): JsonResponse
    {
        $payload = $request->payload();

        $outcome = $this->deletions->confirm(
            channel: ContactChannel::from($payload['channel']),
            value: $payload['value'],
            code: $payload['code'],
        );

        $body = ['accepted' => true, 'purged' => $outcome->purged];

        if ($outcome->report instanceof GuestPurgeReport) {
            $body['report'] = $outcome->report->toArray();
        }

        return ApiResponse::data($body, status: 202);
    }
}
