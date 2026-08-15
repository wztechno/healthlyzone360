import { createTokenListeners } from '../contracts/session.ts';

/**
 * Where the opaque **guest** token lives between calls (plan Phase G1).
 *
 * A second credential with a second lifetime, deliberately not the session token store. They differ
 * in three ways that matter, and every one of them is a reason a shared store would be wrong:
 *
 * 1. **Where it is written.** A session token survives a browser restart (`localStorage`); a guest
 *    token must not (`sessionStorage`). The device a guest orders from is frequently not their own
 *    — a shared laptop, a family tablet, a phone handed over at a counter — and a token that
 *    outlives the tab hands the next person a basket, an address and a phone number belonging to
 *    somebody who never made an account and cannot sign in to clear it.
 * 2. **How long it is worth anything.** A guest session expires in hours, not weeks.
 * 3. **What clears it.** Signing in, converting to an account, and requesting deletion all end the
 *    guest identity. Sharing one store would make each of those either clear too much or too
 *    little.
 *
 * The interface is the same four methods as {@link SessionTokenStore} on purpose — `get`, `set`,
 * `clear`, `subscribe` — so the same `useSyncExternalStore` reactivity and the same "the repository
 * holds the store, a screen never handles a credential" rule apply without a second set of habits.
 *
 * ## What lives here and what does not
 *
 * This module is the **contract** plus the two implementations that need no platform module: an
 * in-memory one for tests and the mock world, and the web/Node one over `sessionStorage`. The
 * native implementation belongs in the application, beside `session/storage.native.ts`, because it
 * needs `expo-secure-store` — a dependency this package does not have and should not grow.
 */

/** The storage key. Distinct from `h360.session-token`, and never written to `localStorage`. */
export const GUEST_TOKEN_KEY = 'h360.guest-token';

/**
 * The guest credential's home.
 *
 * Structurally identical to `SessionTokenStore`, and named separately anyway: the two hold
 * different credentials with different lifetimes, and a parameter typed `GuestTokenStore` says
 * which one a caller means even where TypeScript would accept either.
 */
export interface GuestTokenStore {
    get(): string | null;
    set(token: string): void;
    clear(): void;
    /**
     * Notify on every `set`/`clear`. Required for the same reason the session store needs it: a
     * `get()` during render goes stale the moment `startSession` writes a token, and the checkout
     * would never advance past "no session".
     */
    subscribe(listener: () => void): () => void;
}

export function createMemoryGuestTokenStore(initial: string | null = null): GuestTokenStore {
    let token = initial;
    const { subscribe, notify } = createTokenListeners();
    return {
        get: () => token,
        set: (next: string) => {
            token = next;
            notify();
        },
        clear: () => {
            token = null;
            notify();
        },
        subscribe,
    };
}

function readSessionStorage(): Storage | null {
    try {
        if (typeof globalThis === 'undefined') return null;
        const candidate = (globalThis as { sessionStorage?: Storage }).sessionStorage;
        return candidate ?? null;
    } catch {
        return null;
    }
}

/**
 * Web and Node guest-token storage.
 *
 * The same memory-plus-storage shape as `session/storage.ts`, for the same reason: the memory copy
 * is what every read uses, so a storage exception — private browsing, a blocked origin, a quota
 * error — degrades to a checkout that works until the tab closes rather than to one that cannot
 * start a session at all.
 *
 * The one deliberate difference is `sessionStorage` rather than `localStorage`. See the header.
 */
export function createGuestTokenStore(): GuestTokenStore {
    const storage = readSessionStorage();
    let cached: string | null = null;

    try {
        cached = storage?.getItem(GUEST_TOKEN_KEY) ?? null;
    } catch {
        cached = null;
    }

    const { subscribe, notify } = createTokenListeners();

    return {
        get: () => cached,
        set: (token: string) => {
            cached = token;
            try {
                storage?.setItem(GUEST_TOKEN_KEY, token);
            } catch {
                /* Memory-only for the rest of this tab's life. */
            }
            notify();
        },
        clear: () => {
            cached = null;
            try {
                storage?.removeItem(GUEST_TOKEN_KEY);
            } catch {
                /* Nothing more can be done; the memory copy is already gone. */
            }
            notify();
        },
        subscribe,
    };
}
