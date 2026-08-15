import { lazyScreen } from '../../../src/shell/lazy-screen.tsx';

/** `/customer/account` — the setup checklist, and the settings a person keeps coming back to. */
const AccountScreen = lazyScreen(
    'account-loading',
    async () => (await import('../../../src/features/account/screens/index.ts')).AccountScreen,
);

export default function CustomerAccount() {
    return <AccountScreen />;
}
