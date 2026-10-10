<?php

declare(strict_types=1);

use Carbon\CarbonImmutable;
use Healthy360\AccessControl\Database\Seeders\AccessControlSeeder;
use Healthy360\Cart\Tests\Fixtures\CheckoutWorld;
use Healthy360\Orders\Models\Order;
use Healthy360\Organisations\Database\Seeders\OrganisationTypeSeeder;
use Healthy360\ReferenceData\Database\Seeders\ReferenceDataSeeder;
use Healthy360\Subscriptions\Services\GenerationService;
use Healthy360\Subscriptions\Services\SubscriptionService;
use Healthy360\Subscriptions\Tests\Fixtures\SubscriptionWorld;

/*
| A kitchen taking a window out of a zone must not start skipping a standing
| subscriber's deliveries: generation places with `enforceWindowOffer: false`.
*/

beforeEach(function (): void {
    $this->seed([ReferenceDataSeeder::class, OrganisationTypeSeeder::class, AccessControlSeeder::class]);

    $this->world = SubscriptionWorld::build('window-exempt@kitchen.test');
});

it('generates the delivery for a window the zone no longer offers', function (): void {
    CheckoutWorld::window($this->world->zone, 'evening', assigned: false);

    $subscription = app(SubscriptionService::class)->create(SubscriptionWorld::request($this->world));
    $subscription->forceFill(['delivery_window_code' => 'evening'])->save();

    CarbonImmutable::setTestNow(CarbonImmutable::now()->addDay());

    expect(app(GenerationService::class)->tick()['generated'])->toBe(1)
        ->and(Order::query()->sole()->delivery_window_code)->toBe('evening');
});
