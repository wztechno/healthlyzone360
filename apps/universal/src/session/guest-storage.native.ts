import { GUEST_TOKEN_KEY, createTokenListeners } from '@healthy360/api-client';
import type { GuestTokenStore } from '@healthy360/api-client';
import * as SecureStore from 'expo-secure-store';

/**
 * Native guest-token storage (plan Phase G1).
 *
 * The same keychain the session token uses (`./storage.native.ts`), under its own key, because a
 * device has no `sessionStorage` to express "until this tab closes" with — and inventing a weaker
 * home for it would be worse, not safer: a bearer credential in an unprotected file is a bearer
 * credential in an unprotected file, whatever its intended lifetime.
 *
 * What replaces the tab boundary is the **explicit clear**. The guest identity ends on conversion,
 * on sign-in and on a deletion request, and each of those calls `clear()`; the token also carries a
 * server-side expiry measured in hours rather than weeks, so an abandoned one stops resolving
 * without anybody's help. That is a different mechanism from the web's, arriving at the same
 * promise, and it is written down here rather than left to be discovered.
 *
 * `SecureStore` has a synchronous read on both platforms, so the store is warmed once at
 * construction and every subsequent read is from memory — which is what keeps this interface
 * identical to the web implementation's.
 */
export function createAppGuestTokenStore(): GuestTokenStore {
    let cached: string | null = null;

    try {
        cached = SecureStore.getItem(GUEST_TOKEN_KEY);
    } catch {
        cached = null;
    }

    const { subscribe, notify } = createTokenListeners();

    return {
        get: () => cached,
        set: (token: string) => {
            cached = token;
            void SecureStore.setItemAsync(GUEST_TOKEN_KEY, token).catch(() => {
                /* Memory-only until the app restarts. */
            });
            notify();
        },
        clear: () => {
            cached = null;
            void SecureStore.deleteItemAsync(GUEST_TOKEN_KEY).catch(() => {
                /* Nothing further to do. */
            });
            notify();
        },
        subscribe,
    };
}

/**
 * The one guest token store this application has, on this platform.
 *
 * Metro resolves this file instead of `./guest-storage.ts`, so the constant has to exist in both
 * halves of the pair or the import resolves to nothing on iOS and Android. See the web half for why
 * it is a module-scope singleton at all: subscribers survive, and the repository bundle and the
 * hooks then read and write the same store.
 */
export const appGuestTokenStore: GuestTokenStore = createAppGuestTokenStore();

export type { GuestTokenStore };
