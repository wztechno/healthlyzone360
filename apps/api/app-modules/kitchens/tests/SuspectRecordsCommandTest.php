<?php

declare(strict_types=1);

use Healthy360\AccessControl\Database\Seeders\AccessControlSeeder;
use Healthy360\Catalogues\Models\CatalogueItem;
use Healthy360\Catalogues\Tests\Fixtures\CatalogueWorld;
use Healthy360\Organisations\Database\Seeders\OrganisationTypeSeeder;
use Healthy360\ReferenceData\Database\Seeders\ReferenceDataSeeder;

beforeEach(function (): void {
    $this->seed([ReferenceDataSeeder::class, OrganisationTypeSeeder::class, AccessControlSeeder::class]);

    $this->tenant = CatalogueWorld::kitchen('owner@suspect.test');
});

it('lists what looks like test data, leaves look-alikes out, and changes nothing', function (): void {
    $plan = CatalogueWorld::plan($this->tenant, 'QA Plan A');
    CatalogueWorld::plan($this->tenant, 'Contest Tempura Bowl');
    CatalogueWorld::plan($this->tenant, 'E2E Lean Lunch');

    $before = CatalogueItem::query()->count();

    $this->artisan('kitchen:suspect-records')
        ->expectsOutputToContain('QA Plan A')
        ->expectsOutputToContain('E2E Lean Lunch')
        ->doesntExpectOutputToContain('Contest Tempura Bowl')
        ->assertSuccessful();

    expect(CatalogueItem::query()->count())->toBe($before)
        ->and($plan->fresh()->status)->toBe($plan->status);
});

it('refuses a slug that does not exist', function (): void {
    $this->artisan('kitchen:suspect-records', ['--org' => 'nobody'])->assertFailed();
});
