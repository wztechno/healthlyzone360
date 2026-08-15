<?php

declare(strict_types=1);

use Healthy360\AccessControl\Database\Seeders\AccessControlSeeder;
use Healthy360\Inventory\Exceptions\InsufficientStock;
use Healthy360\Inventory\Models\StockItem;
use Healthy360\Inventory\Models\StockLevel;
use Healthy360\Inventory\Models\StockMovement;
use Healthy360\Inventory\Services\InventoryService;
use Healthy360\Organisations\Database\Seeders\OrganisationTypeSeeder;
use Healthy360\Organisations\Models\OrganisationBranch;
use Healthy360\Pricing\Tests\Fixtures\PricingWorld;
use Healthy360\ReferenceData\Database\Seeders\ReferenceDataSeeder;
use Healthy360\Support\Api\ErrorCode;
use Healthy360\Tenancy\TenantContext;

/*
|--------------------------------------------------------------------------
| InventoryService — the locked, bcmath, non-negative movement path
|--------------------------------------------------------------------------
|
| The two correctness rules INV1.0 added: a consume cannot drive a level below
| zero, and the balance read-modify-write is exact (bcmath) and reads the
| current persisted quantity on every movement rather than a stale copy.
|
*/

beforeEach(function (): void {
    // Seeded reference data plus the permission catalogue, and a kitchen built
    // on it — `PricingWorld` avoids the country-factory collision a bare
    // `Organisation::factory()` causes against the seeded gazetteer.
    $this->seed([ReferenceDataSeeder::class, OrganisationTypeSeeder::class, AccessControlSeeder::class]);

    $this->tenant = PricingWorld::kitchen('stockguard@kitchen.test');
    $this->organisation = $this->tenant->organisation;
    $this->branch = OrganisationBranch::factory()->create([
        'organisation_id' => $this->organisation->getKey(),
        'country_code' => $this->organisation->country_code,
    ]);

    // The service reads the organisation-scoped stock level, so a request's
    // resolved tenant context is set here by hand.
    app(TenantContext::class)->setOrganisation((string) $this->tenant->user->getKey(), (string) $this->organisation->getKey());

    $this->service = app(InventoryService::class);

    $this->item = StockItem::query()->create([
        'organisation_id' => $this->organisation->getKey(),
        'code' => 'flour-01',
        'name_en' => 'Flour',
        'unit_code' => 'kg',
    ]);
});

afterEach(function (): void {
    app(TenantContext::class)->clear();
});

/**
 * @param  numeric-string  $delta
 */
function move(object $test, string $reason, string $delta): StockMovement
{
    return $test->service->recordMovement(
        (string) $test->organisation->getKey(),
        (string) $test->branch->getKey(),
        (string) $test->item->getKey(),
        $reason,
        $delta,
    );
}

function currentLevel(object $test): string
{
    return (string) StockLevel::query()->where('stock_item_id', $test->item->getKey())->value('quantity');
}

it('refuses a consume that would drive the level below zero and rolls the whole movement back', function (): void {
    move($this, 'receipt', '5');

    $consume = fn () => move($this, 'consume', '-8');

    expect($consume)->toThrow(InsufficientStock::class);

    // The level is untouched and no consume movement was written — the guard
    // runs before either write, inside the transaction.
    expect(currentLevel($this))->toBe('5.0000')
        ->and(StockMovement::query()->where('stock_item_id', $this->item->getKey())->where('reason', 'consume')->count())->toBe(0);
});

it('carries the arithmetic on the refusal so a caller can explain it', function (): void {
    move($this, 'receipt', '5');

    try {
        move($this, 'consume', '-8');
        $this->fail('Expected the consume to be refused.');
    } catch (InsufficientStock $e) {
        expect($e->errorCode)->toBe(ErrorCode::InventoryInsufficientStock)
            ->and($e->details['available'])->toBe('5.0000')
            ->and($e->details['requested'])->toBe('8.000000')
            ->and($e->status())->toBe(409);
    }
});

it('lets a consume take the level to exactly zero, then refuses the next crumb', function (): void {
    move($this, 'receipt', '10');
    move($this, 'consume', '-4');
    move($this, 'consume', '-6');

    expect(currentLevel($this))->toBe('0.0000');

    expect(fn () => move($this, 'consume', '-0.0001'))->toThrow(InsufficientStock::class);
});

it('permits adjust and waste to go negative — they are corrections, not consumption', function (): void {
    move($this, 'waste', '-3');
    expect(currentLevel($this))->toBe('-3.0000');

    move($this, 'adjust', '-2');
    expect(currentLevel($this))->toBe('-5.0000');
});

it('reads the current persisted balance on every movement and keeps fractional quantities exact', function (): void {
    move($this, 'receipt', '5.5555');
    move($this, 'consume', '-0.0001');

    // bcmath, not a float: 5.5555 − 0.0001 is exactly 5.5554, and each call
    // reads the balance the previous one committed rather than a stale zero.
    expect(currentLevel($this))->toBe('5.5554');
});

it('stamps the level with the organisation so the once-unscoped table can no longer leak', function (): void {
    move($this, 'receipt', '1');

    $level = StockLevel::query()->where('stock_item_id', $this->item->getKey())->sole();

    expect($level->organisation_id)->toBe((string) $this->organisation->getKey());
});
