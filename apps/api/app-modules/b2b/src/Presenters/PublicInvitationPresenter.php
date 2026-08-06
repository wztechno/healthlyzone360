<?php

declare(strict_types=1);

namespace Healthy360\B2b\Presenters;

use Healthy360\B2b\Models\OrganisationInvitation;
use Healthy360\Organisations\Models\Organisation;

/**
 * What a person holding an invitation token may be told **before** they accept.
 *
 * A separate presenter from `OrganisationInvitationPresenter`, and the split is
 * the security boundary rather than tidiness. That one serves organisation
 * members reading their own invitation list: they are already inside the
 * organisation, so the full address, the inviter, the branch and the audit
 * columns are all theirs to see. This one answers a caller whose only
 * credential is the token in a link, and every field here had to earn its
 * place against the question "what does somebody who intercepted this email
 * learn?".
 *
 * ## The address is masked here and nowhere else
 *
 * The screen has to be able to say *which* address the invitation was sent to,
 * because "you are signed in as the wrong person" is useless advice without
 * it. It must not say the whole address: the token is bearer-ish, it travels
 * in a URL, and an unauthenticated endpoint that turns a link into a working
 * email address is a harvesting endpoint.
 *
 * The mask keeps the first character of the local part and the domain in full
 * — `o•••@example.com`. The domain is the half that makes recognition possible
 * ("ah, my work address") and is the half an attacker holding the token could
 * usually guess from the organisation anyway; the local part is the half worth
 * protecting. Masking happens **server-side**, so a client cannot render what
 * it was never sent.
 *
 * ## The organisation is named, and nothing else about it is
 *
 * A person deciding whether to accept needs to know whose workspace they are
 * joining. They do not need its slug, its status, its country or its
 * identifier, and an unauthenticated endpoint that served them would be a way
 * to enumerate tenants one guessed token at a time. `Organisation` carries a
 * single `name` rather than a bilingual pair, so there is nothing to localise
 * — `language_code` is the organisation's own default, offered so a client can
 * render the name in the right script and direction.
 *
 * ## Status, restated for this audience
 *
 * The same four states `OrganisationInvitationPresenter` derives, with `live`
 * renamed `pending`: "live" is the platform's word for a row that has not
 * settled, and "pending" is what a person waiting to accept one calls it.
 * There is no separate `superseded` state because the schema has none —
 * re-inviting the same address **revokes** the outstanding offer and issues a
 * new token, so a superseded invitation is a revoked one and saying otherwise
 * would be inventing a state the row cannot be in.
 */
final class PublicInvitationPresenter
{
    /**
     * @return array{
     *     id: string,
     *     status: string,
     *     role_code: string,
     *     email_masked: string,
     *     expires_at: string,
     *     organisation: array{name: string, language_code: string}
     * }
     */
    public function invitation(OrganisationInvitation $invitation, Organisation $organisation): array
    {
        return [
            'id' => (string) $invitation->getKey(),
            'status' => $this->status($invitation),
            'role_code' => $invitation->role_code,
            'email_masked' => self::mask($invitation->email),
            'expires_at' => $invitation->expires_at->toIso8601String(),
            'organisation' => [
                'name' => $organisation->name,
                'language_code' => $organisation->default_language_code,
            ],
        ];
    }

    /**
     * `o•••@example.com`.
     *
     * The number of dots is fixed at three rather than tracking the real
     * length: a mask that grew with the address would leak how long it is,
     * which is one of the few things left to leak. A local part of one
     * character is masked to the same shape as a long one for the same reason,
     * and an address with no `@` in it — which the issuing validator makes
     * impossible, but which a presenter should not assume — is masked whole.
     */
    public static function mask(string $email): string
    {
        $address = trim($email);
        $at = mb_strrpos($address, '@');

        if ($at === false || $at === 0) {
            return '•••';
        }

        return mb_substr($address, 0, 1).'•••'.mb_substr($address, $at);
    }

    private function status(OrganisationInvitation $invitation): string
    {
        return match (true) {
            $invitation->accepted_at !== null => 'accepted',
            $invitation->revoked_at !== null => 'revoked',
            $invitation->hasExpired() => 'expired',
            default => 'pending',
        };
    }
}
