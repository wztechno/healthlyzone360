<?php

declare(strict_types=1);

use App\Models\User;
use Healthy360\AccessControl\Database\Seeders\AccessControlSeeder;
use Healthy360\Cart\Services\CartService;
use Healthy360\Cart\Tests\Fixtures\CheckoutWorld;
use Healthy360\Orders\Services\OrderPlacementService;
use Healthy360\Organisations\Database\Seeders\OrganisationTypeSeeder;
use Healthy360\Payments\Enums\PaymentIntentStatus;
use Healthy360\Payments\Models\PaymentIntent;
use Healthy360\Payments\Services\PaymentsInvoicingSettlementLookup;
use Healthy360\Pricing\Tests\Fixtures\PricingWorld;
use Healthy360\ReferenceData\Database\Seeders\ReferenceDataSeeder;

beforeEach(function (): void {
    $this->seed([ReferenceDataSeeder::class, OrganisationTypeSeeder::class, AccessControlSeeder::class]);
    $this->world = CheckoutWorld::build('payments@kitchen.test');
    $this->actingAs(User::query()->whereKey($this->world->customer->account->user_id)->sole());
});

it('creates a payment intent for an order and captures it', function (): void {
    $cart = app(CartService::class)->getOrCreate($this->world->customer->account, $this->world->channel);
    app(CartService::class)->addItem($cart, (string) $this->world->meal->getKey());

    $order = app(OrderPlacementService::class)->place($cart->refresh(), $this->world->customer->address)->order;

    $response = $this->postJson('/api/v1/payments/intents', [
        'order_id' => (string) $order->getKey(),
        'method_kind' => 'cash_on_delivery',
    ], firstPartyHeaders())
        ->assertCreated()
        ->assertJsonPath('data.payment_intent.status', 'authorized')
        ->assertJsonPath('data.payment_intent.method_kind', 'cash_on_delivery');

    $intentId = $response->json('data.payment_intent.id');

    /*
     * The capture is the kitchen's, not the shopper's.
     *
     * Opening an intent is part of checking out and a customer belongs to no
     * organisation, so that route carries no `org.context`. Taking the money
     * is the kitchen's decision about the kitchen's money, so capture and
     * refund do — see the routing table's own note. Driving both halves as
     * the customer only ever passed because the pair had neither the header
     * nor a scope on the model, which is the hole that closed.
     */
    forgetResolvedGuards();
    $this->actingAs($this->world->tenant->user);

    $this->postJson(
        '/api/v1/payments/intents/'.$intentId.'/capture',
        [],
        PricingWorld::headers($this->world->tenant),
    )
        ->assertOk()
        ->assertJsonPath('data.payment_intent.status', 'captured');

    // Read outside the request, so outside a tenant context: `PaymentIntent` became
    // `OrganisationScoped` when capture and refund were fenced, and the scope fails closed
    // rather than returning nothing. Opting out by name is the honest way to assert the row
    // itself — the scoping is under test in the routing layer, not here.
    expect(PaymentIntent::withoutTenancy()->whereKey($intentId)->value('status'))
        ->toBe(PaymentIntentStatus::Captured);
});

it('answers settlement checks when payments is present', function (): void {
    $lookup = app(PaymentsInvoicingSettlementLookup::class);

    expect($lookup->isAnswerable())->toBeTrue()
        ->and($lookup->outstandingInvoices((string) $this->world->organisation->getKey())->outcome->value)->toBe('clear')
        ->and($lookup->creditBalance((string) $this->world->organisation->getKey())->reason)->toBe(PaymentsInvoicingSettlementLookup::PAYMENTS_NO_INVOICE_LEDGER);
});
