import { lazyScreen } from '../../src/shell/lazy-screen.tsx';

/**
 * `/guest-checkout` — ordering without an account.
 *
 * In the **public** marketplace group on purpose. A guest checkout behind a session gate would be a
 * contradiction, and putting it under `/customer` would make its first navigation a redirect to
 * sign-in — which is the wall this journey exists to remove.
 *
 * It is a new route rather than a mode of `/customer/checkout`. The two screens answer different
 * questions: `CheckoutScreen` prices a basket for somebody the system already knows, and this one
 * establishes who the person is as its first step. Folding them together would put four steps and
 * a passcode inside a screen whose whole shape assumes an identity already exists.
 */
const GuestCheckoutScreen = lazyScreen(
    'guest-checkout-loading',
    async () => (await import('../../src/features/guest/screens/index.ts')).GuestCheckoutScreen,
);

export default function GuestCheckout() {
    return <GuestCheckoutScreen />;
}
