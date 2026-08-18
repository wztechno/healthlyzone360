<?php

declare(strict_types=1);

use Healthy360\AccessControl\Database\Seeders\AccessControlSeeder;
use Healthy360\Ingredients\Models\Ingredient;
use Healthy360\Inventory\Models\StockItem;
use Healthy360\Organisations\Database\Seeders\OrganisationTypeSeeder;
use Healthy360\Organisations\Models\OrganisationBranch;
use Healthy360\Pricing\Tests\Fixtures\PricingWorld;
use Healthy360\Procurement\Models\Supplier;
use Healthy360\ReferenceData\Database\Seeders\ReferenceDataSeeder;
use Healthy360\ReferenceData\Models\MeasurementUnit;

/*
|--------------------------------------------------------------------------
| The order-book endpoints — who may open them, and what is not in them
|--------------------------------------------------------------------------
|
| SUP4. Two claims, and they are the two that a screen cannot make for itself:
|
| - **the ordering code gates all six routes, reads included.** §5 is explicit
|   that plain `inventory.view_organisation` must not expose the order book, and
|   the negative case here is the demanding one: a caller who counts stock,
|   posts receipts *and* reads the valuation ledger still may not see what the
|   kitchen is about to buy. The positive case is the other half — the code is
|   sufficient on its own, with no hidden conjunction.
| - **no purchase-order response carries money.** §3.5 puts actual prices on
|   receipts, where each partial delivery carries the figure it was really
|   invoiced at, and the structural test walks every key at every depth of every
|   response this surface serves. The way this rule breaks is somebody adding a
|   helpful column, and it breaks quietly.
|
*/

/**
 * A kitchen, a branch, and a caller holding exactly `$permissions`.
 *
 * @param  list<string>  $permissions
 */
function poApiWorld(string $email, array $permissions): object
{
    $tenant = PricingWorld::kitchen($email, $permissions);
    $branch = OrganisationBranch::factory()->create([
        'organisation_id' => $tenant->organisation->getKey(),
        'country_code' => $tenant->organisation->country_code,
    ]);

    return (object) [
        'user' => $tenant->user,
        'organisationId' => (string) $tenant->organisation->getKey(),
        'branchId' => (string) $branch->getKey(),
        'headers' => PricingWorld::headers($tenant),
    ];
}

/** The whole ops surface minus the one code this slice's routes take. */
const PO_OPS_WITHOUT_ORDERING = [
    'organisation.view_current',
    'branch.view_current',
    'inventory.view_organisation',
    'inventory.manage_organisation',
    'inventory.view_costs_organisation',
];

/** Exactly the ordering code — §5's sufficiency claim. */
const PO_ORDERING_ONLY = [
    'organisation.view_current',
    'branch.view_current',
    'inventory.order_supplies_organisation',
];

/**
 * Every key at every depth of a decoded response body.
 *
 * Recursive rather than a top-level scan, because the shape that would break
 * the rule is a price nested inside a line or inside the recipient snapshot —
 * exactly where a top-level check would not look.
 *
 * @param  array<array-key, mixed>  $value
 * @return list<string>
 */
function poApiKeys(array $value): array
{
    $keys = [];

    foreach ($value as $key => $child) {
        if (is_string($key)) {
            $keys[] = $key;
        }

        if (is_array($child)) {
            $keys = [...$keys, ...poApiKeys($child)];
        }
    }

    return $keys;
}

beforeEach(function (): void {
    $this->seed([ReferenceDataSeeder::class, OrganisationTypeSeeder::class, AccessControlSeeder::class]);
});

/* ── the permission matrix ───────────────────────────────────────────────── */

it('refuses every purchase-order route to a caller holding view, manage and costs but not the ordering code', function (): void {
    $world = poApiWorld('ops@kitchen.test', PO_OPS_WITHOUT_ORDERING);
    $this->actingAs($world->user);

    $someId = '01935f6d-0000-7000-8000-0000000000aa';

    $this->getJson('/api/v1/catalogue/procurement/purchase-orders', $world->headers)->assertForbidden();
    $this->getJson("/api/v1/catalogue/procurement/purchase-orders/{$someId}", $world->headers)->assertForbidden();
    $this->postJson('/api/v1/catalogue/procurement/purchase-orders', ['orders' => []], $world->headers)->assertForbidden();
    $this->patchJson("/api/v1/catalogue/procurement/purchase-orders/{$someId}", [], $world->headers)->assertForbidden();
    $this->postJson("/api/v1/catalogue/procurement/purchase-orders/{$someId}/issue", [], $world->headers)->assertForbidden();
    $this->postJson("/api/v1/catalogue/procurement/purchase-orders/{$someId}/cancel", [], $world->headers)->assertForbidden();
});

it('admits a caller holding the ordering code and nothing else from the inventory domain', function (): void {
    $world = poApiWorld('buyer@kitchen.test', PO_ORDERING_ONLY);
    $this->actingAs($world->user);

    // No hidden conjunction with the general view code: a bespoke
    // stock-responsible role that never opens the stock screen is a role this
    // platform can express.
    $this->getJson('/api/v1/catalogue/procurement/purchase-orders', $world->headers)
        ->assertOk()
        ->assertJsonPath('data.purchase_orders', []);
});

/* ── the whole lifecycle, and the money that is not in it ────────────────── */

it('creates, reads, edits, issues and cancels an order without a price anywhere in any response', function (): void {
    $world = poApiWorld('lifecycle@kitchen.test', PricingWorld::FULL_PERMISSIONS);
    $this->actingAs($world->user);

    $kg = MeasurementUnit::query()->where('code', 'kg')->sole();

    $supplier = Supplier::withoutTenancy()->create([
        'organisation_id' => $world->organisationId,
        'code' => 'SUP-1',
        'name_en' => 'Gulf Fresh',
        // A currency on the supplier record is a hint the receipt form
        // pre-selects, not an amount — and the order shape does not echo it.
        'currency_code' => 'USD',
    ]);

    $ingredient = Ingredient::factory()->create([
        'organisation_id' => $world->organisationId,
        'default_unit_id' => (string) $kg->getKey(),
    ]);

    $item = StockItem::withoutTenancy()->create([
        'organisation_id' => $world->organisationId,
        'code' => 'FLR-1',
        'name_en' => 'Flour',
        'unit_code' => 'kg',
        'unit_id' => (string) $kg->getKey(),
        'ingredient_id' => (string) $ingredient->getKey(),
    ]);

    $bodies = [];

    $created = $this->postJson('/api/v1/catalogue/procurement/purchase-orders', [
        'orders' => [[
            'supplier_id' => (string) $supplier->getKey(),
            'branch_id' => $world->branchId,
            'lines' => [['stock_item_id' => (string) $item->getKey(), 'quantity' => '2.5000']],
        ]],
    ], $world->headers)
        ->assertCreated()
        ->assertJsonPath('data.purchase_orders.0.status', 'draft')
        ->assertJsonPath('data.purchase_orders.0.line_count', 1)
        ->assertJsonPath('data.purchase_orders.0.recipient_snapshot', null)
        ->assertJsonPath('data.purchase_orders.0.lines.0.item_name_en', 'Flour')
        ->assertJsonPath('data.purchase_orders.0.lines.0.unit_code', 'kg');

    $bodies[] = $created->json();
    $orderId = $created->json('data.purchase_orders.0.id');

    $bodies[] = $this->getJson('/api/v1/catalogue/procurement/purchase-orders', $world->headers)
        ->assertOk()
        ->assertJsonPath('data.purchase_orders.0.id', $orderId)
        ->json();

    // The batch read a print preview makes: several orders as one request.
    $bodies[] = $this->getJson(
        '/api/v1/catalogue/procurement/purchase-orders?'.http_build_query(['ids' => [$orderId]]),
        $world->headers,
    )->assertOk()->json();

    $bodies[] = $this->getJson("/api/v1/catalogue/procurement/purchase-orders/{$orderId}", $world->headers)
        ->assertOk()
        ->json();

    $bodies[] = $this->patchJson("/api/v1/catalogue/procurement/purchase-orders/{$orderId}", [
        'notes' => 'Before service, please',
        'lines' => [['stock_item_id' => (string) $item->getKey(), 'quantity' => '4']],
    ], $world->headers)
        ->assertOk()
        ->assertJsonPath('data.purchase_order.notes', 'Before service, please')
        ->assertJsonPath('data.purchase_order.lines.0.quantity', '4.0000')
        ->json();

    $bodies[] = $this->postJson("/api/v1/catalogue/procurement/purchase-orders/{$orderId}/issue", [], $world->headers)
        ->assertOk()
        ->assertJsonPath('data.purchase_order.status', 'issued')
        ->assertJsonPath('data.purchase_order.recipient_snapshot.name_en', 'Gulf Fresh')
        ->json();

    // Issued is frozen — the refusal is a conflict with a reason, not a 422.
    $this->patchJson("/api/v1/catalogue/procurement/purchase-orders/{$orderId}", [
        'notes' => 'Too late',
    ], $world->headers)
        ->assertStatus(409)
        ->assertJsonPath('error.details.reason', 'purchase_order_not_draft');

    $bodies[] = $this->postJson("/api/v1/catalogue/procurement/purchase-orders/{$orderId}/cancel", [], $world->headers)
        ->assertOk()
        ->assertJsonPath('data.purchase_order.status', 'cancelled')
        ->json();

    // The structural boundary §3.5 draws, walked at every depth of every
    // response this surface serves. A supplier's `currency_code` is on the
    // supplier record and deliberately not echoed here.
    foreach ($bodies as $body) {
        foreach (poApiKeys($body) as $key) {
            expect($key)->not->toMatch('/amount|price|cost|currency/i');
        }
    }
});

it('answers a cross-organisation order identifier as not found', function (): void {
    $mine = poApiWorld('mine@kitchen.test', PricingWorld::FULL_PERMISSIONS);
    $theirs = poApiWorld('theirs@kitchen.test', PricingWorld::FULL_PERMISSIONS);

    $kg = MeasurementUnit::query()->where('code', 'kg')->sole();

    $supplier = Supplier::withoutTenancy()->create([
        'organisation_id' => $theirs->organisationId,
        'code' => 'SUP-9',
        'name_en' => 'Their supplier',
    ]);

    $ingredient = Ingredient::factory()->create([
        'organisation_id' => $theirs->organisationId,
        'default_unit_id' => (string) $kg->getKey(),
    ]);

    $item = StockItem::withoutTenancy()->create([
        'organisation_id' => $theirs->organisationId,
        'code' => 'FLR-9',
        'name_en' => 'Their flour',
        'unit_code' => 'kg',
        'unit_id' => (string) $kg->getKey(),
        'ingredient_id' => (string) $ingredient->getKey(),
    ]);

    $this->actingAs($theirs->user);

    $orderId = $this->postJson('/api/v1/catalogue/procurement/purchase-orders', [
        'orders' => [[
            'supplier_id' => (string) $supplier->getKey(),
            'branch_id' => $theirs->branchId,
            'lines' => [['stock_item_id' => (string) $item->getKey(), 'quantity' => '1']],
        ]],
    ], $theirs->headers)->assertCreated()->json('data.purchase_orders.0.id');

    $this->actingAs($mine->user);

    // Not found rather than forbidden, and the list simply does not contain it:
    // whether another kitchen's order exists is itself the answer this tenant
    // is not entitled to.
    $this->getJson("/api/v1/catalogue/procurement/purchase-orders/{$orderId}", $mine->headers)
        ->assertNotFound();

    $this->getJson('/api/v1/catalogue/procurement/purchase-orders', $mine->headers)
        ->assertOk()
        ->assertJsonPath('data.purchase_orders', []);
});
