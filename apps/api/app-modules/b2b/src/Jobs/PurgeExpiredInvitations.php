<?php

declare(strict_types=1);

namespace Healthy360\B2b\Jobs;

use Healthy360\B2b\Services\InvitationService;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Queue\Queueable;
use Illuminate\Support\Facades\Log;

/**
 * Remove invitations that expired and were never used.
 *
 * An unexpired invitation is a credential; an expired one is an email address
 * held for no remaining purpose. **Accepted and revoked rows survive** — those
 * are the trail of who was let into an organisation and who was turned away,
 * and deleting them would erase the answer to "how did this person get
 * access?".
 *
 * The thirty-day grace is not caution about the token, which stopped working
 * the moment it expired. It is so that "we sent it, it lapsed" is still
 * answerable for a month when somebody asks why their colleague never got in.
 *
 * Daily, `withoutOverlapping()` and `onOneServer()` on the schedule entry.
 */
final class PurgeExpiredInvitations implements ShouldQueue
{
    use Queueable;

    /** Days after expiry before the row itself goes. */
    public const int GRACE_DAYS = 30;

    public function __construct()
    {
        $this->onQueue('maintenance');
    }

    public function handle(InvitationService $invitations): void
    {
        $purged = $invitations->purgeExpired(self::GRACE_DAYS);

        if ($purged === 0) {
            return;
        }

        Log::info('Purged expired organisation invitations.', ['purged' => $purged]);
    }
}
