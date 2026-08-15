import { LOCALES, PSEUDO_LOCALE } from '@healthy360/domain-types';
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
 *
 * **The stored blob is keyed by locale** (`h360.query-cache.ar`), and that is the M1 pre-requisite
 * rather than a tidy-up. Until M1 every persisted query answered from a fixture world that carried
 * both languages and picked one in the component. A real marketplace read does not: the server
 * localises on `Accept-Language` and sends **one** `name` (§4.8), so the cached page *is* a page in
 * one language. A single key would let an Arabic reader restore yesterday's English names from disk
 * and show them until the refetch landed — a stale-language flash on exactly the screens M1 makes
 * real. Keying by locale makes the two caches different objects, which is what they always were.
 *
 * Nothing migrates the pre-M1 unsuffixed blob. It is at most a day of cached public reads, it is
 * discarded by `CACHE_MAX_AGE_MS` anyway, and a migration would have to guess which language it was
 * written in — which is the guess this change exists to remove.
 */
export const CACHE_VERSION = 'h360-cache-v1';
export const CACHE_KEY_PREFIX = 'h360.query-cache';
export const CACHE_MAX_AGE_MS = 24 * 60 * 60 * 1000;

/**
 * Where one locale's cache lives.
 *
 * The locale is taken verbatim from the i18n instance rather than narrowed to `Locale`: the
 * development pseudo-locale (`en-XA`) is a real language a person can be reading in, and giving it
 * the English blob would defeat the expansion stress test it exists for.
 */
export function cacheStorageKey(locale: string): string {
    return `${CACHE_KEY_PREFIX}.${locale}`;
}

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

/** Restores the given locale's stored cache, discarding anything stale, foreign or malformed. */
export function restoreCache(
    client: QueryClient,
    store: KeyValueStore,
    locale: string,
    now = Date.now(),
): boolean {
    const key = cacheStorageKey(locale);
    const raw = store.get(key);
    if (raw === null) return false;

    let parsed: PersistedCache;
    try {
        parsed = JSON.parse(raw) as PersistedCache;
    } catch {
        store.remove(key);
        return false;
    }

    if (parsed?.version !== CACHE_VERSION || now - parsed.savedAt > CACHE_MAX_AGE_MS) {
        store.remove(key);
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
 * Subscribes to the cache and writes the allow-listed slice on every change, under the given
 * locale's key.
 *
 * Returns an unsubscribe function; callers must call it, or a torn-down client keeps writing — and
 * after a language change, keeps writing the new language's data under the old language's key.
 */
export function persistCache(
    client: QueryClient,
    store: KeyValueStore,
    locale: string,
): () => void {
    const key = cacheStorageKey(locale);

    const write = () => {
        const snapshot = dehydrateAllowListed(client);
        if (snapshot === null) {
            store.remove(key);
            return;
        }
        store.set(key, JSON.stringify(snapshot));
    };

    return client.getQueryCache().subscribe(write);
}

/**
 * Called on sign-out: anything cached under the previous identity goes — in **every** language.
 *
 * A person who read the catalogue in Arabic, switched to English and then signed out must not leave
 * an Arabic blob behind, and `KeyValueStore` cannot be enumerated. The product locales plus the
 * development pseudo-locale are therefore cleared explicitly; that list is short, closed, and the
 * same one `cacheStorageKey` is ever called with.
 */
export function clearPersistedCache(
    store: KeyValueStore,
    locales: readonly string[] = [...LOCALES, PSEUDO_LOCALE],
): void {
    for (const locale of locales) {
        store.remove(cacheStorageKey(locale));
    }
}
