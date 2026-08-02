<?php

declare(strict_types=1);

use Healthy360\Customers\Jobs\PurgeAbandonedProvisionalAccounts;
use Healthy360\Verification\Jobs\PurgeExpiredOtpChallenges;
use Illuminate\Support\Facades\Schedule;

/*
|--------------------------------------------------------------------------
| Scheduled tasks
|--------------------------------------------------------------------------
|
| Jobs and schedules are owned by the phase that introduces them (master plan
| v2 §7), which is why this file grows one entry at a time rather than
| arriving fully populated.
|
| `horizon:snapshot` is operational hygiene: Horizon records its queue-wait and
| throughput metrics only when it runs, so without this entry the dashboard's
| metrics pages are permanently blank and a growing wait time is invisible.
| Five minutes is Horizon's documented interval.
|
| The two J1 entries are both retention work, and both carry
| `withoutOverlapping()` and `onOneServer()` for the same pair of reasons: they
| delete in chunks, so a second concurrent run would interleave its batches
| with the first and do the same work twice; and they are cluster-wide sweeps,
| so running them on every application server would multiply that by the number
| of servers. `name()` is given explicitly because both mutex keys derive from
| it — an anonymous scheduled job shares a key with any other, which is how a
| `withoutOverlapping` that looks correct silently protects nothing.
|
*/

Schedule::command('horizon:snapshot')->everyFiveMinutes();

/*
| Hourly. Two jobs in one: close challenges whose window has passed — expiry is
| a moment rather than an event, and a `pending` row past its window keeps the
| slot the one-live-challenge index gives it — then delete what has been
| finished with for longer than the retention window. Hourly rather than daily
| because the first half is corrective: a customer who waits six minutes and
| asks for a new code should not collide with their own dead challenge.
*/
Schedule::job(new PurgeExpiredOtpChallenges)
    ->hourly()
    ->name('verification:purge-expired-otp-challenges')
    ->withoutOverlapping()
    ->onOneServer();

/*
| Daily at 03:00 UTC. An abandoned provisional account is personal data
| belonging to somebody who decided not to become a customer, and the thirty-day
| window is configuration pending the retention decision (OQ-029) — never
| presented as a settled legal period. UTC explicitly: the platform spans
| Asia/Beirut and Asia/Dubai, and a schedule that drifted with a server's local
| timezone would run at a different hour depending on where it was deployed.
*/
Schedule::job(new PurgeAbandonedProvisionalAccounts)
    ->dailyAt('03:00')
    ->timezone('UTC')
    ->name('customers:purge-abandoned-provisional-accounts')
    ->withoutOverlapping()
    ->onOneServer();
