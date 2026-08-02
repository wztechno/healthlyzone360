<?php

declare(strict_types=1);

use Healthy360\AccessControl\Database\Seeders\AccessControlSeeder;
use Healthy360\Audit\Models\AuditLog;
use Healthy360\Delivery\Models\DeliveryZoneArea;
use Healthy360\Delivery\Services\ZoneResolver;
use Healthy360\Delivery\Tests\Fixtures\DeliveryWorld;
use Healthy360\Organisations\Database\Seeders\OrganisationTypeSeeder;
use Healthy360\ReferenceData\Database\Seeders\ReferenceDataSeeder;

/*
|--------------------------------------------------------------------------
| One area, one zone per branch — and what "per branch" actually means
|--------------------------------------------------------------------------
|
| The rule the master plan states and the schema enforces with
| `UNIQUE (organisation_id, branch_id, delivery_area_id) NULLS NOT DISTINCT`.
| The subtle half is what the key *permits*: an organisation-wide claim and a
| branch-scoped claim on one area coexist, because NULL and a branch identifier
| are different values. That is the override mechanism, and it makes the
| resolution order — branch beats organisation-wide — load-bearing rather than
| decorative. `ZoneResolver` is the only place that order lives, and J1's
| address validation will call it rather than re-derive it.
|
*/

beforeEach(function (): void {
    $this->seed([ReferenceDataSeeder::class, OrganisationTypeSeeder::class, AccessControlSeeder::class]);

    $this->a = DeliveryWorld::kitchen('areas@kitchen.test');
    $this->headers = DeliveryWorld::headers($this->a);
    $this->resolver = app(ZoneResolver::class);

    $this->achrafieh = DeliveryWorld::area('achrafieh');
    $this->badaro = DeliveryWorld::area('badaro');
    $this->hamra = DeliveryWorld::area('hamra');

    $this->actingAs($this->a->user);
});

it('replaces the whole set of areas a zone covers', function (): void {
    $zone = DeliveryWorld::zone($this->a->organisation, 'inner');

    $this->putJson('/api/v1/catalogue/delivery-zones/'.$zone->getKey().'/areas', [
        'service_area_ids' => [(string) $this->achrafieh->getKey(), (string) $this->badaro->getKey()],
    ], $this->headers + ['If-Match' => '"0"'])
        ->assertOk()
        ->assertJsonCount(2, 'data')
        ->assertJsonPath('meta.count', 2)
        ->assertJsonPath('meta.scope', 'organisation')
        // The zone's own validator advances: a zone and its map are one
        // document.
        ->assertHeader('ETag', '"1"');

    // Absent areas are released, which is the only way to hand a place to a
    // different zone.
    $this->putJson('/api/v1/catalogue/delivery-zones/'.$zone->getKey().'/areas', [
        'service_area_ids' => [(string) $this->badaro->getKey()],
    ], $this->headers + ['If-Match' => '"1"'])
        ->assertOk()
        ->assertJsonCount(1, 'data')
        ->assertJsonPath('data.0.code', 'badaro');
});

it('accepts an empty map', function (): void {
    // A legitimate intermediate state while a kitchen redraws, and the only
    // way to hand every area back at once.
    $zone = DeliveryWorld::zone($this->a->organisation, 'inner');
    DeliveryWorld::claim($zone, $this->achrafieh);

    $this->putJson('/api/v1/catalogue/delivery-zones/'.$zone->getKey().'/areas', [
        'service_area_ids' => [],
    ], $this->headers + ['If-Match' => '"0"'])
        ->assertOk()
        ->assertJsonCount(0, 'data');
});

it('copies the zone scope onto every claim', function (): void {
    $zone = DeliveryWorld::zone($this->a->organisation, 'main-express', $this->a->branch);

    $this->putJson('/api/v1/catalogue/delivery-zones/'.$zone->getKey().'/areas', [
        'service_area_ids' => [(string) $this->achrafieh->getKey()],
    ], $this->headers + ['If-Match' => '"0"'])
        ->assertOk()
        ->assertJsonPath('meta.scope', 'branch');

    // The denormalisation the unique index reads, written by exactly one
    // service and asserted to agree with its parent.
    expect(DeliveryZoneArea::withoutTenancy()->where('delivery_zone_id', $zone->getKey())->value('branch_id'))
        ->toBe((string) $this->a->branch->getKey());
});

it('refuses a second organisation-wide zone over an area another already serves', function (): void {
    $first = DeliveryWorld::zone($this->a->organisation, 'inner');
    DeliveryWorld::claim($first, $this->achrafieh);

    $second = DeliveryWorld::zone($this->a->organisation, 'outer');

    $this->putJson('/api/v1/catalogue/delivery-zones/'.$second->getKey().'/areas', [
        'service_area_ids' => [(string) $this->achrafieh->getKey()],
    ], $this->headers + ['If-Match' => '"0"'])
        ->assertStatus(409)
        ->assertJsonPath('error.code', 'resource.conflict')
        ->assertJsonPath('error.details.reason', 'area_already_served')
        ->assertJsonPath('error.details.scope', 'organisation')
        // The caller's next move is to open that zone, so the response names
        // it rather than naming an index.
        ->assertJsonPath('error.details.conflicts.0.delivery_zone_id', (string) $first->getKey())
        ->assertJsonPath('error.details.occupying_zones.0', 'inner');
});

it('refuses two zones on one area within the same branch', function (): void {
    $first = DeliveryWorld::zone($this->a->organisation, 'main-a', $this->a->branch);
    DeliveryWorld::claim($first, $this->achrafieh);

    $second = DeliveryWorld::zone($this->a->organisation, 'main-b', $this->a->branch);

    $this->putJson('/api/v1/catalogue/delivery-zones/'.$second->getKey().'/areas', [
        'service_area_ids' => [(string) $this->achrafieh->getKey()],
    ], $this->headers + ['If-Match' => '"0"'])
        ->assertStatus(409)
        ->assertJsonPath('error.details.scope', 'branch')
        ->assertJsonPath('error.details.occupying_zones.0', 'main-a');
});

it('lets two different branches each serve the same area', function (): void {
    $first = DeliveryWorld::zone($this->a->organisation, 'main-express', $this->a->branch);
    DeliveryWorld::claim($first, $this->achrafieh);

    $second = DeliveryWorld::zone($this->a->organisation, 'second-express', $this->a->secondBranch);

    $this->putJson('/api/v1/catalogue/delivery-zones/'.$second->getKey().'/areas', [
        'service_area_ids' => [(string) $this->achrafieh->getKey()],
    ], $this->headers + ['If-Match' => '"0"'])
        ->assertOk();

    expect(DeliveryZoneArea::withoutTenancy()->where('delivery_area_id', $this->achrafieh->getKey())->count())->toBe(2);
});

it('lets a branch zone claim an area the organisation-wide map already covers', function (): void {
    // The permitted overlap. It is the override mechanism, not a hole: a
    // kitchen states a default map once and one location says "we also go
    // there, but it costs more from here".
    $wide = DeliveryWorld::zone($this->a->organisation, 'wide');
    DeliveryWorld::claim($wide, $this->achrafieh);

    $branchZone = DeliveryWorld::zone($this->a->organisation, 'main-express', $this->a->branch);

    $this->putJson('/api/v1/catalogue/delivery-zones/'.$branchZone->getKey().'/areas', [
        'service_area_ids' => [(string) $this->achrafieh->getKey()],
    ], $this->headers + ['If-Match' => '"0"'])
        ->assertOk();
});

it('resolves a branch claim ahead of the organisation-wide one', function (): void {
    $wide = DeliveryWorld::zone($this->a->organisation, 'wide');
    DeliveryWorld::claim($wide, $this->achrafieh);

    $branchZone = DeliveryWorld::zone($this->a->organisation, 'main-express', $this->a->branch);
    DeliveryWorld::claim($branchZone, $this->achrafieh);

    $branchId = (string) $this->a->branch->getKey();
    $areaId = (string) $this->achrafieh->getKey();

    // The resolver is called directly here rather than over HTTP, so the
    // context an `org.context` request would have resolved is set by hand.
    DeliveryWorld::enterContext($this->a);

    // The more specific claim wins.
    expect($this->resolver->zoneFor($areaId, $branchId)?->code)->toBe('main-express')
        // With no branch in context only the organisation-wide map answers: a
        // quote given without knowing where the food comes from must not
        // silently pick one branch's terms.
        ->and($this->resolver->zoneFor($areaId)?->code)->toBe('wide')
        // A different branch has no claim of its own and falls through.
        ->and($this->resolver->zoneFor($areaId, (string) $this->a->secondBranch->getKey())?->code)->toBe('wide');
});

it('does not fall back to the organisation map when the branch has suspended the area', function (): void {
    // "We are not crossing the mountain this week" is a statement about that
    // area. Serving it from the default map at the default price would be the
    // system overruling the person who suspended it.
    $wide = DeliveryWorld::zone($this->a->organisation, 'wide');
    DeliveryWorld::claim($wide, $this->achrafieh);

    $branchZone = DeliveryWorld::zone($this->a->organisation, 'main-express', $this->a->branch);
    $branchZone->update(['status' => 'inactive']);
    DeliveryWorld::claim($branchZone, $this->achrafieh);

    $areaId = (string) $this->achrafieh->getKey();
    $branchId = (string) $this->a->branch->getKey();

    DeliveryWorld::enterContext($this->a);

    expect($this->resolver->zoneFor($areaId, $branchId))->toBeNull();

    $explained = $this->resolver->explain($areaId, $branchId);

    // …and `explain()` says which zone made that decision, so a caller can
    // tell "we do not go there" from "we have paused going there".
    expect($explained['scope'])->toBe('branch')
        ->and($explained['status'])->toBe('inactive')
        ->and($explained['serves'])->toBeFalse();
});

it('answers nothing at all for an area nobody claims', function (): void {
    DeliveryWorld::enterContext($this->a);

    $explained = $this->resolver->explain((string) $this->hamra->getKey());

    expect($this->resolver->zoneFor((string) $this->hamra->getKey()))->toBeNull()
        ->and($explained['scope'])->toBeNull()
        ->and($explained['serves'])->toBeFalse();
});

it('refuses an area in another country', function (): void {
    // The gazetteer is keyed (country, code) precisely because place names
    // repeat, so a foreign area is what a mistyped import produces.
    $zone = DeliveryWorld::zone($this->a->organisation, 'inner');
    $dubai = DeliveryWorld::area('ae-demo-al-quoz', 'AE');

    $this->putJson('/api/v1/catalogue/delivery-zones/'.$zone->getKey().'/areas', [
        'service_area_ids' => [(string) $dubai->getKey()],
    ], $this->headers + ['If-Match' => '"0"'])
        ->assertStatus(422)
        ->assertJsonPath('error.code', 'validation.failed')
        ->assertJsonPath('error.details.reason', 'area_country_mismatch')
        ->assertJsonPath('error.details.organisation_country', 'LB');
});

it('refuses an area the platform has withdrawn', function (): void {
    $zone = DeliveryWorld::zone($this->a->organisation, 'inner');
    $withdrawn = DeliveryWorld::area('closed-road', 'LB', active: false);

    $this->putJson('/api/v1/catalogue/delivery-zones/'.$zone->getKey().'/areas', [
        'service_area_ids' => [(string) $withdrawn->getKey()],
    ], $this->headers + ['If-Match' => '"0"'])
        ->assertStatus(422)
        ->assertJsonPath('error.details.reason', 'area_inactive');
});

it('keeps an already-claimed area that the platform later withdrew', function (): void {
    // A kitchen must not be forced to rebuild a map because the platform
    // withdrew a place it already serves — but the response says so.
    $zone = DeliveryWorld::zone($this->a->organisation, 'inner');
    $area = DeliveryWorld::area('fading', 'LB');
    DeliveryWorld::claim($zone, $area);

    $area->update(['is_active' => false]);

    $this->putJson('/api/v1/catalogue/delivery-zones/'.$zone->getKey().'/areas', [
        'service_area_ids' => [(string) $area->getKey(), (string) $this->badaro->getKey()],
    ], $this->headers + ['If-Match' => '"0"'])
        ->assertOk()
        ->assertJsonPath('meta.inactive_area_count', 1);
});

it('refuses an area that is not in the gazetteer at all', function (): void {
    $zone = DeliveryWorld::zone($this->a->organisation, 'inner');

    $this->putJson('/api/v1/catalogue/delivery-zones/'.$zone->getKey().'/areas', [
        'service_area_ids' => ['0199c3d0-0000-7000-8000-000000000000'],
    ], $this->headers + ['If-Match' => '"0"'])
        ->assertStatus(422)
        ->assertJsonStructure(['error' => ['details' => ['unknown_delivery_area_ids']]]);
});

it('refuses the same area named twice', function (): void {
    $zone = DeliveryWorld::zone($this->a->organisation, 'inner');
    $id = (string) $this->achrafieh->getKey();

    $this->putJson('/api/v1/catalogue/delivery-zones/'.$zone->getKey().'/areas', [
        'service_area_ids' => [$id, $id],
    ], $this->headers + ['If-Match' => '"0"'])
        ->assertStatus(422)
        ->assertJsonStructure(['error' => ['details' => ['fields']]]);
});

it('requires the zone validator on an area replacement', function (): void {
    $zone = DeliveryWorld::zone($this->a->organisation, 'inner');

    $this->putJson('/api/v1/catalogue/delivery-zones/'.$zone->getKey().'/areas', [
        'service_area_ids' => [],
    ], $this->headers)
        ->assertStatus(428)
        ->assertJsonPath('error.code', 'request.precondition_required');
});

it('serves a zone map with the areas in gazetteer order', function (): void {
    $zone = DeliveryWorld::zone($this->a->organisation, 'inner');

    $first = DeliveryWorld::area('zzz-late');
    $first->update(['display_order' => 1]);
    $second = DeliveryWorld::area('aaa-early');
    $second->update(['display_order' => 2]);

    DeliveryWorld::claim($zone, $first);
    DeliveryWorld::claim($zone, $second);

    $this->getJson('/api/v1/catalogue/delivery-zones/'.$zone->getKey().'/areas', $this->headers)
        ->assertOk()
        ->assertJsonPath('data.0.code', 'zzz-late')
        ->assertJsonPath('data.1.code', 'aaa-early');
});

it('audits the replacement with counts and no redactable key', function (): void {
    $zone = DeliveryWorld::zone($this->a->organisation, 'inner');

    $this->putJson('/api/v1/catalogue/delivery-zones/'.$zone->getKey().'/areas', [
        'service_area_ids' => [(string) $this->achrafieh->getKey()],
    ], $this->headers + ['If-Match' => '"0"'])->assertOk();

    $log = AuditLog::query()->where('action', 'catalogue.delivery_zone_areas_replaced')->sole();

    expect($log->subject_id)->toBe((string) $zone->getKey())
        ->and($log->metadata['area_count'] ?? null)->toBe(1)
        ->and($log->metadata['added_count'] ?? null)->toBe(1)
        ->and(array_filter((array) $log->metadata, static fn (mixed $value): bool => $value === '[redacted]'))->toBe([]);
});

it('never lets one organisation claim through another organisation zone', function (): void {
    $b = DeliveryWorld::kitchen('other-areas@kitchen.test');
    $theirs = DeliveryWorld::zone($b->organisation, 'their-zone');

    $this->putJson('/api/v1/catalogue/delivery-zones/'.$theirs->getKey().'/areas', [
        'service_area_ids' => [(string) $this->achrafieh->getKey()],
    ], $this->headers + ['If-Match' => '"0"'])
        ->assertStatus(404);
});

it('lets two organisations serve the same platform area independently', function (): void {
    // The gazetteer is shared; the maps over it are not. The unique key is
    // scoped by organisation, so one kitchen claiming Achrafieh says nothing
    // about another.
    $b = DeliveryWorld::kitchen('parallel@kitchen.test');

    $mine = DeliveryWorld::zone($this->a->organisation, 'mine');
    DeliveryWorld::claim($mine, $this->achrafieh);

    $theirs = DeliveryWorld::zone($b->organisation, 'theirs');
    DeliveryWorld::claim($theirs, $this->achrafieh);

    expect(DeliveryZoneArea::withoutTenancy()->where('delivery_area_id', $this->achrafieh->getKey())->count())->toBe(2);
});
