<?php

declare(strict_types=1);

namespace Healthy360\Customers\Closure\Mail;

use Illuminate\Mail\Mailable;
use Illuminate\Mail\Mailables\Content;
use Illuminate\Mail\Mailables\Envelope;
use Illuminate\Mail\Mailables\Headers;

/**
 * The closure confirmation.
 *
 * **Localised from the payload, not from the ambient locale**, for the reason
 * `OtpMessage` gives and one stronger: the worker has no request behind it, and
 * by the time this renders the profile that held the recipient's language has
 * been redacted. The language was read before the erasure and travelled here.
 *
 * **Nothing that identifies the recipient reaches the template.** No name, no
 * account number, no order numbers — only a count. The address is on the
 * envelope because a message has to go somewhere, and that is the last place it
 * exists.
 *
 * `X-Healthy360-Closure` is the same kind of stable marker the passcode message
 * carries: an acceptance test fetching this out of Mailpit needs to identify it
 * without parsing prose that will be rewritten. It carries the reason code,
 * which is a fact about a decision, and nothing about a person.
 */
final class AccountClosedMessage extends Mailable
{
    /**
     * `$locale` is not promoted: `Mailable` already declares a `$locale`
     * property and PHP refuses to redeclare it as readonly. Handing it to the
     * framework's own `locale()` is the right home for it anyway — the parent
     * is what applies it at render time — and `messageLocale()` below reads it
     * back so the two can never disagree.
     */
    public function __construct(
        public readonly string $reason,
        string $locale,
        public readonly int $ordersRetained,
    ) {
        $this->locale($locale);
    }

    public function envelope(): Envelope
    {
        return new Envelope(
            subject: __('closure.closed.subject', ['app' => (string) config('app.name')], $this->messageLocale()),
        );
    }

    /**
     * The language this message renders in.
     */
    public function messageLocale(): string
    {
        return $this->locale;
    }

    public function headers(): Headers
    {
        return new Headers(text: [
            'X-Healthy360-Closure' => $this->reason,
        ]);
    }

    public function content(): Content
    {
        return new Content(
            view: 'customers::mail.account-closed',
            with: [
                'locale' => $this->messageLocale(),
                'direction' => $this->messageLocale() === 'ar' ? 'rtl' : 'ltr',
                'ordersRetained' => $this->ordersRetained,
            ],
        );
    }
}
