import { ToastProvider } from '@healthy360/design-system';
import type { Repositories, SessionTokenStore } from '@healthy360/api-client';
import { QueryClientProvider } from '@tanstack/react-query';
import type { QueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { I18nextProvider } from 'react-i18next';
import { SafeAreaProvider, initialWindowMetrics } from 'react-native-safe-area-context';
import type { Metrics } from 'react-native-safe-area-context';

import { createQueryClient } from './data/query-client.ts';
import { persistCache, restoreCache } from './data/persistence.ts';
import { AppRepositoryProvider } from './data/repository-provider.tsx';
import { i18n } from './i18n.ts';
import { OnlineStatusProvider } from './online/online-status.tsx';
import { SessionProvider } from './session/session-provider.tsx';
import { createKeyValueStore } from './session/storage.ts';

export interface AppProvidersProps {
    readonly children: ReactNode;
    /**
     * Seed insets. `SafeAreaProvider` renders nothing until it has measured, which means one blank
     * frame on device and an empty tree in a test renderer that never fires `onLayout`. Passing the
     * metrics that are already known removes both.
     */
    readonly initialMetrics?: Metrics | null | undefined;
    /** Test seams. Supplying these skips the async repository factory and the shared query client. */
    readonly repositories?: Repositories | undefined;
    readonly tokenStore?: SessionTokenStore | undefined;
    readonly queryClient?: QueryClient | undefined;
    readonly initialOnline?: boolean | undefined;
}

/**
 * Provider order, outermost first, and why:
 *
 * 1. `I18nextProvider` — everything below may render copy, including the error paths.
 * 2. `SafeAreaProvider` — layout metrics are needed before any chrome measures itself.
 * 3. `QueryClientProvider` — the cache the session lives in.
 * 4. `OnlineStatusProvider` — bridges connectivity into that client's `onlineManager`, so it sits
 *    inside the client but outside anything that fetches.
 * 5. `AppRepositoryProvider` — builds the data layer (async; may fail on the missing-base-URL
 *    gate in production).
 * 6. `SessionProvider` — reads `me()` through the repositories and projects the access state.
 * 7. `ToastProvider` — last, so its live regions overlay the application rather than the reverse.
 */
export function AppProviders({
    children,
    initialMetrics,
    repositories,
    tokenStore,
    queryClient,
    initialOnline,
}: AppProvidersProps) {
    const client = useMemo(() => queryClient ?? createQueryClient(), [queryClient]);
    const cacheStore = useMemo(() => createKeyValueStore(), []);

    /**
     * The language the persisted cache belongs to.
     *
     * Tracked in state rather than read once, because a person can change language without
     * reloading and the disk cache must follow them: from M1 the server localises public reads and
     * sends one `name`, so a cached page *is* a page in one language.
     */
    const [cacheLocale, setCacheLocale] = useState(() => i18n.resolvedLanguage ?? i18n.language);

    useEffect(() => {
        const onLanguageChanged = () => setCacheLocale(i18n.resolvedLanguage ?? i18n.language);
        i18n.on('languageChanged', onLanguageChanged);
        // A language change that landed between the initial render and this subscription would
        // otherwise be missed for the rest of the session.
        onLanguageChanged();
        return () => {
            i18n.off('languageChanged', onLanguageChanged);
        };
    }, []);

    useEffect(() => {
        // Allow-listed persistence only — nothing under `session` or `devices` may reach disk
        // (plan §21). `restoreCache` discards anything written by an older cache version, and the
        // key carries the locale so an Arabic reader never restores English names from disk.
        restoreCache(client, cacheStore, cacheLocale);
        return persistCache(client, cacheStore, cacheLocale);
    }, [client, cacheStore, cacheLocale]);

    return (
        <I18nextProvider i18n={i18n}>
            <SafeAreaProvider initialMetrics={initialMetrics ?? initialWindowMetrics}>
                <QueryClientProvider client={client}>
                    <OnlineStatusProvider initialOnline={initialOnline}>
                        <AppRepositoryProvider repositories={repositories} tokenStore={tokenStore}>
                            <SessionProvider>
                                <ToastProvider>{children}</ToastProvider>
                            </SessionProvider>
                        </AppRepositoryProvider>
                    </OnlineStatusProvider>
                </QueryClientProvider>
            </SafeAreaProvider>
        </I18nextProvider>
    );
}
