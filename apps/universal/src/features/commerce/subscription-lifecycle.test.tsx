import { ApiError } from '@healthy360/api-client/contracts';
import type {
    CommerceRepository,
    CreditMemo,
    DeliveryAddress,
    Subscription,
    SubscriptionBalance,
    SubscriptionCancellation,
    SubscriptionConfiguration,
    SubscriptionDelivery,
    SubscriptionQuote,
} from '@healthy360/api-client/contracts';
import type {
    KitchenId,
    Money,
    PlanVariantId,
    SubscriptionId,
    SubscriptionPlanId,
} from '@healthy360/domain-types';
import { act, fireEvent, screen, waitFor } from '@testing-library/react-native';

import { testMeResponse } from '../../testing/session-fixtures.ts';
import { page } from '../../testing/stub-repositories.ts';
import { renderStubScreen } from '../../testing/stub-screen.tsx';
import { SubscriptionDetailScreen } from './screens/subscription-detail-screen.tsx';
import { SubscriptionsScreen } from './screens/subscriptions-screen.tsx';

/**
 * S1 — the balance, the credit memo and the 24-hour cut-off, on the screens that carry them.
 *
 * This suite used to run against the fixture world's own arithmetic: it read the seeded
 * subscription, called the repository directly and asserted that the mock's numbers agreed with each
 * other. With that world gone, re-pointing those same calls at a stub would assert nothing — the
 * test would author `remaining: 9` and then check that `remaining` is `9`.
 *
 * So the same four rules are asserted one layer up, where they are actually load-bearing: the
 * **screens** that show somebody their money. The test authors what the server says; the assertions
 * are about what the interface then does with it — that the balance card prints the server's
 * `days` rather than recomputing them, that the ledger is the evidence behind the count, that the
 * cancellation dialog's own arithmetic (`remaining × perDayPrice`) agrees with the memo the server
 * writes, that a delivery inside the cut-off survives a weekday change, and that the plan's
 * available weekdays cost exactly one request.
 *
 * Everything the screens are asked for is declared here; anything they reach for that this file did
 * not author rejects with `StubNotConfiguredError` naming the surface.
 */

jest.mock('expo-router', () => ({
    __esModule: true,
    useRouter: () => ({ push: jest.fn(), replace: jest.fn(), back: jest.fn() }),
    usePathname: () => '/customer/subscriptions',
    useLocalSearchParams: () => ({}),
    Redirect: () => null,
    Link: () => null,
}));

const SUBSCRIPTION_ID = '01935f6d-0000-7000-8000-0000000005b1' as SubscriptionId;
const PLAN_ID = '01935f6d-0000-7000-8000-0000000000a1' as SubscriptionPlanId;
const VARIANT_ID = '01935f6d-0000-7000-8000-0000000000b2' as PlanVariantId;
const KITCHEN_ID = '01935f6d-0000-7000-8000-0000000000c3' as KitchenId;

/** The effective per-day price after the duration discount — 32.50 AED. */
const PER_DAY: Money = { amount: 3250, currency: 'AED' };
const WEEKLY_PRICE: Money = { amount: 9750, currency: 'AED' };

/**
 * One authored subscription's ledger, on Mondays, Wednesdays and Fridays from 1 June 2026.
 *
 * Fixed calendar dates rather than dates relative to "today": the ledger is the server's answer
 * here, and a fixture that moved with the clock would make "the delivery inside the cut-off keeps
 * its original date" untestable.
 *
 * Twenty purchased days: eleven consumed, nine still to come. The three skipped days are *extra*
 * rows — they consumed nothing and the balance simply stretches past them — so the ledger is
 * twenty-three rows long while the balance is still twenty days.
 */
const DELIVERED_DATES: readonly string[] = [
    '2026-06-01',
    '2026-06-03',
    '2026-06-05',
    '2026-06-08',
    '2026-06-10',
    '2026-06-12',
    '2026-06-15',
    '2026-06-17',
    '2026-06-19',
    '2026-06-22',
    '2026-06-24',
];
const SKIPPED_DATES: readonly string[] = ['2026-06-26', '2026-06-29', '2026-07-01'];
const SCHEDULED_DATES: readonly string[] = [
    '2026-07-03',
    '2026-07-06',
    '2026-07-08',
    '2026-07-10',
    '2026-07-13',
    '2026-07-15',
    '2026-07-17',
    '2026-07-20',
    '2026-07-22',
];

/** The subscription's own next delivery, and the first day the skip sheet offers. */
const NEXT_DELIVERY = '2026-07-03';

/** Tuesdays and Thursdays after the cut-off, where a weekday change re-plans the rest of the run. */
const REPLANNED_DATES: readonly string[] = [
    '2026-07-07',
    '2026-07-09',
    '2026-07-14',
    '2026-07-16',
    '2026-07-21',
    '2026-07-23',
    '2026-07-28',
    '2026-07-30',
];

const ADDRESS: DeliveryAddress = {
    label: 'Home',
    line1: '12 Marina Walk',
    line2: null,
    area: 'Dubai Marina',
    city: 'Dubai',
    countryCode: 'AE',
    instructions: null,
};

function testConfiguration(
    overrides: Partial<SubscriptionConfiguration> = {},
): SubscriptionConfiguration {
    return {
        planId: PLAN_ID,
        variantId: VARIANT_ID,
        duration: '4w',
        startDate: '2026-06-01',
        deliveryWeekdays: [1, 3, 5],
        slotCode: 'morning',
        address: ADDRESS,
        dietClassifications: [],
        excludeAllergens: [],
        selectedMealIds: [],
        ...overrides,
    };
}

function testSubscription(overrides: Partial<Subscription> = {}): Subscription {
    return {
        id: SUBSCRIPTION_ID,
        state: 'active',
        configuration: testConfiguration(),
        planName: 'Balanced weekday plan',
        kitchenId: KITCHEN_ID,
        weeklyPrice: WEEKLY_PRICE,
        days: { total: 20, consumed: 11, remaining: 9 },
        nextDeliveryDate: NEXT_DELIVERY,
        skippedDates: [...SKIPPED_DATES],
        pausedUntil: null,
        createdAt: '2026-05-25T09:00:00.000Z',
        updatedAt: '2026-07-01T09:00:00.000Z',
        ...overrides,
    };
}

function testBalance(overrides: Partial<SubscriptionBalance> = {}): SubscriptionBalance {
    return {
        subscriptionId: SUBSCRIPTION_ID,
        state: 'active',
        days: { total: 20, consumed: 11, remaining: 9 },
        perDayPrice: PER_DAY,
        skippedDays: 3,
        nextDeliveryDate: NEXT_DELIVERY,
        deliveryWeekdays: [1, 3, 5],
        changeCutoffHours: 24,
        ...overrides,
    };
}

function testDelivery(
    date: string,
    overrides: Partial<SubscriptionDelivery> = {},
): SubscriptionDelivery {
    return {
        id: `delivery-${date}`,
        date,
        status: 'scheduled',
        consumed: false,
        skipReason: null,
        slotCode: 'morning',
        ...overrides,
    };
}

/** The plan delivers on every day but Saturday — the fact the quote publishes in one read. */
function testQuote(overrides: Partial<SubscriptionQuote> = {}): SubscriptionQuote {
    return {
        planId: PLAN_ID,
        variantId: VARIANT_ID,
        duration: '4w',
        available: true,
        availableWeekdays: [1, 2, 3, 4, 5, 7],
        days: 20,
        listPrice: { amount: 72_222, currency: 'AED' },
        discountPercent: 10,
        perDayPrice: PER_DAY,
        total: { amount: 65_000, currency: 'AED' },
        allowsFreeSelection: false,
        changeCutoffHours: 24,
        refusals: [],
        ...overrides,
    };
}

/**
 * The server's state, held in one mutable object.
 *
 * The repository overrides read these fields *at call time*, so a mutation applied inside an
 * override is what the subsequent refetch sees. That is the replacement for the deleted mock
 * store: a transition changes the world, the screen invalidates, and the redraw is the assertion.
 */
interface World {
    subscription: Subscription;
    balance: SubscriptionBalance;
    deliveries: readonly SubscriptionDelivery[];
    quote: SubscriptionQuote;
}

function liveWorld(): World {
    return {
        subscription: testSubscription(),
        balance: testBalance(),
        deliveries: [
            ...DELIVERED_DATES.map((date) =>
                testDelivery(date, { status: 'delivered', consumed: true }),
            ),
            ...SKIPPED_DATES.map((date) =>
                testDelivery(date, {
                    status: 'skipped_customer',
                    skipReason: 'customer_request',
                }),
            ),
            ...SCHEDULED_DATES.map((date) => testDelivery(date)),
        ],
        quote: testQuote(),
    };
}

/** A skip consumes nothing: the row goes free and the balance stretches one day further out. */
function applySkip(world: World, date: string): void {
    world.subscription = {
        ...world.subscription,
        skippedDates: [...world.subscription.skippedDates, date],
        nextDeliveryDate: '2026-07-06',
    };
    world.balance = {
        ...world.balance,
        skippedDays: world.balance.skippedDays + 1,
        nextDeliveryDate: '2026-07-06',
    };
    world.deliveries = [
        ...world.deliveries.map((row) =>
            row.date === date
                ? {
                      ...row,
                      status: 'skipped_customer' as const,
                      skipReason: 'customer_request' as const,
                  }
                : row,
        ),
        testDelivery('2026-07-24'),
    ];
}

/** Cancellation is terminal: every day still to come is cancelled and nothing is left to deliver. */
function applyCancellation(world: World): void {
    world.subscription = {
        ...world.subscription,
        state: 'cancelled',
        nextDeliveryDate: null,
    };
    world.balance = { ...world.balance, state: 'cancelled', nextDeliveryDate: null };
    world.deliveries = world.deliveries.map((row) =>
        row.status === 'scheduled' ? { ...row, status: 'cancelled' as const } : row,
    );
}

/**
 * The 24-hour cut-off, as the server applies it: the delivery already inside the window keeps its
 * original date even though its weekday is no longer chosen, and everything after it is re-planned.
 */
function applyWeekdayChange(world: World, weekdays: readonly number[]): void {
    world.subscription = {
        ...world.subscription,
        configuration: testConfiguration({ deliveryWeekdays: weekdays }),
    };
    world.balance = { ...world.balance, deliveryWeekdays: weekdays };
    world.deliveries = [
        ...world.deliveries.filter(
            (row) => row.status !== 'scheduled' || row.date === NEXT_DELIVERY,
        ),
        ...REPLANNED_DATES.map((date) => testDelivery(date)),
    ];
}

function renderDetail(world: World, overrides: Partial<CommerceRepository> = {}) {
    return renderStubScreen(<SubscriptionDetailScreen subscriptionId={String(SUBSCRIPTION_ID)} />, {
        session: testMeResponse(),
        repositories: {
            commerce: {
                getSubscription: async () => world.subscription,
                getSubscriptionBalance: async () => world.balance,
                listSubscriptionDeliveries: async () => page(world.deliveries),
                getSubscriptionQuote: async () => world.quote,
                ...overrides,
            },
        },
    });
}

async function openWeekdayEditor(): Promise<void> {
    await waitFor(() => {
        expect(screen.getByTestId('subscription-change-weekdays')).toBeTruthy();
    });
    await act(async () => {
        fireEvent.press(screen.getByTestId('subscription-change-weekdays'));
    });
    await waitFor(() => {
        expect(screen.getByTestId('subscription-weekdays-chips')).toBeTruthy();
    });
}

/** Monday/Wednesday/Friday off, Tuesday/Thursday on — one press per chip, each its own render. */
async function chooseTuesdayAndThursday(): Promise<void> {
    for (const weekday of [1, 3, 5, 2, 4]) {
        await act(async () => {
            fireEvent.press(screen.getByTestId(`subscription-weekdays-day-${String(weekday)}`));
        });
    }
}

describe('the balance is a count of delivery days', () => {
    it('reports what has been used, what is left, and the price a refund would use', async () => {
        await renderDetail(liveWorld());

        await waitFor(() => {
            expect(screen.getByTestId('subscription-balance')).toBeTruthy();
        });

        // The server's own three numbers, printed rather than recomputed from the ledger.
        expect(screen.getByTestId('subscription-balance-remaining')).toHaveTextContent(
            '9 delivery days left',
        );
        expect(screen.getByTestId('subscription-balance-used')).toHaveTextContent('11 of 20 used');

        // The effective per-day price, not a weekly price divided by seven: 97.50 a week over three
        // deliveries would round to the same 32.50 only by coincidence, and the card prints the
        // number a refund is actually computed from.
        expect(screen.getByTestId('subscription-balance-per-day')).toHaveTextContent('AED 32.50');

        expect(screen.getByTestId('subscription-balance-skipped')).toHaveTextContent(
            '3 skipped days, which cost you nothing',
        );
        expect(screen.getByTestId('subscription-balance-cutoff')).toHaveTextContent(
            'Changes apply to deliveries more than 24 hours away. Anything sooner goes as planned.',
        );
    });

    it('agrees with the ledger it is derived from', async () => {
        await renderDetail(liveWorld());

        await waitFor(() => {
            expect(screen.getByTestId('subscription-deliveries-table')).toBeTruthy();
        });

        // Twenty-three authored rows: eleven that consumed a day, three that consumed nothing and
        // nine still to come. The balance says 11 of 20 used with 3 skipped, and the evidence on
        // screen has to add up to exactly that.
        expect(screen.getByTestId('subscription-deliveries-count')).toHaveTextContent('23 days');
        expect(screen.getAllByText('Used a day')).toHaveLength(11);
        expect(screen.getAllByText('Free')).toHaveLength(12);
        expect(screen.getAllByText('Scheduled')).toHaveLength(9);

        // The badges carry a leading icon glyph, so these match the label within the badge.
        for (const date of SKIPPED_DATES) {
            expect(screen.getByTestId(`subscription-deliveries-status-${date}`)).toHaveTextContent(
                /You skipped it/,
            );
        }
        for (const date of DELIVERED_DATES) {
            expect(screen.getByTestId(`subscription-deliveries-status-${date}`)).toHaveTextContent(
                /Delivered/,
            );
        }
    });

    it('puts the balance on the subscription itself, so a list needs no extra request', async () => {
        const rows: readonly Subscription[] = [
            testSubscription(),
            testSubscription({
                id: '01935f6d-0000-7000-8000-0000000005b2' as SubscriptionId,
                planName: 'Office lunch plan',
                days: { total: 12, consumed: 11, remaining: 1 },
            }),
            testSubscription({
                id: '01935f6d-0000-7000-8000-0000000005b3' as SubscriptionId,
                planName: 'Weekend reset',
                state: 'paused',
                nextDeliveryDate: null,
                days: { total: 8, consumed: 0, remaining: 8 },
            }),
        ];

        const harness = await renderStubScreen(<SubscriptionsScreen />, {
            session: testMeResponse(),
            repositories: { commerce: { listSubscriptions: async () => page(rows) } },
        });

        await waitFor(() => {
            expect(screen.getByTestId('subscriptions-list')).toBeTruthy();
        });

        // Three rows, three balances, and the singular form on the row with one day left — which is
        // only reachable if the count came from `Subscription.days` rather than from a placeholder.
        for (const [row, expected] of [
            [rows[0], '9 delivery days left'],
            [rows[1], '1 delivery day left'],
            [rows[2], '8 delivery days left'],
        ] as const) {
            expect(
                screen.getByTestId(`subscription-row-${String(row?.id)}-balance`),
            ).toHaveTextContent(expected);
        }

        // The whole reason `days` is on the subscription: one request for the list, and not one
        // balance request per row.
        expect(harness.repositories.commerce.listSubscriptions).toHaveBeenCalledTimes(1);
        expect(harness.repositories.commerce.getSubscriptionBalance).not.toHaveBeenCalled();
    });
});

describe('a skip consumes nothing', () => {
    it('leaves the balance untouched and marks the day as free', async () => {
        const world = liveWorld();
        const harness = await renderDetail(world, {
            skipDay: async () => {
                applySkip(world, NEXT_DELIVERY);
                return world.subscription;
            },
        });

        await waitFor(() => {
            expect(screen.getByTestId('subscription-skip')).toBeTruthy();
        });
        await act(async () => {
            fireEvent.press(screen.getByTestId('subscription-skip'));
        });
        await waitFor(() => {
            expect(screen.getByTestId(`subscription-skip-option-${NEXT_DELIVERY}`)).toBeTruthy();
        });
        await act(async () => {
            fireEvent.press(screen.getByTestId(`subscription-skip-option-${NEXT_DELIVERY}`));
        });
        await waitFor(() => {
            expect(screen.getByTestId('subscription-skip-consequence')).toBeTruthy();
        });
        await act(async () => {
            fireEvent.press(screen.getByTestId('subscription-skip-confirm'));
        });

        // The day is now marked as one the person skipped, and it cost them nothing.
        await waitFor(() => {
            expect(
                screen.getByTestId(`subscription-deliveries-status-${NEXT_DELIVERY}`),
            ).toHaveTextContent(/You skipped it/);
        });

        // The one assertion the approved semantics turn on.
        expect(screen.getByTestId('subscription-balance-remaining')).toHaveTextContent(
            '9 delivery days left',
        );
        expect(screen.getByTestId('subscription-balance-used')).toHaveTextContent('11 of 20 used');

        expect(harness.repositories.commerce.skipDay).toHaveBeenCalledWith(SUBSCRIPTION_ID, {
            date: NEXT_DELIVERY,
        });
    });

    it('counts the skipped day without charging for it', async () => {
        const world = liveWorld();
        await renderDetail(world, {
            skipDay: async () => {
                applySkip(world, NEXT_DELIVERY);
                return world.subscription;
            },
        });

        await waitFor(() => {
            expect(screen.getByTestId('subscription-balance-skipped')).toHaveTextContent(
                '3 skipped days, which cost you nothing',
            );
        });

        await act(async () => {
            fireEvent.press(screen.getByTestId('subscription-skip'));
        });
        await waitFor(() => {
            expect(screen.getByTestId(`subscription-skip-option-${NEXT_DELIVERY}`)).toBeTruthy();
        });
        await act(async () => {
            fireEvent.press(screen.getByTestId(`subscription-skip-option-${NEXT_DELIVERY}`));
        });
        await act(async () => {
            fireEvent.press(screen.getByTestId('subscription-skip-confirm'));
        });

        await waitFor(() => {
            expect(screen.getByTestId('subscription-balance-skipped')).toHaveTextContent(
                '4 skipped days, which cost you nothing',
            );
        });
        // Four skipped days, and still nine to come — the balance stretched rather than shrank, and
        // the ledger grew a twenty-fourth row at the far end to prove where it stretched to.
        expect(screen.getByTestId('subscription-balance-remaining')).toHaveTextContent(
            '9 delivery days left',
        );
        expect(screen.getByTestId('subscription-deliveries-count')).toHaveTextContent('24 days');
    });
});

describe('cancelling mints a credit memo', () => {
    const memo: CreditMemo = {
        id: 'credit-memo-0001',
        subscriptionId: SUBSCRIPTION_ID,
        reason: 'subscription_cancelled',
        unusedDays: 9,
        perDayPrice: PER_DAY,
        amount: { amount: 29_250, currency: 'AED' },
        status: 'recorded',
        settlement: 'manual',
        recordedAt: '2026-07-02T09:00:00.000Z',
    };

    function cancelling(world: World): Partial<CommerceRepository> {
        return {
            cancelSubscription: async (): Promise<SubscriptionCancellation> => {
                applyCancellation(world);
                return { subscription: world.subscription, creditMemo: memo };
            },
        };
    }

    async function openCancelDialog(): Promise<void> {
        await waitFor(() => {
            expect(screen.getByTestId('subscription-cancel-open')).toBeTruthy();
        });
        await act(async () => {
            fireEvent.press(screen.getByTestId('subscription-cancel-open'));
        });
        await waitFor(() => {
            expect(screen.getByTestId('subscription-cancel-consequence')).toBeTruthy();
        });
    }

    it('records unused days x the effective per-day price actually paid', async () => {
        const world = liveWorld();
        await renderDetail(world, cancelling(world));
        await openCancelDialog();

        // The dialog does the arithmetic itself, from the balance it already holds, *before* the
        // button: nine unused days at 32.50 is 292.50.
        expect(screen.getByTestId('subscription-cancel-estimate')).toHaveTextContent(
            'We will record a credit of AED 292.50 — 9 unused days at AED 32.50.',
        );

        await act(async () => {
            fireEvent.press(screen.getByTestId('subscription-cancel-confirm'));
        });

        // And the memo the server actually wrote is the one on screen at the end — same days, same
        // amount. When those two ever disagree, this is where it shows.
        await waitFor(() => {
            expect(screen.getByTestId('subscription-cancel-result')).toHaveTextContent(
                /A credit of AED 292\.50 has been recorded for 9 unused days\./,
            );
        });
    });

    it('says the settlement is manual and the memo is only recorded', async () => {
        const world = liveWorld();
        await renderDetail(world, cancelling(world));
        await openCancelDialog();

        // Nothing in this system moves money, and the dialog refuses to imply otherwise — before
        // the decision and again on the receipt, because that is the part most easily misremembered.
        const manualSettlement =
            'A credit is recorded against your account and settled by hand. ' +
            'No money moves automatically.';
        expect(screen.getByTestId('subscription-cancel-manual')).toHaveTextContent(
            manualSettlement,
        );

        await act(async () => {
            fireEvent.press(screen.getByTestId('subscription-cancel-confirm'));
        });

        await waitFor(() => {
            expect(screen.getByTestId('subscription-cancel-memo-manual')).toHaveTextContent(
                manualSettlement,
            );
        });
    });

    it('cancels every remaining delivery and refuses a second cancellation', async () => {
        const world = liveWorld();
        const harness = await renderDetail(world, cancelling(world));
        await openCancelDialog();

        await act(async () => {
            fireEvent.press(screen.getByTestId('subscription-cancel-confirm'));
        });

        // Nothing is left to deliver: every scheduled row is now cancelled.
        await waitFor(() => {
            expect(screen.queryAllByText('Scheduled')).toHaveLength(0);
        });
        for (const date of SCHEDULED_DATES) {
            expect(screen.getByTestId(`subscription-deliveries-status-${date}`)).toHaveTextContent(
                /Cancelled/,
            );
        }

        // A second cancellation is not refused with an error — it is not offered at all. A
        // cancelled subscription is read-only, and the screen says why.
        await waitFor(() => {
            expect(screen.getByTestId('subscription-detail-read-only')).toBeTruthy();
        });
        expect(screen.queryByTestId('subscription-detail-actions')).toBeNull();
        expect(screen.queryByTestId('subscription-cancel-open')).toBeNull();
        expect(harness.repositories.commerce.cancelSubscription).toHaveBeenCalledTimes(1);
    });
});

describe('the 24-hour cut-off', () => {
    it('leaves a delivery inside the window alone and re-plans only what comes after it', async () => {
        const world = liveWorld();
        const harness = await renderDetail(world, {
            setSubscriptionWeekdays: async (_id, request) => {
                applyWeekdayChange(world, request.deliveryWeekdays);
                return world.subscription;
            },
        });

        await openWeekdayEditor();
        await chooseTuesdayAndThursday();
        await act(async () => {
            fireEvent.press(screen.getByTestId('subscription-weekdays-confirm'));
        });

        expect(harness.repositories.commerce.setSubscriptionWeekdays).toHaveBeenCalledWith(
            SUBSCRIPTION_ID,
            { deliveryWeekdays: [2, 4] },
        );

        // The configuration redraws from the answer rather than from what was pressed.
        await waitFor(() => {
            expect(screen.getByText('Tuesday, Thursday')).toBeTruthy();
        });

        // The delivery whose cut-off has already passed survives, on its original Friday, even
        // though Friday is no longer one of the chosen weekdays. The deliveries table refetches
        // independently of the configuration text awaited above, so the first read of it waits.
        await waitFor(() => {
            expect(
                screen.getByTestId(`subscription-deliveries-status-${NEXT_DELIVERY}`),
            ).toHaveTextContent(/Scheduled/);
        });

        // Everything the change could touch has moved onto the new weekdays, and none of the old
        // Monday/Wednesday/Friday dates is still planned.
        for (const date of REPLANNED_DATES) {
            expect(screen.getByTestId(`subscription-deliveries-status-${date}`)).toHaveTextContent(
                /Scheduled/,
            );
        }
        for (const date of SCHEDULED_DATES.filter((value) => value !== NEXT_DELIVERY)) {
            expect(screen.queryByTestId(`subscription-deliveries-status-${date}`)).toBeNull();
        }
    });

    it('preserves the balance across a weekday change', async () => {
        const world = liveWorld();
        await renderDetail(world, {
            setSubscriptionWeekdays: async (_id, request) => {
                applyWeekdayChange(world, request.deliveryWeekdays);
                return world.subscription;
            },
        });

        await openWeekdayEditor();
        await chooseTuesdayAndThursday();
        await act(async () => {
            fireEvent.press(screen.getByTestId('subscription-weekdays-confirm'));
        });

        await waitFor(() => {
            expect(screen.getByText('Tuesday, Thursday')).toBeTruthy();
        });

        // Somebody bought a number of days. Moving which weekdays they arrive on is not a purchase,
        // and the card must not have quietly re-derived the count from a shorter ledger.
        expect(screen.getByTestId('subscription-balance-remaining')).toHaveTextContent(
            '9 delivery days left',
        );
        expect(screen.getByTestId('subscription-balance-used')).toHaveTextContent('11 of 20 used');
    });

    it('refuses an empty weekday set rather than silently stopping deliveries', async () => {
        const world = liveWorld();
        const harness = await renderDetail(world, {
            setSubscriptionWeekdays: async () => world.subscription,
        });

        await openWeekdayEditor();
        for (const weekday of [1, 3, 5]) {
            await act(async () => {
                fireEvent.press(screen.getByTestId(`subscription-weekdays-day-${String(weekday)}`));
            });
        }

        // A refusal the server would make anyway, said before the round trip — and the confirming
        // button is disabled rather than merely apologetic, so the request is never sent.
        expect(screen.getByTestId('subscription-weekdays-empty')).toHaveTextContent(
            'Choose at least one delivery day.',
        );
        await act(async () => {
            fireEvent.press(screen.getByTestId('subscription-weekdays-confirm'));
        });
        expect(harness.repositories.commerce.setSubscriptionWeekdays).not.toHaveBeenCalled();
    });

    it('reports the server refusing a change that would touch a delivery inside the window', async () => {
        const world = liveWorld();
        await renderDetail(world, {
            setSubscriptionWeekdays: async () => {
                throw new ApiError({
                    code: 'subscription.change_refused',
                    reasons: [
                        {
                            reason: 'inside_cut_off',
                            context: {
                                delivery_date: NEXT_DELIVERY,
                                cut_off_hours: 24,
                                effective_from: '2026-07-07',
                            },
                        },
                    ],
                    message: 'That change would touch a delivery inside the 24-hour cut-off.',
                    correlationId: null,
                    retryable: false,
                });
            },
        });

        await openWeekdayEditor();
        await chooseTuesdayAndThursday();
        await act(async () => {
            fireEvent.press(screen.getByTestId('subscription-weekdays-confirm'));
        });

        // The rejection is rendered rather than swallowed, in the server's own words.
        await waitFor(() => {
            expect(screen.getByTestId('subscription-detail-error')).toHaveTextContent(
                /That change would touch a delivery inside the 24-hour cut-off\./,
            );
        });
        // And nothing moved: the weekdays on the record are still Monday, Wednesday, Friday.
        expect(screen.getByText('Monday, Wednesday, Friday')).toBeTruthy();
    });
});

describe('the quote replaced the seven-probe hack', () => {
    it('answers availability and price in one read', async () => {
        const world = liveWorld();
        const harness = await renderDetail(world);
        await openWeekdayEditor();

        // Every chip the editor offers is a day the plan actually delivers on. The plan does not
        // deliver on Saturday, and the quote said so directly rather than the screen discovering it
        // by pricing seven hypothetical subscriptions.
        for (const weekday of [1, 2, 3, 4, 5, 7]) {
            expect(screen.getByTestId(`subscription-weekdays-day-${String(weekday)}`)).toBeTruthy();
        }
        expect(screen.queryByTestId('subscription-weekdays-day-6')).toBeNull();

        // One read, and it carried the cut-off with it.
        expect(screen.getByTestId('subscription-weekdays-cutoff')).toHaveTextContent(
            /Deliveries less than 24 hours away go ahead as planned\./,
        );
        expect(harness.repositories.commerce.getSubscriptionQuote).toHaveBeenCalledTimes(1);
        expect(harness.repositories.commerce.getSubscriptionQuote).toHaveBeenCalledWith({
            planId: PLAN_ID,
            variantId: VARIANT_ID,
            duration: '4w',
        });
        // The hack this replaced: seven `previewSubscription` calls, one per weekday.
        expect(harness.repositories.commerce.previewSubscription).not.toHaveBeenCalled();
    });
});
