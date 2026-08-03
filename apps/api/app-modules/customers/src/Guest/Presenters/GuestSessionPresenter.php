<?php

declare(strict_types=1);

namespace Healthy360\Customers\Guest\Presenters;

use Healthy360\Customers\Guest\Models\GuestSession;
use Healthy360\Customers\Guest\Results\StartedGuestSession;
use Healthy360\Customers\Models\CustomerAccount;

/**
 * What a guest is allowed to be told about themselves.
 *
 * **The plaintext token appears in exactly one shape and it is not the session
 * shape.** `started()` carries it because `POST /guest/sessions` is the one
 * moment it exists — `StartedGuestSession` holds it, the row holds only a
 * digest, and after that response nothing anywhere can produce it again.
 * `session()` deliberately has no `token` key and no method here can be made to
 * return one, so a client re-reading `GET /guest/session` cannot recover a
 * credential it lost, and a screenshot of that response is not a credential.
 * The digest is absent too: `token_hash` is `Restricted`, and publishing it
 * would let anybody holding it confirm a token they already possess, which is
 * precisely the check `resolve()` performs.
 *
 * The two fingerprints — `ip_hash`, `user_agent_hash` — are absent for a
 * different reason. They are `Confidential`, they exist for abuse
 * investigation, and echoing a person's own pseudonymised fingerprint back to
 * them tells them nothing they did not already know while making it available
 * to anybody who gets hold of the response.
 *
 * `account_number` is absent as well, and that is a judgement rather than an
 * omission: it is `Confidential`, no G1 screen needs it, and the reference a
 * guest quotes when they telephone about their food is the **order number**,
 * which is on the order shape where it belongs.
 *
 * Both timestamps are ISO 8601 rather than "seconds remaining". A countdown
 * computed on the server is stale the moment it is serialised, and a client
 * that renders one from an absolute instant gets it right even after the phone
 * has been asleep for an hour.
 */
final class GuestSessionPresenter
{
    /**
     * @return array{
     *     id: string,
     *     grade: string,
     *     contact_verified: bool,
     *     contact_verified_at: string|null,
     *     expires_at: string,
     *     last_used_at: string|null
     * }
     */
    public function session(GuestSession $session): array
    {
        return [
            'id' => (string) $session->getKey(),
            'grade' => $session->grade->value,
            // Both the fact and the moment. The boolean is what a checkout
            // screen branches on; the timestamp is what a support conversation
            // needs, and deriving one from the other in the client would put
            // the schema's own CHECK constraint into JavaScript.
            'contact_verified' => $session->hasVerifiedContact(),
            'contact_verified_at' => $session->contact_verified_at?->toIso8601String(),
            'expires_at' => $session->expires_at->toIso8601String(),
            'last_used_at' => $session->last_used_at?->toIso8601String(),
        ];
    }

    /**
     * @return array{
     *     id: string,
     *     account_type: string,
     *     status: string,
     *     origin: string,
     *     preferred_language_code: string|null,
     *     country_code: string|null,
     *     guest_expires_at: string|null,
     *     converted_at: string|null
     * }
     */
    public function account(CustomerAccount $account): array
    {
        return [
            'id' => (string) $account->getKey(),
            'account_type' => $account->account_type->value,
            'status' => $account->status->value,
            // Carried after conversion too, where it still says `guest`.
            // Origin is history: an account that arrived through the guest door
            // came from there permanently, and a surface that hid the fact once
            // the account grew up would make the conversion unobservable.
            'origin' => $account->origin->value,
            'preferred_language_code' => $account->preferred_language_code,
            'country_code' => $account->country_code,
            'guest_expires_at' => $account->guest_expires_at?->toIso8601String(),
            'converted_at' => $account->converted_at?->toIso8601String(),
        ];
    }

    /**
     * The one response that carries a credential.
     *
     * @return array{
     *     token: string,
     *     grade: string,
     *     expires_at: string,
     *     account_expires_at: string,
     *     customer_account: array{id: string, account_type: string, status: string, origin: string, preferred_language_code: string|null, country_code: string|null, guest_expires_at: string|null, converted_at: string|null}
     * }
     */
    public function started(StartedGuestSession $started): array
    {
        return [
            'token' => $started->token,
            'grade' => $started->grade->value,
            'expires_at' => $started->expiresAt->toIso8601String(),
            // The second window, and it is not the same as the first. The token
            // lapses in days; the guest *identity* behind it lives longer, so a
            // client whose token expired can be told honestly that the basket
            // is gone rather than that the person never existed.
            'account_expires_at' => $started->accountExpiresAt->toIso8601String(),
            'customer_account' => $this->account($started->account),
        ];
    }
}
