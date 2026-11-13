import { Redirect } from 'expo-router';

import { appConfig } from '../src/config.ts';
import { AreaShell } from '../src/shell/area-shell.tsx';
import { lazyScreen } from '../src/shell/lazy-screen.tsx';

/**
 * `/showcase-order-desk` — the parts the Order desk redesign added, on a page of their own.
 * Development builds only, like the `/showcase` alias; production sends the reader home.
 */
const OrderDeskShowcaseScreen = lazyScreen(
    'order-desk-showcase-loading',
    async () =>
        (await import('../src/screens/order-desk-showcase-screen.tsx')).OrderDeskShowcaseScreen,
);

export default function OrderDeskShowcase() {
    if (!appConfig.isDevelopment) return <Redirect href="/" />;

    return (
        <AreaShell
            area="auth"
            variant="public"
            unguarded
            title="Order desk parts"
            testID="order-desk-showcase-shell"
        >
            <OrderDeskShowcaseScreen />
        </AreaShell>
    );
}
