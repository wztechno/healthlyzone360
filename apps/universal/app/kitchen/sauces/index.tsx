import { lazyScreen } from '../../../src/shell/lazy-screen.tsx';

/** `/kitchen/sauces` — the kitchen-made sauces and marinations, with their packs and channels. */
const SaucesScreen = lazyScreen(
    'kitchen-sauces-loading',
    async () => (await import('../../../src/features/kitchen-admin/screens/index.ts')).SaucesScreen,
);

export default function KitchenSauces() {
    return <SaucesScreen />;
}
