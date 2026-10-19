import {
    RETURN_DESTINATIONS,
    hrefFromParts,
    isPublicHref,
    pathParamNames,
    pathnameOf,
    queryOf,
    returnDestination,
    routeEntryPath,
    safeReturnTo,
    withQuery,
    withReturnTo,
} from './return-to.ts';

/**
 * `return-to.ts` is the whole of the "take me back" contract as pure functions, so it is tested as
 * one: what a return may be, how it is written into a URL, and how it is read back out.
 *
 * Two properties carry the weight and are asserted from several sides:
 *
 * * **Nothing outside the application is ever a return.** expo-router opens an href that starts
 *   with `//` or a scheme through `Linking.openURL`, so every spelling of "somewhere else" — raw,
 *   backslashed, percent-encoded — is refused here, before it can reach the router.
 * * **The value survives the router's two decodes.** `withReturnTo` encodes twice because the URL
 *   parser decodes once and `useLocalSearchParams` decodes again. The round trip below decodes the
 *   way those two do, so an expo-router upgrade that stops double-decoding shows up as a failure in
 *   `use-return-to.test.tsx` (the real router) while this file pins what the writer produces.
 */

/** What the URL parser and then `useLocalSearchParams` do to a query value, in that order. */
function readBack(href: string, key: string): string | null {
    const query = href.includes('?') ? href.slice(href.indexOf('?') + 1) : '';
    const once = new URLSearchParams(query).get(key);
    return once === null ? null : decodeURIComponent(once);
}

describe('safeReturnTo', () => {
    it('accepts an in-app path and keeps its query as given', () => {
        expect(safeReturnTo('/customer/checkout?channel=web-shop')).toBe(
            '/customer/checkout?channel=web-shop',
        );
        expect(safeReturnTo('/meals?q=a%20b')).toBe('/meals?q=a%20b');
        expect(safeReturnTo('/customer/account/addresses/new')).toBe(
            '/customer/account/addresses/new',
        );
    });

    it('drops the hash and a trailing slash, and nothing else', () => {
        expect(safeReturnTo('/customer/cart/#lines')).toBe('/customer/cart');
        expect(safeReturnTo('/meals?q=soup#top')).toBe('/meals?q=soup');
    });

    it.each([
        ['a protocol-relative URL', '//evil.com'],
        ['a protocol-relative URL with a path', '//evil.com/customer/cart'],
        ['a backslash some browsers read as a slash', '/\\evil.com'],
        ['an absolute URL', 'https://x'],
        ['a script URL', 'javascript:x'],
        ['a scheme with no slashes', 'mailto:someone@example.com'],
        ['a relative path', 'customer/cart'],
        ['an encoded double slash', '/%2F%2Fevil.com'],
        ['an encoded second slash', '/%2Fevil.com'],
        ['an encoded backslash', '/%5Cevil.com'],
        ['an encoded control character', '/customer%00/cart'],
        ['a malformed escape', '/customer/%E0%A4%A'],
        ['a leading space', ' /customer/cart'],
        ['a space inside', '/customer/ cart'],
        ['a newline', '/customer/cart\n'],
        ['a tab in the query', '/customer/cart?x=\t'],
        ['the empty string', ''],
    ])('refuses %s', (_label, raw) => {
        expect(safeReturnTo(raw)).toBeNull();
    });

    it('refuses what is not a string', () => {
        for (const raw of [undefined, null, 42, ['/customer/cart'], { href: '/customer/cart' }]) {
            expect(safeReturnTo(raw)).toBeNull();
        }
    });

    it('refuses anything longer than 2048 characters, and accepts 2048', () => {
        const at = (length: number) => `/meals?q=${'a'.repeat(length - '/meals?q='.length)}`;
        expect(safeReturnTo(at(2048))).toBe(at(2048));
        expect(safeReturnTo(at(2049))).toBeNull();
    });

    it('never sends somebody back to a way in or to the launch resolver', () => {
        for (const raw of [
            '/',
            '/sign-in',
            '/sign-in/',
            '/sign-in?returnTo=%2Fcustomer%2Fcart',
            '/register',
            '/forgot-password',
            '/reset-password',
            '/verify-email',
            '/verify-phone',
            '/change-password',
            '/select-organisation',
            '/select-branch',
            '/forbidden',
        ]) {
            expect(safeReturnTo(raw)).toBeNull();
        }
    });

    it('refuses a page this build does not offer', () => {
        // The planner and the dietitian directory are switched off in `features/availability.ts`.
        expect(safeReturnTo('/customer/planner')).toBeNull();
        expect(safeReturnTo('/customer/planner/week')).toBeNull();
        expect(safeReturnTo('/dietitians')).toBeNull();
    });
});

describe('withQuery', () => {
    it('sets, replaces and deletes keys, and keeps the rest', () => {
        expect(withQuery('/customer/checkout', { address: 'a-1' })).toBe(
            '/customer/checkout?address=a-1',
        );
        expect(
            withQuery('/customer/checkout?channel=web-shop&address=a-1', { address: 'a-2' }),
        ).toBe('/customer/checkout?channel=web-shop&address=a-2');
        expect(
            withQuery('/customer/checkout?channel=web-shop&step=payment', {
                step: undefined,
                slot: null,
                date: '',
            }),
        ).toBe('/customer/checkout?channel=web-shop');
        expect(withQuery('/customer/checkout?step=payment', { step: null })).toBe(
            '/customer/checkout',
        );
    });

    it('encodes a value once, so the URL parser alone restores it', () => {
        const href = withQuery('/meals', { q: 'a&b c' });
        expect(new URLSearchParams(href.slice(href.indexOf('?') + 1)).get('q')).toBe('a&b c');
    });

    it('writes a number as its digits', () => {
        expect(withQuery('/customer/orders/1', { placed: 1 })).toBe('/customer/orders/1?placed=1');
    });
});

describe('withReturnTo', () => {
    it('encodes the return twice, which the router’s two decodes undo exactly', () => {
        const back = '/customer/checkout?channel=web-shop&address=a-1';
        const href = withReturnTo('/customer/account/addresses/new', back);
        expect(href).toBe(
            `/customer/account/addresses/new?returnTo=${encodeURIComponent(encodeURIComponent(back))}`,
        );
        expect(readBack(href, 'returnTo')).toBe(back);
    });

    it('carries a return that itself carries a return, with its own escapes intact', () => {
        const checkout = '/customer/checkout?channel=web-shop&q=a%20b';
        const editor = withReturnTo('/customer/account/addresses/new', checkout);
        const phone = withReturnTo('/customer/account/phone', editor);

        // One page at a time, the way the person walks back.
        const editorAgain = readBack(phone, 'returnTo');
        expect(editorAgain).toBe(editor);
        expect(readBack(editorAgain!, 'returnTo')).toBe(checkout);
    });

    it('replaces a return the href already had', () => {
        const href = withReturnTo(
            withReturnTo('/customer/account/phone', '/customer/cart'),
            '/customer/checkout',
        );
        expect(new URLSearchParams(href.slice(href.indexOf('?') + 1)).getAll('returnTo')).toEqual([
            encodeURIComponent('/customer/checkout'),
        ]);
    });

    it('leaves an unsafe or absent return off, and takes away one that was there', () => {
        expect(withReturnTo('/customer/account/phone', '//evil.com')).toBe(
            '/customer/account/phone',
        );
        expect(withReturnTo('/customer/account/phone', null)).toBe('/customer/account/phone');
        expect(withReturnTo('/customer/account/phone', undefined)).toBe('/customer/account/phone');
        expect(withReturnTo('/customer/account/phone?returnTo=%252Fcustomer%252Fcart', null)).toBe(
            '/customer/account/phone',
        );
    });

    it('keeps the target’s own query beside the return', () => {
        const href = withReturnTo('/customer/account?section=addresses', '/customer/cart');
        expect(queryOf(href)['section']).toBe('addresses');
        expect(readBack(href, 'returnTo')).toBe('/customer/cart');
    });
});

describe('the current page as an href', () => {
    it('names the dynamic segments of a route, catch-alls included', () => {
        expect([...pathParamNames(['customer', 'orders', '[order]'])]).toEqual(['order']);
        expect([
            ...pathParamNames(['(marketplace)', 'kitchens', '[kitchen]', '[...rest]']),
        ]).toEqual(['kitchen', 'rest']);
        expect(pathParamNames(['customer', 'checkout']).size).toBe(0);
    });

    it('leaves the path parameters out of the query', () => {
        expect(
            hrefFromParts(
                '/customer/orders/o-1',
                { order: 'o-1', placed: 'o-1' },
                pathParamNames(['customer', 'orders', '[order]']),
            ),
        ).toBe('/customer/orders/o-1?placed=o-1');
    });

    it('re-encodes what the hooks decoded, and a return twice', () => {
        // The hooks hand back values decoded twice — the return as the href it names.
        const href = hrefFromParts(
            '/customer/account/addresses/new',
            { address: 'new', returnTo: '/customer/checkout?channel=web-shop&slot=midday' },
            pathParamNames(['customer', 'account', 'addresses', '[address]']),
        );
        expect(readBack(href, 'returnTo')).toBe('/customer/checkout?channel=web-shop&slot=midday');
        expect(pathnameOf(href)).toBe('/customer/account/addresses/new');
    });

    it('repeats an array parameter and skips an absent one', () => {
        expect(hrefFromParts('/meals', { diet: ['vegan', 'halal'], q: undefined }, new Set())).toBe(
            '/meals?diet=vegan&diet=halal',
        );
        expect(hrefFromParts('/meals', {}, new Set())).toBe('/meals');
    });
});

describe('routeEntryPath', () => {
    it('rebuilds a navigator’s route as the path it stands for', () => {
        expect(routeEntryPath({ name: 'checkout', params: { step: 'payment' } })).toBe('/checkout');
        expect(routeEntryPath({ name: 'account/index' })).toBe('/account');
        expect(
            routeEntryPath({
                name: 'account/addresses/[address]',
                params: { address: 'new', returnTo: '/customer/checkout' },
            }),
        ).toBe('/account/addresses/new');
        expect(routeEntryPath({ name: '(marketplace)/meals/[meal]', params: { meal: 12 } })).toBe(
            '/meals/12',
        );
        expect(routeEntryPath({ name: 'docs/[...rest]', params: { rest: ['a', 'b'] } })).toBe(
            '/docs/a/b',
        );
        expect(routeEntryPath({ name: 'index' })).toBe('/');
    });
});

describe('returnDestination', () => {
    it.each([
        ['/customer/checkout?channel=web-shop&step=payment', 'checkout'],
        ['/customer/subscriptions/new?plan=p-1&step=delivery', 'planSetup'],
        ['/customer/subscriptions/s-1?dialog=address', 'subscription'],
        ['/customer/account/close/scope', 'closure'],
        ['/customer/account?section=addresses', 'account'],
        ['/customer/account/addresses/new', 'account'],
        ['/customer/cart', 'basket'],
        ['/customer/orders/o-1', 'order'],
        // The subscriptions list is the account's, not one subscription.
        ['/customer/subscriptions', 'previous'],
        ['/meals?q=soup', 'previous'],
        ['/customer/checkoutish', 'previous'],
    ] as const)('calls %s “%s”', (href, destination) => {
        expect(returnDestination(href)).toBe(destination);
    });

    it('calls nothing at all the previous page', () => {
        expect(returnDestination(null)).toBe('previous');
        expect(returnDestination(undefined)).toBe('previous');
    });

    it('names only destinations the catalogue has words for', () => {
        expect(RETURN_DESTINATIONS).toEqual([
            'checkout',
            'planSetup',
            'subscription',
            'account',
            'basket',
            'order',
            'closure',
            'previous',
        ]);
    });
});

describe('isPublicHref', () => {
    it('tells the marketplace from the pages behind a session', () => {
        expect(isPublicHref('/meals?q=soup')).toBe(true);
        expect(isPublicHref('/kitchens/k-1')).toBe(true);
        expect(isPublicHref('/discover')).toBe(true);
        expect(isPublicHref('/customer/cart')).toBe(false);
        expect(isPublicHref('/customer/checkout?channel=web-shop')).toBe(false);
        expect(isPublicHref('/kitchen/orders')).toBe(false);
        expect(isPublicHref('/workspace')).toBe(false);
        expect(isPublicHref('/devices')).toBe(false);
        expect(isPublicHref('/apply')).toBe(false);
        // A prefix is a whole segment, not a string start.
        expect(isPublicHref('/applying-is-public')).toBe(true);
    });
});
