<?php

declare(strict_types=1);

use Healthy360\AccessControl\Database\Seeders\AccessControlSeeder;
use Healthy360\B2b\Tests\Fixtures\B2bCheckoutWorld;
use Healthy360\Customers\Models\CustomerAddress;
use Healthy360\Organisations\Database\Seeders\OrganisationTypeSeeder;
use Healthy360\ReferenceData\Database\Seeders\ReferenceDataSeeder;

/*
|--------------------------------------------------------------------------
| /me/addresses for a corporate buyer acting for their organisation
|--------------------------------------------------------------------------
|
| Wholesale checkout places against the B2B account's address, so the address
| book a buyer reads and writes with `X-Organisation-Id` must be that account's
| — the one `ShopperResolver` picks for the cart. Without the header nothing
| changes: a person's own consumer address book, never their employer's.
|
*/

beforeEach(function (): void {
    $this->seed([ReferenceDataSeeder::class, OrganisationTypeSeeder::class, AccessControlSeeder::class]);

    $this->world = B2bCheckoutWorld::dualAgreement();
    $this->buyer = $this->world['buyers']['acme'];
});

it('lists the corporate account addresses when the request names the buyer organisation', function (): void {
    $this->actingAs($this->buyer['user'])
        ->getJson('/api/v1/me/addresses', $this->buyer['headers'])
        ->assertOk()
        ->assertJsonPath('meta.count', 1)
        ->assertJsonPath('data.0.id', (string) $this->buyer['address']->getKey());
});

it('leaves the consumer address book unchanged without the header', function (): void {
    // The buyer holds no consumer account, so their own book is empty.
    $this->actingAs($this->buyer['user'])
        ->getJson('/api/v1/me/addresses', firstPartyHeaders())
        ->assertOk()
        ->assertJsonPath('meta.count', 0);
});

it('falls back to the consumer book for an organisation the caller is not a member of', function (): void {
    $stranger = firstPartyHeaders() + ['X-Organisation-Id' => (string) $this->world['buyers']['beta']['organisation']->getKey()];

    $this->actingAs($this->buyer['user'])
        ->getJson('/api/v1/me/addresses', $stranger)
        ->assertOk()
        ->assertJsonPath('meta.count', 0);
});

it('writes a new address onto the corporate account under the header', function (): void {
    $created = $this->actingAs($this->buyer['user'])
        ->postJson('/api/v1/me/addresses', [
            'address_type' => 'delivery',
            'delivery_area_id' => (string) $this->world['area']->getKey(),
            'label' => 'Warehouse',
            'line_one' => 'Port road 4',
        ], $this->buyer['headers'])
        ->assertCreated()
        ->json('data.address.id');

    expect(CustomerAddress::query()->whereKey($created)->value('customer_account_id'))
        ->toBe((string) $this->buyer['account']->getKey());
});
