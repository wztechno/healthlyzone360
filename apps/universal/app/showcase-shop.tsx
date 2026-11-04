import { Redirect } from 'expo-router';

import { appConfig } from '../src/config.ts';
import { AreaShell } from '../src/shell/area-shell.tsx';
import { lazyScreen } from '../src/shell/lazy-screen.tsx';

/**
 * `/showcase-shop` — the web shop's own parts (the code boxes, the switch) on a page of their own,
 * apart from `/showcase`, so they can be judged in isolation. Development builds only; production
 * sends the reader home.
 */
const ShopPartsShowcaseScreen = lazyScreen(
    'shop-parts-showcase-loading',
    async () =>
        (await import('../src/screens/shop-parts-showcase-screen.tsx')).ShopPartsShowcaseScreen,
);

export default function ShopPartsShowcase() {
    if (!appConfig.isDevelopment) return <Redirect href="/" />;

    return (
        <AreaShell
            area="auth"
            variant="public"
            unguarded
            title="Shop parts"
            testID="shop-parts-showcase-shell"
        >
            <ShopPartsShowcaseScreen />
        </AreaShell>
    );
}
