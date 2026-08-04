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

    $this->postJson('/api/v1/payments/intents/'.$intentId.'/capture', [], firstPartyHeaders())
        ->assertOk()
        ->assertJsonPath('data.payment_intent.status', 'captured');

    expect(PaymentIntent::query()->whereKey($intentId)->value('status'))->toBe(PaymentIntentStatus::Captured);
});

it('answers settlement checks when payments is present', function (): void {
    $lookup = app(PaymentsInvoicingSettlementLookup::class);

    expect($lookup->isAnswerable())->toBeTrue()
        ->and($lookup->outstandingInvoices((string) $this->world->organisation->getKey())->outcome->value)->toBe('clear')
        ->and($lookup->creditBalance((string) $this->world->organisation->getKey())->reason)->toBe(PaymentsInvoicingSettlementLookup::PAYMENTS_NO_INVOICE_LEDGER);
});
