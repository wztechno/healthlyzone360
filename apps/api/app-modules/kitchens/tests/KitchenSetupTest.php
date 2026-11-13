<?php

declare(strict_types=1);

use Carbon\CarbonImmutable;
use Healthy360\AccessControl\Database\Seeders\AccessControlSeeder;
use Healthy360\Kitchens\Models\KitchenServiceSettings;
use Healthy360\Kitchens\Services\KitchenServiceSettingsLookup;
use Healthy360\Orders\Services\OrderTimingRules;
use Healthy360\Organisations\Database\Seeders\OrganisationTypeSeeder;
use Healthy360\Pricing\Tests\Fixtures\PricingWorld;
use Healthy360\ReferenceData\Database\Seeders\ReferenceDataSeeder;

/*
|--------------------------------------------------------------------------
| A new kitchen is not open until its owner says so
|--------------------------------------------------------------------------
*/

beforeEach(function (): void {
    $this->seed([ReferenceDataSeeder::class, OrganisationTypeSeeder::class, AccessControlSeeder::class]);

    $this->tenant = PricingWorld::kitchen('owner@kitchen.test', ['branch.view_current', 'organisation.update_current']);
    $this->orgId = (string) $this->tenant->organisation->getKey();
    $this->headers = firstPartyHeaders() + ['X-Organisation-Id' => $this->orgId];
    $this->actingAs($this->tenant->user);
});

function notOpenYet(object $test): void
{
    KitchenServiceSettings::withoutTenancy()->updateOrCreate(['organisation_id' => $test->orgId], ['not_open_yet' => true]);
}

it('leaves a kitchen with no setting open', function (): void {
    expect(app(KitchenServiceSettingsLookup::class)->for($this->orgId)->not_open_yet)->toBeFalse()
        ->and(app(OrderTimingRules::class)->pauseRefusals($this->orgId, CarbonImmutable::now()))->toBe([]);
});

it('refuses a customer while the kitchen is not open', function (): void {
    notOpenYet($this);

    expect(app(OrderTimingRules::class)->pauseRefusals($this->orgId, CarbonImmutable::now())[0]['reason'])
        ->toBe('kitchen_not_open');
});

it('lists every step, and team does not hold going live back', function (): void {
    $steps = collect($this->getJson('/api/v1/kitchen/setup', $this->headers)->assertOk()->json('data.steps'))->keyBy('key');

    expect($steps->keys()->all())->toBe(['hours', 'delivery', 'menu', 'prices', 'team'])
        ->and($steps['team']['required'])->toBeFalse()
        ->and($steps['hours']['required'])->toBeTrue();
});

it('refuses to go live with a step unfinished', function (): void {
    notOpenYet($this);

    $this->postJson('/api/v1/kitchen/setup/go-live', [], $this->headers)->assertUnprocessable();

    expect(app(KitchenServiceSettingsLookup::class)->for($this->orgId)->not_open_yet)->toBeTrue();
});

it('keeps going live with the owner', function (): void {
    $manager = PricingWorld::kitchen('manager@kitchen.test', ['branch.view_current']);

    $this->actingAs($manager->user)
        ->postJson('/api/v1/kitchen/setup/go-live', [], firstPartyHeaders() + ['X-Organisation-Id' => (string) $manager->organisation->getKey()])
        ->assertForbidden();
});
