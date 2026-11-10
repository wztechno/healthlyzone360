import { Redirect } from 'expo-router';

import { appConfig } from '../src/config.ts';
import { AreaShell } from '../src/shell/area-shell.tsx';
import { lazyScreen } from '../src/shell/lazy-screen.tsx';

/**
 * `/showcase-orders` — the parts the Orders redesign added, on a page of their own. Development
 * builds only, like the `/showcase` alias; production sends the reader home.
 */
const OrdersShowcaseScreen = lazyScreen(
    'orders-showcase-loading',
    async () => (await import('../src/screens/orders-showcase-screen.tsx')).OrdersShowcaseScreen,
);

export default function OrdersShowcase() {
    if (!appConfig.isDevelopment) return <Redirect href="/" />;

    return (
        <AreaShell
            area="auth"
            variant="public"
            unguarded
            title="Orders parts"
            testID="orders-showcase-shell"
        >
            <OrdersShowcaseScreen />
        </AreaShell>
    );
}
