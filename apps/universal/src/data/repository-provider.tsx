import { createRepositories, MOCK_SCENARIO_NAMES } from '@healthy360/api-client';
import type {
    ClientPlatform,
    MockScenarioName,
    Repositories,
    SessionTokenStore,
} from '@healthy360/api-client';
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { Platform } from 'react-native';

import { appConfig } from '../config.ts';
import { i18n } from '../i18n.ts';
import { createKeyValueStore, createSessionTokenStore } from '../session/storage.ts';

/** `X-Client-Platform`, and the platform recorded against the device on `POST /auth/token`. */
const CLIENT_PLATFORM: ClientPlatform =
    Platform.OS === 'ios' ? 'ios' : Platform.OS === 'android' ? 'android' : 'web';

/**
 * What the device is called in device management. A person recognises "Healthy360 web"; nobody
 * recognises a token identifier — and re-registering the same name rotates the token rather than
 * accumulating a device row per sign-in (OpenAPI `/auth/token`).
 */
const DEVICE_NAME = `Healthy360 ${CLIENT_PLATFORM}`;

export interface RepositoryContextValue {
    /** `null` until the factory resolves. Every consumer must handle that. */
    readonly repositories: Repositories | null;
    readonly tokenStore: SessionTokenStore;
    /** Fatal construction error — the mock-in-production guard, or a missing API base URL. */
    readonly error: Error | null;
    readonly scenario: MockScenarioName;
    /** Development only: rebuilds the repositories against a different mock world. */
    readonly setScenario: (next: MockScenarioName) => void;
}

const RepositoryContext = createContext<RepositoryContextValue | null>(null);

interface BuiltRepositories {
    readonly scenario: MockScenarioName;
    readonly repositories: Repositories | null;
    readonly error: Error | null;
}

export interface RepositoryProviderProps {
    readonly children: ReactNode;
    /** Test seam: inject repositories directly and skip the factory entirely. */
    readonly repositories?: Repositories | undefined;
    readonly tokenStore?: SessionTokenStore | undefined;
    readonly initialScenario?: MockScenarioName | undefined;
}

/**
 * Where the development scenario choice survives a reload.
 *
 * `sessionStorage`, deliberately: the choice belongs to the tab, so a reload (or a typed URL —
 * which is a full document load) keeps the world a person put themselves in, while a fresh tab
 * still starts at the build's default. Without this, following any absolute link after switching
 * scenarios rebooted the default world, invalidated the session, and bounced the person to
 * sign-in — correct by the letter of "switching worlds signs you out", but baffling in practice.
 *
 * Stored values are untrusted: anything not in `MOCK_SCENARIO_NAMES` is ignored. Native has no
 * `sessionStorage`, hence the guarded access — there the choice remains per-launch state.
 */
const SCENARIO_STORAGE_KEY = 'h360.dev.mock-scenario';

function readPersistedScenario(): MockScenarioName | null {
    if (appConfig.dataMode !== 'mock') return null;
    try {
        const stored = globalThis.sessionStorage?.getItem(SCENARIO_STORAGE_KEY) ?? null;
        return stored !== null && (MOCK_SCENARIO_NAMES as readonly string[]).includes(stored)
            ? (stored as MockScenarioName)
            : null;
    } catch {
        return null;
    }
}

function persistScenario(next: MockScenarioName): void {
    try {
        globalThis.sessionStorage?.setItem(SCENARIO_STORAGE_KEY, next);
    } catch {
        // Storage being unavailable (native, privacy mode) only costs reload persistence.
    }
}

/**
 * Builds the repository bundle once and hands it to the tree.
 *
 * The factory is asynchronous because the mock implementation is behind a dynamic import, which is
 * what keeps the entire fixture world out of the initial chunk. Construction failure is *not*
 * swallowed: `createRepositories` throwing `MockDataInProductionError` is mock-cannot-ship gate #2
 * (plan §18), and the application must show that rather than quietly fall back to something.
 */
export function AppRepositoryProvider({
    children,
    repositories: injected,
    tokenStore: injectedTokenStore,
    initialScenario,
}: RepositoryProviderProps) {
    const tokenStore = useMemo(
        () => injectedTokenStore ?? createSessionTokenStore(),
        [injectedTokenStore],
    );

    const [scenario, setScenario] = useState<MockScenarioName>(
        initialScenario ?? readPersistedScenario() ?? appConfig.mockScenario,
    );

    /**
     * The built bundle is stored *together with the scenario it was built for*, and staleness is
     * derived during render rather than cleared by a `setState` inside the effect. Resetting in the
     * effect body would render one frame with the previous world's repositories still in place, and
     * it is precisely the cascading-render pattern `react-hooks/set-state-in-effect` rejects.
     */
    const [built, setBuilt] = useState<BuiltRepositories>(() => ({
        scenario: initialScenario ?? readPersistedScenario() ?? appConfig.mockScenario,
        repositories: injected ?? null,
        error: null,
    }));

    const fresh = built.scenario === scenario;
    const repositories = injected ?? (fresh ? built.repositories : null);
    const error = fresh ? built.error : null;

    useEffect(() => {
        if (injected !== undefined) return;

        let cancelled = false;

        void createRepositories({
            dataMode: appConfig.dataMode,
            appEnv: appConfig.appEnv,
            scenario,
            tokenStore,
            keyValueStorage: createKeyValueStore(),
            baseUrl: appConfig.apiUrl,
            appMode: appConfig.appMode,
            clientVersion: appConfig.clientVersion,
            platform: CLIENT_PLATFORM,
            deviceName: DEVICE_NAME,
            // Read per request, so switching language changes the next call's `Accept-Language`.
            locale: () => i18n.resolvedLanguage ?? i18n.language,
        })
            .then((created) => {
                if (!cancelled) setBuilt({ scenario, repositories: created, error: null });
            })
            .catch((caught: unknown) => {
                if (cancelled) return;
                setBuilt({
                    scenario,
                    repositories: null,
                    error: caught instanceof Error ? caught : new Error(String(caught)),
                });
            });

        return () => {
            cancelled = true;
        };
    }, [injected, scenario, tokenStore]);

    const changeScenario = useCallback(
        (next: MockScenarioName) => {
            // Switching worlds invalidates the session that belonged to the old one.
            tokenStore.clear();
            persistScenario(next);
            setScenario(next);
        },
        [tokenStore],
    );

    const value = useMemo<RepositoryContextValue>(
        () => ({ repositories, tokenStore, error, scenario, setScenario: changeScenario }),
        [repositories, tokenStore, error, scenario, changeScenario],
    );

    return <RepositoryContext.Provider value={value}>{children}</RepositoryContext.Provider>;
}

export function useRepositoryContext(): RepositoryContextValue {
    const value = useContext(RepositoryContext);
    if (value === null) {
        throw new Error('useRepositoryContext must be used inside an <AppRepositoryProvider>.');
    }
    return value;
}

/**
 * The repositories, with the readiness check deferred to first *use*.
 *
 * Mutation hooks call this during render, and the async factory may not have resolved yet on the
 * very first frames — throwing at render time would crash hydration on every screen that declares
 * a mutation (it did). Returning a throwing proxy keeps the contract ("you may not touch a
 * repository before the factory resolves") while letting the declaration itself be free: by the
 * time a user can actually submit a form, construction has long finished. Callers that need to
 * *react* to readiness still use `useRepositoryContext()`.
 */
export function useRepositories(): Repositories {
    const { repositories } = useRepositoryContext();
    return useMemo(() => {
        if (repositories !== null) {
            return repositories;
        }
        return new Proxy({} as Repositories, {
            get() {
                throw new Error(
                    'Repositories are not ready yet. Guard on useRepositoryContext() first.',
                );
            },
        });
    }, [repositories]);
}
