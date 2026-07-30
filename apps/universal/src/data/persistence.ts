import { dehydrate, hydrate } from '@tanstack/react-query';
import type { QueryClient } from '@tanstack/react-query';

import type { KeyValueStore } from '../session/storage.ts';
import { isPersistableQueryKey } from './query-keys.ts';

/**
 * Minimal, allow-listed query persistence (plan §21).
 *
 * Written by hand rather than with `@tanstack/react-query-persist-client` for one reason: the
 * off-the-shelf persister's default is *persist everything, then filter*, and the privacy rule here
 * is the opposite — nothing is written unless its query root is on the allow-list. Inverting that
 * default is worth thirty lines.
 *
 * `CACHE_VERSION` is the buster. Any change to a persisted shape bumps it, and the stored blob is
 * discarded rather than hydrated into components that no longer understand it.
 */
export const CACHE_VERSION = 'h360-cache-v1';
export const CACHE_STORAGE_KEY = 'h360.query-cache';
export const CACHE_MAX_AGE_MS = 24 * 60 * 60 * 1000;

interface PersistedCache {
    readonly version: string;
    readonly savedAt: number;
    readonly state: ReturnType<typeof dehydrate>;
}

/** Serialises only the allow-listed queries. Returns `null` when there is nothing to store. */
export function dehydrateAllowListed(client: QueryClient): PersistedCache | null {
    const state = dehydrate(client, {
        shouldDehydrateQuery: (query) =>
            query.state.status === 'success' && isPersistableQueryKey(query.queryKey),
        shouldDehydrateMutation: () => false,
    });

    if (state.queries.length === 0) return null;
    return { version: CACHE_VERSION, savedAt: Date.now(), state };
}

/** Restores a previously stored cache, discarding anything stale, foreign or malformed. */
export function restoreCache(client: QueryClient, store: KeyValueStore, now = Date.now()): boolean {
    const raw = store.get(CACHE_STORAGE_KEY);
    if (raw === null) return false;

    let parsed: PersistedCache;
    try {
        parsed = JSON.parse(raw) as PersistedCache;
    } catch {
        store.remove(CACHE_STORAGE_KEY);
        return false;
    }

    if (parsed?.version !== CACHE_VERSION || now - parsed.savedAt > CACHE_MAX_AGE_MS) {
        store.remove(CACHE_STORAGE_KEY);
        return false;
    }

    // Belt and braces: a blob written by an older build could contain a root that is no longer
    // allow-listed, so the filter is applied on the way in as well as on the way out.
    const queries = (parsed.state.queries ?? []).filter((query) =>
        isPersistableQueryKey(query.queryKey),
    );
    hydrate(client, { ...parsed.state, queries, mutations: [] });
    return true;
}

/**
 * Subscribes to the cache and writes the allow-listed slice on every change.
 *
 * Returns an unsubscribe function; callers must call it, or a torn-down client keeps writing.
 */
export function persistCache(client: QueryClient, store: KeyValueStore): () => void {
    const write = () => {
        const snapshot = dehydrateAllowListed(client);
        if (snapshot === null) {
            store.remove(CACHE_STORAGE_KEY);
            return;
        }
        store.set(CACHE_STORAGE_KEY, JSON.stringify(snapshot));
    };

    return client.getQueryCache().subscribe(write);
}

/** Called on sign-out: anything cached under the previous identity goes. */
export function clearPersistedCache(store: KeyValueStore): void {
    store.remove(CACHE_STORAGE_KEY);
}
