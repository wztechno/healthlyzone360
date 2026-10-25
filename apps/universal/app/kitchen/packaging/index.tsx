import { useLocalSearchParams } from 'expo-router';

import { lazyScreen } from '../../../src/shell/lazy-screen.tsx';

/** `/kitchen/packaging` — bags, boxes, lids and cutlery, and what each costs. */
const PackagingScreen = lazyScreen(
    'kitchen-packaging-loading',
    async () =>
        (await import('../../../src/features/kitchen-admin/screens/index.ts')).PackagingScreen,
);

export default function KitchenPackaging() {
    // `?view=`: the record whose page is open, so an editor sent from it comes back to it.
    const { view } = useLocalSearchParams<{ view?: string }>();
    return <PackagingScreen view={view} />;
}
