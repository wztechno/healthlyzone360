<?php

declare(strict_types=1);

use Healthy360\Orders\OrderDesk\Services\DeskBasket;
use Healthy360\Orders\Services\ComposedLine;
use Healthy360\Support\Identifiers\IdentifierService;

/*
|--------------------------------------------------------------------------
| Three taps for the same coffee are one line for three coffees
|--------------------------------------------------------------------------
|
| `order_lines_one_row_per_article` is a unique index over `(order_id,
| catalogue_item_id, catalogue_item_variant_id)` **NULLS NOT DISTINCT**, and
| `OrderPlacementService` never aggregates — a *basket* cannot present the same
| article twice, so it has never had to. A desk basket can and does: tapping the
| same article three times is how a counter works.
|
| So the merge happens here, before any `ComposedLine` exists, and these
| assertions are what stops it drifting into a 23505 nobody can render. They run
| against the service directly rather than through an endpoint, because what is
| being pinned is arithmetic and ordering, and a request-shaped test would prove
| both of them only for whichever endpoint it happened to call.
|
| No database is touched. The service reads no table — that is the point of it
| being aggregation and not validation.
|
*/

beforeEach(function (): void {
    $this->basket = app(DeskBasket::class);
    $this->id = fn (): string => app(IdentifierService::class)->generate();
});

it('merges the same article tapped more than once into one line', function (): void {
    $coffee = ($this->id)();

    $lines = $this->basket->aggregate([
        ['catalogue_item_id' => $coffee, 'quantity' => '1'],
        ['catalogue_item_id' => $coffee, 'quantity' => '1'],
        ['catalogue_item_id' => $coffee, 'quantity' => '1'],
    ]);

    expect($lines)->toHaveCount(1)
        ->and($lines[0])->toBeInstanceOf(ComposedLine::class)
        ->and($lines[0]->catalogueItemId)->toBe($coffee)
        ->and($lines[0]->catalogueItemVariantId)->toBeNull()
        // Scale six, which is the platform's arithmetic scale and not the
        // column's four. The working figure is never coarser than what is kept.
        ->and($lines[0]->quantity)->toBe('3.000000');
});

it('keeps an article and the same article in a pack as two lines', function (): void {
    // The `NULLS NOT DISTINCT` half of the index, from the other side: the plain
    // article and the packed one are two rows the index will happily take, two
    // different things to sell, and two prices. A key that treated the missing
    // variant as "matches anything" would merge a jar into a spoonful.
    $harissa = ($this->id)();
    $jar = ($this->id)();

    $lines = $this->basket->aggregate([
        ['catalogue_item_id' => $harissa, 'catalogue_item_variant_id' => $jar, 'quantity' => '2'],
        ['catalogue_item_id' => $harissa, 'catalogue_item_variant_id' => null, 'quantity' => '1'],
        ['catalogue_item_id' => $harissa, 'catalogue_item_variant_id' => $jar, 'quantity' => '1'],
    ]);

    expect($lines)->toHaveCount(2)
        ->and($lines[0]->catalogueItemVariantId)->toBe($jar)
        ->and($lines[0]->quantity)->toBe('3.000000')
        ->and($lines[1]->catalogueItemVariantId)->toBeNull()
        ->and($lines[1]->quantity)->toBe('1.000000');
});

it('leaves an omitted variant key and an explicit null meaning the same thing', function (): void {
    // The desk client may send the key or leave it out; both are "no variant",
    // and a merge that only recognised one of them would produce two lines for
    // one article and a 23505 at placement.
    $item = ($this->id)();

    $lines = $this->basket->aggregate([
        ['catalogue_item_id' => $item, 'quantity' => '1'],
        ['catalogue_item_id' => $item, 'catalogue_item_variant_id' => null, 'quantity' => '2'],
    ]);

    expect($lines)->toHaveCount(1)
        ->and($lines[0]->quantity)->toBe('3.000000');
});

it('gives the merged line the position of the first tap that named it', function (): void {
    // A desk agent reads the sale back while they are building it. Merging by
    // key and returning whatever order the map fell into would be a list nobody
    // assembled — the soup would move to the bottom because the bread was tapped
    // again after it.
    $soup = ($this->id)();
    $bread = ($this->id)();
    $tea = ($this->id)();

    $lines = $this->basket->aggregate([
        ['catalogue_item_id' => $soup, 'quantity' => '1'],
        ['catalogue_item_id' => $bread, 'quantity' => '1'],
        ['catalogue_item_id' => $tea, 'quantity' => '1'],
        ['catalogue_item_id' => $bread, 'quantity' => '1'],
    ]);

    expect(array_map(static fn (ComposedLine $line): string => $line->catalogueItemId, $lines))
        ->toBe([$soup, $bread, $tea])
        ->and($lines[1]->quantity)->toBe('2.000000');
});

it('sums fractional quantities at six decimal places rather than through a float', function (): void {
    // Three of a third of a kilo. In float arithmetic this is 0.9999999999999999
    // and the line total that follows is a number nobody can reproduce; in
    // bcmath at scale six it is what was weighed, truncated once at a stated
    // place.
    $mince = ($this->id)();

    $lines = $this->basket->aggregate([
        ['catalogue_item_id' => $mince, 'quantity' => '0.333333'],
        ['catalogue_item_id' => $mince, 'quantity' => '0.333333'],
        ['catalogue_item_id' => $mince, 'quantity' => '0.333333'],
    ]);

    expect($lines[0]->quantity)->toBe('0.999999');

    // And the scale is a floor, not a rounding: a seventh place is dropped
    // rather than carried, because the column keeps four and a figure invented
    // at the seventh place would be a quantity nobody weighed.
    expect($this->basket->aggregate([
        ['catalogue_item_id' => $mince, 'quantity' => '0.0000004'],
        ['catalogue_item_id' => $mince, 'quantity' => '0.0000004'],
    ])[0]->quantity)->toBe('0.000000');
});

it('leaves the price for the standing tariff to decide', function (): void {
    // A desk line is repriced at placement exactly as a basket line is.
    // `PriceOverride` exists for one caller — subscription generation
    // grandfathering a subscriber's per-day price — and a walk-in is not that.
    $lines = $this->basket->aggregate([['catalogue_item_id' => ($this->id)(), 'quantity' => '1']]);

    expect($lines[0]->price)->toBeNull();
});

it('answers an empty basket with an empty list rather than a line of nothing', function (): void {
    expect($this->basket->aggregate([]))->toBe([]);
});

it('refuses a quantity bcmath would silently read as zero', function (): void {
    // bcmath handed a non-numeric string returns zero rather than erroring, so
    // without the guard a malformed quantity would merge to nothing and the
    // article would be sold free. These strings arrive from a request body.
    expect(fn () => $this->basket->aggregate([
        ['catalogue_item_id' => ($this->id)(), 'quantity' => 'two'],
    ]))->toThrow(InvalidArgumentException::class);
});
