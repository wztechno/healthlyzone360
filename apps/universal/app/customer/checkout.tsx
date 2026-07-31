import { CheckoutScreen } from '../../src/features/commerce/screens/checkout-screen.tsx';

/**
 * `/customer/checkout` — the one-off order checkout, as a prototype.
 *
 * There is no payment step here and no route that could become one: the repository contract has no
 * method that takes a payment instrument.
 */
export default function CustomerCheckout() {
    return <CheckoutScreen />;
}
