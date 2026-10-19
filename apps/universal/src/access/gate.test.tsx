import { waitFor } from '@testing-library/react-native';
import { Text } from 'react-native';

import { withReturnTo } from '../navigation/return-to.ts';
import type { ExpoRouterMock } from '../testing/expo-router-mock.ts';
import { testMeResponse, testMembership, testSessionUser } from '../testing/session-fixtures.ts';
import { renderStubScreen } from '../testing/stub-screen.tsx';
import { Gate } from './gate.tsx';

/**
 * Which gate redirects carry the refused page back (AUTH-03).
 *
 * The kernel (`@healthy360/permissions`) keeps answering with bare paths — its own tests pin that —
 * and `Gate` adds `?returnTo=` for exactly the two gates whose way out comes back: signing in and
 * confirming an email address. The staff pickers stay bare. The router is the shared mock, so
 * `Redirect` records the href it was given instead of navigating.
 */
jest.mock('expo-router', () =>
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    require('../testing/expo-router-mock.ts').createExpoRouterMock({
        pathname: '/customer/checkout',
        params: { channel: 'web-shop' },
    }),
);

// eslint-disable-next-line @typescript-eslint/no-require-imports
const routerMock = require('expo-router') as ExpoRouterMock;

beforeEach(() => {
    routerMock.__reset();
});

function guarded(area: 'customer' | 'kitchen' = 'customer') {
    return (
        <Gate area={area}>
            <Text testID="gated-content">inside</Text>
        </Gate>
    );
}

describe('Gate redirects', () => {
    it('sends an anonymous visitor to sign in with the page they asked for, query and all', async () => {
        await renderStubScreen(guarded());

        await waitFor(() => {
            expect(routerMock.__redirect).toHaveBeenCalledWith(
                withReturnTo('/sign-in', '/customer/checkout?channel=web-shop'),
            );
        });
        // Encoded twice on purpose: `useLocalSearchParams` decodes once more than the URL did.
        expect(routerMock.__redirect).toHaveBeenCalledWith(
            '/sign-in?returnTo=%252Fcustomer%252Fcheckout%253Fchannel%253Dweb-shop',
        );
    });

    it('sends an unconfirmed account to verification with the same return', async () => {
        await renderStubScreen(guarded(), {
            session: testMeResponse({ user: testSessionUser({ emailVerifiedAt: null }) }),
        });

        await waitFor(() => {
            expect(routerMock.__redirect).toHaveBeenCalledWith(
                withReturnTo('/verify-email', '/customer/checkout?channel=web-shop'),
            );
        });
    });

    it('leaves the organisation picker bare: staff choose where they work, not where they were', async () => {
        routerMock.__set({ pathname: '/kitchen/orders', params: {} });

        await renderStubScreen(guarded('kitchen'), {
            session: testMeResponse({ memberships: [testMembership()] }),
        });

        await waitFor(() => {
            expect(routerMock.__redirect).toHaveBeenCalledWith('/select-organisation');
        });
        expect(routerMock.__redirect).not.toHaveBeenCalledWith(expect.stringContaining('returnTo'));
    });

    it('appends nothing when the refused page is itself a way in', async () => {
        routerMock.__set({ pathname: '/sign-in', params: {} });

        await renderStubScreen(guarded());

        await waitFor(() => {
            expect(routerMock.__redirect).toHaveBeenCalledWith('/sign-in');
        });
    });

    it('passes on the return a way in was carrying, so the chain survives a session ending', async () => {
        routerMock.__set({ pathname: '/verify-email', params: { returnTo: '/customer/cart' } });

        await renderStubScreen(guarded());

        await waitFor(() => {
            expect(routerMock.__redirect).toHaveBeenCalledWith(
                withReturnTo('/sign-in', '/customer/cart'),
            );
        });
    });
});
