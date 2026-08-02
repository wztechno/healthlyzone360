import { createGuestTokenStore } from '@healthy360/api-client';
import type { GuestTokenStore } from '@healthy360/api-client';

/**
 * Web guest-token storage (plan Phase G1).
 *
 * The counterpart to `./storage.ts`, and deliberately **not** the same store. A session token lives
 * in `localStorage` because restoring a signed-in session across a browser restart is the point of
 * having one. A guest token lives in `sessionStorage` because the opposite is true: the device a
 * guest orders from is frequently not their own, and a credential that outlives the tab hands the
 * next person a basket, a delivery address and a phone number belonging to somebody who never made
 * an account and so cannot sign in anywhere to clear it.
 *
 * The implementation itself lives in `@healthy360/api-client` — memory plus `sessionStorage`, with
 * every storage call wrapped so that private browsing or a blocked origin degrades to a checkout
 * that works until the tab closes rather than one that cannot start. Re-exported rather than
 * re-written so the web and native halves of this pair stay a *pair* and not two dialects.
 *
 * Metro resolves `guest-storage.native.ts` on iOS and Android; this file is the web and Node
 * implementation, which is also the one TypeScript and Jest see.
 */
export function createAppGuestTokenStore(): GuestTokenStore {
    return createGuestTokenStore();
}

export type { GuestTokenStore };
