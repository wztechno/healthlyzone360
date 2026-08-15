<?php

declare(strict_types=1);

use Healthy360\AccessControl\Database\Seeders\AccessControlSeeder;
use Healthy360\AccessControl\Models\Permission;
use Healthy360\AccessControl\Models\RolePermission;
use Healthy360\Cart\Tests\Fixtures\CheckoutWorld;
use Healthy360\Orders\Tests\Fixtures\OrderWorld;
use Healthy360\Organisations\Database\Seeders\OrganisationTypeSeeder;
use Healthy360\ReferenceData\Database\Seeders\ReferenceDataSeeder;

/*
|--------------------------------------------------------------------------
| The kitchen's four verbs, and the three ways they refuse
|--------------------------------------------------------------------------
|
| `OrderApiSmokeTest` proves the placement and the one confirm that follows it;
| this is the rest of the lifecycle surface — `fulfil`, `cancel`, and the three
| distinct refusals the contract promises when a caller gets it wrong.
|
| **The three refusals are three different answers, and asserting them together
| is the point.** A missing `If-Match` is `428` — the client never entered a
| race. A stale one is `409 resource.conflict` — it entered and lost. An
| illegal move is also `409`, but with `details.transition` naming both ends
| and the edges that do exist, because a client that sent "confirm" against a
| fulfilled order needs to be told what the order *is*, not that its verb was
| invalid. A suite that collapsed any two of those would let the middleware and
| the state machine swap answers without a test noticing.
|
| The index filters are asserted here rather than in the smoke file for the
| same reason: `status` and `query` are the two the kitchen's book is actually
| read through, and an unknown `status` is `400 request.invalid` — a filter is
| not a submitted field, so it does not go through the validator.
|
| Setup is `OrderApiSmokeTest`'s: `CheckoutWorld` does not grant the `order.*`
| pair, so the two codes are attached here as well. Placement is
| `OrderWorld::place()` rather than a second trip through `POST /orders` — the
| HTTP placement has its own file, and arranging three orders over it would
| make every failure in this one ambiguous.
|
*/

beforeEach(function (): void {
    $this->seed([ReferenceDataSeeder::class, OrganisationTypeSeeder::class, AccessControlSeeder::class]);

    $this->world = CheckoutWorld::build('lifecycle@kitchen.test');

    foreach (['order.view_organisation', 'order.manage_organisation'] as $code) {
        RolePermission::factory()->create([
            'organisation_id' => $this->world->organisation->getKey(),
            'role_id' => $this->world->tenant->role->getKey(),
            'permission_id' => Permission::query()->where('code', $code)->sole()->getKey(),
        ]);
    }

    $this->kitchenHeaders = firstPartyHeaders() + ['X-Organisation-Id' => (string) $this->world->organisation->getKey()];

    $this->actingAs($this->world->tenant->user);
});

it('walks an order from placed through confirmed to fulfilled, one validator at a time', function (): void {
    $order = OrderWorld::place($this->world);

    expect($order->status->value)->toBe('placed');

    $confirmed = $this->postJson('/api/v1/catalogue/orders/'.$order->getKey().'/confirm', [], $this->kitchenHeaders + [
        'If-Match' => '"'.$order->lock_version.'"',
    ])
        ->assertOk()
        ->assertJsonPath('data.order.status', 'confirmed')
        ->assertJsonPath('data.order.confirmed_at', fn (mixed $at): bool => is_string($at))
        ->assertJsonPath('data.order.fulfilled_at', null)
        ->assertJsonPath('data.order.cancelled_at', null);

    // The transition moved the validator, so the *next* action is written
    // against the ETag this response carried, never the one the list showed.
    $afterConfirm = $confirmed->headers->get('ETag');

    expect($afterConfirm)->toBe('"'.($order->lock_version + 1).'"')
        ->and($confirmed->json('data.order.lock_version'))->toBe($order->lock_version + 1);

    $fulfilled = $this->postJson('/api/v1/catalogue/orders/'.$order->getKey().'/fulfil', [], $this->kitchenHeaders + [
        'If-Match' => $afterConfirm,
    ])
        ->assertOk()
        ->assertJsonPath('data.order.status', 'fulfilled')
        ->assertJsonPath('data.order.fulfilled_at', fn (mixed $at): bool => is_string($at))
        // Each transition stamps its own column rather than overwriting one
        // field, which is what makes "how long from taking to delivering"
        // answerable a month later.
        ->assertJsonPath('data.order.confirmed_at', $confirmed->json('data.order.confirmed_at'))
        ->assertJsonPath('data.order.cancelled_at', null)
        ->assertJsonPath('data.order.lock_version', $order->lock_version + 2)
        ->assertHeader('ETag', '"'.($order->lock_version + 2).'"');

    // The kitchen's own read agrees with what the command just returned.
    $this->getJson('/api/v1/catalogue/orders/'.$order->getKey(), $this->kitchenHeaders)
        ->assertOk()
        ->assertJsonPath('data.order.status', 'fulfilled')
        ->assertJsonPath('data.order.lock_version', $fulfilled->json('data.order.lock_version'));
});

it('cancels an order against a stated reason, and refuses one that states none', function (): void {
    $order = OrderWorld::place($this->world);

    $ifMatch = ['If-Match' => '"'.$order->lock_version.'"'];

    // A reason is required rather than nullable, because one order cancelled
    // "for no stated reason" is the row that makes every count wrong. The
    // rejection is `validation.failed`, not the state machine's conflict: the
    // move is legal, the body is not.
    $this->postJson('/api/v1/catalogue/orders/'.$order->getKey().'/cancel', [], $this->kitchenHeaders + $ifMatch)
        ->assertStatus(422)
        ->assertJsonPath('error.code', 'validation.failed')
        ->assertJsonStructure(['error' => ['code', 'message', 'details', 'correlation_id']]);

    // Free text is refused for the same reason the column is an enum.
    $this->postJson('/api/v1/catalogue/orders/'.$order->getKey().'/cancel', [
        'reason' => 'we ran out of chicken',
    ], $this->kitchenHeaders + $ifMatch)
        ->assertStatus(422)
        ->assertJsonPath('error.code', 'validation.failed');

    // A refused body is not a transition, so the validator has not moved.
    expect($order->fresh()->lock_version)->toBe($order->lock_version);

    $this->postJson('/api/v1/catalogue/orders/'.$order->getKey().'/cancel', [
        'reason' => 'kitchen_unable_to_fulfil',
    ], $this->kitchenHeaders + $ifMatch)
        ->assertOk()
        ->assertJsonPath('data.order.status', 'cancelled')
        ->assertJsonPath('data.order.cancellation_reason', 'kitchen_unable_to_fulfil')
        ->assertJsonPath('data.order.cancelled_at', fn (mixed $at): bool => is_string($at))
        ->assertHeader('ETag', '"'.($order->lock_version + 1).'"');

    // Cancelled is not deleted: the row keeps its number, its lines and the
    // prices they were sold at.
    $this->getJson('/api/v1/catalogue/orders/'.$order->getKey(), $this->kitchenHeaders)
        ->assertOk()
        ->assertJsonPath('data.order.order_number', $order->order_number)
        ->assertJsonPath('data.order.line_count', 1);
});

it('answers a missing validator differently from a stale one', function (): void {
    $order = OrderWorld::place($this->world);

    $url = '/api/v1/catalogue/orders/'.$order->getKey().'/confirm';

    // Never entered the race: 428, and the answer names the header to send.
    $this->postJson($url, [], $this->kitchenHeaders)
        ->assertStatus(428)
        ->assertJsonPath('error.code', 'request.precondition_required')
        ->assertJsonPath('error.details.required_headers', ['If-Match']);

    // Sent something that is not a Healthy360 validator at all: a malformed
    // request rather than a lost race, so 400 rather than 409.
    $this->postJson($url, [], $this->kitchenHeaders + ['If-Match' => '"abc"'])
        ->assertStatus(400)
        ->assertJsonPath('error.code', 'request.invalid');

    // Entered and lost: the row is real, the move is legal, the version is
    // somebody else's.
    $this->postJson($url, [], $this->kitchenHeaders + ['If-Match' => '"999"'])
        ->assertStatus(409)
        ->assertJsonPath('error.code', 'resource.conflict')
        ->assertJsonStructure(['error' => ['code', 'message', 'correlation_id']]);

    // Three refusals, and none of them moved the order.
    expect($order->fresh()->status->value)->toBe('placed')
        ->and($order->fresh()->lock_version)->toBe($order->lock_version);
});

it('refuses a move the state machine has no edge for, and names both ends', function (): void {
    $order = OrderWorld::place($this->world);

    // `placed → fulfilled` skips the confirmation. The refusal arrives before
    // the conditional UPDATE, so a correct `If-Match` does not buy it.
    $this->postJson('/api/v1/catalogue/orders/'.$order->getKey().'/fulfil', [], $this->kitchenHeaders + [
        'If-Match' => '"'.$order->lock_version.'"',
    ])
        ->assertStatus(409)
        ->assertJsonPath('error.code', 'resource.conflict')
        ->assertJsonPath('error.details.transition.from', 'placed')
        ->assertJsonPath('error.details.transition.to', 'fulfilled')
        ->assertJsonPath('error.details.transition.allowed', ['confirmed', 'cancelled']);

    $confirmed = $this->postJson('/api/v1/catalogue/orders/'.$order->getKey().'/confirm', [], $this->kitchenHeaders + [
        'If-Match' => '"'.$order->lock_version.'"',
    ])->assertOk();

    $fulfilled = $this->postJson('/api/v1/catalogue/orders/'.$order->getKey().'/fulfil', [], $this->kitchenHeaders + [
        'If-Match' => $confirmed->headers->get('ETag'),
    ])->assertOk();

    $terminal = $fulfilled->headers->get('ETag');

    // Fulfilled is terminal in both directions, and the empty `allowed` list is
    // how a client learns there is nothing left to send.
    $this->postJson('/api/v1/catalogue/orders/'.$order->getKey().'/confirm', [], $this->kitchenHeaders + [
        'If-Match' => $terminal,
    ])
        ->assertStatus(409)
        ->assertJsonPath('error.details.transition.from', 'fulfilled')
        ->assertJsonPath('error.details.transition.to', 'confirmed')
        ->assertJsonPath('error.details.transition.allowed', []);

    $this->postJson('/api/v1/catalogue/orders/'.$order->getKey().'/cancel', [
        'reason' => 'customer_requested',
    ], $this->kitchenHeaders + ['If-Match' => $terminal])
        ->assertStatus(409)
        ->assertJsonPath('error.details.transition.from', 'fulfilled')
        ->assertJsonPath('error.details.transition.to', 'cancelled');

    expect($order->fresh()->status->value)->toBe('fulfilled');
});

it('narrows the kitchen book by status and by order number, and rejects a status it does not have', function (): void {
    $stillOpen = OrderWorld::place($this->world);
    $movedOn = OrderWorld::place($this->world);

    $this->postJson('/api/v1/catalogue/orders/'.$movedOn->getKey().'/confirm', [], $this->kitchenHeaders + [
        'If-Match' => '"'.$movedOn->lock_version.'"',
    ])->assertOk();

    // An omitted status hides nothing: a cancelled or confirmed order is part
    // of the book a kitchen reconciles against.
    $all = $this->getJson('/api/v1/catalogue/orders', $this->kitchenHeaders)
        ->assertOk()
        ->assertJsonStructure(['data', 'meta' => ['count', 'next_cursor', 'has_more', 'correlation_id']])
        ->assertJsonPath('meta.count', 2)
        ->assertJsonPath('meta.has_more', false);

    // Newest first, so the second placement leads.
    expect($all->json('data.0.id'))->toBe((string) $movedOn->getKey());

    $placed = $this->getJson('/api/v1/catalogue/orders?status=placed', $this->kitchenHeaders)
        ->assertOk()
        ->assertJsonPath('meta.count', 1)
        ->assertJsonPath('data.0.id', (string) $stillOpen->getKey())
        ->assertJsonPath('data.0.status', 'placed');

    expect($placed->json('data'))->toHaveCount(1);

    $this->getJson('/api/v1/catalogue/orders?status=confirmed', $this->kitchenHeaders)
        ->assertOk()
        ->assertJsonPath('meta.count', 1)
        ->assertJsonPath('data.0.id', (string) $movedOn->getKey());

    // The search is the order number and nothing else, and it is
    // case-insensitive because the number is read off a receipt by hand.
    $this->getJson('/api/v1/catalogue/orders?query='.mb_strtolower(substr($stillOpen->order_number, -8)), $this->kitchenHeaders)
        ->assertOk()
        ->assertJsonPath('meta.count', 1)
        ->assertJsonPath('data.0.order_number', $stillOpen->order_number);

    $this->getJson('/api/v1/catalogue/orders?query=ORD-NOTHINGHERE', $this->kitchenHeaders)
        ->assertOk()
        ->assertJsonPath('meta.count', 0)
        ->assertJsonPath('data', []);

    // A filter is not a submitted field, so an unknown value is
    // `request.invalid` rather than `validation.failed`.
    $this->getJson('/api/v1/catalogue/orders?status=delivered', $this->kitchenHeaders)
        ->assertStatus(400)
        ->assertJsonPath('error.code', 'request.invalid')
        ->assertJsonPath('error.details.parameter', 'status');

    $this->getJson('/api/v1/catalogue/orders?requested_delivery_date=tomorrow', $this->kitchenHeaders)
        ->assertStatus(400)
        ->assertJsonPath('error.code', 'request.invalid')
        ->assertJsonPath('error.details.parameter', 'requested_delivery_date');
});
