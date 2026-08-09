/**
 * Cursor pagination, shared by every listing in the prototype contracts.
 *
 * Cursors rather than page numbers, for one reason: the marketplace and the planner both list data
 * that changes while a person is scrolling it. Offset pagination silently repeats and skips rows
 * when that happens, and an infinite list that occasionally shows the same meal twice is the kind
 * of defect nobody can reproduce. The cursor is opaque — the client stores it and sends it back,
 * and never parses, compares or constructs one.
 *
 * The wire form follows `docs/api/conventions.md`: items arrive in `data`, and the cursor and
 * counts arrive in `meta`.
 */

export interface CursorPageRequest {
    /** `meta.next_cursor` from the previous response. Omitted for the first page. */
    readonly cursor?: string | undefined;
    /** Page size hint. The server may return fewer; it never returns more. */
    readonly limit?: number | undefined;
}

export interface CursorPage<T> {
    readonly items: readonly T[];
    /** `null` on the last page. */
    readonly nextCursor: string | null;
    readonly hasMore: boolean;
    /** Total matching rows when the server can count them cheaply; `null` otherwise. */
    readonly totalCount: number | null;
}

/**
 * Numbered pages, for the kitchen's own catalogue and for nothing else.
 *
 * Everything above is still the rule, and it still governs the order book and every marketplace
 * collection. What makes these seven screens different is set out in `docs/api/conventions.md` and
 * enforced by which endpoints accept `page` at all: they are edited by the staff of one kitchen,
 * occasionally and deliberately, so the concurrent write that makes offset skip and repeat is rare
 * rather than continuous — and a cook hunting through nine hundred ingredients needs to *jump*,
 * which a cursor cannot do at all.
 *
 * ## Why the response is still a `CursorPage`
 *
 * The server answers a numbered request with a different `meta` — `page`, `per_page`, `total_count`
 * and `total_pages` in place of the cursor fields. A second response type for it would earn
 * nothing: `page` and `per_page` are what the caller just sent, and `total_pages` is
 * `ceil(totalCount / perPage)`, so the only field a numbered page carries that a `CursorPage` does
 * not is one the caller can compute. {@link pageCount} does that computation in one place.
 *
 * What the two fields mean on a numbered page: `nextCursor` is `null`, because a numbered page has
 * no cursor to hand out and a caller that sent `page` is not walking; `hasMore` keeps its meaning
 * exactly — whether a page after this one exists.
 */
export interface OffsetPageRequest {
    /** 1-based. Omitted means the caller wants the keyset walk, not a page. */
    readonly page?: number | undefined;
    /** Rows per page. The server accepts `limit` as a synonym; prefer this one. */
    readonly perPage?: number | undefined;
}

/**
 * How many pages a result spans, given the size asked for.
 *
 * `0` for an empty collection rather than `1`, so nothing renders "page 1 of 0" — an empty list is
 * its own state and does not need a page control at all. `null` when the server could not count,
 * which is the honest answer for a collection that only offers a cursor.
 */
export function pageCount(totalCount: number | null, perPage: number): number | null {
    if (totalCount === null) return null;
    if (totalCount <= 0) return 0;
    return Math.ceil(totalCount / Math.max(1, perPage));
}

/** Sort direction, for the listings that expose one. */
export const SORT_DIRECTIONS = ['asc', 'desc'] as const;
export type SortDirection = (typeof SORT_DIRECTIONS)[number];

/** An inclusive numeric filter band, used by the calorie, macro, price and time filters. */
export interface NumericRangeFilter {
    readonly min?: number | undefined;
    readonly max?: number | undefined;
}

/** The empty page, so a repository can answer "nothing" without constructing the shape by hand. */
export function emptyPage<T>(): CursorPage<T> {
    return { items: [], nextCursor: null, hasMore: false, totalCount: 0 };
}
