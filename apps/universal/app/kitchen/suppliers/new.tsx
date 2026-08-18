import { lazyScreen } from '../../../src/shell/lazy-screen.tsx';

/**
 * `/kitchen/suppliers/new` — the create form.
 *
 * A static segment sitting beside `[supplier].tsx`: Expo Router prefers the static match, so `new`
 * is never read as a supplier identifier. It renders the same screen with no parameter, because the
 * record being created and the record being edited are the same form — the contacts section is the
 * only difference, and it waits until there is a supplier to hang contacts on.
 */
const SupplierDetailScreen = lazyScreen(
    'kitchen-supplier-loading',
    async () =>
        (await import('../../../src/features/kitchen-admin/screens/index.ts')).SupplierDetailScreen,
);

export default function NewKitchenSupplier() {
    return <SupplierDetailScreen supplier="new" />;
}
