import { act, fireEvent, screen } from '@testing-library/react-native';
import { Slot, Stack, router, useLocalSearchParams, useRouter } from 'expo-router';
import { renderRouter } from 'expo-router/testing-library';
import { useEffect, useState } from 'react';
import { Pressable, Text, View } from 'react-native';

import { withReturnTo } from './return-to.ts';
import { useCurrentHref, useGoBackOr, usePreviousEntry, useReturnTo } from './use-return-to.ts';

/**
 * The return mechanism against the **real** router.
 *
 * Every other customer suite mocks `expo-router`, which is right for asserting which call a screen
 * makes and wrong for asserting what that call *does*. The design rests on four facts about
 * expo-router 57 that a mock cannot see, so each is pinned here, against a small route tree shaped
 * like the app's — a root `Stack`, and the customer area as one `<Slot/>` inside it:
 *
 * 1. A push inside the customer `<Slot/>` unmounts the page underneath. This is the whole reason
 *    checkout keeps its choices in the URL; if it ever stops being true, that decision can be
 *    revisited, and this case is how anyone will notice.
 * 2. `dismissTo` pops back to the page that opened a detour and hands it the new params, leaving no
 *    trace of the detour behind Back — never a push.
 * 3. A `returnTo` that itself carries a `returnTo`, with `&` and `%` in the innermost page's query,
 *    comes back out of `useLocalSearchParams` exactly as written. This locks the double encoding
 *    against an upgrade that stops decoding twice.
 * 4. After a cold start (a deep link, a refresh) there is nothing to go back to, so `goBackOr`
 *    replaces with its fallback rather than doing nothing.
 *
 * And one it found: after a cold start the merged global params keep the first page's path params
 * for good, which `useCurrentHref` now filters out (see its note).
 *
 * `renderRouter` switches Jest to fake timers; they are put back after each case.
 */

afterEach(() => {
    jest.useRealTimers();
});

/* ══ the route tree ════════════════════════════════════════════════════════════════════════════ */

function RootLayout() {
    return <Stack screenOptions={{ headerShown: false }} />;
}

function CustomerLayout() {
    return <Slot />;
}

/** A page with state of its own, which only survives if the page does. */
let cartMounts = 0;
function CartPage() {
    const [count, setCount] = useState(0);
    useEffect(() => {
        cartMounts += 1;
    }, []);
    return (
        <View>
            <Text testID="cart-count">{String(count)}</Text>
            <Pressable
                testID="cart-increment"
                onPress={() => {
                    setCount((value) => value + 1);
                }}
            />
        </View>
    );
}

/** The opener: shows what it was handed, and opens the detour with itself as the return. */
function CheckoutPage() {
    const navigation = useRouter();
    const params = useLocalSearchParams<{ address?: string; q?: string; step?: string }>();
    const here = useCurrentHref();
    const previous = usePreviousEntry();
    return (
        <View>
            <Text testID="checkout-address">{params.address ?? ''}</Text>
            <Text testID="checkout-q">{params.q ?? ''}</Text>
            <Text testID="checkout-step">{params.step ?? ''}</Text>
            <Text testID="checkout-previous">
                {previous === null
                    ? 'none'
                    : `${previous.pathname} ${String(previous.params['step'] ?? '-')}`}
            </Text>
            <Pressable
                testID="checkout-add-address"
                onPress={() => {
                    navigation.push(withReturnTo('/customer/account/addresses/new', here) as never);
                }}
            />
        </View>
    );
}

/** The detour: saves with the new address, cancels, or opens a detour of its own. */
function AddressEditorPage() {
    const navigation = useRouter();
    const { returnTo } = useLocalSearchParams<{ returnTo?: string }>();
    const back = useReturnTo(returnTo, '/customer/account?section=addresses');
    const here = useCurrentHref();
    return (
        <View>
            <Text testID="editor-return">{back.returnTo ?? ''}</Text>
            <Pressable
                testID="editor-save"
                onPress={() => {
                    back.finish({ address: 'a-9' });
                }}
            />
            <Pressable testID="editor-cancel" onPress={back.leave} />
            <Pressable
                testID="editor-add-phone"
                onPress={() => {
                    navigation.push(withReturnTo('/customer/account/phone', here) as never);
                }}
            />
        </View>
    );
}

function PhonePage() {
    const { returnTo } = useLocalSearchParams<{ returnTo?: string }>();
    const back = useReturnTo(returnTo, '/customer/account?section=profile');
    return (
        <View>
            <Text testID="phone-return">{back.returnTo ?? ''}</Text>
            <Pressable
                testID="phone-verified"
                onPress={() => {
                    back.finish();
                }}
            />
        </View>
    );
}

function AccountPage() {
    const { section } = useLocalSearchParams<{ section?: string }>();
    const here = useCurrentHref();
    return (
        <View>
            <Text testID="account-section">{section ?? ''}</Text>
            <Text testID="account-href">{here}</Text>
        </View>
    );
}

function OrderPage() {
    const goBackOr = useGoBackOr();
    return (
        <Pressable
            testID="order-back"
            onPress={() => {
                goBackOr('/customer/account?section=orders');
            }}
        />
    );
}

const ROUTES = {
    _layout: RootLayout,
    'customer/_layout': CustomerLayout,
    'customer/cart': CartPage,
    'customer/checkout': CheckoutPage,
    'customer/account/index': AccountPage,
    'customer/account/phone': PhonePage,
    'customer/account/addresses/[address]': AddressEditorPage,
    'customer/orders/[order]': OrderPage,
};

/* ══ helpers ═══════════════════════════════════════════════════════════════════════════════════ */

interface StateLike {
    readonly index?: number;
    readonly routes: readonly {
        readonly name: string;
        readonly params?: object;
        readonly state?: StateLike;
    }[];
}

interface RouterProbe {
    readonly getPathname: () => string;
    readonly getSearchParams: () => Record<string, string | string[]>;
    readonly getRouterState: () => unknown;
}

/** The customer area's own history, by route name — what Back would walk through. */
function customerHistory(probe: RouterProbe): readonly string[] {
    let state = probe.getRouterState() as StateLike | undefined;
    while (state !== undefined) {
        const customer = state.routes.find((route) => route.name === 'customer');
        if (customer !== undefined) return customer.state?.routes.map((route) => route.name) ?? [];
        state = state.routes[state.index ?? 0]?.state;
    }
    return [];
}

async function open(url: string): Promise<RouterProbe> {
    // RNTL 14 renders asynchronously, and expo-router hangs its getters on the pending render —
    // awaiting it directly would unwrap them away, so they are lifted off first.
    const rendered = renderRouter(ROUTES, { initialUrl: url });
    await rendered;
    return {
        getPathname: () => rendered.getPathname(),
        getSearchParams: () => rendered.getSearchParams(),
        getRouterState: () => rendered.getRouterState(),
    };
}

async function go(navigate: () => void): Promise<void> {
    await act(async () => {
        navigate();
    });
}

async function press(testID: string): Promise<void> {
    await act(async () => {
        fireEvent.press(screen.getByTestId(testID));
    });
}

const CHECKOUT = '/customer/checkout?channel=web-shop&date=2026-11-02&slot=midday';

/* ══ the cases ═════════════════════════════════════════════════════════════════════════════════ */

describe('the customer area under the real router', () => {
    it('unmounts the page underneath a push, so its state does not survive Back', async () => {
        cartMounts = 0;
        await open('/customer/cart');
        await press('cart-increment');
        await press('cart-increment');
        expect(screen.getByTestId('cart-count')).toHaveTextContent('2');

        await go(() => {
            router.push('/customer/checkout');
        });
        expect(screen.queryByTestId('cart-count')).toBeNull();

        await go(() => {
            router.back();
        });
        // A fresh mount, starting over: this is why checkout's choices live in its URL.
        expect(screen.getByTestId('cart-count')).toHaveTextContent('0');
        expect(cartMounts).toBe(2);
    });

    it('finishes a detour back on its opener, with the new params and no detour behind Back', async () => {
        const result = await open('/customer/cart');
        await go(() => {
            router.push(CHECKOUT);
        });
        expect(customerHistory(result)).toEqual(['cart', 'checkout']);

        await press('checkout-add-address');
        expect(result.getPathname()).toBe('/customer/account/addresses/new');
        // The editor reads back the exact page that sent it.
        expect(screen.getByTestId('editor-return')).toHaveTextContent(CHECKOUT);

        await press('editor-save');

        expect(result.getPathname()).toBe('/customer/checkout');
        expect(result.getSearchParams()).toEqual({
            channel: 'web-shop',
            date: '2026-11-02',
            slot: 'midday',
            address: 'a-9',
        });
        expect(screen.getByTestId('checkout-address')).toHaveTextContent('a-9');
        // Popped, not pushed: Back from here is the basket, never the submitted form.
        expect(customerHistory(result)).toEqual(['cart', 'checkout']);
    });

    it('cancels a detour back to the opener as it was', async () => {
        const result = await open('/customer/cart');
        await go(() => {
            router.push(`${CHECKOUT}&address=a-1`);
        });
        await press('checkout-add-address');
        await press('editor-cancel');

        expect(result.getPathname()).toBe('/customer/checkout');
        expect(result.getSearchParams()['address']).toBe('a-1');
        expect(customerHistory(result)).toEqual(['cart', 'checkout']);
    });

    it('finishes a detour opened directly on its fallback, in place of the form', async () => {
        const result = await open('/customer/account/addresses/new');
        expect(screen.getByTestId('editor-return')).toHaveTextContent('');

        await press('editor-save');

        expect(result.getPathname()).toBe('/customer/account');
        // The fallback is used as it is: the saved address is not the account page's business.
        expect(screen.getByTestId('account-section')).toHaveTextContent('addresses');
        expect(screen.getByTestId('account-href')).toHaveTextContent(
            '/customer/account?section=addresses',
        );
        expect(customerHistory(result)).toEqual(['account/index']);
    });

    /*
     * The expo-router behaviour `useCurrentHref` works around: a cold start seeds the area's and the
     * root's routes with the first page's path params, and moving on inside the Slot never clears
     * them, so the merged global params still say `order=o-1` on the account page.
     */
    it('keeps a cold start’s path params out of a later page’s href', async () => {
        const result = await open('/customer/orders/o-1');
        await press('order-back');

        expect(result.getPathname()).toBe('/customer/account');
        expect(result.getSearchParams()['order']).toBe('o-1');
        expect(screen.getByTestId('account-href')).toHaveTextContent(
            '/customer/account?section=orders',
        );
    });

    it('carries a return that carries a return, with & and % intact, there and back', async () => {
        const query = '50% off & more';
        const result = await open('/customer/cart');
        await go(() => {
            router.push(`${CHECKOUT}&q=${encodeURIComponent(query)}`);
        });
        expect(screen.getByTestId('checkout-q')).toHaveTextContent(query);

        await press('checkout-add-address');
        const editorReturn = screen.getByTestId('editor-return').props.children as string;
        expect(editorReturn.startsWith('/customer/checkout?')).toBe(true);

        // The editor sends somebody on to confirm a phone, passing itself — return and all.
        await press('editor-add-phone');
        expect(result.getPathname()).toBe('/customer/account/phone');
        const phoneReturn = screen.getByTestId('phone-return').props.children as string;
        expect(phoneReturn.startsWith('/customer/account/addresses/new?returnTo=')).toBe(true);

        // Confirmed: back to the editor, which still knows where *it* returns to.
        await press('phone-verified');
        expect(result.getPathname()).toBe('/customer/account/addresses/new');
        expect(screen.getByTestId('editor-return')).toHaveTextContent(editorReturn);

        // Saved: back to the checkout, its own query unharmed by two trips through the URL.
        await press('editor-save');
        expect(result.getPathname()).toBe('/customer/checkout');
        expect(screen.getByTestId('checkout-q')).toHaveTextContent(query);
        expect(screen.getByTestId('checkout-address')).toHaveTextContent('a-9');
        expect(customerHistory(result)).toEqual(['cart', 'checkout']);
    });

    it('sees the delivery step as the entry under the payment step', async () => {
        await open('/customer/cart');
        await go(() => {
            router.push(CHECKOUT);
        });
        expect(screen.getByTestId('checkout-previous')).toHaveTextContent('/customer/cart -');

        await go(() => {
            router.push(`${CHECKOUT}&step=payment`);
        });
        expect(screen.getByTestId('checkout-step')).toHaveTextContent('payment');
        // What checkout's in-card Back reads to decide between `back()` and `setParams`.
        expect(screen.getByTestId('checkout-previous')).toHaveTextContent('/customer/checkout -');

        await go(() => {
            router.back();
        });
        expect(screen.getByTestId('checkout-step')).toHaveTextContent('');
    });

    it('sees no entry underneath after a cold start', async () => {
        await open(`${CHECKOUT}&step=payment`);
        expect(screen.getByTestId('checkout-previous')).toHaveTextContent('none');
    });

    it('goes back when there is somewhere to go, and replaces with the fallback when not', async () => {
        const cold = await open('/customer/orders/o-1');
        expect(router.canGoBack()).toBe(false);

        await press('order-back');

        expect(cold.getPathname()).toBe('/customer/account');
        expect(screen.getByTestId('account-section')).toHaveTextContent('orders');
        // Replaced, not pushed: the order page is not left behind for Back to find.
        expect(customerHistory(cold)).toEqual(['account/index']);
    });

    it('goes back, rather than to the fallback, when the page has an entry beneath', async () => {
        const warm = await open('/customer/cart');
        await go(() => {
            router.push('/customer/orders/o-1');
        });
        expect(router.canGoBack()).toBe(true);

        await press('order-back');

        expect(warm.getPathname()).toBe('/customer/cart');
        expect(customerHistory(warm)).toEqual(['cart']);
    });
});
