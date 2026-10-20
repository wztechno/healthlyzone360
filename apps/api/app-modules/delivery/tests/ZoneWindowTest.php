<?php

declare(strict_types=1);

use Healthy360\AccessControl\Database\Seeders\AccessControlSeeder;
use Healthy360\Audit\Models\AuditLog;
use Healthy360\Delivery\Models\DeliveryWindow;
use Healthy360\Delivery\Models\DeliveryZoneWindow;
use Healthy360\Delivery\Services\ZoneWindowService;
use Healthy360\Delivery\Tests\Fixtures\DeliveryWorld;
use Healthy360\Organisations\Database\Seeders\OrganisationTypeSeeder;
use Healthy360\ReferenceData\Database\Seeders\ReferenceDataSeeder;
use Illuminate\Database\QueryException;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/*
|--------------------------------------------------------------------------
| Which windows a zone offers
|--------------------------------------------------------------------------
|
| A set replaced whole under the zone's validator, as the area map is. Offered
| means assigned *and* active; a new window starts in no zone; the migration
| gave every existing zone every active window.
|
*/

beforeEach(function (): void {
    $this->seed([ReferenceDataSeeder::class, OrganisationTypeSeeder::class, AccessControlSeeder::class]);

    $this->a = DeliveryWorld::kitchen('zone-windows@kitchen.test');
    $this->headers = DeliveryWorld::headers($this->a);
    $this->zone = DeliveryWorld::zone($this->a->organisation, 'inner');

    $organisationId = $this->a->organisation->getKey();
    $this->evening = DeliveryWindow::factory()->create(['organisation_id' => $organisationId, 'code' => 'evening', 'display_order' => 2]);
    $this->morning = DeliveryWindow::factory()->create(['organisation_id' => $organisationId, 'code' => 'morning', 'display_order' => 1]);

    $this->actingAs($this->a->user);
});

function zoneWindowsUrl(object $test): string
{
    return '/api/v1/catalogue/delivery-zones/'.$test->zone->getKey().'/windows';
}

it('replaces the set and serves it back in display order under the zone validator', function (): void {
    $this->getJson(zoneWindowsUrl($this), $this->headers)
        ->assertOk()
        ->assertJsonPath('data.delivery_window_ids', [])
        ->assertHeader('ETag', '"0"');

    $this->putJson(zoneWindowsUrl($this), [
        'delivery_window_ids' => [(string) $this->evening->getKey(), (string) $this->morning->getKey()],
    ], $this->headers + ['If-Match' => '"0"'])
        ->assertOk()
        ->assertJsonPath('data.delivery_window_ids', [(string) $this->morning->getKey(), (string) $this->evening->getKey()])
        ->assertHeader('ETag', '"1"');

    $this->putJson(zoneWindowsUrl($this), [
        'delivery_window_ids' => [(string) $this->evening->getKey()],
    ], $this->headers + ['If-Match' => '"1"'])
        ->assertOk()
        ->assertJsonPath('data.delivery_window_ids', [(string) $this->evening->getKey()]);

    $this->getJson(zoneWindowsUrl($this), $this->headers)
        ->assertOk()
        ->assertJsonPath('data.delivery_window_ids', [(string) $this->evening->getKey()])
        ->assertHeader('ETag', '"2"');

    $log = AuditLog::query()->where('action', 'catalogue.delivery_zone_windows_replaced')->latest('id')->first();

    expect(AuditLog::query()->where('action', 'catalogue.delivery_zone_windows_replaced')->count())->toBe(2)
        ->and($log?->subject_id)->toBe((string) $this->zone->getKey());
});

it('refuses a stale or missing validator', function (): void {
    $body = ['delivery_window_ids' => [(string) $this->morning->getKey()]];

    $this->putJson(zoneWindowsUrl($this), $body, $this->headers + ['If-Match' => '"0"'])->assertOk();

    $this->putJson(zoneWindowsUrl($this), $body, $this->headers + ['If-Match' => '"0"'])->assertStatus(409);

    $this->putJson(zoneWindowsUrl($this), $body, $this->headers)
        ->assertStatus(428)
        ->assertJsonPath('error.code', 'request.precondition_required');
});

it('refuses a window that is not this organisation\'s', function (): void {
    $b = DeliveryWorld::kitchen('other-windows@kitchen.test');
    $theirs = DeliveryWindow::factory()->create(['organisation_id' => $b->organisation->getKey(), 'code' => 'theirs']);

    $this->putJson(zoneWindowsUrl($this), [
        'delivery_window_ids' => [(string) $this->morning->getKey(), (string) $theirs->getKey()],
    ], $this->headers + ['If-Match' => '"0"'])
        ->assertStatus(422)
        ->assertJsonPath('error.code', 'validation.failed')
        ->assertJsonPath('error.details.unknown_delivery_window_ids', [(string) $theirs->getKey()])
        ->assertJsonStructure(['error' => ['details' => ['fields' => ['delivery_window_ids']]]]);

    expect(DeliveryZoneWindow::withoutTenancy()->count())->toBe(0);
});

it('never reaches another organisation\'s zone', function (): void {
    $b = DeliveryWorld::kitchen('foreign-zone@kitchen.test');
    $theirs = DeliveryWorld::zone($b->organisation, 'their-zone');

    $this->getJson('/api/v1/catalogue/delivery-zones/'.$theirs->getKey().'/windows', $this->headers)->assertStatus(404);

    $this->putJson('/api/v1/catalogue/delivery-zones/'.$theirs->getKey().'/windows', [
        'delivery_window_ids' => [],
    ], $this->headers + ['If-Match' => '"0"'])->assertStatus(404);
});

it('refuses a caller without the delivery permission', function (): void {
    $viewer = DeliveryWorld::kitchen('window-viewer@kitchen.test', ['branch.view_current']);
    $zone = DeliveryWorld::zone($viewer->organisation, 'viewer-zone');

    $this->actingAs($viewer->user);

    $this->getJson('/api/v1/catalogue/delivery-zones/'.$zone->getKey().'/windows', DeliveryWorld::headers($viewer))
        ->assertStatus(403)
        ->assertJsonPath('error.code', 'authz.permission_denied');
});

it('carries the assignment on both lists, a query each', function (): void {
    app(ZoneWindowService::class)->assignAll((string) $this->a->organisation->getKey(), [(string) $this->morning->getKey()]);

    $this->getJson('/api/v1/catalogue/delivery-zones', $this->headers)
        ->assertOk()
        ->assertJsonPath('data.0.delivery_window_ids', [(string) $this->morning->getKey()]);

    $this->getJson('/api/v1/catalogue/delivery-zones/'.$this->zone->getKey(), $this->headers)
        ->assertOk()
        ->assertJsonPath('data.delivery_zone.delivery_window_ids', [(string) $this->morning->getKey()]);

    $this->getJson('/api/v1/catalogue/delivery-windows', $this->headers)
        ->assertOk()
        ->assertJsonPath('data.0.code', 'morning')
        ->assertJsonPath('data.0.delivery_zone_ids', [(string) $this->zone->getKey()])
        ->assertJsonPath('data.1.delivery_zone_ids', []);
});

it('assigns a newly created window to no zone', function (): void {
    $this->postJson('/api/v1/catalogue/delivery-windows', ['code' => 'late', 'name_en' => 'Late'], $this->headers)
        ->assertStatus(201)
        ->assertJsonPath('data.delivery_window.delivery_zone_ids', []);

    expect(DeliveryZoneWindow::withoutTenancy()->count())->toBe(0);
});

it('offers only assigned windows that are active', function (): void {
    $retired = DeliveryWindow::factory()->inactive()->create(['organisation_id' => $this->a->organisation->getKey(), 'code' => 'retired']);
    DeliveryWindow::factory()->create(['organisation_id' => $this->a->organisation->getKey(), 'code' => 'unassigned']);

    // An inactive window may be assigned; it is simply not offered.
    $this->putJson(zoneWindowsUrl($this), [
        'delivery_window_ids' => [(string) $this->evening->getKey(), (string) $this->morning->getKey(), (string) $retired->getKey()],
    ], $this->headers + ['If-Match' => '"0"'])->assertOk();

    expect(app(ZoneWindowService::class)->offeredCodes($this->zone->refresh()))->toBe(['morning', 'evening']);
});

it('backfills every existing zone with the active windows of its organisation', function (): void {
    DeliveryWindow::factory()->inactive()->create(['organisation_id' => $this->a->organisation->getKey(), 'code' => 'retired']);
    $b = DeliveryWorld::kitchen('backfill-other@kitchen.test');
    $theirZone = DeliveryWorld::zone($b->organisation, 'their-zone');

    Schema::drop('delivery_zone_windows');
    (require base_path('app-modules/delivery/database/migrations/2026_10_07_000001_create_delivery_zone_windows_table.php'))->up();

    $service = app(ZoneWindowService::class);

    expect($service->offeredCodes($this->zone))->toBe(['morning', 'evening'])
        ->and($service->windowIdsFor($this->zone))->toHaveCount(2)
        // Nothing crosses organisations: the other kitchen has no windows.
        ->and($service->windowIdsFor($theirZone))->toBe([]);
});

/*
| Archiving a window: off the list's use, out of every zone, never changed
| again — and still there for whatever already names it.
*/

it('archives a window: switched off, released from every zone, still served with its date', function (): void {
    app(ZoneWindowService::class)->assignAll((string) $this->a->organisation->getKey(), [(string) $this->morning->getKey(), (string) $this->evening->getKey()]);

    $this->postJson('/api/v1/catalogue/delivery-windows/'.$this->morning->getKey().'/archive', [], $this->headers)
        ->assertOk()
        ->assertJsonPath('data.delivery_window.is_active', false)
        ->assertJsonPath('data.delivery_window.delivery_zone_ids', [])
        ->assertJsonPath('data.delivery_window.code', 'morning');

    expect($this->morning->refresh()->archived_at)->not->toBeNull()
        ->and(app(ZoneWindowService::class)->offeredCodes($this->zone->refresh()))->toBe(['evening'])
        ->and(DeliveryZoneWindow::withoutTenancy()->where('delivery_window_id', $this->morning->getKey())->count())->toBe(0);

    // Not a delete: the list still serves it, flagged, so an order naming it stays explainable.
    $this->getJson('/api/v1/catalogue/delivery-windows', $this->headers)
        ->assertOk()
        ->assertJsonCount(2, 'data')
        ->assertJsonPath('data.0.code', 'morning')
        ->assertJsonPath('data.0.is_active', false);

    expect(AuditLog::query()->where('action', 'catalogue.delivery_window_archived')->count())->toBe(1);
});

it('refuses to archive twice or to change an archived window', function (): void {
    $url = '/api/v1/catalogue/delivery-windows/'.$this->morning->getKey();

    $this->postJson($url.'/archive', [], $this->headers)->assertOk();
    $this->postJson($url.'/archive', [], $this->headers)->assertStatus(409);

    // Switching it back on would bring back a slot every zone has let go of.
    $this->patchJson($url, ['is_active' => true], $this->headers)->assertStatus(409);
    $this->patchJson($url, ['name_en' => 'Early'], $this->headers)->assertStatus(409);
});

it('refuses an archived window in a zone, by hand or by seeding', function (): void {
    $this->postJson('/api/v1/catalogue/delivery-windows/'.$this->morning->getKey().'/archive', [], $this->headers)->assertOk();

    $this->putJson(zoneWindowsUrl($this), [
        'delivery_window_ids' => [(string) $this->morning->getKey(), (string) $this->evening->getKey()],
    ], $this->headers + ['If-Match' => '"0"'])
        ->assertStatus(422)
        ->assertJsonStructure(['error' => ['details' => ['fields' => ['delivery_window_ids']]]]);

    app(ZoneWindowService::class)->assignAll((string) $this->a->organisation->getKey(), [(string) $this->morning->getKey()]);
    expect(DeliveryZoneWindow::withoutTenancy()->where('delivery_window_id', $this->morning->getKey())->count())->toBe(0);
});

it('keeps an archived window inactive at the database', function (): void {
    expect(fn () => DB::table('delivery_windows')->where('id', $this->morning->getKey())->update(['archived_at' => now()]))
        ->toThrow(QueryException::class);
});
