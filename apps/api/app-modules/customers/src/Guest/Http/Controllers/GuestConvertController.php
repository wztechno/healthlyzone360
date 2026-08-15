<?php

declare(strict_types=1);

namespace Healthy360\Customers\Guest\Http\Controllers;

use App\Models\User;
use Healthy360\Customers\Guest\Http\Middleware\ResolveGuestSession;
use Healthy360\Customers\Guest\Models\GuestSession;
use Healthy360\Customers\Guest\Presenters\GuestSessionPresenter;
use Healthy360\Customers\Guest\Services\GuestSessionService;
use Healthy360\Customers\Models\CustomerAccount;
use Healthy360\Support\Api\ApiResponse;
use Healthy360\Support\Api\Exceptions\ApiException;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Laravel\Fortify\Contracts\CreatesNewUsers;

/**
 * POST /api/v1/guest/convert — `guest.session`.
 *
 * "Keep my basket, my addresses and my order history — I want an account now."
 * Registration and conversion as one act, because they are one act.
 *
 * ## Why there is no form request
 *
 * The body is the registration body, and `CreateNewUser` already validates it:
 * the unique email, the password policy from `PasswordValidationRules`, the two
 * required consents, the language and country references. Restating those rules
 * in a form request would create a second authority that disagrees with the
 * first the day either changes — and the disagreement would be silent, because
 * whichever ran first would win. Fortify's action is also the *single write
 * path* for a registration (master plan v2 §4.10: the login contact point is
 * written there and only there), so delegating validation to it is delegating
 * to the thing that will do the work anyway. Its `ValidationException` renders
 * as `422 validation.failed` through the ordinary path, identical to
 * `POST /auth/register`.
 *
 * ## Why atomicity is the whole point
 *
 * Both halves run inside one `DB::transaction`, and the failure this prevents
 * is not a tidy one. A registered user whose guest account never converted has
 * two identities on the platform — the account they just made, and an
 * orphaned guest holding their addresses, their dietary declarations and their
 * orders — with no surface anywhere that can join them, because conversion is
 * the only thing that ever could and it has already been consumed. The mirror
 * image is worse: a guest account flipped to `b2c` and pointed at a `user_id`
 * that was rolled back is a foreign key into nothing.
 *
 * Neither is a state anybody can repair. `customer_accounts` allows exactly one
 * `b2c` account per user by partial unique index, so a support engineer cannot
 * simply make the missing half; they would have to decide whose addresses win
 * and what happens to orders on both sides, which is the merge problem
 * `GuestConversionRejected::userAlreadyHasAccount()` refuses to invent an
 * answer to. So the two writes are one write, and a failure leaves a person who
 * can simply try again.
 *
 * `GuestSessionService::convert()` opens a transaction of its own and
 * `revokeAllFor()` runs outside it; wrapping the pair here pulls the revocation
 * into the same unit, which is what makes "the old token stops working exactly
 * when the account changes hands" true rather than nearly true.
 *
 * ## The token the caller used is now dead
 *
 * Conversion revokes every session the account holds. That is deliberate — the
 * person is authenticated now, and a bearer token still speaking for their
 * account would be a second, weaker credential sitting in a browser they may
 * have walked away from — and it is stated in `meta.guest_token_revoked` so a
 * client does not discover it as a `401` on its next call. The client's next
 * step is `POST /auth/login`; this endpoint deliberately issues no session,
 * because minting a credential is authentication's job and not this module's.
 */
final class GuestConvertController
{
    public function __construct(
        private readonly CreatesNewUsers $users,
        private readonly GuestSessionService $sessions,
        private readonly GuestSessionPresenter $presenter,
    ) {}

    /**
     * @throws ApiException
     */
    public function __invoke(Request $request): JsonResponse
    {
        /** @var GuestSession $session */
        $session = $request->attributes->get(ResolveGuestSession::ATTRIBUTE_SESSION);

        // Handed on unshaped: the registration body is Fortify's contract, and
        // a controller that picked fields out of it would silently drop the
        // next one added to `CreateNewUser`.
        /** @var array<string, string> $input */
        $input = $request->all();

        $converted = DB::transaction(function () use ($input, $session): CustomerAccount {
            /** @var User $user */
            $user = $this->users->create($input);

            return $this->sessions->convert($session->customerAccount, $user);
        });

        return ApiResponse::data(
            ['customer_account' => $this->presenter->account($converted)],
            ['guest_token_revoked' => true],
            status: 201,
        );
    }
}
