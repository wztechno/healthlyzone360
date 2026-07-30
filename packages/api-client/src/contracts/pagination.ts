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
