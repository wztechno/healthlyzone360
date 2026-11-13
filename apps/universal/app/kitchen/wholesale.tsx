import { lazyScreen } from '../../src/shell/lazy-screen.tsx';

/**
 * `/kitchen/wholesale` — the seller side of B2B onboarding as a checklist: a wholesale channel, an
 * agreement price list, the list on the channel, and the priced articles offered on it.
 */
const WholesaleSetupScreen = lazyScreen(
    'kitchen-wholesale-loading',
    async () =>
        (await import('../../src/features/kitchen-admin/screens/index.ts')).WholesaleSetupScreen,
);

export default function KitchenWholesale() {
    return <WholesaleSetupScreen />;
}
