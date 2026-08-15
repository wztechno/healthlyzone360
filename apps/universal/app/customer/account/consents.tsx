import { lazyScreen } from '../../../src/shell/lazy-screen.tsx';

/** `/customer/account/consents` — what this person agreed to, in the words they agreed to. */
const ConsentsScreen = lazyScreen(
    'account-consents-loading',
    async () => (await import('../../../src/features/account/screens/index.ts')).ConsentsScreen,
);

export default function CustomerAccountConsents() {
    return <ConsentsScreen />;
}
