import type {
    AccountChecklistItem,
    AccountOverview,
    AccountServiceArea,
    AccountSetupChecklist,
    ConsentState,
    ContactPoint,
    CustomerAccount,
    CustomerAddress,
    DietaryProfile,
    OtpChallenge,
    OtpVerificationResult,
} from '@healthy360/api-client/contracts';
import { ApiError, conflictFailure } from '@healthy360/api-client/contracts';
import type { CursorPage, PlacedOrder } from '@healthy360/api-client/contracts';
import { OrderId } from '@healthy360/domain-types';
import type { ServiceAreaId } from '@healthy360/domain-types';
import { fireEvent, screen, waitFor } from '@testing-library/react-native';
import type { ReactNode } from 'react';

import { testMeResponse } from '../../testing/session-fixtures.ts';
import { renderStubScreen } from '../../testing/stub-screen.tsx';
import { consentStatus } from './consents.ts';
import { initialAllergyAnswer } from './dietary.ts';
import { toE164, validatePhone } from './phone.ts';
import { AccountScreen } from './screens/account-screen.tsx';
import { AddressEditorScreen } from './screens/address-editor-screen.tsx';
import { AllergiesScreen } from './screens/allergies-screen.tsx';
import { ConsentsScreen } from './screens/consents-screen.tsx';
import { PhoneScreen } from './screens/phone-screen.tsx';

/**
 * The J1 account area, against the stub harness.
 *
 * Every fact these screens draw is now *authored by the test* and handed over as a repository
 * answer, rather than fished out of a seeded fixture world. That is the whole point of the
 * migration: a checklist assertion used to depend on what `consumer-account-setup` happened to
 * contain, so "two steps outstanding" was a fact about a fixture. Here the checklist is written a
 * few lines above the assertion and the count is derived from it — if the two disagree, the test is
 * wrong rather than the world having moved.
 *
 * Where a case previously reached into a mock store to *observe* a write (`listConsents()` after a
 * toggle), the equivalent here is a closure variable the override reads: the screen's own
 * invalidation refetches it, so the assertion is still "the screen shows what the server now says"
 * rather than "the mutation function was called". Both are asserted where both are meaningful.
 *
 * What no longer belongs to this suite: the OTP expiry, the attempt budget, the cooldown and the
 * supersession rule were the mock store's mechanics. They are backend behaviour, and a screen test
 * can only assert what the screen does with the answers — which is what the phone cases below do.
 */

jest.mock('expo-router', () => {
    const push = jest.fn();
    return {
        __esModule: true,
        useRouter: () => ({ push, replace: jest.fn(), setParams: jest.fn(), back: jest.fn() }),
        usePathname: () => '/customer/account',
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
});

/* ══ authored entities ═════════════════════════════════════════════════════════════════════════ */

const NOW = '2026-08-11T09:00:00.000Z';

function customerAccount(overrides: Partial<CustomerAccount> = {}): CustomerAccount {
    return {
        id: 'account-0001',
        lifecycle: 'provisional',
        displayName: 'Test Person',
        loginEmail: 'test.person@example.test',
        locale: 'en',
        createdAt: '2026-07-01T09:00:00.000Z',
        activatedAt: null,
        ...overrides,
    };
}

function step(
    name: AccountChecklistItem['step'],
    complete: boolean,
    required: boolean,
    blockedReason: string | null = null,
): AccountChecklistItem {
    return { step: name, complete, required, blockedReason };
}

function checklist(
    items: readonly AccountChecklistItem[],
    overrides: Partial<AccountSetupChecklist> = {},
): AccountSetupChecklist {
    return { lifecycle: 'provisional', items, canActivate: false, ...overrides };
}

function overview(
    setup: AccountSetupChecklist,
    contacts: readonly ContactPoint[] = [],
): AccountOverview {
    return {
        account: customerAccount({ lifecycle: setup.lifecycle }),
        contacts,
        checklist: setup,
    };
}

interface ConsentOverrides {
    readonly required?: boolean;
    readonly granted?: boolean;
    readonly grantedAt?: string | null;
    readonly withdrawnAt?: string | null;
    readonly title?: string;
    readonly text?: string;
}

function consent(key: string, overrides: ConsentOverrides = {}): ConsentState {
    const granted = overrides.granted ?? false;
    return {
        definition: {
            key,
            version: '2026-01',
            title: overrides.title ?? `Consent ${key}`,
            text: overrides.text ?? `The full authored text of ${key}.`,
            required: overrides.required ?? false,
        },
        granted,
        grantedAt: overrides.grantedAt ?? (granted ? NOW : null),
        withdrawnAt: overrides.withdrawnAt ?? null,
    };
}

/** Flip one consent, the way a server would: agreeing stamps a date, withdrawing stamps the other. */
function applyConsent(
    consents: readonly ConsentState[],
    key: string,
    granted: boolean,
): readonly ConsentState[] {
    return consents.map((entry) =>
        entry.definition.key === key
            ? {
                  ...entry,
                  granted,
                  grantedAt: granted ? NOW : entry.grantedAt,
                  withdrawnAt: granted ? null : NOW,
              }
            : entry,
    );
}

function serviceArea(ordinal: number, name: string): AccountServiceArea {
    return { id: `area-${String(ordinal)}` as ServiceAreaId, name };
}

function phoneContact(overrides: Partial<ContactPoint> = {}): ContactPoint {
    return {
        id: 'contact-phone-1',
        kind: 'phone',
        value: '+971501234567',
        maskedValue: '+971 50 *** 4567',
        verified: false,
        verifiedAt: null,
        isPrimary: true,
        isLoginEmail: false,
        createdAt: '2026-07-01T09:00:00.000Z',
        ...overrides,
    };
}

function otpChallenge(overrides: Partial<OtpChallenge> = {}): OtpChallenge {
    return {
        id: 'challenge-1',
        purpose: 'contact_verification',
        channel: 'sms',
        maskedDestination: '+971 50 *** 4567',
        codeLength: 6,
        // A live challenge, in real time: the panel closes entry once the expiry has run out, so a
        // fixed past timestamp would silently disable the submit button.
        expiresAt: new Date(Date.now() + 300_000).toISOString(),
        resendCooldownSeconds: 0,
        attemptsRemaining: 3,
        resendsRemaining: 2,
        availableChannels: ['sms'],
        simulatedChannels: [],
        ...overrides,
    };
}

const TEST_CODE = '424242';

function dietaryProfile(overrides: Partial<DietaryProfile> = {}): DietaryProfile {
    return {
        dietCategoryCode: null,
        allergens: [],
        excludedIngredientIds: [],
        updatedAt: null,
        ...overrides,
    };
}

const NO_ORDERS: CursorPage<PlacedOrder> = {
    items: [],
    nextCursor: null,
    hasMore: false,
    totalCount: null,
};

function placedOrder(overrides: Partial<PlacedOrder> = {}): PlacedOrder {
    return {
        id: OrderId.unsafe('0198c5f2-7d3a-7b1e-9c4d-2f6a8b0e8aa1'),
        reference: 'H360-1042',
        state: 'confirmed',
        lines: [
            {
                id: 'line-1',
                name: 'Chicken Shawarma',
                quantity: 2,
                unitPrice: { amount: 3000, currency: 'AED' },
                lineTotal: { amount: 6000, currency: 'AED' },
            },
        ],
        priceLines: [
            { code: 'subtotal', label: 'Subtotal', amount: { amount: 6000, currency: 'AED' } },
        ],
        total: { amount: 6000, currency: 'AED' },
        address: {
            label: 'Home',
            line1: '12 Al Wasl Road',
            line2: null,
            area: 'Al Quoz',
            city: 'Dubai',
            countryCode: '',
            instructions: null,
        },
        slotCode: 'morning',
        deliveryDate: '2026-08-05',
        placedAt: '2026-08-03T09:10:00.000Z',
        ...overrides,
    };
}

/* ══ pure decisions ════════════════════════════════════════════════════════════════════════════ */

describe('phone composition', () => {
    it('drops the domestic trunk prefix and refuses what cannot be a number', () => {
        expect(toE164('+971', '050 123 4567')).toBe('+971501234567');
        expect(toE164('+961', '3 123 456')).toBe('+9613123456');
        expect(validatePhone('+971', '')).toBe('account:phone.errors.empty');
        expect(validatePhone('+971', '12')).toBe('account:phone.errors.tooShort');
        expect(validatePhone('+971', '0501234567')).toBeNull();
    });
});

describe('the four consent states', () => {
    /** The one that matters: agreed once, not agreed now, never withdrew — the text changed. */
    it('tells re-consent apart from a withdrawal and from never having agreed', () => {
        const definition = {
            key: 'terms_of_service',
            version: '2026-02',
            title: 'Terms',
            text: '…',
            required: true,
        };
        expect(
            consentStatus({
                definition,
                granted: true,
                grantedAt: '2026-01-01',
                withdrawnAt: null,
            }),
        ).toBe('granted');
        expect(
            consentStatus({
                definition,
                granted: false,
                grantedAt: '2026-01-01',
                withdrawnAt: null,
            }),
        ).toBe('reconsent');
        expect(
            consentStatus({
                definition,
                granted: false,
                grantedAt: '2026-01-01',
                withdrawnAt: '2026-02-01',
            }),
        ).toBe('withdrawn');
        expect(
            consentStatus({ definition, granted: false, grantedAt: null, withdrawnAt: null }),
        ).toBe('never');
    });

    /** "No allergies" is an answer; an empty profile that was never saved is silence. */
    it('distinguishes an unanswered allergy question from a declared absence', () => {
        const empty = { dietCategoryCode: null, allergens: [], excludedIngredientIds: [] };
        expect(initialAllergyAnswer({ ...empty, updatedAt: null })).toBeNull();
        expect(initialAllergyAnswer({ ...empty, updatedAt: '2026-08-02T10:00:00.000Z' })).toBe(
            false,
        );
    });
});

/* ══ the checklist ═════════════════════════════════════════════════════════════════════════════ */

describe('AccountScreen', () => {
    it('draws the design’s six sections in the design’s order', async () => {
        await renderStubScreen(<AccountScreen />, {
            session: testMeResponse(),
            repositories: {
                account: {
                    getOverview: async () =>
                        overview(checklist([], { lifecycle: 'active', canActivate: true })),
                },
                commerce: { listMyOrders: async () => NO_ORDERS },
            },
        });

        expect(await screen.findByTestId('account-orders-states-empty')).toBeTruthy();
        const expected = [
            ['orders', 'Orders'],
            ['favorites', 'Favorites'],
            ['profile', 'Profile'],
            ['addresses', 'Addresses'],
            ['payments', 'Payment methods'],
            ['notifications', 'Notifications'],
        ] as const;
        for (const [section, label] of expected) {
            expect(screen.getByTestId(`account-tab-${section}`)).toHaveTextContent(label);
        }
        expect(screen.getByTestId('account-tab-orders').props.accessibilityState.selected).toBe(
            true,
        );
        // Nothing outstanding: no setup notice anywhere.
        expect(screen.queryByTestId('account-activation')).toBeNull();
    });

    it('folds the server’s outstanding required steps into one notice, without recomputing them', async () => {
        // Two required steps outstanding — and the notice's count is asserted against that
        // number rather than against whatever a fixture happened to seed.
        const setup = checklist([
            step('verify_email', true, true),
            // The server says phone verification does not block activation in this environment.
            step('verify_phone', false, false),
            step('add_address', false, true),
            step('dietary_profile', false, false),
            step('consents', false, true, 'Waiting for the new terms'),
        ]);

        await renderStubScreen(<AccountScreen />, {
            session: testMeResponse(),
            repositories: {
                account: {
                    getOverview: async () => overview(setup),
                    listConsents: async () => [],
                },
                commerce: { listMyOrders: async () => NO_ORDERS },
            },
        });

        const notice = await screen.findByTestId('account-activation');
        expect(notice).toHaveTextContent(/required steps are still outstanding/);
        expect(notice).toHaveTextContent(/2 required steps to go/);

        // A button per outstanding *required* step. Optional and finished steps are not in the
        // notice — the server's `required` is what decides, not the client.
        expect(screen.getByTestId('account-step-add_address-open')).toBeTruthy();
        expect(screen.queryByTestId('account-step-verify_phone-open')).toBeNull();
        expect(screen.queryByTestId('account-step-verify_email-open')).toBeNull();
        expect(screen.queryByTestId('account-step-dietary_profile-open')).toBeNull();

        // A blocked step cannot be started, and says why in the server's words.
        expect(
            screen.getByTestId('account-step-consents-open').props.accessibilityState.disabled,
        ).toBe(true);
        expect(screen.getByTestId('account-step-consents-blocked')).toHaveTextContent(
            /Waiting for the new terms/,
        );

        await fireEvent.press(screen.getByTestId('account-step-add_address-open'));
        expect(routerMock.__push).toHaveBeenCalledWith('/customer/account/addresses');

        // The notice stays above whichever section is open.
        await fireEvent.press(screen.getByTestId('account-tab-payments'));
        expect(await screen.findByTestId('account-payments-cash')).toHaveTextContent(
            'Cash on delivery',
        );
        expect(screen.getByTestId('account-activation')).toBeTruthy();
    });

    it('reports nothing outstanding once the evaluator says the account can activate', async () => {
        const setup = checklist(
            [
                step('verify_email', true, true),
                step('verify_phone', false, false),
                step('add_address', true, true),
                step('dietary_profile', true, false),
                step('consents', true, true),
            ],
            { lifecycle: 'active', canActivate: true },
        );

        await renderStubScreen(<AccountScreen />, {
            session: testMeResponse(),
            repositories: {
                account: {
                    getOverview: async () => overview(setup),
                    listConsents: async () => [],
                },
                commerce: { listMyOrders: async () => NO_ORDERS },
            },
        });

        expect(await screen.findByTestId('account-orders-states-empty')).toBeTruthy();
        expect(screen.queryByTestId('account-activation')).toBeNull();
    });

    it('offers the marketing consents as switches and writes them straight through', async () => {
        let consents: readonly ConsentState[] = [
            consent('terms_of_service', { required: true, granted: true }),
            consent('marketing_email', { required: false, granted: false }),
            consent('marketing_sms', { required: false, granted: false }),
        ];

        const { repositories } = await renderStubScreen(<AccountScreen />, {
            session: testMeResponse(),
            repositories: {
                account: {
                    getOverview: async () => overview(checklist([step('consents', true, true)])),
                    listConsents: async () => consents,
                    setConsent: async ({ key, granted }) => {
                        consents = applyConsent(consents, key, granted);
                        const written = consents.find((entry) => entry.definition.key === key);
                        if (written === undefined) throw new Error(`No consent ${key}.`);
                        return written;
                    },
                },
                commerce: { listMyOrders: async () => NO_ORDERS },
            },
        });

        await fireEvent.press(await screen.findByTestId('account-tab-notifications'));
        expect(await screen.findByTestId('account-marketing-title')).toHaveTextContent(
            'Notifications',
        );

        // Only the optional `marketing_*` consents belong here; the required one stays on the
        // compliance screen.
        expect(await screen.findByTestId('account-marketing-marketing_email')).toBeTruthy();
        expect(screen.queryByTestId('account-marketing-terms_of_service')).toBeNull();

        await fireEvent.press(screen.getByTestId('account-marketing-marketing_email-control'));

        expect(repositories.account.setConsent).toHaveBeenCalledWith({
            key: 'marketing_email',
            granted: true,
        });

        // And the screen shows what the server now says, having refetched on its own invalidation.
        await waitFor(() => {
            expect(
                screen.getByTestId('account-marketing-marketing_email-control').props
                    .accessibilityState.checked,
            ).toBe(true);
        });
    });
});

describe('AccountScreen — orders', () => {
    const active = checklist([step('verify_email', true, true)], {
        lifecycle: 'active',
        canActivate: true,
    });

    it('lists the history with the tracking page’s status tones, and opens an order', async () => {
        const delivered = placedOrder({
            id: OrderId.unsafe('0198c5f2-7d3a-7b1e-9c4d-2f6a8b0e8aa2'),
            reference: 'H360-1043',
            state: 'delivered',
        });
        const { repositories } = await renderStubScreen(<AccountScreen />, {
            session: testMeResponse(),
            repositories: {
                account: { getOverview: async () => overview(active) },
                commerce: {
                    listMyOrders: async () => ({
                        items: [delivered, placedOrder()],
                        nextCursor: null,
                        hasMore: false,
                        totalCount: null,
                    }),
                },
            },
        });

        const row = `account-orders-row-${String(delivered.id)}`;
        expect(await screen.findByTestId(`${row}-items`)).toHaveTextContent('2× Chicken Shawarma');
        expect(screen.getByTestId(`${row}-meta`)).toHaveTextContent(/#H360-1043/);
        expect(screen.getByTestId(`${row}-state`)).toHaveTextContent(/Delivered/);
        expect(screen.getByTestId(`${row}-total`)).toHaveTextContent(/60/);
        expect(screen.getByTestId(`${row}-thumb`)).toBeTruthy();
        // No "show older": the server said this was the last page.
        expect(screen.queryByTestId('account-orders-more')).toBeNull();
        expect(repositories.commerce.listMyOrders).toHaveBeenCalledWith({ limit: 20 });

        await fireEvent.press(screen.getByTestId(`${row}-open`));
        expect(routerMock.__push).toHaveBeenCalledWith(`/customer/orders/${String(delivered.id)}`);

        // Reorder has no endpoint behind it: it says so and changes nothing.
        await fireEvent.press(screen.getByTestId(`${row}-reorder`));
        expect(await screen.findByTestId('prototype-notice')).toHaveTextContent(/Not built yet/);
        expect(routerMock.__push).toHaveBeenCalledTimes(1);
    });

    it('walks to the next page by the server’s cursor', async () => {
        const older = placedOrder({
            id: OrderId.unsafe('0198c5f2-7d3a-7b1e-9c4d-2f6a8b0e8aa3'),
            reference: 'H360-1001',
        });
        const { repositories } = await renderStubScreen(<AccountScreen />, {
            session: testMeResponse(),
            repositories: {
                account: { getOverview: async () => overview(active) },
                commerce: {
                    listMyOrders: async (filter) =>
                        filter?.cursor === 'page-2'
                            ? { ...NO_ORDERS, items: [older] }
                            : {
                                  items: [placedOrder()],
                                  nextCursor: 'page-2',
                                  hasMore: true,
                                  totalCount: null,
                              },
                },
            },
        });

        await fireEvent.press(await screen.findByTestId('account-orders-more'));

        expect(
            await screen.findByTestId(`account-orders-row-${String(older.id)}-items`),
        ).toBeTruthy();
        expect(repositories.commerce.listMyOrders).toHaveBeenLastCalledWith({
            limit: 20,
            cursor: 'page-2',
        });
    });

    it('opens the favourites section on its honest empty state', async () => {
        await renderStubScreen(<AccountScreen />, {
            session: testMeResponse(),
            repositories: {
                account: { getOverview: async () => overview(active) },
                commerce: { listMyOrders: async () => NO_ORDERS },
            },
        });

        await fireEvent.press(await screen.findByTestId('account-tab-favorites'));
        expect(await screen.findByTestId('account-favorites-empty')).toHaveTextContent(
            /No favorites yet/,
        );
        await fireEvent.press(screen.getByTestId('account-favorites-browse'));
        expect(routerMock.__push).toHaveBeenCalledWith('/meals');
    });
});

describe('AccountScreen — profile', () => {
    const active = checklist([step('verify_email', true, true)], {
        lifecycle: 'active',
        canActivate: true,
    });

    /*
     * Signed in without a customer record — the overview and the dietary profile both refuse. The
     * card's details are the person's own and live in the session, so the card still shows them,
     * and only the diet row, which needs the customer record, says it is not available.
     */
    it('shows the profile from the session when there is no customer record', async () => {
        await renderStubScreen(<AccountScreen />, {
            session: testMeResponse(),
            repositories: {
                account: {
                    getOverview: async () => {
                        throw new Error('You do not have a customer account yet.');
                    },
                    getDietaryProfile: async () => {
                        throw new Error('You do not have a customer account yet.');
                    },
                },
                verification: { listContactPoints: async () => [] },
                commerce: { listMyOrders: async () => NO_ORDERS },
            },
        });

        await fireEvent.press(await screen.findByTestId('account-tab-profile'));
        // The panel is not gated on the session: it draws at once and the fields fill when `/me`
        // answers, so wait on the value rather than on the input.
        await waitFor(() => {
            expect(screen.getByTestId('account-profile-name-input').props.value).toBe(
                'Test Person',
            );
        });
        expect(screen.getByTestId('account-profile-email-input').props.value).toBe(
            'test.person@example.test',
        );
        expect(await screen.findByTestId('account-profile-dietary-unavailable')).toBeTruthy();
    });

    it('will not save a diet for somebody who has not answered the allergy question', async () => {
        await renderStubScreen(<AccountScreen />, {
            session: testMeResponse(),
            repositories: {
                account: {
                    getOverview: async () => overview(active, [phoneContact({ verified: true })]),
                    getDietaryProfile: async () => dietaryProfile(),
                },
                // The phone is read from the person's contact points, not from the overview.
                verification: { listContactPoints: async () => [phoneContact({ verified: true })] },
                commerce: { listMyOrders: async () => NO_ORDERS },
            },
        });

        await fireEvent.press(await screen.findByTestId('account-tab-profile'));
        expect(await screen.findByTestId('account-profile-title')).toHaveTextContent(
            'Profile & preferences',
        );
        await screen.findByText('+971 50 *** 4567');
        // The design's inputs, read-only where the contract has no way to change the value.
        await waitFor(() => {
            expect(screen.getByTestId('account-profile-name-input').props.value).toBe(
                'Test Person',
            );
        });
        const name = screen.getByTestId('account-profile-name-input');
        expect(name.props.readOnly).toBe(true);
        const email = screen.getByTestId('account-profile-email-input');
        expect(email.props.value).toBe('test.person@example.test');
        expect(email.props.readOnly).toBe(true);
        expect(screen.getByTestId('account-profile-phone-value')).toHaveTextContent(
            '+971 50 *** 4567',
        );
        expect(screen.getByTestId('account-profile-phone-state')).toHaveTextContent('Change');
        // No default window on the account: the select is there, and says where it is chosen.
        expect(screen.getByTestId('account-profile-slot')).toHaveTextContent(
            /Chosen at each checkout/,
        );

        // Saving a diet would stamp `updatedAt`, which reads as "no allergies". So the chips and
        // Save are locked, and the way forward is the question itself.
        expect(await screen.findByTestId('account-profile-diets-locked')).toBeTruthy();
        expect(
            screen.getByTestId('account-profile-diets-vegetarian').props.accessibilityState
                .disabled,
        ).toBe(true);
        expect(screen.getByTestId('account-profile-save').props.accessibilityState.disabled).toBe(
            true,
        );

        await fireEvent.press(screen.getByTestId('account-profile-allergies-edit'));
        expect(routerMock.__push).toHaveBeenCalledWith('/customer/account/allergies');

        await fireEvent.press(screen.getByTestId('account-profile-phone-open'));
        expect(routerMock.__push).toHaveBeenCalledWith('/customer/account/phone');
    });

    it('saves a diet change and carries the declared allergens through untouched', async () => {
        const allergens = [{ allergenCode: 'peanuts', severity: 'allergy', note: null }] as const;
        let stored = dietaryProfile({
            allergens,
            updatedAt: '2026-08-02T10:00:00.000Z',
        });

        const { repositories } = await renderStubScreen(<AccountScreen />, {
            session: testMeResponse(),
            repositories: {
                account: {
                    getOverview: async () => overview(active),
                    getDietaryProfile: async () => stored,
                    saveDietaryProfile: async (request) => {
                        stored = { ...request, updatedAt: '2026-08-11T09:00:00.000Z' };
                        return stored;
                    },
                },
                commerce: { listMyOrders: async () => NO_ORDERS },
            },
        });

        await fireEvent.press(await screen.findByTestId('account-tab-profile'));
        expect(await screen.findByTestId('account-profile-allergies')).toHaveTextContent(
            /^Allergies: /,
        );
        const chip = await screen.findByTestId('account-profile-diets-vegetarian');
        await fireEvent.press(chip);
        expect(
            screen.getByTestId('account-profile-diets-vegetarian').props.accessibilityState.checked,
        ).toBe(true);
        // One diet: choosing another replaces it rather than adding to it.
        await fireEvent.press(screen.getByTestId('account-profile-diets-vegan'));
        expect(
            screen.getByTestId('account-profile-diets-vegetarian').props.accessibilityState.checked,
        ).toBe(false);
        await fireEvent.press(screen.getByTestId('account-profile-diets-vegetarian'));
        await fireEvent.press(screen.getByTestId('account-profile-save'));

        await waitFor(() => {
            expect(repositories.account.saveDietaryProfile).toHaveBeenCalledWith({
                dietCategoryCode: 'vegetarian',
                allergens,
                excludedIngredientIds: [],
            });
        });
        expect(await screen.findByTestId('account-profile-saved')).toBeTruthy();
    });

    it('keeps the address book, permissions and closure one press away', async () => {
        await renderStubScreen(<AccountScreen />, {
            session: testMeResponse(),
            repositories: {
                account: {
                    getOverview: async () => overview(active),
                    listAddresses: async () => [],
                    listConsents: async () => [],
                },
                commerce: { listMyOrders: async () => NO_ORDERS },
            },
        });

        await fireEvent.press(await screen.findByTestId('account-tab-addresses'));
        expect(await screen.findByTestId('account-addresses-title')).toHaveTextContent('Addresses');
        await fireEvent.press(await screen.findByTestId('account-addresses-add'));
        expect(routerMock.__push).toHaveBeenCalledWith('/customer/account/addresses/new');

        // Privacy has no section of its own: it sits under the notification switches.
        await fireEvent.press(screen.getByTestId('account-tab-notifications'));
        await fireEvent.press(await screen.findByTestId('account-privacy-consents'));
        expect(routerMock.__push).toHaveBeenCalledWith('/customer/account/consents');
        await fireEvent.press(screen.getByTestId('account-privacy-close'));
        expect(routerMock.__push).toHaveBeenCalledWith('/customer/account/close/reason');
    });
});

/* ══ phone and the one-time code ═══════════════════════════════════════════════════════════════ */

describe('PhoneScreen', () => {
    it('sends a code to the number already on file and confirms it', async () => {
        const challenge = otpChallenge();
        const contact = phoneContact();

        const { repositories } = await renderStubScreen(<PhoneScreen />, {
            session: testMeResponse(),
            repositories: {
                verification: {
                    listContactPoints: async () => [contact],
                    issueChallenge: async () => challenge,
                    getChallenge: async () => challenge,
                    verifyChallenge: async ({ challengeId }): Promise<OtpVerificationResult> => ({
                        challengeId,
                        purpose: 'contact_verification',
                        verifiedAt: NOW,
                        contactPointId: contact.id,
                        stepUpUntil: null,
                    }),
                },
            },
        });

        // An unconfirmed number is already on file, so the screen offers it rather than a form.
        await fireEvent.press(await screen.findByTestId('phone-screen-send'));

        // The issued challenge is seeded into the cache before the panel's query observes it, and
        // under the harness's `gcTime: 0` it can be collected in that gap — the panel is drawn, then
        // drops back to its skeleton while it re-reads. Its own read of the challenge is issued only
        // once it holds the live entry, so wait for that rather than for the first frame.
        await waitFor(() => expect(repositories.verification.getChallenge).toHaveBeenCalled());
        await screen.findByTestId('phone-screen-challenge-code-input');
        // Server-authored mask, never reconstructed by the panel.
        expect(screen.getByTestId('phone-screen-challenge-destination')).toHaveTextContent(/4567/);
        expect(repositories.verification.issueChallenge).toHaveBeenCalledWith({
            purpose: 'contact_verification',
            contactPointId: contact.id,
        });

        await fireEvent.changeText(
            screen.getByTestId('phone-screen-challenge-code-input'),
            TEST_CODE,
        );
        await fireEvent.press(screen.getByTestId('phone-screen-challenge-submit'));

        expect(await screen.findByTestId('phone-screen-verified')).toBeTruthy();
        // The code is verified against the challenge the screen is driving, not against a contact.
        expect(repositories.verification.verifyChallenge).toHaveBeenCalledWith({
            challengeId: challenge.id,
            code: TEST_CODE,
        });
    });

    it('says a number is already on the account rather than showing a stale-write conflict', async () => {
        await renderStubScreen(<PhoneScreen />, {
            session: testMeResponse(),
            repositories: {
                verification: {
                    // A confirmed number, so the form is what renders.
                    listContactPoints: async () => [
                        phoneContact({ verified: true, verifiedAt: NOW }),
                    ],
                    // Adding a number already on the account is refused with `resource.conflict`.
                    addContactPoint: async () => {
                        throw new ApiError(conflictFailure());
                    },
                },
            },
        });

        await fireEvent.changeText(
            await screen.findByTestId('phone-screen-number'),
            '050 123 4567',
        );
        await fireEvent.press(screen.getByTestId('phone-screen-submit'));

        // The generic conflict copy would be wrong here — nobody changed anything.
        expect(await screen.findByTestId('phone-screen-duplicate')).toHaveTextContent(
            /already on your account/,
        );
        expect(screen.queryByTestId('phone-screen-add-error')).toBeNull();
    });
});

/* ══ addresses ═════════════════════════════════════════════════════════════════════════════════ */

describe('AddressEditorScreen', () => {
    it('saves an address against a chosen service area, never free text', async () => {
        const areas = [
            serviceArea(1, 'Jumeirah'),
            serviceArea(2, 'Dubai Marina'),
            serviceArea(3, 'Al Barsha'),
        ];
        const area = areas[2]!;

        const { repositories } = await renderStubScreen(<AddressEditorScreen addressId="new" />, {
            session: testMeResponse(),
            repositories: {
                account: {
                    listServiceAreas: async () => areas,
                    addAddress: async (request): Promise<CustomerAddress> => ({
                        id: 'address-1',
                        label: request.label,
                        areaId: request.areaId,
                        areaName: area.name,
                        isDeliverable: true,
                        line1: request.line1,
                        line2: null,
                        building: null,
                        floor: null,
                        notes: null,
                        // The server decides the first address is the default — the screen sent
                        // `makeDefault: false`, which is asserted below.
                        isDefault: true,
                    }),
                },
            },
        });

        await fireEvent.changeText(await screen.findByTestId('address-editor-label'), 'Home');
        await fireEvent.press(screen.getByTestId('address-editor-area-trigger'));
        await fireEvent.press(await screen.findByTestId(`address-editor-area-option-${area.id}`));

        // Choosing an area produces the non-blocking coverage notice — a warning, not a gate.
        expect(await screen.findByTestId('address-editor-coverage')).toHaveTextContent(
            new RegExp(area.name),
        );

        await fireEvent.changeText(screen.getByTestId('address-editor-line1'), '12 Sunset Street');
        await fireEvent.press(screen.getByTestId('address-editor-save'));

        await waitFor(() => {
            expect(repositories.account.addAddress).toHaveBeenCalledWith({
                label: 'Home',
                // The area travels as the identifier the list published, never as its name.
                areaId: area.id,
                line1: '12 Sunset Street',
                makeDefault: false,
            });
        });
        // A saved address returns to the list rather than sitting on a filled-in form.
        await waitFor(() => {
            expect(routerMock.__push).toHaveBeenCalledWith('/customer/account/addresses');
        });
    });
});

/* ══ the allergy declaration ═══════════════════════════════════════════════════════════════════ */

describe('AllergiesScreen', () => {
    it('branches on the Yes/No answer and records “none” as a real answer', async () => {
        let profile = dietaryProfile();

        const { repositories } = await renderStubScreen(<AllergiesScreen />, {
            session: testMeResponse(),
            repositories: {
                account: {
                    getDietaryProfile: async () => profile,
                    saveDietaryProfile: async (request) => {
                        profile = { ...request, updatedAt: NOW };
                        return profile;
                    },
                },
            },
        });

        expect(await screen.findByTestId('allergies-screen-unanswered')).toBeTruthy();
        expect(screen.queryByTestId('allergies-screen-allergens')).toBeNull();
        // Health information is collected here, so the disclaimer is mandatory.
        expect(screen.getByTestId('medical-disclaimer')).toBeTruthy();

        await fireEvent.press(screen.getByTestId('allergies-screen-answer-yes'));
        expect(await screen.findByTestId('allergies-screen-allergens')).toBeTruthy();

        await fireEvent.press(screen.getByTestId('allergies-screen-answer-no'));
        expect(await screen.findByTestId('allergies-screen-none')).toBeTruthy();
        expect(screen.queryByTestId('allergies-screen-allergens')).toBeNull();

        await fireEvent.press(screen.getByTestId('allergies-screen-save'));

        await waitFor(() => {
            expect(repositories.account.saveDietaryProfile).toHaveBeenCalledWith({
                dietCategoryCode: null,
                allergens: [],
                excludedIngredientIds: [],
            });
        });

        // "None" is a real answer, not silence: the saved profile carries a timestamp, so the
        // re-seeded screen reads "no" rather than falling back to the unanswered state.
        expect(await screen.findByTestId('allergies-screen-saved')).toBeTruthy();
        await waitFor(() => {
            expect(screen.getByTestId('allergies-screen-none')).toBeTruthy();
        });
        expect(screen.queryByTestId('allergies-screen-unanswered')).toBeNull();
    });

    it('declares a ticked allergen at the strictest severity', async () => {
        let profile = dietaryProfile();

        const { repositories } = await renderStubScreen(<AllergiesScreen />, {
            session: testMeResponse(),
            repositories: {
                account: {
                    getDietaryProfile: async () => profile,
                    saveDietaryProfile: async (request) => {
                        profile = { ...request, updatedAt: NOW };
                        return profile;
                    },
                },
            },
        });

        await fireEvent.press(await screen.findByTestId('allergies-screen-answer-yes'));
        await fireEvent.press(await screen.findByTestId('allergies-screen-allergens-peanut'));
        await fireEvent.press(screen.getByTestId('allergies-screen-save'));

        await waitFor(() => {
            expect(repositories.account.saveDietaryProfile).toHaveBeenCalledWith({
                dietCategoryCode: null,
                // A tick declares the strictest reading; softening it is a separate decision.
                allergens: [{ allergenCode: 'peanut', severity: 'allergy', note: null }],
                excludedIngredientIds: [],
            });
        });

        // The saved profile becomes the seed again, so the declaration survives the refetch the
        // save triggers rather than reverting to the unanswered state.
        expect(await screen.findByTestId('allergies-screen-saved')).toBeTruthy();
        await waitFor(() => {
            expect(screen.getByTestId('allergies-screen-allergens-row-peanut')).toBeTruthy();
        });
    });
});

/* ══ consents ══════════════════════════════════════════════════════════════════════════════════ */

describe('ConsentsScreen', () => {
    it('blocks every required agreement until the age is confirmed, then accepts one', async () => {
        const privacyText = 'What Healthy360 records about you, and for how long.';
        let consents: readonly ConsentState[] = [
            consent('consent.age_confirmation', { required: true, title: 'Your age' }),
            consent('terms_of_service', { required: true, title: 'Terms of service' }),
            consent('privacy_notice', {
                required: true,
                title: 'Privacy notice',
                text: privacyText,
            }),
        ];

        const { repositories } = await renderStubScreen(<ConsentsScreen />, {
            session: testMeResponse(),
            repositories: {
                account: {
                    listConsents: async () => consents,
                    setConsent: async ({ key, granted }) => {
                        consents = applyConsent(consents, key, granted);
                        const written = consents.find((entry) => entry.definition.key === key);
                        if (written === undefined) throw new Error(`No consent ${key}.`);
                        return written;
                    },
                },
            },
        });

        expect(await screen.findByTestId('consents-screen-age-blocking')).toBeTruthy();
        const grant = screen.getByTestId('consent-terms_of_service-grant');
        expect(grant.props.accessibilityState.disabled).toBe(true);

        await fireEvent.press(screen.getByTestId('consents-screen-age-checkbox-control'));
        await waitFor(() => {
            expect(
                screen.getByTestId('consent-terms_of_service-grant').props.accessibilityState
                    .disabled,
            ).toBe(false);
        });
        expect(repositories.account.setConsent).toHaveBeenCalledWith({
            key: 'consent.age_confirmation',
            granted: true,
        });

        await fireEvent.press(screen.getByTestId('consent-terms_of_service-grant'));
        expect(repositories.account.setConsent).toHaveBeenCalledWith({
            key: 'terms_of_service',
            granted: true,
        });
        await waitFor(() => {
            expect(screen.getByTestId('consent-terms_of_service-status')).toHaveTextContent(
                /Agreed/,
            );
        });

        // The full text is on the page rather than behind a link — it is what was agreed to.
        expect(screen.getByTestId('consent-privacy_notice-text')).toHaveTextContent(
            new RegExp('What Healthy360 records about you'),
        );
    });
});
