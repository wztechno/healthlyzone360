<?php

declare(strict_types=1);

use Healthy360\AccessControl\Database\Seeders\AccessControlSeeder;
use Healthy360\Delivery\Models\DeliveryWindow;
use Healthy360\Delivery\Models\DeliveryZone;
use Healthy360\Delivery\Models\DeliveryZoneArea;
use Healthy360\Delivery\Tests\Fixtures\DeliveryWorld;
use Healthy360\Organisations\Database\Seeders\OrganisationTypeSeeder;
use Healthy360\ReferenceData\Database\Seeders\ReferenceDataSeeder;
use Healthy360\ReferenceData\Models\DeliveryArea;
use Healthy360\Support\Attributes\Classified;
use Healthy360\Support\Enums\DataClassification;
use Healthy360\Tenancy\Exceptions\MissingTenantContext;
use Healthy360\Tenancy\TenantContext;
use Illuminate\Database\QueryException;
use Illuminate\Support\Facades\DB;

/*
|--------------------------------------------------------------------------
| What a zone holds on to, and what holds on to a zone
|--------------------------------------------------------------------------
|
| The gazetteer is `restrictOnDelete` from below: withdrawing a place while
| kitchens still serve it would silently unpick their maps, so the platform
| deactivates instead. The claims cascade from the zone, because they are the
| zone's own body.
|
| The other half is the tenant boundary at the application layer. `RlsTest`
| proves the PostgreSQL policies independently, under SET ROLE; this suite
| proves the global scope, which is the layer a query passes through first
| (ADR-0007: two layers, two suites). No delivery table takes a policy in
| K1.7 — a zone is a customer-published fact — so this is the isolation these
| tables actually have, and it is asserted rather than assumed.
|
*/

beforeEach(function (): void {
    $this->seed([ReferenceDataSeeder::class, OrganisationTypeSeeder::class, AccessControlSeeder::class]);

    $this->a = DeliveryWorld::kitchen('deps@delivery.test');
    $this->zone = DeliveryWorld::zone($this->a->organisation, 'inner');
    $this->area = DeliveryWorld::area('achrafieh');
});

it('refuses to delete a platform area that a kitchen still serves', function (): void {
    DeliveryWorld::claim($this->zone, $this->area);

    // A savepoint, so the refusal does not abort the transaction the test
    // itself is running inside.
    $delete = fn () => DB::transaction(fn () => DeliveryArea::query()->whereKey($this->area->getKey())->delete());

    expect($delete)->toThrow(QueryException::class);

    expect(DeliveryArea::query()->whereKey($this->area->getKey())->exists())->toBeTrue();
});

it('takes the claims with the zone when the zone itself goes', function (): void {
    // Nothing in the API deletes a zone — `archive` is the withdrawal — so
    // this is the schema being consistent rather than a supported operation.
    DeliveryWorld::claim($this->zone, $this->area);

    DeliveryZone::withoutTenancy()->whereKey($this->zone->getKey())->delete();

    expect(DeliveryZoneArea::withoutTenancy()->where('delivery_zone_id', $this->zone->getKey())->count())->toBe(0)
        ->and(DeliveryArea::query()->whereKey($this->area->getKey())->exists())->toBeTrue();
});

it('nulls both branch columns when a branch is deleted, keeping them in step', function (): void {
    // The denormalised copy has to follow the parent or the one-area-per-branch
    // rule silently changes meaning — an orphan claim pointing at a branch that
    // no longer exists would occupy a scope nothing can reach.
    $branchZone = DeliveryWorld::zone($this->a->organisation, 'branch-zone', $this->a->branch);
    $claim = DeliveryWorld::claim($branchZone, $this->area);

    $this->a->branch->delete();

    expect(DeliveryZone::withoutTenancy()->whereKey($branchZone->getKey())->value('branch_id'))->toBeNull()
        ->and(DeliveryZoneArea::withoutTenancy()->whereKey($claim->getKey())->value('branch_id'))->toBeNull();
});

it('enforces one zone per area per branch at the database, not only in the service', function (): void {
    // The service refuses it first with a message naming the occupying zone;
    // the constraint is what makes the rule true under concurrency and for an
    // importer that never reaches the service.
    DeliveryWorld::claim($this->zone, $this->area);

    $second = DeliveryWorld::zone($this->a->organisation, 'outer');

    $insert = fn () => DB::transaction(fn () => DeliveryWorld::claim($second, $this->area));

    expect($insert)->toThrow(QueryException::class);
});

it('scopes every delivery query to the active organisation', function (): void {
    $b = DeliveryWorld::kitchen('other-deps@delivery.test');
    $theirZone = DeliveryWorld::zone($b->organisation, 'their-zone');
    DeliveryWorld::claim($theirZone, $this->area);
    DeliveryWindow::factory()->create(['organisation_id' => $b->organisation->getKey(), 'code' => 'their-window']);

    $mine = DeliveryWorld::claim($this->zone, $this->area);
    DeliveryWindow::factory()->create(['organisation_id' => $this->a->organisation->getKey(), 'code' => 'my-window']);

    app(TenantContext::class)->setOrganisation(
        (string) $this->a->user->getKey(),
        (string) $this->a->organisation->getKey(),
    );

    expect(DeliveryZone::query()->pluck('code')->all())->toBe(['inner'])
        ->and(DeliveryZoneArea::query()->pluck('id')->all())->toBe([$mine->getKey()])
        ->and(DeliveryWindow::query()->pluck('code')->all())->toBe(['my-window']);
});

it('keeps a delivery model unreadable with no tenant context at all', function (): void {
    // Fail-closed: the global scope throws rather than quietly returning
    // everything, which is the difference between a bug and a breach.
    app(TenantContext::class)->clear();

    expect(fn () => DeliveryZone::query()->get())->toThrow(MissingTenantContext::class)
        ->and(fn () => DeliveryZoneArea::query()->get())->toThrow(MissingTenantContext::class)
        ->and(fn () => DeliveryWindow::query()->get())->toThrow(MissingTenantContext::class);
});

it('leaves the platform gazetteer readable with no tenant context at all', function (): void {
    // The mirror of the assertion above, and the reason the gazetteer is not a
    // tenant table: an anonymous customer picking an area has no organisation.
    app(TenantContext::class)->clear();

    expect(DeliveryArea::query()->count())->toBeGreaterThan(0);
});

it('classifies the zone as internal and the gazetteer as platform reference', function (): void {
    // What the data register and the RLS decision both rest on, asserted
    // rather than left as a docblock.
    expect(Classified::map(DeliveryZone::class))->toMatchArray([
        'code' => DataClassification::Internal,
        'name_en' => DataClassification::Internal,
    ]);

    expect(Classified::map(DeliveryWindow::class))->toMatchArray([
        'code' => DataClassification::Public,
    ]);
});
