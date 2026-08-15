<?php

declare(strict_types=1);

use Healthy360\AccessControl\Database\Seeders\AccessControlSeeder;
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
    $this->tenant = PricingWorld::kitchen('qc@kitchen.test');
    $this->branch = OrganisationBranch::factory()->create([
        'organisation_id' => $this->tenant->organisation->getKey(),
        'country_code' => $this->tenant->organisation->country_code,
    ]);
    $this->actingAs($this->tenant->user);
    $this->headers = PricingWorld::headers($this->tenant) + [
        'X-Branch-Id' => (string) $this->branch->getKey(),
    ];
});

it('creates and releases a quality check', function (): void {
    $created = $this->postJson('/api/v1/catalogue/quality-control/checks', [
        'subject_type' => 'goods_receipt',
        'subject_id' => (string) Str::uuid(),
    ], $this->headers)->assertCreated();

    $id = $created->json('data.quality_check.id');

    $this->getJson('/api/v1/catalogue/quality-control/checks', $this->headers)->assertOk()
        ->assertJsonFragment(['id' => $id, 'subject_type' => 'goods_receipt', 'status' => 'pending']);

    $this->postJson('/api/v1/catalogue/quality-control/checks/'.$id.'/hold', [], $this->headers)->assertOk()
        ->assertJsonPath('data.quality_check.status', 'hold');

    $this->postJson('/api/v1/catalogue/quality-control/checks/'.$id.'/release', [], $this->headers)->assertOk()
        ->assertJsonPath('data.quality_check.status', 'released');
});

it('accepts a production_order subject, the other half of the O3 allow-list', function (): void {
    $this->postJson('/api/v1/catalogue/quality-control/checks', [
        'subject_type' => 'production_order',
        'subject_id' => (string) Str::uuid(),
    ], $this->headers)->assertCreated()
        ->assertJsonPath('data.quality_check.status', 'pending');
});

it('refuses a subject_type outside the allow-list', function (): void {
    $this->postJson('/api/v1/catalogue/quality-control/checks', [
        'subject_type' => 'purchase_order',
        'subject_id' => (string) Str::uuid(),
    ], $this->headers)->assertUnprocessable()
        ->assertJsonPath('error.code', 'validation.failed');
});
