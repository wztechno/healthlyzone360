import { useLocalSearchParams } from 'expo-router';

import { lazyScreen } from '../../../src/shell/lazy-screen.tsx';

const ComplaintsScreen = lazyScreen(
    'kitchen-complaints-loading',
    async () =>
        (await import('../../../src/features/kitchen-admin/screens/index.ts')).ComplaintsScreen,
);

export default function KitchenComplaints() {
    // `?view=`: the record whose page is open.
    const { view } = useLocalSearchParams<{ view?: string }>();
    return <ComplaintsScreen view={view} />;
}
