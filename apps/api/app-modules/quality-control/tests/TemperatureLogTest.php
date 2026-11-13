<?php

declare(strict_types=1);

use Healthy360\AccessControl\Database\Seeders\AccessControlSeeder;
use Healthy360\Organisations\Database\Seeders\OrganisationTypeSeeder;
use Healthy360\Organisations\Models\OrganisationBranch;
use Healthy360\Pricing\Tests\Fixtures\PricingWorld;
use Healthy360\QualityControl\Models\TemperatureReading;
use Healthy360\ReferenceData\Database\Seeders\ReferenceDataSeeder;
use Healthy360\Support\Models\StaffNotification;
use Illuminate\Support\Facades\Mail;

/*
| A reading outside the range alerts the managers, one inside does not, and a
| slot is written once: that is what the log is worth to an inspector.
*/

beforeEach(function (): void {
    $this->seed([ReferenceDataSeeder::class, OrganisationTypeSeeder::class, AccessControlSeeder::class]);
    Mail::fake();
    $this->withoutDefer();

    $this->tenant = PricingWorld::kitchen('haccp@kitchen.test', ['inventory.manage_organisation', 'inventory.view_organisation', 'order.prepare_organisation', 'order.supervise_organisation']);
    $this->branch = OrganisationBranch::factory()->create([
        'organisation_id' => $this->tenant->organisation->getKey(),
        'country_code' => $this->tenant->organisation->country_code,
    ]);
    $this->actingAs($this->tenant->user);
    $this->headers = PricingWorld::headers($this->tenant) + ['X-Branch-Id' => (string) $this->branch->getKey()];

    $this->unit = $this->postJson('/api/v1/catalogue/quality-control/temperature-units', [
        'name' => 'Walk-in fridge',
        'kind' => 'fridge',
        'min_c' => 0,
        'max_c' => 5,
    ], $this->headers)->assertCreated()->json('data.unit.id');
});

it('records a reading in range and wakes nobody', function (): void {
    $this->postJson('/api/v1/catalogue/quality-control/temperature-readings', [
        'temperature_unit_id' => $this->unit,
        'slot' => 'am',
        'celsius' => '3.5',
    ], $this->headers)->assertCreated()->assertJsonPath('data.reading.out_of_range', false);

    expect(StaffNotification::withoutTenancy()->count())->toBe(0);
});

it('alerts the managers when a reading is out of range', function (): void {
    $this->postJson('/api/v1/catalogue/quality-control/temperature-readings', [
        'temperature_unit_id' => $this->unit,
        'slot' => 'am',
        'celsius' => '9',
    ], $this->headers)->assertCreated()->assertJsonPath('data.reading.out_of_range', true);

    expect(StaffNotification::withoutTenancy()->where('type', 'temperature_out_of_range')->exists())->toBeTrue();
});

it('takes a slot once', function (): void {
    $body = ['temperature_unit_id' => $this->unit, 'slot' => 'pm', 'celsius' => '2'];

    $this->postJson('/api/v1/catalogue/quality-control/temperature-readings', $body, $this->headers)->assertCreated();
    $this->postJson('/api/v1/catalogue/quality-control/temperature-readings', $body, $this->headers)->assertConflict();

    expect(TemperatureReading::withoutTenancy()->count())->toBe(1);
});

it('serves the month the reading was taken in', function (): void {
    $this->postJson('/api/v1/catalogue/quality-control/temperature-readings', [
        'temperature_unit_id' => $this->unit,
        'slot' => 'am',
        'celsius' => '1',
    ], $this->headers)->assertCreated();

    $this->getJson('/api/v1/catalogue/quality-control/temperature-log', $this->headers)->assertOk()
        ->assertJsonPath('data.units.0.name', 'Walk-in fridge')
        ->assertJsonPath('data.readings.0.unit_name', 'Walk-in fridge');
});

it('refuses a range the wrong way round', function (): void {
    $this->postJson('/api/v1/catalogue/quality-control/temperature-units', [
        'name' => 'Freezer',
        'kind' => 'freezer',
        'min_c' => -10,
        'max_c' => -18,
    ], $this->headers)->assertUnprocessable();
});
