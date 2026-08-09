<?php

declare(strict_types=1);

namespace Healthy360\Support\Api;

use Healthy360\Support\Api\Exceptions\ApiException;
use Illuminate\Database\Eloquent\Builder as EloquentBuilder;
use Illuminate\Database\Eloquent\Collection as EloquentCollection;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Http\Request;

/**
 * Numbered pages for the kitchen's own catalogue, and for nothing else.
 *
 * {@see CursorPage} states the rule this class breaks: collections paginate by keyset, never by
 * offset, because `LIMIT/OFFSET` silently skips and repeats rows when a collection is written while
 * it is being walked. That reasoning is correct and still governs every other endpoint.
 *
 * It does not govern these five. `docs/api/conventions.md` carries the exception in full; the short
 * version is that they are edited by the staff of one kitchen, occasionally and deliberately, so the
 * concurrent write the rule guards against is rare rather than continuous — and that what offset
 * buys is the ability to *jump*, which keyset cannot offer at all. A kitchen with nine hundred
 * ingredients hunting for one cannot press Next thirty times to reach it.
 *
 * The order book and the marketplace keep keyset. They are written whenever a customer checks out,
 * which is exactly the case the rule exists for.
 *
 * ## It is additive
 *
 * An endpoint using this still emits `next_cursor` and `has_more` from {@see CursorPage}. A client
 * that has never heard of `page` walks it exactly as before. That is deliberate: the frontend
 * migrates a screen at a time, and a flag day across seven endpoints and their callers is a bad
 * trade for a query parameter.
 *
 * ## The count is separate, and honest about it
 *
 * `total_pages` needs a `COUNT`, which is the second query `CursorPage::page()` avoids on purpose —
 * its `has_more` reads one row beyond the page so the answer cannot disagree with the page it
 * describes. Here the count and the page genuinely can disagree under a concurrent write, and the
 * page count is allowed to be a moment stale: a page control that says "of 12" when a thirteenth
 * page appeared mid-browse is a much smaller problem than a control that cannot say "of" at all.
 */
final class OffsetPage
{
    public const int DEFAULT_PER_PAGE = 25;

    public const int MAX_PER_PAGE = 100;

    /**
     * Order, offset and limit the query for a page.
     *
     * The ordering is `(created_at, id)` — the same pair the keyset walks — so a client that mixes
     * `page` and `cursor` against one endpoint sees one order, not two. `reorder()` first, for the
     * same reason {@see CursorPage::constrain()} does it: a caller's default scope ordering would
     * otherwise sit in front and make the offset mean something else on every request.
     *
     * @param  EloquentBuilder<covariant Model>  $query
     */
    public static function constrain(EloquentBuilder $query, int $page, int $perPage, bool $newestFirst = false): void
    {
        $model = $query->getModel();
        $createdAt = $model->qualifyColumn($model->getCreatedAtColumn() ?? 'created_at');
        $key = $model->qualifyColumn($model->getKeyName());
        $direction = $newestFirst ? 'desc' : 'asc';

        $query->reorder();
        $query->orderBy($createdAt, $direction)
            ->orderBy($key, $direction)
            ->forPage($page, $perPage);
    }

    /**
     * Describe the page.
     *
     * `$total` is the caller's `COUNT` of the *unpaged* query — taken before `constrain()`, since a
     * constrained builder counts the page rather than the collection.
     *
     * @template TItem of Model
     *
     * @param  EloquentCollection<int, TItem>  $rows
     * @return array{count: int, page: int, per_page: int, total_count: int, total_pages: int}
     */
    public static function meta(EloquentCollection $rows, int $page, int $perPage, int $total): array
    {
        return [
            'count' => $rows->count(),
            'page' => $page,
            'per_page' => $perPage,
            'total_count' => $total,
            // Zero rather than one on an empty collection, so nothing renders "page 1 of 0".
            'total_pages' => $total === 0 ? 0 : (int) ceil($total / $perPage),
        ];
    }

    /**
     * The requested page, 1-based. Absent means the caller is not using numbered pages at all.
     *
     * @throws ApiException
     */
    public static function page(Request $request): ?int
    {
        $raw = $request->query('page');

        if ($raw === null || $raw === '') {
            return null;
        }

        if (! is_string($raw) || preg_match('/^\d+$/', $raw) !== 1) {
            throw self::invalid('page', 'The page must be a whole number of 1 or more.');
        }

        $page = (int) $raw;

        if ($page < 1) {
            throw self::invalid('page', 'The page must be a whole number of 1 or more.');
        }

        return $page;
    }

    /**
     * @throws ApiException
     */
    public static function perPage(Request $request): int
    {
        // `per_page` is the numbered-page spelling of `limit`, and either is accepted so a caller
        // does not have to change which word it sends when it starts asking for a page.
        $raw = $request->query('per_page') ?? $request->query('limit');

        if ($raw === null || $raw === '') {
            return self::DEFAULT_PER_PAGE;
        }

        if (! is_string($raw) || preg_match('/^\d+$/', $raw) !== 1) {
            throw self::invalid('per_page', 'The page size must be a whole number between 1 and '.self::MAX_PER_PAGE.'.');
        }

        $perPage = (int) $raw;

        if ($perPage < 1 || $perPage > self::MAX_PER_PAGE) {
            throw self::invalid('per_page', 'The page size must be a whole number between 1 and '.self::MAX_PER_PAGE.'.');
        }

        return $perPage;
    }

    /**
     * A page past the end is a client bug, answered rather than served as an empty list.
     *
     * An empty *collection* is not: page 1 of an empty catalogue is a legitimate request with a
     * legitimate empty answer, and refusing it would make "you have no ingredients yet" an error
     * state.
     *
     * @throws ApiException
     */
    public static function assertWithinRange(int $page, int $perPage, int $total): void
    {
        if ($total === 0) {
            return;
        }

        $lastPage = (int) ceil($total / $perPage);

        if ($page > $lastPage) {
            throw self::invalid('page', 'The collection has '.$lastPage.' page'.($lastPage === 1 ? '' : 's').'.');
        }
    }

    private static function invalid(string $parameter, string $message): ApiException
    {
        return new ApiException(ErrorCode::RequestInvalid, $message, ['parameter' => $parameter]);
    }
}
