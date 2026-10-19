<?php

declare(strict_types=1);

use App\Models\User;
use Healthy360\AccessControl\Database\Seeders\AccessControlSeeder;
use Healthy360\Cart\Tests\Fixtures\CheckoutWorld;
use Healthy360\Organisations\Database\Seeders\OrganisationTypeSeeder;
use Healthy360\ReferenceData\Database\Seeders\ReferenceDataSeeder;
use Illuminate\Support\Str;

/*
|--------------------------------------------------------------------------
| Which kitchen's basket a channel code opens (browse-03)
|--------------------------------------------------------------------------
|
| Every marketplace kitchen trades through its own `web-shop` — channel codes
| are unique per organisation, not per platform. Resolving the bare code took
| whichever kitchen's row the planner returned first, so a shopper's basket
| belonged to one arbitrary kitchen and every other kitchen's meal was refused
| as `cart.line_refused` with nothing to do about it. These cases pin the three
| answers `CartLocator::channelForShopper` now gives: the named kitchen's
| channel, the shopper's own open basket, and a 404 for a kitchen that does not
| trade through the code.
|
*/

beforeEach(function (): void {
    $this->seed([ReferenceDataSeeder::class, OrganisationTypeSeeder::class, AccessControlSeeder::class]);

    // Two kitchens, each with an active channel called `web-shop` and a meal on it.
    $this->first = CheckoutWorld::build('first-kitchen@kitchen.test');
    $this->second = CheckoutWorld::build('second-kitchen@kitchen.test');

    $this->shopper = User::query()->whereKey($this->first->customer->account->user_id)->sole();
    $this->actingAs($this->shopper);
});

it('opens the basket on the kitchen the shopper names, whichever web shop came first', function (): void {
    expect($this->first->channel->code)->toBe($this->second->channel->code);

    foreach ([$this->second, $this->first] as $kitchen) {
        $opened = $this->postJson('/api/v1/carts', [
            'channel_code' => 'web-shop',
            'kitchen_id' => (string) $kitchen->organisation->getKey(),
        ], firstPartyHeaders())
            ->assertOk()
            ->assertJsonPath('data.cart.organisation_id', (string) $kitchen->organisation->getKey())
            ->assertJsonPath('data.cart.sales_channel_id', (string) $kitchen->channel->getKey());

        // The kitchen's own meal goes in — the refusal the bare code produced
        // for every kitchen but one.
        $this->postJson('/api/v1/carts/'.$opened->json('data.cart.id').'/items', [
            'catalogue_item_id' => (string) $kitchen->meal->getKey(),
            'quantity' => 1,
        ], firstPartyHeaders())
            ->assertCreated()
            ->assertJsonPath('data.cart.line_count', 1);
    }
});

it('re-finds the basket the shopper is filling when no kitchen is named', function (): void {
    // An empty basket at the first kitchen, then a filled one at the second.
    $this->postJson('/api/v1/carts', [
        'channel_code' => 'web-shop',
        'kitchen_id' => (string) $this->first->organisation->getKey(),
    ], firstPartyHeaders())->assertOk();

    $filled = $this->postJson('/api/v1/carts', [
        'channel_code' => 'web-shop',
        'kitchen_id' => (string) $this->second->organisation->getKey(),
    ], firstPartyHeaders())->assertOk()->json('data.cart.id');

    $this->postJson('/api/v1/carts/'.$filled.'/items', [
        'catalogue_item_id' => (string) $this->second->meal->getKey(),
        'quantity' => 2,
    ], firstPartyHeaders())->assertCreated();

    // What the header count, the basket page and checkout ask for: the basket
    // with something in it, not an arbitrary kitchen's empty one.
    $this->postJson('/api/v1/carts', ['channel_code' => 'web-shop'], firstPartyHeaders())
        ->assertOk()
        ->assertJsonPath('data.cart.id', $filled)
        ->assertJsonPath('data.cart.line_count', 1);
});

it('answers not found for a kitchen that does not trade through the code', function (): void {
    $this->postJson('/api/v1/carts', [
        'channel_code' => 'web-shop',
        'kitchen_id' => (string) Str::uuid(),
    ], firstPartyHeaders())
        ->assertNotFound()
        ->assertJsonPath('error.code', 'resource.not_found');

    $this->postJson('/api/v1/carts', [
        'channel_code' => 'wholesale',
        'kitchen_id' => (string) $this->second->organisation->getKey(),
    ], firstPartyHeaders())
        ->assertNotFound()
        ->assertJsonPath('error.code', 'resource.not_found');
});

it('refuses a kitchen that is not an identifier rather than failing on the column', function (): void {
    $this->postJson('/api/v1/carts', [
        'channel_code' => 'web-shop',
        'kitchen_id' => 'not-a-kitchen',
    ], firstPartyHeaders())
        ->assertUnprocessable()
        ->assertJsonPath('error.code', 'validation.failed');
});
