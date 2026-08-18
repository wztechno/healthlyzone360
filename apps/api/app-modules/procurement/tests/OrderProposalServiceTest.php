<?php

declare(strict_types=1);

use Healthy360\AccessControl\Database\Seeders\AccessControlSeeder;
use Healthy360\Ingredients\Models\Ingredient;
use Healthy360\Inventory\Models\StockItem;
use Healthy360\Inventory\Models\StockLevel;
use Healthy360\Organisations\Database\Seeders\OrganisationTypeSeeder;
use Healthy360\Organisations\Models\OrganisationBranch;
use Healthy360\Pricing\Tests\Fixtures\PricingWorld;
use Healthy360\Procurement\Models\Supplier;
use Healthy360\Procurement\Models\SupplierStockItem;
use Healthy360\ReferenceData\Database\Seeders\ReferenceDataSeeder;
use Healthy360\ReferenceData\Models\MeasurementUnit;

/*
|--------------------------------------------------------------------------
| The order proposal — what one branch should buy, and who from
|--------------------------------------------------------------------------
|
| SUP3. The builder's whole read, and the rules §4 states about it. Six things
| are pinned here rather than trusted, and every one of them is a rule that
| looks obvious until somebody writes the query a second time:
|
| - **the union is a union** — emptiness *or* lowness, a level meeting both
|   appearing exactly once and labelled out of stock, and the threshold
|   comparison inclusive at the boundary;
| - **out-of-stock rows come first** — the order is the answer, not a hint, and
|   the client is forbidden from re-sorting it;
| - **suggestions are par-only** — §2's second correction, pinned negatively as
|   well as positively: a shelf with a threshold and no par gets *nothing*, and
|   the test asserts the threshold arithmetic that would be the obvious wrong
|   answer is absent;
| - **a requested shelf with no level is a zero, not a level row** — the branch's
|   books are not edited by somebody opening a picker;
| - **supplier resolution is preferred → sole → nobody**, with archived links
|   diagnosed apart from absent ones;
| - **the count endpoint and the proposal cannot disagree**, and **no money
|   reaches this payload at any depth**.
|
*/

/**
 * A kitchen, its branch, and a caller holding the ordering permission.
 *
 * @param  list<string>  $permissions
 */
function proposalWorld(string $email, array $permissions = PricingWorld::FULL_PERMISSIONS): object
{
    $tenant = PricingWorld::kitchen($email, $permissions);
    $branch = OrganisationBranch::factory()->create([
        'organisation_id' => $tenant->organisation->getKey(),
        'country_code' => $tenant->organisation->country_code,
    ]);

    return (object) [
        'tenant' => $tenant,
        'organisationId' => (string) $tenant->organisation->getKey(),
        'user' => $tenant->user,
        'branchId' => (string) $branch->getKey(),
        'headers' => PricingWorld::headers($tenant),
    ];
}

/**
 * A shelf, derived the way INV2.0 derives one — an ingredient behind it and a
 * real unit, so the row is the same shape the builder would meet in production.
 */
function proposalStockItem(string $organisationId, string $code, string $name): StockItem
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

/** A branch's running quantity, written straight in rather than moved into place. */
function proposalLevel(
    string $organisationId,
    string $branchId,
    StockItem $item,
    string $quantity,
    ?string $threshold = null,
    ?string $par = null,
): StockLevel {
    return StockLevel::withoutTenancy()->create([
        'organisation_id' => $organisationId,
        'branch_id' => $branchId,
        'stock_item_id' => (string) $item->getKey(),
        'quantity' => $quantity,
        'reorder_threshold' => $threshold,
        'par_level' => $par,
    ]);
}

function proposalSupplier(string $organisationId, string $code, string $name, bool $archived = false): Supplier
{
    return Supplier::withoutTenancy()->create([
        'organisation_id' => $organisationId,
        'code' => $code,
        'name_en' => $name,
        'archived_at' => $archived ? now() : null,
    ]);
}

function proposalLink(string $organisationId, Supplier $supplier, StockItem $item, bool $preferred = false): SupplierStockItem
{
    return SupplierStockItem::withoutTenancy()->create([
        'organisation_id' => $organisationId,
        'supplier_id' => (string) $supplier->getKey(),
        'stock_item_id' => (string) $item->getKey(),
        'is_preferred' => $preferred,
    ]);
}

/**
 * Every key anywhere in a decoded response body, however deeply nested.
 *
 * @param  mixed  $value
 * @return list<string>
 */
function proposalKeysDeep($value): array
{
    if (! is_array($value)) {
        return [];
    }

    $keys = [];

    foreach ($value as $key => $nested) {
        if (is_string($key)) {
            $keys[] = $key;
        }

        $keys = array_merge($keys, proposalKeysDeep($nested));
    }

    return $keys;
}

beforeEach(function (): void {
    $this->seed([ReferenceDataSeeder::class, OrganisationTypeSeeder::class, AccessControlSeeder::class]);
    $this->world = proposalWorld('proposal@kitchen.test');
    $this->actingAs($this->world->user);
    $this->headers = $this->world->headers;
    $this->proposal = fn (array $query = []) => $this->getJson(
        '/api/v1/catalogue/procurement/order-proposal?'.http_build_query(
            ['branch_id' => $this->world->branchId] + $query
        ),
        $this->headers,
    );
});

it('queues empty and low shelves once each, out of stock first, and leaves healthy ones out', function (): void {
    $organisationId = $this->world->organisationId;

    // No threshold and nothing left. INV1.3's low-stock rule ignores this row
    // entirely — which is exactly why the ordering queue needs its own union.
    $almonds = proposalStockItem($organisationId, 'ALM-1', 'Almonds');
    proposalLevel($organisationId, $this->world->branchId, $almonds, '0.0000');

    // Exactly at the threshold. Inclusive: this is the moment to reorder, not
    // one unit later.
    $butter = proposalStockItem($organisationId, 'BUT-1', 'Butter');
    proposalLevel($organisationId, $this->world->branchId, $butter, '5.0000', '5.0000');

    // Both rules at once. One row, labelled out of stock.
    $coriander = proposalStockItem($organisationId, 'COR-1', 'Coriander');
    proposalLevel($organisationId, $this->world->branchId, $coriander, '0.0000', '3.0000');

    // Comfortably above its threshold, and a shelf nobody asked to be warned
    // about with plenty on it. Neither belongs in an ordering queue.
    $dates = proposalStockItem($organisationId, 'DAT-1', 'Dates');
    proposalLevel($organisationId, $this->world->branchId, $dates, '20.0000', '5.0000');
    $eggs = proposalStockItem($organisationId, 'EGG-1', 'Eggs');
    proposalLevel($organisationId, $this->world->branchId, $eggs, '8.0000');

    $response = ($this->proposal)()->assertOk();

    // Out of stock first (Almonds, Coriander — alphabetical within the group),
    // then low (Butter). Never re-sorted by the client, so the server owes it.
    expect($response->json('data.items.*.item_code'))->toBe(['ALM-1', 'COR-1', 'BUT-1']);

    $response
        ->assertJsonPath('data.items.0.origin', 'out_of_stock')
        ->assertJsonPath('data.items.0.is_out_of_stock', true)
        // No threshold set means never low, even at zero — the flags are
        // independent readings of the numbers beside them.
        ->assertJsonPath('data.items.0.is_low', false)
        ->assertJsonPath('data.items.1.origin', 'out_of_stock')
        ->assertJsonPath('data.items.1.is_out_of_stock', true)
        // Genuinely both, and counted once as the emptier of the two.
        ->assertJsonPath('data.items.1.is_low', true)
        ->assertJsonPath('data.items.2.origin', 'low_stock')
        ->assertJsonPath('data.items.2.is_out_of_stock', false)
        ->assertJsonPath('data.items.2.is_low', true)
        ->assertJsonPath('meta.out_of_stock_count', 2)
        ->assertJsonPath('meta.low_stock_count', 1)
        ->assertJsonPath('meta.requested_item_count', 0)
        ->assertJsonPath('meta.branch_id', $this->world->branchId);
});

it('suggests par minus on hand and never threshold arithmetic', function (): void {
    $organisationId = $this->world->organisationId;

    // A usable par: two on the shelf, restock to ten.
    $rice = proposalStockItem($organisationId, 'RIC-1', 'Rice');
    proposalLevel($organisationId, $this->world->branchId, $rice, '2.0000', '5.0000', '10.0000');

    // A par at or below what is already there. Ordering zero is not an order,
    // so there is no suggestion at all rather than a "0.0000" somebody submits.
    $salt = proposalStockItem($organisationId, 'SAL-1', 'Salt');
    proposalLevel($organisationId, $this->world->branchId, $salt, '10.0000', '12.0000', '10.0000');

    // The §2 correction, pinned negatively. A threshold and no par must produce
    // *nothing* — `5 - 1 = 4` would replenish the shelf exactly back onto the
    // boundary that raised the alarm, so the item would be low again the moment
    // the delivery was booked in.
    $thyme = proposalStockItem($organisationId, 'THY-1', 'Thyme');
    proposalLevel($organisationId, $this->world->branchId, $thyme, '1.0000', '5.0000');

    $response = ($this->proposal)()->assertOk();

    $rows = collect($response->json('data.items'))->keyBy('item_code');

    expect($rows['RIC-1']['suggested_quantity'])->toBe('8.0000')
        ->and($rows['RIC-1']['suggested_quantity_basis'])->toBe('par')
        ->and($rows['SAL-1']['suggested_quantity'])->toBeNull()
        ->and($rows['SAL-1']['suggested_quantity_basis'])->toBe('none')
        ->and($rows['THY-1']['suggested_quantity'])->toBeNull()
        ->and($rows['THY-1']['suggested_quantity_basis'])->toBe('none')
        // The wrong answer, named so a future implementation cannot drift into it.
        ->and($rows['THY-1']['suggested_quantity'])->not->toBe('4.0000');
});

it('appends a requested shelf as a zero without writing a level row, and never twice', function (): void {
    $organisationId = $this->world->organisationId;

    $flour = proposalStockItem($organisationId, 'FLR-1', 'Flour');
    proposalLevel($organisationId, $this->world->branchId, $flour, '0.0000');

    // Never moved at this branch: no level row exists and none may be created.
    $vanilla = proposalStockItem($organisationId, 'VAN-1', 'Vanilla');

    $levelsBefore = StockLevel::withoutTenancy()->count();

    $response = ($this->proposal)([
        // The already-short shelf is asked for as well: it must stay one row,
        // and keep the label the queue gave it.
        'stock_item_ids' => [(string) $vanilla->getKey(), (string) $flour->getKey()],
    ])->assertOk();

    expect($response->json('data.items.*.item_code'))->toBe(['FLR-1', 'VAN-1']);

    $response
        ->assertJsonPath('data.items.0.origin', 'out_of_stock')
        ->assertJsonPath('data.items.1.origin', 'requested')
        ->assertJsonPath('data.items.1.quantity_on_hand', '0.0000')
        ->assertJsonPath('data.items.1.reorder_threshold', null)
        ->assertJsonPath('data.items.1.par_level', null)
        // Follows from the quantity beside it — a client handed "0.0000" and
        // `false` could not reconcile the two.
        ->assertJsonPath('data.items.1.is_out_of_stock', true)
        ->assertJsonPath('data.items.1.is_low', false)
        ->assertJsonPath('data.items.1.suggested_quantity', null)
        // Requested rows are not shortages: they must not move the tallies the
        // hub badge reads.
        ->assertJsonPath('meta.out_of_stock_count', 1)
        ->assertJsonPath('meta.low_stock_count', 0)
        ->assertJsonPath('meta.requested_item_count', 1);

    expect(StockLevel::withoutTenancy()->count())->toBe($levelsBefore);
});

it('resolves the preferred supplier, then the sole one, then nobody — and tells archived apart from absent', function (): void {
    $organisationId = $this->world->organisationId;
    $branchId = $this->world->branchId;

    $gulf = proposalSupplier($organisationId, 'GULF-01', 'Gulf Fresh');
    $bekaa = proposalSupplier($organisationId, 'BEKAA-01', 'Bekaa Farms');
    $shuttered = proposalSupplier($organisationId, 'OLD-01', 'Old Depot', archived: true);

    // Two candidates and a preference: the preference wins.
    $apricots = proposalStockItem($organisationId, 'APR-1', 'Apricots');
    proposalLevel($organisationId, $branchId, $apricots, '0.0000');
    proposalLink($organisationId, $gulf, $apricots);
    proposalLink($organisationId, $bekaa, $apricots, preferred: true);

    // One candidate and no preference: sole is obvious enough.
    $basil = proposalStockItem($organisationId, 'BAS-1', 'Basil');
    proposalLevel($organisationId, $branchId, $basil, '0.0000');
    proposalLink($organisationId, $gulf, $basil);

    // Two candidates and no preference: the system offers none and the person
    // chooses — which is *not* the same as having nobody to choose from.
    $cumin = proposalStockItem($organisationId, 'CUM-1', 'Cumin');
    proposalLevel($organisationId, $branchId, $cumin, '0.0000');
    proposalLink($organisationId, $gulf, $cumin);
    proposalLink($organisationId, $bekaa, $cumin);

    // Nobody was ever linked.
    $dill = proposalStockItem($organisationId, 'DIL-1', 'Dill');
    proposalLevel($organisationId, $branchId, $dill, '0.0000');

    // Linked, but every link is to an archived supplier. A different problem
    // with a different fix, so a different reason.
    $endive = proposalStockItem($organisationId, 'END-1', 'Endive');
    proposalLevel($organisationId, $branchId, $endive, '0.0000');
    proposalLink($organisationId, $shuttered, $endive, preferred: true);

    $rows = collect(($this->proposal)()->assertOk()->json('data.items'))->keyBy('item_code');

    expect($rows['APR-1']['suggested_supplier_id'])->toBe((string) $bekaa->getKey())
        ->and($rows['APR-1']['supplier_options'])->toHaveCount(2)
        // Preferred first, then by name — the obvious answer at the top of the
        // list a person opens.
        ->and($rows['APR-1']['supplier_options'][0]['name_en'])->toBe('Bekaa Farms')
        ->and($rows['APR-1']['supplier_options'][0]['is_preferred'])->toBeTrue()
        ->and($rows['APR-1']['unassigned_reason'])->toBeNull()
        ->and($rows['BAS-1']['suggested_supplier_id'])->toBe((string) $gulf->getKey())
        ->and($rows['BAS-1']['unassigned_reason'])->toBeNull()
        // No suggestion, but not unassigned: there are two perfectly good
        // options and the system declines to guess between them.
        ->and($rows['CUM-1']['suggested_supplier_id'])->toBeNull()
        ->and($rows['CUM-1']['supplier_options'])->toHaveCount(2)
        ->and($rows['CUM-1']['unassigned_reason'])->toBeNull()
        ->and($rows['DIL-1']['supplier_options'])->toBe([])
        ->and($rows['DIL-1']['unassigned_reason'])->toBe('no_supplier')
        // Archived suppliers never reach a picker, but the row still says why
        // it is empty.
        ->and($rows['END-1']['supplier_options'])->toBe([])
        ->and($rows['END-1']['suggested_supplier_id'])->toBeNull()
        ->and($rows['END-1']['unassigned_reason'])->toBe('suppliers_archived');

    ($this->proposal)()->assertJsonPath('meta.unassigned_count', 2);
});

it('counts exactly what the supply-needs count endpoint counts', function (): void {
    $organisationId = $this->world->organisationId;
    $branchId = $this->world->branchId;

    foreach ([['A-1', '0.0000', null], ['B-1', '0.0000', '4.0000'], ['C-1', '3.0000', '3.0000'], ['D-1', '9.0000', '2.0000']] as [$code, $quantity, $threshold]) {
        $item = proposalStockItem($organisationId, $code, 'Item '.$code);
        proposalLevel($organisationId, $branchId, $item, $quantity, $threshold);
    }

    // A requested row is deliberately added: the count endpoint knows nothing
    // about it, and the proposal's shortage tallies must not either.
    $extra = proposalStockItem($organisationId, 'E-1', 'Item E-1');

    $proposal = ($this->proposal)(['stock_item_ids' => [(string) $extra->getKey()]])->assertOk();

    $count = $this->getJson(
        '/api/v1/catalogue/procurement/supply-needs/count?'.http_build_query(['branch_id' => $branchId]),
        $this->headers,
    )->assertOk();

    $outOfStock = $proposal->json('meta.out_of_stock_count');
    $low = $proposal->json('meta.low_stock_count');

    expect($count->json('data.out_of_stock_count'))->toBe($outOfStock)
        ->and($count->json('data.low_stock_count'))->toBe($low)
        // The partition: two tallies that add up to the total, because a level
        // that is both empty and below its threshold is counted once.
        ->and($count->json('data.count'))->toBe($outOfStock + $low)
        ->and($count->json('data.count'))->toBe(3)
        // …and the proposal really did carry the requested row on top.
        ->and($proposal->json('data.items'))->toHaveCount(4);
});

it('serves no price, cost, currency or amount anywhere in the payload', function (): void {
    $organisationId = $this->world->organisationId;

    $item = proposalStockItem($organisationId, 'OIL-1', 'Olive oil');
    proposalLevel($organisationId, $this->world->branchId, $item, '0.0000', '4.0000', '20.0000');
    proposalLink($organisationId, proposalSupplier($organisationId, 'GULF-01', 'Gulf Fresh'), $item, preferred: true);

    $body = ($this->proposal)()->assertOk()->json();

    // Structural rather than field-by-field: the way this rule breaks is
    // somebody adding one helpful column, and a whitelist of forbidden field
    // names would not have listed it. §5 keeps deciding what to buy and reading
    // the valuation ledger apart, and the builder holds only the first.
    $offending = array_values(array_filter(
        array_unique(proposalKeysDeep($body)),
        static fn (string $key): bool => (bool) preg_match('/price|cost|currency|amount|total/i', $key),
    ));

    expect($offending)->toBe([]);
});

it('keeps one branch out of another branch\'s proposal and one kitchen out of another kitchen\'s', function (): void {
    $organisationId = $this->world->organisationId;

    $elsewhere = OrganisationBranch::factory()->create([
        'organisation_id' => $organisationId,
        'country_code' => 'LB',
    ]);

    $here = proposalStockItem($organisationId, 'HER-1', 'Here');
    proposalLevel($organisationId, $this->world->branchId, $here, '0.0000');

    $there = proposalStockItem($organisationId, 'THR-1', 'There');
    proposalLevel($organisationId, (string) $elsewhere->getKey(), $there, '0.0000');

    // Stock is a quantity on a shelf at a site: the other branch's shortage is
    // not this branch's problem and summing them would be the one mistake a buy
    // list must never make.
    expect(($this->proposal)()->assertOk()->json('data.items.*.item_code'))->toBe(['HER-1']);

    $stranger = proposalWorld('stranger@kitchen.test');

    // Another kitchen's branch and another kitchen's shelf are both `422`
    // naming the field, never an empty page that reads as a fact.
    $this->getJson(
        '/api/v1/catalogue/procurement/order-proposal?'.http_build_query(['branch_id' => $stranger->branchId]),
        $this->headers,
    )->assertStatus(422)->assertJsonPath('error.details.fields.branch_id.0', fn (?string $message): bool => $message !== null);

    $strangerItem = proposalStockItem($stranger->organisationId, 'FOR-1', 'Foreign');

    $this->getJson(
        '/api/v1/catalogue/procurement/order-proposal?'.http_build_query([
            'branch_id' => $this->world->branchId,
            'stock_item_ids' => [(string) $strangerItem->getKey()],
        ]),
        $this->headers,
    )->assertStatus(422);

    // And the count endpoint draws the same line.
    $this->getJson(
        '/api/v1/catalogue/procurement/supply-needs/count?'.http_build_query(['branch_id' => $stranger->branchId]),
        $this->headers,
    )->assertStatus(422);
});
