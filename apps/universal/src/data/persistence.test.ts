import { QueryClient } from '@tanstack/react-query';

import type { KeyValueStore } from '../session/storage.ts';
import {
    CACHE_MAX_AGE_MS,
    CACHE_VERSION,
    cacheStorageKey,
    clearPersistedCache,
    dehydrateAllowListed,
    persistCache,
    restoreCache,
} from './persistence.ts';
import { PERSISTABLE_QUERY_ROOTS, isPersistableQueryKey, queryKeys } from './query-keys.ts';
import { shouldRetry } from './query-client.ts';

function memoryStore(): KeyValueStore & { readonly entries: Map<string, string> } {
    const entries = new Map<string, string>();
    return {
        entries,
        get: (key) => entries.get(key) ?? null,
        set: (key, value) => {
            entries.set(key, value);
        },
        remove: (key) => {
            entries.delete(key);
        },
    };
}

async function seed(client: QueryClient, key: readonly unknown[], data: unknown) {
    await client.prefetchQuery({ queryKey: key, queryFn: () => data });
}

/** The key the pre-M1 tests implicitly used; every one of them reads in English. */
const EN_CACHE_KEY = cacheStorageKey('en');

describe('the persistence allow-list', () => {
    /**
     * Plan §21 is a privacy rule, not a performance one: authentication responses and personal data
     * must never reach disk. Asserting the *whole list* rather than individual members means adding
     * a root is a change a reviewer has to see.
     */
    it('permits exactly the reference root', () => {
        expect([...PERSISTABLE_QUERY_ROOTS]).toEqual(['reference', 'catalogue']);
    });

    it.each([
        [queryKeys.me(), false],
        [queryKeys.devices(), false],
        [queryKeys.emailVerification(), false],
        [queryKeys.locales(), true],
        // Purchase costs and margins on a tablet several people sign into (K1).
        [queryKeys.kitchenAdmin.all(), false],
        [queryKeys.kitchenAdmin.ingredients(), false],
        // A named customer's delivery address on a tablet the whole kitchen signs into.
        [queryKeys.kitchenOrders.all(), false],
        [queryKeys.kitchenOrders.list(), false],
    ] as const)('classifies %s as persistable=%s', (key, expected) => {
        expect(isPersistableQueryKey(key)).toBe(expected);
    });
});

describe('dehydrateAllowListed', () => {
    it('writes nothing when only sensitive queries are cached', async () => {
        const client = new QueryClient();
        await seed(client, queryKeys.me(), { user: { email: 'layla@example.com' } });
        await seed(client, queryKeys.devices(), []);

        expect(dehydrateAllowListed(client)).toBeNull();
    });

    it('writes the reference slice and nothing else', async () => {
        const client = new QueryClient();
        await seed(client, queryKeys.me(), { user: { email: 'layla@example.com' } });
        await seed(client, queryKeys.locales(), ['en', 'ar']);

        const snapshot = dehydrateAllowListed(client);
        expect(snapshot).not.toBeNull();
        expect(snapshot?.state.queries.map((query) => query.queryKey)).toEqual([
            queryKeys.locales(),
        ]);
        expect(JSON.stringify(snapshot)).not.toContain('layla@example.com');
    });
});

describe('persistCache', () => {
    it('mirrors allow-listed queries into the store and can be unsubscribed', async () => {
        const client = new QueryClient();
        const store = memoryStore();
        const unsubscribe = persistCache(client, store, 'en');

        await seed(client, queryKeys.locales(), ['en', 'ar']);
        expect(store.get(EN_CACHE_KEY)).not.toBeNull();

        unsubscribe();
        const before = store.get(EN_CACHE_KEY);
        await seed(client, queryKeys.me(), { user: { email: 'nobody@example.com' } });
        expect(store.get(EN_CACHE_KEY)).toBe(before);
    });

    it('never lets a personal query reach the store', async () => {
        const client = new QueryClient();
        const store = memoryStore();
        persistCache(client, store, 'en');

        await seed(client, queryKeys.me(), { user: { email: 'layla@example.com' } });
        await seed(client, queryKeys.devices(), [{ name: 'Layla iPhone' }]);

        expect(store.get(EN_CACHE_KEY)).toBeNull();
    });
});

describe('restoreCache', () => {
    it('rehydrates an allow-listed snapshot', async () => {
        const source = new QueryClient();
        const store = memoryStore();
        persistCache(source, store, 'en');
        await seed(source, queryKeys.locales(), ['en', 'ar']);

        const target = new QueryClient();
        expect(restoreCache(target, store, 'en')).toBe(true);
        expect(target.getQueryData(queryKeys.locales())).toEqual(['en', 'ar']);
    });

    it('discards a snapshot written by a different cache version', async () => {
        const store = memoryStore();
        store.set(
            EN_CACHE_KEY,
            JSON.stringify({
                version: 'h360-cache-v0',
                savedAt: Date.now(),
                state: { queries: [], mutations: [] },
            }),
        );

        expect(restoreCache(new QueryClient(), store, 'en')).toBe(false);
        expect(store.get(EN_CACHE_KEY)).toBeNull();
    });

    it('discards a snapshot older than the maximum age', async () => {
        const source = new QueryClient();
        const store = memoryStore();
        persistCache(source, store, 'en');
        await seed(source, queryKeys.locales(), ['en']);

        const later = Date.now() + CACHE_MAX_AGE_MS + 1000;
        expect(restoreCache(new QueryClient(), store, 'en', later)).toBe(false);
    });

    it('discards malformed content rather than throwing', () => {
        const store = memoryStore();
        store.set(EN_CACHE_KEY, 'not json');

        expect(restoreCache(new QueryClient(), store, 'en')).toBe(false);
        expect(store.get(EN_CACHE_KEY)).toBeNull();
    });

    /** Belt and braces: an older build might have written a root that is no longer allow-listed. */
    it('filters a snapshot that contains a root which is no longer permitted', () => {
        const store = memoryStore();
        store.set(
            EN_CACHE_KEY,
            JSON.stringify({
                version: CACHE_VERSION,
                savedAt: Date.now(),
                state: {
                    queries: [
                        {
                            queryKey: queryKeys.me(),
                            queryHash: JSON.stringify(queryKeys.me()),
                            state: { data: { secret: true }, dataUpdatedAt: Date.now() },
                        },
                    ],
                    mutations: [],
                },
            }),
        );

        const client = new QueryClient();
        restoreCache(client, store, 'en');
        expect(client.getQueryData(queryKeys.me())).toBeUndefined();
    });

    it('returns false when there is nothing stored', () => {
        expect(restoreCache(new QueryClient(), memoryStore(), 'en')).toBe(false);
    });

    it('clearPersistedCache removes every locale blob', async () => {
        const client = new QueryClient();
        const store = memoryStore();
        persistCache(client, store, 'en');
        await seed(client, queryKeys.locales(), ['en']);
        store.set(cacheStorageKey('ar'), '{}');

        clearPersistedCache(store);
        expect(store.get(EN_CACHE_KEY)).toBeNull();
        expect(store.get(cacheStorageKey('ar'))).toBeNull();
    });
});

/**
 * The M1 pre-requisite (master plan, Phase M1: "locale-aware persisted-cache key").
 *
 * From M1 a persisted public read is a page the *server* localised — one `name`, chosen from
 * `Accept-Language` (§4.8). A single storage key would hand an Arabic reader yesterday's English
 * names off disk on the next cold start.
 */
describe('the locale-keyed cache', () => {
    it('does not let one language read the other language’s blob', async () => {
        const store = memoryStore();
        const english = new QueryClient();
        persistCache(english, store, 'en');
        await seed(english, queryKeys.locales(), ['written-in-english']);

        expect(restoreCache(new QueryClient(), store, 'ar')).toBe(false);

        const arabic = new QueryClient();
        persistCache(arabic, store, 'ar');
        await seed(arabic, queryKeys.locales(), ['written-in-arabic']);

        const restoredArabic = new QueryClient();
        restoreCache(restoredArabic, store, 'ar');
        expect(restoredArabic.getQueryData(queryKeys.locales())).toEqual(['written-in-arabic']);

        // And the English blob is untouched beside it, not overwritten by the Arabic writer.
        const restoredEnglish = new QueryClient();
        restoreCache(restoredEnglish, store, 'en');
        expect(restoredEnglish.getQueryData(queryKeys.locales())).toEqual(['written-in-english']);
    });
});

describe('the query retry policy', () => {
    const failure = (code: string, retryable: boolean) => ({
        code,
        message: 'x',
        correlationId: null,
        retryable,
    });

    it.each([
        'auth.invalid_credentials',
        'auth.unauthenticated',
        'auth.step_up_required',
        'validation.failed',
        'rate_limit.exceeded',
        'context.organisation_forbidden',
    ])('never retries %s', (code) => {
        expect(shouldRetry(0, failure(code, false))).toBe(false);
    });

    it.each(['network', 'server'])('retries %s up to the limit', (code) => {
        expect(shouldRetry(0, failure(code, true))).toBe(true);
        expect(shouldRetry(1, failure(code, true))).toBe(true);
        expect(shouldRetry(2, failure(code, true))).toBe(false);
    });

    it('retries an unrecognised error, which is most likely transport-level', () => {
        expect(shouldRetry(0, new Error('socket hang up'))).toBe(true);
    });
});
