<?php

declare(strict_types=1);

use Healthy360\AccessControl\Database\Seeders\AccessControlSeeder;
use Healthy360\Audit\Models\AuditLog;
use Healthy360\Delivery\Enums\DeliveryZoneStatus;
use Healthy360\Delivery\Models\DeliveryZone;
use Healthy360\Delivery\Models\DeliveryZoneArea;
use Healthy360\Delivery\Tests\Fixtures\DeliveryWorld;
use Healthy360\Organisations\Database\Seeders\OrganisationTypeSeeder;
use Healthy360\ReferenceData\Database\Seeders\ReferenceDataSeeder;

/*
|--------------------------------------------------------------------------
| The delivery zone header, over HTTP
|--------------------------------------------------------------------------
|
| CRUD, the immutable code, the difference between suspending and archiving,
| the re-scoping of a zone and its claims together, `If-Match`, the cursor, and
| the permission that keeps the map away from everybody who is not configuring
| it.
|
*/

beforeEach(function (): void {
    $this->seed([ReferenceDataSeeder::class, OrganisationTypeSeeder::class, AccessControlSeeder::class]);

    $this->a = DeliveryWorld::kitchen('delivery@kitchen.test');
    $this->headers = DeliveryWorld::headers($this->a);

    $this->actingAs($this->a->user);
});

it('creates an active zone in the organisation currency', function (): void {
    $response = $this->postJson('/api/v1/catalogue/delivery-zones', [
        'code' => 'beirut-inner',
        'name_en' => 'Beirut inner',
        'name_ar' => 'بيروت الداخلية',
        'delivery_fee_minor' => 300,
        'minimum_order_minor' => 2500,
        'estimated_minutes' => 45,
    ], $this->headers)->assertStatus(201);

    // A new zone is active and covers nowhere, so there is no window in which
    // a half-built map quotes a delivery.
    $response->assertJsonPath('data.delivery_zone.status', 'active')
        ->assertJsonPath('data.delivery_zone.scope', 'organisation')
        // Defaulted from the organisation rather than demanded: a fee is one
        // number in the kitchen's home market.
        ->assertJsonPath('data.delivery_zone.currency_code', 'USD')
        ->assertHeader('ETag', '"0"');
});

it('keeps an unpriced zone unpriced rather than calling it free', function (): void {
    // The OD-2 rule, one level down from prices: NULL means nobody has decided
    // and `0` means delivery is free, and those are different commitments.
    $this->postJson('/api/v1/catalogue/delivery-zones', [
        'code' => 'undecided',
        'name_en' => 'Undecided',
    ], $this->headers)
        ->assertStatus(201)
        ->assertJsonPath('data.delivery_zone.delivery_fee_minor', null)
        ->assertJsonPath('data.delivery_zone.minimum_order_minor', null)
        ->assertJsonPath('data.delivery_zone.estimated_minutes', null);
});

it('accepts a free delivery stated as zero', function (): void {
    $this->postJson('/api/v1/catalogue/delivery-zones', [
        'code' => 'free-local',
        'name_en' => 'Free local',
        'delivery_fee_minor' => 0,
    ], $this->headers)
        ->assertStatus(201)
        ->assertJsonPath('data.delivery_zone.delivery_fee_minor', 0);
});

it('refuses a second zone with the same code', function (): void {
    DeliveryWorld::zone($this->a->organisation, 'beirut-inner');

    $this->postJson('/api/v1/catalogue/delivery-zones', [
        'code' => 'beirut-inner',
        'name_en' => 'Another map',
    ], $this->headers)
        ->assertStatus(409)
        ->assertJsonPath('error.code', 'resource.conflict')
        ->assertJsonPath('error.details.conflicting_field', 'code');
});

it('scopes a zone to a branch when one is named', function (): void {
    $this->postJson('/api/v1/catalogue/delivery-zones', [
        'code' => 'main-express',
        'name_en' => 'Main express',
        'branch_id' => (string) $this->a->branch->getKey(),
    ], $this->headers)
        ->assertStatus(201)
        ->assertJsonPath('data.delivery_zone.scope', 'branch')
        ->assertJsonPath('data.delivery_zone.branch_id', (string) $this->a->branch->getKey());
});

it('refuses a branch from another organisation', function (): void {
    $b = DeliveryWorld::kitchen('other@kitchen.test');

    $this->postJson('/api/v1/catalogue/delivery-zones', [
        'code' => 'borrowed',
        'name_en' => 'Borrowed branch',
        'branch_id' => (string) $b->branch->getKey(),
    ], $this->headers)
        ->assertStatus(422)
        ->assertJsonPath('error.code', 'validation.failed')
        ->assertJsonStructure(['error' => ['details' => ['fields' => ['branch_id']]]]);
});

it('serves a zone with its area count and addresses it by code', function (): void {
    $zone = DeliveryWorld::zone($this->a->organisation, 'beirut-inner');
    DeliveryWorld::claim($zone, DeliveryWorld::area('achrafieh'));
    DeliveryWorld::claim($zone, DeliveryWorld::area('badaro'));

    $this->getJson('/api/v1/catalogue/delivery-zones/beirut-inner', $this->headers)
        ->assertOk()
        ->assertHeader('ETag', '"0"')
        ->assertJsonPath('data.delivery_zone.code', 'beirut-inner')
        ->assertJsonPath('meta.area_count', 2);
});

it('renames a zone without touching its code', function (): void {
    $zone = DeliveryWorld::zone($this->a->organisation, 'beirut-inner');

    $this->patchJson('/api/v1/catalogue/delivery-zones/'.$zone->getKey(), [
        'name_en' => 'Beirut central',
        'delivery_fee_minor' => 500,
    ], $this->headers + ['If-Match' => '"0"'])
        ->assertOk()
        ->assertJsonPath('data.delivery_zone.name_en', 'Beirut central')
        ->assertJsonPath('data.delivery_zone.code', 'beirut-inner')
        ->assertJsonPath('data.delivery_zone.delivery_fee_minor', 500)
        ->assertHeader('ETag', '"1"');
});

it('refuses a code change rather than ignoring it', function (): void {
    // Refused, not stripped: a client that sent it believed it was writing
    // something, and silence teaches nothing.
    $zone = DeliveryWorld::zone($this->a->organisation, 'beirut-inner');

    $this->patchJson('/api/v1/catalogue/delivery-zones/'.$zone->getKey(), [
        'code' => 'beirut-outer',
    ], $this->headers + ['If-Match' => '"0"'])
        ->assertStatus(422)
        ->assertJsonStructure(['error' => ['details' => ['fields' => ['code']]]]);
});

it('refuses a status written as a field', function (): void {
    $zone = DeliveryWorld::zone($this->a->organisation, 'beirut-inner');

    $this->patchJson('/api/v1/catalogue/delivery-zones/'.$zone->getKey(), [
        'status' => 'archived',
    ], $this->headers + ['If-Match' => '"0"'])
        ->assertStatus(422)
        ->assertJsonStructure(['error' => ['details' => ['fields' => ['status']]]]);
});

it('suspends a zone without giving up its areas', function (): void {
    // The whole point of the distinction: a mountain road closed for the
    // winter should not cost a kitchen its map.
    $zone = DeliveryWorld::zone($this->a->organisation, 'mountain');
    DeliveryWorld::claim($zone, DeliveryWorld::area('faraya'));

    $this->patchJson('/api/v1/catalogue/delivery-zones/'.$zone->getKey(), [
        'is_active' => false,
    ], $this->headers + ['If-Match' => '"0"'])
        ->assertOk()
        ->assertJsonPath('data.delivery_zone.status', 'inactive')
        ->assertJsonPath('data.delivery_zone.is_active', false);

    expect(DeliveryZoneArea::withoutTenancy()->where('delivery_zone_id', $zone->getKey())->count())->toBe(1);
});

it('archives a zone and releases its areas', function (): void {
    $zone = DeliveryWorld::zone($this->a->organisation, 'mountain');
    DeliveryWorld::claim($zone, DeliveryWorld::area('faraya'));

    $this->postJson('/api/v1/catalogue/delivery-zones/'.$zone->getKey().'/archive', [], $this->headers + ['If-Match' => '"0"'])
        ->assertOk()
        ->assertJsonPath('data.delivery_zone.status', 'archived');

    // Released, so a replacement zone can take the area. An archived zone that
    // held its claims would make redrawing a map impossible.
    expect(DeliveryZoneArea::withoutTenancy()->where('delivery_zone_id', $zone->getKey())->count())->toBe(0)
        ->and(DeliveryZone::withoutTenancy()->whereKey($zone->getKey())->exists())->toBeTrue();
});

it('refuses to archive a zone twice', function (): void {
    $zone = DeliveryZone::factory()->archived()->create([
        'organisation_id' => $this->a->organisation->getKey(),
        'code' => 'gone',
        'currency_code' => 'USD',
    ]);

    $this->postJson('/api/v1/catalogue/delivery-zones/'.$zone->getKey().'/archive', [], $this->headers + ['If-Match' => '"0"'])
        ->assertStatus(409)
        ->assertJsonPath('error.code', 'resource.conflict');
});

it('freezes an archived zone against edits', function (): void {
    $zone = DeliveryZone::factory()->archived()->create([
        'organisation_id' => $this->a->organisation->getKey(),
        'code' => 'gone',
        'currency_code' => 'USD',
    ]);

    $this->patchJson('/api/v1/catalogue/delivery-zones/'.$zone->getKey(), [
        'name_en' => 'Resurrected',
    ], $this->headers + ['If-Match' => '"0"'])
        ->assertStatus(409)
        ->assertJsonPath('error.code', 'resource.conflict');
});

it('moves a zone to a branch and carries its area claims with it', function (): void {
    $zone = DeliveryWorld::zone($this->a->organisation, 'inner');
    $area = DeliveryWorld::area('achrafieh');
    DeliveryWorld::claim($zone, $area);

    $this->patchJson('/api/v1/catalogue/delivery-zones/'.$zone->getKey(), [
        'branch_id' => (string) $this->a->branch->getKey(),
    ], $this->headers + ['If-Match' => '"0"'])
        ->assertOk()
        ->assertJsonPath('data.delivery_zone.scope', 'branch');

    // The denormalised copy is what the one-area-per-branch index reads, so it
    // has to travel with the zone or the rule silently changes meaning.
    expect(DeliveryZoneArea::withoutTenancy()->where('delivery_zone_id', $zone->getKey())->value('branch_id'))
        ->toBe((string) $this->a->branch->getKey());
});

it('refuses to move a zone into a scope where another zone already serves the area', function (): void {
    $area = DeliveryWorld::area('achrafieh');

    $organisationWide = DeliveryWorld::zone($this->a->organisation, 'inner');
    DeliveryWorld::claim($organisationWide, $area);

    $branchZone = DeliveryWorld::zone($this->a->organisation, 'main-express', $this->a->branch);
    DeliveryWorld::claim($branchZone, $area);

    // Moving the organisation-wide zone into the branch would put two zones on
    // one area at one scope, which is exactly what the rule forbids.
    $this->patchJson('/api/v1/catalogue/delivery-zones/'.$organisationWide->getKey(), [
        'branch_id' => (string) $this->a->branch->getKey(),
    ], $this->headers + ['If-Match' => '"0"'])
        ->assertStatus(409)
        ->assertJsonPath('error.code', 'resource.conflict')
        ->assertJsonPath('error.details.reason', 'area_already_served')
        ->assertJsonPath('error.details.occupying_delivery_zone_id', (string) $branchZone->getKey());

    // And the header change rolled back with it — no half-move.
    expect(DeliveryZone::withoutTenancy()->whereKey($organisationWide->getKey())->value('branch_id'))->toBeNull();
});

it('requires If-Match on every zone write', function (): void {
    $zone = DeliveryWorld::zone($this->a->organisation, 'inner');

    $this->patchJson('/api/v1/catalogue/delivery-zones/'.$zone->getKey(), ['name_en' => 'X'], $this->headers)
        ->assertStatus(428)
        ->assertJsonPath('error.code', 'request.precondition_required');

    $this->postJson('/api/v1/catalogue/delivery-zones/'.$zone->getKey().'/archive', [], $this->headers)
        ->assertStatus(428);
});

it('refuses a stale validator', function (): void {
    $zone = DeliveryWorld::zone($this->a->organisation, 'inner');

    $this->patchJson('/api/v1/catalogue/delivery-zones/'.$zone->getKey(), ['name_en' => 'First'], $this->headers + ['If-Match' => '"0"'])
        ->assertOk();

    $this->patchJson('/api/v1/catalogue/delivery-zones/'.$zone->getKey(), ['name_en' => 'Second'], $this->headers + ['If-Match' => '"0"'])
        ->assertStatus(409);
});

it('excludes archived zones from the list unless asked for', function (): void {
    DeliveryWorld::zone($this->a->organisation, 'live');

    DeliveryZone::factory()->archived()->create([
        'organisation_id' => $this->a->organisation->getKey(),
        'code' => 'gone',
        'currency_code' => 'USD',
    ]);

    $this->getJson('/api/v1/catalogue/delivery-zones', $this->headers)
        ->assertOk()
        ->assertJsonCount(1, 'data')
        ->assertJsonPath('data.0.code', 'live');

    $this->getJson('/api/v1/catalogue/delivery-zones?status=archived', $this->headers)
        ->assertOk()
        ->assertJsonCount(1, 'data')
        ->assertJsonPath('data.0.code', 'gone');
});

it('selects the organisation-wide map by name', function (): void {
    // An absent filter already means "no filter", so "the rows whose branch is
    // null" needs a word of its own.
    DeliveryWorld::zone($this->a->organisation, 'wide');
    DeliveryWorld::zone($this->a->organisation, 'branch-only', $this->a->branch);

    $this->getJson('/api/v1/catalogue/delivery-zones?branch_id=organisation', $this->headers)
        ->assertOk()
        ->assertJsonCount(1, 'data')
        ->assertJsonPath('data.0.code', 'wide');

    $this->getJson('/api/v1/catalogue/delivery-zones?branch_id='.$this->a->branch->getKey(), $this->headers)
        ->assertOk()
        ->assertJsonCount(1, 'data')
        ->assertJsonPath('data.0.code', 'branch-only');
});

it('walks the zone list with a cursor', function (): void {
    foreach (range(1, 3) as $index) {
        DeliveryWorld::zone($this->a->organisation, 'zone-'.$index);
    }

    $first = $this->getJson('/api/v1/catalogue/delivery-zones?limit=2', $this->headers)
        ->assertOk()
        ->assertJsonCount(2, 'data')
        ->assertJsonPath('meta.has_more', true);

    $cursor = $first->json('meta.next_cursor');

    $this->getJson('/api/v1/catalogue/delivery-zones?limit=2&cursor='.$cursor, $this->headers)
        ->assertOk()
        ->assertJsonCount(1, 'data')
        ->assertJsonPath('meta.has_more', false);
});

it('never shows another organisation a zone', function (): void {
    $b = DeliveryWorld::kitchen('other@kitchen.test');
    $theirs = DeliveryWorld::zone($b->organisation, 'their-zone');

    $this->getJson('/api/v1/catalogue/delivery-zones', $this->headers)
        ->assertOk()
        ->assertJsonCount(0, 'data');

    // A zone in another tenant and a zone that never existed are the same
    // answer: nothing in the response says whether it exists elsewhere.
    $this->getJson('/api/v1/catalogue/delivery-zones/'.$theirs->getKey(), $this->headers)
        ->assertStatus(404)
        ->assertJsonPath('error.code', 'resource.not_found');
});

it('refuses a caller without the delivery permission', function (): void {
    $viewer = DeliveryWorld::kitchen('viewer@kitchen.test', ['branch.view_current']);

    $this->actingAs($viewer->user);

    $this->getJson('/api/v1/catalogue/delivery-zones', DeliveryWorld::headers($viewer))
        ->assertStatus(403)
        ->assertJsonPath('error.code', 'authz.permission_denied');
});

it('audits creation, update and archiving without a redactable key', function (): void {
    $response = $this->postJson('/api/v1/catalogue/delivery-zones', [
        'code' => 'audited',
        'name_en' => 'Audited',
    ], $this->headers)->assertStatus(201);

    $id = $response->json('data.delivery_zone.id');

    $this->patchJson('/api/v1/catalogue/delivery-zones/'.$id, ['name_en' => 'Renamed'], $this->headers + ['If-Match' => '"0"'])->assertOk();
    $this->postJson('/api/v1/catalogue/delivery-zones/'.$id.'/archive', [], $this->headers + ['If-Match' => '"1"'])->assertOk();

    $actions = AuditLog::query()->where('subject_id', $id)->pluck('action')->all();

    expect($actions)->toEqualCanonicalizing([
        'catalogue.delivery_zone_created',
        'catalogue.delivery_zone_updated',
        'catalogue.delivery_zone_archived',
    ]);

    // `AuditRecorder` redacts any key containing `code`, so a currency is
    // recorded under `currency` (OQ-036, R-019). A metadata value of
    // "[redacted]" here would mean the convention slipped.
    $created = AuditLog::query()->where('action', 'catalogue.delivery_zone_created')->sole();

    expect($created->metadata['currency'] ?? null)->toBe('USD')
        ->and(array_filter((array) $created->metadata, static fn (mixed $value): bool => $value === '[redacted]'))->toBe([]);
});

it('leaves a zone status enum that only says three things', function (): void {
    expect(array_map(static fn (DeliveryZoneStatus $case): string => $case->value, DeliveryZoneStatus::cases()))
        ->toBe(['active', 'inactive', 'archived']);
});

it('serves the zone list as numbered pages', function (): void {
    foreach (range(1, 5) as $index) {
        DeliveryWorld::zone($this->a->organisation, 'zone-'.$index);
    }

    $this->getJson('/api/v1/catalogue/delivery-zones?page=1&per_page=2', $this->headers)
        ->assertOk()
        ->assertJsonCount(2, 'data')
        ->assertJsonPath('meta.total_count', 5)
        ->assertJsonPath('meta.total_pages', 3);

    $this->getJson('/api/v1/catalogue/delivery-zones?page=3&per_page=2', $this->headers)
        ->assertOk()
        ->assertJsonCount(1, 'data');

    $this->getJson('/api/v1/catalogue/delivery-zones?page=0', $this->headers)
        ->assertStatus(400)
        ->assertJsonPath('error.details.parameter', 'page');
});
