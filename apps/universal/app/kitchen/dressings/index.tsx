import { lazyScreen } from '../../../src/shell/lazy-screen.tsx';

/** `/kitchen/dressings` — the kitchen-made dressings, with their packs and channels. */
const DressingsScreen = lazyScreen(
    'kitchen-dressings-loading',
    async () =>
        (await import('../../../src/features/kitchen-admin/screens/index.ts')).DressingsScreen,
);

export default function KitchenDressings() {
    return <DressingsScreen />;
}
