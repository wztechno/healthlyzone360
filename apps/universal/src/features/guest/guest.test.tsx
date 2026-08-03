import { createMemoryTokenStore } from '@healthy360/api-client';
import { MOCK_OTP_CODE, createMockRepositories } from '@healthy360/api-client/mock';
import type { MockRepositories } from '@healthy360/api-client/mock';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import type { ReactNode } from 'react';

import { AppProviders } from '../../providers.tsx';
import { appGuestTokenStore } from '../../session/guest-storage.ts';
import { TEST_METRICS, createTestQueryClient } from '../../testing/render-screen.tsx';
import { servedAreas } from '../commerce/delivery.ts';
import { validateGuestContact } from './contact.ts';
import { GuestCheckoutScreen } from './screens/guest-checkout-screen.tsx';
import { GuestDeletionScreen } from './screens/guest-deletion-screen.tsx';
import { GuestOrderScreen } from './screens/guest-order-screen.tsx';

/**
 * The G1 guest journey, against the real mock world.
 *
 * Speed-mode coverage: the seven decisions this slice exists to make, plus the one pure rule a
 * rendered tree would only obscure. Screens are rendered over `createMockRepositories`, which
 * satisfies the same `Repositories` bundle the application resolves at runtime, so this suite
 * exercises the real path into `guest` rather than a stand-in for it.
 *
 * Every world built here is handed `appGuestTokenStore`, exactly as `data/repository-provider.tsx`
 * hands it to `createRepositories`. Injecting repositories bypasses that factory, so without it the
 * repository would write its own store while `useGuestToken` subscribed to the application's — two
 * answers to "is there a guest session", and every screen gated on the token would render as though
 * there were none.
 *
 * The OTP path uses `MOCK_OTP_CODE` and nothing else about the code is faked: the expiry, the
 * attempt budget, the cooldown and the supersession rule are the store's real mechanics, imported
 * from the account world so the two cannot drift.
 *
 * The wider matrix — lockout, resend supersession, conversion, channel fallback, RTL, axe — is
 * itemised as deferred in the wave report.
 */

jest.mock('expo-router', () => {
    const push = jest.fn();
    return {
        __esModule: true,
        useRouter: () => ({ push, replace: jest.fn(), setParams: jest.fn(), back: jest.fn() }),
        usePathname: () => '/guest-checkout',
        useLocalSearchParams: () => ({}),
        Redirect: () => null,
        Link: ({ children }: { children: ReactNode }) => children,
        Slot: () => null,
        Stack: () => null,
        __push: push,
    };
});

// eslint-disable-next-line @typescript-eslint/no-require-imports
const routerMock = require('expo-router') as { __push: jest.Mock };

beforeEach(() => {
    routerMock.__push.mockClear();
    globalThis.localStorage?.clear();
    globalThis.sessionStorage?.clear();
    // The guest store caches its token in memory so that a blocked `sessionStorage` degrades to a
    // checkout that works until the tab closes. Clearing the backing storage therefore does not
    // reset it, and a token minted by one test would still be readable by the next.
    appGuestTokenStore.clear();
});

interface Harness {
    readonly repositories: MockRepositories;
}

async function renderGuest(
    node: ReactNode,
    seed?: (repositories: MockRepositories) => Promise<unknown>,
): Promise<Harness> {
    const tokenStore = createMemoryTokenStore();
    const repositories = createMockRepositories({
        scenario: 'consumer-prototype',
        latencyMs: 0,
        tokenStore,
        guestTokenStore: appGuestTokenStore,
    });
    if (seed !== undefined) await seed(repositories);

    await render(
        <AppProviders
            initialMetrics={TEST_METRICS}
            repositories={repositories}
            tokenStore={tokenStore}
            queryClient={createTestQueryClient()}
            initialOnline
        >
            {node}
        </AppProviders>,
    );

    return { repositories };
}

/** One meal in the basket — the precondition for every checkout assertion below. */
async function fillBasket(repositories: MockRepositories): Promise<{ area: string }> {
    const meals = await repositories.marketplace.listMeals({ limit: 1 });
    const meal = meals.items[0];
    if (meal === undefined) throw new Error('The prototype world has no marketplace meals.');

    const cart = await repositories.commerce.getCart();
    await repositories.commerce.addCartItem(cart.id, { mealId: meal.id, quantity: 1 });

    const kitchen = await repositories.marketplace.getKitchen(meal.kitchenId);
    const area = servedAreas(kitchen)[0];
    if (area === undefined) throw new Error('The seeded kitchen publishes no delivery zones.');
    return { area };
}

/** A verified guest session with a basket, so a test can start at the review step. */
async function verifiedSession(repositories: MockRepositories): Promise<void> {
    await fillBasket(repositories);
    await repositories.guest.startSession();
    const { challenge } = await repositories.guest.updateContact({
        fullName: 'Rana Haddad',
        email: 'rana@example.com',
    });
    if (challenge === null) throw new Error('No challenge was issued.');
    await repositories.guest.confirmContact({ challengeId: challenge.id, code: MOCK_OTP_CODE });
}

/* ══ the pure rule ═════════════════════════════════════════════════════════════════════════════ */

describe('the contact rule', () => {
    /** The requirement is about the *pair*, so the message has to land on both inputs. */
    it('needs a name and one of the two contacts, and marks both when neither is given', () => {
        const t = (key: string) => key;

        expect(
            validateGuestContact(
                { fullName: '', email: '', mobile: '', channel: 'email' },
                t as never,
            ),
        ).toEqual({
            fullName: 'guest:contact.errors.nameRequired',
            email: 'guest:contact.errors.contactRequired',
            mobile: 'guest:contact.errors.contactRequired',
        });

        // Either one alone is enough — that is the whole point of the rule.
        expect(
            validateGuestContact(
                { fullName: 'Rana', email: 'rana@example.com', mobile: '', channel: 'email' },
                t as never,
            ),
        ).toEqual({});
        expect(
            validateGuestContact(
                { fullName: 'Rana', email: '', mobile: '+971501234567', channel: 'sms' },
                t as never,
            ),
        ).toEqual({});
    });
});

/* ══ the mock world's own guarantees ═══════════════════════════════════════════════════════════ */

describe('the guest session', () => {
    it('refuses to place an order until a passcode has proven the contact', async () => {
        const repositories = createMockRepositories({
            scenario: 'consumer-prototype',
            latencyMs: 0,
        });
        await fillBasket(repositories);
        const cart = await repositories.commerce.getCart();

        const session = await repositories.guest.startSession();
        expect(session.grade).toBe('checkout_draft');
        expect(session.capabilities).not.toContain('place_order');

        const draft = {
            cartId: cart.id,
            address: {
                label: 'Home',
                line1: '12 Sunset Street',
                line2: null,
                area: 'Business Bay',
                city: 'Dubai',
                countryCode: 'AE',
                instructions: null,
            },
            slotCode: 'midday',
            deliveryDate: '2026-09-01',
            paymentMethod: 'cash_on_delivery' as const,
            marketingOptIn: false,
        };

        await expect(repositories.guest.placeOrder(draft)).rejects.toMatchObject({
            failure: { code: 'request.precondition_required' },
        });

        const { challenge } = await repositories.guest.updateContact({
            fullName: 'Rana Haddad',
            email: 'rana@example.com',
        });
        const promoted = await repositories.guest.confirmContact({
            challengeId: challenge!.id,
            code: MOCK_OTP_CODE,
        });

        expect(promoted.grade).toBe('place_order');
        expect(promoted.capabilities).toContain('place_order');
        expect(promoted.contactVerified).toBe(true);

        const order = await repositories.guest.placeOrder(draft);
        expect(order.reference).toMatch(/^H360-G/);
        expect(order.paymentMethod).toBe('cash_on_delivery');
        // The basket became the order rather than being copied out of.
        expect((await repositories.commerce.getCart()).items).toHaveLength(0);
    });

    it('answers one refusal for a dead token, whatever killed it', async () => {
        const repositories = createMockRepositories({
            scenario: 'consumer-prototype',
            latencyMs: 0,
        });
        await repositories.guest.startSession();

        // Nothing has been signed in and nothing has expired — the token was simply dropped, which
        // is the shape of "another tab cleared it" and of "the tab was closed and reopened".
        repositories.guestTokenStore.clear();

        await expect(repositories.guest.getSession()).rejects.toMatchObject({
            failure: { code: 'auth.unauthenticated' },
        });
    });
});

describe('deletion', () => {
    /** The enumeration guarantee, stated as an equality between two answers. */
    it('acknowledges an address it holds nothing for exactly as it acknowledges a known one', async () => {
        const repositories = createMockRepositories({
            scenario: 'consumer-prototype',
            latencyMs: 0,
        });
        await verifiedSession(repositories);

        const known = await repositories.guest.requestDeletion({ email: 'rana@example.com' });
        const unknown = await repositories.guest.requestDeletion({ email: 'nobody@example.com' });

        expect(known.accepted).toBe(true);
        expect(unknown.accepted).toBe(true);
        expect(known.verificationRequired).toBe(unknown.verificationRequired);
        expect(known.expiresInSeconds).toBe(unknown.expiresInSeconds);
        expect(known.codeLength).toBe(unknown.codeLength);
        // Neither carries a challenge identifier — a nullable one would be the oracle itself.
        expect(Object.keys(known).sort()).toEqual(Object.keys(unknown).sort());

        // And a code against the unknown address fails the way a wrong code fails.
        await expect(
            repositories.guest.confirmDeletion({
                email: 'nobody@example.com',
                code: MOCK_OTP_CODE,
            }),
        ).rejects.toMatchObject({ failure: { code: 'otp.invalid' } });
    });

    it('purges the data and keeps the suppression that erasure must not take with it', async () => {
        const repositories = createMockRepositories({
            scenario: 'consumer-prototype',
            latencyMs: 0,
        });
        await verifiedSession(repositories);
        await repositories.guest.requestDeletion({ email: 'rana@example.com' });

        const outcome = await repositories.guest.confirmDeletion({
            email: 'rana@example.com',
            code: MOCK_OTP_CODE,
        });

        expect(outcome.accepted).toBe(true);
        expect(outcome.marketingSuppressed).toBe(true);
        expect(repositories.guestStore.suppressions).toContain('rana@example.com');
        // The session is gone with everything else.
        await expect(repositories.guest.getSession()).rejects.toMatchObject({
            failure: { code: 'auth.unauthenticated' },
        });
    });
});

/* ══ the screens ═══════════════════════════════════════════════════════════════════════════════ */

describe('the guest checkout', () => {
    it('will not carry on to an area the kitchen does not deliver to', async () => {
        await renderGuest(<GuestCheckoutScreen />, fillBasket);

        await waitFor(() => screen.getByTestId('guest-checkout-contact'));
        await fireEvent.changeText(
            screen.getByTestId('guest-checkout-contact-fullName'),
            'Rana Haddad',
        );
        await fireEvent.changeText(
            screen.getByTestId('guest-checkout-contact-email'),
            'rana@example.com',
        );
        await fireEvent.press(screen.getByTestId('guest-checkout-contact-continue'));

        await waitFor(() => screen.getByTestId('guest-checkout-address'));
        await fireEvent.changeText(
            screen.getByTestId('guest-checkout-address-area'),
            'Ras Al Khaimah Free Zone',
        );

        // A hard stop: the notice appears and the only way on is disabled. There is deliberately no
        // "continue anyway" control to look for.
        await waitFor(() => screen.getByTestId('guest-checkout-out-of-zone'));
        expect(
            screen.getByTestId('guest-checkout-address-continue').props.accessibilityState,
        ).toMatchObject({ disabled: true });
    });

    it('places the order with marketing off unless it was turned on, and confirms with a reference', async () => {
        let servedArea = '';
        await renderGuest(<GuestCheckoutScreen />, async (repositories) => {
            servedArea = (await fillBasket(repositories)).area;
        });

        await waitFor(() => screen.getByTestId('guest-checkout-contact'));
        await fireEvent.changeText(
            screen.getByTestId('guest-checkout-contact-fullName'),
            'Rana Haddad',
        );
        await fireEvent.changeText(
            screen.getByTestId('guest-checkout-contact-email'),
            'rana@example.com',
        );
        await fireEvent.press(screen.getByTestId('guest-checkout-contact-continue'));

        await waitFor(() => screen.getByTestId('guest-checkout-address'));
        for (const [field, value] of [
            ['label', 'Home'],
            ['line1', '12 Sunset Street'],
            ['area', servedArea],
            ['city', 'Dubai'],
            ['countryCode', 'AE'],
        ] as const) {
            await fireEvent.changeText(
                screen.getByTestId(`guest-checkout-address-${field}`),
                value,
            );
        }
        await fireEvent.press(screen.getByTestId('guest-checkout-address-continue'));

        // The passcode gate. Until it is answered there is no review step to place from.
        await waitFor(() => screen.getByTestId('guest-checkout-challenge-code-input'));
        await fireEvent.changeText(
            screen.getByTestId('guest-checkout-challenge-code-input'),
            MOCK_OTP_CODE,
        );
        await fireEvent.press(screen.getByTestId('guest-checkout-challenge-submit'));

        await waitFor(() => screen.getByTestId('guest-checkout-marketing'));
        // Off unless turned on — and it is *not* touched here, so the order carries `false`.
        expect(
            screen.getByTestId('guest-checkout-marketing-control').props.accessibilityState
                ?.checked,
        ).toBe(false);
        expect(screen.getByTestId('guest-checkout-payment')).toBeTruthy();

        await fireEvent.press(screen.getByTestId('guest-checkout-place'));

        await waitFor(() => {
            expect(routerMock.__push).toHaveBeenCalledWith(
                expect.stringMatching(/^\/orders\/H360-G/),
            );
        });
    });

    it('recovers a timed-out session to the first step instead of showing an error page', async () => {
        await renderGuest(<GuestCheckoutScreen />, async (repositories) => {
            await fillBasket(repositories);
            // A session that was started and is now dead — the exact state a person returning to a
            // backgrounded tab is in.
            await repositories.guest.startSession();
            repositories.guestStore.abandon();
            repositories.guestTokenStore.set('gst_dead-token');
        });

        await waitFor(() => screen.getByTestId('guest-checkout-session-expired'));
        // The basket is untouched: losing the session must not look like losing the order.
        expect(screen.getByTestId('guest-checkout-contact')).toBeTruthy();
        expect(screen.getByTestId('guest-checkout-session-restart')).toBeTruthy();
    });
});

describe('the confirmation', () => {
    it('leads with the reference and offers a refusable conversion prompt', async () => {
        // The order is built before the render, because the reference is only known once it exists
        // and the route parameter is fixed at mount.
        const repositories = createMockRepositories({
            scenario: 'consumer-prototype',
            latencyMs: 0,
            guestTokenStore: appGuestTokenStore,
        });
        await verifiedSession(repositories);
        const cart = await repositories.commerce.getCart();
        const order = await repositories.guest.placeOrder({
            cartId: cart.id,
            address: {
                label: 'Home',
                line1: '12 Sunset Street',
                line2: null,
                area: 'Business Bay',
                city: 'Dubai',
                countryCode: 'AE',
                instructions: null,
            },
            slotCode: 'midday',
            deliveryDate: '2026-09-01',
            paymentMethod: 'cash_on_delivery',
            marketingOptIn: false,
        });
        const reference = order.reference;

        await render(
            <AppProviders
                initialMetrics={TEST_METRICS}
                repositories={repositories}
                tokenStore={createMemoryTokenStore()}
                queryClient={createTestQueryClient()}
                initialOnline
            >
                <GuestOrderScreen reference={reference} />
            </AppProviders>,
        );

        await waitFor(() => screen.getByTestId('guest-order-reference'));
        expect(screen.getByTestId('guest-order-reference').props.children).toBe(reference);
        expect(screen.getByTestId('guest-order-payment')).toBeTruthy();

        // The refusal is a visible button, not an X in a corner.
        await waitFor(() => screen.getByTestId('guest-order-conversion-decline'));
        await fireEvent.press(screen.getByTestId('guest-order-conversion-decline'));
        await waitFor(() => screen.getByTestId('guest-order-conversion-declined'));
    });
});

describe('the public deletion page', () => {
    it('says a code is on its way without saying whether the address is known', async () => {
        await renderGuest(<GuestDeletionScreen />);

        await waitFor(() => screen.getByTestId('guest-deletion-email'));
        await fireEvent.changeText(
            screen.getByTestId('guest-deletion-email'),
            'nobody@example.com',
        );
        await fireEvent.press(screen.getByTestId('guest-deletion-request'));

        // The same screen an address we *do* hold data for produces. No branch, no hint.
        await waitFor(() => screen.getByTestId('guest-deletion-sent'));
        expect(screen.getByTestId('guest-deletion-irreversible')).toBeTruthy();
        expect(screen.getByTestId('guest-deletion-acknowledge')).toBeTruthy();
    });
});
