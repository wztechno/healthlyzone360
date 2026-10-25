import { useLocalSearchParams } from 'expo-router';

import { lazyScreen } from '../../../src/shell/lazy-screen.tsx';

const QuotationsScreen = lazyScreen(
    'kitchen-quotations-loading',
    async () =>
        (await import('../../../src/features/kitchen-admin/screens/index.ts')).QuotationsScreen,
);

export default function KitchenQuotations() {
    // `?view=`: the record whose page is open, so an editor sent from it comes back to it.
    const { view } = useLocalSearchParams<{ view?: string }>();
    return <QuotationsScreen view={view} />;
}
