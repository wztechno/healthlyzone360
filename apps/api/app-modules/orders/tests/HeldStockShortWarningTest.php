<?php

declare(strict_types=1);

use App\Models\User;
use Healthy360\AccessControl\Database\Seeders\AccessControlSeeder;
use Healthy360\Cart\Contracts\QuarantinedStock;
use Healthy360\Cart\Services\CartService;
use Healthy360\Cart\Tests\Fixtures\CheckoutWorld;
use Healthy360\Catalogues\Models\CatalogueItem;
use Healthy360\Orders\Models\Order;
use Healthy360\Organisations\Database\Seeders\OrganisationTypeSeeder;
use Healthy360\ReferenceData\Database\Seeders\ReferenceDataSeeder;

/*
|--------------------------------------------------------------------------
| Held stock is never free, so a shelf short of free stock warns online
|--------------------------------------------------------------------------
|
| Owner, 3 Nov 2026. A sale bigger than the free stock used to pass silently
| when the shelf was short too, and met the hold at the deduction. Now the
| customer is warned before the button, and the order still places: "warn,
| never refuse" stands for every shortage. The shelf arithmetic itself is
| proved in `StockQuarantineTest`; this is the wiring to the customer.
|
*/

beforeEach(function (): void {
    $this->seed([ReferenceDataSeeder::class, OrganisationTypeSeeder::class, AccessControlSeeder::class]);

    $this->world = CheckoutWorld::build('held-short@kitchen.test');
    $this->shopper = User::query()->whereKey($this->world->customer->account->user_id)->sole();

    // A shelf with held stock that the sale outruns, but not one only held stock covers.
    $this->app->instance(QuarantinedStock::class, new class implements QuarantinedStock
    {
        public function refuses(string $organisationId, CatalogueItem $item, string $quantity): bool
        {
            return false;
        }

        public function shortOfFree(string $organisationId, CatalogueItem $item, string $quantity): bool
        {
            return true;
        }
    });

    $carts = app(CartService::class);
    $this->cart = $carts->getOrCreate($this->world->customer->account, $this->world->channel);
    $carts->addItem($this->cart, (string) $this->world->meal->getKey(), quantity: 2);
});

it('warns the online customer that stock is short, and still prices the line', function (): void {
    $this->actingAs($this->shopper);

    $this->postJson('/api/v1/checkouts/preview', [
        'cart_id' => (string) $this->cart->getKey(),
        'customer_address_id' => (string) $this->world->customer->address->getKey(),
    ], firstPartyHeaders())
        ->assertOk()
        ->assertJsonPath('data.preview.subtotal_minor', 5000)
        ->assertJsonPath('data.preview.warnings', ['stock_short']);
});

it('places the order anyway', function (): void {
    $this->actingAs($this->shopper);

    $this->postJson('/api/v1/orders', [
        'cart_id' => (string) $this->cart->getKey(),
        'customer_address_id' => (string) $this->world->customer->address->getKey(),
    ], firstPartyHeaders())
        ->assertCreated()
        ->assertJsonPath('data.order.status', 'placed');

    expect(Order::query()->count())->toBe(1);
});
