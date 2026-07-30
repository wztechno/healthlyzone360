import { I18nextProvider } from 'react-i18next';
import { SafeAreaProvider, initialWindowMetrics } from 'react-native-safe-area-context';
import type { Metrics } from 'react-native-safe-area-context';
import type { ReactNode } from 'react';

import { i18n } from './i18n.ts';

export interface AppProvidersProps {
    readonly children: ReactNode;
    /**
     * Seed insets. `SafeAreaProvider` renders nothing until it has measured, which means one blank
     * frame on device and an empty tree in a test renderer that never fires `onLayout`. Passing the
     * metrics that are already known removes both.
     */
    readonly initialMetrics?: Metrics | null | undefined;
}

/**
 * Providers every route sits inside.
 *
 * Phase 5a needs only i18n and safe-area insets. TanStack Query, the access-state provider and the
 * repository factory arrive in Phase 5b, once there is data to fetch and guards to enforce.
 */
export function AppProviders({ children, initialMetrics }: AppProvidersProps) {
    return (
        <I18nextProvider i18n={i18n}>
            <SafeAreaProvider initialMetrics={initialMetrics ?? initialWindowMetrics}>
                {children}
            </SafeAreaProvider>
        </I18nextProvider>
    );
}
