<?php

declare(strict_types=1);

use Healthy360\Delivery\Tests\Fixtures\DeliveryWorld;
use Healthy360\ReferenceData\Database\Seeders\DeliveryAreaSeeder;
use Healthy360\ReferenceData\Database\Seeders\ReferenceDataSeeder;
use Healthy360\ReferenceData\Models\DeliveryArea;
use Illuminate\Support\Facades\Schema;

/*
|--------------------------------------------------------------------------
| The public gazetteer
|--------------------------------------------------------------------------
|
| Anonymous, because J1's onboarding asks a customer for their delivery area
| before an account exists — an address form that only works after sign-in
| cannot be part of sign-up.
|
| Localised through the public projection: one `name`, never both language
| columns. Cursor-paginated, unlike the allergen and diet lists, because this
| is the public vocabulary that grows with every market.
|
*/

beforeEach(function (): void {
    $this->seed([ReferenceDataSeeder::class]);
});

it('serves the gazetteer to an anonymous caller', function (): void {
    DeliveryWorld::area('achrafieh');

    $this->getJson('/api/v1/reference/delivery-areas?country_code=LB')
        ->assertOk()
        ->assertJsonPath('data.0.code', 'achrafieh')
        ->assertJsonPath('meta.locale', 'en')
        ->assertJsonPath('meta.country_code', 'LB');
});

it('carries one localised name rather than both columns', function (): void {
    DeliveryWorld::area('achrafieh');

    $english = $this->getJson('/api/v1/reference/delivery-areas?country_code=LB')->assertOk();

    expect($english->json('data.0'))->toHaveKey('name')
        ->and($english->json('data.0'))->not->toHaveKey('name_en')
        ->and($english->json('data.0'))->not->toHaveKey('name_ar')
        ->and($english->json('data.0.name'))->toBe('Achrafieh');

    $arabic = $this->getJson('/api/v1/reference/delivery-areas?country_code=LB', ['Accept-Language' => 'ar-LB,ar;q=0.9'])
        ->assertOk()
        ->assertJsonPath('meta.locale', 'ar');

    expect($arabic->json('data.0.name'))->toBe('منطقة achrafieh');
});

it('falls back to English for a language the platform does not publish', function (): void {
    DeliveryWorld::area('achrafieh');

    $this->getJson('/api/v1/reference/delivery-areas?country_code=LB', ['Accept-Language' => 'fr-FR,fr;q=0.9'])
        ->assertOk()
        ->assertJsonPath('meta.locale', 'en');
});

it('carries the region field even though it is empty', function (): void {
    // OD-12: the source does not say which governorate a place belongs to, and
    // a client that wants to group the picker can see the platform has nothing
    // to group by. Omitting it would hide the gap and change the shape the day
    // somebody fills it in.
    DeliveryWorld::area('achrafieh');

    $response = $this->getJson('/api/v1/reference/delivery-areas?country_code=LB')->assertOk();

    expect($response->json('data.0'))->toHaveKey('region')
        ->and($response->json('data.0.region'))->toBeNull();
});

it('excludes areas the platform has withdrawn', function (): void {
    DeliveryWorld::area('achrafieh');
    DeliveryWorld::area('closed-road', 'LB', active: false);

    $this->getJson('/api/v1/reference/delivery-areas?country_code=LB')
        ->assertOk()
        ->assertJsonCount(1, 'data')
        ->assertJsonPath('data.0.code', 'achrafieh');
});

it('filters by country', function (): void {
    DeliveryWorld::area('achrafieh');
    DeliveryWorld::area('ae-demo-al-quoz', 'AE');

    $this->getJson('/api/v1/reference/delivery-areas?country_code=AE')
        ->assertOk()
        ->assertJsonCount(1, 'data')
        ->assertJsonPath('data.0.code', 'ae-demo-al-quoz');
});

it('serves every market when no country is named, and refuses one the platform does not know', function (): void {
    // K1.7 made `country_code` required, arguing that a default would serve
    // Lebanon to a customer in Dubai. That argument was right about *defaults*
    // and wrong about *absence* (D-067): a client that has not asked for a
    // country has not asked for the wrong one, and the consumer marketplace
    // legitimately wants the whole gazetteer before it knows where the person
    // is. `country_code` is embedded on every row, so an unfiltered page is
    // unambiguous by construction.
    DeliveryWorld::area('achrafieh');

    $this->getJson('/api/v1/reference/delivery-areas')
        ->assertOk()
        ->assertJsonPath('meta.country_code', null)
        ->assertJsonCount(1, 'data');

    // An unknown code stays a 400 rather than an empty page, which would read
    // as "we do not deliver there yet" rather than "that is not a country
    // code".
    $this->getJson('/api/v1/reference/delivery-areas?country_code=UK')
        ->assertStatus(400)
        ->assertJsonPath('error.code', 'request.invalid')
        ->assertJsonPath('error.details.parameter', 'country_code');
});

it('accepts a lower-case country code', function (): void {
    DeliveryWorld::area('achrafieh');

    $this->getJson('/api/v1/reference/delivery-areas?country_code=lb')
        ->assertOk()
        ->assertJsonPath('meta.country_code', 'LB');
});

it('walks the whole seeded gazetteer with a cursor', function (): void {
    $this->seed(DeliveryAreaSeeder::class);

    $seen = [];
    $cursor = null;
    $pages = 0;

    do {
        $response = $this->getJson('/api/v1/reference/delivery-areas?country_code=LB&limit=50'.($cursor === null ? '' : '&cursor='.$cursor))
            ->assertOk();

        foreach ($response->json('data') as $area) {
            $seen[] = $area['code'];
        }

        $cursor = $response->json('meta.next_cursor');
        $pages++;
    } while ($cursor !== null && $pages < 10);

    expect($seen)->toHaveCount(125)
        ->and(array_unique($seen))->toHaveCount(125)
        ->and($pages)->toBe(3);
});

it('refuses a cursor it never issued', function (): void {
    DeliveryWorld::area('achrafieh');

    $this->getJson('/api/v1/reference/delivery-areas?country_code=LB&cursor=not-a-cursor')
        ->assertStatus(400)
        ->assertJsonPath('error.code', 'request.invalid');
});

it('never exposes a delivery zone through the public list', function (): void {
    // The gazetteer is platform data; what a kitchen charges to reach a place
    // is not, and no key of this projection reaches it.
    DeliveryWorld::area('achrafieh');

    $row = $this->getJson('/api/v1/reference/delivery-areas?country_code=LB')->assertOk()->json('data.0');

    expect(array_keys($row))->toBe(['id', 'country_code', 'code', 'name', 'region', 'display_order']);
});

it('holds the gazetteer as platform data with no organisation column at all', function (): void {
    // The two-level design in one assertion: a place is nobody's tenant data,
    // which is what lets an address captured at one kitchen be matched against
    // another's zones.
    expect(DeliveryArea::query()->getModel()->getTable())->toBe('delivery_areas')
        ->and(Schema::hasColumn('delivery_areas', 'organisation_id'))->toBeFalse();
});
