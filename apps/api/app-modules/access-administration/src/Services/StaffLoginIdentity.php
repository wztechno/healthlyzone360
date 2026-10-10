<?php

declare(strict_types=1);

namespace Healthy360\AccessAdministration\Services;

use App\Models\User;
use Healthy360\Organisations\Models\Organisation;
use Healthy360\Support\Api\ErrorCode;
use Healthy360\Support\Api\Exceptions\ApiException;

/**
 * The address a member of staff signs in with, composed from what they type
 * and what their kitchen supplies.
 *
 * ## The problem, and the shape of the answer
 *
 * A kitchen hand does not have a work email address. The person washing
 * vegetables at six in the morning has a phone and a first name, and being
 * asked to remember `ahmad.khalil@verdant-kitchen.example` before they can
 * clock in is being asked not to use the system.
 *
 * The obvious fix — a `username` column and a login that accepts either — is
 * the wrong one. Fortify authenticates on `users.email`; so does
 * `AttemptToAuthenticate`, so does `POST /auth/token`, so does password reset,
 * so does an invitation's own address match. A second identifier grows a branch
 * in every one of those, and an identity system with two ways to name the same
 * person has two ways to get it wrong.
 *
 * So the address stays an address and the *client* stops making the person type
 * all of it. The kitchen's `staff_email_domain` holds the right-hand side; the
 * sign-in screen renders a local-part field beside a picker that supplies it;
 * and what reaches the server is an ordinary email address that nothing in the
 * authentication pipeline has to know anything about.
 *
 * This class is where that composition lives, so both callers — the create
 * form and anything that follows it — agree on exactly one rule for turning
 * `ahmad.khalil` plus a kitchen into an address.
 *
 * ## It never guesses
 *
 * A kitchen with no `staff_email_domain` cannot compose anything, and this
 * refuses rather than inventing a domain from the slug. A generated address
 * that nobody chose is an address nobody can be told, and the first person to
 * discover it would be somebody locked out of their own account.
 */
final readonly class StaffLoginIdentity
{
    /**
     * The address a staff account will carry.
     *
     * A caller may supply a full address (`email`), or a local part
     * (`local_part`) to be composed against the organisation's staff domain.
     * Exactly one, and the request layer enforces that; this refuses the second
     * form when the organisation has no domain to compose against.
     *
     * @throws ApiException
     */
    public function compose(Organisation $organisation, ?string $email, ?string $localPart): string
    {
        if ($email !== null) {
            return $this->normalise($email);
        }

        $domain = $organisation->staff_email_domain;

        if ($domain === null || $domain === '') {
            throw new ApiException(
                ErrorCode::ValidationFailed,
                'This organisation has no staff sign-in domain, so a full email address is required.',
                ['fields' => ['email' => ['This organisation has no staff sign-in domain, so a full email address is required.']]],
            );
        }

        return $this->normalise(((string) $localPart).'@'.$domain);
    }

    /**
     * Whether an address is already somebody's.
     *
     * A 422 naming the field rather than a 409, because the caller is filling
     * in a form and the remedy is a different local part — and because the
     * console is an authenticated surface inside one organisation, so
     * confirming that this address is taken tells the administrator something
     * they are entitled to know. (The anonymous surfaces deliberately do the
     * opposite: registration will not confirm that an address exists.)
     *
     * @throws ApiException
     */
    public function assertAvailable(string $email): void
    {
        if (User::query()->where('email', $email)->exists()) {
            throw new ApiException(
                ErrorCode::ValidationFailed,
                'Somebody already signs in with that address.',
                ['fields' => ['email' => ['Somebody already signs in with that address.']]],
            );
        }
    }

    /**
     * Lowercased and trimmed — the form `users.email` is compared in, and the
     * form `contact_points.value_normalised` stores.
     */
    private function normalise(string $email): string
    {
        return mb_strtolower(trim($email));
    }
}
