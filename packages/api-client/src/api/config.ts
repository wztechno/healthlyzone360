import type { AppMode } from '@healthy360/domain-types';

import type { SessionTokenStore } from '../contracts/session.ts';
import type { GuestTokenStore } from '../session/guest-token-store.ts';

/** The three platforms the API's `X-Client-Platform` header recognises. */
export type ClientPlatform = 'web' | 'ios' | 'android';

/**
 * Everything the API repositories need from the application.
 *
 * Only `baseUrl` is required. Everything else has a defensible default so a test — or a script —
 * can construct the repositories without assembling an Expo runtime.
 */
export interface ApiClientConfig {
    /**
     * The API origin, for example `http://localhost:8080`. The `/api/v1` prefix is appended unless
     * the value already carries it, so both `http://localhost:8080` and
     * `http://localhost:8080/api/v1` are accepted.
     */
    readonly baseUrl: string;
    readonly tokenStore: SessionTokenStore;
    /**
     * Where the guest credential lives (plan Phase G1).
     *
     * Supplied by the application for the same reason `tokenStore` is — the web implementation
     * belongs in `sessionStorage` and the native one in the keychain, and only the application can
     * make that choice. It defaults to a memory store rather than to `null`, because a guest
     * repository with nowhere to keep a token is one whose every call is anonymous, which fails in
     * a way that looks like a backend problem.
     */
    readonly guestTokenStore?: GuestTokenStore | undefined;
    /** `X-App-Mode`. Diagnostic only; never an authorisation input (docs/api/conventions.md). */
    readonly appMode?: AppMode | undefined;
    /** `X-Client-Version`. */
    readonly clientVersion?: string | undefined;
    /** `X-Client-Platform`, and the `platform` sent to `POST /auth/token`. */
    readonly platform?: ClientPlatform | undefined;
    /**
     * The device name shown in device management. A person recognises "Chrome on Windows"; they do
     * not recognise a token identifier.
     */
    readonly deviceName?: string | undefined;
    /**
     * Read at request time rather than captured, so switching language mid-session changes the
     * `Accept-Language` of the next request instead of the next launch.
     */
    readonly locale?: (() => string) | undefined;
    /** Test seam. Defaults to the global `fetch`. */
    readonly fetch?: typeof fetch | undefined;
    /** Test seam for `X-Client-Request-Id`. */
    readonly requestId?: (() => string) | undefined;
}

export const DEFAULT_API_BASE_URL = 'http://localhost:8080';

const API_PREFIX = '/api/v1';

/**
 * `${origin}/api/v1`, whichever of the two forms the caller supplied.
 *
 * Getting this wrong is a whole-application outage that only appears in `api` mode, so it is one
 * function with one test rather than string concatenation at nineteen call sites.
 */
export function resolveApiBaseUrl(baseUrl: string): string {
    const trimmed = baseUrl.trim().replace(/\/+$/, '');
    if (trimmed === '') throw new Error('An API base URL is required when dataMode is "api".');
    return trimmed.endsWith(API_PREFIX) ? trimmed : `${trimmed}${API_PREFIX}`;
}

/**
 * An opaque per-request identifier for support correlation.
 *
 * `crypto.randomUUID` is unavailable on some React Native runtimes, and this value is never a
 * security token — the server sanitises it, caps it at 128 characters, logs it and echoes it back —
 * so a `Math.random` fallback is honest rather than dangerous.
 */
export function generateRequestId(): string {
    const cryptoApi = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
    if (typeof cryptoApi?.randomUUID === 'function') return cryptoApi.randomUUID();

    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (character) => {
        const random = Math.trunc(Math.random() * 16);
        const value = character === 'x' ? random : (random & 0x3) | 0x8;
        return value.toString(16);
    });
}
