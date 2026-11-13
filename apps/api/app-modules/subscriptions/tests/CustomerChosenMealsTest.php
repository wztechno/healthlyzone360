<?php

declare(strict_types=1);

use Carbon\CarbonImmutable;
use Healthy360\AccessControl\Database\Seeders\AccessControlSeeder;
use Healthy360\AccessControl\Models\Permission;
use Healthy360\AccessControl\Models\RolePermission;
use Healthy360\Catalogues\Models\SubscriptionPlanProfile;
use Healthy360\Orders\Models\Order;
use Healthy360\Orders\Tests\Fixtures\OrderWorld;
use Healthy360\Organisations\Database\Seeders\OrganisationTypeSeeder;
use Healthy360\ReferenceData\Database\Seeders\ReferenceDataSeeder;
use Healthy360\Subscriptions\Exceptions\SubscriptionRefused;
use Healthy360\Subscriptions\Models\SubscriptionMealChoice;
use Healthy360\Subscriptions\Services\GenerationService;
use Healthy360\Subscriptions\Services\SubscriptionService;
use Healthy360\Subscriptions\Tests\Fixtures\SubscriptionWorld;
use Healthy360\Tenancy\TenantContext;

/*
|--------------------------------------------------------------------------
| The customer chooses every meal
|--------------------------------------------------------------------------
|
| A plan sells a number of meals a day; the customer picks the dish for every
| sitting of every delivery day before paying, and may change any day until its
| cut-off. The kitchen's order view then says which dish is for which sitting.
|
|  1. **Purchase** refuses a run with a day or a sitting missing, and writes
|     every chosen day when it is whole.
|  2. **Changing a day** needs the whole day, on any plan.
|  3. **The days read** lists the run with each day's meals and whether it
|     may still be changed.
|  4. **The kitchen's order** carries `plan_day`: each sitting pointing at the
|     order's own line for its dish.
|
*/

beforeEach(function (): void {
    $this->seed([ReferenceDataSeeder::class, OrganisationTypeSeeder::class, AccessControlSeeder::class]);

    // Five days of lunch and dinner.
    $this->world = SubscriptionWorld::build('chooser@kitchen.test', perDayMinor: 2000, days: 5);
    $this->subscriptions = app(SubscriptionService::class);

    $this->chicken = SubscriptionWorld::dish($this->world, 'Grilled chicken');
    $this->soup = SubscriptionWorld::dish($this->world, 'Red lentil soup');
    $this->first = SubscriptionWorld::firstDay($this->world);
});

afterEach(function (): void {
    CarbonImmutable::setTestNow();
    app(TenantContext::class)->clear();
});

/*
| 1. Purchase
*/

it('refuses a purchase that leaves a delivery day without meals', function (): void {
    $days = SubscriptionWorld::everyDay($this->first, 4, (string) $this->chicken->getKey(), (string) $this->soup->getKey());

    try {
        $this->subscriptions->create(SubscriptionWorld::request($this->world, days: $days));
        $this->fail('A run with a day missing was accepted.');
    } catch (SubscriptionRefused $refused) {
        expect(collect($refused->details['reasons'])->firstWhere('reason', 'meals_missing')['delivery_dates'])
            ->toBe([$this->first->addDays(4)->toDateString()]);
    }

    expect(SubscriptionMealChoice::query()->count())->toBe(0);
});

it('refuses a purchase whose day does not fill every sitting', function (): void {
    $days = SubscriptionWorld::everyDay($this->first, 5, (string) $this->chicken->getKey(), (string) $this->soup->getKey());
    // The second day sends lunch only.
    $days[1]['meals'] = [$days[1]['meals'][0]];

    try {
        $this->subscriptions->create(SubscriptionWorld::request($this->world, days: $days));
        $this->fail('A day with a sitting missing was accepted.');
    } catch (SubscriptionRefused $refused) {
        $reason = collect($refused->details['reasons'])->firstWhere('reason', 'meals_incomplete');

        expect($reason['delivery_date'])->toBe($this->first->addDay()->toDateString())
            ->and($reason['missing'])->toBe(['dinner:1']);
    }
});

it('writes every chosen day when the run is whole', function (): void {
    $subscription = $this->subscriptions->create(SubscriptionWorld::request(
        $this->world,
        days: SubscriptionWorld::everyDay($this->first, 5, (string) $this->chicken->getKey(), (string) $this->soup->getKey()),
    ));

    $choices = SubscriptionMealChoice::query()->where('subscription_id', $subscription->getKey())->get();

    expect($choices)->toHaveCount(10)
        ->and($choices->pluck('source')->map->value->unique()->all())->toBe(['customer'])
        ->and($choices->map(fn ($choice): string => $choice->delivery_date->toDateString())->unique()->count())->toBe(5);
});

/*
| 2. Changing a day
*/

it('changes a day on a plan the kitchen never marked as free selection, and only as a whole day', function (): void {
    SubscriptionPlanProfile::withoutTenancy()
        ->whereKey($this->world->plan->getKey())
        ->update(['allows_free_selection' => false]);

    $subscription = $this->subscriptions->create(SubscriptionWorld::request(
        $this->world,
        days: SubscriptionWorld::everyDay($this->first, 5, (string) $this->chicken->getKey(), (string) $this->soup->getKey()),
    ));

    $this->actingAs($this->world->customer->account->user);

    $date = $this->first->addDays(3)->toDateString();
    $url = '/api/v1/me/subscriptions/'.$subscription->getKey().'/choices';

    $this->putJson($url, [
        'date' => $date,
        'meals' => [['slot' => 'lunch', 'catalogue_item_id' => (string) $this->soup->getKey()]],
    ], firstPartyHeaders())
        ->assertStatus(409)
        ->assertJsonPath('error.details.reasons.0.reason', 'meals_incomplete')
        ->assertJsonPath('error.details.reasons.0.missing', ['dinner:1']);

    $this->putJson($url, [
        'date' => $date,
        'meals' => [
            ['slot' => 'lunch', 'catalogue_item_id' => (string) $this->soup->getKey()],
            ['slot' => 'dinner', 'catalogue_item_id' => (string) $this->soup->getKey()],
        ],
    ], firstPartyHeaders())
        ->assertOk()
        ->assertJsonPath('data.meals.0.name', 'Red lentil soup');

    expect(SubscriptionMealChoice::query()
        ->where('subscription_id', $subscription->getKey())
        ->whereDate('delivery_date', $date)
        ->pluck('catalogue_item_id')
        ->unique()
        ->all())->toBe([(string) $this->soup->getKey()]);
});

/*
| 3. The days read
*/

it('lists the run day by day with its meals, sittings and whether each may change', function (): void {
    $subscription = $this->subscriptions->create(SubscriptionWorld::request(
        $this->world,
        days: SubscriptionWorld::everyDay($this->first, 5, (string) $this->chicken->getKey(), (string) $this->soup->getKey()),
    ));

    $this->actingAs($this->world->customer->account->user);

    $response = $this->getJson('/api/v1/me/subscriptions/'.$subscription->getKey().'/days', firstPartyHeaders())
        ->assertOk()
        ->assertJsonPath('data.sittings', [
            ['slot' => 'lunch', 'sequence' => 1],
            ['slot' => 'dinner', 'sequence' => 1],
        ]);

    $days = $response->json('data.days');

    expect($days)->toHaveCount(5)
        ->and($days[0]['delivery_date'])->toBe($this->first->toDateString())
        ->and($days[0]['basis'])->toBe('projected')
        ->and($days[4]['editable'])->toBeTrue()
        ->and(array_column($days[0]['meals'], 'name'))->toContain('Grilled chicken', 'Red lentil soup');
});

/*
| 4. The kitchen's order
*/

it('tells the kitchen which meal is for which sitting of a plan day', function (): void {
    $subscription = $this->subscriptions->create(SubscriptionWorld::request(
        $this->world,
        days: SubscriptionWorld::everyDay($this->first, 5, (string) $this->chicken->getKey(), (string) $this->chicken->getKey()),
    ));

    CarbonImmutable::setTestNow(CarbonImmutable::now()->addDay());
    expect(app(GenerationService::class)->tick()['generated'])->toBe(1);
    CarbonImmutable::setTestNow();

    $order = Order::query()->sole();

    foreach (['order.view_organisation', 'order.manage_organisation'] as $code) {
        RolePermission::factory()->create([
            'organisation_id' => $this->world->organisation->getKey(),
            'role_id' => $this->world->tenant->role->getKey(),
            'permission_id' => Permission::query()->where('code', $code)->sole()->getKey(),
        ]);
    }

    $this->actingAs($this->world->tenant->user);

    $headers = firstPartyHeaders() + ['X-Organisation-Id' => (string) $this->world->organisation->getKey()];

    $shown = $this->getJson('/api/v1/catalogue/orders/'.$order->getKey(), $headers)->assertOk()->json('data.order');

    $planLine = collect($shown['lines'])->firstWhere('catalogue_item_id', (string) $this->world->plan->getKey());
    $mealLine = collect($shown['lines'])->firstWhere('catalogue_item_id', (string) $this->chicken->getKey());

    // One dish for both sittings: one line of two, and both sittings point at it.
    expect($shown['plan_day']['plan_line_id'])->toBe($planLine['id'])
        ->and(array_column($shown['plan_day']['meals'], 'slot'))->toBe(['lunch', 'dinner'])
        ->and(array_unique(array_column($shown['plan_day']['meals'], 'line_id')))->toBe([$mealLine['id']])
        ->and(array_unique(array_column($shown['plan_day']['meals'], 'source')))->toBe(['customer']);

    // The list carries it too, read for the page at once.
    $listed = collect($this->getJson('/api/v1/catalogue/orders', $headers)->assertOk()->json('data'))
        ->firstWhere('id', (string) $order->getKey());

    expect($listed['plan_day']['meals'])->toHaveCount(2);

    expect($subscription->refresh()->balance_days_consumed)->toBe(1);
});

it('leaves plan_day null on an order that is not a plan day', function (): void {
    foreach (['order.view_organisation', 'order.manage_organisation'] as $code) {
        RolePermission::factory()->create([
            'organisation_id' => $this->world->organisation->getKey(),
            'role_id' => $this->world->tenant->role->getKey(),
            'permission_id' => Permission::query()->where('code', $code)->sole()->getKey(),
        ]);
    }

    $order = OrderWorld::place($this->world);

    $this->actingAs($this->world->tenant->user);

    $this->getJson('/api/v1/catalogue/orders/'.$order->getKey(), firstPartyHeaders() + ['X-Organisation-Id' => (string) $this->world->organisation->getKey()])
        ->assertOk()
        ->assertJsonPath('data.order.plan_day', null);
});
