<?php

declare(strict_types=1);

use Healthy360\AccessControl\Database\Seeders\AccessControlSeeder;
use Healthy360\KitchenDisplay\Models\KitchenDisplayTicket;
use Healthy360\Organisations\Database\Seeders\OrganisationTypeSeeder;
use Healthy360\Organisations\Models\OrganisationBranch;
use Healthy360\Pricing\Tests\Fixtures\PricingWorld;
use Healthy360\ReferenceData\Database\Seeders\ReferenceDataSeeder;
use Illuminate\Support\Str;

beforeEach(function (): void {
    $this->seed([
        ReferenceDataSeeder::class,
        OrganisationTypeSeeder::class,
        AccessControlSeeder::class,
    ]);
    $this->tenant = PricingWorld::kitchen('kds@kitchen.test');
    $this->branch = OrganisationBranch::factory()->create([
        'organisation_id' => $this->tenant->organisation->getKey(),
        'country_code' => $this->tenant->organisation->country_code,
    ]);
    $this->actingAs($this->tenant->user);
    $this->headers = PricingWorld::headers($this->tenant) + [
        'X-Branch-Id' => (string) $this->branch->getKey(),
    ];
});

it('lists and bumps kds tickets', function (): void {
    $ticket = KitchenDisplayTicket::query()->create([
        'organisation_id' => $this->tenant->organisation->getKey(),
        'branch_id' => $this->branch->getKey(),
        'source_type' => 'order',
        'source_id' => (string) Str::uuid(),
        'label' => 'Order 42',
        'status' => 'new',
    ]);

    $this->getJson('/api/v1/catalogue/kitchen-display/tickets', $this->headers)->assertOk();

    $this->postJson('/api/v1/catalogue/kitchen-display/tickets/'.$ticket->getKey().'/bump', [], $this->headers)
        ->assertOk()
        ->assertJsonPath('data.ticket.status', 'bumped');
});
