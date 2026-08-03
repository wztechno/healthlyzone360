<?php

declare(strict_types=1);

use Carbon\CarbonImmutable;
use Healthy360\AccessControl\Database\Seeders\AccessControlSeeder;
use Healthy360\Orders\Models\OrderLine;
use Healthy360\Orders\Services\PriceOverride;
use Healthy360\Organisations\Database\Seeders\OrganisationTypeSeeder;
use Healthy360\Pricing\Models\PriceListItem;
use Healthy360\Pricing\Tests\Fixtures\PricingWorld;
use Healthy360\ReferenceData\Database\Seeders\ReferenceDataSeeder;
use Healthy360\Subscriptions\Services\GenerationService;
use Healthy360\Subscriptions\Services\SubscriptionService;
use Healthy360\Subscriptions\Tests\Fixtures\SubscriptionWorld;

/*
|--------------------------------------------------------------------------
| A live subscription keeps the price it was sold at
|--------------------------------------------------------------------------
|
| §5: "A live subscription keeps the per-day price captured at purchase for its
| entire balance. Price-list changes affect new subscriptions and renewals
| only."
|
| This is the one place C1's rule that every line is repriced at placement is
| deliberately suspended, so it is also the place a regression would be
| invisible: the order would simply be a bit more expensive, and nothing would
| look broken. The test pins three things at once — the captured number, the
| discount that produced it, and the `price_source` flag that lets a
| reconciliation tell a grandfathered line from a mispriced one.
|
*/

beforeEach(function (): void {
    $this->seed([ReferenceDataSeeder::class, OrganisationTypeSeeder::class, AccessControlSeeder::class]);

    // 2 000 a day with 10% off for the twenty-day run — an effective 1 800.
    $this->world = SubscriptionWorld::build('grandfather@kitchen.test', perDayMinor: 2000, discountPercent: '10.00', days: 20);
    $this->subscriptions = app(SubscriptionService::class);
    $this->generation = app(GenerationService::class);
});

it('charges the captured per-day price after the kitchen raises the tariff', function (): void {
    $subscription = $this->subscriptions->create(SubscriptionWorld::request($this->world));

    expect($subscription->captured_unit_price_minor)->toBe(2000)
        ->and($subscription->captured_discount_percent)->toBe('10.00')
        // The discount is applied once, at capture, and the result is what a
        // refund multiplies (§3).
        ->and($subscription->effective_day_price_minor)->toBe(1800);

    // The kitchen closes the old row and prices the plan half as much again.
    PriceListItem::withoutTenancy()
        ->where('price_list_id', $this->world->priceList->getKey())
        ->update(['effective_to' => CarbonImmutable::now()->addDay()->toDateString()]);

    PricingWorld::price(
        $this->world->priceList,
        $this->world->plan,
        $this->world->configuration,
        3000,
        from: CarbonImmutable::now()->addDay(),
    );

    CarbonImmutable::setTestNow(CarbonImmutable::now()->addDay());

    expect($this->generation->tick()['generated'])->toBe(1);

    $planLine = OrderLine::query()
        ->where('catalogue_item_id', $this->world->plan->getKey())
        ->firstOrFail();

    expect($planLine->unit_price_minor)->toBe(1800)
        ->and($planLine->line_total_minor)->toBe(1800)
        // Without this flag the line above is indistinguishable from a pricing
        // fault: it disagrees with every standing row in the tariff.
        ->and($planLine->price_source)->toBe(PriceOverride::SUBSCRIPTION_CAPTURE);

    CarbonImmutable::setTestNow();
});
