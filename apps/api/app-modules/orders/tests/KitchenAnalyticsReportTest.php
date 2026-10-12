<?php

declare(strict_types=1);

use Healthy360\AccessControl\Database\Seeders\AccessControlSeeder;
use Healthy360\Catalogues\Enums\SalesChannelKind;
use Healthy360\Catalogues\Models\CatalogueItem;
use Healthy360\Catalogues\Models\SalesChannel;
use Healthy360\Customers\Database\Factories\CustomerAccountFactory;
use Healthy360\Delivery\Models\DeliveryWindow;
use Healthy360\Orders\Models\Order;
use Healthy360\Orders\Models\OrderLine;
use Healthy360\Organisations\Database\Seeders\OrganisationTypeSeeder;
use Healthy360\Organisations\Models\OrganisationBranch;
use Healthy360\Pricing\Tests\Fixtures\PricingWorld;
use Healthy360\ReferenceData\Database\Seeders\ReferenceDataSeeder;

/*
|--------------------------------------------------------------------------
| The kitchen analytics report: real figures from the order book
|--------------------------------------------------------------------------
|
| One small book in Dubai (UTC+4, no daylight saving) over 10–13 May, with
| one order in the week before. The fixture puts an order late on 11 May
| UTC that is 12 May on the branch's clock, a fulfilled order inside its
| window and one after it, one fulfilled order with no requested date, a
| cancelled order, one order per channel kind — and another kitchen's order
| on the same day, which must never be counted.
|
*/

const ANALYTICS_URL = '/api/v1/catalogue/reports/kitchen-analytics';

beforeEach(function (): void {
    $this->seed([ReferenceDataSeeder::class, OrganisationTypeSeeder::class, AccessControlSeeder::class]);

    $this->tenant = PricingWorld::kitchen('analytics@kitchen.test', ['order.view_organisation']);
    $this->orgId = (string) $this->tenant->organisation->getKey();
    $this->headers = PricingWorld::headers($this->tenant);

    $this->actingAs($this->tenant->user);
});

/**
 * An order on a branch's book with one line per `[item, quantity, price_source]`.
 *
 * @param  array<string, mixed>  $attributes
 * @param  list<array{0: CatalogueItem, 1: string, 2?: string}>  $lines
 */
function analyticsOrder(string $organisationId, SalesChannel $channel, array $attributes, array $lines): Order
{
    $order = Order::factory()->create([
        'organisation_id' => $organisationId,
        'customer_account_id' => CustomerAccountFactory::new()->create()->getKey(),
        'sales_channel_id' => $channel->getKey(),
        ...$attributes,
    ]);

    foreach ($lines as $line) {
        OrderLine::factory()->create([
            'order_id' => $order->getKey(),
            'catalogue_item_id' => $line[0]->getKey(),
            'name_en' => $line[0]->name_en,
            'quantity' => $line[1],
            'price_source' => $line[2] ?? null,
        ]);
    }

    return $order;
}

it('refuses a member without the order book read code', function (): void {
    $other = PricingWorld::kitchen('no-orders@kitchen.test', ['catalogue.view_organisation']);

    forgetResolvedGuards();
    $this->actingAs($other->user);

    $this->getJson(ANALYTICS_URL.'?from=2026-05-10&to=2026-05-13', PricingWorld::headers($other))
        ->assertForbidden();
});

it('refuses a missing, reversed or oversized range', function (string $query, string $field): void {
    $this->getJson(ANALYTICS_URL.$query, $this->headers)
        ->assertStatus(422)
        ->assertJsonPath('error.code', 'validation.failed')
        ->assertJsonStructure(['error' => ['details' => ['fields' => [$field]]]]);
})->with([
    'no from' => ['?to=2026-05-13', 'from'],
    'not a date' => ['?from=13-05-2026&to=2026-05-13', 'from'],
    'reversed' => ['?from=2026-05-13&to=2026-05-10', 'to'],
    'over 366 days' => ['?from=2025-01-01&to=2026-01-02', 'to'],
]);

it('accepts a range of exactly 366 days', function (): void {
    $this->getJson(ANALYTICS_URL.'?from=2024-01-01&to=2024-12-31', $this->headers)
        ->assertOk()
        ->assertJsonCount(366, 'data.days');
});

it('counts the range and the one before it, on the branch clock, for this kitchen only', function (): void {
    $org = $this->orgId;
    $branch = OrganisationBranch::factory()->create([
        'organisation_id' => $org,
        'country_code' => $this->tenant->organisation->country_code,
        'timezone' => 'Asia/Dubai',
    ]);
    DeliveryWindow::factory()->create(['organisation_id' => $org, 'code' => 'midday']); // 09:00–12:00

    $web = PricingWorld::channel($this->tenant->organisation, 'web');
    $pos = SalesChannel::factory()->create(['organisation_id' => $org, 'code' => 'till', 'channel_kind' => SalesChannelKind::Pos]);
    $b2b = SalesChannel::factory()->wholesale()->create(['organisation_id' => $org, 'code' => 'trade']);
    $meal = PricingWorld::meal($this->tenant, 'Freekeh bowl');
    $product = PricingWorld::product($this->tenant, 'Harissa paste')->item;

    $onBranch = ['branch_id' => $branch->getKey()];

    // 10 May: inside the midday window (11:30 local) — on time, 210 minutes.
    analyticsOrder($org, $web, $onBranch + [
        'status' => 'fulfilled', 'placed_at' => '2026-05-10 04:00:00', 'confirmed_at' => '2026-05-10 04:10:00',
        'fulfilled_at' => '2026-05-10 07:30:00', 'requested_delivery_date' => '2026-05-10', 'delivery_window_code' => 'midday',
    ], [[$meal, '2.0000']]);
    // 10 May: after the window (13:00 local) — late, 240 minutes.
    analyticsOrder($org, $pos, $onBranch + [
        'status' => 'fulfilled', 'placed_at' => '2026-05-10 05:00:00', 'confirmed_at' => '2026-05-10 05:10:00',
        'fulfilled_at' => '2026-05-10 09:00:00', 'requested_delivery_date' => '2026-05-10', 'delivery_window_code' => 'midday',
    ], [[$product, '3.0000']]);
    // 11 May: a subscription line, fulfilled with no requested date — 120 minutes, outside the on-time rate.
    analyticsOrder($org, $web, $onBranch + [
        'status' => 'fulfilled', 'placed_at' => '2026-05-11 10:00:00', 'confirmed_at' => '2026-05-11 10:05:00',
        'fulfilled_at' => '2026-05-11 12:00:00',
    ], [[$meal, '1.0000', 'subscription_included']]);
    // 11 May: cancelled — counted as cancelled, nowhere else.
    analyticsOrder($org, $web, $onBranch + [
        'status' => 'cancelled', 'placed_at' => '2026-05-11 11:00:00', 'cancelled_at' => '2026-05-11 11:30:00',
    ], [[$meal, '5.0000']]);
    // 20:30 UTC on 11 May is 00:30 on 12 May in Dubai. B2B, still open.
    analyticsOrder($org, $b2b, $onBranch + [
        'status' => 'confirmed', 'placed_at' => '2026-05-11 20:30:00', 'confirmed_at' => '2026-05-11 21:00:00',
    ], [[$meal, '1.0000']]);
    // The week before.
    analyticsOrder($org, $web, $onBranch + ['status' => 'placed', 'placed_at' => '2026-05-08 10:00:00'], [[$product, '4.0000']]);

    // Another kitchen, same day.
    $stranger = PricingWorld::kitchen('stranger@kitchen.test', ['order.view_organisation']);
    analyticsOrder(
        (string) $stranger->organisation->getKey(),
        PricingWorld::channel($stranger->organisation, 'web'),
        ['status' => 'placed', 'placed_at' => '2026-05-10 10:00:00'],
        [[PricingWorld::meal($stranger, 'Their bowl'), '9.0000']],
    );

    $data = $this->getJson(ANALYTICS_URL.'?from=2026-05-10&to=2026-05-13', $this->headers)
        ->assertOk()
        ->json('data');

    expect($data['from'])->toBe('2026-05-10')
        ->and($data['to'])->toBe('2026-05-13')
        ->and($data['current'])->toEqual([
            'orders' => 4, 'units' => 7, 'cancelled' => 1, 'fulfilled' => 3, 'open' => 1,
            'fulfilled_with_due' => 2, 'on_time' => 1, 'avg_lead_minutes' => 190,
        ])
        ->and($data['previous'])->toEqual([
            'orders' => 1, 'units' => 4, 'cancelled' => 0, 'fulfilled' => 0, 'open' => 1,
            'fulfilled_with_due' => 0, 'on_time' => 0, 'avg_lead_minutes' => null,
        ])
        ->and($data['days'])->toEqual([
            ['date' => '2026-05-10', 'orders' => 2, 'units' => 5],
            ['date' => '2026-05-11', 'orders' => 1, 'units' => 1],
            ['date' => '2026-05-12', 'orders' => 1, 'units' => 1],
            ['date' => '2026-05-13', 'orders' => 0, 'units' => 0],
        ])
        ->and($data['channels'])->toEqual([
            ['key' => 'subscription', 'orders' => 1, 'units' => 1],
            ['key' => 'b2b', 'orders' => 1, 'units' => 1],
            ['key' => 'pos', 'orders' => 1, 'units' => 3],
            ['key' => 'a_la_carte', 'orders' => 1, 'units' => 2],
        ])
        ->and(array_map(fn (array $item): array => [$item['name_en'], $item['item_type'], $item['orders'], $item['units']], $data['items']))
        ->toEqual([
            ['Freekeh bowl', 'meal', 3, 4],
            ['Harissa paste', 'product', 1, 3],
        ])
        ->and($data['items'][0]['last_ordered_at'])->toBe('2026-05-11T20:30:00Z');
});
