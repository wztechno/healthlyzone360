<?php

declare(strict_types=1);

use Healthy360\AccessControl\Database\Seeders\AccessControlSeeder;
use Healthy360\Ingredients\Models\Ingredient;
use Healthy360\Inventory\Models\StockItem;
use Healthy360\Organisations\Database\Seeders\OrganisationTypeSeeder;
use Healthy360\Organisations\Models\OrganisationBranch;
use Healthy360\Pricing\Tests\Fixtures\PricingWorld;
use Healthy360\Procurement\Models\GoodsReceipt;
use Healthy360\Procurement\Models\Supplier;
use Healthy360\Procurement\Models\SupplierStockItem;
use Healthy360\Procurement\Services\GoodsReceiptService;
use Healthy360\Procurement\Services\LastPurchasePriceQuery;
use Healthy360\ReferenceData\Database\Seeders\ReferenceDataSeeder;
use Healthy360\ReferenceData\Models\MeasurementUnit;
use Healthy360\Tenancy\TenantContext;
use Illuminate\Support\Facades\DB;

/*
|--------------------------------------------------------------------------
| Last purchase price — derived from the receipt ledger, never stored
|--------------------------------------------------------------------------
|
| SUP2 / §3.4. There is no `last_price` column anywhere, because a stored copy
| disagrees with the ledger the moment a receipt is posted, corrected or priced
| late. The newest priced `goods_receipt_lines` row *is* the last price.
|
| Six properties are pinned here:
|
| - **latest wins per (supplier, item)** — two deliveries at two prices remain
|   two historical facts and the later one is what a screen shows;
| - **the item-level read crosses suppliers** and names who sold it;
| - **unpriced lines are skipped entirely** — an item received only on unpriced
|   receipts has *no* last price, which is a different fact from a price of nothing;
| - **same-second receipts are deterministic** — the `created_at`/`id` tie-breaks
|   are what stop two refreshes showing two answers;
| - **currencies stay on their own rows** — nothing is converted or summed;
| - **one query per batch, not one per item** — the N+1 §3.4 forbids by name.
|
| Every receipt below is posted through the real `GoodsReceiptService`, so the
| ledger these reads walk is the ledger the rest of the system wrote.
|
*/

/**
 * A kitchen with a branch and the tenant context already set, ready to post.
 */
function priceWorld(string $email): object
{
    $tenant = PricingWorld::kitchen($email, PricingWorld::FULL_PERMISSIONS);
    $organisation = $tenant->organisation;
    $branch = OrganisationBranch::factory()->create([
        'organisation_id' => $organisation->getKey(),
        'country_code' => $organisation->country_code,
    ]);

    app(TenantContext::class)->setOrganisation((string) $tenant->user->getKey(), (string) $organisation->getKey());

    return (object) [
        'tenant' => $tenant,
        'user' => $tenant->user,
        'organisation' => $organisation,
        'organisationId' => (string) $organisation->getKey(),
        'branchId' => (string) $branch->getKey(),
        'headers' => PricingWorld::headers($tenant) + ['X-Branch-Id' => (string) $branch->getKey()],
    ];
}

function priceSupplier(string $organisationId, string $code, string $name): Supplier
{
    return Supplier::withoutTenancy()->create([
        'organisation_id' => $organisationId,
        'code' => $code,
        'name_en' => $name,
        'currency_code' => 'USD',
    ]);
}

function priceStockItem(string $organisationId, string $code, string $name): StockItem
{
    $kg = MeasurementUnit::query()->where('code', 'kg')->sole();

    $ingredient = Ingredient::factory()->create([
        'organisation_id' => $organisationId,
        'default_unit_id' => (string) $kg->getKey(),
    ]);

    return StockItem::withoutTenancy()->create([
        'organisation_id' => $organisationId,
        'code' => $code,
        'name_en' => $name,
        'unit_code' => 'kg',
        'unit_id' => (string) $kg->getKey(),
        'ingredient_id' => (string) $ingredient->getKey(),
    ]);
}

/**
 * One priced (or unpriced) delivery, through the real posting service.
 *
 * `receivedAt` is stamped afterwards because the service always posts at `now()`
 * — receiving is a live event, and back-dating it is a test's business rather
 * than an endpoint's. Everything else about the receipt is what the real path
 * wrote.
 */
function priceReceipt(
    object $world,
    ?Supplier $supplier,
    StockItem $item,
    ?string $unitPrice,
    string $currency = 'USD',
    ?string $receivedAt = null,
    string $documentRef = 'DN-1',
    string $quantity = '10',
): GoodsReceipt {
    $kg = MeasurementUnit::query()->where('code', 'kg')->sole();

    $line = [
        'stock_item_id' => (string) $item->getKey(),
        'quantity' => $quantity,
        'unit_id' => (string) $kg->getKey(),
    ];

    if ($unitPrice !== null) {
        $line['unit_price_amount'] = $unitPrice;
        $line['cost_currency_code'] = $currency;
    }

    $receipt = app(GoodsReceiptService::class)->post(
        $world->organisationId,
        $world->branchId,
        $supplier === null ? null : (string) $supplier->getKey(),
        $documentRef,
        null,
        [$line],
    );

    if ($receivedAt !== null) {
        GoodsReceipt::withoutTenancy()->whereKey($receipt->getKey())->update(['received_at' => $receivedAt]);
    }

    return $receipt;
}

beforeEach(function (): void {
    $this->seed([ReferenceDataSeeder::class, OrganisationTypeSeeder::class, AccessControlSeeder::class]);
    $this->world = priceWorld('prices@kitchen.test');
    $this->query = app(LastPurchasePriceQuery::class);
});

afterEach(function (): void {
    app(TenantContext::class)->clear();
});

it('answers the newest priced line per supplier and item, with its unit and currency', function (): void {
    $supplier = priceSupplier($this->world->organisationId, 'GULF-01', 'Gulf Fresh');
    $flour = priceStockItem($this->world->organisationId, 'FLR-1', 'Flour');

    priceReceipt($this->world, $supplier, $flour, '2.00', receivedAt: '2026-08-01 09:00:00', documentRef: 'DN-1');
    priceReceipt($this->world, $supplier, $flour, '2.75', receivedAt: '2026-08-10 09:00:00', documentRef: 'DN-2');
    // Older than both, and must not win despite being written last.
    priceReceipt($this->world, $supplier, $flour, '1.10', receivedAt: '2026-07-01 09:00:00', documentRef: 'DN-0');

    $prices = $this->query->perSupplierItem(
        $this->world->organisationId,
        (string) $supplier->getKey(),
        [(string) $flour->getKey()],
    );

    $price = $prices[(string) $flour->getKey()];

    expect($price['unit_price_amount'])->toBe('2.750000')
        ->and($price['cost_currency_code'])->toBe('USD')
        // A price without its unit is not a price.
        ->and($price['unit_code'])->toBe('kg')
        ->and($price['quantity'])->toBe('10.0000')
        ->and($price['document_ref'])->toBe('DN-2')
        ->and($price['received_at'])->toContain('2026-08-10');
});

it('answers the newest purchase across suppliers and names who sold it', function (): void {
    $gulf = priceSupplier($this->world->organisationId, 'GULF-01', 'Gulf Fresh');
    $bekaa = priceSupplier($this->world->organisationId, 'BEKAA-01', 'Bekaa Farms');
    $flour = priceStockItem($this->world->organisationId, 'FLR-1', 'Flour');

    priceReceipt($this->world, $gulf, $flour, '2.00', receivedAt: '2026-08-01 09:00:00');
    priceReceipt($this->world, $bekaa, $flour, '3.40', receivedAt: '2026-08-09 09:00:00');

    $prices = $this->query->perItem($this->world->organisationId, [(string) $flour->getKey()]);
    $price = $prices[(string) $flour->getKey()];

    expect($price['unit_price_amount'])->toBe('3.400000')
        ->and($price['supplier'])->not->toBeNull()
        ->and($price['supplier']['name_en'])->toBe('Bekaa Farms');

    // Each supplier still keeps its own answer — the item-level read is a
    // different question, not a replacement for the per-supplier one.
    $gulfPrice = $this->query->perSupplierItem(
        $this->world->organisationId,
        (string) $gulf->getKey(),
        [(string) $flour->getKey()],
    );

    expect($gulfPrice[(string) $flour->getKey()]['unit_price_amount'])->toBe('2.000000');
});

it('keeps a direct market-run purchase, with no supplier to name', function (): void {
    $flour = priceStockItem($this->world->organisationId, 'FLR-1', 'Flour');

    priceReceipt($this->world, null, $flour, '4.20', receivedAt: '2026-08-02 09:00:00');

    $prices = $this->query->perItem($this->world->organisationId, [(string) $flour->getKey()]);

    expect($prices[(string) $flour->getKey()]['unit_price_amount'])->toBe('4.200000')
        ->and($prices[(string) $flour->getKey()]['supplier'])->toBeNull();
});

it('skips unpriced lines entirely rather than treating them as a price of nothing', function (): void {
    $supplier = priceSupplier($this->world->organisationId, 'GULF-01', 'Gulf Fresh');
    $flour = priceStockItem($this->world->organisationId, 'FLR-1', 'Flour');
    $sugar = priceStockItem($this->world->organisationId, 'SUG-1', 'Sugar');

    // Flour: an unpriced delivery arrives *after* a priced one and must not
    // hide it. The invoice has not come yet; the last known price still stands.
    priceReceipt($this->world, $supplier, $flour, '2.00', receivedAt: '2026-08-01 09:00:00', documentRef: 'DN-1');
    priceReceipt($this->world, $supplier, $flour, null, receivedAt: '2026-08-12 09:00:00', documentRef: 'DN-2');

    // Sugar: only ever received unpriced, so it has no last price at all.
    priceReceipt($this->world, $supplier, $sugar, null, receivedAt: '2026-08-05 09:00:00', documentRef: 'DN-3');

    $ids = [(string) $flour->getKey(), (string) $sugar->getKey()];

    $perSupplier = $this->query->perSupplierItem($this->world->organisationId, (string) $supplier->getKey(), $ids);
    $perItem = $this->query->perItem($this->world->organisationId, $ids);

    expect($perSupplier[(string) $flour->getKey()]['unit_price_amount'])->toBe('2.000000')
        ->and($perSupplier[(string) $flour->getKey()]['document_ref'])->toBe('DN-1')
        // Absent, not present with a null amount: "never bought at a price" is
        // the absence of a purchase, and the screen renders it as such.
        ->and($perSupplier)->not->toHaveKey((string) $sugar->getKey())
        ->and($perItem)->not->toHaveKey((string) $sugar->getKey());
});

it('is deterministic when two receipts land in the same second', function (): void {
    $supplier = priceSupplier($this->world->organisationId, 'GULF-01', 'Gulf Fresh');
    $flour = priceStockItem($this->world->organisationId, 'FLR-1', 'Flour');

    // A morning delivery and its correction, minutes apart on the clock but
    // stamped with the same received time — ordinary at a loading bay.
    priceReceipt($this->world, $supplier, $flour, '2.00', receivedAt: '2026-08-10 09:00:00', documentRef: 'DN-EARLY');
    priceReceipt($this->world, $supplier, $flour, '2.60', receivedAt: '2026-08-10 09:00:00', documentRef: 'DN-LATE');

    $ids = [(string) $flour->getKey()];

    // Ten reads, one answer. Without the created_at/id tie-breaks PostgreSQL is
    // free to return either row, and a refreshed screen would flicker between
    // two prices for the same history.
    for ($attempt = 0; $attempt < 10; $attempt++) {
        $price = $this->query->perSupplierItem($this->world->organisationId, (string) $supplier->getKey(), $ids);

        expect($price[(string) $flour->getKey()]['document_ref'])->toBe('DN-LATE')
            ->and($price[(string) $flour->getKey()]['unit_price_amount'])->toBe('2.600000');
    }
});

it('keeps each row in its own currency and never converts', function (): void {
    $supplier = priceSupplier($this->world->organisationId, 'GULF-01', 'Gulf Fresh');
    $flour = priceStockItem($this->world->organisationId, 'FLR-1', 'Flour');
    $sugar = priceStockItem($this->world->organisationId, 'SUG-1', 'Sugar');

    priceReceipt($this->world, $supplier, $flour, '2.00', currency: 'USD', receivedAt: '2026-08-01 09:00:00');
    priceReceipt($this->world, $supplier, $sugar, '3.00', currency: 'EUR', receivedAt: '2026-08-02 09:00:00');

    $prices = $this->query->perSupplierItem(
        $this->world->organisationId,
        (string) $supplier->getKey(),
        [(string) $flour->getKey(), (string) $sugar->getKey()],
    );

    expect($prices[(string) $flour->getKey()]['cost_currency_code'])->toBe('USD')
        ->and($prices[(string) $sugar->getKey()]['cost_currency_code'])->toBe('EUR');
});

it('never reads another organisation\'s receipts', function (): void {
    $supplier = priceSupplier($this->world->organisationId, 'GULF-01', 'Gulf Fresh');
    $flour = priceStockItem($this->world->organisationId, 'FLR-1', 'Flour');
    priceReceipt($this->world, $supplier, $flour, '2.00', receivedAt: '2026-08-01 09:00:00');

    $other = priceWorld('other-prices@kitchen.test');
    $otherSupplier = priceSupplier($other->organisationId, 'FGN-01', 'Elsewhere Trading');
    $otherFlour = priceStockItem($other->organisationId, 'FLR-9', 'Foreign Flour');
    priceReceipt($other, $otherSupplier, $otherFlour, '9.99', receivedAt: '2026-08-11 09:00:00');

    $ids = [(string) $flour->getKey(), (string) $otherFlour->getKey()];

    // The first kitchen asks for both shelves and is answered about its own.
    $prices = $this->query->perItem($this->world->organisationId, $ids);

    expect($prices)->toHaveKey((string) $flour->getKey())
        ->and($prices)->not->toHaveKey((string) $otherFlour->getKey());
});

it('answers a whole page of items in one query rather than one per item', function (): void {
    $supplier = priceSupplier($this->world->organisationId, 'GULF-01', 'Gulf Fresh');

    $ids = [];
    foreach (range(1, 8) as $ordinal) {
        $item = priceStockItem($this->world->organisationId, 'ITM-'.$ordinal, 'Item '.$ordinal);
        priceReceipt($this->world, $supplier, $item, '1.'.$ordinal.'0', receivedAt: '2026-08-0'.$ordinal.' 09:00:00');
        $ids[] = (string) $item->getKey();
    }

    $statements = 0;
    DB::listen(function () use (&$statements): void {
        $statements++;
    });

    $perSupplier = $this->query->perSupplierItem($this->world->organisationId, (string) $supplier->getKey(), $ids);

    expect($statements)->toBe(1)
        ->and($perSupplier)->toHaveCount(8);

    $statements = 0;
    $perItem = $this->query->perItem($this->world->organisationId, $ids);

    expect($statements)->toBe(1)
        ->and($perItem)->toHaveCount(8);
});

it('costs a supplier page one price query however many items it supplies', function (): void {
    $supplier = priceSupplier($this->world->organisationId, 'GULF-01', 'Gulf Fresh');

    foreach (range(1, 6) as $ordinal) {
        $item = priceStockItem($this->world->organisationId, 'ITM-'.$ordinal, 'Item '.$ordinal);
        priceReceipt($this->world, $supplier, $item, '1.'.$ordinal.'0', receivedAt: '2026-08-0'.$ordinal.' 09:00:00');

        SupplierStockItem::withoutTenancy()->create([
            'organisation_id' => $this->world->organisationId,
            'supplier_id' => (string) $supplier->getKey(),
            'stock_item_id' => (string) $item->getKey(),
            'is_preferred' => false,
        ]);
    }

    $this->actingAs($this->world->user);

    $statements = [];
    DB::listen(function ($event) use (&$statements): void {
        $statements[] = $event->sql;
    });

    $detail = $this->getJson(
        "/api/v1/catalogue/procurement/suppliers/{$supplier->getKey()}",
        $this->world->headers,
    )->assertOk();

    expect($detail->json('data.supplier.supplied_items'))->toHaveCount(6);

    // One DISTINCT ON for the whole section, not one lookup per supplied item.
    $priceQueries = array_filter($statements, static fn (string $sql): bool => str_contains($sql, 'distinct on'));

    expect($priceQueries)->toHaveCount(1);
});
