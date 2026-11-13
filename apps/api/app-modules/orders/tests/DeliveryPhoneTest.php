<?php

declare(strict_types=1);

use App\Models\User;
use Carbon\CarbonImmutable;
use Healthy360\AccessControl\Database\Seeders\AccessControlSeeder;
use Healthy360\B2b\Models\CorporateProgramme;
use Healthy360\B2b\Models\Quotation;
use Healthy360\B2b\Models\QuotationLine;
use Healthy360\B2b\Services\QuotationOrderPlacer;
use Healthy360\B2b\Tests\Fixtures\B2bCheckoutWorld;
use Healthy360\Cart\Models\Cart;
use Healthy360\Cart\Services\CartService;
use Healthy360\Cart\Tests\Fixtures\CheckoutWorld;
use Healthy360\Customers\Enums\CustomerAddressType;
use Healthy360\Customers\Models\CustomerAccount;
use Healthy360\Customers\Models\CustomerAddress;
use Healthy360\Delivery\Models\DeliveryZone;
use Healthy360\Identity\Models\ContactPoint;
use Healthy360\Orders\Exceptions\PlacementRefused;
use Healthy360\Orders\Models\Order;
use Healthy360\Orders\Services\ComposedLine;
use Healthy360\Orders\Services\ComposedPlacement;
use Healthy360\Orders\Services\DeliveryPhone;
use Healthy360\Orders\Services\OrderPlacementService;
use Healthy360\Orders\Tests\Fixtures\DeskWorld;
use Healthy360\Organisations\Database\Seeders\OrganisationTypeSeeder;
use Healthy360\ReferenceData\Database\Seeders\ReferenceDataSeeder;
use Healthy360\Subscriptions\Services\GenerationService;
use Healthy360\Subscriptions\Services\SubscriptionService;
use Healthy360\Subscriptions\Tests\Fixtures\SubscriptionWorld;
use Illuminate\Database\Eloquent\Builder;

/*
|--------------------------------------------------------------------------
| A delivery the driver can ring
|--------------------------------------------------------------------------
|
| The driver run's rule, asked before the order exists: the address's contact,
| then the account's live phone on either ownership arm. A delivery placed by a
| person — online, guest or desk — with neither is refused `phone_required`.
| Pickup and counter never are, and a subscription day or an accepted quotation
| keeps placing without one, because both were agreed earlier.
|
*/

beforeEach(function (): void {
    $this->seed([ReferenceDataSeeder::class, OrganisationTypeSeeder::class, AccessControlSeeder::class]);

    $this->world = DeskWorld::build('delivery-phone@kitchen.test');
    $this->account = $this->world->customer->account;
});

/** Take every phone the world's customer has away: retired rows must not count. */
function phoneRuleSilence(CustomerAccount $account): void
{
    ContactPoint::query()
        ->where('channel', 'phone')
        ->where(fn (Builder $owner) => $owner->where('customer_account_id', $account->getKey())
            ->when($account->user_id !== null, fn (Builder $user) => $user->orWhere('user_id', $account->user_id)))
        ->update(['retired_at' => now()]);
}

function phoneRuleCart(object $world): Cart
{
    $carts = app(CartService::class);

    $cart = $carts->getOrCreate($world->customer->account, $world->channel);
    $carts->addItem($cart, (string) $world->meal->getKey(), quantity: 1);

    return $cart->refresh();
}

/**
 * @param  array<string, mixed>  $overrides
 */
function phoneRuleComposed(object $test, array $overrides = []): ComposedPlacement
{
    return new ComposedPlacement(...[
        'account' => $test->account,
        'address' => $test->world->customer->address,
        'organisationId' => (string) $test->world->organisation->getKey(),
        'salesChannelId' => (string) $test->world->channel->getKey(),
        'branchId' => (string) $test->world->branch->getKey(),
        'currencyCode' => $test->world->organisation->default_currency_code,
        'lines' => [new ComposedLine(catalogueItemId: (string) $test->world->meal->getKey())],
        ...$overrides,
    ]);
}

/**
 * @return list<string>
 */
function phoneRuleRefusals(Closure $place): array
{
    try {
        $place();
    } catch (PlacementRefused $refused) {
        return array_column($refused->details['reasons'] ?? [], 'reason');
    }

    return [];
}

describe('online', function (): void {
    beforeEach(function (): void {
        $this->actingAs(User::query()->whereKey($this->account->user_id)->sole());
    });

    it('warns at preview and refuses at placement when nobody can be rung', function (): void {
        phoneRuleSilence($this->account);
        $cart = phoneRuleCart($this->world);
        $body = [
            'cart_id' => (string) $cart->getKey(),
            'customer_address_id' => (string) $this->world->customer->address->getKey(),
        ];

        expect($this->postJson('/api/v1/checkouts/preview', $body, firstPartyHeaders())->assertOk()->json('data.preview.warnings'))
            ->toContain('phone_required');

        $response = $this->postJson('/api/v1/orders', $body, firstPartyHeaders())->assertStatus(409);

        expect(array_column($response->json('error.details.reasons'), 'reason'))->toContain('phone_required')
            ->and(Order::query()->count())->toBe(0);
    });

    it('does not count an email the address names as a phone', function (): void {
        phoneRuleSilence($this->account);
        $email = ContactPoint::query()->where('user_id', $this->account->user_id)->where('channel', 'email')->firstOrFail();
        $this->world->customer->address->forceFill(['contact_point_id' => $email->getKey()])->save();

        $refused = $this->postJson('/api/v1/orders', [
            'cart_id' => (string) phoneRuleCart($this->world)->getKey(),
            'customer_address_id' => (string) $this->world->customer->address->getKey(),
        ], firstPartyHeaders())->assertStatus(409);

        expect(array_column($refused->json('error.details.reasons'), 'reason'))->toContain('phone_required');
    });

    it('falls back to the account\'s own phone, on either ownership arm', function (): void {
        // The fixture's phone is account-owned and the address names none.
        $this->postJson('/api/v1/orders', [
            'cart_id' => (string) phoneRuleCart($this->world)->getKey(),
            'customer_address_id' => (string) $this->world->customer->address->getKey(),
        ], firstPartyHeaders())->assertCreated();

        phoneRuleSilence($this->account);
        ContactPoint::factory()->phone()->create(['user_id' => $this->account->user_id]);

        expect(app(DeliveryPhone::class)->resolves(null, (string) $this->account->getKey()))->toBeTrue()
            ->and(app(DeliveryPhone::class)->resolves(null, null))->toBeFalse();
    });
});

it('refuses a guest delivery with no phone, and places it once the guest gives one', function (): void {
    // `OtpService::exposesCodes()`'s testing-only affordance, as `GuestJourneyApiSmokeTest` turns it on.
    config()->set('verification.otp.expose_codes', true);

    $token = $this->postJson('/api/v1/guest/sessions', ['preferred_language_code' => 'en', 'country_code' => 'LB'])
        ->assertCreated()
        ->json('data.token');
    $headers = ['X-Guest-Token' => $token];

    $challenge = $this->postJson('/api/v1/guest/contacts', ['channel' => 'email', 'value' => 'phoneless-guest@example.test'], $headers)
        ->assertStatus(202);
    $this->postJson('/api/v1/guest/contacts/verify', [
        'challenge_id' => $challenge->json('data.challenge.challenge_id'),
        'code' => $challenge->json('data.challenge.debug_code'),
    ], $headers)->assertOk();

    $guest = CustomerAccount::query()->whereKey($this->getJson('/api/v1/guest/session', $headers)->json('data.customer_account.id'))->sole();

    $carts = app(CartService::class);
    $cart = $carts->getOrCreate($guest, $this->world->channel);
    $carts->addItem($cart, (string) $this->world->meal->getKey(), quantity: 1);

    $address = CustomerAddress::query()->create([
        'customer_account_id' => $guest->getKey(),
        'address_type' => CustomerAddressType::Delivery,
        'delivery_area_id' => $this->world->area->getKey(),
        'label' => 'Home',
        'line_one' => 'Rue Gouraud 12',
        'is_default' => true,
        'lock_version' => 0,
    ]);

    $body = ['cart_id' => (string) $cart->getKey(), 'customer_address_id' => (string) $address->getKey()];

    $refused = $this->postJson('/api/v1/guest/orders', $body, $headers + ['Idempotency-Key' => 'guest-no-phone'])->assertStatus(409);

    expect(array_column($refused->json('error.details.reasons'), 'reason'))->toContain('phone_required');

    ContactPoint::factory()->phone()->forCustomerAccount((string) $guest->getKey())->create();

    $this->postJson('/api/v1/guest/orders', $body, $headers + ['Idempotency-Key' => 'guest-with-phone'])->assertCreated();
});

describe('desk', function (): void {
    beforeEach(function (): void {
        $this->actingAs(DeskWorld::agent($this->world, 'phone-agent@desk.test'));
        $this->headers = DeskWorld::headers($this->world);
        $this->lines = [['catalogue_item_id' => (string) $this->world->meal->getKey(), 'quantity' => 1]];
    });

    it('refuses a delivery on the quote and at placement when nobody can be rung', function (): void {
        phoneRuleSilence($this->account);
        $body = [
            'fulfilment_type' => 'delivery',
            'customer_account_id' => (string) $this->account->getKey(),
            'customer_address_id' => (string) $this->world->customer->address->getKey(),
            'lines' => $this->lines,
        ];

        $quote = $this->postJson('/api/v1/catalogue/order-desk/quote', $body, $this->headers)->assertOk();

        expect(array_column($quote->json('data.quote.refusals'), 'reason'))->toContain('phone_required')
            ->and($quote->json('data.quote.quotable'))->toBeFalse();

        $placed = $this->postJson(
            '/api/v1/catalogue/order-desk/orders',
            $body + ['payment_method' => 'cash_on_delivery'],
            $this->headers + ['Idempotency-Key' => 'desk-no-phone'],
        )->assertStatus(409);

        expect(array_column($placed->json('error.details.reasons'), 'reason'))->toContain('phone_required')
            ->and(Order::query()->count())->toBe(0);
    });

    it('never refuses a pickup or a counter sale for want of a phone', function (): void {
        phoneRuleSilence($this->account);

        $this->postJson('/api/v1/catalogue/order-desk/orders', [
            'fulfilment_type' => 'pickup',
            'payment_method' => 'cash_at_counter',
            'customer_account_id' => (string) $this->account->getKey(),
            'lines' => $this->lines,
        ], $this->headers + ['Idempotency-Key' => 'pickup-no-phone'])->assertCreated();

        $this->postJson('/api/v1/catalogue/order-desk/orders', [
            'fulfilment_type' => 'counter',
            'payment_method' => 'cash_at_counter',
            'payment' => ['method' => 'cash_at_counter'],
            'customer_account_id' => (string) $this->account->getKey(),
            'lines' => $this->lines,
        ], $this->headers + ['Idempotency-Key' => 'counter-no-phone'])->assertCreated();

        expect(Order::query()->count())->toBe(2);
    });
});

it('leaves subscription generation and quotation placement placing without a phone', function (): void {
    phoneRuleSilence($this->account);
    $placement = app(OrderPlacementService::class);

    // The shapes `GenerationService` and `QuotationOrderPlacer` compose: neither
    // asks for the phone, and both were agreed before today.
    expect(phoneRuleRefusals(fn () => $placement->placeComposed(phoneRuleComposed($this, ['enforceWindowOffer' => false]), 'generation-no-phone')))
        ->not->toContain('phone_required')
        ->and(phoneRuleRefusals(fn () => $placement->placeComposed(phoneRuleComposed($this, ['agreedInWriting' => true]), 'quotation-no-phone')))
        ->not->toContain('phone_required')
        // The desk's own flag is what turns the rule on.
        ->and(phoneRuleRefusals(fn () => $placement->placeComposed(phoneRuleComposed($this, ['requireDeliveryPhone' => true]), 'desk-flag-no-phone')))
        ->toContain('phone_required');
});

it('places a subscription day through the real generation run without a phone', function (): void {
    $world = SubscriptionWorld::build('phone-generation@kitchen.test');

    app(SubscriptionService::class)->create(SubscriptionWorld::request($world));
    phoneRuleSilence($world->customer->account);

    CarbonImmutable::setTestNow(CarbonImmutable::now()->addDay());

    expect(app(GenerationService::class)->tick()['generated'])->toBe(1)
        ->and(Order::query()->where('customer_account_id', $world->customer->account->getKey())->count())->toBe(1);
});

it('places an accepted quotation through the real quotation placer without a phone', function (): void {
    $world = B2bCheckoutWorld::dualAgreement('phone-wholesale@kitchen.test');
    $buyer = $world['buyers']['acme'];
    $sellerId = (string) $world['seller']->organisation->getKey();

    CheckoutWorld::window(DeliveryZone::withoutTenancy()->where('organisation_id', $sellerId)->sole(), 'midday');

    $programme = CorporateProgramme::withoutTenancy()->create([
        'organisation_id' => $buyer['organisation']->getKey(),
        'code' => 'acme-phoneless',
        'kitchen_organisation_id' => $sellerId,
        'b2b_agreement_id' => $buyer['agreement']->getKey(),
        'name_en' => 'Staff meals',
        'name_ar' => 'وجبات الموظفين',
        'status' => 'active',
        'lock_version' => 0,
        'created_by' => $buyer['user']->getKey(),
    ]);

    $quotation = Quotation::factory()->accepted()->create([
        'corporate_programme_id' => $programme->getKey(),
        'currency_code' => $world['seller']->organisation->default_currency_code,
    ]);
    QuotationLine::factory()->priced(1500)->create([
        'quotation_id' => $quotation->getKey(),
        'catalogue_item_id' => $world['meal']->getKey(),
        'quantity' => '5.0000',
    ]);

    phoneRuleSilence($buyer['account']);

    $placed = app(QuotationOrderPlacer::class)->place(
        $quotation,
        $sellerId,
        $buyer['account'],
        $buyer['address'],
        CarbonImmutable::today()->addDays(3),
        'midday',
    );

    expect($placed)->toHaveCount(1)
        ->and(Order::query()->whereKey($placed[0]['order_id'])->exists())->toBeTrue();
});
