<?php

declare(strict_types=1);

use App\Models\User;
use Carbon\CarbonImmutable;
use Healthy360\AccessControl\Database\Seeders\AccessControlSeeder;
use Healthy360\AccessControl\Models\MembershipRole;
use Healthy360\AccessControl\Models\Permission;
use Healthy360\AccessControl\Models\Role;
use Healthy360\AccessControl\Models\RolePermission;
use Healthy360\Catalogues\Models\CatalogueItem;
use Healthy360\Catalogues\Models\CatalogueItemVariant;
use Healthy360\Catalogues\Models\PlanDuration;
use Healthy360\Catalogues\Models\PlanVariantProfile;
use Healthy360\Customers\Database\Factories\CustomerAccountFactory;
use Healthy360\Customers\Models\CustomerAddress;
use Healthy360\Orders\Models\Order;
use Healthy360\Organisations\Database\Seeders\OrganisationTypeSeeder;
use Healthy360\Organisations\Models\OrganisationMembership;
use Healthy360\Pricing\Tests\Fixtures\PricingWorld;
use Healthy360\ReferenceData\Database\Seeders\ReferenceDataSeeder;
use Healthy360\Subscriptions\Enums\MealChoiceSource;
use Healthy360\Subscriptions\Enums\SubscriptionDeliveryStatus;
use Healthy360\Subscriptions\Models\Subscription;
use Healthy360\Subscriptions\Models\SubscriptionDelivery;
use Healthy360\Subscriptions\Models\SubscriptionMealChoice;
use Illuminate\Support\Str;

/*
|--------------------------------------------------------------------------
| The day panel's plan meals: orders not made yet, by subscriber and dish
|--------------------------------------------------------------------------
|
| The calendar can only count a plan day; this lists it. Three properties carry
| the feature. A claimed day and a projected day are both listed, each saying
| which it is. A day the generator has already turned into an order is not —
| its order is on the book, and listing it again would cook it twice. And the
| customer's name rides only with the contact permission, as on the order book.
|
*/

beforeEach(function (): void {
    $this->seed([ReferenceDataSeeder::class, OrganisationTypeSeeder::class, AccessControlSeeder::class]);

    $this->tenant = PricingWorld::kitchen('plan-meals@kitchen.test', [
        'order.view_organisation',
        'subscription.view_organisation',
    ]);
    $this->organisation = $this->tenant->organisation;
    $this->orgId = (string) $this->organisation->getKey();
    $this->channelId = (string) PricingWorld::channel($this->organisation, 'web-shop')->getKey();

    $this->headers = firstPartyHeaders() + ['X-Organisation-Id' => $this->orgId];

    $this->actingAs($this->tenant->user);
    $this->travelTo(CarbonImmutable::parse('2026-05-11 08:00:00', 'UTC'));
});

/**
 * A Monday subscription to a real plan of one meal a day, for a named customer.
 *
 * @param  array<string, mixed>  $attributes
 */
function planMealsSubscription(object $test, string $customerName, array $attributes = []): Subscription
{
    $plan = CatalogueItem::factory()->subscriptionPlan()->published()->create([
        'catalogue_id' => $test->tenant->catalogue->getKey(),
        'organisation_id' => $test->orgId,
        'name_en' => 'Lean week '.Str::random(4),
    ]);

    $configuration = CatalogueItemVariant::factory()->planConfiguration()->create([
        'catalogue_item_id' => $plan->getKey(),
        'organisation_id' => $test->orgId,
        'code' => 'cell-'.Str::lower(Str::random(6)),
    ]);

    PlanVariantProfile::factory()->create([
        'catalogue_item_variant_id' => $configuration->getKey(),
        'organisation_id' => $test->orgId,
        'catalogue_item_id' => $plan->getKey(),
        'meals_per_day' => 1,
        'includes_snacks' => false,
        'snacks_per_day' => 0,
    ]);

    $accountId = (string) CustomerAccountFactory::new()->create(['display_name' => $customerName])->getKey();

    $address = CustomerAddress::factory()->create(['customer_account_id' => $accountId]);

    $duration = PlanDuration::factory()->days(20)->create(['organisation_id' => $test->orgId]);

    return Subscription::factory()->create([
        'organisation_id' => $test->orgId,
        'customer_account_id' => $accountId,
        'sales_channel_id' => $test->channelId,
        'catalogue_item_id' => $plan->getKey(),
        'catalogue_item_variant_id' => $configuration->getKey(),
        'plan_duration_id' => $duration->getKey(),
        'customer_address_id' => $address->getKey(),
        'currency_code' => $test->organisation->default_currency_code,
        'weekdays' => [1],
        ...$attributes,
    ]);
}

/** @param  array<string, mixed>  $attributes */
function planMealsDelivery(Subscription $subscription, string $date, array $attributes = []): SubscriptionDelivery
{
    return SubscriptionDelivery::query()->create([
        'subscription_id' => $subscription->getKey(),
        'organisation_id' => $subscription->organisation_id,
        'branch_id' => $subscription->branch_id,
        'delivery_date' => $date,
        'delivery_window_code' => $subscription->delivery_window_code,
        'status' => SubscriptionDeliveryStatus::Scheduled,
        'consumed' => false,
        ...$attributes,
    ]);
}

function planMealsDish(object $test, string $name): CatalogueItem
{
    return PricingWorld::product($test->tenant, $name, 'dish-'.Str::lower(Str::random(6)))->item;
}

function planMealsChoice(Subscription $subscription, string $date, CatalogueItem $dish, string $slot = 'lunch'): void
{
    SubscriptionMealChoice::query()->create([
        'subscription_id' => $subscription->getKey(),
        'organisation_id' => $subscription->organisation_id,
        'delivery_date' => $date,
        'slot' => $slot,
        'sequence' => 1,
        'catalogue_item_id' => $dish->getKey(),
        'source' => MealChoiceSource::Customer,
    ]);
}

/** @param  list<string>  $permissions */
function planMealsAgent(string $organisationId, string $email, array $permissions): User
{
    $user = User::factory()->create(['email' => $email]);

    $membership = OrganisationMembership::factory()->create([
        'organisation_id' => $organisationId,
        'user_id' => $user->getKey(),
    ]);

    $role = Role::factory()->create(['organisation_id' => $organisationId]);

    foreach ($permissions as $code) {
        RolePermission::factory()->create([
            'organisation_id' => $organisationId,
            'role_id' => $role->getKey(),
            'permission_id' => Permission::query()->where('code', $code)->sole()->getKey(),
        ]);
    }

    MembershipRole::factory()->create([
        'organisation_id' => $organisationId,
        'membership_id' => $membership->getKey(),
        'role_id' => $role->getKey(),
    ]);

    return $user;
}

it('lists a claimed day with the dish its subscriber picked and a projected day with none yet', function (): void {
    $claimed = planMealsSubscription($this, 'Rania Haddad');
    planMealsDelivery($claimed, '2026-05-11');
    planMealsChoice($claimed, '2026-05-11', planMealsDish($this, 'Lentil Soup'));

    $projected = planMealsSubscription($this, 'Karim Saleh');

    $rows = collect($this->getJson('/api/v1/catalogue/order-desk/plan-meals?date=2026-05-11', $this->headers)
        ->assertOk()
        ->assertJsonPath('meta.date', '2026-05-11')
        ->assertJsonPath('meta.count', 2)
        ->json('data'))->keyBy('subscription_id');

    $claimedRow = $rows->get((string) $claimed->getKey());
    expect($claimedRow['basis'])->toBe('scheduled')
        ->and($claimedRow['plan']['name_en'])->toStartWith('Lean week')
        ->and($claimedRow['meals_per_day'])->toBe(1)
        ->and($claimedRow['meals'])->toHaveCount(1)
        ->and($claimedRow['meals'][0]['slot'])->toBe('lunch')
        ->and($claimedRow['meals'][0]['name_en'])->toBe('Lentil Soup');

    $projectedRow = $rows->get((string) $projected->getKey());
    expect($projectedRow['basis'])->toBe('projected')
        ->and($projectedRow['meals'])->toBe([]);
});

it('leaves out a day that is already an order, so it is never cooked twice', function (): void {
    $generated = planMealsSubscription($this, 'Maya Khoury');
    $order = Order::factory()->create([
        'organisation_id' => $this->orgId,
        'customer_account_id' => $generated->customer_account_id,
        'sales_channel_id' => $this->channelId,
        'requested_delivery_date' => '2026-05-11',
    ]);
    planMealsDelivery($generated, '2026-05-11', [
        'status' => SubscriptionDeliveryStatus::Generated,
        'order_id' => $order->getKey(),
    ]);

    $ids = collect($this->getJson('/api/v1/catalogue/order-desk/plan-meals?date=2026-05-11', $this->headers)
        ->assertOk()
        ->json('data'))->pluck('subscription_id')->all();

    expect($ids)->not->toContain((string) $generated->getKey());
});

it('names the customer only for somebody who may see their contact details', function (): void {
    $subscription = planMealsSubscription($this, 'Rania Haddad');
    planMealsDelivery($subscription, '2026-05-11');

    $this->getJson('/api/v1/catalogue/order-desk/plan-meals?date=2026-05-11', $this->headers)
        ->assertOk()
        ->assertJsonMissingPath('data.0.customer');

    $this->actingAs(planMealsAgent($this->orgId, 'contact@kitchen.test', [
        'order.view_organisation',
        'subscription.view_organisation',
        'order.view_customer_contact_organisation',
    ]));

    $this->getJson('/api/v1/catalogue/order-desk/plan-meals?date=2026-05-11', $this->headers)
        ->assertOk()
        ->assertJsonPath('data.0.customer.display_name', 'Rania Haddad');
});

it('refuses somebody who may read orders but not subscriptions, and a malformed day', function (): void {
    $this->actingAs(planMealsAgent($this->orgId, 'orders-only@kitchen.test', ['order.view_organisation']));

    $this->getJson('/api/v1/catalogue/order-desk/plan-meals?date=2026-05-11', $this->headers)
        ->assertForbidden();

    $this->actingAs($this->tenant->user);

    $this->getJson('/api/v1/catalogue/order-desk/plan-meals?date=11-05-2026', $this->headers)
        ->assertUnprocessable();
});
