<?php

declare(strict_types=1);

use Carbon\CarbonImmutable;
use Healthy360\AccessControl\Database\Seeders\AccessControlSeeder;
use Healthy360\Cart\Exceptions\LineRefused;
use Healthy360\Cart\Models\Cart;
use Healthy360\Cart\Services\CartService;
use Healthy360\Cart\Services\LineProbe;
use Healthy360\Cart\Tests\Fixtures\CheckoutWorld;
use Healthy360\Catalogues\Models\CatalogueItemAvailabilityDay;
use Healthy360\Delivery\Models\DeliveryWindow;
use Healthy360\Kitchens\Models\BranchOpeningHour;
use Healthy360\Kitchens\Services\KitchenServiceSettingsLookup;
use Healthy360\Orders\Enums\FulfilmentType;
use Healthy360\Orders\Enums\PaymentMethod;
use Healthy360\Orders\Exceptions\PlacementRefused;
use Healthy360\Orders\Models\Order;
use Healthy360\Orders\Services\CheckoutPreviewService;
use Healthy360\Orders\Services\ComposedLine;
use Healthy360\Orders\Services\ComposedPlacement;
use Healthy360\Orders\Services\OrderPlacementService;
use Healthy360\Orders\Services\ServingBranches;
use Healthy360\Orders\Tests\Fixtures\DeskWorld;
use Healthy360\Organisations\Database\Seeders\OrganisationTypeSeeder;
use Healthy360\Organisations\Enums\BranchStatus;
use Healthy360\Organisations\Models\OrganisationBranch;
use Healthy360\ReferenceData\Database\Seeders\ReferenceDataSeeder;

/*
|--------------------------------------------------------------------------
| The server refuses what the kitchen cannot make
|--------------------------------------------------------------------------
|
| The audit placed orders while the kitchen was closed all week, for past
| dates, for ended windows, under the zone minimum and against a calendar day
| off. All of it succeeded, because a customer basket's `branch_id` is usually
| null and null meant "ask nothing". These baskets are all branchless, and
| `orders.branch_id` staying null is asserted wherever one gets through.
|
| The clock is pinned to Tuesday 3 November 2026, 08:00 in Beirut (UTC+2), before
| the world is built, because `CheckoutWorld` prices from today.
|
*/

beforeEach(function (): void {
    $this->travelTo(CarbonImmutable::parse('2026-11-03 08:00:00', 'Asia/Beirut'));

    $this->seed([ReferenceDataSeeder::class, OrganisationTypeSeeder::class, AccessControlSeeder::class]);

    $this->world = DeskWorld::build('impossible@kitchen.test');
    $this->placement = app(OrderPlacementService::class);
    $this->today = CarbonImmutable::parse('2026-11-03');
});

function impossibleCart(object $world, int|string $quantity = 1): Cart
{
    $carts = app(CartService::class);

    $cart = $carts->getOrCreate($world->customer->account, $world->channel);
    $carts->addItem($cart, (string) $world->meal->getKey(), quantity: $quantity);

    return $cart->refresh();
}

/**
 * @return list<array<string, mixed>>
 */
function impossibleRefusals(callable $attempt): array
{
    try {
        $attempt();
    } catch (PlacementRefused $refusal) {
        return $refusal->details['reasons'];
    }

    test()->fail('The placement should have been refused.');
}

function impossibleWindow(object $world, string $code, string $starts, string $ends): DeliveryWindow
{
    $window = CheckoutWorld::window($world->zone, $code);
    $window->forceFill(['starts_at' => $starts, 'ends_at' => $ends])->save();

    return $window;
}

/**
 * Shut on the given ISO weekdays, stated as the rows a kitchen's own form writes:
 * both times null is what "closed" means.
 *
 * @param  list<int>  $weekdays
 */
function impossibleClosure(OrganisationBranch $branch, array $weekdays = [1, 2, 3, 4, 5, 6, 7]): void
{
    foreach ($weekdays as $weekday) {
        BranchOpeningHour::withoutTenancy()->create([
            'organisation_id' => $branch->organisation_id,
            'branch_id' => $branch->getKey(),
            'weekday' => $weekday,
            'opens_at' => null,
            'closes_at' => null,
            'order_cut_off_at' => null,
        ]);
    }
}

/**
 * @param  array<string, mixed>  $attributes
 */
function impossibleCalendarDay(object $world, string $date, array $attributes): void
{
    CatalogueItemAvailabilityDay::factory()->create([
        'organisation_id' => $world->organisation->getKey(),
        'catalogue_item_id' => $world->meal->getKey(),
        'date' => $date,
        'order_cut_off_at' => null,
        ...$attributes,
    ]);
}

/**
 * A composed order with no branch, on the desk's channel unless stated.
 *
 * @param  array<string, mixed>  $overrides
 */
function impossibleComposed(object $world, array $overrides = []): ComposedPlacement
{
    return new ComposedPlacement(...[
        'account' => $world->customer->account,
        'address' => $world->customer->address,
        'organisationId' => (string) $world->organisation->getKey(),
        'salesChannelId' => (string) $world->desk->getKey(),
        'branchId' => null,
        'currencyCode' => $world->organisation->default_currency_code,
        'lines' => [new ComposedLine(catalogueItemId: (string) $world->meal->getKey())],
        ...$overrides,
    ]);
}

/**
 * A later branch, a minute on: `ServingBranches` sorts on `created_at`, and the
 * frozen clock would otherwise tie the two.
 */
function impossibleLaterBranch(object $world, string $name): OrganisationBranch
{
    test()->travel(1)->minutes();

    return CheckoutWorld::branch($world->organisation, $name);
}

/**
 * Sets the kitchen up so that today's order hits the named refusal, and answers
 * with the window and day to ask for.
 *
 * @return array{0: string|null, 1: CarbonImmutable}
 */
function impossibleArrangement(object $test, string $case): array
{
    $world = $test->world;

    return match ($case) {
        'closed' => (function () use ($world, $test): array {
            impossibleClosure($world->branch);

            return [null, $test->today];
        })(),
        'date_in_the_past' => [null, $test->today->subDay()],
        'cut_off_passed' => (function () use ($world, $test): array {
            CheckoutWorld::cutOff($world->branch, '07:00:00');

            return [null, $test->today];
        })(),
        'kitchen_closed' => (function () use ($world, $test): array {
            $world->branch->forceFill(['status' => BranchStatus::Closed])->save();

            return [null, $test->today];
        })(),
        'window_ended' => (function () use ($world, $test): array {
            impossibleWindow($world, 'breakfast', '06:00:00', '07:30:00');

            return ['breakfast', $test->today];
        })(),
        'lead_time_not_met' => (function () use ($world, $test): array {
            impossibleWindow($world, 'brunch', '09:00:00', '12:00:00');

            return ['brunch', $test->today];
        })(),
        'below_zone_minimum' => (function () use ($world, $test): array {
            $world->zone->forceFill(['minimum_order_minor' => 5000])->save();

            return [null, $test->today];
        })(),
        'item_unavailable_on_date' => (function () use ($world, $test): array {
            impossibleCalendarDay($world, '2026-11-03', ['is_available' => false]);

            return [null, $test->today];
        })(),
    };
}

it('refuses a branchless basket, and the preview warns in the same word first', function (string $reason): void {
    [$window, $date] = impossibleArrangement($this, $reason);

    $cart = impossibleCart($this->world);

    expect($cart->branch_id)->toBeNull();

    $preview = app(CheckoutPreviewService::class)->preview($cart, $this->world->customer->address, $window, $date);

    expect($preview->warnings)->toContain($reason);

    $reasons = impossibleRefusals(fn () => $this->placement->place($cart, $this->world->customer->address, $window, $date));

    expect(array_column($reasons, 'reason'))->toContain($reason)
        ->and(Order::query()->count())->toBe(0);
})->with([
    'closed',
    'date_in_the_past',
    'cut_off_passed',
    'kitchen_closed',
    'window_ended',
    'lead_time_not_met',
    'below_zone_minimum',
    'item_unavailable_on_date',
]);

it('takes a branchless order the kitchen can make, and leaves orders.branch_id as it found it', function (): void {
    impossibleWindow($this->world, 'lunch', '10:00:00', '14:00:00');

    $order = $this->placement->place(impossibleCart($this->world), $this->world->customer->address, 'lunch', $this->today)->order;

    expect($order->refresh()->branch_id)->toBeNull();
});

it('treats a kitchen with no opening hours as unconfigured, not closed', function (): void {
    expect(BranchOpeningHour::withoutTenancy()->where('branch_id', $this->world->branch->getKey())->count())->toBe(0);

    $order = $this->placement->place(impossibleCart($this->world), $this->world->customer->address, null, $this->today)->order;

    expect($order->exists)->toBeTrue();
});

it('asks about today when a customer names no day at all', function (): void {
    impossibleClosure($this->world->branch);

    $reasons = impossibleRefusals(fn () => $this->placement->place(impossibleCart($this->world), $this->world->customer->address));

    expect(array_column($reasons, 'reason'))->toContain('closed');
});

it('reports when the lead time can be met, and allows exactly that', function (): void {
    impossibleWindow($this->world, 'brunch', '09:00:00', '12:00:00');
    impossibleWindow($this->world, 'lunch', '10:00:00', '14:00:00');

    $cart = impossibleCart($this->world);

    $reasons = impossibleRefusals(fn () => $this->placement->place($cart, $this->world->customer->address, 'brunch', $this->today));

    $refusal = collect($reasons)->firstWhere('reason', 'lead_time_not_met');

    expect($refusal['earliest_at'])->toBe('2026-11-03T10:00:00+02:00')
        ->and($refusal['lead_minutes'])->toBe(120)
        ->and($refusal['delivery_window_code'])->toBe('brunch');

    // 08:00 plus 120 minutes is exactly 10:00, which is "at or before".
    expect($this->placement->place($cart, $this->world->customer->address, 'lunch', $this->today)->order->exists)->toBeTrue();
});

it('reads the lead time from the kitchen\'s own settings', function (): void {
    impossibleWindow($this->world, 'brunch', '09:00:00', '12:00:00');

    $settings = app(KitchenServiceSettingsLookup::class)->for((string) $this->world->organisation->getKey());
    $settings->order_lead_minutes = 30;
    $settings->save();

    expect($this->placement->place(impossibleCart($this->world), $this->world->customer->address, 'brunch', $this->today)->order->exists)->toBeTrue();
});

it('only applies the time rules to today', function (): void {
    impossibleWindow($this->world, 'breakfast', '06:00:00', '07:30:00');

    $order = $this->placement->place(impossibleCart($this->world), $this->world->customer->address, 'breakfast', $this->today->addDay())->order;

    expect($order->delivery_window_code)->toBe('breakfast');
});

it('skips the time rules for a window with no hours', function (): void {
    CheckoutWorld::window($this->world->zone, 'whenever');

    $order = $this->placement->place(impossibleCart($this->world), $this->world->customer->address, 'whenever', $this->today)->order;

    expect($order->delivery_window_code)->toBe('whenever');
});

it('holds a $5 order to a $50 zone minimum and tells the screen what the minimum is', function (): void {
    $world = DeskWorld::build('five-dollars@kitchen.test', unitPriceMinor: 500);
    $world->zone->forceFill(['minimum_order_minor' => 5000])->save();

    $cart = impossibleCart($world);

    $reasons = impossibleRefusals(fn () => $this->placement->place($cart, $world->customer->address, null, $this->today));

    expect($reasons)->toHaveCount(1)
        ->and($reasons[0])->toMatchArray([
            'reason' => 'below_zone_minimum',
            'minimum_minor' => 5000,
            'subtotal_minor' => 500,
            'currency_code' => 'USD',
        ]);
});

it('passes a subtotal that meets the minimum exactly, and skips a zone with none', function (): void {
    $this->world->zone->forceFill(['minimum_order_minor' => 5000])->save();

    expect($this->placement->place(impossibleCart($this->world, 2), $this->world->customer->address, null, $this->today)->order->exists)->toBeTrue();
});

describe('the calendar', function (): void {
    it('refuses a sold-out day', function (): void {
        impossibleCalendarDay($this->world, '2026-11-03', ['remaining_portions' => 0]);

        $reasons = impossibleRefusals(fn () => $this->placement->place(impossibleCart($this->world), $this->world->customer->address, null, $this->today));

        expect($reasons[0])->toMatchArray(['reason' => 'item_unavailable_on_date', 'on' => '2026-11-03', 'cause' => 'sold_out']);
    });

    it('holds a same-day order to the row\'s cut-off, in the branch\'s time', function (): void {
        // 07:30 in Beirut is 05:30 UTC: the UTC clock has not reached it, the kitchen's has.
        impossibleCalendarDay($this->world, '2026-11-03', ['order_cut_off_at' => '07:30:00']);

        $reasons = impossibleRefusals(fn () => $this->placement->place(impossibleCart($this->world), $this->world->customer->address, null, $this->today));

        expect($reasons[0])->toMatchArray(['reason' => 'item_unavailable_on_date', 'cause' => 'cut_off_passed']);
    });

    it('leaves a later day\'s cut-off alone, and a row that rules nothing out', function (): void {
        impossibleCalendarDay($this->world, '2026-11-04', ['order_cut_off_at' => '07:30:00']);
        impossibleCalendarDay($this->world, '2026-11-03', ['remaining_portions' => 4, 'order_cut_off_at' => '18:00:00']);

        $probe = app(LineProbe::class)->probe($this->world->channel, (string) $this->world->meal->getKey(), null, '1', $this->today, 'USD');

        expect($probe->isOrderable())->toBeTrue()
            ->and($this->placement->place(impossibleCart($this->world), $this->world->customer->address, null, $this->today->addDay())->order->exists)->toBeTrue();
    });

    it('allows an item with no row for the date', function (): void {
        impossibleCalendarDay($this->world, '2026-11-05', ['is_available' => false]);

        expect($this->placement->place(impossibleCart($this->world), $this->world->customer->address, null, $this->today)->order->exists)->toBeTrue();
    });

    it('refuses a dated basket line, and leaves an undated one for placement to judge', function (): void {
        impossibleCalendarDay($this->world, '2026-11-03', ['is_available' => false]);

        $carts = app(CartService::class);
        $cart = $carts->getOrCreate($this->world->customer->account, $this->world->channel);

        expect(fn () => $carts->addItem($cart, (string) $this->world->meal->getKey(), deliveryDate: $this->today))
            ->toThrow(LineRefused::class);

        // A dish off today can still go in a basket that will ask for tomorrow.
        $carts->addItem($cart, (string) $this->world->meal->getKey());

        expect($this->placement->place($cart->refresh(), $this->world->customer->address, null, $this->today->addDay())->order->exists)->toBeTrue();
    });

    it('lets a caller who is not selling the day skip it', function (): void {
        impossibleCalendarDay($this->world, '2026-11-03', ['is_available' => false]);

        $probe = fn (bool $enforce) => app(LineProbe::class)->probe(
            $this->world->channel,
            (string) $this->world->meal->getKey(),
            null,
            '1',
            $this->today,
            'USD',
            enforceCalendar: $enforce,
        );

        expect($probe(true)->isOrderable())->toBeFalse()
            ->and($probe(false)->isOrderable())->toBeTrue();
    });
});

describe('several branches', function (): void {
    it('passes when any one accepts', function (): void {
        impossibleClosure($this->world->branch);
        impossibleLaterBranch($this->world, 'Second kitchen');

        $order = $this->placement->place(impossibleCart($this->world), $this->world->customer->address, null, $this->today)->order;

        expect($order->refresh()->branch_id)->toBeNull();
    });

    it('refuses when every one refuses, reporting the first', function (): void {
        $second = impossibleLaterBranch($this->world, 'Second kitchen');
        impossibleClosure($this->world->branch);
        CheckoutWorld::cutOff($second, '07:00:00');

        $reasons = impossibleRefusals(fn () => $this->placement->place(impossibleCart($this->world), $this->world->customer->address, null, $this->today));

        expect(array_column($reasons, 'reason'))->toBe(['closed'])
            ->and($reasons[0]['branch_id'])->toBe((string) $this->world->branch->getKey());
    });

    it('tests each branch on its own clock', function (): void {
        impossibleWindow($this->world, 'breakfast', '06:00:00', '07:30:00');

        $second = impossibleLaterBranch($this->world, 'Los Angeles kitchen');
        $second->forceFill(['timezone' => 'America/Los_Angeles'])->save();

        // Over in Beirut; in Los Angeles it is still Monday evening.
        $order = $this->placement->place(impossibleCart($this->world), $this->world->customer->address, 'breakfast', $this->today)->order;

        expect($order->refresh()->branch_id)->toBeNull();
    });

    it('resolves the cart\'s branch, then the zone\'s, then the active ones', function (): void {
        $second = impossibleLaterBranch($this->world, 'Second kitchen');
        $closed = impossibleLaterBranch($this->world, 'Shut kitchen');
        $closed->forceFill(['status' => BranchStatus::Closed])->save();

        $organisationId = (string) $this->world->organisation->getKey();
        $first = (string) $this->world->branch->getKey();
        $zone = $this->world->zone->replicate();
        $zone->branch_id = (string) $second->getKey();

        $branches = app(ServingBranches::class);

        expect($branches->for($organisationId, $first, $zone))->toBe([$first])
            ->and($branches->for($organisationId, null, $zone))->toBe([(string) $second->getKey()])
            ->and($branches->for($organisationId, null, $this->world->zone))->toBe([$first, (string) $second->getKey()]);
    });
});

describe('Review Focus 1: the branch\'s date, never UTC\'s', function (): void {
    it('at 23:30 Beirut judges the day that is ending there', function (): void {
        // 21:30 UTC, so both clocks agree on the date here; the case below is
        // where they part. What this one pins is the local clock: "today" is
        // over for a lunch window, and a lead time runs past midnight.
        $this->travelTo(CarbonImmutable::parse('2026-11-03 23:30:00', 'Asia/Beirut'));

        impossibleWindow($this->world, 'lunch', '11:00:00', '14:00:00');
        impossibleWindow($this->world, 'late', '22:00:00', '23:45:00');
        impossibleCalendarDay($this->world, '2026-11-03', ['order_cut_off_at' => '23:00:00']);

        $cart = impossibleCart($this->world);

        $ended = impossibleRefusals(fn () => $this->placement->place($cart, $this->world->customer->address, 'lunch', $this->today));

        expect(array_column($ended, 'reason'))->toContain('window_ended', 'item_unavailable_on_date');

        $late = impossibleRefusals(fn () => $this->placement->place($cart, $this->world->customer->address, 'late', $this->today));

        expect(collect($late)->firstWhere('reason', 'lead_time_not_met')['earliest_at'])->toBe('2026-11-04T01:30:00+02:00');

        $order = $this->placement->place($cart, $this->world->customer->address, 'lunch', $this->today->addDay())->order;

        expect($order->refresh()->branch_id)->toBeNull();
    });

    it('past midnight in Beirut, where UTC is still on yesterday, uses Beirut\'s date', function (): void {
        // 22:30 UTC on Tuesday: a rule reading UTC would call Tuesday today.
        $this->travelTo(CarbonImmutable::parse('2026-11-04 00:30:00', 'Asia/Beirut'));

        impossibleClosure($this->world->branch, [3]);

        $cart = impossibleCart($this->world);

        $past = impossibleRefusals(fn () => $this->placement->place($cart, $this->world->customer->address, null, $this->today));

        expect(array_column($past, 'reason'))->toContain('date_in_the_past');

        // Wednesday is closed, and no date means Beirut's today, which is Wednesday.
        $closed = impossibleRefusals(fn () => $this->placement->place($cart, $this->world->customer->address));

        expect(array_column($closed, 'reason'))->toContain('closed');
    });

    it('past midnight in Beirut, ends a window and reads a calendar row on Beirut\'s date', function (): void {
        $this->travelTo(CarbonImmutable::parse('2026-11-04 00:30:00', 'Asia/Beirut'));

        impossibleWindow($this->world, 'midnight', '00:00:00', '00:15:00');
        impossibleCalendarDay($this->world, '2026-11-04', ['is_available' => false]);

        $cart = impossibleCart($this->world);

        $reasons = impossibleRefusals(fn () => $this->placement->place($cart, $this->world->customer->address, 'midnight', $this->today->addDay()));

        expect(array_column($reasons, 'reason'))->toContain('window_ended', 'item_unavailable_on_date');

        // An undated line asks about the branch's today too.
        $undated = impossibleRefusals(fn () => $this->placement->place($cart, $this->world->customer->address));

        expect(array_column($undated, 'reason'))->toContain('item_unavailable_on_date');
    });
});

describe('the desk', function (): void {
    beforeEach(function (): void {
        $this->agent = DeskWorld::agent($this->world, 'impossible-agent@desk.test');
    });

    it('skips the lead time and the minimum, which a cashier can agree', function (): void {
        impossibleWindow($this->world, 'brunch', '09:00:00', '12:00:00');
        $this->world->zone->forceFill(['minimum_order_minor' => 500000])->save();

        $order = $this->placement->placeComposed(impossibleComposed($this->world, [
            'deliveryWindowCode' => 'brunch',
            'requestedDate' => $this->today,
            'placedOnBehalfBy' => (string) $this->agent->getKey(),
        ]))->order;

        expect($order->refresh()->branch_id)->toBeNull();
    });

    it('still refuses a closed day and a calendar day off', function (): void {
        impossibleClosure($this->world->branch);
        impossibleCalendarDay($this->world, '2026-11-03', ['is_available' => false]);

        $closed = impossibleRefusals(fn () => $this->placement->placeComposed(impossibleComposed($this->world, [
            'requestedDate' => $this->today,
            'placedOnBehalfBy' => (string) $this->agent->getKey(),
        ])));

        expect(array_column($closed, 'reason'))->toContain('closed', 'item_unavailable_on_date');
    });

    it('refuses an ended window, on a pickup too', function (): void {
        impossibleWindow($this->world, 'breakfast', '06:00:00', '07:30:00');

        $reasons = impossibleRefusals(fn () => $this->placement->placeComposed(impossibleComposed($this->world, [
            'address' => null,
            'fulfilmentType' => FulfilmentType::Pickup,
            'deliveryWindowCode' => 'breakfast',
            'requestedDate' => $this->today,
            'placedOnBehalfBy' => (string) $this->agent->getKey(),
        ])));

        expect(array_column($reasons, 'reason'))->toBe(['window_ended']);
    });

    it('still sells across a counter on a closed day', function (): void {
        impossibleClosure($this->world->branch);

        $order = $this->placement->placeComposed(impossibleComposed($this->world, [
            'account' => null,
            'address' => null,
            'fulfilmentType' => FulfilmentType::Counter,
            'placedOnBehalfBy' => (string) $this->agent->getKey(),
            'paymentMethod' => PaymentMethod::CashAtCounter,
        ]))->order;

        expect($order->fulfilment_type)->toBe(FulfilmentType::Counter);
    });

    it('quotes what the sale would be refused for, and nothing the sale is not', function (): void {
        impossibleWindow($this->world, 'breakfast', '06:00:00', '07:30:00');
        impossibleWindow($this->world, 'brunch', '09:00:00', '12:00:00');
        $this->world->zone->forceFill(['minimum_order_minor' => 500000])->save();

        $this->actingAs($this->agent);

        $body = [
            'fulfilment_type' => 'delivery',
            'customer_account_id' => (string) $this->world->customer->account->getKey(),
            'customer_address_id' => (string) $this->world->customer->address->getKey(),
            'requested_delivery_date' => '2026-11-03',
            'lines' => [['catalogue_item_id' => (string) $this->world->meal->getKey(), 'quantity' => 1]],
        ];

        $this->postJson('/api/v1/catalogue/order-desk/quote', $body + ['delivery_window_code' => 'breakfast'], DeskWorld::headers($this->world))
            ->assertOk()
            ->assertJsonPath('data.quote.refusals.0.reason', 'window_ended')
            ->assertJsonPath('data.quote.quotable', false);

        $this->postJson('/api/v1/catalogue/order-desk/quote', $body + ['delivery_window_code' => 'brunch'], DeskWorld::headers($this->world))
            ->assertOk()
            ->assertJsonPath('data.quote.refusals', [])
            ->assertJsonPath('data.quote.quotable', true);
    });
});

describe('subscription generation', function (): void {
    it('keeps today\'s behaviour on a branchless delivery: no new rule reaches it', function (): void {
        impossibleClosure($this->world->branch);
        impossibleWindow($this->world, 'breakfast', '06:00:00', '07:30:00');
        impossibleCalendarDay($this->world, '2026-11-03', ['is_available' => false]);
        $this->world->zone->forceFill(['minimum_order_minor' => 500000])->save();

        $order = $this->placement->placeComposed(impossibleComposed($this->world, [
            'salesChannelId' => (string) $this->world->channel->getKey(),
            'deliveryWindowCode' => 'breakfast',
            'requestedDate' => $this->today,
            'enforceWindowOffer' => false,
        ]))->order;

        expect($order->refresh()->branch_id)->toBeNull();
    });

    it('keeps today\'s behaviour on a branch of its own: that branch\'s schedule still answers', function (): void {
        impossibleClosure($this->world->branch);

        $reasons = impossibleRefusals(fn () => $this->placement->placeComposed(impossibleComposed($this->world, [
            'salesChannelId' => (string) $this->world->channel->getKey(),
            'branchId' => (string) $this->world->branch->getKey(),
            'requestedDate' => $this->today,
            'enforceWindowOffer' => false,
        ])));

        expect(array_column($reasons, 'reason'))->toBe(['closed']);
    });
});
