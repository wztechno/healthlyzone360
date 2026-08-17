<?php

declare(strict_types=1);

use Healthy360\AccessControl\Database\Seeders\AccessControlSeeder;
use Healthy360\Cart\Services\LineProbe;
use Healthy360\Catalogues\Models\SalesChannel;
use Healthy360\Orders\Tests\Fixtures\DeskWorld;
use Healthy360\Organisations\Database\Seeders\OrganisationTypeSeeder;
use Healthy360\ReferenceData\Database\Seeders\ReferenceDataSeeder;

/*
|--------------------------------------------------------------------------
| The desk quote: refusals are the answer, and the price is the same price
|--------------------------------------------------------------------------
|
| Two claims carry this endpoint, and each one is a way it could quietly be
| wrong rather than visibly broken.
|
| **The price is the same price.** A quote and the placement behind it run the
| same probe over the same channel in the same currency and round the line total
| once, in minor units. If they ever diverge, nothing throws: an agent reads a
| number to a customer and the receipt says something else by a piastre, and
| nobody finds out until a reconciliation. So the first test prices the same
| article through the counter and through the web shop and demands the same
| figure — which is what the desk-channel backfill exists to make true — and the
| placement suite closes the loop by placing the quoted basket and comparing.
|
| **Refusals are data.** This is the one endpoint on the platform that answers
| `200` while telling the caller it cannot proceed, and it would be very easy to
| "fix" that into a 422 and lose the total the agent needs. The refusal tests pin
| the status as hard as they pin the reason codes.
|
| The rest are the shapes: a fee that appears only where a fee is a real fact, a
| basket whose duplicate taps merge before pricing, a counter with no channel
| behind it, and the boundary rule that stops `DeskBasket` throwing its way to a
| 500.
|
*/

beforeEach(function (): void {
    $this->seed([ReferenceDataSeeder::class, OrganisationTypeSeeder::class, AccessControlSeeder::class]);

    $this->world = DeskWorld::build('desk-quote@kitchen.test');
    $this->agent = DeskWorld::agent($this->world, 'quote-agent@desk.test');
    $this->headers = DeskWorld::headers($this->world);

    $this->actingAs($this->agent);
});

/**
 * A quote body for the world's meal, with only the fields under test stated.
 *
 * Distinctively named for the reason every fixture in this codebase is a class:
 * Pest loads the whole suite into one process, and a second file declaring
 * `quoteBody()` would be a fatal redeclaration rather than a test failure.
 *
 * @param  array<string, mixed>  $overrides
 * @return array<string, mixed>
 */
function deskQuoteBody(object $test, array $overrides = []): array
{
    return [
        'fulfilment_type' => 'counter',
        'lines' => [[
            'catalogue_item_id' => (string) $test->world->meal->getKey(),
            'quantity' => 2,
        ]],
        ...$overrides,
    ];
}

it('prices the counter exactly as the web shop prices the same article', function (): void {
    // The claim the desk-channel decision rests on. A second channel was chosen
    // over reusing the web shop so a kitchen could curate a counter assortment;
    // the cost of that is that items and tariffs have to reach both, and the
    // failure it invites is a counter quietly pricing from a different list.
    // Here the two share a tariff, and the quote has to agree with the probe the
    // web shop would run.
    $response = $this->postJson('/api/v1/catalogue/order-desk/quote', deskQuoteBody($this), $this->headers)
        ->assertOk();

    $webShop = app(LineProbe::class)->probe(
        $this->world->channel,
        (string) $this->world->meal->getKey(),
        null,
        '2',
        null,
        'USD',
    );

    expect($response->json('data.quote.lines.0.unit_price_minor'))->toBe(2500)
        ->and($response->json('data.quote.lines.0.unit_price_minor'))->toBe($webShop->price?->amountMinor)
        // Rounded once at the line total, in minor units — the identical
        // arithmetic `composedSnapshots()` performs.
        ->and($response->json('data.quote.lines.0.line_total_minor'))->toBe(5000)
        ->and($response->json('data.quote.subtotal_minor'))->toBe(5000)
        ->and($response->json('data.quote.total_minor'))->toBe(5000)
        ->and($response->json('data.quote.currency_code'))->toBe('USD')
        ->and($response->json('data.quote.quotable'))->toBeTrue()
        ->and($response->json('data.quote.refusals'))->toBe([]);
});

it('reports a withdrawn article as data rather than as a validation failure', function (): void {
    // The endpoint's whole reason for existing. A 422 here would tell the agent
    // one thing is wrong and throw away the total for everything that is right,
    // which is the answer they are standing at a counter waiting for.
    $this->world->meal->status = 'draft';
    $this->world->meal->save();

    $response = $this->postJson('/api/v1/catalogue/order-desk/quote', deskQuoteBody($this), $this->headers)
        ->assertOk();

    expect($response->json('data.quote.lines.0.refusals.0.reason'))->toBe('item_not_published')
        ->and($response->json('data.quote.lines.0.refusals.0.catalogue_item_id'))->toBe((string) $this->world->meal->getKey())
        // Null, not zero. There is no price for an article the kitchen has
        // withdrawn, and a zero would read as free.
        ->and($response->json('data.quote.lines.0.unit_price_minor'))->toBeNull()
        ->and($response->json('data.quote.lines.0.line_total_minor'))->toBeNull()
        // The refused line is excluded from the totals rather than priced at
        // nothing — and `quotable` is what stops the remaining total being read
        // as a sale that could go through.
        ->and($response->json('data.quote.subtotal_minor'))->toBe(0)
        ->and($response->json('data.quote.quotable'))->toBeFalse()
        // Line refusals stay on their line. The order-level list is for the
        // shape, the destination and the schedule.
        ->and($response->json('data.quote.refusals'))->toBe([]);
});

it('charges a delivery fee only when the food is actually going somewhere', function (): void {
    $addressId = (string) $this->world->customer->address->getKey();
    $accountId = (string) $this->world->customer->account->getKey();

    $delivery = $this->postJson('/api/v1/catalogue/order-desk/quote', deskQuoteBody($this, [
        'fulfilment_type' => 'delivery',
        'customer_account_id' => $accountId,
        'customer_address_id' => $addressId,
    ]), $this->headers)->assertOk();

    $pickup = $this->postJson('/api/v1/catalogue/order-desk/quote', deskQuoteBody($this, [
        'fulfilment_type' => 'pickup',
        'customer_account_id' => $accountId,
    ]), $this->headers)->assertOk();

    $counter = $this->postJson('/api/v1/catalogue/order-desk/quote', deskQuoteBody($this), $this->headers)->assertOk();

    expect($delivery->json('data.quote.delivery_fee_minor'))->toBe(500)
        ->and($delivery->json('data.quote.total_minor'))->toBe(5500)
        ->and($delivery->json('data.quote.quotable'))->toBeTrue()
        // Null and not zero on both of the others. Zero is a fee somebody
        // decided on — a free-delivery zone — and a pickup has no fee at all; a
        // screen that could not tell them apart would print "Delivery: 0.00" on
        // a counter sale.
        ->and($pickup->json('data.quote.delivery_fee_minor'))->toBeNull()
        ->and($pickup->json('data.quote.total_minor'))->toBe(5000)
        ->and($pickup->json('data.quote.quotable'))->toBeTrue()
        ->and($counter->json('data.quote.delivery_fee_minor'))->toBeNull()
        ->and($counter->json('data.quote.total_minor'))->toBe(5000);
});

it('states the shape rules as refusals, in the placement service vocabulary', function (): void {
    // The same three codes `OrderPlacementService::shapeReasons()` raises, and
    // the same context key. An agent who meets `address_not_applicable` on a
    // quote and then again on a placement is reading one rule stated twice.
    $noAddress = $this->postJson('/api/v1/catalogue/order-desk/quote', deskQuoteBody($this, [
        'fulfilment_type' => 'delivery',
        'customer_account_id' => (string) $this->world->customer->account->getKey(),
    ]), $this->headers)->assertOk();

    $strayAddress = $this->postJson('/api/v1/catalogue/order-desk/quote', deskQuoteBody($this, [
        'fulfilment_type' => 'pickup',
        'customer_account_id' => (string) $this->world->customer->account->getKey(),
        'customer_address_id' => (string) $this->world->customer->address->getKey(),
    ]), $this->headers)->assertOk();

    expect($noAddress->json('data.quote.refusals.0.reason'))->toBe('address_required')
        ->and($noAddress->json('data.quote.refusals.0.fulfilment_type'))->toBe('delivery')
        ->and($noAddress->json('data.quote.delivery_fee_minor'))->toBeNull()
        ->and($noAddress->json('data.quote.quotable'))->toBeFalse()
        ->and($strayAddress->json('data.quote.refusals.0.reason'))->toBe('address_not_applicable')
        ->and($strayAddress->json('data.quote.quotable'))->toBeFalse();
});

it('merges duplicate taps before pricing them', function (): void {
    // Three taps of one coffee is a quantity, not three lines —
    // `order_lines_one_row_per_article` will not take three rows, and a quote
    // that priced them separately would show a different arithmetic from the
    // sale that follows.
    $response = $this->postJson('/api/v1/catalogue/order-desk/quote', deskQuoteBody($this, [
        'lines' => [
            ['catalogue_item_id' => (string) $this->world->meal->getKey(), 'quantity' => 1],
            ['catalogue_item_id' => (string) $this->world->meal->getKey(), 'quantity' => '0.5'],
            ['catalogue_item_id' => (string) $this->world->meal->getKey(), 'quantity' => 1],
        ],
    ]), $this->headers)->assertOk();

    expect($response->json('data.quote.lines'))->toHaveCount(1)
        ->and($response->json('data.quote.lines.0.quantity'))->toBe('2.500000')
        ->and($response->json('data.quote.lines.0.line_total_minor'))->toBe(6250);
});

it('refuses a quantity the basket arithmetic could not add, before the basket sees it', function (): void {
    // `DeskBasket::aggregate()` throws `InvalidArgumentException` on a
    // non-numeric quantity by design, because bcmath handed one returns zero and
    // would sell the article free. An uncaught throw is a 500; the validator is
    // what makes it a 422 with a field path.
    $this->postJson('/api/v1/catalogue/order-desk/quote', deskQuoteBody($this, [
        'lines' => [['catalogue_item_id' => (string) $this->world->meal->getKey(), 'quantity' => 'two']],
    ]), $this->headers)
        ->assertStatus(422)
        ->assertJsonPath('error.code', 'validation.failed');

    $this->postJson('/api/v1/catalogue/order-desk/quote', deskQuoteBody($this, [
        'lines' => [['catalogue_item_id' => (string) $this->world->meal->getKey(), 'quantity' => 0]],
    ]), $this->headers)->assertStatus(422);
});

it('refuses to quote at all for a kitchen that has no counter', function (): void {
    // Natural fixture rather than a contrived one: kitchens seeded or imported
    // without a web shop never got a desk channel, because the backfill
    // duplicated the web shop's assortment and there was nothing to duplicate.
    SalesChannel::withoutTenancy()
        ->where('organisation_id', $this->world->organisation->getKey())
        ->where('code', 'desk')
        ->delete();

    // One sentence about the counter, not twelve about the food. A per-line
    // `channel_unavailable` would read as "none of this is available" when the
    // truth is that the counter was never opened.
    $this->postJson('/api/v1/catalogue/order-desk/quote', deskQuoteBody($this), $this->headers)
        ->assertStatus(409)
        ->assertJsonPath('error.code', 'resource.conflict')
        ->assertJsonPath('error.details.sales_channel_code', 'desk');
});

it('refuses to quote through a counter that is not trading', function (): void {
    $desk = $this->world->desk;
    $desk->status = 'inactive';
    $desk->save();

    $this->postJson('/api/v1/catalogue/order-desk/quote', deskQuoteBody($this), $this->headers)
        ->assertStatus(409)
        ->assertJsonPath('error.details.status', 'inactive');
});

it('lets somebody who may read the book quote without being able to sell', function (): void {
    // The split the desk role is built around. Working out what a basket comes
    // to commits the kitchen to nothing; selling creates an obligation to cook.
    $reader = DeskWorld::agent($this->world, 'reader@desk.test', ['order.view_organisation']);

    $this->actingAs($reader);

    $this->postJson('/api/v1/catalogue/order-desk/quote', deskQuoteBody($this), $this->headers)->assertOk();
});

it('refuses to quote for somebody who cannot read the book at all', function (): void {
    $stranger = DeskWorld::agent($this->world, 'stranger@desk.test', ['catalogue.view_organisation']);

    $this->actingAs($stranger);

    $this->postJson('/api/v1/catalogue/order-desk/quote', deskQuoteBody($this), $this->headers)->assertForbidden();
});

it('will not price a basket against another kitchen branch', function (): void {
    // The branch decides which cut-off applies and which branch-scoped delivery
    // zone wins, so quoting against a neighbour's would borrow their opening
    // hours and their delivery fee — and would confirm, by the answer changing,
    // that a branch with that identifier exists somewhere on the platform. The
    // sale refuses the same thing the same way; the two answering differently
    // about the same request is the failure worth pinning.
    $other = DeskWorld::build('other-branch-quote@kitchen.test');

    $this->postJson('/api/v1/catalogue/order-desk/quote', deskQuoteBody($this, [
        'branch_id' => (string) $other->branch->getKey(),
    ]), $this->headers)
        ->assertStatus(422)
        ->assertJsonPath('error.code', 'validation.failed');
});

it('will not price a basket against another kitchen customer address', function (): void {
    // The address is the confidential half — a street somebody lives on — so it
    // is resolved scoped to the account and a mismatch is 404, deliberately the
    // same answer as "no such address". Confirming that an identifier exists but
    // belongs to somebody else is itself the disclosure.
    $other = DeskWorld::build('other-quote@kitchen.test');

    $this->postJson('/api/v1/catalogue/order-desk/quote', deskQuoteBody($this, [
        'fulfilment_type' => 'delivery',
        'customer_account_id' => (string) $this->world->customer->account->getKey(),
        'customer_address_id' => (string) $other->customer->address->getKey(),
    ]), $this->headers)
        ->assertNotFound();
});
