import type { DataMode } from '@healthy360/domain-types';

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
    /** Base URL for the API repositories. Required once `dataMode` is `api` (5c). */
    readonly baseUrl?: string | undefined;
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

/** Raised until 5c adds the generated client and the API repository implementations. */
export class ApiRepositoriesUnavailableError extends Error {
    constructor() {
        super(
            [
                'The API repositories are not implemented yet.',
                'Phase 5b ships the repository contracts and the mock implementation only;',
                'the @hey-api generated client and ApiRepository land in Phase 5c (plan §15).',
                'Run with EXPO_PUBLIC_DATA_MODE=mock until then.',
            ].join('\n'),
        );
        this.name = 'ApiRepositoriesUnavailableError';
    }
}

/**
 * The single place a `Repositories` bundle is created.
 *
 * The mock implementation is behind a dynamic import so a production bundle can tree-shake — or at
 * least code-split — the entire fixture world out of the initial chunk. The async signature exists
 * for that reason alone.
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

    throw new ApiRepositoriesUnavailableError();
}
