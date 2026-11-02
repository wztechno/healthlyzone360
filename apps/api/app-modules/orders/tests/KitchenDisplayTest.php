<?php

declare(strict_types=1);

use Carbon\CarbonImmutable;
use Healthy360\AccessControl\Database\Seeders\AccessControlSeeder;
use Healthy360\Customers\Database\Factories\CustomerAccountFactory;
use Healthy360\Kitchens\Models\BranchOpeningHour;
use Healthy360\Kitchens\Services\KitchenServiceSettingsLookup;
use Healthy360\Orders\Enums\OrderStatus;
use Healthy360\Orders\Http\Controllers\KitchenDisplayController;
use Healthy360\Orders\Models\Order;
use Healthy360\Organisations\Database\Seeders\OrganisationTypeSeeder;
use Healthy360\Organisations\Models\OrganisationBranch;
use Healthy360\Pricing\Tests\Fixtures\PricingWorld;
use Healthy360\ReferenceData\Database\Seeders\ReferenceDataSeeder;
use Illuminate\Support\Facades\DB;

/*
|--------------------------------------------------------------------------
| The kitchen display cannot lose a ticket
|--------------------------------------------------------------------------
|
| The board used to read the first page of the order book, newest first, so the
| audit's 31 open orders showed as 25 and the six oldest, the ones most in need
| of starting, were the six missing.
|
*/

const KITCHEN_DISPLAY_URL = '/api/v1/catalogue/kitchen-display';

beforeEach(function (): void {
    $this->seed([ReferenceDataSeeder::class, OrganisationTypeSeeder::class, AccessControlSeeder::class]);

    $this->tenant = PricingWorld::kitchen('display@kitchen.test', ['order.view_organisation']);
    $this->orgId = (string) $this->tenant->organisation->getKey();
    $this->channelId = (string) PricingWorld::channel($this->tenant->organisation, 'web-shop')->getKey();
    $this->customerId = (string) CustomerAccountFactory::new()->create()->getKey();
    $this->headers = firstPartyHeaders() + ['X-Organisation-Id' => $this->orgId];

    $this->actingAs($this->tenant->user);
    $this->travelTo(CarbonImmutable::parse('2026-05-11 12:00:00', 'Asia/Beirut'));
});

/**
 * @param  array<string, mixed>  $attributes
 */
function displayOrder(object $test, array $attributes = []): Order
{
    return Order::factory()->create([
        'organisation_id' => $test->orgId,
        'customer_account_id' => $test->customerId,
        'sales_channel_id' => $test->channelId,
        ...$attributes,
    ]);
}

function displayBranch(string $organisationId, string $timezone = 'Asia/Beirut'): OrganisationBranch
{
    return OrganisationBranch::withoutTenancy()->create([
        'organisation_id' => $organisationId,
        'name' => 'Main kitchen',
        'country_code' => 'LB',
        'city' => 'Beirut',
        'timezone' => $timezone,
        'status' => 'active',
        'lock_version' => 0,
    ]);
}

/**
 * The branch's whole week, open or shut alike.
 */
function displayWeek(OrganisationBranch $branch, ?string $opens, ?string $closes): void
{
    foreach ([1, 2, 3, 4, 5, 6, 7] as $weekday) {
        BranchOpeningHour::withoutTenancy()->create([
            'organisation_id' => $branch->organisation_id,
            'branch_id' => $branch->getKey(),
            'weekday' => $weekday,
            'opens_at' => $opens,
            'closes_at' => $closes,
        ]);
    }
}

it('returns all 31 open orders, oldest first, where the order book showed 25', function (): void {
    $start = CarbonImmutable::now()->subHours(31);

    foreach (range(0, 30) as $hours) {
        displayOrder($this, ['placed_at' => $start->addHours($hours)]);
    }

    $response = $this->getJson(KITCHEN_DISPLAY_URL, $this->headers)->assertOk();

    expect($response->json('data.orders'))->toHaveCount(31)
        ->and($response->json('data.truncated'))->toBeFalse();

    $placed = $response->json('data.orders.*.placed_at');
    $sorted = $placed;
    sort($sorted);

    expect($placed)->toBe($sorted);
});

it('carries what was fulfilled today and leaves older work and cancellations out', function (): void {
    $today = displayOrder($this, [
        'status' => OrderStatus::Fulfilled,
        'placed_at' => now()->subHours(4),
        'confirmed_at' => now()->subHours(3),
        'fulfilled_at' => now()->subHours(2),
    ]);
    displayOrder($this, [
        'status' => OrderStatus::Fulfilled,
        'placed_at' => now()->subDays(4),
        'confirmed_at' => now()->subDays(3),
        'fulfilled_at' => now()->subDays(2),
    ]);
    Order::factory()->cancelled()->create([
        'organisation_id' => $this->orgId,
        'customer_account_id' => $this->customerId,
        'sales_channel_id' => $this->channelId,
    ]);

    $ids = $this->getJson(KITCHEN_DISPLAY_URL, $this->headers)->assertOk()->json('data.orders.*.id');

    expect($ids)->toBe([(string) $today->getKey()]);
});

it('stops at the cap, says so, and cuts a finished ticket before an open one', function (): void {
    $finished = displayOrder($this, [
        'status' => OrderStatus::Fulfilled,
        'placed_at' => now()->subDay(),
        'confirmed_at' => now()->subHours(3),
        'fulfilled_at' => now()->subHours(2),
    ]);

    Order::factory()->count(KitchenDisplayController::MAX_ORDERS)->create([
        'organisation_id' => $this->orgId,
        'customer_account_id' => $this->customerId,
        'sales_channel_id' => $this->channelId,
    ]);

    $response = $this->getJson(KITCHEN_DISPLAY_URL, $this->headers)->assertOk();

    expect($response->json('data.orders'))->toHaveCount(KitchenDisplayController::MAX_ORDERS)
        ->and($response->json('data.truncated'))->toBeTrue()
        ->and($response->json('data.orders.*.id'))->not->toContain((string) $finished->getKey());
});

it('never shows one kitchen another kitchen\'s tickets', function (): void {
    $other = PricingWorld::kitchen('other-display@kitchen.test', ['order.view_organisation']);

    Order::factory()->create([
        'organisation_id' => $other->organisation->getKey(),
        'customer_account_id' => $this->customerId,
        'sales_channel_id' => PricingWorld::channel($other->organisation, 'web-shop')->getKey(),
    ]);
    $mine = displayOrder($this);

    $ids = $this->getJson(KITCHEN_DISPLAY_URL, $this->headers)->assertOk()->json('data.orders.*.id');

    expect($ids)->toBe([(string) $mine->getKey()]);
});

it('needs the order book\'s own read', function (): void {
    $stranger = PricingWorld::kitchen('stranger@kitchen.test', ['catalogue.manage_organisation']);

    $this->actingAs($stranger->user)
        ->getJson(KITCHEN_DISPLAY_URL, firstPartyHeaders() + ['X-Organisation-Id' => (string) $stranger->organisation->getKey()])
        ->assertForbidden();
});

it('hands over the alarm limit and each placed order\'s open minutes, and no one else\'s', function (): void {
    $branch = displayBranch($this->orgId);
    displayWeek($branch, '09:00:00', '18:00:00');
    app(KitchenServiceSettingsLookup::class)->for($this->orgId)->forceFill(['alarm_after_minutes' => 8])->save();

    // Placed before opening: it counts from 09:00, three hours ago.
    $overnight = displayOrder($this, ['placed_at' => now()->subHours(6)]);
    $recent = displayOrder($this, ['placed_at' => now()->subMinutes(7)]);
    $accepted = displayOrder($this, [
        'status' => OrderStatus::Confirmed,
        'placed_at' => now()->subHour(),
        'confirmed_at' => now()->subMinutes(30),
    ]);

    $response = $this->getJson(KITCHEN_DISPLAY_URL, $this->headers)->assertOk();

    expect($response->json('data.alarm_after_minutes'))->toBe(8)
        ->and($response->json('data.unaccepted_open_minutes.'.$overnight->getKey()))->toBe(180)
        ->and($response->json('data.unaccepted_open_minutes.'.$recent->getKey()))->toBe(7)
        ->and($response->json('data.unaccepted_open_minutes'))->not->toHaveKey((string) $accepted->getKey());
});

it('leaves an order for a later day off the clock until that day\'s opening', function (): void {
    displayWeek(displayBranch($this->orgId), '09:00:00', '18:00:00');
    $tomorrow = CarbonImmutable::now('Asia/Beirut')->addDay();
    $order = displayOrder($this, [
        'placed_at' => now()->subDays(7),
        'requested_delivery_date' => $tomorrow->toDateString(),
    ]);

    $today = $this->getJson(KITCHEN_DISPLAY_URL, $this->headers)->assertOk();

    expect($today->json('data.unaccepted_open_minutes'))->not->toHaveKey((string) $order->getKey());

    $this->travelTo($tomorrow->setTime(9, 10));

    $thatDay = $this->getJson(KITCHEN_DISPLAY_URL, $this->headers)->assertOk();

    expect($thatDay->json('data.unaccepted_open_minutes.'.$order->getKey()))->toBe(10);
});

it('sends the waiting times as an object even when nothing is waiting', function (): void {
    $content = $this->getJson(KITCHEN_DISPLAY_URL, $this->headers)->assertOk()->getContent();

    expect($content)->toContain('"unaccepted_open_minutes":{}');
});

it('counts a kitchen with no opening hours around the clock', function (): void {
    displayBranch($this->orgId);
    $order = displayOrder($this, ['placed_at' => now()->subHours(10)]);

    $response = $this->getJson(KITCHEN_DISPLAY_URL, $this->headers)->assertOk();

    expect($response->json('data.unaccepted_open_minutes.'.$order->getKey()))->toBe(600);
});

it('reads the branch hours once however many tickets are on the wall', function (): void {
    displayWeek(displayBranch($this->orgId), '09:00:00', '18:00:00');

    foreach (range(1, 12) as $minutes) {
        displayOrder($this, ['placed_at' => now()->subMinutes($minutes)]);
    }

    $reads = 0;
    DB::listen(function ($query) use (&$reads): void {
        $reads += str_contains($query->sql, 'branch_opening_hours') ? 1 : 0;
    });

    $this->getJson(KITCHEN_DISPLAY_URL, $this->headers)->assertOk();

    expect($reads)->toBe(1);
});
