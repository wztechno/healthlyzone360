<?php

declare(strict_types=1);

use Carbon\CarbonImmutable;
use Healthy360\AccessControl\Database\Seeders\AccessControlSeeder;
use Healthy360\Allergens\Models\Allergen;
use Healthy360\Audit\Models\AuditLog;
use Healthy360\Cart\Services\CartService;
use Healthy360\Customers\Enums\AllergenSeverity;
use Healthy360\Customers\Guest\Services\GuestDeletionService;
use Healthy360\Customers\Models\CustomerAccount;
use Healthy360\Customers\Models\CustomerAllergenDeclaration;
use Healthy360\Customers\Models\CustomerDietaryProfile;
use Healthy360\Orders\Contracts\BuyerAllergenCheck;
use Healthy360\Orders\Enums\FulfilmentType;
use Healthy360\Orders\Enums\OrderStatus;
use Healthy360\Orders\Enums\PaymentMethod;
use Healthy360\Orders\Exceptions\PlacementRefused;
use Healthy360\Orders\Models\Order;
use Healthy360\Orders\Models\OrderComplaint;
use Healthy360\Orders\Presenters\OrderPresenter;
use Healthy360\Orders\Services\ComposedLine;
use Healthy360\Orders\Services\ComposedPlacement;
use Healthy360\Orders\Services\OrderPlacementService;
use Healthy360\Orders\Services\OrderSnapshotRedaction;
use Healthy360\Orders\Tests\Fixtures\DeskWorld;
use Healthy360\Organisations\Database\Seeders\OrganisationTypeSeeder;
use Healthy360\ReferenceData\Database\Seeders\ReferenceDataSeeder;
use Healthy360\Subscriptions\Services\BuyerAllergenCheckAdapter;
use Healthy360\Support\Api\Exceptions\ApiException;
use Healthy360\Support\Models\StaffNotification;
use Healthy360\Tenancy\Tests\Fixtures\RuntimeRole;

/*
|--------------------------------------------------------------------------
| Every declared allergy reaches the cook
|--------------------------------------------------------------------------
|
| The audit placed an order for a customer with an anaphylaxis note and found
| nothing on the kitchen's payload. These pin the note arriving, on every path
| that writes an order, and what the desk must do before selling a conflict.
|
| The world's meal has no recipe, so it is `unassessed` and conflicts with any
| declaration: a conflict is the default here, and a no-conflict case marks the
| customer's allergy by declaring nothing the check can see.
|
*/

beforeEach(function (): void {
    $this->seed([ReferenceDataSeeder::class, OrganisationTypeSeeder::class, AccessControlSeeder::class]);

    $this->world = DeskWorld::build('allergy@kitchen.test');
    $this->agent = DeskWorld::agent($this->world, 'allergy-agent@desk.test');
    $this->manager = DeskWorld::agent($this->world, 'allergy-manager@desk.test', ['order.supervise_organisation']);
    $this->headers = DeskWorld::headers($this->world);
    $this->account = $this->world->customer->account;

    $this->actingAs($this->agent);
});

function declareAllergy(CustomerAccount $account, AllergenSeverity $severity = AllergenSeverity::Anaphylaxis, ?string $notes = 'Carries an EpiPen'): void
{
    $allergen = Allergen::factory()->create(['code' => 'sesame']);

    $profile = CustomerDietaryProfile::query()->where('customer_account_id', $account->getKey())->firstOrFail();
    $profile->declares_no_allergens = false;
    $profile->save();

    CustomerAllergenDeclaration::query()->create([
        'customer_dietary_profile_id' => $profile->getKey(),
        'allergen_code' => $allergen->code,
        'severity' => $severity,
        'notes' => $notes,
        'declared_at' => CarbonImmutable::now(),
    ]);
}

/**
 * @param  array<string, mixed>  $overrides
 * @return array<string, mixed>
 */
function allergyPickupBody(object $test, array $overrides = []): array
{
    return [
        'fulfilment_type' => 'pickup',
        'payment_method' => 'cash_at_counter',
        'customer_account_id' => (string) $test->account->getKey(),
        'lines' => [['catalogue_item_id' => (string) $test->world->meal->getKey(), 'quantity' => 1]],
        ...$overrides,
    ];
}

/**
 * @param  array<string, mixed>  $overrides
 */
function allergyPlacement(object $test, array $overrides = []): ComposedPlacement
{
    return new ComposedPlacement(...[
        'account' => $test->account,
        'address' => null,
        'organisationId' => (string) $test->world->organisation->getKey(),
        'salesChannelId' => (string) $test->world->desk->getKey(),
        'branchId' => (string) $test->world->branch->getKey(),
        'currencyCode' => 'USD',
        'lines' => [new ComposedLine(catalogueItemId: (string) $test->world->meal->getKey())],
        'fulfilmentType' => FulfilmentType::Pickup,
        'paymentMethod' => PaymentMethod::CashAtCounter,
        ...$overrides,
    ]);
}

it('snapshots the allergy on a customer order, conflict and all', function (): void {
    declareAllergy($this->account);

    $carts = app(CartService::class);
    $cart = $carts->getOrCreate($this->account, $this->world->channel);
    $carts->addItem($cart, (string) $this->world->meal->getKey(), quantity: 1);

    $order = app(OrderPlacementService::class)->place(
        $cart->refresh(),
        $this->world->customer->address,
        allergenConflictsAcknowledged: true,
    )->order;

    expect($order->allergy_snapshot)->toHaveCount(1)
        ->and($order->allergy_snapshot[0])->toMatchArray([
            'allergen_code' => 'sesame',
            'severity' => 'anaphylaxis',
            'notes' => 'Carries an EpiPen',
            'conflicts_with_line' => [(string) $order->lines()->sole()->getKey()],
        ])
        ->and($order->allergy_acknowledged_at)->not->toBeNull()
        // The customer acknowledged it: nobody at the kitchen did.
        ->and($order->allergy_acknowledged_by)->toBeNull();
});

it('snapshots an allergy the basket does not conflict with', function (): void {
    declareAllergy($this->account);

    // A subscription day and a quotation meet no gate, so the conflict-free
    // shape is the same write. The check says the meal is safe.
    app()->bind(
        BuyerAllergenCheck::class,
        fn () => new class(app(BuyerAllergenCheckAdapter::class)) implements BuyerAllergenCheck
        {
            public function __construct(private BuyerAllergenCheck $real) {}

            public function conflicts(CustomerAccount $account, array $catalogueItemIds): array
            {
                return [];
            }

            public function declared(CustomerAccount $account): array
            {
                return $this->real->declared($account);
            }
        },
    );

    $order = app(OrderPlacementService::class)->placeComposed(allergyPlacement($this))->order;

    expect($order->allergy_snapshot[0]['allergen_code'])->toBe('sesame')
        ->and($order->allergy_snapshot[0]['conflicts_with_line'])->toBe([])
        ->and($order->allergy_acknowledged_at)->toBeNull();
});

it('snapshots a subscription order without alerting, because it would fire daily', function (): void {
    declareAllergy($this->account);

    $order = app(OrderPlacementService::class)->placeComposed(allergyPlacement($this, [
        'enforceWindowOffer' => false,
    ]))->order;

    expect($order->allergy_snapshot)->toHaveCount(1)
        ->and(StaffNotification::withoutTenancy()->where('type', 'allergy_order')->count())->toBe(0);
});

it('stores nothing for a customer who declared nothing', function (): void {
    $order = app(OrderPlacementService::class)->placeComposed(allergyPlacement($this))->order;

    expect($order->allergy_snapshot)->toBeNull()
        ->and($order->allergy_note)->toBeNull()
        ->and($order->allergy_acknowledged_at)->toBeNull();
});

it('refuses a desk conflict until acknowledged, and stores the cashier', function (): void {
    declareAllergy($this->account);

    $this->postJson(
        '/api/v1/catalogue/order-desk/orders',
        allergyPickupBody($this),
        $this->headers + ['Idempotency-Key' => 'allergy-refused'],
    )
        ->assertStatus(409)
        ->assertJsonPath('error.code', 'order.placement_refused')
        ->assertJsonPath('error.details.reasons.0.reason', 'allergen_conflict');

    expect(Order::query()->count())->toBe(0);

    $response = $this->postJson(
        '/api/v1/catalogue/order-desk/orders',
        allergyPickupBody($this, ['acknowledge_allergen_conflicts' => true]),
        $this->headers + ['Idempotency-Key' => 'allergy-acknowledged'],
    )->assertCreated();

    $order = Order::query()->sole();

    expect($order->allergy_acknowledged_by)->toBe((string) $this->agent->getKey())
        ->and($order->allergy_acknowledged_at)->not->toBeNull();

    $response->assertJsonPath('data.order.allergy.acknowledged_at', $order->allergy_acknowledged_at->toIso8601String());
});

it('runs the same check on a counter sale that names a customer', function (): void {
    declareAllergy($this->account);

    $body = [
        'fulfilment_type' => 'counter',
        'payment_method' => 'cash_at_counter',
        'payment' => ['method' => 'cash_at_counter'],
        'customer_account_id' => (string) $this->account->getKey(),
        'lines' => [['catalogue_item_id' => (string) $this->world->meal->getKey(), 'quantity' => 1]],
    ];

    $this->postJson('/api/v1/catalogue/order-desk/orders', $body, $this->headers + ['Idempotency-Key' => 'counter-refused'])
        ->assertStatus(409);

    $this->postJson(
        '/api/v1/catalogue/order-desk/orders',
        [...$body, 'acknowledge_allergen_conflicts' => true, 'allergy_note' => 'Asked twice about sesame'],
        $this->headers + ['Idempotency-Key' => 'counter-acknowledged'],
    )->assertCreated();

    expect(Order::query()->sole()->allergy_note)->toBe('Asked twice about sesame');
});

it('stores a walk-in note with no account and no snapshot', function (): void {
    $this->postJson('/api/v1/catalogue/order-desk/orders', [
        'fulfilment_type' => 'counter',
        'payment_method' => 'cash_at_counter',
        'payment' => ['method' => 'cash_at_counter'],
        'allergy_note' => 'Says no nuts, severe',
        'lines' => [['catalogue_item_id' => (string) $this->world->meal->getKey(), 'quantity' => 1]],
    ], $this->headers + ['Idempotency-Key' => 'walk-in-note'])
        ->assertCreated()
        ->assertJsonPath('data.order.allergy.note', 'Says no nuts, severe')
        ->assertJsonPath('data.order.allergy.severe', false)
        ->assertJsonPath('data.order.allergy.items', []);

    $order = Order::query()->sole();

    expect($order->customer_account_id)->toBeNull()
        ->and($order->allergy_snapshot)->toBeNull();
});

it('serves the customer notes on the kitchen payload, recording why', function (): void {
    declareAllergy($this->account);

    $this->postJson(
        '/api/v1/catalogue/order-desk/orders',
        allergyPickupBody($this, ['acknowledge_allergen_conflicts' => true]),
        $this->headers + ['Idempotency-Key' => 'kitchen-payload'],
    )->assertCreated();

    $order = Order::query()->sole();

    $this->getJson("/api/v1/catalogue/orders/{$order->getKey()}", $this->headers)
        ->assertOk()
        ->assertJsonPath('data.order.allergy.severe', true)
        ->assertJsonPath('data.order.allergy.items.0.allergen_code', 'sesame')
        ->assertJsonPath('data.order.allergy.items.0.severity', 'anaphylaxis')
        ->assertJsonPath('data.order.allergy.items.0.notes', 'Carries an EpiPen');

    // A second read the same day adds nothing: the board polls.
    $this->getJson("/api/v1/catalogue/orders/{$order->getKey()}", $this->headers)->assertOk();

    $reads = AuditLog::query()->where('action', 'order.allergy_read')->where('subject_id', $order->getKey())->get();

    expect($reads)->toHaveCount(1)
        ->and($reads->first()->purpose_of_use)->toBe('order_fulfilment')
        ->and($reads->first()->actor_user_id)->toBe((string) $this->agent->getKey())
        ->and($reads->first()->metadata)->toMatchArray(['classification' => 'special_category']);
});

it('keeps the allergy off the customer payload', function (): void {
    declareAllergy($this->account);

    $order = app(OrderPlacementService::class)->placeComposed(allergyPlacement($this, [
        'placedOnBehalfBy' => (string) $this->agent->getKey(),
        'allergenConflictsAcknowledged' => true,
    ]))->order;

    $customer = app(OrderPresenter::class)->customer($order, []);

    expect($customer)->not->toHaveKey('allergy');
});

it('alerts each manager once, with no allergen on the alert', function (): void {
    declareAllergy($this->account);

    $order = app(OrderPlacementService::class)->placeComposed(allergyPlacement($this, [
        'placedOnBehalfBy' => (string) $this->agent->getKey(),
        'allergenConflictsAcknowledged' => true,
    ]))->order;

    $alerts = StaffNotification::withoutTenancy()
        ->where('type', 'allergy_order')
        ->where('subject_id', $order->getKey())
        ->where('user_id', $this->manager->getKey())
        ->get();

    // Sorted because jsonb keeps its own key order. Still every key, value and type.
    expect($alerts)->toHaveCount(1)
        ->and(collect($alerts->first()->data)->sortKeys()->all())->toBe([
            'currency_code' => $order->currency_code,
            'order_number' => $order->order_number,
            'severe' => true,
            'total_minor' => $order->total_minor,
        ]);
});

it('alerts for a note alone', function (): void {
    $order = app(OrderPlacementService::class)->placeComposed(allergyPlacement($this, [
        'allergyNote' => 'Coeliac',
    ]))->order;

    $alert = StaffNotification::withoutTenancy()
        ->where('subject_id', $order->getKey())
        ->where('user_id', $this->manager->getKey())
        ->sole();

    expect($alert->data['severe'])->toBeFalse();
});

it('re-checks on an edit and refreshes the snapshot', function (): void {
    $this->postJson(
        '/api/v1/catalogue/order-desk/orders',
        allergyPickupBody($this),
        $this->headers + ['Idempotency-Key' => 'before-the-declaration'],
    )->assertCreated();

    $order = Order::query()->sole();

    expect($order->allergy_snapshot)->toBeNull();

    declareAllergy($this->account);

    $patch = fn (array $body) => $this->patchJson(
        "/api/v1/catalogue/order-desk/orders/{$order->getKey()}",
        ['lines' => [['catalogue_item_id' => (string) $this->world->meal->getKey(), 'quantity' => 2]], ...$body],
        $this->headers + ['If-Match' => '"'.$order->refresh()->lock_version.'"'],
    );

    $patch([])
        ->assertStatus(409)
        ->assertJsonPath('error.details.reasons.0.reason', 'allergen_conflict');

    $patch(['acknowledge_allergen_conflicts' => true, 'allergy_note' => 'Called back about sesame'])
        ->assertOk()
        ->assertJsonPath('data.order.allergy.items.0.allergen_code', 'sesame')
        ->assertJsonPath('data.order.allergy.note', 'Called back about sesame');

    expect($order->refresh()->allergy_acknowledged_by)->toBe((string) $this->agent->getKey());

    // Absent keeps the note; an empty one clears it.
    $patch(['acknowledge_allergen_conflicts' => true])
        ->assertJsonPath('data.order.allergy.note', 'Called back about sesame');
    $patch(['acknowledge_allergen_conflicts' => true, 'allergy_note' => ''])
        ->assertJsonPath('data.order.allergy.note', null);
});

it('clears all four columns when the account is anonymised', function (): void {
    declareAllergy($this->account);

    $order = app(OrderPlacementService::class)->placeComposed(allergyPlacement($this, [
        'placedOnBehalfBy' => (string) $this->agent->getKey(),
        'allergenConflictsAcknowledged' => true,
        'allergyNote' => 'Coeliac',
    ]))->order;

    expect($order->allergy_acknowledged_by)->not->toBeNull();

    app(OrderSnapshotRedaction::class)->anonymiseFor((string) $this->account->getKey());
    $order->refresh();

    expect($order->allergy_snapshot)->toBeNull()
        ->and($order->allergy_note)->toBeNull()
        ->and($order->allergy_acknowledged_at)->toBeNull()
        ->and($order->allergy_acknowledged_by)->toBeNull();

    // The second run finds nothing left, as the port's contract asks.
    expect(app(OrderSnapshotRedaction::class)->anonymiseFor((string) $this->account->getKey()))->toBe(0);
});

it('takes the line note and the complaint text with it, in a closure with no kitchen in context', function (): void {
    $order = app(OrderPlacementService::class)->placeComposed(allergyPlacement($this, [
        'placedOnBehalfBy' => (string) $this->agent->getKey(),
    ]))->order;
    $line = $order->lines()->firstOrFail();
    $line->note = 'For Rana, she is coeliac';
    $line->save();

    $complaint = new OrderComplaint;
    $complaint->organisation_id = (string) $order->organisation_id;
    $complaint->order_id = (string) $order->getKey();
    $complaint->cause = 'quality';
    $complaint->description = 'Rana rang in tears';
    $complaint->currency_code = (string) $order->currency_code;
    $complaint->created_by = (string) $this->agent->getKey();
    $complaint->save();

    RuntimeRole::context();
    RuntimeRole::run(fn (): int => app(OrderSnapshotRedaction::class)->anonymiseFor((string) $this->account->getKey()));

    expect($line->refresh()->note)->toBeNull()
        ->and($line->name_en)->not->toBeNull()
        ->and($complaint->refresh()->description)->toBeNull()
        ->and($complaint->cause)->toBe('quality');
});

it('clears them when a guest is purged', function (): void {
    declareAllergy($this->account);

    $order = app(OrderPlacementService::class)->placeComposed(allergyPlacement($this, ['allergyNote' => 'Coeliac']))->order;

    // An open order would stop the purge.
    $order->forceFill(['status' => OrderStatus::Fulfilled, 'confirmed_at' => now(), 'fulfilled_at' => now()])->save();

    app(GuestDeletionService::class)->purge($this->account);

    expect($order->refresh()->allergy_snapshot)->toBeNull()
        ->and($order->allergy_note)->toBeNull();
});

it('does not replay a composed key with a different note', function (): void {
    $placement = app(OrderPlacementService::class);

    $placement->placeComposed(allergyPlacement($this, ['allergyNote' => 'Coeliac']), 'same-key');

    $reused = null;

    try {
        $placement->placeComposed(allergyPlacement($this, ['allergyNote' => 'Coeliac and nuts']), 'same-key');
    } catch (ApiException $exception) {
        $reused = $exception->details['idempotency']['reason'] ?? null;
    }

    expect($reused)->toBe('fingerprint_mismatch')
        ->and(Order::query()->sole()->allergy_note)->toBe('Coeliac');
});

it('does not replay a composed key with a different acknowledgement', function (): void {
    declareAllergy($this->account);

    $placement = app(OrderPlacementService::class);
    $agent = (string) $this->agent->getKey();

    $placement->placeComposed(allergyPlacement($this, ['placedOnBehalfBy' => $agent, 'allergenConflictsAcknowledged' => true]), 'tick-key');

    $reused = null;

    try {
        $placement->placeComposed(allergyPlacement($this, ['placedOnBehalfBy' => $agent]), 'tick-key');
    } catch (ApiException $exception) {
        $reused = $exception->details['idempotency']['reason'] ?? null;
    } catch (PlacementRefused) {
        $reused = 'placed-anew';
    }

    expect($reused)->toBe('fingerprint_mismatch')
        ->and(Order::query()->count())->toBe(1);
});

it('refuses the same Idempotency-Key over HTTP with a different note', function (): void {
    $this->postJson(
        '/api/v1/catalogue/order-desk/orders',
        allergyPickupBody($this, ['allergy_note' => 'Coeliac']),
        $this->headers + ['Idempotency-Key' => 'http-same-key'],
    )->assertCreated();

    $this->postJson(
        '/api/v1/catalogue/order-desk/orders',
        allergyPickupBody($this, ['allergy_note' => 'Nuts']),
        $this->headers + ['Idempotency-Key' => 'http-same-key'],
    )->assertHeaderMissing('Idempotency-Replayed')->assertStatus(409);

    expect(Order::query()->sole()->allergy_note)->toBe('Coeliac');
});

it('gives the driver the allergen codes and nothing else about them', function (): void {
    declareAllergy($this->account);

    // A desk delivery is confirmed at placement, which projects its run.
    $this->postJson('/api/v1/catalogue/order-desk/orders', allergyPickupBody($this, [
        'fulfilment_type' => 'delivery',
        'payment_method' => 'cash_on_delivery',
        'customer_address_id' => (string) $this->world->customer->address->getKey(),
        'acknowledge_allergen_conflicts' => true,
        'allergy_note' => 'Coeliac',
    ]), $this->headers + ['Idempotency-Key' => 'driver-sheet'])->assertCreated();

    Order::query()->sole()->forceFill(['ready_at' => now()])->save();

    $response = $this->getJson('/api/v1/driver/jobs', $this->headers)
        ->assertOk()
        ->assertJsonPath('data.available.0.allergy_allergen_codes', ['sesame']);

    expect($response->getContent())->not->toContain('EpiPen')
        ->and($response->getContent())->not->toContain('anaphylaxis')
        ->and($response->getContent())->not->toContain('Coeliac');
});

it('quotes the conflict beside the refusals without touching quotable', function (): void {
    declareAllergy($this->account);

    $this->postJson('/api/v1/catalogue/order-desk/quote', [
        'fulfilment_type' => 'pickup',
        'customer_account_id' => (string) $this->account->getKey(),
        'lines' => [['catalogue_item_id' => (string) $this->world->meal->getKey(), 'quantity' => 1]],
    ], $this->headers)
        ->assertOk()
        ->assertJsonPath('data.quote.quotable', true)
        ->assertJsonPath('data.quote.refusals', [])
        ->assertJsonPath('data.quote.allergen_conflicts.0.catalogue_item_id', (string) $this->world->meal->getKey())
        ->assertJsonPath('data.quote.allergen_conflicts.0.reason', 'unassessed');
});
