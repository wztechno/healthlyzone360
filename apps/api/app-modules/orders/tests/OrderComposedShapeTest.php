<?php

declare(strict_types=1);

use App\Models\User;
use Carbon\CarbonImmutable;
use Healthy360\AccessControl\Database\Seeders\AccessControlSeeder;
use Healthy360\Cart\Services\CartService;
use Healthy360\Cart\Tests\Fixtures\CheckoutWorld;
use Healthy360\Catalogues\Enums\SalesChannelKind;
use Healthy360\Catalogues\Models\SalesChannel;
use Healthy360\Customers\Database\Factories\CustomerAccountFactory;
use Healthy360\Customers\Enums\CustomerAddressType;
use Healthy360\Customers\Models\CustomerAddress;
use Healthy360\Orders\Enums\FulfilmentType;
use Healthy360\Orders\Enums\PaymentMethod;
use Healthy360\Orders\Exceptions\PlacementRefused;
use Healthy360\Orders\Models\Order;
use Healthy360\Orders\Services\ComposedLine;
use Healthy360\Orders\Services\ComposedPlacement;
use Healthy360\Orders\Services\OrderPlacementService;
use Healthy360\Organisations\Database\Seeders\OrganisationTypeSeeder;
use Healthy360\Organisations\Models\Organisation;
use Healthy360\Pricing\Tests\Fixtures\PricingWorld;
use Healthy360\ReferenceData\Database\Seeders\ReferenceDataSeeder;
use Healthy360\Support\Api\Exceptions\ApiException;
use Healthy360\Support\Models\IdempotencyKey;

/*
|--------------------------------------------------------------------------
| Three ways to compose an order, and the gates each one has to pass
|--------------------------------------------------------------------------
|
| `OrderFulfilmentShapeTest` pins what the *database* will take. This pins what
| the *placement service* will take, which is a different and larger question:
| the shape CHECK refuses a pickup with an address after the order has been
| priced, the lines have been snapshotted and a transaction is open, and it
| refuses it as SQLSTATE 23514. `composeNow()` refuses it as a sentence, before
| any of that, beside every other thing wrong with the placement.
|
| The matrix under test — spelled out in `OrderPlacementService`'s docblock:
|
|   * `shapeReasons()` on all three, as reasons rather than throws;
|   * eligibility on all three, and skipped only when a member of staff is named;
|   * address ownership, zone and fee currency on **delivery alone**;
|   * the branch cut-off on delivery **and pickup**, because a collection is
|     still cooked to a slot;
|   * repricing and the agreement gate on all three.
|
| Two of these assertions are about things that must NOT have changed. The
| subscription suite is the load-bearing one and lives in its own module; the
| cart-path test at the bottom is here because `place()` and `composeNow()` share
| `persist()`, and this commit changed what `persist()` writes.
|
*/

beforeEach(function (): void {
    $this->seed([ReferenceDataSeeder::class, OrganisationTypeSeeder::class, AccessControlSeeder::class]);

    $this->world = CheckoutWorld::build('composed-shape@kitchen.test');
    $this->placement = app(OrderPlacementService::class);
    $this->agent = User::factory()->create(['email' => 'desk-agent@composed.test']);
});

/**
 * A composed placement in the beforeEach world, with only the fields under test
 * stated.
 *
 * A distinctively named function rather than a shared one, for the reason every
 * fixture in this codebase is a class: Pest loads the whole suite into one
 * process, and a second file declaring `compose()` would be a fatal
 * redeclaration rather than a test failure.
 *
 * @param  list<ComposedLine>|null  $lines
 */
function composedFor(object $test, array $overrides = [], ?array $lines = null): ComposedPlacement
{
    $defaults = [
        'account' => $test->world->customer->account,
        'address' => $test->world->customer->address,
        'organisationId' => (string) $test->world->organisation->getKey(),
        'salesChannelId' => (string) $test->world->channel->getKey(),
        'branchId' => (string) $test->world->branch->getKey(),
        'currencyCode' => $test->world->organisation->default_currency_code,
        'lines' => $lines ?? [new ComposedLine(catalogueItemId: (string) $test->world->meal->getKey())],
    ];

    return new ComposedPlacement(...[...$defaults, ...$overrides]);
}

/**
 * The reason codes a placement was refused for, in the order they were
 * collected. Codes rather than whole reasons, because what is being asserted is
 * *which gates ran*, and a context key changing is not that.
 *
 * @return list<string>
 */
function composedRefusalCodes(Closure $place): array
{
    try {
        $place();
    } catch (PlacementRefused $refused) {
        /** @var list<array<string, mixed>> $reasons */
        $reasons = $refused->details['reasons'] ?? [];

        return array_map(static fn (array $reason): string => (string) $reason['reason'], $reasons);
    }

    throw new RuntimeException('The placement service accepted an order it was supposed to refuse.');
}

describe('the shape gate', function (): void {
    it('refuses a counter sale that carries an address', function (): void {
        // The refusal the desk will meet most often, and the one that would
        // otherwise be silent: an agent starts a delivery for a known customer,
        // switches the type to counter because the customer decided to wait for
        // it, and the address is still on the placement. Dropping it quietly
        // would mean the caller believed something about this order that is not
        // true of it — and the database would refuse the row anyway, three
        // layers down and as a 500.
        $codes = composedRefusalCodes(fn () => $this->placement->placeComposed(composedFor($this, [
            'fulfilmentType' => FulfilmentType::Counter,
        ])));

        expect($codes)->toContain('address_not_applicable')
            ->and($codes)->not->toContain('customer_required')
            // Naming the customer on a counter sale is legal and stays legal:
            // a regular is worth naming.
            ->and(Order::query()->count())->toBe(0);
    });

    it('refuses a pickup with nobody to hand the bag to', function (): void {
        $codes = composedRefusalCodes(fn () => $this->placement->placeComposed(composedFor($this, [
            'fulfilmentType' => FulfilmentType::Pickup,
            'account' => null,
            'address' => null,
        ])));

        expect($codes)->toBe(['customer_required']);
    });

    it('refuses a delivery with nowhere to take it', function (): void {
        $codes = composedRefusalCodes(fn () => $this->placement->placeComposed(composedFor($this, [
            'address' => null,
        ])));

        expect($codes)->toBe(['address_required']);
    });

    it('refuses a pickup carrying an address, which is the arm the database also refuses', function (): void {
        $codes = composedRefusalCodes(fn () => $this->placement->placeComposed(composedFor($this, [
            'fulfilmentType' => FulfilmentType::Pickup,
        ])));

        expect($codes)->toBe(['address_not_applicable']);
    });

    it('says both things when a placement is wrong in two ways at once', function (): void {
        // The whole reason these are reasons and not exceptions. A delivery with
        // neither a customer nor an address is two problems, and telling the
        // desk about one of them per attempt is two round trips.
        $codes = composedRefusalCodes(fn () => $this->placement->placeComposed(composedFor($this, [
            'account' => null,
            'address' => null,
        ])));

        expect($codes)->toBe(['customer_required', 'address_required']);
    });
});

describe('what each type actually persists', function (): void {
    it('places a counter sale with no customer, no address and the payment method it was sold under', function (): void {
        $result = $this->placement->placeComposed(composedFor($this, [
            'account' => null,
            'address' => null,
            'fulfilmentType' => FulfilmentType::Counter,
            'placedOnBehalfBy' => (string) $this->agent->getKey(),
            'paymentMethod' => PaymentMethod::CashAtCounter,
        ]));

        $order = $result->order->refresh();

        expect($order->fulfilment_type)->toBe(FulfilmentType::Counter)
            ->and($order->customer_account_id)->toBeNull()
            ->and($order->placed_on_behalf_by)->toBe((string) $this->agent->getKey())
            // The method is the caller's now. It was hardcoded to cash on
            // delivery inside `persist()` for the whole of C1, and a walk-in
            // paying at the counter is exactly the order that made that wrong.
            ->and($order->payment_method)->toBe(PaymentMethod::CashAtCounter)
            ->and($order->subtotal_minor)->toBe(2500)
            // No zone was resolved, so no fee was charged, and the total check
            // (`total = subtotal + COALESCE(fee, 0)`) holds without a special
            // case for the no-address branch.
            ->and($order->delivery_fee_minor)->toBeNull()
            ->and($order->total_minor)->toBe(2500)
            ->and($order->lines()->count())->toBe(1);

        // Every delivery column, including the five the fulfilment migration
        // added. A single one of them written on a counter sale is the desk
        // claiming to know where somebody lives because they bought a sandwich.
        foreach ([
            'delivery_label', 'delivery_line_one', 'delivery_line_two', 'delivery_city',
            'delivery_area_name_en', 'delivery_area_name_ar', 'delivery_area_id', 'delivery_zone_id',
            'delivery_building', 'delivery_floor', 'delivery_apartment', 'delivery_directions',
            'delivery_contact_point_id',
        ] as $column) {
            expect($order->getAttribute($column))->toBeNull("orders.{$column} was written on a counter sale.");
        }
    });

    it('keeps a pickup promise while writing no destination at all', function (): void {
        $requested = CarbonImmutable::now()->addDays(3)->startOfDay();

        $result = $this->placement->placeComposed(composedFor($this, [
            'address' => null,
            'fulfilmentType' => FulfilmentType::Pickup,
            'deliveryWindowCode' => 'evening',
            'requestedDate' => $requested,
            'placedOnBehalfBy' => (string) $this->agent->getKey(),
            'paymentMethod' => PaymentMethod::CashAtCounter,
        ]));

        $order = $result->order->refresh();

        // "Be here at six" is a promise whether or not the food travels, which
        // is why the window and the day are written outside the address branch.
        expect($order->fulfilment_type)->toBe(FulfilmentType::Pickup)
            ->and($order->delivery_window_code)->toBe('evening')
            ->and($order->requested_delivery_date?->toDateString())->toBe($requested->toDateString())
            ->and($order->customer_account_id)->toBe((string) $this->world->customer->account->getKey())
            ->and($order->delivery_line_one)->toBeNull()
            ->and($order->delivery_area_id)->toBeNull()
            ->and($order->delivery_zone_id)->toBeNull()
            ->and($order->delivery_fee_minor)->toBeNull()
            ->and($order->total_minor)->toBe(2500);
    });

    it('writes the whole address, not the half of it that used to travel', function (): void {
        // A composed delivery is still a delivery: the zone is resolved, the fee
        // is charged, and the snapshot now carries the building, the floor, the
        // apartment, the directions and the contact point the courier was given.
        $address = $this->world->customer->address;
        $address->building = 'Sursock';
        $address->floor = '4';
        $address->apartment = '4B';
        $address->directions = 'Green door past the pharmacy, ring twice';
        $address->save();

        $order = $this->placement->placeComposed(composedFor($this))->order->refresh();

        expect($order->fulfilment_type)->toBe(FulfilmentType::Delivery)
            ->and($order->delivery_line_one)->toBe('Rue Gouraud 12')
            ->and($order->delivery_building)->toBe('Sursock')
            ->and($order->delivery_floor)->toBe('4')
            ->and($order->delivery_apartment)->toBe('4B')
            ->and($order->delivery_directions)->toBe('Green door past the pharmacy, ring twice')
            ->and($order->delivery_zone_id)->toBe((string) $this->world->zone->getKey())
            ->and($order->delivery_fee_minor)->toBe(500)
            ->and($order->total_minor)->toBe(3000)
            // Untouched by this commit and asserted so it stays that way: a
            // composed delivery is the subscription shape, and the default
            // payment method is what it has always been.
            ->and($order->payment_method)->toBe(PaymentMethod::CashOnDelivery)
            ->and($order->placed_on_behalf_by)->toBeNull();
    });
});

describe('the eligibility bypass', function (): void {
    it('refuses a provisional customer when nobody at the desk is named', function (): void {
        // The account a cold caller gets: no verified email, no dietary
        // declaration, `provisional` status. Every one of those is a real
        // requirement for self-service, and this is what self-service looks
        // like — no member of staff on the placement.
        $caller = CustomerAccountFactory::new()->create();

        $codes = composedRefusalCodes(fn () => $this->placement->placeComposed(composedFor($this, [
            'account' => $caller,
            'address' => null,
            'fulfilmentType' => FulfilmentType::Counter,
        ])));

        expect($codes)->not->toBeEmpty()
            ->and($codes)->toContain('account_not_ready');
    });

    it('places for the same customer when a member of staff is named', function (): void {
        // The member of staff standing in front of the customer is the
        // verification the checklist was asking for. Nothing about the account
        // changed between this test and the one above — only whether the
        // placement names who took it.
        $caller = CustomerAccountFactory::new()->create();

        $order = $this->placement->placeComposed(composedFor($this, [
            'account' => $caller,
            'address' => null,
            'fulfilmentType' => FulfilmentType::Counter,
            'placedOnBehalfBy' => (string) $this->agent->getKey(),
            'paymentMethod' => PaymentMethod::CashAtCounter,
        ]))->order->refresh();

        expect($order->customer_account_id)->toBe((string) $caller->getKey())
            ->and($order->placed_on_behalf_by)->toBe((string) $this->agent->getKey());
    });

    it('leaves every other gate standing on a staff placement', function (): void {
        // The bypass is the eligibility call and nothing else. A desk agent
        // cannot place a delivery to an address that is not the customer's
        // merely by being staff.
        $stranger = CheckoutWorld::readyCustomer($this->world->area, 'Someone else');

        $codes = composedRefusalCodes(fn () => $this->placement->placeComposed(composedFor($this, [
            'address' => $stranger->address,
            'placedOnBehalfBy' => (string) $this->agent->getKey(),
        ])));

        expect($codes)->toBe(['address_not_owned']);
    });
});

describe('the cut-off', function (): void {
    it('refuses a pickup asked for after the branch closed its book for the day', function (): void {
        // The row of the matrix worth arguing about. A pickup skips every
        // address gate, and it would have been easy to skip this one with them
        // — but the cut-off is about when the food can be *made*, not about
        // when it can be carried. The clock is frozen rather than sampled: a
        // cut-off test that depends on the hour the suite happens to run is a
        // test that fails twice a day.
        $branchNow = CarbonImmutable::now()->setTimezone('Asia/Beirut');
        $today = $branchNow->toDateString();

        CheckoutWorld::cutOff($this->world->branch, '15:00:00');
        $this->travelTo(CarbonImmutable::parse($today.' 18:00:00', 'Asia/Beirut'));

        $codes = composedRefusalCodes(fn () => $this->placement->placeComposed(composedFor($this, [
            'address' => null,
            'fulfilmentType' => FulfilmentType::Pickup,
            'requestedDate' => CarbonImmutable::parse($today),
            'placedOnBehalfBy' => (string) $this->agent->getKey(),
        ])));

        expect($codes)->toBe(['cut_off_passed']);
    });

    it('never asks a counter sale about a cut-off it has no day to be late for', function (): void {
        $branchNow = CarbonImmutable::now()->setTimezone('Asia/Beirut');
        $today = $branchNow->toDateString();

        CheckoutWorld::cutOff($this->world->branch, '15:00:00');
        $this->travelTo(CarbonImmutable::parse($today.' 18:00:00', 'Asia/Beirut'));

        // Same branch, same passed cut-off, same requested day — and it places,
        // because a walk-in is handed their lunch now.
        $order = $this->placement->placeComposed(composedFor($this, [
            'account' => null,
            'address' => null,
            'fulfilmentType' => FulfilmentType::Counter,
            'requestedDate' => CarbonImmutable::parse($today),
            'placedOnBehalfBy' => (string) $this->agent->getKey(),
            'paymentMethod' => PaymentMethod::CashAtCounter,
        ]))->order;

        expect($order->fulfilment_type)->toBe(FulfilmentType::Counter);
    });
});

describe('the idempotency subject', function (): void {
    it('keys a staff placement on the member of staff and replays it', function (): void {
        // `idempotency_keys_subject_check` is `num_nonnulls(user_id,
        // customer_account_id) = 1`. The old derivation read the customer off
        // the placement — and a counter sale has no customer, so it would have
        // claimed nothing and protected nothing. The agent is the durable
        // subject: they are who double-taps the button.
        $compose = fn (): ComposedPlacement => composedFor($this, [
            'account' => null,
            'address' => null,
            'fulfilmentType' => FulfilmentType::Counter,
            'placedOnBehalfBy' => (string) $this->agent->getKey(),
            'paymentMethod' => PaymentMethod::CashAtCounter,
        ]);

        $first = $this->placement->placeComposed($compose(), 'desk-tap-1');
        $second = $this->placement->placeComposed($compose(), 'desk-tap-1');

        expect($first->replayed)->toBeFalse()
            ->and($second->replayed)->toBeTrue()
            ->and((string) $second->order->getKey())->toBe((string) $first->order->getKey())
            ->and(Order::query()->count())->toBe(1);

        $key = IdempotencyKey::query()->where('key', 'desk-tap-1')->sole();

        expect($key->user_id)->toBe((string) $this->agent->getKey())
            ->and($key->customer_account_id)->toBeNull();
    });

    it('still keys a self-service composed placement on the customer', function (): void {
        // The subscription path, unchanged. A registered customer keys on their
        // own identity, which is what `place()` does and what generation has
        // relied on since S1.
        $this->placement->placeComposed(composedFor($this), 'generated-1');

        $key = IdempotencyKey::query()->where('key', 'generated-1')->sole();

        expect($key->user_id)->toBe((string) $this->world->customer->account->user_id)
            ->and($key->customer_account_id)->toBeNull();
    });

    it('tells two desk taps apart when only the way the order leaves differs', function (): void {
        // The fingerprint gained the fulfilment type, the staff marker and the
        // payment method because all three change what was placed. Without them
        // a mistyped retry — same basket, same customer, same key, different
        // type — would be answered with the first order rather than refused.
        $pickup = composedFor($this, [
            'address' => null,
            'fulfilmentType' => FulfilmentType::Pickup,
            'placedOnBehalfBy' => (string) $this->agent->getKey(),
        ]);

        $counter = composedFor($this, [
            'address' => null,
            'fulfilmentType' => FulfilmentType::Counter,
            'placedOnBehalfBy' => (string) $this->agent->getKey(),
        ]);

        $this->placement->placeComposed($pickup, 'desk-tap-2');

        expect(fn () => $this->placement->placeComposed($counter, 'desk-tap-2'))
            ->toThrow(ApiException::class, 'This idempotency key has already been used for a different request.');

        expect(Order::query()->count())->toBe(1);
    });
});

it('refuses a composed placement for a corporate buyer with no agreement behind it', function (): void {
    // The agreement gate is unwritable on the desk path — a `pos` channel has
    // no private pricing, so `agreementReasons()` returns immediately for every
    // order the Order Desk will ever place. That is exactly why it is worth
    // asserting somewhere else: the gate was added to `composeNow()` for parity
    // rather than for effect, and a no-op nobody exercises is a no-op that
    // quietly stops working.
    //
    // A wholesale channel, a corporate buyer, and no agreement between them.
    $organisation = $this->world->organisation;

    $wholesale = SalesChannel::factory()->wholesale()->create([
        'organisation_id' => $organisation->getKey(),
        'code' => 'wholesale',
        'channel_kind' => SalesChannelKind::B2b,
    ]);

    $tradeList = PricingWorld::priceList($organisation, 'trade-usd', active: true);
    PricingWorld::assign($wholesale, $tradeList);
    CheckoutWorld::offer($wholesale, $this->world->meal);
    PricingWorld::price($tradeList, $this->world->meal, null, 3000);

    // The seller's own reference codes rather than the factory's sub-factories:
    // `ReferenceDataSeeder` has already filled `countries`, `currencies` and
    // `languages`, and a fresh `Country::factory()` collides with a seeded row
    // on the primary key sooner or later.
    $buyerOrganisation = Organisation::factory()->create([
        'organisation_type_id' => $organisation->organisation_type_id,
        'country_code' => $organisation->country_code,
        'default_currency_code' => $organisation->default_currency_code,
        'default_language_code' => $organisation->default_language_code,
    ]);

    $buyer = CustomerAccountFactory::new()->active()->forOrganisation($buyerOrganisation)->create();

    $address = CustomerAddress::query()->create([
        'customer_account_id' => $buyer->getKey(),
        'address_type' => CustomerAddressType::Delivery,
        'delivery_area_id' => $this->world->area->getKey(),
        'label' => 'HQ',
        'line_one' => 'Main street 1',
        'is_default' => true,
        'lock_version' => 0,
    ]);

    $codes = composedRefusalCodes(fn () => $this->placement->placeComposed(composedFor($this, [
        'account' => $buyer,
        'address' => $address,
        'salesChannelId' => (string) $wholesale->getKey(),
    ])));

    // The line still priced — the trade tariff is a public one on that channel
    // — so this is the agreement gate refusing and not a repricing failure.
    expect($codes)->toBe(['agreement_required'])
        ->and(Order::query()->count())->toBe(0);
});

it('gives a cart checkout the richer address snapshot too', function (): void {
    // `place()` and `composeNow()` share `persist()`, which is where the widened
    // snapshot is written — so a customer checking out their own basket gains
    // the building, the floor and the directions without anything on the cart
    // path being touched. Asserted rather than assumed, because "both paths flow
    // through the same writer" is the claim that makes this commit safe.
    $address = $this->world->customer->address;
    $address->building = 'Sursock';
    $address->floor = '4';
    $address->apartment = '4B';
    $address->directions = 'Green door past the pharmacy, ring twice';
    $address->save();

    $carts = app(CartService::class);
    $cart = $carts->getOrCreate($this->world->customer->account, $this->world->channel);
    $carts->addItem($cart, (string) $this->world->meal->getKey());

    $order = $this->placement->place($cart->refresh(), $address->refresh())->order->refresh();

    expect($order->delivery_building)->toBe('Sursock')
        ->and($order->delivery_floor)->toBe('4')
        ->and($order->delivery_apartment)->toBe('4B')
        ->and($order->delivery_directions)->toBe('Green door past the pharmacy, ring twice')
        // And nothing else about a cart checkout moved: still a delivery, still
        // paid at the door.
        ->and($order->fulfilment_type)->toBe(FulfilmentType::Delivery)
        ->and($order->payment_method)->toBe(PaymentMethod::CashOnDelivery)
        ->and($order->placed_on_behalf_by)->toBeNull();
});
