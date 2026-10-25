import type { PublishableStatus } from '@healthy360/api-client/contracts';
import { useQueryClient } from '@tanstack/react-query';
import type { Dispatch, SetStateAction } from 'react';
import { useCallback, useEffect, useMemo, useState } from 'react';

import { useListPage } from './use-list-page.ts';

/**
 * Where each admin list was left — its search, its filters, its page and the row last opened — so
 * coming back to it finds it as it was.
 *
 * The kitchen layout is a `<Slot/>`: leaving a list for a record unmounts it, and `useState` starts
 * over on the way back. Browser Back, a Back button and the sidebar all rebuilt the list on its
 * defaults, page one, nothing marked — and the reader had to find their place again.
 *
 * ## Scoped to the data cache, not to the module
 *
 * One memory per `QueryClient`. In the app that is the tab's one client, so this is a plain
 * per-tab store; nothing is written to disk. The scope buys two things a bare module map would not:
 * every test renders with a fresh client, so a search typed in one test never filters the next;
 * and a new client starts with nothing remembered. Clearing the cache does not reach it, so
 * {@link forgetListMemory} drops every scope at once — the sign-out hook.
 *
 * ## Read once, written through
 *
 * A list reads its memory as it mounts and never again: the state it renders from is its own
 * `useState`, seeded from the memory. Every change is written back as it is committed, so the
 * memory always holds the last thing the reader saw.
 */
export interface ListMemoryEntry {
    readonly query: string;
    /** Every other control the list keeps — segments, column filters, sort. Plain values only. */
    readonly filters: Readonly<Record<string, unknown>>;
    readonly page: number;
    /** The row the reader last opened, by the key the list draws it under. */
    readonly lastOpenedId: string | null;
}

/** A partial write. `filters` is merged name by name rather than replaced. */
export interface ListMemoryPatch {
    readonly query?: string | undefined;
    readonly filters?: Readonly<Record<string, unknown>> | undefined;
    readonly page?: number | undefined;
    readonly lastOpenedId?: string | null | undefined;
}

const BLANK: ListMemoryEntry = { query: '', filters: {}, page: 1, lastOpenedId: null };

let scopes = new WeakMap<object, Map<string, ListMemoryEntry>>();

function scopeOf(owner: object): Map<string, ListMemoryEntry> {
    const existing = scopes.get(owner);
    if (existing !== undefined) return existing;
    const created = new Map<string, ListMemoryEntry>();
    scopes.set(owner, created);
    return created;
}

/** What `listKey` was left with under `owner`, or the blank entry for a list never visited. */
export function readListMemory(owner: object, listKey: string): ListMemoryEntry {
    return scopes.get(owner)?.get(listKey) ?? BLANK;
}

export function writeListMemory(owner: object, listKey: string, patch: ListMemoryPatch): void {
    const scope = scopeOf(owner);
    const current = scope.get(listKey) ?? BLANK;
    scope.set(listKey, {
        query: patch.query ?? current.query,
        filters:
            patch.filters === undefined
                ? current.filters
                : { ...current.filters, ...patch.filters },
        page: patch.page ?? current.page,
        lastOpenedId: patch.lastOpenedId === undefined ? current.lastOpenedId : patch.lastOpenedId,
    });
}

/** Forgets every list in every scope — for sign-out: the positions belonged to that session. */
export function forgetListMemory(): void {
    scopes = new WeakMap();
}

export interface ListMemory {
    readonly listKey: string;
    /** What the list was left with, read once as it mounted. */
    readonly initial: ListMemoryEntry;
    readonly remember: (patch: ListMemoryPatch) => void;
}

export interface ListMemoryOptions {
    /**
     * Start from the list's defaults rather than from where it was left, and still remember from
     * here on — for a list opened by a deep link, whose link is the question being asked.
     */
    readonly fresh?: boolean | undefined;
}

/**
 * The memory of one list. `listKey` names the list, not the screen — `kitchen.ingredients`,
 * `kitchen.supply-orders.proposals` — so two lists on one page keep two places.
 */
export function useListMemory(listKey: string, options: ListMemoryOptions = {}): ListMemory {
    const owner = useQueryClient();
    const fresh = options.fresh === true;
    // Read once: the list renders from its own state after this, and a re-read on every render
    // would hand back what the list itself just wrote.
    const [initial] = useState(() => (fresh ? BLANK : readListMemory(owner, listKey)));

    return useMemo(
        () => ({
            listKey,
            initial,
            remember: (patch: ListMemoryPatch) => {
                writeListMemory(owner, listKey, patch);
            },
        }),
        [owner, listKey, initial],
    );
}

/**
 * `useState` for one remembered value: seeded from the memory, written back once committed.
 *
 * Written in an effect rather than in the setter, so the setter is React's own — functional
 * updates included — and a call site swaps `useState(x)` for this without changing anything else.
 */
function useWrittenThrough<T>(
    initial: T,
    write: (value: T) => void,
): readonly [T, Dispatch<SetStateAction<T>>] {
    const [value, setValue] = useState<T>(initial);
    useEffect(() => {
        write(value);
    }, [value, write]);
    return [value, setValue];
}

/** The search box. */
export function useRememberedQuery(
    memory: ListMemory,
): readonly [string, Dispatch<SetStateAction<string>>] {
    const { remember } = memory;
    const write = useCallback(
        (query: string) => {
            remember({ query });
        },
        [remember],
    );
    return useWrittenThrough(memory.initial.query, write);
}

/**
 * One filter, segment or sort, under `name`. `fallback` is the list's own default, used the first
 * time and whenever nothing was remembered under that name.
 *
 * The stored value is the one this same call wrote, so it is read back as `T` without a parse.
 */
export function useRememberedFilter<T>(
    memory: ListMemory,
    name: string,
    fallback: T,
): readonly [T, Dispatch<SetStateAction<T>>] {
    const { remember } = memory;
    const write = useCallback(
        (value: T) => {
            remember({ filters: { [name]: value } });
        },
        [remember, name],
    );
    const stored = memory.initial.filters;
    return useWrittenThrough(name in stored ? (stored[name] as T) : fallback, write);
}

/**
 * `useListPage` starting on the remembered page. A filter change still resets to page one, and
 * that is remembered too — so the list never comes back on a page its filter no longer has.
 */
export function useRememberedPage(
    memory: ListMemory,
    resetKey: unknown,
): readonly [number, (page: number) => void] {
    const [page, setPage] = useListPage(resetKey, memory.initial.page);
    const { remember } = memory;
    useEffect(() => {
        remember({ page });
    }, [remember, page]);
    return [page, setPage];
}

/**
 * The row the reader opened last — the one the list marks when they come back to it.
 *
 * Written the moment it is called, not after a commit: opening a record navigates away, and the
 * list may be gone before an effect would have run.
 */
export function useRememberedOpened(
    memory: ListMemory,
): readonly [string | null, (id: string) => void] {
    const [opened, setOpened] = useState<string | null>(memory.initial.lastOpenedId);
    const { remember } = memory;
    const open = useCallback(
        (id: string) => {
            remember({ lastOpenedId: id });
            setOpened(id);
        },
        [remember],
    );
    return [opened, open];
}

/** One frozen empty status set, so "no status" keeps one identity across renders. */
const NO_STATUSES: readonly PublishableStatus[] = [];

/**
 * `useCatalogueFilters`, remembered — the search box and the status set every catalogue list has,
 * in the same shape, so a list hook swaps one call for the other.
 */
export function useRememberedCatalogueFilters(memory: ListMemory) {
    const [query, setQuery] = useRememberedQuery(memory);
    const [statuses, setStatuses] = useRememberedFilter(memory, 'statuses', NO_STATUSES);
    const trimmed = query.trim();

    return {
        query,
        setQuery,
        trimmed,
        statuses,
        setStatuses,
        isUnfiltered: trimmed === '' && statuses.length === 0,
        clear: () => {
            setQuery('');
            setStatuses(NO_STATUSES);
        },
    };
}

/**
 * A page number the screen keeps itself — a cursor-paged book, or a whole set paged on the client —
 * starting where it was left. No reset here: the screen already resets it with its filters.
 */
export function useRememberedPageNumber(
    memory: ListMemory,
): readonly [number, Dispatch<SetStateAction<number>>] {
    const { remember } = memory;
    const write = useCallback(
        (page: number) => {
            remember({ page });
        },
        [remember],
    );
    return useWrittenThrough(memory.initial.page, write);
}

/**
 * A restored page the list no longer has — rows archived since, a filter that now matches fewer —
 * is refused by the server (`OffsetPage::assertWithinRange`), and the reader would come back to an
 * error where their list was. So a failure *on the page that was restored* goes back to page one,
 * adjusted during render like `useListPage`'s own reset. Page one never falls back: its failure is
 * a real one, and the list's error state says so.
 */
export function useRestoredPageFallback(
    memory: ListMemory,
    page: number,
    failed: boolean,
    toFirstPage: () => void,
): void {
    if (failed && page > 1 && page === memory.initial.page) toFirstPage();
}
