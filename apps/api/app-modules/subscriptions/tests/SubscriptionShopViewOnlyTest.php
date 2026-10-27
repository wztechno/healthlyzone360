<?php

declare(strict_types=1);

use Healthy360\AccessControl\Database\Seeders\AccessControlSeeder;
use Healthy360\Organisations\Database\Seeders\OrganisationTypeSeeder;
use Healthy360\Organisations\Models\OrganisationMembership;
use Healthy360\ReferenceData\Database\Seeders\ReferenceDataSeeder;
use Healthy360\Subscriptions\Models\Subscription;
use Healthy360\Subscriptions\Tests\Fixtures\SubscriptionWorld;

/*
| A plan is bought on a sales channel like a basket is filled on one, so the
| shop's trading rule (`CartLocator::assertShopperMayUseChannel`) is asked of
| it too: kitchen staff browse the plans and subscribe to none of them.
*/

beforeEach(function (): void {
    $this->seed([ReferenceDataSeeder::class, OrganisationTypeSeeder::class, AccessControlSeeder::class]);

    $this->world = SubscriptionWorld::build('plans-view-only@kitchen.test');
});

it('refuses kitchen staff a subscription from the shop', function (): void {
    OrganisationMembership::factory()->create([
        'organisation_id' => $this->world->organisation->getKey(),
        'user_id' => $this->world->customer->account->user_id,
    ]);

    $this->actingAs($this->world->customer->account->user)
        ->postJson('/api/v1/subscriptions', [
            'sales_channel_id' => (string) $this->world->channel->getKey(),
            'branch_id' => (string) $this->world->branch->getKey(),
            'catalogue_item_id' => (string) $this->world->plan->getKey(),
            'catalogue_item_variant_id' => (string) $this->world->configuration->getKey(),
            'plan_duration_id' => (string) $this->world->duration->getKey(),
            'customer_address_id' => (string) $this->world->customer->address->getKey(),
            'weekdays' => [1, 2, 3, 4, 5, 6, 7],
        ], firstPartyHeaders() + ['Idempotency-Key' => 'staff-plan-1'])
        ->assertForbidden()
        ->assertJsonPath('error.code', 'shop.view_only');

    expect(Subscription::query()->count())->toBe(0);
});
