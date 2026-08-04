<?php

declare(strict_types=1);

use Healthy360\AccessControl\Database\Seeders\AccessControlSeeder;
use Healthy360\Cart\Tests\Fixtures\CheckoutWorld;
use Healthy360\Organisations\Database\Seeders\OrganisationTypeSeeder;
use Healthy360\POS\Models\PosRegister;
use Healthy360\POS\Models\PosShift;
use Healthy360\Pricing\Tests\Fixtures\PricingWorld;
use Healthy360\ReferenceData\Database\Seeders\ReferenceDataSeeder;

beforeEach(function (): void {
    $this->seed([
        ReferenceDataSeeder::class,
        OrganisationTypeSeeder::class,
        AccessControlSeeder::class,
    ]);
    $this->world = CheckoutWorld::build('pos@kitchen.test');
    $this->actingAs($this->world->tenant->user);
    $this->headers = PricingWorld::headers($this->world->tenant);
});

it('records an online pos sale', function (): void {
    $register = PosRegister::query()->create([
        'organisation_id' => $this->world->organisation->getKey(),
        'branch_id' => $this->world->branch->getKey(),
        'code' => 'counter-1',
        'name_en' => 'Counter 1',
    ]);

    $shift = PosShift::query()->create([
        'pos_register_id' => $register->getKey(),
        'opened_by' => $this->world->tenant->user->getKey(),
        'opened_at' => now(),
    ]);

    $this->postJson('/api/v1/catalogue/pos/sales', [
        'pos_shift_id' => (string) $shift->getKey(),
        'payment_method_kind' => 'cash_on_delivery',
        'currency_code' => 'USD',
        'lines' => [[
            'catalogue_item_id' => (string) $this->world->meal->getKey(),
            'quantity' => 1,
            'line_total_minor' => 1500,
        ]],
    ], $this->headers)->assertCreated();
});
