<?php

declare(strict_types=1);

use Healthy360\AccessControl\Database\Seeders\AccessControlSeeder;
use Healthy360\Cart\Services\CartService;
use Healthy360\Cart\Tests\Fixtures\CheckoutWorld;
use Healthy360\Delivery\Models\DeliveryJob;
use Healthy360\Identity\Models\ContactPoint;
use Healthy360\Orders\Models\Order;
use Healthy360\Orders\Services\OrderPlacementService;
use Healthy360\Organisations\Database\Seeders\OrganisationTypeSeeder;
use Healthy360\Pricing\Tests\Fixtures\PricingWorld;
use Healthy360\ReferenceData\Database\Seeders\ReferenceDataSeeder;

/*
|--------------------------------------------------------------------------
| The two lists over one table, and why their rows differ
|--------------------------------------------------------------------------
|
| `/delivery/jobs` is the dispatcher's board — every driver's runs, every state,
| which is why it carries `driver_user_id`. `/driver/jobs` is one courier's own
| sheet, narrowed by ownership, which is why it does not: the field would say the
| same thing on every row.
|
| The driver's row got wide in C3 and this is the file that says how wide. Until
| then it served four identifiers and two status strings, which was honest while
| nothing created delivery jobs and no driver client existed to read them; a
| courier holding `{id, order_id, status}` cannot deliver anything. The
| assertions below are about the *snapshot* — the fields come off `orders` as it
| stood at placement, never off the customer's address book, because a customer
| editing their address at eight o'clock has not changed where tonight's food is
| going.
|
*/

beforeEach(function (): void {
    $this->seed([
        ReferenceDataSeeder::class,
        OrganisationTypeSeeder::class,
        AccessControlSeeder::class,
    ]);
    $this->world = CheckoutWorld::build('delivery-jobs@kitchen.test');
    $this->actingAs($this->world->tenant->user);
    $this->headers = PricingWorld::headers($this->world->tenant);
});

/**
 * @param  array<string, mixed>  $attributes
 */
function smokeJob(object $test, Order $order, array $attributes = []): DeliveryJob
{
    return DeliveryJob::withoutTenancy()->create([
        'organisation_id' => $test->world->organisation->getKey(),
        'order_id' => $order->getKey(),
        'branch_id' => $test->world->branch->getKey(),
        'status' => 'pending',
        'tracking_status' => 'awaiting_assignment',
        'lock_version' => 0,
        ...$attributes,
    ]);
}

it('lists delivery jobs for the kitchen', function (): void {
    $cart = app(CartService::class)->getOrCreate($this->world->customer->account, $this->world->channel);
    app(CartService::class)->addItem($cart, (string) $this->world->meal->getKey());
    $order = app(OrderPlacementService::class)->place($cart->refresh(), $this->world->customer->address)->order;

    smokeJob($this, $order);

    $this->getJson('/api/v1/delivery/jobs', $this->headers)->assertOk()
        ->assertJsonCount(1, 'data.delivery_jobs');
});

it('gives a driver the order number, the moment and the whole address snapshot', function (): void {
    $phone = ContactPoint::factory()->phone()
        ->forCustomerAccount((string) $this->world->customer->account->getKey())
        ->create(['is_primary' => true]);

    $order = Order::factory()->create([
        'organisation_id' => $this->world->organisation->getKey(),
        'customer_account_id' => $this->world->customer->account->getKey(),
        'sales_channel_id' => $this->world->channel->getKey(),
        'order_number' => 'ORD-DRIVER-01',
        'delivery_line_one' => 'Rue Gouraud 12',
        'delivery_building' => 'Beit Aoun',
        'delivery_floor' => '4',
        'delivery_apartment' => '2',
        'delivery_directions' => 'Ring the bell twice',
        'delivery_area_name_en' => 'Achrafieh',
        'delivery_area_name_ar' => 'الأشرفية',
        'delivery_window_code' => 'evening',
        'requested_delivery_date' => '2026-05-10',
        'delivery_contact_point_id' => $phone->getKey(),
    ]);

    smokeJob($this, $order, [
        'driver_user_id' => $this->world->tenant->user->getKey(),
        'status' => 'assigned',
        'assigned_at' => now(),
    ]);

    $row = $this->getJson('/api/v1/driver/jobs', $this->headers)->assertOk()->json('data.jobs.0');

    expect($row['order_number'])->toBe('ORD-DRIVER-01')
        ->and($row['assigned_at'])->toBeString()
        // The half of the snapshot a courier navigates by: the street gets them
        // to the building, and these get them to the door.
        ->and($row['delivery'])->toBe([
            'line_one' => 'Rue Gouraud 12',
            'building' => 'Beit Aoun',
            'floor' => '4',
            'apartment' => '2',
            'directions' => 'Ring the bell twice',
            'area_name_en' => 'Achrafieh',
            'area_name_ar' => 'الأشرفية',
            'window_code' => 'evening',
            'requested_date' => '2026-05-10',
            // The number the *order* was given, resolved from the contact point
            // the snapshot names.
            'phone' => $phone->value_normalised,
        ])
        // Still absent, and still on purpose: it would be the caller's own id on
        // every row, and the dispatch board is where whose job it is matters.
        ->and($row)->not->toHaveKey('driver_user_id');
});

it('serves a null number rather than inventing one when the order named no contact', function (): void {
    // Every order placed before the snapshot was widened is this row, and so is
    // any address that never carried a contact point. There is deliberately no
    // fallback to "whatever number this customer has today": that answers a
    // different question, and this route carries no permission code to hold a
    // customer-contact lookup behind.
    ContactPoint::factory()->phone()
        ->forCustomerAccount((string) $this->world->customer->account->getKey())
        ->create(['is_primary' => true]);

    $order = Order::factory()->create([
        'organisation_id' => $this->world->organisation->getKey(),
        'customer_account_id' => $this->world->customer->account->getKey(),
        'sales_channel_id' => $this->world->channel->getKey(),
        'delivery_contact_point_id' => null,
    ]);

    smokeJob($this, $order, ['driver_user_id' => $this->world->tenant->user->getKey()]);

    $row = $this->getJson('/api/v1/driver/jobs', $this->headers)->assertOk()->json('data.jobs.0');

    expect($row['delivery']['phone'])->toBeNull()
        // An unassigned run has no moment, and the field says so rather than
        // being absent.
        ->and($row['assigned_at'])->toBeNull();
});

it('keeps finished runs off the driver\'s sheet', function (): void {
    // A driver's list is what is left to do. The dispatch board is where a
    // completed run stays visible.
    $order = Order::factory()->create([
        'organisation_id' => $this->world->organisation->getKey(),
        'customer_account_id' => $this->world->customer->account->getKey(),
        'sales_channel_id' => $this->world->channel->getKey(),
    ]);

    smokeJob($this, $order, [
        'driver_user_id' => $this->world->tenant->user->getKey(),
        'status' => 'delivered',
        'tracking_status' => 'delivered',
        'delivered_at' => now(),
    ]);

    $this->getJson('/api/v1/driver/jobs', $this->headers)->assertOk()->assertJsonCount(0, 'data.jobs');
});
