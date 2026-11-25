<?php

declare(strict_types=1);

namespace Healthy360\B2b\Mail;

use Illuminate\Mail\Mailable;
use Illuminate\Mail\Mailables\Content;
use Illuminate\Mail\Mailables\Envelope;
use Illuminate\Mail\Mailables\Headers;

/**
 * "You have been invited to work at a kitchen on Healthy360."
 *
 * The message an organisation's own administrator sends from Add user. It is
 * the twin of the platform's `KitchenOwnerInvitationMessage` and exists for
 * the same reason: `IssuedInvitation` hands the plaintext token over once, and
 * an invitation whose token reaches nobody is an offer nobody can take up.
 *
 * **Localised from the organisation's default language.** The recipient may
 * have no account yet, so there is no profile to read a preference from.
 *
 * `X-Healthy360-Invitation` carries the role code — a fact about a decision —
 * and never the token, which mail infrastructure would log freely.
 */
final class OrganisationInvitationMessage extends Mailable
{
    /**
     * `$locale` is not promoted: `Mailable` already declares one and PHP
     * refuses to redeclare it readonly.
     */
    public function __construct(
        public readonly string $organisationName,
        public readonly string $roleCode,
        public readonly string $roleName,
        public readonly string $acceptUrl,
        public readonly ?string $message,
        string $locale,
    ) {
        $this->locale($locale);
    }

    public function envelope(): Envelope
    {
        return new Envelope(
            subject: __('invitation.member.subject', ['organisation' => $this->organisationName], $this->messageLocale()),
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
            'X-Healthy360-Invitation' => $this->roleCode,
        ]);
    }

    public function content(): Content
    {
        $locale = $this->messageLocale();

        return new Content(
            view: 'b2b::mail.organisation-invitation',
            with: [
                'locale' => $locale,
                'direction' => $locale === 'ar' ? 'rtl' : 'ltr',
                'organisation' => $this->organisationName,
                'role' => $this->roleName,
                'acceptUrl' => $this->acceptUrl,
                'note' => $this->message,
            ],
        );
    }
}
