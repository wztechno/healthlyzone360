<?php

declare(strict_types=1);

namespace Healthy360\Customers\Presenters;

use Healthy360\Identity\Models\ContactPoint;

/**
 * The destinations a person has told us about.
 *
 * **The value is served in the clear, unlike everywhere else in the platform.**
 * A masked destination exists so that a challenge can name where a code went
 * without telling an unauthenticated caller whose address it is; here the
 * audience is the account holder reading their own contact list, `/api/v1/me`
 * already serves them their own email address, and a list of `a•••@example.com`
 * rows is one on which nobody can tell which number is the old one.
 *
 * `value_hash` appears nowhere and never will. It is `Restricted` because
 * publishing it would turn the duplicate-detection index into an oracle for
 * "does this address have an account here" — the exact question this platform
 * refuses to answer.
 *
 * `is_login_identity` is carried because it is the field a client needs to grey
 * out the delete button: the login mirror is what a password reset and an email
 * verification are sent to, and retiring it is refused.
 */
final class CustomerContactPresenter
{
    /**
     * @return array{
     *     id: string,
     *     channel: string,
     *     value: string,
     *     label: string|null,
     *     is_login_identity: bool,
     *     is_primary: bool,
     *     is_verified: bool,
     *     verified_at: string|null,
     *     source: string,
     *     created_at: string|null
     * }
     */
    public function contact(ContactPoint $contact): array
    {
        return [
            'id' => (string) $contact->getKey(),
            'channel' => $contact->channel->value,
            'value' => $contact->value_normalised,
            'label' => $contact->label,
            'is_login_identity' => $contact->is_login_identity,
            'is_primary' => $contact->is_primary,
            'is_verified' => $contact->isVerified(),
            'verified_at' => $contact->verified_at?->toIso8601String(),
            'source' => $contact->source,
            'created_at' => $contact->created_at?->toIso8601String(),
        ];
    }
}
