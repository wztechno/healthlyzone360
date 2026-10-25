import { useLocalSearchParams } from 'expo-router';

import { lazyScreen } from '../../../src/shell/lazy-screen.tsx';

/** `/kitchen/plans` — the commercial plans this kitchen sells, and how much of each is decided. */
const PlansScreen = lazyScreen(
    'kitchen-plans-loading',
    async () => (await import('../../../src/features/kitchen-admin/screens/index.ts')).PlansScreen,
);

export default function KitchenPlans() {
    // `?view=`: the record whose page is open, so an editor sent from it comes back to it.
    const { view } = useLocalSearchParams<{ view?: string }>();
    return <PlansScreen view={view} />;
}
