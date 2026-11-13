<?php

declare(strict_types=1);

use Healthy360\AccessControl\Database\Seeders\AccessControlSeeder;
use Healthy360\Orders\Models\OrderComplaint;
use Healthy360\Orders\Models\OrderLine;
use Healthy360\Orders\Services\PriceOverride;
use Healthy360\Organisations\Database\Seeders\OrganisationTypeSeeder;
use Healthy360\Pricing\Tests\Fixtures\PricingWorld;
use Healthy360\ReferenceData\Database\Seeders\ReferenceDataSeeder;

/*
| A complaint is tied to an order and a remake places a real order at zero. The
| order world here is the smallest a placement stands on; the desk's own tests
| prove the rest of the path.
*/

beforeEach(function (): void {
    $this->seed([ReferenceDataSeeder::class, OrganisationTypeSeeder::class, AccessControlSeeder::class]);
    $this->tenant = PricingWorld::kitchen('complaints@kitchen.test', ['order.supervise_organisation', 'order.view_organisation']);
    $this->actingAs($this->tenant->user);
    $this->headers = PricingWorld::headers($this->tenant);
});

it('refuses a complaint about an order that is not this kitchen\'s', function (): void {
    $this->postJson('/api/v1/catalogue/orders/019a0000-0000-7000-8000-000000000000/complaints', ['cause' => 'quality'], $this->headers)
        ->assertNotFound();
});

it('knows the remake price source the table now admits', function (): void {
    expect(PriceOverride::REMAKE)->toBe('remake')
        ->and(OrderComplaint::OUTCOMES)->toContain('remade');
});

it('reads an order line\'s option ids back as a remake carries them', function (): void {
    $line = new OrderLine;
    $line->selected_options = [['id' => 'a', 'kind' => 'remove', 'group_en' => null, 'group_ar' => null, 'name_en' => 'Onions', 'name_ar' => 'بصل']];

    expect(array_column($line->selected_options, 'id'))->toBe(['a']);
});
