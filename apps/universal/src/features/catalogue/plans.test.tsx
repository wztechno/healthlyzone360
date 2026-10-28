import type {
    PlanDurationOption,
    PlanVariant,
    Subscription,
    SubscriptionBalance,
    SubscriptionPlan,
} from '@healthy360/api-client/contracts';
import type {
    KitchenId,
    PlanVariantId,
    SubscriptionId,
    SubscriptionPlanId,
} from '@healthy360/domain-types';
import { act, fireEvent, screen, waitFor } from '@testing-library/react-native';

import { forgetQueries } from '../../navigation/last-query.ts';
import { withQuery, withReturnTo } from '../../navigation/return-to.ts';
import type { ExpoRouterMock } from '../../testing/expo-router-mock.ts';
import { testMeResponse } from '../../testing/session-fixtures.ts';
import { page } from '../../testing/stub-repositories.ts';
import { renderStubScreen } from '../../testing/stub-screen.tsx';
import {
    balanceDaysFor,
    balanceTotal,
    cancellationCredit,
    effectiveDayPrice,
    listDayPrice,
    maxDiscountPercent,
    mealsPerDayRange,
    nextMonday,
    simulateBalance,
} from './plan-balance.ts';
import { PlanBalanceCalculator } from './plan-balance-calculator.tsx';
import { HowPlansWorkScreen } from './screens/how-plans-work-screen.tsx';
import { PlanComparisonScreen } from './screens/plan-comparison-screen.tsx';
import { PlanDetailScreen } from './screens/plan-detail-screen.tsx';
import { PlansScreen } from './screens/plans-screen.tsx';

/**
 * The HealthZone plan surfaces: `/plans` (intro, plan cards, the subscriber's band) and
 * `/plans/how-it-works` (rules, the balance calculator, the FAQ), plus the balance arithmetic both
 * stand on. The catalogue's kitchen filter and comparison behaviour stays covered in
 * `catalogue.test.tsx`.
 */

/**
 * The router is the shared customer-suite mock (`testing/expo-router-mock.ts`): every call is a
 * spy, and `__set` gives a case its own URL — the plan page reads its band from `?variant=`.
 */
jest.mock('expo-router', () =>
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    require('../../testing/expo-router-mock.ts').createExpoRouterMock({ pathname: '/plans' }),
);

// eslint-disable-next-line @typescript-eslint/no-require-imports
const routerMock = require('expo-router') as ExpoRouterMock;

beforeEach(() => {
    routerMock.__reset();
    forgetQueries();
    globalThis.localStorage?.clear();
});

/* ── the world ───────────────────────────────────────────────────────────────────────────────── */

function uuid(family: number, ordinal: number): string {
    return `01935f6d-${family.toString(16).padStart(4, '0')}-7000-8000-${ordinal
        .toString(16)
        .padStart(12, '0')}`;
}

const KITCHEN_ID = uuid(1, 1) as KitchenId;

/** Weekly prices divisible by seven, so the per-day list price is exact. */
function variant(plan: number, index: number, weekly: number, meals: number): PlanVariant {
    return {
        id: uuid(6, plan * 10 + index) as PlanVariantId,
        planId: uuid(5, plan) as SubscriptionPlanId,
        name: `Band ${String(index)}`,
        energyRange: { min: 1400 + index * 400, max: 1700 + index * 400 },
        proteinRange: null,
        carbohydrateRange: null,
        fatRange: null,
        mealsPerDay: meals,
        snacksPerDay: 0,
        // The server's rule: two meals are lunch and dinner, a third adds breakfast.
        sittings:
            meals >= 3
                ? [
                      { slot: 'breakfast', sequence: 1 },
                      { slot: 'lunch', sequence: 1 },
                      { slot: 'dinner', sequence: 1 },
                  ]
                : [
                      { slot: 'lunch', sequence: 1 },
                      { slot: 'dinner', sequence: 1 },
                  ],
        pricePerWeek: { amount: weekly, currency: 'AED' },
    };
}

const DURATIONS: readonly PlanDurationOption[] = [
    { duration: '7d', days: 7, discountPercent: 0, totalPrice: null },
    { duration: '28d', days: 28, discountPercent: 5, totalPrice: null },
    { duration: '84d', days: 84, discountPercent: 12, totalPrice: null },
];

function plan(ordinal: number, name: string, slug: string): SubscriptionPlan {
    return {
        id: uuid(5, ordinal) as SubscriptionPlanId,
        kitchenId: KITCHEN_ID,
        name,
        slug,
        summary: `${name}, in a sentence.`,
        description: `${name} is authored by this test file.`,
        categorySlugs: [],
        dietClassifications: ['omnivore'],
        // The dearer band first: the advertised price must still be the cheapest one's.
        variants: [variant(ordinal, 1, 28000, 3), variant(ordinal, 0, 21000, 2)],
        durations: DURATIONS,
        imagePlaceholderId: `plan-${slug}`,
        rating: null,
        ratingCount: 0,
    };
}

const BALANCED = plan(1, 'Balanced week', 'balanced-week');
const LEAN = plan(2, 'Lean days', 'lean-days');
const PLANS = [BALANCED, LEAN];

const REPOSITORIES = {
    marketplace: {
        listPlans: async () => page(PLANS),
        listKitchens: async () => page([]),
    },
};

const SUBSCRIPTION: Subscription = {
    id: uuid(7, 1) as SubscriptionId,
    state: 'active',
    configuration: {
        planId: BALANCED.id,
        variantId: BALANCED.variants[1]!.id,
        duration: '28d',
        startDate: '2026-09-07',
        deliveryWeekdays: [1, 3, 5],
        slotCode: 'lunch',
        address: {
            label: 'Home',
            line1: '12 Test Street',
            line2: null,
            area: 'Jumeirah 1',
            city: 'Dubai',
            countryCode: 'AE',
            instructions: null,
        },
        days: [],
    },
    planName: 'Balanced week',
    kitchenId: KITCHEN_ID,
    weeklyPrice: { amount: 21000, currency: 'AED' },
    days: { total: 28, consumed: 6, remaining: 22 },
    nextDeliveryDate: '2026-10-05',
    skippedDates: ['2026-10-07'],
    createdAt: '2026-09-01T09:00:00.000Z',
    updatedAt: '2026-09-20T09:00:00.000Z',
};

const SUBSCRIBER_REPOSITORIES = {
    ...REPOSITORIES,
    commerce: {
        listSubscriptions: async () => page([SUBSCRIPTION]),
        getSubscriptionBalance: async (): Promise<SubscriptionBalance> => ({
            subscriptionId: SUBSCRIPTION.id,
            state: SUBSCRIPTION.state,
            days: SUBSCRIPTION.days,
            perDayPrice: { amount: 2850, currency: 'AED' },
            skippedDays: 1,
            nextDeliveryDate: SUBSCRIPTION.nextDeliveryDate,
            deliveryWeekdays: SUBSCRIPTION.configuration.deliveryWeekdays,
            changeCutoffHours: 36,
        }),
        skipDay: async () => SUBSCRIPTION,
        pause: async () => ({ ...SUBSCRIPTION, state: 'paused' as const }),
    },
};

/** Digits with any grouping or decimal codepoint between them — ICU builds differ on glyphs. */
function moneyPattern(minor: number): RegExp {
    const digits = String(minor).split('');
    const cents = digits.splice(-2).join('');
    return new RegExp(`${digits.join('.?')}.?${cents}`);
}

/* ── the arithmetic ──────────────────────────────────────────────────────────────────────────── */

describe('plan balance arithmetic', () => {
    const cheap = BALANCED.variants[1]!;

    it('names a balance in delivery days, whatever count the kitchen configured', () => {
        expect(balanceDaysFor('7d')).toBe(7);
        expect(balanceDaysFor('28d')).toBe(28);
        expect(balanceDaysFor('84d')).toBe(84);
        // Not a closed vocabulary: a five-day run is five deliveries, not "1 week" rounded.
        expect(balanceDaysFor('5d')).toBe(5);
    });

    it('discounts the per-day price and rounds it before multiplying, as the server quotes', () => {
        const odd = variant(9, 0, 7 * 1999, 3);
        expect(listDayPrice(odd).amount).toBe(1999);
        // 1999 × 0.95 = 1899.05 → 1899 per day; the total is 1899 × 28, never round(1999 × 28 × 0.95).
        expect(effectiveDayPrice(odd, 5).amount).toBe(1899);
        expect(balanceTotal(odd, DURATIONS[1]!).amount).toBe(1899 * 28);
        expect(effectiveDayPrice(cheap, 0)).toEqual({ amount: 3000, currency: 'AED' });
    });

    it('reads the facts a card lists off the plan itself', () => {
        expect(maxDiscountPercent(BALANCED)).toBe(12);
        expect(mealsPerDayRange(BALANCED)).toEqual({ min: 2, max: 3 });
    });

    it('starts the simulation on the coming Monday', () => {
        // Thursday 1 October 2026 → Monday 5 October.
        expect(nextMonday(new Date(2026, 9, 1)).getDate()).toBe(5);
        // A Monday moves to the following one: this week is already under way.
        expect(nextMonday(new Date(2026, 9, 5)).getDate()).toBe(12);
    });

    it('uses a day per delivery, nothing in a skipped week, and stops when the balance is spent', () => {
        const start = new Date(2026, 9, 5);
        const plain = simulateBalance({
            days: 14,
            weekdays: [1, 2, 3, 4],
            skippedWeeks: [],
            start,
        });
        // 4 + 4 + 4 + 2.
        expect(plain.weeks).toHaveLength(4);
        expect(plain.weeks.map((week) => week.remaining)).toEqual([10, 6, 2, 0]);
        expect(plain.lastDelivery?.getDate()).toBe(27);

        const skipped = simulateBalance({
            days: 14,
            weekdays: [1, 2, 3, 4],
            skippedWeeks: [1],
            start,
        });
        expect(skipped.weeks).toHaveLength(5);
        expect(skipped.weeks[1]!.cells.filter((cell) => cell.kind === 'skipped')).toHaveLength(4);
        expect(skipped.weeks[1]!.remaining).toBe(10);
        expect(skipped.skippedWeeks).toBe(1);
        // The same fourteen deliveries, a week later.
        expect(skipped.lastDelivery?.getMonth()).toBe(10);
        expect(skipped.lastDelivery?.getDate()).toBe(3);
    });

    it('simulates nothing without a weekday rather than looping for ever', () => {
        const empty = simulateBalance({
            days: 28,
            weekdays: [],
            skippedWeeks: [],
            start: new Date(2026, 9, 5),
        });
        expect(empty.weeks).toHaveLength(0);
        expect(empty.lastDelivery).toBeNull();
    });

    it('credits the unused days at the effective per-day price', () => {
        const simulation = simulateBalance({
            days: 28,
            weekdays: [1, 2, 3, 4],
            skippedWeeks: [1],
            start: new Date(2026, 9, 5),
        });
        const credit = cancellationCredit(simulation, 28, 2, { amount: 2850, currency: 'AED' });
        expect(credit.usedDays).toBe(4);
        expect(credit.unusedDays).toBe(24);
        expect(credit.credit).toEqual({ amount: 24 * 2850, currency: 'AED' });
    });
});

/* ── /plans ──────────────────────────────────────────────────────────────────────────────────── */

describe('PlansScreen — HealthZone structure', () => {
    it('opens on the title and count, and links to how plans work', async () => {
        await renderStubScreen(<PlansScreen />, { repositories: REPOSITORIES });

        expect(screen.getByTestId('plans-header-title')).toHaveTextContent('Plans');
        await waitFor(() => {
            expect(screen.getByTestId('plans-count')).toHaveTextContent('2 plans');
        });

        await fireEvent.press(screen.getByTestId('plans-how-link'));
        expect(routerMock.__push).toHaveBeenCalledWith('/plans/how-it-works');
    });

    it('prices each card per delivery day from its cheapest band, with facts from the plan', async () => {
        await renderStubScreen(<PlansScreen />, { repositories: REPOSITORIES });
        await waitFor(() => screen.getByTestId('plans-grid'));

        // 21 000 a week → 3 000 a day, from the cheaper band even though it is listed second.
        expect(screen.getByTestId('plan-card-balanced-week-price-amount')).toHaveTextContent(
            moneyPattern(3000),
        );
        // The first balance a plan is sold in, priced per day × days: 3 000 × 7.
        expect(screen.getByTestId('plan-card-balanced-week-price-balance')).toHaveTextContent(
            moneyPattern(21000),
        );
        expect(screen.getByTestId('plan-card-balanced-week-meals')).toBeTruthy();
        expect(screen.getByTestId('plan-card-balanced-week-balances')).toHaveTextContent(/84/);
        expect(screen.getByTestId('plan-card-balanced-week-discount')).toHaveTextContent(/12/);
        // Two named controls, not one card-sized button.
        expect(screen.getByTestId('plan-card-balanced-week-compare')).toBeTruthy();
        expect(screen.getByTestId('plan-card-balanced-week-open')).toBeTruthy();
        expect(screen.queryByTestId('plans-subscriber')).toBeNull();
    });

    it('never asks an anonymous visitor for subscriptions', async () => {
        const { repositories } = await renderStubScreen(<PlansScreen />, {
            repositories: REPOSITORIES,
        });
        await waitFor(() => screen.getByTestId('plans-grid'));
        expect(repositories.commerce.listSubscriptions).not.toHaveBeenCalled();
    });

    it('marks a subscriber’s plan and shows their week and balance', async () => {
        await renderStubScreen(<PlansScreen />, {
            session: testMeResponse(),
            repositories: SUBSCRIBER_REPOSITORIES,
        });

        await waitFor(() => {
            expect(screen.getByTestId('plans-subscriber')).toBeTruthy();
        });
        expect(screen.getByTestId('plan-card-balanced-week-current')).toBeTruthy();
        expect(screen.queryByTestId('plan-card-lean-days-current')).toBeNull();
        // The held plan offers "Manage plan" where the others offer "Choose plan", named for screen
        // readers by the plan it chooses.
        expect(screen.queryByTestId('plan-card-balanced-week-open')).toBeNull();
        expect(screen.getByTestId('plan-card-lean-days-open')).toHaveTextContent('Choose plan');
        expect(screen.getByTestId('plan-card-lean-days-open')).toHaveProp(
            'accessibilityLabel',
            expect.stringMatching(/Lean days/),
        );
        expect(screen.getByTestId('plans-subscriber-balance')).toHaveTextContent(/22/);
        expect(screen.getByTestId('plans-subscriber-days')).toHaveTextContent(/3/);
        // The week drawn is the one the next delivery (Monday 5 October) falls in.
        expect(screen.getByTestId('plans-subscriber-week')).toHaveTextContent(/5.11/);
        expect(screen.getByTestId('plans-subscriber-day-1').props.accessibilityLabel).toMatch(
            /delivery day/,
        );
        expect(screen.getByTestId('plans-subscriber-day-2').props.accessibilityLabel).toMatch(
            /no delivery/,
        );
        // The skipped Wednesday is marked as skipped, not as a delivery.
        expect(screen.getByTestId('plans-subscriber-day-3').props.accessibilityLabel).toMatch(
            /skipped/,
        );
        // The cut-off is the plan's own, from the balance read.
        await waitFor(() => {
            expect(screen.getByTestId('plans-subscriber-cutoff')).toHaveTextContent(/36/);
        });

        await fireEvent.press(screen.getByTestId('plan-card-balanced-week-manage'));
        expect(routerMock.__push).toHaveBeenLastCalledWith(
            `/customer/subscriptions/${String(SUBSCRIPTION.id)}`,
        );
    });

    /**
     * Every live subscription, not the newest (plans-21): a person holding two plans sees both
     * marked and both summarised, and a subscription that has run its course marks nothing.
     */
    it('marks and summarises every live subscription, and ignores one that has ended', async () => {
        const second: Subscription = {
            ...SUBSCRIPTION,
            id: uuid(7, 2) as SubscriptionId,
            state: 'paused',
            configuration: { ...SUBSCRIPTION.configuration, planId: LEAN.id },
            planName: LEAN.name,
        };
        const ended: Subscription = {
            ...SUBSCRIPTION,
            id: uuid(7, 3) as SubscriptionId,
            state: 'expired',
            configuration: { ...SUBSCRIPTION.configuration, planId: LEAN.id },
        };
        await renderStubScreen(<PlansScreen />, {
            session: testMeResponse(),
            repositories: {
                ...SUBSCRIBER_REPOSITORIES,
                commerce: {
                    ...SUBSCRIBER_REPOSITORIES.commerce,
                    listSubscriptions: async () => page([SUBSCRIPTION, second, ended]),
                },
            },
        });

        await waitFor(() => {
            expect(screen.getAllByTestId('plans-subscriber')).toHaveLength(2);
        });
        expect(screen.getByTestId('plan-card-balanced-week-current')).toBeTruthy();
        expect(screen.getByTestId('plan-card-lean-days-current')).toBeTruthy();
        expect(screen.queryByTestId('plan-card-lean-days-open')).toBeNull();

        // Manage on the second plan's card opens *its* subscription, not the first one's.
        await fireEvent.press(screen.getByTestId('plan-card-lean-days-manage'));
        expect(routerMock.__push).toHaveBeenLastCalledWith(
            `/customer/subscriptions/${String(second.id)}`,
        );
    });

    it('marks nothing for somebody whose only subscription has ended', async () => {
        await renderStubScreen(<PlansScreen />, {
            session: testMeResponse(),
            repositories: {
                ...SUBSCRIBER_REPOSITORIES,
                commerce: {
                    ...SUBSCRIBER_REPOSITORIES.commerce,
                    listSubscriptions: async () =>
                        page([{ ...SUBSCRIPTION, state: 'cancelled' as const }]),
                },
            },
        });

        await waitFor(() => screen.getByTestId('plans-grid'));
        expect(screen.queryByTestId('plans-subscriber')).toBeNull();
        expect(screen.queryByTestId('plan-card-balanced-week-current')).toBeNull();
        expect(screen.getByTestId('plan-card-balanced-week-open')).toBeTruthy();
    });

    it('skips the next delivery for real, after asking', async () => {
        const { repositories } = await renderStubScreen(<PlansScreen />, {
            session: testMeResponse(),
            repositories: SUBSCRIBER_REPOSITORIES,
        });
        await waitFor(() => screen.getByTestId('plans-subscriber-skip'));

        await fireEvent.press(screen.getByTestId('plans-subscriber-skip'));
        expect(repositories.commerce.skipDay).not.toHaveBeenCalled();
        await fireEvent.press(screen.getByTestId('plans-subscriber-skip-confirm'));

        await waitFor(() => {
            expect(repositories.commerce.skipDay).toHaveBeenCalledWith(SUBSCRIPTION.id, {
                date: '2026-10-05',
            });
        });
    });

    it('pauses the plan for real, and opens the dietary profile', async () => {
        const { repositories } = await renderStubScreen(<PlansScreen />, {
            session: testMeResponse(),
            repositories: SUBSCRIBER_REPOSITORIES,
        });
        await waitFor(() => screen.getByTestId('plans-subscriber-pause'));

        await fireEvent.press(screen.getByTestId('plans-subscriber-pause'));
        await fireEvent.press(screen.getByTestId('plans-subscriber-pause-confirm'));
        await waitFor(() => {
            expect(repositories.commerce.pause).toHaveBeenCalledWith(SUBSCRIPTION.id);
        });

        // Carrying this page, so saving the rules comes back here rather than to a dead end.
        await fireEvent.press(screen.getByTestId('plans-subscriber-dietary'));
        expect(routerMock.__push).toHaveBeenLastCalledWith(
            withReturnTo('/customer/account/allergies', '/plans'),
        );
    });

    it('offers Resume in Pause’s place on a paused plan, and no skip', async () => {
        await renderStubScreen(<PlansScreen />, {
            session: testMeResponse(),
            repositories: {
                ...SUBSCRIBER_REPOSITORIES,
                commerce: {
                    ...SUBSCRIBER_REPOSITORIES.commerce,
                    listSubscriptions: async () => page([{ ...SUBSCRIPTION, state: 'paused' }]),
                },
            },
        });
        await waitFor(() => screen.getByTestId('plans-subscriber-resume'));

        expect(screen.queryByTestId('plans-subscriber-pause')).toBeNull();
        expect(screen.getByTestId('plans-subscriber-skip').props.accessibilityState.disabled).toBe(
            true,
        );
        expect(screen.getByTestId('plans-subscriber-state')).toHaveTextContent(/paused/i);
    });

    it('toggles a plan into the comparison from its card', async () => {
        await renderStubScreen(<PlansScreen />, { repositories: REPOSITORIES });
        await waitFor(() => screen.getByTestId('plans-grid'));

        // One kitchen publishes both plans, so there is no kitchen to choose between.
        expect(screen.queryByTestId('plans-kitchens')).toBeNull();
        await fireEvent.press(screen.getByTestId('plan-card-lean-days-compare'));
        expect(routerMock.__router.setParams).toHaveBeenLastCalledWith({
            compare: String(LEAN.id),
        });
    });

    it('opens the comparison with the kitchen chip, so coming back keeps both', async () => {
        routerMock.__set({
            params: { kitchen: String(KITCHEN_ID), compare: `${BALANCED.id},${LEAN.id}` },
        });
        await renderStubScreen(<PlansScreen />, { repositories: REPOSITORIES });

        await fireEvent.press(await screen.findByTestId('plans-compare-open'));
        expect(routerMock.__push).toHaveBeenLastCalledWith(
            withQuery('/plans/compare', {
                plans: `${BALANCED.id},${LEAN.id}`,
                kitchen: String(KITCHEN_ID),
            }),
        );
    });
});

/* ── /plans/compare ──────────────────────────────────────────────────────────────────────────── */

describe('PlanComparisonScreen — the way back to /plans', () => {
    const COMPARED = `${BALANCED.id},${LEAN.id}`;
    const BACK = withQuery('/plans', { kitchen: String(KITCHEN_ID), compare: COMPARED });
    const COMPARISON_REPOSITORIES = {
        marketplace: {
            ...REPOSITORIES.marketplace,
            getPlan: async (id: SubscriptionPlanId) =>
                PLANS.find((entry) => entry.id === id) ?? BALANCED,
        },
    };

    it('goes Back when /plans is the page underneath, tray and chip intact', async () => {
        routerMock.__set({
            pathname: '/plans/compare',
            params: { plans: COMPARED, kitchen: String(KITCHEN_ID) },
            navState: {
                index: 1,
                routes: [
                    { name: 'plans/index', params: { compare: COMPARED } },
                    { name: 'plans/compare', params: { plans: COMPARED } },
                ],
            },
        });
        await renderStubScreen(<PlanComparisonScreen />, {
            repositories: COMPARISON_REPOSITORIES,
        });
        await screen.findByTestId('plan-comparison-table');

        await fireEvent.press(screen.getByTestId('plan-comparison-crumb-plans'));
        expect(routerMock.__router.back).toHaveBeenCalledTimes(1);
        expect(routerMock.__push).not.toHaveBeenCalled();
    });

    it('opens /plans with the selection and the kitchen when it is not underneath', async () => {
        routerMock.__set({
            pathname: '/plans/compare',
            params: { plans: COMPARED, kitchen: String(KITCHEN_ID) },
        });
        await renderStubScreen(<PlanComparisonScreen />, {
            repositories: COMPARISON_REPOSITORIES,
        });
        await screen.findByTestId('plan-comparison-table');

        await fireEvent.press(screen.getByTestId('plan-comparison-crumb-plans'));
        expect(routerMock.__push).toHaveBeenLastCalledWith(BACK);
    });
});

/* ── /plans/{plan} ───────────────────────────────────────────────────────────────────────────── */

describe('PlanDetailScreen — the band, the sign-in round trip and a held plan', () => {
    const DETAIL_REPOSITORIES = {
        marketplace: {
            ...REPOSITORIES.marketplace,
            getPlan: async () => BALANCED,
            listMeals: async () => page([]),
        },
    };
    const [DEARER, CHEAPER] = BALANCED.variants;

    it('writes the chosen band into the URL, and follows the URL when it changes', async () => {
        routerMock.__set({ pathname: `/plans/${BALANCED.id}` });
        await renderStubScreen(<PlanDetailScreen planId={String(BALANCED.id)} />, {
            repositories: DETAIL_REPOSITORIES,
        });

        await fireEvent.press(await screen.findByTestId(`plan-detail-variant-${DEARER!.id}`));
        expect(routerMock.__router.setParams).toHaveBeenLastCalledWith({
            variant: String(DEARER!.id),
        });
        expect(screen.getByTestId('plan-detail-variant-band')).toHaveTextContent(/Band 1/);

        // Back onto an entry with the other band: the page shows that one.
        await act(async () => {
            routerMock.__set({ params: { variant: String(CHEAPER!.id) } });
        });
        expect(screen.getByTestId('plan-detail-variant-band')).toHaveTextContent(/Band 0/);
    });

    it('sends an anonymous visitor to sign in, coming back to the set-up on this band', async () => {
        routerMock.__set({
            pathname: `/plans/${BALANCED.id}`,
            params: { variant: String(CHEAPER!.id) },
        });
        await renderStubScreen(<PlanDetailScreen planId={String(BALANCED.id)} />, {
            repositories: DETAIL_REPOSITORIES,
        });

        const configure = await screen.findByTestId('plan-detail-configure');
        await waitFor(() => {
            expect(configure).toHaveTextContent('Sign in to configure it');
        });
        await fireEvent.press(screen.getByTestId('plan-detail-configure'));

        expect(routerMock.__push).toHaveBeenLastCalledWith(
            withReturnTo(
                '/sign-in',
                `/customer/subscriptions/new?plan=${BALANCED.id}&variant=${CHEAPER!.id}`,
            ),
        );
    });

    it('waits for a stored session instead of offering a signed-in person sign-in', async () => {
        await renderStubScreen(<PlanDetailScreen planId={String(BALANCED.id)} />, {
            session: testMeResponse(),
            // The session's own answer is slow; the plan arrives first.
            repositories: {
                ...DETAIL_REPOSITORIES,
                session: {
                    me: () =>
                        new Promise((resolve) => {
                            setTimeout(() => {
                                resolve(testMeResponse());
                            }, 200);
                        }),
                },
                commerce: { listSubscriptions: async () => page([]) },
            },
        });

        const configure = await screen.findByTestId('plan-detail-configure');
        expect(configure).not.toHaveTextContent('Sign in to configure it');
        expect(configure.props.accessibilityState).toMatchObject({ disabled: true });
        await fireEvent.press(configure);
        expect(routerMock.__push).not.toHaveBeenCalled();

        await waitFor(() => {
            expect(
                screen.getByTestId('plan-detail-configure').props.accessibilityState,
            ).toMatchObject({ disabled: false });
        });
    });

    it('offers a subscriber Manage plan first, and setting up another after it', async () => {
        await renderStubScreen(<PlanDetailScreen planId={String(BALANCED.id)} />, {
            session: testMeResponse(),
            repositories: { ...DETAIL_REPOSITORIES, commerce: SUBSCRIBER_REPOSITORIES.commerce },
        });

        const manage = await screen.findByTestId('plan-detail-manage');
        expect(manage).toHaveTextContent('Manage plan');
        await fireEvent.press(manage);
        expect(routerMock.__push).toHaveBeenLastCalledWith(
            `/customer/subscriptions/${String(SUBSCRIPTION.id)}`,
        );
        expect(screen.getByTestId('plan-detail-configure')).toHaveTextContent('Set up plan');
    });

    it('goes Home to the marketplace home, not the launch resolver', async () => {
        await renderStubScreen(<PlanDetailScreen planId={String(BALANCED.id)} />, {
            repositories: DETAIL_REPOSITORIES,
        });
        await screen.findByTestId('plan-detail-name');

        await fireEvent.press(screen.getByTestId('plan-detail-crumb-home'));
        expect(routerMock.__router.navigate).toHaveBeenCalledWith('/discover');
        expect(routerMock.__push).not.toHaveBeenCalledWith('/');
    });
});

/* ── /plans/how-it-works ─────────────────────────────────────────────────────────────────────── */

describe('HowPlansWorkScreen', () => {
    it('states the six rules, the cut-off, the four states and the FAQ', async () => {
        await renderStubScreen(<HowPlansWorkScreen />, { repositories: REPOSITORIES });

        expect(screen.getByTestId('how-plans-title')).toBeTruthy();
        expect(screen.getAllByTestId(/^how-plans-rule-/)).toHaveLength(6);
        expect(screen.getAllByTestId(/^how-plans-cutoff-(lock|order|delivered)$/)).toHaveLength(3);
        expect(screen.getAllByTestId(/^how-plans-state-/)).toHaveLength(4);
        // The first question opens with the page, as the design has it.
        expect(screen.getByTestId('how-plans-faq-soldOut').props.accessibilityState.expanded).toBe(
            true,
        );
        expect(screen.getByTestId('how-plans-faq-expire').props.accessibilityState.expanded).toBe(
            false,
        );

        await fireEvent.press(screen.getByTestId('how-plans-choose'));
        expect(routerMock.__push).toHaveBeenCalledWith('/plans');

        await waitFor(() => {
            expect(screen.getByTestId('plans-calculator-body')).toBeTruthy();
        });
    });

    it('keeps one question open at a time', async () => {
        await renderStubScreen(<HowPlansWorkScreen />, { repositories: REPOSITORIES });

        await fireEvent.press(screen.getByTestId('how-plans-faq-expire'));
        expect(screen.getByTestId('how-plans-faq-expire').props.accessibilityState.expanded).toBe(
            true,
        );
        expect(screen.getByTestId('how-plans-faq-soldOut').props.accessibilityState.expanded).toBe(
            false,
        );
    });
});

describe('PlanBalanceCalculator', () => {
    const TODAY = new Date(2026, 9, 1);

    async function renderCalculator() {
        await renderStubScreen(
            <PlanBalanceCalculator plans={PLANS} kitchenNameById={new Map()} today={TODAY} />,
        );
    }

    it('opens on the middle balance at the cheapest band, priced with its discount', async () => {
        await renderCalculator();

        expect(
            screen.getByTestId('plans-calculator-size-28d').props.accessibilityState.selected,
        ).toBe(true);
        // 3 000 a day less 5% → 2 850; 28 days → 79 800.
        expect(screen.getByTestId('plans-calculator-per-day-value')).toHaveTextContent(
            moneyPattern(2850),
        );
        expect(screen.getByTestId('plans-calculator-total-value')).toHaveTextContent(
            moneyPattern(79800),
        );
        // Mon–Thu with week 2 skipped: 4, skip, then 24 ÷ 4 = 6 more weeks.
        expect(screen.getByTestId('plans-calculator-lasts-value')).toHaveTextContent(/8/);
        expect(screen.getByTestId('plans-calculator-credit')).toHaveTextContent(
            moneyPattern(24 * 2850),
        );
    });

    it('moves the end date, not the price, when a week is un-skipped', async () => {
        await renderCalculator();
        const before = screen.getByTestId('plans-calculator-per-day-value').props.children;

        await fireEvent.press(screen.getByTestId('plans-calculator-week-2-skip'));

        expect(screen.getByTestId('plans-calculator-lasts-value')).toHaveTextContent(/7/);
        expect(screen.getByTestId('plans-calculator-per-day-value').props.children).toBe(before);
    });

    it('re-prices when the balance or the band changes', async () => {
        await renderCalculator();

        await fireEvent.press(screen.getByTestId('plans-calculator-size-84d'));
        // 3 000 less 12% → 2 640 a day.
        expect(screen.getByTestId('plans-calculator-per-day-value')).toHaveTextContent(
            moneyPattern(2640),
        );

        await fireEvent.press(
            screen.getByTestId(`plans-calculator-band-${String(BALANCED.variants[0]!.id)}`),
        );
        // 4 000 less 12% → 3 520 a day.
        expect(screen.getByTestId('plans-calculator-per-day-value')).toHaveTextContent(
            moneyPattern(3520),
        );
    });

    it('offers every published plan as a chip and re-prices on switching', async () => {
        await renderCalculator();

        expect(
            screen.getByTestId('plans-calculator-plan-balanced-week').props.accessibilityState
                .selected,
        ).toBe(true);
        await fireEvent.press(screen.getByTestId('plans-calculator-plan-lean-days'));
        expect(
            screen.getByTestId('plans-calculator-plan-lean-days').props.accessibilityState.selected,
        ).toBe(true);
        expect(screen.getByTestId('plans-calculator-total')).toHaveTextContent(/Lean days/);
    });

    it('asks for a weekday instead of drawing an empty schedule', async () => {
        await renderCalculator();

        for (const weekday of [1, 2, 3, 4]) {
            await fireEvent.press(
                screen.getByTestId(`plans-calculator-weekday-${String(weekday)}`),
            );
        }

        expect(screen.queryByTestId('plans-calculator-weeks')).toBeNull();
        expect(screen.getByTestId('plans-calculator-credit')).toHaveTextContent(/weekday/);
    });
});
