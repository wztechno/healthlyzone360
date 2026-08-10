<?php

declare(strict_types=1);

namespace Healthy360\Verification\Mail;

use Healthy360\Verification\Messages\OtpDispatch;
use Illuminate\Mail\Mailable;
use Illuminate\Mail\Mailables\Content;
use Illuminate\Mail\Mailables\Envelope;
use Illuminate\Mail\Mailables\Headers;

/**
 * The passcode email.
 *
 * **Localised from the dispatch, not from the ambient locale.** The job runs
 * in a worker with no request behind it, so `app()->getLocale()` is whatever
 * the worker booted with. The recipient's language travelled with the payload
 * and is applied explicitly here; the text direction came from
 * `languages.direction` for the same reason a second RTL list would be a
 * second answer.
 *
 * **`X-Healthy360-Otp-Purpose` is a stable marker for acceptance tests**
 * (appendix E): a Playwright run fetching the code out of the mail log needs to
 * identify the right message without parsing prose that will be rewritten. The
 * header carries the purpose and the challenge id — never the code, which
 * would put it in a header field that mail infrastructure logs freely.
 */
final class OtpMessage extends Mailable
{
    public function __construct(public readonly OtpDispatch $dispatch)
    {
        $this->locale($dispatch->locale);
    }

    public function envelope(): Envelope
    {
        return new Envelope(
            subject: __('verification.otp.subject', ['app' => (string) config('app.name')], $this->dispatch->locale),
        );
    }

    public function headers(): Headers
    {
        $prefix = (string) config('verification.otp.message_marker', 'X-Healthy360-Otp');

        return new Headers(text: [
            $prefix.'-Purpose' => $this->dispatch->purpose->value,
            $prefix.'-Challenge' => $this->dispatch->challengeId,
        ]);
    }

    public function content(): Content
    {
        return new Content(
            view: 'verification::mail.otp',
            with: [
                'code' => $this->dispatch->code,
                'minutes' => (int) ceil($this->dispatch->expiresInSeconds / 60),
                'name' => $this->dispatch->recipientName,
                'direction' => $this->dispatch->direction,
                'locale' => $this->dispatch->locale,
            ],
        );
    }
}
