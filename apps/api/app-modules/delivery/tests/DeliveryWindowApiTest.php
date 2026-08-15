<?php

declare(strict_types=1);

use Healthy360\AccessControl\Database\Seeders\AccessControlSeeder;
use Healthy360\Audit\Models\AuditLog;
use Healthy360\Delivery\Models\DeliveryWindow;
use Healthy360\Delivery\Tests\Fixtures\DeliveryWorld;
use Healthy360\Organisations\Database\Seeders\OrganisationTypeSeeder;
use Healthy360\ReferenceData\Database\Seeders\ReferenceDataSeeder;
use Illuminate\Database\QueryException;
use Illuminate\Support\Facades\DB;

/*
|--------------------------------------------------------------------------
| Delivery windows — the slots a checkout offers
|--------------------------------------------------------------------------
|
| A vocabulary: immutable code, no delete, withdrawal by flag, and no cursor
| because a kitchen has four of these and a picker renders them whole.
|
| Two conventions carry the weight. `weekdays: []` means every day, and it is
| the *only* encoding of that fact — all seven normalises to the empty array,
| so a filter comparing two daily windows never finds them different. And the
| times are a clock face, paired: both or neither, and the end after the start.
|
*/

beforeEach(function (): void {
    $this->seed([ReferenceDataSeeder::class, OrganisationTypeSeeder::class, AccessControlSeeder::class]);

    $this->a = DeliveryWorld::kitchen('windows@kitchen.test');
    $this->headers = DeliveryWorld::headers($this->a);

    $this->actingAs($this->a->user);
});

it('creates a window that runs every day', function (): void {
    $this->postJson('/api/v1/catalogue/delivery-windows', [
        'code' => 'morning',
        'name_en' => 'Morning',
        'name_ar' => 'صباحاً',
        'starts_at' => '09:00',
        'ends_at' => '12:00',
    ], $this->headers)
        ->assertStatus(201)
        ->assertJsonPath('data.delivery_window.weekdays', [])
        // HH:MM on the wire; seconds on a delivery window are noise every
        // client would have to trim.
        ->assertJsonPath('data.delivery_window.starts_at', '09:00')
        ->assertJsonPath('data.delivery_window.ends_at', '12:00')
        ->assertJsonPath('data.delivery_window.is_active', true);
});

it('normalises all seven weekdays to every day', function (): void {
    // One fact, one encoding. Storing both would let two windows that run
    // daily compare as different.
    $this->postJson('/api/v1/catalogue/delivery-windows', [
        'code' => 'always',
        'name_en' => 'Always',
        'weekdays' => [1, 2, 3, 4, 5, 6, 7],
    ], $this->headers)
        ->assertStatus(201)
        ->assertJsonPath('data.delivery_window.weekdays', []);
});

it('sorts and deduplicates a partial weekday set', function (): void {
    $this->postJson('/api/v1/catalogue/delivery-windows', [
        'code' => 'weekend',
        'name_en' => 'Weekend',
        'weekdays' => [7, 6, 6],
    ], $this->headers)
        ->assertStatus(201)
        ->assertJsonPath('data.delivery_window.weekdays', [6, 7]);
});

it('accepts a window nobody has given hours to yet', function (): void {
    // A kitchen that has named its slots before deciding their hours has a
    // legitimate half-finished window.
    $this->postJson('/api/v1/catalogue/delivery-windows', [
        'code' => 'unnamed-hours',
        'name_en' => 'To be decided',
    ], $this->headers)
        ->assertStatus(201)
        ->assertJsonPath('data.delivery_window.starts_at', null)
        ->assertJsonPath('data.delivery_window.ends_at', null);
});

it('refuses half a window', function (): void {
    $this->postJson('/api/v1/catalogue/delivery-windows', [
        'code' => 'half',
        'name_en' => 'Half',
        'starts_at' => '09:00',
    ], $this->headers)
        ->assertStatus(422)
        ->assertJsonStructure(['error' => ['details' => ['fields' => ['ends_at']]]]);

    $this->postJson('/api/v1/catalogue/delivery-windows', [
        'code' => 'other-half',
        'name_en' => 'Other half',
        'ends_at' => '12:00',
    ], $this->headers)
        ->assertStatus(422)
        ->assertJsonStructure(['error' => ['details' => ['fields' => ['starts_at']]]]);
});

it('refuses an overnight window with a sentence explaining the limit', function (): void {
    $response = $this->postJson('/api/v1/catalogue/delivery-windows', [
        'code' => 'night',
        'name_en' => 'Night',
        'starts_at' => '22:00',
        'ends_at' => '02:00',
    ], $this->headers)->assertStatus(422);

    expect($response->json('error.message'))->toContain('two windows');
});

it('refuses a window that ends when it starts', function (): void {
    $this->postJson('/api/v1/catalogue/delivery-windows', [
        'code' => 'instant',
        'name_en' => 'Instant',
        'starts_at' => '09:00',
        'ends_at' => '09:00',
    ], $this->headers)->assertStatus(422);
});

it('refuses a weekday outside the ISO range', function (): void {
    $this->postJson('/api/v1/catalogue/delivery-windows', [
        'code' => 'eighth-day',
        'name_en' => 'Eighth day',
        'weekdays' => [8],
    ], $this->headers)->assertStatus(422);
});

it('refuses a duplicate code inside the organisation and allows it in another', function (): void {
    DeliveryWindow::factory()->create(['organisation_id' => $this->a->organisation->getKey(), 'code' => 'morning']);

    $this->postJson('/api/v1/catalogue/delivery-windows', [
        'code' => 'morning',
        'name_en' => 'Morning again',
    ], $this->headers)
        ->assertStatus(409)
        ->assertJsonPath('error.details.conflicting_field', 'code');

    // A window is one kitchen's word for one of its own slots, so the same
    // code elsewhere is not a collision.
    $b = DeliveryWorld::kitchen('other-windows@kitchen.test');

    $this->actingAs($b->user);

    $this->postJson('/api/v1/catalogue/delivery-windows', [
        'code' => 'morning',
        'name_en' => 'Morning',
    ], DeliveryWorld::headers($b))->assertStatus(201);
});

it('renames a window with no If-Match at all', function (): void {
    // Precondition-free: these rows carry no lock_version, and the concurrency
    // contract applies only to resources that do.
    $window = DeliveryWindow::factory()->create(['organisation_id' => $this->a->organisation->getKey(), 'code' => 'morning']);

    $this->patchJson('/api/v1/catalogue/delivery-windows/'.$window->getKey(), [
        'name_en' => 'Early',
    ], $this->headers)
        ->assertOk()
        ->assertJsonPath('data.delivery_window.name_en', 'Early');
});

it('compares one end of a window against the stored other end', function (): void {
    // A client moving one end should not have to restate the other.
    $window = DeliveryWindow::factory()->create([
        'organisation_id' => $this->a->organisation->getKey(),
        'code' => 'morning',
        'starts_at' => '09:00:00',
        'ends_at' => '12:00:00',
    ]);

    $this->patchJson('/api/v1/catalogue/delivery-windows/'.$window->getKey(), [
        'ends_at' => '08:00',
    ], $this->headers)->assertStatus(422);

    $this->patchJson('/api/v1/catalogue/delivery-windows/'.$window->getKey(), [
        'ends_at' => '14:00',
    ], $this->headers)
        ->assertOk()
        ->assertJsonPath('data.delivery_window.ends_at', '14:00');
});

it('refuses a code change rather than ignoring it', function (): void {
    $window = DeliveryWindow::factory()->create(['organisation_id' => $this->a->organisation->getKey(), 'code' => 'morning']);

    $this->patchJson('/api/v1/catalogue/delivery-windows/'.$window->getKey(), [
        'code' => 'evening',
    ], $this->headers)
        ->assertStatus(422)
        ->assertJsonStructure(['error' => ['details' => ['fields' => ['code']]]]);
});

it('serves deactivated windows with their flag rather than hiding them', function (): void {
    // There is no delete, so the only way to see a withdrawn slot is to be
    // shown it.
    DeliveryWindow::factory()->create(['organisation_id' => $this->a->organisation->getKey(), 'code' => 'morning']);
    DeliveryWindow::factory()->inactive()->create(['organisation_id' => $this->a->organisation->getKey(), 'code' => 'retired-slot']);

    $this->getJson('/api/v1/catalogue/delivery-windows', $this->headers)
        ->assertOk()
        ->assertJsonCount(2, 'data')
        ->assertJsonPath('meta.count', 2)
        ->assertJsonPath('meta.active_count', 1);
});

it('lists windows unpaginated in display order', function (): void {
    DeliveryWindow::factory()->create(['organisation_id' => $this->a->organisation->getKey(), 'code' => 'evening', 'display_order' => 2]);
    DeliveryWindow::factory()->create(['organisation_id' => $this->a->organisation->getKey(), 'code' => 'morning', 'display_order' => 1]);

    $this->getJson('/api/v1/catalogue/delivery-windows', $this->headers)
        ->assertOk()
        ->assertJsonPath('data.0.code', 'morning')
        ->assertJsonPath('data.1.code', 'evening')
        // No cursor is offered, and none is needed.
        ->assertJsonMissingPath('meta.next_cursor');
});

it('never shows another organisation a window', function (): void {
    $b = DeliveryWorld::kitchen('isolated-windows@kitchen.test');
    $theirs = DeliveryWindow::factory()->create(['organisation_id' => $b->organisation->getKey(), 'code' => 'theirs']);

    $this->getJson('/api/v1/catalogue/delivery-windows', $this->headers)
        ->assertOk()
        ->assertJsonCount(0, 'data');

    $this->patchJson('/api/v1/catalogue/delivery-windows/'.$theirs->getKey(), ['name_en' => 'Hijacked'], $this->headers)
        ->assertStatus(404);
});

it('refuses a caller without the delivery permission', function (): void {
    $viewer = DeliveryWorld::kitchen('window-viewer@kitchen.test', ['branch.view_current']);

    $this->actingAs($viewer->user);

    $this->getJson('/api/v1/catalogue/delivery-windows', DeliveryWorld::headers($viewer))
        ->assertStatus(403);
});

it('audits window creation and update', function (): void {
    $response = $this->postJson('/api/v1/catalogue/delivery-windows', [
        'code' => 'audited',
        'name_en' => 'Audited',
        'weekdays' => [1, 2],
    ], $this->headers)->assertStatus(201);

    $id = $response->json('data.delivery_window.id');

    $this->patchJson('/api/v1/catalogue/delivery-windows/'.$id, ['name_en' => 'Renamed'], $this->headers)->assertOk();

    expect(AuditLog::query()->where('subject_id', $id)->pluck('action')->all())
        ->toEqualCanonicalizing(['catalogue.delivery_window_created', 'catalogue.delivery_window_updated']);
});

it('backs the time ordering with a database CHECK', function (): void {
    // The service refuses it with a sentence a human can act on; the CHECK is
    // what makes it true for an importer or a backfill that never sees the
    // service.
    $insert = fn () => DB::transaction(fn () => DeliveryWindow::withoutTenancy()->create([
        'organisation_id' => $this->a->organisation->getKey(),
        'code' => 'reversed',
        'name_en' => 'Reversed',
        'name_ar' => 'معكوس',
        'starts_at' => '20:00:00',
        'ends_at' => '08:00:00',
        'weekdays' => [],
    ]));

    expect($insert)->toThrow(QueryException::class);
});
