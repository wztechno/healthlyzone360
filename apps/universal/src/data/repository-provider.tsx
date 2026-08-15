import { createRepositories } from '@healthy360/api-client';
import type { ClientPlatform, Repositories, SessionTokenStore } from '@healthy360/api-client';
import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { Platform } from 'react-native';

import { appConfig } from '../config.ts';
import { i18n } from '../i18n.ts';
import { appGuestTokenStore } from '../session/guest-storage.ts';
import { createSessionTokenStore } from '../session/storage.ts';

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
    /** Fatal construction error — a missing API base URL in production. */
    readonly error: Error | null;
}

const RepositoryContext = createContext<RepositoryContextValue | null>(null);

interface BuiltRepositories {
    readonly repositories: Repositories | null;
    readonly error: Error | null;
}

export interface RepositoryProviderProps {
    readonly children: ReactNode;
    /** Test seam: inject repositories directly and skip the factory entirely. */
    readonly repositories?: Repositories | undefined;
    readonly tokenStore?: SessionTokenStore | undefined;
}

/**
 * Builds the repository bundle once and hands it to the tree.
 *
 * The factory is asynchronous because the API layer is behind a dynamic import, which keeps its
 * transport and mappers off the entry chunk's critical path. Construction failure is *not*
 * swallowed: `createRepositories` throwing `MissingApiBaseUrlError` in production is the surviving
 * boot guard, and the application must show that rather than quietly fall back to something.
 */
export function AppRepositoryProvider({
    children,
    repositories: injected,
    tokenStore: injectedTokenStore,
}: RepositoryProviderProps) {
    const tokenStore = useMemo(
        () => injectedTokenStore ?? createSessionTokenStore(),
        [injectedTokenStore],
    );

    const [built, setBuilt] = useState<BuiltRepositories>(() => ({
        repositories: injected ?? null,
        error: null,
    }));

    const repositories = injected ?? built.repositories;
    const error = built.error;

    useEffect(() => {
        if (injected !== undefined) return;

        let cancelled = false;

        void createRepositories({
            appEnv: appConfig.appEnv,
            tokenStore,
            // Supplied rather than left to the factory's memory fallback, because the guest
            // repository *writes* this token and `data/guest-hooks.ts` subscribes to it. Two stores
            // would be two answers to "is there a guest session", and the checkout would never see
            // the one it had just started.
            guestTokenStore: appGuestTokenStore,
            baseUrl: appConfig.apiUrl,
            appMode: appConfig.appMode,
            clientVersion: appConfig.clientVersion,
            platform: CLIENT_PLATFORM,
            deviceName: DEVICE_NAME,
            // Read per request, so switching language changes the next call's `Accept-Language`.
            locale: () => i18n.resolvedLanguage ?? i18n.language,
        })
            .then((created) => {
                if (!cancelled) setBuilt({ repositories: created, error: null });
            })
            .catch((caught: unknown) => {
                if (cancelled) return;
                setBuilt({
                    repositories: null,
                    error: caught instanceof Error ? caught : new Error(String(caught)),
                });
            });

        return () => {
            cancelled = true;
        };
    }, [injected, tokenStore]);

    const value = useMemo<RepositoryContextValue>(
        () => ({ repositories, tokenStore, error }),
        [repositories, tokenStore, error],
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
