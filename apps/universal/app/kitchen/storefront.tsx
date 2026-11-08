import { lazyScreen } from '../../src/shell/lazy-screen.tsx';

/**
 * `/kitchen/storefront` — the tagline, description and cuisines a customer reads on the kitchen's
 * marketplace page.
 */
const StorefrontProfileScreen = lazyScreen(
    'kitchen-storefront-loading',
    async () =>
        (await import('../../src/features/kitchen-admin/screens/index.ts')).StorefrontProfileScreen,
);

export default function KitchenStorefront() {
    return <StorefrontProfileScreen />;
}
