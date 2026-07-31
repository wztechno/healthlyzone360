import { CartScreen } from '../../src/features/commerce/screens/cart-screen.tsx';

/**
 * `/customer/cart` — the basket.
 *
 * Inside the customer area rather than the public marketplace: a basket belongs to a person, and
 * `getCart()` is an authenticated read. Browsing stays public; buying does not.
 */
export default function CustomerCart() {
    return <CartScreen />;
}
