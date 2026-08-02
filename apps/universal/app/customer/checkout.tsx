import { lazyScreen } from '../../src/shell/lazy-screen.tsx';

/**
 * `/customer/checkout` — the one-off order checkout, as a prototype.
 *
 * There is no payment step here and no route that could become one: the repository contract has no
 * method that takes a payment instrument.
 */
const CheckoutScreen = lazyScreen(
    'checkout-loading',
    async () => (await import('../../src/features/commerce/screens/index.ts')).CheckoutScreen,
);

export default function CustomerCheckout() {
    return <CheckoutScreen />;
}
