import { ApiError, apiFailure } from '@healthy360/api-client';
import { otpInvalidFailure } from '@healthy360/api-client/contracts';
import type {
    Cart,
    CartItem,
    CheckoutPreview,
    GuestContact,
    GuestConversionPrefill,
    GuestDeletionAcknowledgement,
    GuestDeletionOutcome,
    GuestOrder,
    GuestSession,
    Kitchen,
    KitchenBranch,
    OtpChallenge,
} from '@healthy360/api-client/contracts';
import { fireEvent, screen, waitFor } from '@testing-library/react-native';
import type { ReactNode } from 'react';

import { appGuestTokenStore } from '../../session/guest-storage.ts';
import { renderStubScreen } from '../../testing/stub-screen.tsx';
import { validateGuestContact } from './contact.ts';
import { GuestCheckoutScreen } from './screens/guest-checkout-screen.tsx';
import { GuestDeletionScreen } from './screens/guest-deletion-screen.tsx';
import { GuestOrderScreen } from './screens/guest-order-screen.tsx';

/**
 * The G1 guest journey, against a world this file authors.
 *
 * The fixture world is gone, and with it the option of asserting a *repository's* state machine —
 * so every guarantee below is now stated where it is actually owned. The three contract rules the
 * old suite proved by driving the mock store — an order is refused until the session says it may be
 * placed, a dead token produces one refusal, erasure answers identically for an address we hold
 * nothing for — are proved here against the screens that have to honour them, over stub
 * repositories that answer exactly what the test declares and reject loudly for anything it did
 * not.
 *
 * Two mechanics are worth stating because they replace something the mock did for free.
 *
 * **The guest token store is the application's, not the harness's.** `data/guest-hooks.ts` imports
 * `appGuestTokenStore` directly rather than taking it off the repository bundle, so a stub
 * `startSession` cannot mint one. Every screen path that needs a live token therefore writes it
 * here, and `beforeEach` clears it — the store caches in memory, so clearing `sessionStorage` alone
 * would leak a token from one test into the next.
 *
 * **The passcode is ours.** There is no `MOCK_OTP_CODE` any more and nothing about the code is
 * special: the challenge this file authors says its codes are six digits long, the panel enables
 * its submit at six, and whether the code is right is whatever the stubbed `confirmContact` says.
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

/* ══ the world this suite authors ══════════════════════════════════════════════════════════════ */

/** The one code this suite uses. Six digits, because the authored challenge says six. */
const CODE = '424242';
const SERVED_AREA = 'Business Bay';
const UNSERVED_AREA = 'Ras Al Khaimah Free Zone';

function money(amount: number): CartItem['unitPrice'] {
    return { amount, currency: 'AED' };
}

function cartItem(overrides: Partial<CartItem> = {}): CartItem {
    return {
        id: 'cart-line-1',
        mealId: 'meal-0001' as CartItem['mealId'],
        kitchenId: 'kitchen-0001' as CartItem['kitchenId'],
        name: 'Grilled halloumi bowl',
        quantity: 1,
        unitPrice: money(4200),
        lineTotal: money(4200),
        allergens: [],
        deliveryDate: null,
        ...overrides,
    };
}

function testCart(overrides: Partial<Cart> = {}): Cart {
    const items = overrides.items ?? [cartItem()];
    return {
        id: 'cart-0001' as Cart['id'],
        subtotal: money(4200),
        itemCount: items.length,
        updatedAt: '2026-08-11T09:00:00.000Z',
        ...overrides,
        items,
    };
}

function testPreview(overrides: Partial<CheckoutPreview> = {}): CheckoutPreview {
    return {
        cartId: 'cart-0001' as CheckoutPreview['cartId'],
        lines: [
            { code: 'subtotal', label: 'Subtotal', amount: money(4200) },
            { code: 'delivery', label: 'Delivery', amount: money(800) },
        ],
        subtotal: money(4200),
        deliveryFee: money(800),
        discount: null,
        total: money(5000),
        earliestDeliveryDate: '2026-08-13',
        warnings: [],
        paymentDeferred: true,
        ...overrides,
    };
}

/** A kitchen whose one active branch publishes exactly the areas the caller names. */
function testKitchen(areas: readonly string[] = [SERVED_AREA]): Kitchen {
    const branch: KitchenBranch = {
        id: 'kitchen-branch-0001' as KitchenBranch['id'],
        kitchenId: 'kitchen-0001' as KitchenBranch['kitchenId'],
        name: 'Business Bay kitchen',
        area: SERVED_AREA,
        countryCode: 'AE',
        timeZone: 'Asia/Dubai',
        deliveryZones: areas.map((area, index) => ({
            id: `delivery-zone-${String(index + 1)}` as KitchenBranch['deliveryZones'][number]['id'],
            name: `${area} zone`,
            area,
            countryCode: 'AE',
            deliveryFee: money(800),
            minimumOrder: null,
            estimatedMinutes: 45,
        })),
        openingHours: [],
        supportsPickup: false,
        isActive: true,
    };

    return {
        id: 'kitchen-0001' as Kitchen['id'],
        name: 'Green Fork',
        slug: 'green-fork',
        tagline: 'Bowls, all day',
        description: 'A test kitchen with published delivery zones.',
        countryCode: 'AE',
        cuisines: ['levantine'],
        dietClassifications: [],
        channels: {
            b2c: true,
            b2b: false,
            marketplace: true,
            pos: false,
            subscription: false,
            delivery: true,
            pickup: false,
            corporate: false,
        },
        branches: [branch],
        // The checkout picks its slots from `DELIVERY_SLOTS`, not from the kitchen, so publishing
        // none here keeps the fallback set — and `midday` — in play.
        deliveryWindows: [],
        rating: 4.6,
        ratingCount: 128,
        imagePlaceholderId: 'kitchen-green-fork',
        isVerified: true,
    };
}

function testGuestContact(overrides: Partial<GuestContact> = {}): GuestContact {
    return {
        id: 'guest-contact-0001',
        email: 'rana@example.com',
        mobile: null,
        maskedDestination: 'r***@example.com',
        fullName: 'Rana Haddad',
        preferredChannel: 'email',
        verified: false,
        verifiedAt: null,
        ...overrides,
    };
}

/** A session at `checkout_draft`: it may build and price a basket, and may not place an order. */
function draftSession(overrides: Partial<GuestSession> = {}): GuestSession {
    return {
        id: 'guest-session-0001',
        token: null,
        grade: 'checkout_draft',
        capabilities: ['build_basket', 'price_basket', 'request_deletion'],
        contactVerified: false,
        contact: null,
        expiresAt: '2026-08-11T11:00:00.000Z',
        dataExpiresAt: '2026-08-18T11:00:00.000Z',
        createdAt: '2026-08-11T09:00:00.000Z',
        ...overrides,
    };
}

/** The same session after a passcode proved the contact — the server's promotion, authored. */
function promotedSession(overrides: Partial<GuestSession> = {}): GuestSession {
    return draftSession({
        grade: 'place_order',
        capabilities: ['build_basket', 'price_basket', 'place_order', 'request_deletion'],
        contactVerified: true,
        contact: testGuestContact({ verified: true, verifiedAt: '2026-08-11T09:05:00.000Z' }),
        ...overrides,
    });
}

function testChallenge(overrides: Partial<OtpChallenge> = {}): OtpChallenge {
    return {
        id: 'otp-challenge-0001',
        purpose: 'guest_order',
        channel: 'email',
        maskedDestination: 'r***@example.com',
        codeLength: 6,
        // Live, so the panel is in its entry state rather than its expired one.
        expiresAt: new Date(Date.now() + 300_000).toISOString(),
        resendCooldownSeconds: 0,
        attemptsRemaining: 5,
        resendsRemaining: 3,
        availableChannels: ['email'],
        simulatedChannels: [],
        ...overrides,
    };
}

function testOrder(overrides: Partial<GuestOrder> = {}): GuestOrder {
    return {
        id: 'guest-order-0001' as GuestOrder['id'],
        reference: 'H360-G000123',
        state: 'placed',
        lines: [
            {
                id: 'guest-order-line-1',
                name: 'Grilled halloumi bowl',
                quantity: 1,
                unitPrice: money(4200),
                lineTotal: money(4200),
            },
        ],
        priceLines: [
            { code: 'subtotal', label: 'Subtotal', amount: money(4200) },
            { code: 'delivery', label: 'Delivery', amount: money(800) },
        ],
        total: money(5000),
        paymentMethod: 'cash_on_delivery',
        address: {
            label: 'Home',
            line1: '12 Sunset Street',
            line2: null,
            area: SERVED_AREA,
            city: 'Dubai',
            countryCode: 'AE',
            instructions: null,
        },
        slotCode: 'midday',
        deliveryDate: '2026-08-13',
        contact: testGuestContact({ verified: true, verifiedAt: '2026-08-11T09:05:00.000Z' }),
        placedAt: '2026-08-11T09:10:00.000Z',
        ...overrides,
    };
}

function testPrefill(overrides: Partial<GuestConversionPrefill> = {}): GuestConversionPrefill {
    return {
        fullName: 'Rana Haddad',
        email: 'rana@example.com',
        mobile: null,
        contactVerified: true,
        orderReferences: ['H360-G000123'],
        ...overrides,
    };
}

/**
 * Every field derived from the request, and **no challenge identifier** — the contract's answer is
 * the same whether or not there is anything to delete, so this builder cannot express a difference.
 */
function testAcknowledgement(
    overrides: Partial<GuestDeletionAcknowledgement> = {},
): GuestDeletionAcknowledgement {
    return {
        accepted: true,
        destinationMasked: 'n***y@example.com',
        verificationRequired: true,
        expiresInSeconds: 300,
        codeLength: 6,
        ...overrides,
    };
}

function testDeletionOutcome(overrides: Partial<GuestDeletionOutcome> = {}): GuestDeletionOutcome {
    return {
        accepted: true,
        completedAt: '2026-08-11T09:20:00.000Z',
        marketingSuppressed: true,
        ...overrides,
    };
}

/** The three reads every checkout render makes before a person touches anything. */
function checkoutBackdrop(areas: readonly string[] = [SERVED_AREA]) {
    return {
        commerce: {
            getCart: async () => testCart(),
            previewCheckout: async () => testPreview(),
        },
        marketplace: { getKitchen: async () => testKitchen(areas) },
    };
}

/** Contact step → address step. Shared by every checkout case that gets past step one. */
async function fillContactStep(): Promise<void> {
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
}

/** Address step → verify step, with an area the authored kitchen delivers to. */
async function fillAddressStep(area: string = SERVED_AREA): Promise<void> {
    for (const [field, value] of [
        ['label', 'Home'],
        ['line1', '12 Sunset Street'],
        ['area', area],
        ['city', 'Dubai'],
        ['countryCode', 'AE'],
    ] as const) {
        await fireEvent.changeText(screen.getByTestId(`guest-checkout-address-${field}`), value);
    }
    await fireEvent.press(screen.getByTestId('guest-checkout-address-continue'));
    await waitFor(() => screen.getByTestId('guest-checkout-challenge-code-input'));
}

/** Verify step → review step. The passcode gate; until it is answered there is no review. */
async function answerPasscode(): Promise<void> {
    await fireEvent.changeText(screen.getByTestId('guest-checkout-challenge-code-input'), CODE);
    await fireEvent.press(screen.getByTestId('guest-checkout-challenge-submit'));
    await waitFor(() => screen.getByTestId('guest-checkout-marketing'));
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

/* ══ the session's grade, as the screen reads it ═══════════════════════════════════════════════ */

describe('the guest session', () => {
    /**
     * The gate is the *server's* answer, and this is where it is now stated.
     *
     * The old version of this case drove the fixture repository — start a session, give a contact,
     * enter the code, watch the grade rise — and asserted the *world's* refusal. There is no world
     * to refuse any more, so the refusal is asserted where it is actually load-bearing: the review
     * step of a checkout whose session came back **still unpromoted**. That is a real answer, not a
     * contrived one — the contract carries `capabilities` beside `grade` precisely because the
     * server may withhold placement for a reason the grade does not express (a suspended account, a
     * market that is closed, a retention window that has run out).
     */
    it('refuses to place an order until the session says a passcode has proven the contact', async () => {
        const { repositories } = await renderStubScreen(<GuestCheckoutScreen />, {
            repositories: {
                ...checkoutBackdrop(),
                guest: {
                    startSession: async () => draftSession(),
                    updateContact: async () => ({
                        contact: testGuestContact(),
                        challenge: testChallenge(),
                    }),
                    getChallenge: async () => testChallenge(),
                    // Proven, and still not promoted.
                    confirmContact: async () =>
                        draftSession({
                            contactVerified: true,
                            contact: testGuestContact({ verified: true }),
                        }),
                },
            },
        });

        await fillContactStep();
        await fillAddressStep();
        await answerPasscode();

        expect(screen.getByTestId('guest-checkout-unverified')).toBeTruthy();
        expect(screen.getByTestId('guest-checkout-place').props.accessibilityState).toMatchObject({
            disabled: true,
        });

        await fireEvent.press(screen.getByTestId('guest-checkout-place'));
        expect(repositories.guest.placeOrder).not.toHaveBeenCalled();
    });

    /**
     * One refusal for a dead token, whatever killed it — and the client's half of that bargain.
     *
     * `getSession` answers `auth.unauthenticated` for four causes and deliberately says which is
     * not one of them, so there is nothing to distinguish and nothing to retry. The hooks state
     * that as `retry: false` and as *not* clearing the credential: the recovery is a step the
     * screen offers, not something the data layer does behind it.
     */
    it('answers one refusal for a dead token, and neither retries it nor clears it', async () => {
        appGuestTokenStore.set('gst_dead-token');

        const { repositories } = await renderStubScreen(<GuestCheckoutScreen />, {
            repositories: {
                ...checkoutBackdrop(),
                guest: {
                    getSession: async () => {
                        throw new ApiError(apiFailure('auth.unauthenticated'));
                    },
                },
            },
        });

        await waitFor(() => screen.getByTestId('guest-checkout-session-expired'));

        expect(repositories.guest.getSession).toHaveBeenCalledTimes(1);
        expect(appGuestTokenStore.get()).toBe('gst_dead-token');
    });
});

/* ══ the screens ═══════════════════════════════════════════════════════════════════════════════ */

describe('the guest checkout', () => {
    it('will not carry on to an area the kitchen does not deliver to', async () => {
        await renderStubScreen(<GuestCheckoutScreen />, {
            repositories: {
                ...checkoutBackdrop([SERVED_AREA]),
                guest: {
                    startSession: async () => draftSession(),
                    updateContact: async () => ({
                        contact: testGuestContact(),
                        challenge: testChallenge(),
                    }),
                },
            },
        });

        await fillContactStep();
        await fireEvent.changeText(
            screen.getByTestId('guest-checkout-address-area'),
            UNSERVED_AREA,
        );

        // A hard stop: the notice appears and the only way on is disabled. There is deliberately no
        // "continue anyway" control to look for.
        await waitFor(() => screen.getByTestId('guest-checkout-out-of-zone'));
        expect(
            screen.getByTestId('guest-checkout-address-continue').props.accessibilityState,
        ).toMatchObject({ disabled: true });
    });

    it('places the order with marketing off unless it was turned on, and confirms with a reference', async () => {
        const { repositories } = await renderStubScreen(<GuestCheckoutScreen />, {
            repositories: {
                ...checkoutBackdrop(),
                guest: {
                    startSession: async () => draftSession(),
                    updateContact: async () => ({
                        contact: testGuestContact(),
                        challenge: testChallenge(),
                    }),
                    getChallenge: async () => testChallenge(),
                    confirmContact: async () => promotedSession(),
                    placeOrder: async () => testOrder(),
                },
            },
        });

        await fillContactStep();
        await fillAddressStep();
        await answerPasscode();

        // Off unless turned on — and it is *not* touched here, so the order carries `false`.
        expect(
            screen.getByTestId('guest-checkout-marketing-control').props.accessibilityState
                ?.checked,
        ).toBe(false);
        expect(screen.getByTestId('guest-checkout-payment')).toBeTruthy();

        await fireEvent.press(screen.getByTestId('guest-checkout-place'));

        await waitFor(() => {
            expect(routerMock.__push).toHaveBeenCalledWith('/orders/H360-G000123');
        });

        // "Off" is *sent*, not omitted — the two readings of an absent opt-in must never be
        // distinguishable to the server. And there is nowhere on this draft for a card to go.
        expect(repositories.guest.placeOrder).toHaveBeenCalledWith({
            cartId: 'cart-0001',
            address: {
                label: 'Home',
                line1: '12 Sunset Street',
                line2: null,
                area: SERVED_AREA,
                city: 'Dubai',
                countryCode: 'AE',
                instructions: null,
            },
            slotCode: 'midday',
            deliveryDate: expect.any(String),
            paymentMethod: 'cash_on_delivery',
            marketingOptIn: false,
        });
    });

    it('recovers a timed-out session to the first step instead of showing an error page', async () => {
        // A token that is still in the store while the server has already stopped honouring it —
        // the exact state a person returning to a backgrounded tab is in.
        appGuestTokenStore.set('gst_dead-token');

        await renderStubScreen(<GuestCheckoutScreen />, {
            repositories: {
                ...checkoutBackdrop(),
                guest: {
                    getSession: async () => {
                        throw new ApiError(apiFailure('auth.unauthenticated'));
                    },
                },
            },
        });

        await waitFor(() => screen.getByTestId('guest-checkout-session-expired'));
        // The basket is untouched: losing the session must not look like losing the order.
        expect(screen.getByTestId('guest-checkout-contact')).toBeTruthy();
        expect(screen.getByTestId('guest-checkout-session-restart')).toBeTruthy();

        await fireEvent.press(screen.getByTestId('guest-checkout-session-restart'));
        expect(screen.getByTestId('guest-checkout-contact')).toBeTruthy();
    });
});

describe('the confirmation', () => {
    it('leads with the reference and offers a refusable conversion prompt', async () => {
        // Only offered to somebody who still holds the session that placed the order. The token is
        // written here because the hooks read the application's store, not the repository bundle.
        appGuestTokenStore.set('gst_live-token');

        const order = testOrder();

        await renderStubScreen(<GuestOrderScreen reference={order.reference} />, {
            repositories: {
                guest: {
                    getOrder: async () => order,
                    getConversionPrefill: async () => testPrefill(),
                },
            },
        });

        await waitFor(() => screen.getByTestId('guest-order-reference'));
        expect(screen.getByTestId('guest-order-reference').props.children).toBe(order.reference);
        expect(screen.getByTestId('guest-order-payment')).toBeTruthy();

        // The refusal is a visible button, not an X in a corner.
        await waitFor(() => screen.getByTestId('guest-order-conversion-decline'));
        await fireEvent.press(screen.getByTestId('guest-order-conversion-decline'));
        await waitFor(() => screen.getByTestId('guest-order-conversion-declined'));
    });
});

describe('the public deletion page', () => {
    it('says a code is on its way without saying whether the address is known', async () => {
        const { repositories } = await renderStubScreen(<GuestDeletionScreen />, {
            repositories: { guest: { requestDeletion: async () => testAcknowledgement() } },
        });

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

        // And nothing beyond the address was asked for or sent.
        expect(repositories.guest.requestDeletion).toHaveBeenCalledWith({
            email: 'nobody@example.com',
        });
    });

    /**
     * The refusal half of the enumeration guarantee.
     *
     * A code entered against an address nobody holds data for fails the way a wrong code fails, and
     * the screen adds nothing: it shows its own fixed copy rather than the server's sentence, so
     * there is no message for a prober to read a difference out of.
     */
    it('fails a code against an unknown address the way a wrong code fails, and says no more', async () => {
        const serverMessage = 'No deletion challenge exists for nobody@example.com.';

        const { repositories } = await renderStubScreen(<GuestDeletionScreen />, {
            repositories: {
                guest: {
                    requestDeletion: async () => testAcknowledgement(),
                    confirmDeletion: async () => {
                        throw new ApiError(otpInvalidFailure(2, { message: serverMessage }));
                    },
                },
            },
        });

        await waitFor(() => screen.getByTestId('guest-deletion-email'));
        await fireEvent.changeText(
            screen.getByTestId('guest-deletion-email'),
            'nobody@example.com',
        );
        await fireEvent.press(screen.getByTestId('guest-deletion-request'));

        await waitFor(() => screen.getByTestId('guest-deletion-sent'));
        await fireEvent.changeText(screen.getByTestId('guest-deletion-code-input'), CODE);
        await fireEvent.press(screen.getByTestId('guest-deletion-acknowledge-control'));
        await fireEvent.press(screen.getByTestId('guest-deletion-confirm'));

        await waitFor(() => screen.getByTestId('guest-deletion-confirm-error'));
        expect(repositories.guest.confirmDeletion).toHaveBeenCalledWith({
            email: 'nobody@example.com',
            code: CODE,
        });
        // Still on the confirm step, and the server's sentence never reaches the page.
        expect(screen.queryByTestId('guest-deletion-done')).toBeNull();
        expect(screen.queryByText(serverMessage)).toBeNull();
    });

    it('purges what the device holds and still says what erasure must not take with it', async () => {
        appGuestTokenStore.set('gst_live-token');

        const { repositories } = await renderStubScreen(<GuestDeletionScreen />, {
            repositories: {
                guest: {
                    requestDeletion: async () =>
                        testAcknowledgement({
                            destinationMasked: 'r***@example.com',
                        }),
                    confirmDeletion: async () => testDeletionOutcome(),
                },
            },
        });

        await waitFor(() => screen.getByTestId('guest-deletion-email'));
        await fireEvent.changeText(screen.getByTestId('guest-deletion-email'), 'rana@example.com');
        await fireEvent.press(screen.getByTestId('guest-deletion-request'));

        await waitFor(() => screen.getByTestId('guest-deletion-sent'));
        await fireEvent.changeText(screen.getByTestId('guest-deletion-code-input'), CODE);
        await fireEvent.press(screen.getByTestId('guest-deletion-acknowledge-control'));
        await fireEvent.press(screen.getByTestId('guest-deletion-confirm'));

        await waitFor(() => screen.getByTestId('guest-deletion-done'));
        expect(repositories.guest.confirmDeletion).toHaveBeenCalledWith({
            email: 'rana@example.com',
            code: CODE,
        });
        expect(screen.getByTestId('guest-deletion-done-callout')).toBeTruthy();
        // The one record kept in the person's own interest, said on the success screen.
        expect(screen.getByTestId('guest-deletion-suppression-note')).toBeTruthy();
        // And the interface keeps no copy of what was just erased.
        expect(appGuestTokenStore.get()).toBeNull();
    });
});
