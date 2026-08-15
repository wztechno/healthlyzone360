<?php

declare(strict_types=1);

use Healthy360\Audit\Models\AuditLog;
use Healthy360\Support\Api\ErrorCode;
use Healthy360\Support\Api\Exceptions\ApiException;
use Healthy360\Support\Api\OffsetPage;
use Illuminate\Database\Eloquent\Collection;
use Illuminate\Http\Request;

/*
|--------------------------------------------------------------------------
| Numbered pages
|--------------------------------------------------------------------------
|
| The counterpart to CursorPageTest, for the one family of endpoints allowed
| to paginate by offset. The arithmetic here is the whole contract — a page
| control renders straight from `meta`, so an off-by-one in `total_pages`
| becomes a page nobody can reach or a page that is always empty.
|
| The reason offset is confined to the kitchen catalogue is in OffsetPage's
| own docblock and in docs/api/conventions.md; what is under test here is only
| that the arithmetic and the refusals are right.
|
*/

/**
 * A request carrying query parameters, as the framework would build one.
 *
 * @param  array<string, string>  $query
 */
function offsetRequest(array $query): Request
{
    return Request::create('/api/v1/catalogue/ingredients', 'GET', $query);
}

/**
 * @return Collection<int, AuditLog>
 */
function offsetRows(int $count): Collection
{
    $rows = new Collection;

    for ($i = 0; $i < $count; $i++) {
        $rows->push(new AuditLog);
    }

    return $rows;
}

it('treats an absent page as a caller not using numbered pages', function (): void {
    expect(OffsetPage::page(offsetRequest([])))->toBeNull()
        ->and(OffsetPage::page(offsetRequest(['page' => ''])))->toBeNull();
});

it('reads a page number', function (): void {
    expect(OffsetPage::page(offsetRequest(['page' => '1'])))->toBe(1)
        ->and(OffsetPage::page(offsetRequest(['page' => '42'])))->toBe(42);
});

it('rejects a page that is not a whole number of 1 or more', function (string $page): void {
    expect(fn (): ?int => OffsetPage::page(offsetRequest(['page' => $page])))
        ->toThrow(function (ApiException $exception): void {
            expect($exception->errorCode)->toBe(ErrorCode::RequestInvalid)
                ->and($exception->details)->toBe(['parameter' => 'page']);
        });
})->with([
    'zero' => '0',
    'negative' => '-1',
    'fractional' => '1.5',
    'words' => 'first',
    // `(int) '2x'` is 2 in PHP, so a lax cast would serve page 2 for a request
    // the client never made.
    'trailing rubbish' => '2x',
]);

it('defaults the page size and accepts the documented range', function (): void {
    expect(OffsetPage::perPage(offsetRequest([])))->toBe(OffsetPage::DEFAULT_PER_PAGE)
        ->and(OffsetPage::perPage(offsetRequest(['per_page' => '1'])))->toBe(1)
        ->and(OffsetPage::perPage(offsetRequest(['per_page' => '100'])))->toBe(100);
});

it('accepts limit as a synonym for per_page, and prefers per_page', function (): void {
    // So a client already sending `limit` does not have to change the word it
    // uses at the moment it starts asking for pages.
    expect(OffsetPage::perPage(offsetRequest(['limit' => '10'])))->toBe(10)
        ->and(OffsetPage::perPage(offsetRequest(['per_page' => '10', 'limit' => '90'])))->toBe(10);
});

it('rejects a page size outside the documented range', function (string $perPage): void {
    expect(fn (): int => OffsetPage::perPage(offsetRequest(['per_page' => $perPage])))
        ->toThrow(function (ApiException $exception): void {
            expect($exception->details)->toBe(['parameter' => 'per_page']);
        });
})->with(['zero' => '0', 'over the maximum' => '101', 'words' => 'lots']);

it('counts pages by rounding up', function (int $total, int $perPage, int $expected): void {
    expect(OffsetPage::meta(offsetRows(0), 1, $perPage, $total)['total_pages'])->toBe($expected);
})->with([
    'empty' => [0, 25, 0],
    'one short of a page' => [24, 25, 1],
    'exactly one page' => [25, 25, 1],
    'one over' => [26, 25, 2],
    'exactly two pages' => [50, 25, 2],
    'a partial third' => [51, 25, 3],
]);

it('describes the page it was given', function (): void {
    $meta = OffsetPage::meta(offsetRows(7), 3, 10, 27);

    expect($meta)->toBe([
        'count' => 7,
        'page' => 3,
        'per_page' => 10,
        'total_count' => 27,
        'total_pages' => 3,
    ]);
});

it('refuses a page past the last', function (): void {
    // 26 rows at 10 a page is three pages; the fourth is a client bug, and
    // answering it with an empty list would let a page control walk forever.
    OffsetPage::assertWithinRange(3, 10, 26);

    expect(fn () => OffsetPage::assertWithinRange(4, 10, 26))
        ->toThrow(function (ApiException $exception): void {
            expect($exception->errorCode)->toBe(ErrorCode::RequestInvalid)
                ->and($exception->details)->toBe(['parameter' => 'page']);
        });
});

it('allows page 1 of an empty collection', function (): void {
    // "You have no ingredients yet" is a legitimate answer to a legitimate
    // request. Refusing it would make an empty catalogue an error state.
    OffsetPage::assertWithinRange(1, 25, 0);

    expect(OffsetPage::meta(offsetRows(0), 1, 25, 0))
        ->toBe(['count' => 0, 'page' => 1, 'per_page' => 25, 'total_count' => 0, 'total_pages' => 0]);
});

it('orders and offsets the query the same way the keyset walks it', function (): void {
    $query = AuditLog::query()->orderBy('action');

    OffsetPage::constrain($query, 3, 10);

    $sql = $query->toSql();
    $orders = $query->getQuery()->orders ?? [];

    // `reorder()` first: a caller's own ordering left in front would make the
    // offset mean something else on every request.
    expect($orders)->toHaveCount(2)
        ->and($orders[0]['column'])->toContain('created_at')
        ->and($orders[1]['column'])->toContain('id')
        ->and($query->getQuery()->offset)->toBe(20)
        ->and($query->getQuery()->limit)->toBe(10)
        ->and($sql)->not->toContain('"action"');
});
