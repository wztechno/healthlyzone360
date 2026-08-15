/**
 * Session-credential storage that is not the session's.
 *
 * Currently one member: the guest token store (plan Phase G1). The *session* token store's contract
 * lives in `../contracts/session.ts` beside the repositories that consume it; this directory exists
 * because the guest credential is a second, differently-shaped thing and burying it in the session
 * contract would suggest the two are interchangeable.
 */
export {
    GUEST_TOKEN_KEY,
    createGuestTokenStore,
    createMemoryGuestTokenStore,
} from './guest-token-store.ts';
export type { GuestTokenStore } from './guest-token-store.ts';
