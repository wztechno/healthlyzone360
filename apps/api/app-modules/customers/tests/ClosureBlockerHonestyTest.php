<?php

declare(strict_types=1);

use App\Models\User;
use Healthy360\Customers\Closure\Contracts\B2bSignatoryPresence;
use Healthy360\Customers\Closure\Contracts\SubscriptionPresence;
use Healthy360\Customers\Closure\Enums\BlockerStatus;
use Healthy360\Customers\Closure\Services\ClosureBlockerRegistry;
use Healthy360\Customers\Models\CustomerAccount;
use Healthy360\Organisations\Enums\MembershipStatus;
use Healthy360\Organisations\Models\Organisation;
use Healthy360\Organisations\Models\OrganisationMembership;

/*
|--------------------------------------------------------------------------
| A blocker that did not look must not say "clear"
|--------------------------------------------------------------------------
|
| This is the one property the whole registry exists for, and it is the one
| that decays silently. Every individual piece stays correct while the meaning
| rots: a port loses its binding, a null default answers zero, a blocker
| returns "nothing found", and a closure screen tells somebody their standing
| plans have been checked when nothing looked. Nobody sees it, because the
| screen looks exactly the same as a real all-clear.
|
| So the smoke asserts the distinction directly, in both directions at once:
|
|   * a blocker over an unbound port answers `not_applicable` with a reason
|     naming what is missing — never `clear`, and never with a count that
|     could be mistaken for a finding;
|   * the same blocker, over a bound port, answers `blocking` with a real
|     count, which is what proves the `not_applicable` was a statement about
|     the deployment and not about the customer;
|   * a real blocker with no port at all — memberships — answers `blocking`
|     against actual rows, so at least one thing in this registry is provably
|     not a stub;
|   * a `not_applicable` never stops a closure, and a `blocking` always does.
|
| The membership case carries a second assertion worth its line: the query runs
| with no ambient organisation, exactly as a queue worker does. That is the
| condition under which a fail-closed tenancy scope returns zero rows and this
| blocker reports `clear` for somebody who works in four kitchens — a false
| negative arriving through a correct-looking query.
|
| SPEED MODE: one of the three kept smokes. See DEFERRED TESTS in the J2 report.
|
*/

/*
| No seeders. Nothing in this file reads reference data, and the factories mint
| their own — seeding first would only give `Organisation::factory()`'s country
| a chance to collide with a code the gazetteer already holds.
*/

it('reports not_applicable with a reason where a module is absent, and never clear', function (): void {
    $user = User::factory()->create();
    $account = CustomerAccount::factory()->active()->create(['user_id' => $user->getKey()]);

    $verdicts = collect(app(ClosureBlockerRegistry::class)->evaluate($user, $account))
        ->keyBy(fn ($verdict) => $verdict->code);

    // The two ports whose modules land in this same wave. Until integrator-2
    // binds the adapters, the null defaults answer "we did not look" — and the
    // reason names what is missing, so a reader after the wave can tell the
    // answer is stale rather than reassuring.
    expect($verdicts['active_subscriptions']->status)->toBe(BlockerStatus::NotApplicable)
        ->and($verdicts['active_subscriptions']->reason)->toBe('subscriptions_module_absent')
        ->and($verdicts['pending_b2b_signatures']->status)->toBe(BlockerStatus::NotApplicable)
        ->and($verdicts['pending_b2b_signatures']->reason)->toBe('b2b_module_absent');

    // The two that have no module to wait for.
    expect($verdicts['wallet_balance']->status)->toBe(BlockerStatus::NotApplicable)
        ->and($verdicts['wallet_balance']->reason)->toBe('no_wallet_module')
        ->and($verdicts['payment_methods']->status)->toBe(BlockerStatus::NotApplicable)
        ->and($verdicts['payment_methods']->reason)->toBe('no_payment_module');

    // Every not_applicable carries a reason and no count. A count here would
    // read as a finding.
    foreach ($verdicts as $verdict) {
        if ($verdict->status === BlockerStatus::NotApplicable) {
            expect($verdict->reason)->not->toBeNull()
                ->and($verdict->count)->toBe(0)
                ->and($verdict->stopsClosure())->toBeFalse();
        }
    }

    // And nothing in that set is a `clear`, which is the assertion the whole
    // file exists to make: an unchecked question is never reported as a
    // checked one.
    expect($verdicts['active_subscriptions']->status)->not->toBe(BlockerStatus::Clear)
        ->and($verdicts['pending_b2b_signatures']->status)->not->toBe(BlockerStatus::Clear);
});

it('becomes real the moment a port is bound', function (): void {
    $user = User::factory()->create();
    $account = CustomerAccount::factory()->active()->create(['user_id' => $user->getKey()]);

    // The adapter integrator-2 writes, stood up inline. Three delegating
    // methods and a `return true` is the whole of the seam, which is the point
    // being asserted: the blocker does not change, the answer does.
    app()->instance(SubscriptionPresence::class, new class implements SubscriptionPresence
    {
        public function isAvailable(): bool
        {
            return true;
        }

        public function activeSubscriptionCount(string $customerAccountId): int
        {
            return 2;
        }

        public function hasUpcomingDeliveries(string $customerAccountId): bool
        {
            return true;
        }
    });

    app()->instance(B2bSignatoryPresence::class, new class implements B2bSignatoryPresence
    {
        public function isAvailable(): bool
        {
            return true;
        }

        public function pendingSignatureCount(string $userId): int
        {
            return 0;
        }
    });

    app()->forgetInstance(ClosureBlockerRegistry::class);

    $verdicts = collect(app(ClosureBlockerRegistry::class)->evaluate($user, $account))
        ->keyBy(fn ($verdict) => $verdict->code);

    expect($verdicts['active_subscriptions']->status)->toBe(BlockerStatus::Blocking)
        ->and($verdicts['active_subscriptions']->count)->toBe(2)
        ->and($verdicts['active_subscriptions']->reason)->toBe('subscriptions_live')
        ->and($verdicts['active_subscriptions']->stopsClosure())->toBeTrue();

    // Bound, asked, and genuinely nothing there — the answer `not_applicable`
    // was never allowed to stand in for.
    expect($verdicts['pending_b2b_signatures']->status)->toBe(BlockerStatus::Clear)
        ->and($verdicts['pending_b2b_signatures']->reason)->toBeNull();
});

it('blocks on real membership rows with no ambient organisation resolved', function (): void {
    $user = User::factory()->create();
    $organisation = Organisation::factory()->create();

    OrganisationMembership::factory()->create([
        'organisation_id' => $organisation->getKey(),
        'user_id' => $user->getKey(),
        'status' => MembershipStatus::Active,
    ]);

    // No tenant context is established anywhere in this test, which is exactly
    // the condition a queue worker runs under. A fail-closed org scope would
    // return zero rows here and this blocker would report `clear`.
    $verdicts = collect(app(ClosureBlockerRegistry::class)->evaluate($user, null))
        ->keyBy(fn ($verdict) => $verdict->code);

    expect($verdicts['organisation_memberships']->status)->toBe(BlockerStatus::Blocking)
        ->and($verdicts['organisation_memberships']->count)->toBe(1)
        ->and($verdicts['organisation_memberships']->reason)->toBe('memberships_live')
        ->and(app(ClosureBlockerRegistry::class)->isBlocked($verdicts->values()->all()))->toBeTrue();
});
