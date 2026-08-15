<?php

declare(strict_types=1);

use Healthy360\AccessControl\Database\Seeders\AccessControlSeeder;
use Healthy360\Cart\Tests\Fixtures\CheckoutWorld;
use Healthy360\Orders\Services\OrderQuery;
use Healthy360\Orders\Tests\Fixtures\OrderWorld;
use Healthy360\Organisations\Database\Seeders\OrganisationTypeSeeder;
use Healthy360\ReferenceData\Database\Seeders\ReferenceDataSeeder;

/*
|--------------------------------------------------------------------------
| One kitchen never sees another's orders
|--------------------------------------------------------------------------
|
| `orders` and `carts` carry no PostgreSQL policy and no global Eloquent scope,
| and that is a decision rather than an omission: the owner of an order is a
| customer who is a member of no organisation, so an ambient organisation scope
| would hide an order from the person who placed it, and a fail-closed one
| would throw. `RlsTest`'s eleven-table pin is the review trigger that made it
| a decision; orders join the set when the kitchen-facing operations surface
| lands (F1) and the predicate can be written the way `customer_accounts`' is —
| mine *or* my organisation's.
|
| The cost of that decision is that the seller filter lives in the query layer,
| so this is the smoke that says it is really there. Both directions are
| asserted, because a filter that returned nothing to anybody would pass a
| one-sided test.
|
*/

beforeEach(function (): void {
    $this->seed([ReferenceDataSeeder::class, OrganisationTypeSeeder::class, AccessControlSeeder::class]);

    $this->a = CheckoutWorld::build('isolation-a@kitchen.test');
    $this->b = CheckoutWorld::build('isolation-b@kitchen.test');

    $this->orders = app(OrderQuery::class);
});

it('shows each kitchen its own orders and nobody else\'s', function (): void {
    $mine = OrderWorld::place($this->a);
    $theirs = OrderWorld::place($this->b);

    $forA = $this->orders->forSeller((string) $this->a->organisation->getKey())->pluck('id')->all();
    $forB = $this->orders->forSeller((string) $this->b->organisation->getKey())->pluck('id')->all();

    expect($forA)->toBe([(string) $mine->getKey()])
        ->and($forB)->toBe([(string) $theirs->getKey()]);
});

it('keeps a customer\'s own history to their own account', function (): void {
    $mine = OrderWorld::place($this->a);
    OrderWorld::place($this->b);

    $history = $this->orders
        ->forCustomer((string) $this->a->customer->account->getKey())
        ->pluck('id')
        ->all();

    expect($history)->toBe([(string) $mine->getKey()]);
});

it('answers the open-order port per customer, which is what account closure asks', function (): void {
    $order = OrderWorld::place($this->a);

    expect($this->orders->hasOpenOrders((string) $this->a->customer->account->getKey()))->toBeTrue()
        ->and($this->orders->hasOpenOrders((string) $this->b->customer->account->getKey()))->toBeFalse();

    $summaries = $this->orders->openOrderSummaries((string) $this->a->customer->account->getKey());

    expect($summaries)->toHaveCount(1)
        ->and($summaries[0]['order_number'])->toBe($order->order_number)
        // The summary is a summary. A closure screen has no reason to read an
        // address, so the port does not offer one.
        ->and($summaries[0])->not->toHaveKey('delivery_line_one');
});
