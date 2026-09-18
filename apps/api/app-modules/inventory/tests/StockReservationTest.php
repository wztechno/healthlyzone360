<?php

declare(strict_types=1);

use Healthy360\AccessControl\Database\Seeders\AccessControlSeeder;
use Healthy360\Inventory\Enums\ReservationStatus;
use Healthy360\Inventory\Exceptions\InsufficientStock;
use Healthy360\Inventory\Models\StockItem;
use Healthy360\Inventory\Models\StockLevel;
use Healthy360\Inventory\Models\StockMovement;
use Healthy360\Inventory\Models\StockReservation;
use Healthy360\Inventory\Services\InventoryService;
use Healthy360\Inventory\Services\ReservationService;
use Healthy360\Organisations\Database\Seeders\OrganisationTypeSeeder;
use Healthy360\Organisations\Models\OrganisationBranch;
use Healthy360\Pricing\Tests\Fixtures\PricingWorld;
use Healthy360\ReferenceData\Database\Seeders\ReferenceDataSeeder;
use Healthy360\Support\Api\ErrorCode;
use Healthy360\Tenancy\TenantContext;
use Illuminate\Database\QueryException;

/**
 * `holder_id` is a real uuid column — the order this claim belongs to — so the
 * fixtures name two of them rather than two readable strings.
 */
const BATCH_ONE = '01a0b000-0000-7000-8000-00000000ba71';
const BATCH_TWO = '01a0b000-0000-7000-8000-00000000ba72';

/*
|--------------------------------------------------------------------------
| Reservations — what is on the shelf against what is free (PROD1)
|--------------------------------------------------------------------------
|
| On-hand stopped being the useful question the moment a batch could be
| committed to in advance. These tests hold the line that a sale takes what is
| free, a batch takes what it claimed, and a physical correction is never
| refused for being inconvenient.
|
*/

beforeEach(function (): void {
    $this->seed([ReferenceDataSeeder::class, OrganisationTypeSeeder::class, AccessControlSeeder::class]);

    $this->tenant = PricingWorld::kitchen('reservations@kitchen.test');
    $this->organisation = $this->tenant->organisation;
    $this->branch = OrganisationBranch::factory()->create([
        'organisation_id' => $this->organisation->getKey(),
        'country_code' => $this->organisation->country_code,
    ]);

    app(TenantContext::class)->setOrganisation(
        (string) $this->tenant->user->getKey(),
        (string) $this->organisation->getKey(),
    );

    $this->inventory = app(InventoryService::class);
    $this->reservations = app(ReservationService::class);

    $this->item = StockItem::query()->create([
        'organisation_id' => $this->organisation->getKey(),
        'code' => 'oil-01',
        'name_en' => 'Rapeseed oil',
        'unit_code' => 'l',
    ]);

    $this->second = StockItem::query()->create([
        'organisation_id' => $this->organisation->getKey(),
        'code' => 'lemon-01',
        'name_en' => 'Lemon juice',
        'unit_code' => 'l',
    ]);

    $this->organisationId = (string) $this->organisation->getKey();
    $this->branchId = (string) $this->branch->getKey();
    $this->itemId = (string) $this->item->getKey();
    $this->secondId = (string) $this->second->getKey();

    $this->receive = function (string $quantity, ?string $stockItemId = null) {
        return $this->inventory->recordMovement(
            $this->organisationId,
            $this->branchId,
            $stockItemId ?? $this->itemId,
            'receipt',
            $quantity,
        );
    };

    $this->claim = function (string $holderId, array $quantities) {
        return $this->reservations->open(
            $this->organisationId,
            $this->branchId,
            StockReservation::HOLDER_PRODUCTION_ORDER,
            $holderId,
            $quantities,
        );
    };
});

afterEach(function (): void {
    app(TenantContext::class)->clear();
});

it('reports available as on-hand minus every open claim', function (): void {
    ($this->receive)('10');
    ($this->claim)(BATCH_ONE, [$this->itemId => '4']);

    expect($this->reservations->onHandQuantity($this->branchId, $this->itemId))->toBe('10.0000')
        ->and($this->reservations->reservedQuantity($this->branchId, $this->itemId))->toBe('4.000000')
        ->and($this->reservations->availableQuantity($this->branchId, $this->itemId))->toBe('6.000000');
});

it('excludes one holder’s own claim so a batch can consume what it reserved', function (): void {
    ($this->receive)('10');
    ($this->claim)(BATCH_ONE, [$this->itemId => '10']);

    // To everyone else the shelf is empty. To the batch that claimed it, it is full.
    expect($this->reservations->availableQuantity($this->branchId, $this->itemId))->toBe('0.000000')
        ->and($this->reservations->availableQuantity(
            $this->branchId,
            $this->itemId,
            StockReservation::HOLDER_PRODUCTION_ORDER,
            BATCH_ONE,
        ))->toBe('10.000000');
});

it('refuses a consume that another holder’s claim has spoken for, and says so separately', function (): void {
    ($this->receive)('10');
    ($this->claim)(BATCH_ONE, [$this->itemId => '8']);

    try {
        $this->inventory->recordMovement(
            $this->organisationId,
            $this->branchId,
            $this->itemId,
            'consume',
            '-5',
        );
        $this->fail('Expected the consume to be refused.');
    } catch (InsufficientStock $e) {
        // Available, requested and reserved are three separate figures because
        // "the shelf is empty" and "the shelf is spoken for" have different
        // remedies and must not read alike.
        expect($e->errorCode)->toBe(ErrorCode::InventoryInsufficientStock)
            ->and($e->details['available'])->toBe('2.000000')
            ->and($e->details['reserved'])->toBe('8.000000')
            ->and($e->details['requested'])->toBe('5.000000')
            ->and($e->isBlockedByReservation())->toBeTrue();
    }

    // Nothing moved: the shelf still holds what it held.
    expect((string) StockLevel::query()->where('stock_item_id', $this->itemId)->value('quantity'))->toBe('10.0000');
});

it('still calls an empty shelf insufficient even when something is also claimed', function (): void {
    ($this->receive)('4');
    ($this->claim)(BATCH_ONE, [$this->itemId => '2']);

    try {
        // 10 exceeds even the un-claimed shelf of 4, so the claim is not what
        // stopped it and blaming production would send somebody to the wrong desk.
        $this->inventory->recordMovement($this->organisationId, $this->branchId, $this->itemId, 'consume', '-10');
        $this->fail('Expected the consume to be refused.');
    } catch (InsufficientStock $e) {
        expect($e->details['reserved'])->toBe('2.000000')
            ->and($e->isBlockedByReservation())->toBeFalse();
    }
});

it('lets the holder consume against its own claim', function (): void {
    ($this->receive)('10');
    ($this->claim)(BATCH_ONE, [$this->itemId => '10']);

    $this->inventory->recordMovement(
        $this->organisationId,
        $this->branchId,
        $this->itemId,
        'consume',
        '-10',
        holderType: StockReservation::HOLDER_PRODUCTION_ORDER,
        holderId: BATCH_ONE,
    );

    expect((string) StockLevel::query()->where('stock_item_id', $this->itemId)->value('quantity'))->toBe('0.0000')
        ->and(StockMovement::withoutTenancy()->where('reason', 'consume')->count())->toBe(1);
});

it('permits waste below the reserved total and reports the shelf as short', function (): void {
    ($this->receive)('10');
    ($this->claim)(BATCH_ONE, [$this->itemId => '10']);

    // A stock count that comes up short is a fact. Refusing to record it would
    // hide the discrepancy rather than surface it.
    $this->inventory->recordMovement($this->organisationId, $this->branchId, $this->itemId, 'waste', '-4');

    expect((string) StockLevel::query()->where('stock_item_id', $this->itemId)->value('quantity'))->toBe('6.0000')
        ->and($this->reservations->availableQuantity($this->branchId, $this->itemId))->toBe('-4.000000')
        ->and($this->reservations->isShort($this->branchId, $this->itemId))->toBeTrue();
});

it('permits a negative adjust below the reserved total for the same reason', function (): void {
    ($this->receive)('10');
    ($this->claim)(BATCH_ONE, [$this->itemId => '10']);

    $this->inventory->recordMovement($this->organisationId, $this->branchId, $this->itemId, 'adjust', '-3');

    expect($this->reservations->isShort($this->branchId, $this->itemId))->toBeTrue();
});

it('refuses the whole claim when one shelf cannot cover its line', function (): void {
    ($this->receive)('10');
    ($this->receive)('1', $this->secondId);

    $open = fn () => ($this->claim)(BATCH_ONE, [$this->itemId => '5', $this->secondId => '5']);

    expect($open)->toThrow(InsufficientStock::class);

    // All or nothing: a batch half-reserved is a batch nobody can plan around,
    // so the oil is not left claimed by an order that was refused.
    expect(StockReservation::withoutTenancy()->count())->toBe(0);
});

it('cannot double-book one shelf under one holder', function (): void {
    ($this->receive)('10');
    ($this->claim)(BATCH_ONE, [$this->itemId => '4']);

    // A re-confirm — a retry, a redelivered event — hits the partial unique
    // index rather than claiming the same oil twice.
    expect(fn () => ($this->claim)(BATCH_ONE, [$this->itemId => '4']))->toThrow(QueryException::class);
});

it('stops a second holder over-claiming what the first already took', function (): void {
    ($this->receive)('10');
    ($this->claim)(BATCH_ONE, [$this->itemId => '7']);

    expect(fn () => ($this->claim)(BATCH_TWO, [$this->itemId => '4']))->toThrow(InsufficientStock::class);

    // 3 is what is left, and it is allowed.
    ($this->claim)(BATCH_TWO, [$this->itemId => '3']);

    expect($this->reservations->availableQuantity($this->branchId, $this->itemId))->toBe('0.000000');
});

it('distinguishes a released claim from a consumed one rather than deleting either', function (): void {
    ($this->receive)('10');
    ($this->claim)(BATCH_ONE, [$this->itemId => '4']);

    $changed = $this->reservations->close(
        StockReservation::HOLDER_PRODUCTION_ORDER,
        BATCH_ONE,
        ReservationStatus::Released,
    );

    $row = StockReservation::withoutTenancy()->sole();

    expect($changed)->toBe(1)
        ->and($row->status)->toBe(ReservationStatus::Released)
        ->and($row->released_at)->not->toBeNull()
        // The claim is gone from availability but not from the record: a manager
        // reading a cancelled order sees that it never took the oil.
        ->and($this->reservations->availableQuantity($this->branchId, $this->itemId))->toBe('10.000000');
});

it('releases idempotently, and says how many rows it actually changed', function (): void {
    ($this->receive)('10');
    ($this->claim)(BATCH_ONE, [$this->itemId => '4']);

    $first = $this->reservations->close(StockReservation::HOLDER_PRODUCTION_ORDER, BATCH_ONE, ReservationStatus::Released);
    $second = $this->reservations->close(StockReservation::HOLDER_PRODUCTION_ORDER, BATCH_ONE, ReservationStatus::Released);

    // Zero is what makes a retried cancellation safe to run and readable after
    // a crash: "released" and "there was nothing left to release" are different
    // answers and look identical from the outside.
    expect($first)->toBe(1)->and($second)->toBe(0);
});

it('reads one holder’s claims back, and many shelves in one query', function (): void {
    ($this->receive)('10');
    ($this->receive)('10', $this->secondId);
    ($this->claim)(BATCH_ONE, [$this->itemId => '4', $this->secondId => '6']);
    ($this->claim)(BATCH_TWO, [$this->itemId => '1']);

    expect($this->reservations->openFor(StockReservation::HOLDER_PRODUCTION_ORDER, BATCH_ONE))
        ->toBe([$this->itemId => '4.0000', $this->secondId => '6.0000']);

    $totals = $this->reservations->openTotals($this->branchId, [$this->itemId, $this->secondId]);

    // Both holders' claims on the oil, added up once.
    expect($totals[$this->itemId])->toBe('5.000000')
        ->and($totals[$this->secondId])->toBe('6.000000');
});

it('omits a shelf with no open claim from the bulk totals rather than reporting a zero row', function (): void {
    ($this->receive)('10');

    $totals = $this->reservations->openTotals($this->branchId, [$this->itemId, $this->secondId]);

    expect($totals)->toBe([]);
});

it('ignores a closed claim when answering what is free', function (): void {
    ($this->receive)('10');
    ($this->claim)(BATCH_ONE, [$this->itemId => '4']);
    $this->reservations->close(StockReservation::HOLDER_PRODUCTION_ORDER, BATCH_ONE, ReservationStatus::Consumed);

    expect($this->reservations->reservedQuantity($this->branchId, $this->itemId))->toBe('0.000000')
        ->and($this->reservations->openTotals($this->branchId, [$this->itemId]))->toBe([]);
});

it('skips a zero or negative line rather than writing a claim the CHECK would reject', function (): void {
    ($this->receive)('10');

    $opened = ($this->claim)(BATCH_ONE, [$this->itemId => '0']);

    expect($opened)->toBe([])
        ->and(StockReservation::withoutTenancy()->count())->toBe(0);
});

it('refuses to close a claim as open', function (): void {
    expect(fn () => $this->reservations->close(
        StockReservation::HOLDER_PRODUCTION_ORDER,
        BATCH_ONE,
        ReservationStatus::Open,
    ))->toThrow(RuntimeException::class);
});
