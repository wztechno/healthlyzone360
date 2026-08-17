<?php

declare(strict_types=1);

use Healthy360\AccessControl\Database\Seeders\AccessControlSeeder;
use Healthy360\Catalogues\Models\Catalogue;
use Healthy360\Catalogues\Models\CatalogueItem;
use Healthy360\Ingredients\Models\Ingredient;
use Healthy360\Inventory\Models\StockItem;
use Healthy360\Organisations\Database\Seeders\OrganisationTypeSeeder;
use Healthy360\Organisations\Models\OrganisationBranch;
use Healthy360\Pricing\Tests\Fixtures\PricingWorld;
use Healthy360\Procurement\Enums\PurchaseOrderStatus;
use Healthy360\Procurement\Models\PurchaseOrder;
use Healthy360\Procurement\Models\PurchaseOrderLine;
use Healthy360\Procurement\Models\Supplier;
use Healthy360\Procurement\Models\SupplierContact;
use Healthy360\Procurement\Models\SupplierStockItem;
use Healthy360\Procurement\Services\PurchaseOrderNumbers;
use Healthy360\Procurement\Services\PurchaseOrderService;
use Healthy360\ReferenceData\Database\Seeders\ReferenceDataSeeder;
use Healthy360\ReferenceData\Models\MeasurementUnit;
use Healthy360\Support\Api\ErrorCode;
use Healthy360\Support\Api\Exceptions\ApiException;

/*
|--------------------------------------------------------------------------
| Writing the order book
|--------------------------------------------------------------------------
|
| SUP4, §3.5. Nine claims are pinned here, and every one of them is a rule that
| looks obvious until the second person writes the same code:
|
| - **the number is minted, unique per organisation, and random** — `PO-` plus
|   eight Crockford characters, none of them ambiguous down a phone line;
| - **a collision recovers** — the savepoint unwinds one insert, a fresh number
|   is minted, and the batch it was inside still commits whole. This is the one
|   path that cannot happen by itself in a test, so it is arranged;
| - **the batch is all-or-nothing** — a bad shelf in the second order leaves
|   zero rows, not one order and a mystery;
| - **orders come back in request order**, because a person confirmed a list;
| - **snapshots are the server's** — the Arabic name resolved from the entity
|   that names the shelf (catalogue item for product-backed rows, ingredient
|   otherwise, honestly absent when that entity has none); the unit read from
|   the shelf whatever a client sends;
| - **the transition matrix is the enum's**, cancelled and received terminal,
|   and there is no route back to draft;
| - **issued lines are frozen** — an edit is a 409 and the lines are byte-for-
|   byte what they were;
| - **an archived supplier cannot be issued to**, and restoring it un-refuses;
| - **the recipient snapshot is a moment, not a view** — editing the supplier
|   afterwards moves the live reference and leaves the document alone.
|
| The service is exercised directly rather than through HTTP: these are its own
| rules, and the route matrix lives in `PurchaseOrderApiTest`.
|
*/

/**
 * A kitchen, a branch and a caller holding the ordering permission.
 *
 * @param  list<string>  $permissions
 */
function poWorld(string $email, array $permissions = PricingWorld::FULL_PERMISSIONS): object
{
    $tenant = PricingWorld::kitchen($email, $permissions);
    $branch = OrganisationBranch::factory()->create([
        'organisation_id' => $tenant->organisation->getKey(),
        'country_code' => $tenant->organisation->country_code,
    ]);

    return (object) [
        'tenant' => $tenant,
        'organisation' => $tenant->organisation,
        'organisationId' => (string) $tenant->organisation->getKey(),
        'user' => $tenant->user,
        'branchId' => (string) $branch->getKey(),
        'headers' => PricingWorld::headers($tenant),
    ];
}

function poSupplier(string $organisationId, string $code = 'SUP-1', string $name = 'Gulf Fresh'): Supplier
{
    return Supplier::withoutTenancy()->create([
        'organisation_id' => $organisationId,
        'code' => $code,
        'name_en' => $name,
    ]);
}

/**
 * A shelf derived the way INV2.0 derives one — an ingredient behind it and a
 * real unit, so the row is the shape a real order line would meet.
 */
function poStockItem(string $organisationId, string $code, string $name, ?string $nameAr = 'دقيق'): StockItem
{
    $kg = MeasurementUnit::query()->where('code', 'kg')->sole();

    $ingredient = Ingredient::factory()->create([
        'organisation_id' => $organisationId,
        'default_unit_id' => (string) $kg->getKey(),
        'name_en' => $name,
        'name_ar' => $nameAr ?? $name,
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
 * A shelf backed by a resold product and **no** ingredient — the catalogue path
 * for the Arabic name. `ingredient_id` is nullable and `nullOnDelete`, so a
 * product-backed shelf whose ingredient went is exactly this row.
 */
function poProductStockItem(string $organisationId, string $code, string $nameEn, string $nameAr): StockItem
{
    $kg = MeasurementUnit::query()->where('code', 'kg')->sole();

    $catalogue = Catalogue::factory()->create(['organisation_id' => $organisationId]);

    $product = CatalogueItem::factory()->create([
        'organisation_id' => $organisationId,
        'catalogue_id' => (string) $catalogue->getKey(),
        'name_en' => $nameEn,
        'name_ar' => $nameAr,
    ]);

    return StockItem::withoutTenancy()->create([
        'organisation_id' => $organisationId,
        'code' => $code,
        'name_en' => $nameEn,
        'unit_code' => 'kg',
        'unit_id' => (string) $kg->getKey(),
        'ingredient_id' => null,
        'catalogue_item_id' => (string) $product->getKey(),
    ]);
}

/** A shelf backed by neither book — the honest-blank path. */
function poBareStockItem(string $organisationId, string $code, string $name): StockItem
{
    return StockItem::withoutTenancy()->create([
        'organisation_id' => $organisationId,
        'code' => $code,
        'name_en' => $name,
        'unit_code' => 'l',
        'unit_id' => null,
        'ingredient_id' => null,
        'catalogue_item_id' => null,
    ]);
}

/** @return array{supplier_id: string, lines: list<array{stock_item_id: string, quantity: string}>} */
function poOrder(Supplier $supplier, StockItem $item, string $quantity = '2.5'): array
{
    return [
        'supplier_id' => (string) $supplier->getKey(),
        'lines' => [['stock_item_id' => (string) $item->getKey(), 'quantity' => $quantity]],
    ];
}

function poService(): PurchaseOrderService
{
    return app(PurchaseOrderService::class);
}

beforeEach(function (): void {
    $this->seed([ReferenceDataSeeder::class, OrganisationTypeSeeder::class, AccessControlSeeder::class]);
    $this->world = poWorld('orders@kitchen.test');
    $this->actingAs($this->world->user);
});

/* ── the number ──────────────────────────────────────────────────────────── */

it('mints a prefixed, unambiguous, organisation-unique number', function (): void {
    $supplier = poSupplier($this->world->organisationId);
    $item = poStockItem($this->world->organisationId, 'FLR-1', 'Flour');

    $created = poService()->createBatch(
        $this->world->organisationId,
        $this->world->branchId,
        [poOrder($supplier, $item)],
    );

    $number = $created[0]->number;

    // `PO-` plus eight Crockford base-32 characters: no I, L, O or U, so
    // nothing is misread down a phone line and nothing spells anything
    // unfortunate on a document a supplier keeps.
    expect($number)->toMatch('/^PO-[0-9ABCDEFGHJKMNPQRSTVWXYZ]{8}$/');

    // Unique within the organisation — the index is the arbiter, and it is
    // scoped to the kitchen rather than the platform because the number is a
    // kitchen's own handle rather than a support desk's.
    $second = poService()->createBatch(
        $this->world->organisationId,
        $this->world->branchId,
        [poOrder($supplier, $item)],
    );

    expect($second[0]->number)->not->toBe($number);
});

it('recovers from a number collision inside the batch and still commits every order', function (): void {
    $supplier = poSupplier($this->world->organisationId);
    $other = poSupplier($this->world->organisationId, 'SUP-2', 'Cold Store');
    $item = poStockItem($this->world->organisationId, 'FLR-1', 'Flour');

    // A number that is already on the books. Nothing about the mint can produce
    // this deliberately — the collision space is 32^8 — so the generator is
    // replaced with one that hands the taken number back first.
    $taken = 'PO-TAKEN01';

    PurchaseOrder::withoutTenancy()->create([
        'organisation_id' => $this->world->organisationId,
        'branch_id' => $this->world->branchId,
        'supplier_id' => (string) $supplier->getKey(),
        'number' => $taken,
        'status' => PurchaseOrderStatus::Draft,
    ]);

    $this->app->instance(PurchaseOrderNumbers::class, new class($taken) extends PurchaseOrderNumbers
    {
        private int $calls = 0;

        public function __construct(private readonly string $taken) {}

        public function next(string $organisationId): string
        {
            $this->calls++;

            // The first order collides; everything after it is fine. A retry
            // that only worked when the whole batch collided would not be the
            // retry the real race needs.
            return $this->calls === 1 ? $this->taken : 'PO-FRESH0'.$this->calls;
        }
    });

    $created = poService()->createBatch(
        $this->world->organisationId,
        $this->world->branchId,
        [poOrder($supplier, $item), poOrder($other, $item)],
    );

    // Both orders exist. The savepoint unwound one insert, not the batch: had
    // the header gone in without one, PostgreSQL would have aborted the whole
    // transaction and the second order would never have been attempted.
    expect($created)->toHaveCount(2)
        ->and($created[0]->number)->not->toBe($taken)
        ->and(PurchaseOrder::query()->count())->toBe(3);

    // And the lines went in beside their own headers rather than being lost
    // with the rolled-back attempt.
    expect(PurchaseOrderLine::query()->where('purchase_order_id', $created[0]->getKey())->count())->toBe(1)
        ->and(PurchaseOrderLine::query()->where('purchase_order_id', $created[1]->getKey())->count())->toBe(1);
});

/* ── the batch ───────────────────────────────────────────────────────────── */

it('writes nothing at all when one order in the batch names a shelf from another kitchen', function (): void {
    $supplier = poSupplier($this->world->organisationId);
    $other = poSupplier($this->world->organisationId, 'SUP-2', 'Cold Store');
    $mine = poStockItem($this->world->organisationId, 'FLR-1', 'Flour');

    $stranger = poWorld('stranger@kitchen.test');
    $theirs = poStockItem($stranger->organisationId, 'FLR-9', 'Their flour');

    $refused = null;

    try {
        poService()->createBatch(
            $this->world->organisationId,
            $this->world->branchId,
            [
                poOrder($supplier, $mine),
                [
                    'supplier_id' => (string) $other->getKey(),
                    'lines' => [['stock_item_id' => (string) $theirs->getKey(), 'quantity' => '1']],
                ],
            ],
        );
    } catch (ApiException $exception) {
        $refused = $exception;
    }

    // Not found rather than forbidden: whether another kitchen's shelf exists is
    // itself the answer this tenant is not entitled to.
    expect($refused?->errorCode)->toBe(ErrorCode::ResourceNotFound);

    // Zero rows. One order created and one missing, with no way to tell which,
    // is the outcome the single transaction exists to make impossible.
    expect(PurchaseOrder::query()->count())->toBe(0)
        ->and(PurchaseOrderLine::query()->count())->toBe(0);
});

it('returns the orders in request order rather than in whatever order they were written', function (): void {
    $zulu = poSupplier($this->world->organisationId, 'SUP-Z', 'Zulu Trading');
    $alpha = poSupplier($this->world->organisationId, 'SUP-A', 'Alpha Wholesale');
    $item = poStockItem($this->world->organisationId, 'FLR-1', 'Flour');

    $created = poService()->createBatch(
        $this->world->organisationId,
        $this->world->branchId,
        [poOrder($zulu, $item), poOrder($alpha, $item)],
    );

    // The person confirmed a grouping preview and the answer has to line up
    // with it row for row — not alphabetically, not by number.
    expect((string) $created[0]->supplier_id)->toBe((string) $zulu->getKey())
        ->and((string) $created[1]->supplier_id)->toBe((string) $alpha->getKey());
});

it('refuses a batch whose orders name two different branches through the endpoint', function (): void {
    $supplier = poSupplier($this->world->organisationId);
    $item = poStockItem($this->world->organisationId, 'FLR-1', 'Flour');

    $second = OrganisationBranch::factory()->create([
        'organisation_id' => $this->world->organisationId,
        'country_code' => $this->world->organisation->country_code,
    ]);

    // §4: a proposal is always for one branch, so a batch naming two is two
    // batches. The endpoint refuses rather than guessing which was meant.
    $this->postJson('/api/v1/catalogue/procurement/purchase-orders', [
        'orders' => [
            [
                'supplier_id' => (string) $supplier->getKey(),
                'branch_id' => $this->world->branchId,
                'lines' => [['stock_item_id' => (string) $item->getKey(), 'quantity' => '1']],
            ],
            [
                'supplier_id' => (string) $supplier->getKey(),
                'branch_id' => (string) $second->getKey(),
                'lines' => [['stock_item_id' => (string) $item->getKey(), 'quantity' => '1']],
            ],
        ],
    ], $this->world->headers)->assertStatus(422);

    expect(PurchaseOrder::query()->count())->toBe(0);
});

/* ── snapshots ───────────────────────────────────────────────────────────── */

it('snapshots the item code, both names and the unit from the server, from the entity that names each shelf', function (): void {
    $supplier = poSupplier($this->world->organisationId);

    $viaIngredient = poStockItem($this->world->organisationId, 'FLR-1', 'Flour', 'دقيق');
    $viaProduct = poProductStockItem($this->world->organisationId, 'JAM-1', 'Fig jam', 'مربى التين');
    $viaNothing = poBareStockItem($this->world->organisationId, 'CLN-1', 'Floor cleaner');

    // The case that decides the rule: a resold product's shelf takes its
    // English name from the catalogue item while still anchoring an ingredient
    // for costing. The anchor names the raw good ("olive oil"), not the product
    // ("Olive oil 500ml bottle") — so the Arabic half must follow the
    // catalogue item, never the anchor, or one printed line captions two
    // different things.
    $anchored = poProductStockItem($this->world->organisationId, 'OIL-B1', 'Olive oil 500ml bottle', 'زيت زيتون ٥٠٠ مل');
    $anchorIngredient = Ingredient::factory()->create([
        'organisation_id' => $this->world->organisationId,
        'default_unit_id' => $anchored->unit_id ?? $viaIngredient->unit_id,
        'name_en' => 'Olive oil',
        'name_ar' => 'زيت الزيتون',
    ]);
    StockItem::withoutTenancy()
        ->whereKey($anchored->getKey())
        ->update(['ingredient_id' => (string) $anchorIngredient->getKey()]);

    $created = poService()->createBatch(
        $this->world->organisationId,
        $this->world->branchId,
        [[
            'supplier_id' => (string) $supplier->getKey(),
            'lines' => [
                ['stock_item_id' => (string) $viaIngredient->getKey(), 'quantity' => '2'],
                ['stock_item_id' => (string) $viaProduct->getKey(), 'quantity' => '3'],
                ['stock_item_id' => (string) $viaNothing->getKey(), 'quantity' => '4'],
                ['stock_item_id' => (string) $anchored->getKey(), 'quantity' => '5'],
            ],
        ]],
    );

    $lines = PurchaseOrderLine::query()
        ->where('purchase_order_id', $created[0]->getKey())
        ->orderBy('display_order')
        ->get();

    expect($lines->pluck('item_name_ar')->all())->toBe(['دقيق', 'مربى التين', null, 'زيت زيتون ٥٠٠ مل']);

    // The English half and the code come off the shelf, not off the request.
    expect($lines[0]->item_code)->toBe('FLR-1')
        ->and($lines[0]->item_name_en)->toBe('Flour')
        ->and($lines[0]->unit_code)->toBe('kg')
        ->and($lines[0]->unit_id)->not->toBeNull();

    // A shelf INV1.0 left without a resolved unit id still prints its code.
    expect($lines[2]->unit_code)->toBe('l')
        ->and($lines[2]->unit_id)->toBeNull();

    // Request order is display order — the printed sheet has to be recognisably
    // the list the person worked top to bottom.
    expect($lines->pluck('display_order')->all())->toBe([0, 1, 2, 3]);
});

it('reads the supplier item reference off the saved link rather than off the request', function (): void {
    $supplier = poSupplier($this->world->organisationId);
    $linked = poStockItem($this->world->organisationId, 'FLR-1', 'Flour');
    $unlinked = poStockItem($this->world->organisationId, 'SUG-1', 'Sugar');

    SupplierStockItem::withoutTenancy()->create([
        'organisation_id' => $this->world->organisationId,
        'supplier_id' => (string) $supplier->getKey(),
        'stock_item_id' => (string) $linked->getKey(),
        'supplier_item_ref' => 'GF-4417',
    ]);

    $created = poService()->createBatch(
        $this->world->organisationId,
        $this->world->branchId,
        [[
            'supplier_id' => (string) $supplier->getKey(),
            'lines' => [
                ['stock_item_id' => (string) $linked->getKey(), 'quantity' => '1'],
                ['stock_item_id' => (string) $unlinked->getKey(), 'quantity' => '1'],
            ],
        ]],
    );

    $lines = PurchaseOrderLine::query()
        ->where('purchase_order_id', $created[0]->getKey())
        ->orderBy('display_order')
        ->get();

    // Quoted back at the supplier because they recognise it — and absent for a
    // one-off from somebody who does not normally sell this, which is ordinary.
    expect($lines[0]->supplier_item_ref)->toBe('GF-4417')
        ->and($lines[1]->supplier_item_ref)->toBeNull();
});

it('refuses an order that names the same shelf twice', function (): void {
    $supplier = poSupplier($this->world->organisationId);
    $item = poStockItem($this->world->organisationId, 'FLR-1', 'Flour');

    expect(fn () => poService()->createBatch(
        $this->world->organisationId,
        $this->world->branchId,
        [[
            'supplier_id' => (string) $supplier->getKey(),
            'lines' => [
                ['stock_item_id' => (string) $item->getKey(), 'quantity' => '1'],
                ['stock_item_id' => (string) $item->getKey(), 'quantity' => '2'],
            ],
        ]],
    ))->toThrow(ApiException::class);

    // Refused by name rather than surfaced as a raw constraint violation, and
    // nothing written on the way there.
    expect(PurchaseOrder::query()->count())->toBe(0);
});

/* ── the transition matrix ───────────────────────────────────────────────── */

it('permits exactly this slice\'s three edges and refuses the rest', function (): void {
    $draft = PurchaseOrderStatus::Draft;
    $issued = PurchaseOrderStatus::Issued;

    expect($draft->canTransitionTo(PurchaseOrderStatus::Issued))->toBeTrue()
        ->and($draft->canTransitionTo(PurchaseOrderStatus::Cancelled))->toBeTrue()
        ->and($issued->canTransitionTo(PurchaseOrderStatus::Cancelled))->toBeTrue();

    // Slice 5 opens these two, driven by a posted receipt rather than a button.
    expect($issued->canTransitionTo(PurchaseOrderStatus::PartiallyReceived))->toBeFalse()
        ->and($issued->canTransitionTo(PurchaseOrderStatus::Received))->toBeFalse();

    // No route back. An issued order that could return to draft would make the
    // copy the supplier is holding a fiction.
    expect($issued->canTransitionTo(PurchaseOrderStatus::Draft))->toBeFalse();

    // Terminal is terminal: a delivery that turned out wrong is a receipt
    // correction, not a status change.
    expect(PurchaseOrderStatus::Cancelled->isTerminal())->toBeTrue()
        ->and(PurchaseOrderStatus::Received->isTerminal())->toBeTrue()
        ->and(PurchaseOrderStatus::Cancelled->canTransitionTo(PurchaseOrderStatus::Draft))->toBeFalse();

    // §3.5: an order with deliveries against it is never cancelled as though
    // nothing happened, and the enum is where that lives.
    expect(PurchaseOrderStatus::PartiallyReceived->canTransitionTo(PurchaseOrderStatus::Cancelled))->toBeFalse();

    // Only a draft may be rewritten.
    expect($draft->linesAreEditable())->toBeTrue()
        ->and($issued->linesAreEditable())->toBeFalse();
});

it('freezes the lines on issue and refuses an edit with a named conflict', function (): void {
    $supplier = poSupplier($this->world->organisationId);
    $item = poStockItem($this->world->organisationId, 'FLR-1', 'Flour');
    $other = poStockItem($this->world->organisationId, 'SUG-1', 'Sugar');

    $order = poService()->createBatch(
        $this->world->organisationId,
        $this->world->branchId,
        [poOrder($supplier, $item, '5')],
    )[0];

    $before = PurchaseOrderLine::query()
        ->where('purchase_order_id', $order->getKey())
        ->orderBy('display_order')
        ->get()
        ->map(static fn (PurchaseOrderLine $line): array => $line->only([
            'id', 'stock_item_id', 'quantity', 'unit_code', 'item_code', 'item_name_en', 'item_name_ar', 'display_order',
        ]))
        ->all();

    poService()->issue($order);

    $refused = null;

    try {
        poService()->updateDraft($order->refresh(), [
            'lines' => [['stock_item_id' => (string) $other->getKey(), 'quantity' => '99']],
        ]);
    } catch (ApiException $exception) {
        $refused = $exception;
    }

    expect($refused?->errorCode)->toBe(ErrorCode::ResourceConflict)
        ->and($refused?->details['reason'] ?? null)->toBe('purchase_order_not_draft')
        ->and($refused?->details['status'] ?? null)->toBe('issued');

    $after = PurchaseOrderLine::query()
        ->where('purchase_order_id', $order->getKey())
        ->orderBy('display_order')
        ->get()
        ->map(static fn (PurchaseOrderLine $line): array => $line->only([
            'id', 'stock_item_id', 'quantity', 'unit_code', 'item_code', 'item_name_en', 'item_name_ar', 'display_order',
        ]))
        ->all();

    // Byte for byte. A refusal that left the lines half-rewritten would be
    // worse than no refusal at all.
    expect($after)->toBe($before);
});

it('replaces a draft\'s lines wholesale and clears its note on request', function (): void {
    $supplier = poSupplier($this->world->organisationId);
    $flour = poStockItem($this->world->organisationId, 'FLR-1', 'Flour');
    $sugar = poStockItem($this->world->organisationId, 'SUG-1', 'Sugar');

    $order = poService()->createBatch(
        $this->world->organisationId,
        $this->world->branchId,
        [poOrder($supplier, $flour, '5')],
    )[0];

    poService()->updateDraft($order, [
        'notes' => 'Deliver before service',
        'lines' => [['stock_item_id' => (string) $sugar->getKey(), 'quantity' => '1.25']],
    ]);

    $lines = PurchaseOrderLine::query()->where('purchase_order_id', $order->getKey())->get();

    expect($lines)->toHaveCount(1)
        ->and((string) $lines[0]->stock_item_id)->toBe((string) $sugar->getKey())
        ->and($lines[0]->quantity)->toBe('1.2500')
        ->and($order->refresh()->notes)->toBe('Deliver before service');

    // Presence-keyed: `null` clears, and an omitted `lines` leaves the set alone.
    poService()->updateDraft($order, ['notes' => null]);

    expect($order->refresh()->notes)->toBeNull()
        ->and(PurchaseOrderLine::query()->where('purchase_order_id', $order->getKey())->count())->toBe(1);
});

it('keeps issued_at when an issued order is cancelled', function (): void {
    $supplier = poSupplier($this->world->organisationId);
    $item = poStockItem($this->world->organisationId, 'FLR-1', 'Flour');

    $order = poService()->createBatch(
        $this->world->organisationId,
        $this->world->branchId,
        [poOrder($supplier, $item)],
    )[0];

    poService()->issue($order);
    $issuedAt = $order->refresh()->issued_at;

    poService()->cancel($order);
    $order->refresh();

    // Cancelling does not un-issue: a reprint of a cancelled order still says
    // when it went out, and the lines and snapshot are all still there.
    expect($order->status)->toBe(PurchaseOrderStatus::Cancelled)
        ->and($order->cancelled_at)->not->toBeNull()
        ->and($order->issued_at?->toIso8601String())->toBe($issuedAt?->toIso8601String())
        ->and($order->recipient_snapshot)->not->toBeNull()
        ->and(PurchaseOrderLine::query()->where('purchase_order_id', $order->getKey())->count())->toBe(1);

    // And a second cancel is a named refusal rather than a silent success.
    $refused = null;

    try {
        poService()->cancel($order);
    } catch (ApiException $exception) {
        $refused = $exception;
    }

    expect($refused?->details['reason'] ?? null)->toBe('purchase_order_not_cancellable');
});

/* ── the archived supplier ───────────────────────────────────────────────── */

it('refuses to issue to an archived supplier and issues once it is restored', function (): void {
    $supplier = poSupplier($this->world->organisationId);
    $item = poStockItem($this->world->organisationId, 'FLR-1', 'Flour');

    $order = poService()->createBatch(
        $this->world->organisationId,
        $this->world->branchId,
        [poOrder($supplier, $item)],
    )[0];

    // Archived *after* the draft was made, which is the case worth refusing:
    // the picker never offers a shuttered warehouse, so this is the order that
    // sat while the kitchen stopped buying from them.
    $supplier->archived_at = now();
    $supplier->save();

    $refused = null;

    try {
        poService()->issue($order);
    } catch (ApiException $exception) {
        $refused = $exception;
    }

    expect($refused?->errorCode)->toBe(ErrorCode::ResourceConflict)
        ->and($refused?->details['reason'] ?? null)->toBe('supplier_archived')
        ->and($order->refresh()->status)->toBe(PurchaseOrderStatus::Draft);

    $supplier->archived_at = null;
    $supplier->save();

    poService()->issue($order->refresh());

    expect($order->refresh()->status)->toBe(PurchaseOrderStatus::Issued);
});

it('refuses to create a draft for a supplier that is already archived', function (): void {
    $supplier = poSupplier($this->world->organisationId);
    $item = poStockItem($this->world->organisationId, 'FLR-1', 'Flour');

    $supplier->archived_at = now();
    $supplier->save();

    $refused = null;

    try {
        poService()->createBatch(
            $this->world->organisationId,
            $this->world->branchId,
            [poOrder($supplier, $item)],
        );
    } catch (ApiException $exception) {
        $refused = $exception;
    }

    // The same code and the same reason issuing gives: a draft that could never
    // be issued is not a useful thing to have created, and one refusal a client
    // handles beats two it has to tell apart.
    expect($refused?->errorCode)->toBe(ErrorCode::ResourceConflict)
        ->and($refused?->details['reason'] ?? null)->toBe('supplier_archived')
        ->and(PurchaseOrder::query()->count())->toBe(0);
});

/* ── the recipient snapshot ──────────────────────────────────────────────── */

it('captures the supplier as it stood at issue and leaves the document alone afterwards', function (): void {
    $supplier = poSupplier($this->world->organisationId, 'SUP-1', 'Gulf Fresh');
    $supplier->name_ar = 'الخليج الطازج';
    $supplier->address = 'Gate 4, behind the cold store';
    $supplier->payment_terms = 'Net 30';
    $supplier->lead_time_days = 2;
    $supplier->contact_email = 'office@gulf.test';
    $supplier->contact_phone = '+96170000000';
    $supplier->save();

    SupplierContact::withoutTenancy()->create([
        'organisation_id' => $this->world->organisationId,
        'supplier_id' => (string) $supplier->getKey(),
        'name' => 'Nadia',
        'role_title' => 'Deliveries',
        'phone' => '+96171111111',
        'is_primary' => false,
        'display_order' => 1,
    ]);
    SupplierContact::withoutTenancy()->create([
        'organisation_id' => $this->world->organisationId,
        'supplier_id' => (string) $supplier->getKey(),
        'name' => 'Samir',
        'role_title' => 'Sales',
        'whatsapp_phone' => '+96172222222',
        'is_primary' => true,
        'display_order' => 2,
    ]);

    $item = poStockItem($this->world->organisationId, 'FLR-1', 'Flour');

    $order = poService()->createBatch(
        $this->world->organisationId,
        $this->world->branchId,
        [poOrder($supplier, $item)],
    )[0];

    // A draft is addressed to nobody yet, so the document field is empty and a
    // preview reads the live record instead.
    expect($order->recipient_snapshot)->toBeNull();

    poService()->issue($order);
    $snapshot = $order->refresh()->recipient_snapshot;

    expect($snapshot['name_en'] ?? null)->toBe('Gulf Fresh')
        ->and($snapshot['name_ar'] ?? null)->toBe('الخليج الطازج')
        ->and($snapshot['address'] ?? null)->toBe('Gate 4, behind the cold store')
        ->and($snapshot['payment_terms'] ?? null)->toBe('Net 30')
        ->and($snapshot['lead_time_days'] ?? null)->toBe(2)
        ->and($snapshot['contact_email'] ?? null)->toBe('office@gulf.test')
        ->and($snapshot['contact_phone'] ?? null)->toBe('+96170000000');

    // Primary first, whatever the display order says — a sheet names the person
    // to call before the person to chase.
    expect(array_column($snapshot['contacts'] ?? [], 'name'))->toBe(['Samir', 'Nadia']);

    // The supplier moves, is renamed and archived. None of it touches the
    // document the supplier is holding a copy of.
    $supplier->name_en = 'Gulf Fresh Trading LLC';
    $supplier->address = 'Unit 12, new market';
    $supplier->archived_at = now();
    $supplier->save();

    $order->refresh();

    expect($order->recipient_snapshot['name_en'])->toBe('Gulf Fresh')
        ->and($order->recipient_snapshot['address'])->toBe('Gate 4, behind the cold store');

    // …while the live reference does move, which is how a screen knows the
    // supplier has since left the book.
    $order->load('supplier');

    expect($order->supplier?->name_en)->toBe('Gulf Fresh Trading LLC')
        ->and($order->supplier?->archived_at)->not->toBeNull();
});
