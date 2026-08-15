<?php

declare(strict_types=1);

use Healthy360\Audit\Models\AuditLog;
use Healthy360\B2b\Contracts\SellerOpenOrders;
use Healthy360\B2b\Enums\OffboardingStatus;
use Healthy360\B2b\Enums\OffboardingTrigger;
use Healthy360\B2b\Enums\SettlementStatus;
use Healthy360\B2b\Exceptions\OffboardingRefused;
use Healthy360\B2b\Services\NoSellerOpenOrders;
use Healthy360\B2b\Services\OffboardingService;
use Healthy360\B2b\Services\SettlementRegistry;
use Healthy360\B2b\Tests\Fixtures\B2bWorld;
use Healthy360\Payments\Services\PaymentsInvoicingSettlementLookup;
use Healthy360\ReferenceData\Database\Seeders\ReferenceDataSeeder;

/*
|--------------------------------------------------------------------------
| Settlement is honest about what it did not check, and a waiver is a waiver
|--------------------------------------------------------------------------
|
| The one always-on net for B2's settlement (SPEED MODE; the wider suite is on
| the deferred list in the hand-over). It pins the property the whole design
| exists for — that an offboarding built before invoicing does not ship a
| permanently-green tick — and the property that makes the escape hatch safe:
|
|  1. Checks that cannot run report `not_applicable` with a reason, never
|     `clear`. `settlement_status` still reaches `cleared`, because a gap does
|     not block a relationship that is ending — but the gap is on the record.
|  2. A real blocker holds the wind-up in `settlement_pending` and refuses
|     sign-off.
|  3. A waiver needs authorisation **and** a written reason, and is audited
|     under its own action — never `settlement_cleared`. A waiver recorded as a
|     clearance would erase the only difference a dispute turns on.
|
| INTEGRATION WAVE. `SellerOpenOrders` is now bound to the orders module's
| `BuyerOpenOrderQuery`, so the `open_orders` check is real and answers `clear`
| for an organisation with nothing in flight. The first case therefore states
| the absent deployment explicitly, by binding `NoSellerOpenOrders` back — the
| same move `ClosureBlockerHonestyTest` makes for its three ports, and for the
| same reason: an assertion about "what happens when nobody can answer" that
| relied on nobody having bound anything stops asserting it the moment somebody
| does. A fourth case pins the seam itself.
|
*/

beforeEach(function (): void {
    $this->seed(ReferenceDataSeeder::class);

    $this->world = B2bWorld::provisionedWorld();
    $this->organisation = $this->world['organisation'];
    $this->operator = B2bWorld::reviewer();
    $this->offboardings = app(OffboardingService::class);
});

it('records what it could not check instead of showing a green tick', function (): void {
    // The deployment this case is about: one where the orders module was never
    // built. Stated by binding the null default rather than by relying on
    // nobody having bound anything, which stopped being true the moment the
    // integration wave closed the seam.
    //
    // The service is re-resolved afterwards, and that is not incidental: the
    // registry is constructor-injected, so the instance `beforeEach` built is
    // still holding the *real* port and would answer for it.
    $this->app->bind(SellerOpenOrders::class, NoSellerOpenOrders::class);

    $offboardings = app(OffboardingService::class);

    $offboarding = $offboardings->start($this->organisation, OffboardingTrigger::NonRenewal, $this->operator);
    $offboarding = $offboardings->runSettlementChecks($offboarding, $this->operator);

    $outcomes = collect($offboarding->settlement_checks)->keyBy('check');

    expect($outcomes)->toHaveCount(4)
        // The three PAY1-gated checks say so, in a machine-readable way.
        ->and($outcomes['outstanding_invoices']['outcome'])->toBe('clear')
        ->and($outcomes['credit_balance']['reason'])->toBe(PaymentsInvoicingSettlementLookup::PAYMENTS_NO_INVOICE_LEDGER)
        ->and($outcomes['security_deposit']['outcome'])->toBe('clear')
        // And so does the one whose port nothing has bound. Absent must not
        // look like a pass, for orders any more than for invoices.
        ->and($outcomes['open_orders']['outcome'])->toBe('not_applicable')
        ->and($outcomes['open_orders']['reason'])->toBe(SettlementRegistry::ORDERS_ABSENT);

    // Not blocking, and on the record. Both halves matter.
    expect($offboarding->settlement_status)->toBe(SettlementStatus::Cleared)
        ->and($offboarding->status)->toBe(OffboardingStatus::AwaitingSignoff);
});

it('runs the orders check for real once the integration wave has bound it', function (): void {
    // No stub and no rebinding: whatever the service providers registered. The
    // difference from the case above is the whole point of the seam — the same
    // check, over the same organisation, reporting `clear` because something
    // actually looked rather than `not_applicable` because nothing could.
    $offboarding = $this->offboardings->start($this->organisation, OffboardingTrigger::NonRenewal, $this->operator);
    $offboarding = $this->offboardings->runSettlementChecks($offboarding, $this->operator);

    $outcomes = collect($offboarding->settlement_checks)->keyBy('check');

    expect($outcomes['open_orders']['outcome'])->toBe('clear')
        ->and($outcomes['open_orders']['reason'])->toBeNull()
        // The three PAY1-gated checks are still honest about themselves. A
        // closed seam next door must not make an open one look shut.
        ->and($outcomes['outstanding_invoices']['outcome'])->toBe('clear')
        ->and($outcomes['credit_balance']['reason'])->toBe(PaymentsInvoicingSettlementLookup::PAYMENTS_NO_INVOICE_LEDGER);
});

it('holds the wind-up when a bound port reports orders in flight, and refuses sign-off', function (): void {
    $this->app->bind(SellerOpenOrders::class, fn (): object => new class implements SellerOpenOrders
    {
        public function hasOpenOrders(string $organisationId): bool
        {
            return true;
        }

        /**
         * @return list<array{id: string, order_number: string, status: string, placed_at: string, requested_delivery_date: string|null}>
         */
        public function openOrderSummaries(string $organisationId): array
        {
            return [[
                'id' => 'order-1',
                'order_number' => 'H360-0001',
                'status' => 'confirmed',
                'placed_at' => '2026-08-01T09:00:00+00:00',
                'requested_delivery_date' => '2026-08-05',
            ]];
        }

        public function isAnswerable(): bool
        {
            return true;
        }
    });

    $offboardings = app(OffboardingService::class);

    $offboarding = $offboardings->start($this->organisation, OffboardingTrigger::Termination, $this->operator);
    $offboarding = $offboardings->runSettlementChecks($offboarding, $this->operator);

    expect($offboarding->status)->toBe(OffboardingStatus::SettlementPending)
        ->and($offboarding->settlement_status)->toBe(SettlementStatus::Pending);

    // A waiver refused for want of a reason, then for want of authorisation —
    // both before anything is written.
    expect(fn () => $offboardings->waiveSettlement($offboarding, $this->operator, '   ', static fn (): bool => true))
        ->toThrow(OffboardingRefused::class);

    expect(fn () => $offboardings->waiveSettlement($offboarding, $this->operator, 'Written off.', static fn (): bool => false))
        ->toThrow(OffboardingRefused::class);

    $offboarding->refresh();
    expect($offboarding->settlement_status)->toBe(SettlementStatus::Pending);
});

it('records a waiver as a waiver, with the person and the reason, and lets the wind-up proceed', function (): void {
    $this->app->bind(SellerOpenOrders::class, fn (): object => new class implements SellerOpenOrders
    {
        public function hasOpenOrders(string $organisationId): bool
        {
            return true;
        }

        /**
         * @return list<array{id: string, order_number: string, status: string, placed_at: string, requested_delivery_date: string|null}>
         */
        public function openOrderSummaries(string $organisationId): array
        {
            return [[
                'id' => 'order-1',
                'order_number' => 'H360-0001',
                'status' => 'confirmed',
                'placed_at' => '2026-08-01T09:00:00+00:00',
                'requested_delivery_date' => '2026-08-05',
            ]];
        }

        public function isAnswerable(): bool
        {
            return true;
        }
    });

    $offboardings = app(OffboardingService::class);

    $offboarding = $offboardings->start($this->organisation, OffboardingTrigger::ClientRequest, $this->operator);
    $offboarding = $offboardings->runSettlementChecks($offboarding, $this->operator);

    $offboarding = $offboardings->waiveSettlement(
        $offboarding,
        $this->operator,
        'The final delivery is being completed as a goodwill gesture.',
        static fn (): bool => true,
    );

    expect($offboarding->settlement_status)->toBe(SettlementStatus::Waived)
        ->and($offboarding->settlement_waived_by)->toBe((string) $this->operator->getKey())
        ->and($offboarding->settlement_waiver_reason)->toContain('goodwill')
        ->and($offboarding->status)->toBe(OffboardingStatus::AwaitingSignoff);

    $waiver = AuditLog::query()
        ->where('action', 'b2b.offboarding_settlement_waived')
        ->where('subject_id', (string) $offboarding->getKey())
        ->first();

    expect($waiver)->not->toBeNull()
        ->and($waiver->actor_user_id)->toBe((string) $this->operator->getKey())
        ->and($waiver->metadata['settlement_status'])->toBe('waived')
        // What was outstanding at the moment somebody let it go — the fact a
        // dispute turns on.
        ->and($waiver->metadata['blockers_at_waiver'])->toBe(['open_orders']);

    // And it is not filed as a clearance. The two must never be one action.
    expect(AuditLog::query()->where('action', 'b2b.offboarding_awaiting_signoff')
        ->where('subject_id', (string) $offboarding->getKey())->exists())->toBeFalse();
});
