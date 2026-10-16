<?php

declare(strict_types=1);

use Healthy360\AccessControl\Database\Seeders\AccessControlSeeder;
use Healthy360\Delivery\Enums\DeliveryZoneStatus;
use Healthy360\Delivery\Tests\Fixtures\DeliveryWorld;
use Healthy360\Orders\Tests\Fixtures\DeskWorld;
use Healthy360\Organisations\Database\Seeders\OrganisationTypeSeeder;
use Healthy360\ReferenceData\Database\Seeders\ReferenceDataSeeder;

/*
|--------------------------------------------------------------------------
| The areas a desk sale can be delivered to
|--------------------------------------------------------------------------
|
| The desk's address picker used to offer the whole gazetteer, so an agent
| learned a kitchen does not go somewhere only from the refusal after Save.
| This is the list the desk's quote would accept: this kitchen's active,
| organisation-wide claims, and nothing the platform has withdrawn.
|
*/

beforeEach(function (): void {
    $this->seed([ReferenceDataSeeder::class, OrganisationTypeSeeder::class, AccessControlSeeder::class]);

    $this->world = DeskWorld::build('desk-areas@kitchen.test');
    $this->headers = DeskWorld::headers($this->world);

    $this->actingAs(DeskWorld::agent($this->world, 'areas-agent@desk.test', [
        'order.view_organisation',
        'customer.create_on_behalf_organisation',
    ]));
});

it('lists only the areas this kitchen\'s active organisation-wide zones deliver to', function (): void {
    $organisation = $this->world->organisation;

    // `DeskWorld` already serves one area through an active organisation-wide zone.
    $served = $this->world->area;

    $alsoServed = DeliveryWorld::area('hamra-served');
    DeliveryWorld::claim(DeliveryWorld::zone($organisation, 'second'), $alsoServed);

    // Suspended, so the quote would refuse it.
    $paused = DeliveryWorld::area('paused-area');
    $pausedZone = DeliveryWorld::zone($organisation, 'paused');
    $pausedZone->forceFill(['status' => DeliveryZoneStatus::Inactive])->save();
    DeliveryWorld::claim($pausedZone, $paused);

    // Claimed by one branch only; a desk sale states no branch.
    $branchOnly = DeliveryWorld::area('branch-only-area');
    DeliveryWorld::claim(
        DeliveryWorld::zone($organisation, 'branch', DeliveryWorld::branch($organisation, 'Jounieh')),
        $branchOnly,
    );

    // Withdrawn from the gazetteer, although a zone still claims it.
    $withdrawn = DeliveryWorld::area('withdrawn-area', active: false);
    DeliveryWorld::claim(DeliveryWorld::zone($organisation, 'old'), $withdrawn);

    // Another kitchen's, and one nobody serves.
    $elsewhere = DeliveryWorld::area('another-kitchens-area');
    DeliveryWorld::claim(DeliveryWorld::zone(DeliveryWorld::organisation(), 'theirs'), $elsewhere);
    DeliveryWorld::area('nobody-delivers-here');

    $response = $this->getJson('/api/v1/catalogue/order-desk/delivery-areas', $this->headers)->assertOk();

    expect(array_column($response->json('data'), 'id'))
        ->toEqualCanonicalizing([(string) $served->getKey(), (string) $alsoServed->getKey()])
        ->and($response->json('meta.count'))->toBe(2)
        ->and($response->json('data.0'))->toHaveKeys(['name_en', 'name_ar', 'region', 'is_active']);
});

it('refuses somebody who may not write a customer\'s address', function (): void {
    $this->actingAs(DeskWorld::agent($this->world, 'reader-only@desk.test', ['order.view_organisation']));

    $this->getJson('/api/v1/catalogue/order-desk/delivery-areas', $this->headers)->assertForbidden();
});
