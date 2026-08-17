<?php

declare(strict_types=1);

use Healthy360\AccessControl\Database\Seeders\AccessControlSeeder;
use Healthy360\AccessControl\Models\Permission;
use Healthy360\AccessControl\Services\PermissionRegistry;
use Healthy360\Organisations\Database\Seeders\OrganisationTypeSeeder;
use Healthy360\Organisations\Models\OrganisationBranch;
use Healthy360\Pricing\Tests\Fixtures\PricingWorld;
use Healthy360\ReferenceData\Database\Seeders\ReferenceDataSeeder;

/*
|--------------------------------------------------------------------------
| Who may open the order book
|--------------------------------------------------------------------------
|
| SUP3, and §5's boundary in test form. The claim being pinned is narrow and
| easy to break in either direction:
|
| - **the ordering code is necessary.** Not implied by `inventory.view_organisation`
|   (a kitchen hand reading shelves), not by `inventory.manage_organisation`
|   (a clerk booking in a delivery), and not by `inventory.view_costs_organisation`
|   (a manager reading the ledger). A caller holding all three and not this one
|   is refused, because who the kitchen buys from and how much of what is a
|   different fact from any of them.
| - **the ordering code is sufficient.** §5 is explicit that a bespoke
|   stock-responsible role must not need a hidden conjunction with the general
|   view code merely to open this screen. A caller holding it and nothing else
|   from the inventory domain gets a 200.
|
| Both routes are checked, because the whole point of the slice is that the
| *reads* are gated too — a badge that leaked the shortage count to every kitchen
| role would have leaked the order book's front door.
|
*/

/**
 * A kitchen, its branch, and a caller holding exactly `$permissions`.
 *
 * Declared here rather than borrowed from the proposal suite beside it: this file's whole subject is
 * what a caller may and may not do, so its fixture must not depend on another file having been
 * loaded first. A permission matrix that quietly passed because a sibling suite defined its world
 * would be the one test in the repository worth least.
 *
 * @param  list<string>  $permissions
 */
function permissionWorld(string $email, array $permissions): object
{
    $tenant = PricingWorld::kitchen($email, $permissions);
    $branch = OrganisationBranch::factory()->create([
        'organisation_id' => $tenant->organisation->getKey(),
        'country_code' => $tenant->organisation->country_code,
    ]);

    return (object) [
        'user' => $tenant->user,
        'branchId' => (string) $branch->getKey(),
        'headers' => PricingWorld::headers($tenant),
    ];
}

/** Context codes with nothing from the inventory domain at all. */
const PERMISSION_CONTEXT_ONLY = [
    'organisation.view_current',
    'branch.view_current',
];

/**
 * The whole ops surface, minus the one code this slice adds. The most demanding
 * negative case: this caller counts stock, posts receipts and reads the
 * valuation ledger, and still may not see what the kitchen is about to buy.
 */
const PERMISSION_OPS_WITHOUT_ORDERING = [
    'organisation.view_current',
    'branch.view_current',
    'inventory.view_organisation',
    'inventory.manage_organisation',
    'inventory.view_costs_organisation',
];

/** Exactly the new code, and no other inventory code — §5's sufficiency claim. */
const PERMISSION_ORDERING_ONLY = [
    'organisation.view_current',
    'branch.view_current',
    'inventory.order_supplies_organisation',
];

beforeEach(function (): void {
    $this->seed([ReferenceDataSeeder::class, OrganisationTypeSeeder::class, AccessControlSeeder::class]);
});

it('refuses both ordering routes to a caller with no inventory permission at all', function (): void {
    $world = permissionWorld('nothing@kitchen.test', PERMISSION_CONTEXT_ONLY);
    $this->actingAs($world->user);

    $query = http_build_query(['branch_id' => $world->branchId]);

    $this->getJson("/api/v1/catalogue/procurement/supply-needs/count?{$query}", $world->headers)
        ->assertForbidden();
    $this->getJson("/api/v1/catalogue/procurement/order-proposal?{$query}", $world->headers)
        ->assertForbidden();
});

it('refuses both ordering routes to a caller holding view, manage and costs but not the ordering code', function (): void {
    $world = permissionWorld('ops@kitchen.test', PERMISSION_OPS_WITHOUT_ORDERING);
    $this->actingAs($world->user);

    $query = http_build_query(['branch_id' => $world->branchId]);

    // The read is gated, not just the write. `inventory.view_organisation` opens
    // the shelves; it does not open the order book, and §5 says so because the
    // book names the kitchen's purchasing relationships.
    $this->getJson("/api/v1/catalogue/procurement/supply-needs/count?{$query}", $world->headers)
        ->assertForbidden();
    $this->getJson("/api/v1/catalogue/procurement/order-proposal?{$query}", $world->headers)
        ->assertForbidden();
});

it('admits a caller holding the ordering code and nothing else from the inventory domain', function (): void {
    $world = permissionWorld('buyer@kitchen.test', PERMISSION_ORDERING_ONLY);
    $this->actingAs($world->user);

    $query = http_build_query(['branch_id' => $world->branchId]);

    // No hidden conjunction. A bespoke stock-responsible role that never needs
    // the stock screen is a role this platform can express.
    $this->getJson("/api/v1/catalogue/procurement/supply-needs/count?{$query}", $world->headers)
        ->assertOk()
        ->assertJsonPath('data.count', 0)
        ->assertJsonPath('data.out_of_stock_count', 0)
        ->assertJsonPath('data.low_stock_count', 0);

    $this->getJson("/api/v1/catalogue/procurement/order-proposal?{$query}", $world->headers)
        ->assertOk()
        ->assertJsonPath('data.items', []);
});

it('registers the ordering code in the inventory domain and grants it to the kitchen manager alone', function (): void {
    $registered = PermissionRegistry::organisationPermissions()['inventory.order_supplies_organisation'] ?? null;

    expect($registered)->toBe([
        'domain' => 'inventory',
        'description' => 'Prepare, issue, print and cancel supplier purchase orders',
    ]);

    // Seeded, not merely declared — the registry is the source and the row is
    // what the permission middleware actually reads.
    expect(Permission::query()->where('code', 'inventory.order_supplies_organisation')->value('description'))
        ->toBe('Prepare, issue, print and cancel supplier purchase orders');

    $roles = PermissionRegistry::templateRoles();

    expect($roles['kitchen_manager']['permissions'])->toContain('inventory.order_supplies_organisation');

    // The three roles §5 names explicitly, and the chef beside them. A kitchen
    // hand who counts shelves, a chef who writes formulations, a desk agent who
    // sells and a commercial manager who reads margins are none of them the
    // person who decides what the kitchen buys.
    foreach (['order_desk_agent', 'kitchen_chef', 'kitchen_staff', 'commercial_manager'] as $code) {
        expect($roles[$code]['permissions'])->not->toContain('inventory.order_supplies_organisation');
    }
});
