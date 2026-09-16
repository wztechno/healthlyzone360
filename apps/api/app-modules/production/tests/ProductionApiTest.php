<?php

declare(strict_types=1);

use Healthy360\AccessControl\Database\Seeders\AccessControlSeeder;
use Healthy360\Ingredients\Models\Ingredient;
use Healthy360\Inventory\Models\IngredientStockCost;
use Healthy360\Inventory\Models\StockItem;
use Healthy360\Inventory\Services\InventoryService;
use Healthy360\Organisations\Database\Seeders\OrganisationTypeSeeder;
use Healthy360\Organisations\Models\OrganisationBranch;
use Healthy360\Pricing\Tests\Fixtures\PricingWorld;
use Healthy360\Production\Models\ProductionOrder;
use Healthy360\Recipes\Models\Recipe;
use Healthy360\Recipes\Models\RecipeVersion;
use Healthy360\Recipes\Models\RecipeVersionLine;
use Healthy360\Recipes\Models\RecipeVersionOutput;
use Healthy360\ReferenceData\Database\Seeders\ReferenceDataSeeder;
use Healthy360\ReferenceData\Models\MeasurementUnit;
use Healthy360\Tenancy\TenantContext;

/*
|--------------------------------------------------------------------------
| The production endpoints
|--------------------------------------------------------------------------
|
| `ProductionOrderTest` proves the lifecycle. What is proved here is what lives
| on the routes and nowhere else: the permission split, the cost redaction that
| happens **inside** the payload rather than at the door, the cross-organisation
| 404, and the `If-Match` every write insists on.
|
*/

const PRODUCTION_VIEW = 'production.view_organisation';
const PRODUCTION_MANAGE = 'production.manage_organisation';
const PRODUCTION_COSTS = 'production.view_costs_organisation';

beforeEach(function (): void {
    $this->seed([ReferenceDataSeeder::class, OrganisationTypeSeeder::class, AccessControlSeeder::class]);

    $this->kg = MeasurementUnit::query()->where('code', 'kg')->sole();
    $this->litre = MeasurementUnit::query()->where('code', 'l')->sole();

    $this->world = function (string $email, array $permissions): object {
        $tenant = PricingWorld::kitchen($email, $permissions);

        $branch = OrganisationBranch::factory()->create([
            'organisation_id' => $tenant->organisation->getKey(),
            'country_code' => $tenant->organisation->country_code,
        ]);

        app(TenantContext::class)->setOrganisation(
            (string) $tenant->user->getKey(),
            (string) $tenant->organisation->getKey(),
        );

        $flour = apiIngredientShelf($this, $tenant, $branch, $this->kg, '100');
        $dressing = apiIngredientShelf($this, $tenant, $branch, $this->litre, '0');

        $recipe = Recipe::factory()->create(['organisation_id' => $tenant->organisation->getKey()]);

        $version = RecipeVersion::factory()->published()->create([
            'recipe_id' => $recipe->getKey(),
            'organisation_id' => $tenant->organisation->getKey(),
            'yield_quantity' => '20',
            'yield_unit_id' => (string) $this->litre->getKey(),
            'yield_piece_count' => 1,
            'waste_coefficient_percent' => '0.00',
        ]);

        RecipeVersionLine::factory()->create([
            'recipe_version_id' => $version->getKey(),
            'organisation_id' => $tenant->organisation->getKey(),
            'line_number' => 1,
            'ingredient_id' => $flour->ingredient_id,
            'quantity' => '5',
            'unit_id' => (string) $this->kg->getKey(),
        ]);

        RecipeVersionOutput::factory()->create([
            'recipe_version_id' => $version->getKey(),
            'organisation_id' => $tenant->organisation->getKey(),
            'ingredient_id' => $dressing->ingredient_id,
            'output_quantity' => '20',
            'unit_id' => (string) $this->litre->getKey(),
            'is_primary' => true,
        ]);

        app(TenantContext::class)->clear();

        return (object) [
            'tenant' => $tenant,
            'branch' => $branch,
            'version' => $version,
            'flour' => $flour,
            'dressing' => $dressing,
            'headers' => PricingWorld::headers($tenant),
        ];
    };
});

afterEach(function (): void {
    app(TenantContext::class)->clear();
});

/** An ingredient, its derived shelf, a typed purchase price and an opening quantity. */
function apiIngredientShelf(object $test, object $tenant, OrganisationBranch $branch, MeasurementUnit $unit, string $onShelf): StockItem
{
    $ingredient = Ingredient::factory()->create([
        'organisation_id' => $tenant->organisation->getKey(),
        'default_unit_id' => (string) $unit->getKey(),
        'purchase_price_amount' => '2.000000',
        'purchase_price_currency' => 'USD',
        'purchase_unit_id' => (string) $unit->getKey(),
    ]);

    // The shelf the observer already derived — never a second one, or the
    // explosion picks between them by code.
    $item = StockItem::withoutTenancy()
        ->where('organisation_id', $tenant->organisation->getKey())
        ->where('ingredient_id', $ingredient->getKey())
        ->sole();

    // A moving average as well as a typed price. They answer different questions
    // and a batch needs both: the typed price is what the **estimate** stands on
    // at confirm, and the moving average is what the **actual** valuation reads
    // at completion. A shelf with only the first completes `unvalued`.
    IngredientStockCost::query()->create([
        'organisation_id' => $tenant->organisation->getKey(),
        'ingredient_id' => (string) $ingredient->getKey(),
        'unit_id' => (string) $unit->getKey(),
        'quantity_on_hand' => $onShelf,
        'moving_average_cost_amount' => '2.000000',
        'last_purchase_cost_amount' => '2.000000',
        'currency_code' => 'USD',
    ]);

    if (bccomp($onShelf, '0', 6) > 0) {
        app(InventoryService::class)->recordMovement(
            (string) $tenant->organisation->getKey(),
            (string) $branch->getKey(),
            (string) $item->getKey(),
            'receipt',
            $onShelf,
        );
    }

    return $item;
}

it('serves the desk queue to a holder of the view code, with costs when they hold that too', function (): void {
    $world = ($this->world)('desk@kitchen.test', [PRODUCTION_VIEW, PRODUCTION_MANAGE, PRODUCTION_COSTS]);
    $this->actingAs($world->tenant->user);

    $this->postJson('/api/v1/catalogue/production/orders', [
        'branch_id' => (string) $world->branch->getKey(),
        'recipe_version_id' => (string) $world->version->getKey(),
        'planned_yield' => 40,
    ], $world->headers)->assertCreated();

    $this->getJson('/api/v1/catalogue/production/orders', $world->headers)
        ->assertOk()
        ->assertJsonPath('data.production_orders.0.status', 'draft')
        ->assertJsonPath('data.production_orders.0.batch_factor', '2.000000')
        ->assertJsonPath('meta.costs_visible', true)
        ->assertJsonPath('meta.has_more', false)
        // Present and null: the draft has not been costed yet, which is a
        // different answer from "you may not see this".
        ->assertJsonPath('data.production_orders.0.estimated_cost_amount', null);
});

it('redacts the money inside the payload rather than refusing the whole desk', function (): void {
    // A chef runs the line and does not see what the line cost. A 403 here would
    // blank a screen they are entitled to read every quantity on.
    $world = ($this->world)('chef@kitchen.test', [PRODUCTION_VIEW, PRODUCTION_MANAGE]);
    $this->actingAs($world->tenant->user);

    $created = $this->postJson('/api/v1/catalogue/production/orders', [
        'branch_id' => (string) $world->branch->getKey(),
        'recipe_version_id' => (string) $world->version->getKey(),
        'batch_factor' => 2,
    ], $world->headers)->assertCreated();

    $orderId = $created->json('data.production_order.id');

    $response = $this->getJson('/api/v1/catalogue/production/orders/'.$orderId, $world->headers)
        ->assertOk()
        ->assertJsonPath('meta.costs_visible', false)
        ->assertJsonMissingPath('data.production_order.estimated_cost_amount');

    // The plan is served, and served without its money — quantities are not the
    // confidential half.
    expect($response->json('data.plan.ingredients.0.required'))->toBe('10.000000')
        ->and($response->json('data.plan.ingredients.0.estimated_unit_cost_amount'))->toBeNull()
        ->and($response->json('data.plan.estimated_cost_amount'))->toBeNull();
});

it('refuses the desk entirely to somebody with neither production code', function (): void {
    $world = ($this->world)('nobody@kitchen.test', ['catalogue.view_organisation']);
    $this->actingAs($world->tenant->user);

    $this->getJson('/api/v1/catalogue/production/orders', $world->headers)
        ->assertStatus(403)
        ->assertJsonPath('error.code', 'authz.permission_denied');
});

it('refuses a write to a holder of the view code alone', function (): void {
    $world = ($this->world)('reader@kitchen.test', [PRODUCTION_VIEW]);
    $this->actingAs($world->tenant->user);

    $this->postJson('/api/v1/catalogue/production/orders', [
        'branch_id' => (string) $world->branch->getKey(),
        'recipe_version_id' => (string) $world->version->getKey(),
        'batch_factor' => 1,
    ], $world->headers)->assertStatus(403);
});

it('answers another kitchen’s batch with a 404 rather than a 403', function (): void {
    // Telling somebody that a production order exists and is not theirs is
    // itself a disclosure — it confirms a competitor runs batches.
    $mine = ($this->world)('mine@kitchen.test', [PRODUCTION_VIEW, PRODUCTION_MANAGE]);
    $theirs = ($this->world)('theirs@kitchen.test', [PRODUCTION_VIEW, PRODUCTION_MANAGE]);

    $this->actingAs($theirs->tenant->user);

    $created = $this->postJson('/api/v1/catalogue/production/orders', [
        'branch_id' => (string) $theirs->branch->getKey(),
        'recipe_version_id' => (string) $theirs->version->getKey(),
        'batch_factor' => 1,
    ], $theirs->headers)->assertCreated();

    $this->actingAs($mine->tenant->user);

    $this->getJson('/api/v1/catalogue/production/orders/'.$created->json('data.production_order.id'), $mine->headers)
        ->assertStatus(404)
        ->assertJsonPath('error.code', 'resource.not_found');
});

it('insists on an If-Match on every batch edge', function (): void {
    $world = ($this->world)('locked@kitchen.test', [PRODUCTION_VIEW, PRODUCTION_MANAGE]);
    $this->actingAs($world->tenant->user);

    $created = $this->postJson('/api/v1/catalogue/production/orders', [
        'branch_id' => (string) $world->branch->getKey(),
        'recipe_version_id' => (string) $world->version->getKey(),
        'batch_factor' => 2,
    ], $world->headers)->assertCreated();

    $orderId = $created->json('data.production_order.id');

    // A 428 rather than a 400: the client has to read the resource first, and
    // the status says exactly that.
    $this->postJson('/api/v1/catalogue/production/orders/'.$orderId.'/confirm', [], $world->headers)
        ->assertStatus(428)
        ->assertJsonPath('error.code', 'request.precondition_required');

    // A stale validator loses the race and is told the current version.
    $this->postJson(
        '/api/v1/catalogue/production/orders/'.$orderId.'/confirm',
        [],
        $world->headers + ['If-Match' => '"99"'],
    )->assertStatus(409)->assertJsonPath('error.code', 'resource.conflict');

    $this->postJson(
        '/api/v1/catalogue/production/orders/'.$orderId.'/confirm',
        [],
        $world->headers + ['If-Match' => '"0"'],
    )->assertOk()->assertJsonPath('data.production_order.status', 'confirmed');
});

it('walks a batch from draft to completed over the wire', function (): void {
    $world = ($this->world)('walk@kitchen.test', [PRODUCTION_VIEW, PRODUCTION_MANAGE, PRODUCTION_COSTS]);
    $this->actingAs($world->tenant->user);

    $orderId = $this->postJson('/api/v1/catalogue/production/orders', [
        'branch_id' => (string) $world->branch->getKey(),
        'recipe_version_id' => (string) $world->version->getKey(),
        'planned_yield' => 40,
    ], $world->headers)->assertCreated()->json('data.production_order.id');

    $confirmed = $this->postJson(
        '/api/v1/catalogue/production/orders/'.$orderId.'/confirm',
        [],
        $world->headers + ['If-Match' => '"0"'],
    )->assertOk();

    expect($confirmed->json('data.production_order.reference'))->toStartWith('PB-')
        ->and($confirmed->json('data.lines.0.reserved_quantity'))->toBe('10.0000')
        // Ten kilos of flour at the typed two dollars.
        ->and($confirmed->json('data.production_order.estimated_cost_amount'))->toBe('20.000000');

    $started = $this->postJson(
        '/api/v1/catalogue/production/orders/'.$orderId.'/start',
        [],
        $world->headers + ['If-Match' => '"'.$confirmed->json('data.production_order.lock_version').'"'],
    )->assertOk();

    $completed = $this->postJson(
        '/api/v1/catalogue/production/orders/'.$orderId.'/complete',
        ['produced_quantity' => 38, 'rejected_quantity' => 1, 'expiry_date' => '2026-10-20'],
        $world->headers + ['If-Match' => '"'.$started->json('data.production_order.lock_version').'"'],
    )->assertOk();

    expect($completed->json('data.production_order.status'))->toBe('completed')
        // 38 made, one rejected, 37 on the shelf. The usable figure is computed
        // so a client never has to know which of the two is the shelf number.
        ->and($completed->json('data.production_order.usable_yield_quantity'))->toBe('37.0000')
        ->and($completed->json('data.production_order.yield_variance_quantity'))->toBe('-2.0000')
        ->and($completed->json('data.production_order.actual_cost_status'))->toBe('complete')
        ->and($completed->json('data.production_order.expiry_date'))->toBe('2026-10-20');
});

it('serves the batch technical sheet off the confirm-time snapshot', function (): void {
    $world = ($this->world)('sheet@kitchen.test', [PRODUCTION_VIEW, PRODUCTION_MANAGE, PRODUCTION_COSTS]);
    $this->actingAs($world->tenant->user);

    $orderId = $this->postJson('/api/v1/catalogue/production/orders', [
        'branch_id' => (string) $world->branch->getKey(),
        'recipe_version_id' => (string) $world->version->getKey(),
        'planned_yield' => 40,
    ], $world->headers)->assertCreated()->json('data.production_order.id');

    // A draft has no snapshot yet, and says so with empty lines rather than a
    // 404: the batch exists, and saying so is more useful than pretending it
    // does not.
    $this->getJson('/api/v1/catalogue/production/orders/'.$orderId.'/technical-sheet', $world->headers)
        ->assertOk()
        ->assertJsonPath('data.technical_sheet.lines', [])
        ->assertJsonPath('data.technical_sheet.yield.planned_quantity', '40.0000');

    $this->postJson(
        '/api/v1/catalogue/production/orders/'.$orderId.'/confirm',
        [],
        $world->headers + ['If-Match' => '"0"'],
    )->assertOk();

    $this->getJson('/api/v1/catalogue/production/orders/'.$orderId.'/technical-sheet', $world->headers)
        ->assertOk()
        ->assertJsonPath('data.technical_sheet.lines.0.required_quantity', '10.0000')
        ->assertJsonPath('data.technical_sheet.lines.0.cost_source', 'fallback')
        ->assertJsonPath('data.technical_sheet.basis.recipe_version_id', (string) $world->version->getKey())
        ->assertJsonPath('meta.costs_visible', true);
});

it('replays a confirm delivered twice under one idempotency key', function (): void {
    $world = ($this->world)('replay@kitchen.test', [PRODUCTION_VIEW, PRODUCTION_MANAGE]);
    $this->actingAs($world->tenant->user);

    $orderId = $this->postJson('/api/v1/catalogue/production/orders', [
        'branch_id' => (string) $world->branch->getKey(),
        'recipe_version_id' => (string) $world->version->getKey(),
        'batch_factor' => 1,
    ], $world->headers)->assertCreated()->json('data.production_order.id');

    $headers = $world->headers + ['If-Match' => '"0"', 'Idempotency-Key' => 'confirm-once'];

    $first = $this->postJson('/api/v1/catalogue/production/orders/'.$orderId.'/confirm', [], $headers)->assertOk();

    // The second delivery replays the first envelope rather than running the
    // command again — and without the key it would have been a `409` on the now
    // stale `If-Match`, which is a *different* guard catching a *different*
    // failure.
    $second = $this->postJson('/api/v1/catalogue/production/orders/'.$orderId.'/confirm', [], $headers)->assertOk();

    expect($second->json('data.production_order.reference'))
        ->toBe($first->json('data.production_order.reference'))
        ->and($second->headers->get('Idempotency-Replayed'))->toBe('true');
});

it('names abandon when a cancellation is asked for on a batch that took stock', function (): void {
    $world = ($this->world)('stop@kitchen.test', [PRODUCTION_VIEW, PRODUCTION_MANAGE]);
    $this->actingAs($world->tenant->user);

    $orderId = $this->postJson('/api/v1/catalogue/production/orders', [
        'branch_id' => (string) $world->branch->getKey(),
        'recipe_version_id' => (string) $world->version->getKey(),
        'batch_factor' => 1,
    ], $world->headers)->assertCreated()->json('data.production_order.id');

    $confirmed = $this->postJson(
        '/api/v1/catalogue/production/orders/'.$orderId.'/confirm',
        [],
        $world->headers + ['If-Match' => '"0"'],
    )->assertOk();

    $started = $this->postJson(
        '/api/v1/catalogue/production/orders/'.$orderId.'/start',
        [],
        $world->headers + ['If-Match' => '"'.$confirmed->json('data.production_order.lock_version').'"'],
    )->assertOk();

    // Something has moved: one kilo of flour is gone, recorded against this
    // batch.
    app(TenantContext::class)->setOrganisation(
        (string) $world->tenant->user->getKey(),
        (string) $world->tenant->organisation->getKey(),
    );

    app(InventoryService::class)->recordMovement(
        (string) $world->tenant->organisation->getKey(),
        (string) $world->branch->getKey(),
        (string) $world->flour->getKey(),
        'consume',
        '-1',
        ProductionOrder::MOVEMENT_REFERENCE,
        $orderId,
    );

    app(TenantContext::class)->clear();

    $this->postJson(
        '/api/v1/catalogue/production/orders/'.$orderId.'/cancel',
        [],
        $world->headers + ['If-Match' => '"'.$started->json('data.production_order.lock_version').'"'],
    )
        ->assertStatus(409)
        ->assertJsonPath('error.code', 'production.consumption_recorded')
        ->assertJsonPath('error.details.use_instead', 'abandon');
});
