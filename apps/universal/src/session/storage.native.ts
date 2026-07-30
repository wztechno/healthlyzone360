import { createTokenListeners } from '@healthy360/api-client';
import type { SessionTokenStore } from '@healthy360/api-client';
import * as SecureStore from 'expo-secure-store';

import type { KeyValueStore } from './storage.ts';

/**
 * Native session-token storage.
 *
 * The token goes into the platform keychain (`expo-secure-store`), which is the only place on a
 * device where a bearer credential belongs. Everything else about the session — user, profile,
 * memberships — stays in memory (plan §21: authentication responses are never persisted).
 *
 * `SecureStore` has a synchronous API on both platforms, so the store is warmed once at
 * construction and every subsequent read is from memory. That keeps the interface identical to the
 * web implementation, which is what lets `createRepositories` take one token store and not care.
 */
export const SESSION_TOKEN_KEY = 'h360.session-token';

export function createSessionTokenStore(): SessionTokenStore {
    let cached: string | null = null;

    try {
        cached = SecureStore.getItem(SESSION_TOKEN_KEY);
    } catch {
        cached = null;
    }

    const { subscribe, notify } = createTokenListeners();

    return {
        get: () => cached,
        set: (token: string) => {
            cached = token;
            void SecureStore.setItemAsync(SESSION_TOKEN_KEY, token).catch(() => {
                /* Memory-only until the app restarts. */
            });
            notify();
        },
        clear: () => {
            cached = null;
            void SecureStore.deleteItemAsync(SESSION_TOKEN_KEY).catch(() => {
                /* Nothing further to do. */
            });
            notify();
        },
        subscribe,
    };
}

/**
 * Non-sensitive key/value storage.
 *
 * Deliberately **in memory only** on native. The web build can lean on `localStorage` because a
 * browser profile is already the user's own; on a device, adding a second on-disk store for cache
 * data would need its own retention and wipe story, which plan §21 says not to open yet.
 */
export function createKeyValueStore(): KeyValueStore {
    const memory = new Map<string, string>();
    return {
        get: (key) => memory.get(key) ?? null,
        set: (key, value) => {
            memory.set(key, value);
        },
        remove: (key) => {
            memory.delete(key);
        },
    };
}
