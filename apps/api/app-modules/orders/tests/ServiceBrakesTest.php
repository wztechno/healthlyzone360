<?php

declare(strict_types=1);

use Carbon\CarbonImmutable;
use Healthy360\AccessControl\Database\Seeders\AccessControlSeeder;
use Healthy360\Cart\Models\Cart;
use Healthy360\Cart\Services\CartService;
use Healthy360\Cart\Tests\Fixtures\CheckoutWorld;
use Healthy360\Catalogues\Models\CatalogueItemAvailabilityDay;
use Healthy360\Catalogues\Services\MealAvailabilityService;
use Healthy360\Kitchens\Services\KitchenServiceSettingsLookup;
use Healthy360\Orders\Enums\CancellationDisposition;
use Healthy360\Orders\Enums\CancellationReason;
use Healthy360\Orders\Exceptions\PlacementRefused;
use Healthy360\Orders\Services\ComposedLine;
use Healthy360\Orders\Services\ComposedPlacement;
use Healthy360\Orders\Services\OrderLifecycle;
use Healthy360\Orders\Services\OrderPlacementService;
use Healthy360\Orders\Tests\Fixtures\DeskWorld;
use Healthy360\Organisations\Database\Seeders\OrganisationTypeSeeder;
use Healthy360\ReferenceData\Database\Seeders\ReferenceDataSeeder;

/*
|--------------------------------------------------------------------------
| Giving service a brake
|--------------------------------------------------------------------------
|
| Off today, a timed pause, a limit per window, and portions that count down.
| Customers are refused, the desk is warned, and subscription days and accepted
| quotations carry on. The two guards built for a race, `holdCapacity()` and
| `CalendarPortions::take()`, need two connections to race; what is pinned here
| is that the write itself refuses, so the second of two can never pass.
|
*/

beforeEach(function (): void {
    $this->travelTo(CarbonImmutable::parse('2026-11-03 08:00:00', 'Asia/Beirut'));

    $this->seed([ReferenceDataSeeder::class, OrganisationTypeSeeder::class, AccessControlSeeder::class]);

    $this->world = DeskWorld::build('brakes@kitchen.test');
    $this->agent = DeskWorld::agent($this->world, 'brakes-agent@desk.test');
    $this->placement = app(OrderPlacementService::class);
    $this->settings = app(KitchenServiceSettingsLookup::class)->for((string) $this->world->organisation->getKey());
    $this->day = CarbonImmutable::parse('2026-11-04');

    $window = CheckoutWorld::window($this->world->zone, 'lunch');
    $window->forceFill(['starts_at' => '12:00:00', 'ends_at' => '14:00:00'])->save();
});

function brakeCart(object $world, int $quantity = 1): Cart
{
    $carts = app(CartService::class);

    $cart = $carts->getOrCreate($world->customer->account, $world->channel);
    $carts->addItem($cart, (string) $world->meal->getKey(), quantity: $quantity);

    return $cart->refresh();
}

/**
 * @param  array<string, mixed>  $overrides
 */
function brakeDeskSale(object $test, array $overrides = []): ComposedPlacement
{
    return new ComposedPlacement(...[
        'account' => $test->world->customer->account,
        'address' => $test->world->customer->address,
        'organisationId' => (string) $test->world->organisation->getKey(),
        'salesChannelId' => (string) $test->world->desk->getKey(),
        'branchId' => null,
        'currencyCode' => $test->world->organisation->default_currency_code,
        'lines' => [new ComposedLine(catalogueItemId: (string) $test->world->meal->getKey())],
        'deliveryWindowCode' => 'lunch',
        'requestedDate' => $test->day,
        'placedOnBehalfBy' => (string) $test->agent->getKey(),
        ...$overrides,
    ]);
}

/**
 * @return list<string>
 */
function brakeRefusals(callable $attempt): array
{
    try {
        $attempt();
    } catch (PlacementRefused $refusal) {
        return array_column($refusal->details['reasons'], 'reason');
    }

    test()->fail('The placement should have been refused.');
}

function brakeCalendarDay(object $test, int $remaining): CatalogueItemAvailabilityDay
{
    return CatalogueItemAvailabilityDay::factory()->create([
        'organisation_id' => $test->world->organisation->getKey(),
        'catalogue_item_id' => $test->world->meal->getKey(),
        'date' => $test->day->toDateString(),
        'is_available' => true,
        'remaining_portions' => $remaining,
        'order_cut_off_at' => null,
    ]);
}

it('refuses a customer during a pause, and lets them back in when it runs out', function (): void {
    $this->settings->forceFill(['paused_until' => now()->addMinutes(30)])->save();

    expect(brakeRefusals(fn () => $this->placement->place(brakeCart($this->world), $this->world->customer->address, 'lunch', $this->day)))
        ->toContain('kitchen_paused');

    $this->travel(31)->minutes();

    expect($this->placement->place(brakeCart($this->world), $this->world->customer->address, 'lunch', $this->day)->order)->not->toBeNull();
});

it('lets the desk through a pause and through a full window', function (): void {
    $this->settings->forceFill(['paused_until' => now()->addHour(), 'orders_per_window' => 1])->save();

    $this->placement->placeComposed(brakeDeskSale($this));
    $second = $this->placement->placeComposed(brakeDeskSale($this))->order;

    expect($second->exists)->toBeTrue();
});

it('has no such thing as a full window until a limit is set', function (): void {
    $this->placement->place(brakeCart($this->world), $this->world->customer->address, 'lunch', $this->day);

    expect($this->placement->place(brakeCart($this->world), $this->world->customer->address, 'lunch', $this->day)->order)->not->toBeNull();
});

it('refuses the order past the limit, whoever filled the window, and frees it on cancel', function (): void {
    $this->settings->forceFill(['orders_per_window' => 1])->save();

    $deskOrder = $this->placement->placeComposed(brakeDeskSale($this))->order;

    expect(brakeRefusals(fn () => $this->placement->place(brakeCart($this->world), $this->world->customer->address, 'lunch', $this->day)))
        ->toContain('window_full');

    app(OrderLifecycle::class)->cancel($deskOrder, CancellationReason::CustomerRequested);

    expect($this->placement->place(brakeCart($this->world), $this->world->customer->address, 'lunch', $this->day)->order)->not->toBeNull();
});

it('counts portions down at placement and back on cancel', function (): void {
    $day = brakeCalendarDay($this, 3);

    $order = $this->placement->place(brakeCart($this->world, 2), $this->world->customer->address, 'lunch', $this->day)->order;

    expect($day->fresh()->remaining_portions)->toBe(1)
        ->and($order->refresh()->portions_counted)->toBeTrue();

    app(OrderLifecycle::class)->cancel($order, CancellationReason::CustomerRequested);

    expect($day->fresh()->remaining_portions)->toBe(3);
});

it('refuses more portions than are left, and the failed order takes none', function (): void {
    $day = brakeCalendarDay($this, 1);

    expect(brakeRefusals(fn () => $this->placement->place(brakeCart($this->world, 2), $this->world->customer->address, 'lunch', $this->day)))
        ->toContain('item_unavailable_on_date');

    expect($day->fresh()->remaining_portions)->toBe(1);
});

it('does not give wasted food back to the calendar', function (): void {
    $day = brakeCalendarDay($this, 3);

    $order = $this->placement->place(brakeCart($this->world), $this->world->customer->address, 'lunch', $this->day)->order;

    app(OrderLifecycle::class)->cancel($order, CancellationReason::CustomerRequested, disposition: CancellationDisposition::Wasted);

    expect($day->fresh()->remaining_portions)->toBe(2);
});

it('leaves the calendar alone for a day settled earlier', function (): void {
    $day = brakeCalendarDay($this, 3);

    $order = $this->placement->placeComposed(brakeDeskSale($this, ['agreedInWriting' => true]))->order;

    expect($day->fresh()->remaining_portions)->toBe(3)
        ->and($order->refresh()->portions_counted)->toBeFalse();
});

it('takes a dish off today and puts it back, leaving the rest of the row alone', function (): void {
    $availability = app(MealAvailabilityService::class);
    $today = $availability->setOffToday($this->world->meal, true);

    $row = CatalogueItemAvailabilityDay::withoutTenancy()
        ->where('catalogue_item_id', $this->world->meal->getKey())
        ->where('date', $today)
        ->first();

    expect($today)->toBe('2026-11-03')
        ->and($row->is_available)->toBeFalse();

    $row->remaining_portions = 4;
    $row->save();

    $availability->setOffToday($this->world->meal, false);

    expect($row->fresh()->is_available)->toBeTrue()
        ->and($row->fresh()->remaining_portions)->toBe(4);
});
