import type { AppMode } from '@healthy360/domain-types';

import type { ClientPlatform } from './api/config.ts';
import { DEFAULT_API_BASE_URL } from './api/config.ts';
import { createMemoryTokenStore } from './contracts/session.ts';
import type { Repositories, SessionTokenStore } from './contracts/index.ts';
import type { GuestTokenStore } from './session/guest-token-store.ts';

export const REPOSITORY_APP_ENVS = ['development', 'preview', 'production'] as const;
export type RepositoryAppEnv = (typeof REPOSITORY_APP_ENVS)[number];

export interface RepositoryConfig {
    readonly appEnv: RepositoryAppEnv;
    readonly tokenStore?: SessionTokenStore | undefined;
    /**
     * The guest credential's store (plan Phase G1). Supplied by the application, for the same
     * reason `tokenStore` is: only the application knows whether this device has a
     * `sessionStorage` or a keychain. Defaults to a memory store, which is correct in tests and in
     * Node and merely forgetful in a browser.
     */
    readonly guestTokenStore?: GuestTokenStore | undefined;
    /**
     * Base URL for the API repositories, for example `http://localhost:8080`. Defaults to
     * `DEFAULT_API_BASE_URL` outside production, and is *required* in production, where guessing
     * `localhost` would be a silent outage.
     */
    readonly baseUrl?: string | undefined;
    /** Diagnostic request headers (`X-App-Mode`, `X-Client-Version`, `X-Client-Platform`). */
    readonly appMode?: AppMode | undefined;
    readonly clientVersion?: string | undefined;
    readonly platform?: ClientPlatform | undefined;
    /** The name this device is listed under in device management. */
    readonly deviceName?: string | undefined;
    /** Read per request, so a language change takes effect on the next call. */
    readonly locale?: (() => string) | undefined;
}

/** Raised in production when there is no base URL to talk to. */
export class MissingApiBaseUrlError extends Error {
    constructor() {
        super(
            [
                'No API base URL is configured.',
                'Set EXPO_PUBLIC_API_URL to the Healthy360 API origin (for example',
                'https://api.healthy360.com). A production build must not fall back to localhost.',
            ].join('\n'),
        );
        this.name = 'MissingApiBaseUrlError';
    }
}

/**
 * The single place a `Repositories` bundle is created.
 *
 * One implementation since ADR-0013 — the API repositories — behind a dynamic import so the
 * ~12K-line transport-and-mapper layer stays off the entry chunk's critical path (fonts, i18n and
 * the landing shell paint first). The surviving guard is the production base-URL check: the mock
 * gates this factory once carried defended an implementation that no longer exists.
 */
export async function createRepositories(config: RepositoryConfig): Promise<Repositories> {
    const baseUrl = config.baseUrl ?? '';
    if (baseUrl === '' && config.appEnv === 'production') throw new MissingApiBaseUrlError();

    const { createApiRepositories } = await import('./api/repositories.ts');

    return createApiRepositories({
        baseUrl: baseUrl === '' ? DEFAULT_API_BASE_URL : baseUrl,
        tokenStore: config.tokenStore ?? createMemoryTokenStore(),
        ...(config.guestTokenStore === undefined
            ? {}
            : { guestTokenStore: config.guestTokenStore }),
        ...(config.appMode === undefined ? {} : { appMode: config.appMode }),
        ...(config.clientVersion === undefined ? {} : { clientVersion: config.clientVersion }),
        ...(config.platform === undefined ? {} : { platform: config.platform }),
        ...(config.deviceName === undefined ? {} : { deviceName: config.deviceName }),
        ...(config.locale === undefined ? {} : { locale: config.locale }),
    });
}
