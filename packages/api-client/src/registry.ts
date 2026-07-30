import type { AppMode, DataMode } from '@healthy360/domain-types';

import type { ClientPlatform } from './api/config.ts';
import { DEFAULT_API_BASE_URL } from './api/config.ts';
import { createMemoryTokenStore } from './contracts/session.ts';
import type { Repositories, SessionTokenStore } from './contracts/index.ts';
import type { MockScenarioName } from './mock/scenarios.ts';

export const REPOSITORY_APP_ENVS = ['development', 'preview', 'production'] as const;
export type RepositoryAppEnv = (typeof REPOSITORY_APP_ENVS)[number];

/** Minimal string storage the application supplies (localStorage on web, memory on native). */
export interface KeyValueStorage {
    get(key: string): string | null;
    set(key: string, value: string): void;
}

export interface RepositoryConfig {
    readonly dataMode: DataMode;
    readonly appEnv: RepositoryAppEnv;
    /** Which mock world to load. Ignored when `dataMode` is `api`. */
    readonly scenario?: MockScenarioName | undefined;
    /** Simulated latency for the mock repositories; `0` in unit tests. */
    readonly latencyMs?: number | undefined;
    readonly tokenStore?: SessionTokenStore | undefined;
    /**
     * Mock mode only: backs the mock server's context persistence so a page reload keeps the
     * last-applied organisation/branch context, exactly as the real backend does
     * (`user_profiles.last_organisation_id`, Phase 4).
     */
    readonly keyValueStorage?: KeyValueStorage | undefined;
    /**
     * Base URL for the API repositories, for example `http://localhost:8080`. Used only when
     * `dataMode` is `api`; defaults to `DEFAULT_API_BASE_URL` outside production, and is *required*
     * in production, where guessing `localhost` would be a silent outage.
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

/** Raised when `dataMode` is `api` in production with no base URL to talk to. */
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
 * Mock-cannot-ship **gate #2** (plan §18).
 *
 * Gate #1 refuses to *configure* a production build with mock data (`app.config.ts`). This is the
 * runtime backstop for anything that slips past it — a patched bundle, a mis-set env var read after
 * configuration, a preview artefact promoted by hand. It throws rather than degrading, because
 * silently serving fixtures to a real user is the worst available outcome.
 */
export class MockDataInProductionError extends Error {
    constructor(appEnv: RepositoryAppEnv) {
        super(
            [
                'Refusing to create mock repositories in a production application.',
                `  appEnv=${appEnv}`,
                '  dataMode=mock',
                'Production builds must read from the Healthy360 API (plan §18;',
                'docs/architecture/05-universal-frontend.md §6).',
            ].join('\n'),
        );
        this.name = 'MockDataInProductionError';
    }
}

/**
 * The single place a `Repositories` bundle is created.
 *
 * Both implementations are behind dynamic imports, so a production bundle can tree-shake — or at
 * least code-split — the entire fixture world out of the initial chunk, and a mock-mode
 * development build never pulls the generated wire types in either. The async signature exists for
 * that reason alone.
 */
export async function createRepositories(config: RepositoryConfig): Promise<Repositories> {
    if (config.dataMode === 'mock') {
        if (config.appEnv === 'production') throw new MockDataInProductionError(config.appEnv);

        const { createMockRepositories } = await import('./mock/repositories.ts');

        const storage = config.keyValueStorage;
        const storageKey = `h360.mock-contexts.${config.scenario ?? 'default'}`;
        const contexts =
            storage === undefined
                ? undefined
                : {
                      load: () => {
                          try {
                              const raw = storage.get(storageKey);
                              return raw === null ? null : JSON.parse(raw);
                          } catch {
                              return null;
                          }
                      },
                      save: (map: object) => {
                          try {
                              storage.set(storageKey, JSON.stringify(map));
                          } catch {
                              /* Persistence is best-effort; the in-memory world still works. */
                          }
                      },
                  };

        return createMockRepositories({
            scenario: config.scenario,
            latencyMs: config.latencyMs,
            tokenStore: config.tokenStore,
            contexts,
        });
    }

    const baseUrl = config.baseUrl ?? '';
    if (baseUrl === '' && config.appEnv === 'production') throw new MissingApiBaseUrlError();

    const { createApiRepositories } = await import('./api/repositories.ts');

    return createApiRepositories({
        baseUrl: baseUrl === '' ? DEFAULT_API_BASE_URL : baseUrl,
        tokenStore: config.tokenStore ?? createMemoryTokenStore(),
        ...(config.appMode === undefined ? {} : { appMode: config.appMode }),
        ...(config.clientVersion === undefined ? {} : { clientVersion: config.clientVersion }),
        ...(config.platform === undefined ? {} : { platform: config.platform }),
        ...(config.deviceName === undefined ? {} : { deviceName: config.deviceName }),
        ...(config.locale === undefined ? {} : { locale: config.locale }),
    });
}
