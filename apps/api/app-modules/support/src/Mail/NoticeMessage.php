<?php

declare(strict_types=1);

namespace Healthy360\Support\Mail;

use Illuminate\Bus\Queueable;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Mail\Mailable;
use Illuminate\Mail\Mailables\Content;
use Illuminate\Mail\Mailables\Envelope;
use Illuminate\Mail\Mailables\Headers;
use Illuminate\Queue\SerializesModels;

/**
 * A short operational notice — a quotation arrived, was priced, accepted or
 * declined; the weekly stock check found something short (2026-10-21).
 *
 * One plain template for all of them, already worded by the caller in the
 * recipient's language: a heading, a few lines, and one link to the screen
 * where the thing can be acted on. Queued and sent after the transaction that
 * caused it commits, so a refused or rolled-back change never mails anybody.
 */
final class NoticeMessage extends Mailable implements ShouldQueue
{
    use Queueable;
    use SerializesModels;

    /**
     * @param  list<string>  $lines
     */
    public function __construct(
        public readonly string $kind,
        public readonly string $heading,
        public readonly array $lines,
        public readonly ?string $actionLabel,
        public readonly ?string $actionUrl,
        string $locale,
    ) {
        $this->locale($locale);
        $this->afterCommit();
    }

    public function envelope(): Envelope
    {
        return new Envelope(subject: $this->heading);
    }

    public function headers(): Headers
    {
        return new Headers(text: ['X-Healthy360-Notice' => $this->kind]);
    }

    public function content(): Content
    {
        return new Content(
            view: 'support::mail.notice',
            with: [
                'locale' => $this->locale,
                'direction' => $this->locale === 'ar' ? 'rtl' : 'ltr',
                'heading' => $this->heading,
                'lines' => $this->lines,
                'actionLabel' => $this->actionLabel,
                'actionUrl' => $this->actionUrl,
            ],
        );
    }
}
