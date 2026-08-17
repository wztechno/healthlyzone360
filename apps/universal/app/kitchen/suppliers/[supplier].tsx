import { useLocalSearchParams } from 'expo-router';

import { lazyScreen } from '../../../src/shell/lazy-screen.tsx';

/**
 * `/kitchen/suppliers/{supplier}` — the supplier record and its named contacts.
 *
 * The parameter is validated in the screen, so a hand-typed link produces the designed not-found
 * state rather than a repository failure. Creating is `new.tsx` beside this file, which Expo Router
 * matches first.
 */
const SupplierDetailScreen = lazyScreen(
    'kitchen-supplier-loading',
    async () =>
        (await import('../../../src/features/kitchen-admin/screens/index.ts')).SupplierDetailScreen,
);

export default function KitchenSupplierDetail() {
    const { supplier } = useLocalSearchParams<{ supplier?: string }>();
    return <SupplierDetailScreen supplier={supplier} />;
}
