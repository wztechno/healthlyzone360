import { lazyScreen } from '../../src/shell/lazy-screen.tsx';

/**
 * `/customer/cart` — the basket.
 *
 * Inside the customer area rather than the public marketplace: a basket belongs to a person, and
 * `getCart()` is an authenticated read. Browsing stays public; buying does not.
 */
const CartScreen = lazyScreen(
    'cart-loading',
    async () => (await import('../../src/features/commerce/screens/index.ts')).CartScreen,
);

export default function CustomerCart() {
    return <CartScreen />;
}
