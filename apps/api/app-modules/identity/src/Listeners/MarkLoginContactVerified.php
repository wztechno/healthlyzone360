<?php

declare(strict_types=1);

namespace Healthy360\Identity\Listeners;

use App\Models\User;
use Healthy360\Identity\Models\ContactPoint;
use Illuminate\Auth\Events\Verified;

/**
 * When an email is verified, the destination it was verified at is verified
 * too.
 *
 * Two rows record one fact — `users.email_verified_at` and the login contact's
 * `verified_at` — and the whole §4.10 rule is that they may never disagree.
 * The alternative to this listener is every verification path (the signed
 * link, the OTP path, an operator action, a future magic link) remembering to
 * update both, which is the drift the rule exists to prevent.
 *
 * Deliberately not `ContactPointRegistry::markVerified()`. That method refuses
 * a value already proven on another account, which is the correct behaviour
 * when somebody *claims* a contact — but here the claim was settled at
 * registration, by `users.email`'s own unique index. Throwing at this point
 * would leave the account verified and its mirror not, which is exactly the
 * inconsistent state the listener exists to prevent. The write is therefore
 * unconditional and idempotent: replaying the event moves nothing.
 */
final class MarkLoginContactVerified
{
    public function handle(Verified $event): void
    {
        $user = $event->user;

        if (! $user instanceof User) {
            return;
        }

        ContactPoint::query()
            ->where('user_id', $user->getKey())
            ->where('is_login_identity', true)
            ->whereNull('verified_at')
            ->whereNull('retired_at')
            ->update([
                'verified_at' => $user->email_verified_at ?? now(),
                'updated_at' => now(),
            ]);
    }
}
