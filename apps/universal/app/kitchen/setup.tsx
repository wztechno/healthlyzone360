import { lazyScreen } from '../../src/shell/lazy-screen.tsx';

/** `/kitchen/setup` — the guided steps and the go-live gate. */
export default lazyScreen(
    'kitchen-setup-loading',
    async () =>
        (await import('../../src/features/kitchen-admin/screens/index.ts')).KitchenSetupScreen,
);
