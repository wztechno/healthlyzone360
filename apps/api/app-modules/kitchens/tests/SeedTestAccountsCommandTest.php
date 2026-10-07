<?php

declare(strict_types=1);

use App\Models\User;
use Healthy360\AccessControl\Database\Seeders\AccessControlSeeder;
use Healthy360\Cart\Tests\Fixtures\CheckoutWorld;
use Healthy360\Catalogues\Enums\SalesChannelKind;
use Healthy360\Catalogues\Models\SalesChannel;
use Healthy360\Consent\Database\Seeders\ConsentDefinitionSeeder;
use Healthy360\Customers\Enums\CustomerAccountStatus;
use Healthy360\Customers\Enums\CustomerAccountType;
use Healthy360\Customers\Models\CustomerAccount;
use Healthy360\Delivery\Models\DeliveryWindow;
use Healthy360\Organisations\Database\Seeders\OrganisationTypeSeeder;
use Healthy360\Organisations\Models\Organisation;
use Healthy360\Pricing\Tests\Fixtures\PricingWorld;
use Healthy360\ReferenceData\Database\Seeders\ReferenceDataSeeder;
use Healthy360\Tenancy\Database\DatabaseTenantContext;
use Healthy360\Tenancy\TenantContext;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/*
|--------------------------------------------------------------------------
| kitchen:seed-test-accounts
|--------------------------------------------------------------------------
|
| Two logins that can actually order. What has to hold: a second run changes
| nothing, the junk window it was not asked about is left alone, the consumer
| checks out on the web shop, and the corporate buyer checks out on the
| wholesale channel under its agreement — both through the HTTP API, the way a
| tester would.
|
| The kitchen starts with no delivery zone, the shape a v6 import leaves, so
| the zone the command creates is the one both orders are delivered through.
|
*/

beforeEach(function (): void {
    $this->seed([ReferenceDataSeeder::class, OrganisationTypeSeeder::class, AccessControlSeeder::class, ConsentDefinitionSeeder::class]);

    config()->set('kitchens.import.environments', ['local', 'testing']);

    $this->kitchen = PricingWorld::kitchen('seed-accounts@kitchen.test');
    $organisation = $this->kitchen->organisation;
    CheckoutWorld::branch($organisation);

    $this->meal = CheckoutWorld::publishedMeal($this->kitchen);

    $web = PricingWorld::channel($organisation, 'web-shop');
    $webList = PricingWorld::priceList($organisation, 'web-usd', active: true);
    PricingWorld::assign($web, $webList);
    CheckoutWorld::offer($web, $this->meal);
    PricingWorld::price($webList, $this->meal, null, 2500);

    $wholesale = SalesChannel::factory()->wholesale()->create([
        'organisation_id' => $organisation->getKey(),
        'code' => 'wholesale',
        'channel_kind' => SalesChannelKind::B2b,
    ]);
    $tradeList = PricingWorld::priceList($organisation, 'trade-usd', active: true);
    PricingWorld::assign($wholesale, $tradeList, priority: 1);
    CheckoutWorld::offer($wholesale, $this->meal);
    PricingWorld::price($tradeList, $this->meal, null, 1500);

    // A window somebody made by mistake. The command is not asked to judge it.
    DeliveryWindow::withoutTenancy()->create([
        'organisation_id' => $organisation->getKey(),
        'code' => 'dana-wagner',
        'name_en' => 'Dana wagner',
        'name_ar' => 'Dana wagner',
        'weekdays' => [],
        'display_order' => 9,
        'is_active' => true,
    ]);
});

afterEach(function (): void {
    app(TenantContext::class)->clear();
    app(DatabaseTenantContext::class)->reset();
});

/**
 * Row counts and the latest write time of every table the command touches. Equal before and after
 * a second run means the second run wrote nothing.
 *
 * @return array<string, array{0: int, 1: mixed}>
 */
function seededFingerprint(): array
{
    $tables = [
        'users', 'user_profiles', 'contact_points', 'consent_grants', 'customer_accounts', 'customer_addresses',
        'customer_dietary_profiles', 'organisations', 'organisation_memberships', 'membership_roles',
        'b2b_applications', 'b2b_agreements', 'otp_challenges', 'price_lists', 'channel_price_lists',
        'corporate_programmes', 'delivery_areas', 'delivery_zones', 'delivery_zone_areas', 'delivery_windows',
    ];

    $fingerprint = [];

    foreach ($tables as $table) {
        $fingerprint[$table] = [
            DB::table($table)->count(),
            Schema::hasColumn($table, 'updated_at') ? DB::table($table)->max('updated_at') : null,
        ];
    }

    return $fingerprint;
}

function runSeedTestAccounts(object $test, string $slug): void
{
    expect($test->artisan('kitchen:seed-test-accounts', ['--org' => $slug])->run())->toBe(0);

    app(TenantContext::class)->clear();
    app(DatabaseTenantContext::class)->reset();
}

it('changes nothing on a second run and leaves windows it was not asked about alone', function (): void {
    $slug = (string) $this->kitchen->organisation->slug;

    runSeedTestAccounts($this, $slug);
    $first = seededFingerprint();

    $this->travel(1)->hours();
    runSeedTestAccounts($this, $slug);

    expect(seededFingerprint())->toBe($first);

    $windows = DeliveryWindow::withoutTenancy()
        ->where('organisation_id', $this->kitchen->organisation->getKey())
        ->orderBy('display_order')
        ->get();

    expect($windows->where('is_active', true)->pluck('name_en', 'code')->all())->toBe([
        'morning' => 'Breakfast',
        'midday' => 'Lunch',
        'afternoon' => 'Snack',
        'evening' => 'Dinner',
        'dana-wagner' => 'Dana wagner',
    ]);
});

it('prints both logins', function (): void {
    $this->artisan('kitchen:seed-test-accounts', ['--org' => (string) $this->kitchen->organisation->slug])
        ->expectsOutputToContain('customer@healthzone360.test')
        ->expectsOutputToContain('buyer@corp.healthzone360.test')
        ->assertSuccessful();
});

it('refuses outside the allowlisted environments', function (): void {
    config()->set('kitchens.import.environments', ['local']);

    $this->artisan('kitchen:seed-test-accounts', ['--org' => (string) $this->kitchen->organisation->slug])
        ->assertFailed();

    expect(User::query()->where('email', 'customer@healthzone360.test')->exists())->toBeFalse();
});

it('gives the consumer an active account that checks out on the web shop', function (): void {
    runSeedTestAccounts($this, (string) $this->kitchen->organisation->slug);

    $customer = User::query()->where('email', 'customer@healthzone360.test')->sole();
    $account = CustomerAccount::query()->where('user_id', $customer->getKey())->where('account_type', CustomerAccountType::B2c)->sole();
    expect($account->status)->toBe(CustomerAccountStatus::Active);

    $headers = firstPartyHeaders();
    $this->actingAs($customer);

    $cartId = $this->postJson('/api/v1/carts', ['channel_code' => 'web-shop'], $headers)->assertOk()->json('data.cart.id');
    $this->postJson("/api/v1/carts/{$cartId}/items", ['catalogue_item_id' => (string) $this->meal->getKey(), 'quantity' => 1], $headers)->assertCreated();
    $addressId = $this->getJson('/api/v1/me/addresses', $headers)->assertOk()->json('data.0.id');

    $this->postJson('/api/v1/orders', [
        'cart_id' => $cartId,
        'customer_address_id' => $addressId,
        'delivery_window_code' => 'midday',
    ], $headers)
        ->assertCreated()
        ->assertJsonPath('data.order.subtotal_minor', 2500);
});

it('gives the corporate buyer a wholesale checkout under its agreement', function (): void {
    runSeedTestAccounts($this, (string) $this->kitchen->organisation->slug);

    $buyer = User::query()->where('email', 'buyer@corp.healthzone360.test')->sole();
    $company = Organisation::query()->where('slug', 'healthzone360-test-corporate')->sole();
    $headers = firstPartyHeaders() + ['X-Organisation-Id' => (string) $company->getKey()];
    $this->actingAs($buyer);

    $cartId = $this->postJson('/api/v1/carts', ['channel_code' => 'wholesale'], $headers)->assertOk()->json('data.cart.id');
    $this->postJson("/api/v1/carts/{$cartId}/items", ['catalogue_item_id' => (string) $this->meal->getKey(), 'quantity' => 2], $headers)->assertCreated();

    // The address lives on the corporate account; §3a is what lets the buyer see it.
    $addressId = $this->getJson('/api/v1/me/addresses', $headers)->assertOk()->assertJsonPath('meta.count', 1)->json('data.0.id');

    $orderId = $this->postJson('/api/v1/orders', [
        'cart_id' => $cartId,
        'customer_address_id' => $addressId,
        'delivery_window_code' => 'midday',
    ], $headers)
        ->assertCreated()
        // No negotiated price yet, so the wholesale tariff applies.
        ->assertJsonPath('data.order.subtotal_minor', 3000)
        ->json('data.order.id');

    expect(DB::table('orders')->where('id', $orderId)->value('b2b_agreement_id'))->not->toBeNull();
});
