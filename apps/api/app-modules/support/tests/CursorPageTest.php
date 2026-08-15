<?php

declare(strict_types=1);

use Carbon\CarbonImmutable;
use Healthy360\Audit\Models\AuditLog;
use Healthy360\Support\Api\CursorPage;
use Healthy360\Support\Api\ErrorCode;
use Healthy360\Support\Api\Exceptions\ApiException;
use Illuminate\Database\Eloquent\Collection;
use Illuminate\Http\Request;

/*
|--------------------------------------------------------------------------
| The cursor codec
|--------------------------------------------------------------------------
|
| The cursor is the only part of the pagination contract a client holds on to
| between requests, so it has to survive a round trip exactly and it has to
| refuse anything it did not issue. A cursor that silently degraded to
| "start again" would turn a client bug into an infinite loop that looks like
| a working list.
|
*/

/**
 * A request carrying query parameters, as the framework would build one.
 *
 * @param  array<string, string>  $query
 */
function cursorRequest(array $query): Request
{
    return Request::create('/api/v1/catalogue/ingredients', 'GET', $query);
}

/**
 * A collection standing in for a query result, ordered as `constrain()`
 * would have ordered it.
 *
 * @return Collection<int, AuditLog>
 */
function cursorRows(int $count): Collection
{
    $rows = new Collection;

    for ($index = 0; $index < $count; $index++) {
        $row = new AuditLog;
        $row->forceFill([
            'id' => sprintf('0198c5f2-7d3a-7b1e-9c4d-2f6a8b0e1d%02d', $index),
            'created_at' => CarbonImmutable::parse('2026-08-02T10:00:00+00:00')->addSeconds($index),
        ]);

        $rows->push($row);
    }

    return $rows;
}

it('round-trips a timestamp and an identifier through base64url', function (): void {
    $encoded = CursorPage::base64UrlEncode('2026-08-02T10:11:12.123456+00:00|0198c5f2-7d3a-7b1e-9c4d-2f6a8b0e1d3c');

    expect(CursorPage::decode($encoded))->toBe([
        '2026-08-02T10:11:12.123456+00:00',
        '0198c5f2-7d3a-7b1e-9c4d-2f6a8b0e1d3c',
    ]);
});

it('produces url-safe cursors with no padding', function (): void {
    $encoded = CursorPage::base64UrlEncode('2026-08-02T10:11:12.123456+00:00|0198c5f2-7d3a-7b1e-9c4d-2f6a8b0e1d3c');

    expect($encoded)->toMatch('/^[A-Za-z0-9\-_]+$/');
});

it('refuses a cursor it did not issue', function (string $cursor): void {
    expect(fn () => CursorPage::decode($cursor))
        ->toThrow(function (ApiException $exception): void {
            expect($exception->errorCode)->toBe(ErrorCode::RequestInvalid)
                ->and($exception->status())->toBe(400)
                ->and($exception->details)->toBe(['parameter' => 'cursor']);
        });
})->with([
    'not base64url at all' => ['not a cursor!'],
    'base64url of nonsense' => [CursorPage::base64UrlEncode('nonsense')],
    'no identifier' => [CursorPage::base64UrlEncode('2026-08-02T10:11:12.123456+00:00|')],
    'no timestamp' => [CursorPage::base64UrlEncode('|0198c5f2-7d3a-7b1e-9c4d-2f6a8b0e1d3c')],
    // strtotime() would happily parse this; it is still not a cursor this
    // endpoint issued, and the codec says so.
    'a relative timestamp' => [CursorPage::base64UrlEncode('yesterday|0198c5f2-7d3a-7b1e-9c4d-2f6a8b0e1d3c')],
    'a timestamp with no zone' => [CursorPage::base64UrlEncode('2026-08-02T10:11:12|0198c5f2-7d3a-7b1e-9c4d-2f6a8b0e1d3c')],
    'too many separators' => [CursorPage::base64UrlEncode('a|b|c')],
]);

it('defaults the limit and accepts the documented range', function (): void {
    expect(CursorPage::limit(cursorRequest([])))->toBe(CursorPage::DEFAULT_LIMIT)
        ->and(CursorPage::limit(cursorRequest(['limit' => ''])))->toBe(CursorPage::DEFAULT_LIMIT)
        ->and(CursorPage::limit(cursorRequest(['limit' => '1'])))->toBe(1)
        ->and(CursorPage::limit(cursorRequest(['limit' => '100'])))->toBe(CursorPage::MAX_LIMIT);
});

it('rejects a limit outside the documented range', function (string $limit): void {
    expect(fn () => CursorPage::limit(cursorRequest(['limit' => $limit])))
        ->toThrow(function (ApiException $exception): void {
            expect($exception->errorCode)->toBe(ErrorCode::RequestInvalid)
                ->and($exception->details)->toBe(['parameter' => 'limit']);
        });
})->with([
    'zero' => ['0'],
    'over the maximum' => ['101'],
    'negative' => ['-5'],
    'not a number' => ['many'],
    'a float' => ['2.5'],
]);

it('treats an absent cursor as the first page', function (): void {
    expect(CursorPage::cursor(cursorRequest([])))->toBeNull()
        ->and(CursorPage::cursor(cursorRequest(['cursor' => ''])))->toBeNull();
});

it('trims the extra row and points the next cursor at the last item kept', function (): void {
    // Six rows fetched for a page of five: the sixth exists only to answer
    // has_more, and must not reach the client or the cursor.
    $page = CursorPage::page(cursorRows(6), 5);

    expect($page['items'])->toHaveCount(5)
        ->and($page['meta']['count'])->toBe(5)
        ->and($page['meta']['has_more'])->toBeTrue()
        ->and(CursorPage::decode((string) $page['meta']['next_cursor'])[1])
        ->toBe('0198c5f2-7d3a-7b1e-9c4d-2f6a8b0e1d04');
});

it('closes the page when no extra row came back', function (): void {
    $page = CursorPage::page(cursorRows(3), 5);

    expect($page['items'])->toHaveCount(3)
        ->and($page['meta']['has_more'])->toBeFalse()
        ->and($page['meta']['next_cursor'])->toBeNull();
});

it('closes an empty page without a cursor to nowhere', function (): void {
    $page = CursorPage::page(cursorRows(0), 5);

    expect($page['items'])->toHaveCount(0)
        ->and($page['meta'])->toBe(['count' => 0, 'next_cursor' => null, 'has_more' => false]);
});
