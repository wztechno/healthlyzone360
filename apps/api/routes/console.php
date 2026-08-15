<?php

declare(strict_types=1);

use Healthy360\B2b\Jobs\ExpireQuotations;
use Healthy360\B2b\Jobs\PurgeExpiredInvitations;
use Healthy360\B2b\Jobs\PurgeExpiredKycDocuments;
use Healthy360\B2b\Jobs\PurgeExpiredRecordExports;
use Healthy360\Cart\Jobs\ExpireStaleCarts;
use Healthy360\Customers\Closure\Jobs\ProcessScheduledClosures;
use Healthy360\Customers\Guest\Jobs\ExpireGuestData;
use Healthy360\Customers\Guest\Jobs\PurgeExpiredGuestSessions;
use Healthy360\Customers\Jobs\PurgeAbandonedProvisionalAccounts;
use Healthy360\Subscriptions\Jobs\GenerateSubscriptionDeliveries;
use Healthy360\Support\Http\Middleware\EnforceIdempotency;
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

/*
| B1 — two retention sweeps for the B2B onboarding data.
|
| Weekly at 04:15 UTC on Sunday. KYC retention is measured in years
| (`b2b.kyc.retention_days`, a placeholder pending OQ-029, never a legal
| period), so nothing here is urgent and a daily run would mostly find nothing.
| Sunday early morning because the job deletes objects from the private bucket
| one at a time and the bucket is quietest then. Offset from the 03:00 customer
| sweep rather than sharing the hour: two cluster-wide deletion passes running
| together make a slow bucket look like a broken one.
*/
Schedule::job(new PurgeExpiredKycDocuments)
    ->weeklyOn(0, '04:15')
    ->timezone('UTC')
    ->name('b2b:purge-expired-kyc-documents')
    ->withoutOverlapping()
    ->onOneServer();

/*
| B1 — daily at 04:45 UTC. An expired, never-accepted invitation is an email
| address held for no remaining purpose; accepted and revoked rows survive
| because they are the trail of who was let into an organisation. The thirty-day
| grace is so "we sent it and it lapsed" stays answerable for a month, not
| caution about the token, which stopped working when it expired.
*/
Schedule::job(new PurgeExpiredInvitations)
    ->dailyAt('04:45')
    ->timezone('UTC')
    ->name('b2b:purge-expired-invitations')
    ->withoutOverlapping()
    ->onOneServer();

// G1 — the guest retention pair. Appended at the tail so parallel phases can
// each add their own entries without touching one another's.

/*
| G1 — hourly. Guest tokens are minted per anonymous visitor, so this table
| grows faster than anything else in the customers module. The job is hygiene
| rather than security: a token stops working the moment it expires or is
| revoked, because GuestSession::isLive() asks the clock and not this sweep.
| The short grace before a dead row is removed (guest.retention.session_rows_hours)
| exists so an abuse report arriving the next morning can still tell a revoked
| session from a lapsed one.
*/
Schedule::job(new PurgeExpiredGuestSessions)
    ->hourly()
    ->name('customers:purge-expired-guest-sessions')
    ->withoutOverlapping()
    ->onOneServer();

/*
| G1 — daily at 03:30 UTC. Two passes in one job: close guest accounts whose
| 14-day window has passed, then erase the personal data of those closed longer
| than the 90-day retention window. Both numbers are configuration and both are
| PROVISIONAL pending OQ-030 — never presented as a settled legal period.
|
| Offset from the 03:00 abandonment sweep rather than sharing the hour: two
| cluster-wide deletion passes running together make a slow database look like a
| broken one. UTC explicitly, for the same reason the 03:00 entry gives — the
| platform spans Asia/Beirut and Asia/Dubai, and a schedule drifting with a
| server's local timezone would run at a different hour depending on where it
| was deployed.
*/
Schedule::job(new ExpireGuestData)
    ->dailyAt('03:30')
    ->timezone('UTC')
    ->name('customers:expire-guest-data')
    ->withoutOverlapping()
    ->onOneServer();

/*
| C1 — daily at 05:15 UTC. Not retention, and the odd one out on this list:
| an expired basket is *kept*. All this does is close it, so the customer's
| one-open-cart slot on that channel is free the next time they shop. The lines
| stay, because an abandoned basket is the record of what somebody nearly
| ordered — and because `cart_items` restricts deletion of the articles it
| points at, which would be pointless if the baskets themselves evaporated.
|
| Offset again rather than sharing an hour with the sweeps above, for the same
| reason those are offset from each other. Daily is generous for work whose only
| urgency is tidiness, and the window is `cart.expiry.ttl_minutes` — every
| basket mutation pushes it out, so this only ever finds baskets nobody has
| touched.
*/
Schedule::job(new ExpireStaleCarts)
    ->dailyAt('05:15')
    ->timezone('UTC')
    ->name('cart:expire-stale-carts')
    ->withoutOverlapping()
    ->onOneServer();

/*
| The integration wave — daily at 05:30 UTC. Idempotency keys expire after
| twenty-four hours; this removes the rows that have.
|
| Deliberately **not** done on the request path. A client retrying a checkout is
| the last caller who should be made to wait while the platform tidies up after
| everybody else, and a sweep that ran per request would do the same work
| thousands of times a day to no better effect.
|
| A closure rather than a job, because there is nothing to queue: one DELETE
| against one index. `EnforceIdempotency::purgeExpired()` is where the window is
| defined, so the schedule cannot drift from the middleware that wrote the rows.
*/
Schedule::call(static fn (): int => EnforceIdempotency::purgeExpired())
    ->dailyAt('05:30')
    ->timezone('UTC')
    ->name('support:purge-idempotency-keys')
    ->withoutOverlapping()
    ->onOneServer();

// B2

/*
| B2 — daily at 05:45 UTC. A records export is the most concentrated
| collection of one company's data the platform ever produces, and a copy of it
| sitting in a bucket after its download window has closed is a liability the
| reason for making it does not justify.
|
| Daily rather than the weekly cadence the KYC sweep uses, because the two
| windows are different orders of magnitude: KYC retention is measured in years
| and nothing is urgent, whereas an export expires in days and one that lapsed
| on Tuesday must not still be downloadable on Friday.
|
| The row survives its object. `expired` is a state the purge writes and the
| manifest stays behind, so "what did we hand this company, and when" remains
| answerable after the bytes are gone.
|
| Offset again rather than sharing an hour with the sweeps above, and carrying
| `withoutOverlapping()` and `onOneServer()` for the reasons every entry on
| this list carries them.
*/
Schedule::job(new PurgeExpiredRecordExports)
    ->dailyAt('05:45')
    ->timezone('UTC')
    ->name('b2b:purge-expired-record-exports')
    ->withoutOverlapping()
    ->onOneServer();

/*
| B5 — daily at 06:00 UTC. A quotation left `quoted` for seven days without a
| decision closes itself; the buyer's silence is treated as a decision not to
| act, the same way an unattended cart or an unclaimed offboarding does.
|
| `QuotationService::accept()`/`decline()` also refuse a decision on a
| quotation whose `expires_at` has already passed, so a buyer cannot beat the
| sweep to it — only the order in which the two learn about the deadline
| differs.
|
| Offset again rather than sharing an hour with the sweeps above, and
| carrying `withoutOverlapping()` and `onOneServer()` for the reason every
| entry on this list carries them.
*/
Schedule::job(new ExpireQuotations)
    ->dailyAt('06:00')
    ->timezone('UTC')
    ->name('b2b:expire-quotations')
    ->withoutOverlapping()
    ->onOneServer();

// S1 — the subscription generation tick. Appended at the tail so parallel
// phases can each add their own entries without touching one another's.

/*
| S1 — hourly, on the hour. The one scheduled entry on this list that *creates*
| something rather than tidying up: it turns each subscription delivery whose
| change window has just closed into a real order.
|
| Hourly rather than daily because the boundary is a per-plan, per-branch,
| per-timezone instant — 24 hours before a Beirut Tuesday is not the same clock
| reading as 24 hours before a Dubai one, and a kitchen may configure 36 hours
| instead of 24. A daily sweep would either generate orders up to 23 hours
| early, which is exactly the pre-creation the incremental design forbids
| (semantics §4), or up to 23 hours late, by which time the kitchen has planned
| its production without them. Hourly bounds the error at an hour, and only in
| the late direction.
|
| No timezone is set, deliberately: unlike the retention sweeps above there is
| no hour of the day this should prefer, and the job's own comparisons are all
| made in the branch's timezone rather than the scheduler's.
|
| `withoutOverlapping()` and `onOneServer()` for the reasons the J1 entries
| give, and one more specific to this job: it places orders, and two concurrent
| ticks racing for the same delivery day would both be refused by the
| `subscription_deliveries` unique index — correct, but a refusal is a worse
| way to discover a scheduling mistake than never making it. `name()` is
| explicit because both mutex keys derive from it.
*/
Schedule::job(new GenerateSubscriptionDeliveries)
    ->hourly()
    ->name('subscriptions:generate-deliveries')
    ->withoutOverlapping()
    ->onOneServer();

/*
| J2 — daily at 06:15 UTC. The safety net under the closure grace window.
|
| Every verified closure already dispatches its own delayed
| `FinaliseAccountClosure`, so on a healthy day this sweep finds nothing. It
| exists for the days that are not healthy: a queue flushed during a deploy, a
| Redis restart, a worker that died holding a reserved job. A dropped delayed
| job is the one failure in this module that looks exactly like success — the
| customer was told their account would close, the request row says
| `scheduled`, and nothing ever runs. A daily pass turns that into a one-day
| delay instead of a promise silently broken.
|
| 06:15 UTC, offset from every sweep above rather than sharing an hour, for the
| same reason those are offset from each other. UTC explicitly: the platform
| spans Asia/Beirut and Asia/Dubai, and a schedule drifting with a server's
| local timezone would run at a different hour depending on where it was
| deployed. `withoutOverlapping()` and `onOneServer()` because it is a
| cluster-wide sweep that dispatches work, and `name()` explicitly because both
| mutex keys derive from it.
*/
Schedule::job(new ProcessScheduledClosures)
    ->dailyAt('06:15')
    ->timezone('UTC')
    ->name('customers:process-scheduled-closures')
    ->withoutOverlapping()
    ->onOneServer();
