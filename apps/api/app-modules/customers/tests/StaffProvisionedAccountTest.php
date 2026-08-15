<?php

declare(strict_types=1);

use App\Models\User;
use Healthy360\Audit\Models\AuditLog;
use Healthy360\Customers\Enums\CustomerAccountOrigin;
use Healthy360\Customers\Enums\CustomerAccountStatus;
use Healthy360\Customers\Enums\CustomerAccountType;
use Healthy360\Customers\Jobs\PurgeAbandonedProvisionalAccounts;
use Healthy360\Customers\Models\CustomerAccount;
use Healthy360\Customers\Services\CustomerAccountLifecycle;

/*
|--------------------------------------------------------------------------
| An account somebody at a desk wrote down, and why the purge leaves it alone
|--------------------------------------------------------------------------
|
| `openStaffProvisionedAccount()` writes the one account shape nobody on the
| platform can create for themselves: a `b2c` row with **no user**, legal since
| 2026_08_16_003006 under `origin = 'staff'`. Two of its properties are only
| safe because of a job in another file, so they are pinned together here.
|
| **`provisional_expires_at` is NULL**, deliberately, because the account is not
| an abandoned sign-up — it is somebody's work and a relationship the kitchen
| intends to keep. That is safe only because
| `PurgeAbandonedProvisionalAccounts` is guarded **twice**: it filters on
| `CustomerAccountOrigin::isPurgeable()`, which excludes `staff`, *and* it
| requires a non-null deadline. Neither guard was added by this commit and
| neither is load-bearing alone — which is exactly the claim worth a test,
| because a future change that relaxed either one would silently start deleting
| a kitchen's regulars thirty days after they were written down.
|
| **The status stays `provisional`.** A cold caller satisfies none of the
| activation checklist — no verified email, no declared dietary answer — and the
| desk sells to them anyway by naming `placed_on_behalf_by`. Activating them here
| would be that bypass written once, in the wrong place, where every other
| surface would inherit it.
|
*/

it('opens a durable consumer account for somebody with no login at all', function (): void {
    $agent = User::factory()->create();

    $account = app(CustomerAccountLifecycle::class)->openStaffProvisionedAccount(
        displayName: 'Ramy Haddad',
        actorUserId: (string) $agent->getKey(),
    );

    expect($account->account_type)->toBe(CustomerAccountType::B2c)
        ->and($account->user_id)->toBeNull()
        ->and($account->organisation_id)->toBeNull()
        ->and($account->origin)->toBe(CustomerAccountOrigin::Staff)
        ->and($account->status)->toBe(CustomerAccountStatus::Provisional)
        ->and($account->provisional_expires_at)->toBeNull()
        ->and($account->display_name)->toBe('Ramy Haddad')
        // Arm (b) of the desk's scoping rule reads this column, so an account
        // opened with no actor would be invisible to the kitchen that opened it.
        ->and($account->created_by)->toBe((string) $agent->getKey())
        ->and($account->account_number)->not->toBe('');

    $audit = AuditLog::query()->where('action', 'customer.account_opened')->sole();

    expect($audit->subject_type)->toBe('customer_account')
        ->and($audit->subject_id)->toBe((string) $account->getKey())
        ->and($audit->actor_user_id)->toBe((string) $agent->getKey())
        // The same three keys `openConsumerAccount()` records, so "how did this
        // account come to exist" is one query over one action rather than a
        // union of two. The origin is what tells the two paths apart.
        ->and($audit->metadata)->toEqual([
            'account_type' => 'b2c',
            'origin' => 'staff',
            'status' => 'provisional',
        ]);
});

it('opens two accounts for two callers of the same name rather than converging', function (): void {
    // Unlike `openConsumerAccount()`, which converges on the one row the partial
    // unique index allows per user. There is no user here to converge on and no
    // index to converge against: two callers with the same name are two
    // customers, and the endpoint's mandatory `Idempotency-Key` is what stops a
    // double tap becoming two rows.
    $agent = User::factory()->create();
    $lifecycle = app(CustomerAccountLifecycle::class);

    $first = $lifecycle->openStaffProvisionedAccount('Ramy Haddad', (string) $agent->getKey());
    $second = $lifecycle->openStaffProvisionedAccount('Ramy Haddad', (string) $agent->getKey());

    expect($second->getKey())->not->toBe($first->getKey())
        ->and(CustomerAccount::query()->where('origin', CustomerAccountOrigin::Staff)->count())->toBe(2);
});

it('leaves a desk-provisioned customer alone while reaping an abandoned sign-up', function (): void {
    $agent = User::factory()->create();

    $provisioned = app(CustomerAccountLifecycle::class)
        ->openStaffProvisionedAccount('Rita Aoun', (string) $agent->getKey());

    // Aged past every window, so the only thing standing between this row and
    // deletion is the origin guard — the second of the job's two protections,
    // tested with the first one deliberately disarmed.
    $provisioned->forceFill([
        'provisional_expires_at' => now()->subDay(),
        'last_activity_at' => now()->subDays(40),
    ])->save();

    $abandoned = CustomerAccount::factory()->abandoned()->create();

    app(PurgeAbandonedProvisionalAccounts::class)->handle();

    expect(CustomerAccount::query()->whereKey($provisioned->getKey())->exists())->toBeTrue()
        ->and(CustomerAccount::query()->whereKey($abandoned->getKey())->exists())->toBeFalse();
});

it('leaves it alone on the deadline guard too, with the origin guard disarmed', function (): void {
    // The other half of the pair. A `self_service` account with a null deadline
    // is untouched, which is what makes the null column safe on its own — so a
    // future change that made `staff` purgeable would still not reap a desk
    // customer, and a change that dropped the deadline filter would still not
    // either.
    $nullDeadline = CustomerAccount::factory()->create([
        'origin' => CustomerAccountOrigin::SelfService,
        'status' => CustomerAccountStatus::Provisional,
        'provisional_expires_at' => null,
        'last_activity_at' => now()->subDays(40),
    ]);

    app(PurgeAbandonedProvisionalAccounts::class)->handle();

    expect(CustomerAccount::query()->whereKey($nullDeadline->getKey())->exists())->toBeTrue();
});
