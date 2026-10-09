<?php

declare(strict_types=1);

use Healthy360\AccessControl\Database\Seeders\AccessControlSeeder;
use Healthy360\Delivery\Models\DeliveryWindow;
use Healthy360\Delivery\Tests\Fixtures\DeliveryWorld;
use Healthy360\Orders\Tests\Fixtures\DeskWorld;
use Healthy360\Organisations\Database\Seeders\OrganisationTypeSeeder;
use Healthy360\ReferenceData\Database\Seeders\ReferenceDataSeeder;

/*
|--------------------------------------------------------------------------
| The slots a desk sale can be booked into
|--------------------------------------------------------------------------
|
| `GET /catalogue/delivery-windows` needs `delivery_zone.manage_organisation`,
| which a desk agent need not hold. This is the desk's own read: the kitchen's
| active windows, behind the code that places the sale.
|
*/

beforeEach(function (): void {
    $this->seed([ReferenceDataSeeder::class, OrganisationTypeSeeder::class, AccessControlSeeder::class]);

    $this->world = DeskWorld::build('desk-windows@kitchen.test');
    $this->headers = DeskWorld::headers($this->world);

    $this->actingAs(DeskWorld::agent($this->world, 'windows-agent@desk.test'));
});

it('lists this kitchen\'s active windows in display order to a desk agent', function (): void {
    $organisationId = (string) $this->world->organisation->getKey();

    DeliveryWindow::factory()->create(['organisation_id' => $organisationId, 'code' => 'evening', 'name_en' => 'Dinner', 'display_order' => 3]);
    DeliveryWindow::factory()->create(['organisation_id' => $organisationId, 'code' => 'midday', 'name_en' => 'Lunch', 'display_order' => 1]);
    // Withdrawn, so a desk must not book into it.
    DeliveryWindow::factory()->inactive()->create(['organisation_id' => $organisationId, 'code' => 'dana-wagner', 'display_order' => 0]);
    // Another kitchen's slot.
    DeliveryWindow::factory()->create([
        'organisation_id' => DeliveryWorld::organisation()->getKey(),
        'code' => 'morning',
    ]);

    $response = $this->getJson('/api/v1/catalogue/order-desk/delivery-windows', $this->headers)->assertOk();

    expect(array_column($response->json('data'), 'code'))->toBe(['midday', 'evening'])
        ->and($response->json('data.0.name_en'))->toBe('Lunch')
        ->and($response->json('meta.count'))->toBe(2);
});

it('refuses somebody who may read the book but not sell from it', function (): void {
    $this->actingAs(DeskWorld::agent($this->world, 'reader-only@desk.test', ['order.view_organisation']));

    $this->getJson('/api/v1/catalogue/order-desk/delivery-windows', $this->headers)->assertForbidden();
});
