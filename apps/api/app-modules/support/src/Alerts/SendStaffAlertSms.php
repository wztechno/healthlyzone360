<?php

declare(strict_types=1);

namespace Healthy360\Support\Alerts;

use App\Models\User;
use Healthy360\Identity\Enums\ContactChannel;
use Healthy360\Identity\Models\ContactPoint;
use Healthy360\Identity\Services\ContactPointRegistry;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Queue\Queueable;

/**
 * An escalation's SMS, off the request so a slow Twilio cannot hold up whoever
 * caused it.
 *
 * The job carries the user, not the number, and looks the number up when it runs,
 * so no phone number sits in the queue or on Horizon's failed-job screen. A
 * recipient with no phone contact gets the bell and email only.
 *
 * Twilio being briefly down throws out of `attempt()` and comes back through
 * `tries` and `backoff`, over about five minutes. An escalation is the one text
 * that must not be lost to a blip. The cost is a rare double text, when a timeout
 * hid a message that did go, and a manager can live with that.
 */
final class SendStaffAlertSms implements ShouldQueue
{
    use Queueable;

    public int $tries = 4;

    /** @var list<int> */
    public array $backoff = [30, 90, 180];

    public function __construct(public string $userId, public string $body) {}

    public function handle(ContactPointRegistry $contacts, TwilioSms $sms): void
    {
        $user = User::query()->find($this->userId);

        if (! $user instanceof User) {
            return;
        }

        $phones = collect($contacts->forUser($user, ContactChannel::Phone));
        $phone = $phones->firstWhere('is_primary', true) ?? $phones->first();

        if ($phone instanceof ContactPoint) {
            $sms->attempt($phone->value_normalised, $this->body);
        }
    }
}
