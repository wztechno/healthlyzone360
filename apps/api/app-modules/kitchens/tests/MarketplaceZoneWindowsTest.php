<?php

declare(strict_types=1);

use Healthy360\AccessControl\Database\Seeders\AccessControlSeeder;
use Healthy360\Delivery\Models\DeliveryWindow;
use Healthy360\Delivery\Services\ZoneWindowService;
use Healthy360\Delivery\Tests\Fixtures\DeliveryWorld;
use Healthy360\Organisations\Database\Seeders\OrganisationTypeSeeder;
use Healthy360\ReferenceData\Database\Seeders\ReferenceDataSeeder;
use Illuminate\Support\Facades\Route;

/*
|--------------------------------------------------------------------------
| Each published zone names the slots it offers
|--------------------------------------------------------------------------
|
| Guest checkout has no preview, so the kitchen payload is where it learns
| which slots the guest's zone runs. `window_codes` is ZoneWindowService's
| rule — assigned and active — and the payload is read live, so a zone's
| window edit or a window's on/off shows on the next read.
|
*/

beforeEach(function (): void {
    $this->seed([ReferenceDataSeeder::class, OrganisationTypeSeeder::class, AccessControlSeeder::class]);

    $this->a = DeliveryWorld::kitchen('zone-window-payload@kitchen.test');
    $this->headers = DeliveryWorld::headers($this->a);
    $this->zone = DeliveryWorld::zone($this->a->organisation, 'inner');

    $organisationId = (string) $this->a->organisation->getKey();
    $this->evening = DeliveryWindow::factory()->create(['organisation_id' => $organisationId, 'code' => 'evening', 'display_order' => 2]);
    $this->morning = DeliveryWindow::factory()->create(['organisation_id' => $organisationId, 'code' => 'morning', 'display_order' => 1]);
    $this->late = DeliveryWindow::factory()->create(['organisation_id' => $organisationId, 'code' => 'late', 'display_order' => 3, 'is_active' => false]);
    // Active but assigned to no zone.
    DeliveryWindow::factory()->create(['organisation_id' => $organisationId, 'code' => 'midday', 'display_order' => 0]);

    app(ZoneWindowService::class)->assignAll(
        $organisationId,
        [(string) $this->morning->getKey(), (string) $this->evening->getKey(), (string) $this->late->getKey()],
        [(string) $this->zone->getKey()],
    );

    $this->actingAs($this->a->user);
});

/**
 * @return list<string>
 */
function publishedWindowCodes(object $test): array
{
    // A test's requests share one router, which caches each route's controller
    // — and with it the projector's per-instance kitchen context. Production
    // builds both per request; flush them so each read here is one too.
    foreach (Route::getRoutes()->getRoutes() as $route) {
        $route->flushController();
    }

    $branches = $test->getJson('/api/v1/marketplace/kitchens/'.$test->a->organisation->slug)
        ->assertOk()
        ->json('data.branches');

    $zone = collect($branches[0]['delivery_zones'])->firstWhere('id', (string) $test->zone->getKey());

    return $zone['window_codes'];
}

it('publishes the zone\'s assigned, active windows in display order', function (): void {
    expect(publishedWindowCodes($this))->toBe(['morning', 'evening']);
});

it('follows a replacement of the zone\'s windows', function (): void {
    $this->putJson('/api/v1/catalogue/delivery-zones/'.$this->zone->getKey().'/windows', [
        'delivery_window_ids' => [(string) $this->evening->getKey()],
    ], $this->headers + ['If-Match' => '"0"'])->assertOk();

    expect(publishedWindowCodes($this))->toBe(['evening']);
});

it('follows a window being switched off and on', function (): void {
    $this->patchJson('/api/v1/catalogue/delivery-windows/'.$this->morning->getKey(), ['is_active' => false], $this->headers)
        ->assertOk();

    expect(publishedWindowCodes($this))->toBe(['evening']);

    $this->patchJson('/api/v1/catalogue/delivery-windows/'.$this->late->getKey(), ['is_active' => true], $this->headers)
        ->assertOk();

    expect(publishedWindowCodes($this))->toBe(['evening', 'late']);
});
