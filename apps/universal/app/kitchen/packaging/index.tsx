import { lazyScreen } from '../../../src/shell/lazy-screen.tsx';

/** `/kitchen/packaging` — bags, boxes, lids and cutlery, and what each costs. */
const PackagingScreen = lazyScreen(
    'kitchen-packaging-loading',
    async () =>
        (await import('../../../src/features/kitchen-admin/screens/index.ts')).PackagingScreen,
);

export default function KitchenPackaging() {
    return <PackagingScreen />;
}
