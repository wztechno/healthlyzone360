<?php

declare(strict_types=1);

namespace Healthy360\PlatformAdministration\Mail;

use Illuminate\Mail\Mailable;
use Illuminate\Mail\Mailables\Content;
use Illuminate\Mail\Mailables\Envelope;
use Illuminate\Mail\Mailables\Headers;

/**
 * "You have been made the owner of a kitchen on Healthy360."
 *
 * **The only place the plaintext token ever exists outside the request that
 * generated it.** `IssuedInvitation` hands it over once, this message renders
 * it into a link, and nothing stores it — the database has only a SHA-256 and
 * `OrganisationInvitationPresenter` has no field for it. That is what makes
 * "the platform cannot resend the original invitation" true rather than merely
 * intended.
 *
 * **Localised from the kitchen's own default language**, not the operator's
 * and not the ambient one. The person receiving this has no account yet, so
 * there is no profile to read a preference from, and the best available guess
 * is the language the kitchen they are being handed does business in.
 *
 * `X-Healthy360-Invitation` is the stable marker the passcode and closure
 * messages both carry, for the same reason: an acceptance test fetching this
 * out of Mailpit needs to identify it without parsing prose. It names the
 * role, which is a fact about a decision — never the token, which would put
 * the credential in a header field mail infrastructure logs freely.
 */
final class KitchenOwnerInvitationMessage extends Mailable
{
    /**
     * `$locale` is not promoted: `Mailable` already declares one and PHP
     * refuses to redeclare it readonly. `locale()` is its right home anyway.
     */
    public function __construct(
        public readonly string $kitchenName,
        public readonly ?string $recipientName,
        public readonly string $acceptUrl,
        public readonly ?string $message,
        string $locale,
    ) {
        $this->locale($locale);
    }

    public function envelope(): Envelope
    {
        return new Envelope(
            subject: __('invitation.owner.subject', ['kitchen' => $this->kitchenName], $this->messageLocale()),
        );
    }

    /** The language this message renders in. */
    public function messageLocale(): string
    {
        return $this->locale;
    }

    public function headers(): Headers
    {
        return new Headers(text: [
            'X-Healthy360-Invitation' => 'organisation_owner',
        ]);
    }

    public function content(): Content
    {
        $locale = $this->messageLocale();

        return new Content(
            view: 'platform-administration::mail.kitchen-owner-invitation',
            with: [
                'locale' => $locale,
                'direction' => $locale === 'ar' ? 'rtl' : 'ltr',
                'kitchen' => $this->kitchenName,
                'name' => $this->recipientName,
                'acceptUrl' => $this->acceptUrl,
                'note' => $this->message,
            ],
        );
    }
}
