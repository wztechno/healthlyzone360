import { createTokenListeners } from '@healthy360/api-client';
import type { SessionTokenStore } from '@healthy360/api-client';

/**
 * Web session-token storage.
 *
 * The token lives in `localStorage` **and** in memory. `localStorage` is what makes a page reload
 * restore the session; the memory copy is the one every read actually uses, so a storage exception
 * (private browsing, a blocked origin, a quota error) degrades to a session that works until the
 * tab closes rather than to a screen that cannot sign in at all.
 *
 * Only the opaque token is stored — never the user, the profile, the memberships or any other part
 * of an authentication response (plan §21).
 *
 * Metro resolves `storage.native.ts` on iOS and Android; this file is the web and Node
 * implementation.
 */
export const SESSION_TOKEN_KEY = 'h360.session-token';

function readWebStorage(): Storage | null {
    try {
        if (typeof globalThis === 'undefined') return null;
        const candidate = (globalThis as { localStorage?: Storage }).localStorage;
        return candidate ?? null;
    } catch {
        return null;
    }
}

export function createSessionTokenStore(): SessionTokenStore {
    const storage = readWebStorage();
    let cached: string | null = null;

    try {
        cached = storage?.getItem(SESSION_TOKEN_KEY) ?? null;
    } catch {
        cached = null;
    }

    const { subscribe, notify } = createTokenListeners();

    return {
        get: () => cached,
        set: (token: string) => {
            cached = token;
            try {
                storage?.setItem(SESSION_TOKEN_KEY, token);
            } catch {
                /* Memory-only for the rest of this tab's life. */
            }
            notify();
        },
        clear: () => {
            cached = null;
            try {
                storage?.removeItem(SESSION_TOKEN_KEY);
            } catch {
                /* Nothing more can be done; the memory copy is already gone. */
            }
            notify();
        },
        subscribe,
    };
}

/** Generic key/value persistence for non-sensitive data (the query cache allow-list). */
export interface KeyValueStore {
    get(key: string): string | null;
    set(key: string, value: string): void;
    remove(key: string): void;
}

export function createKeyValueStore(): KeyValueStore {
    const storage = readWebStorage();
    const memory = new Map<string, string>();

    return {
        get: (key) => {
            try {
                return storage?.getItem(key) ?? memory.get(key) ?? null;
            } catch {
                return memory.get(key) ?? null;
            }
        },
        set: (key, value) => {
            memory.set(key, value);
            try {
                storage?.setItem(key, value);
            } catch {
                /* Non-sensitive cache only — losing it costs a refetch. */
            }
        },
        remove: (key) => {
            memory.delete(key);
            try {
                storage?.removeItem(key);
            } catch {
                /* Ignored for the same reason. */
            }
        },
    };
}
