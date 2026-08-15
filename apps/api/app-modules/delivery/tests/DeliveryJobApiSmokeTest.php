<?php

declare(strict_types=1);

use Healthy360\AccessControl\Database\Seeders\AccessControlSeeder;
use Healthy360\Cart\Services\CartService;
use Healthy360\Cart\Tests\Fixtures\CheckoutWorld;
use Healthy360\Delivery\Models\DeliveryJob;
use Healthy360\Orders\Services\OrderPlacementService;
use Healthy360\Organisations\Database\Seeders\OrganisationTypeSeeder;
use Healthy360\Pricing\Tests\Fixtures\PricingWorld;
use Healthy360\ReferenceData\Database\Seeders\ReferenceDataSeeder;

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

it('lists delivery jobs for the kitchen', function (): void {
    $cart = app(CartService::class)->getOrCreate($this->world->customer->account, $this->world->channel);
    app(CartService::class)->addItem($cart, (string) $this->world->meal->getKey());
    $order = app(OrderPlacementService::class)->place($cart->refresh(), $this->world->customer->address)->order;

    DeliveryJob::query()->create([
        'organisation_id' => $this->world->organisation->getKey(),
        'order_id' => $order->getKey(),
        'branch_id' => $this->world->branch->getKey(),
        'status' => 'pending',
        'tracking_status' => 'awaiting_assignment',
    ]);

    $this->getJson('/api/v1/delivery/jobs', $this->headers)->assertOk()
        ->assertJsonCount(1, 'data.delivery_jobs');
});
