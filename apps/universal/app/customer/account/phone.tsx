import { lazyScreen } from '../../../src/shell/lazy-screen.tsx';

/** `/customer/account/phone` — add a mobile number, or confirm the one already on file. */
const PhoneScreen = lazyScreen(
    'account-phone-loading',
    async () => (await import('../../../src/features/account/screens/index.ts')).PhoneScreen,
);

export default function CustomerAccountPhone() {
    return <PhoneScreen />;
}
