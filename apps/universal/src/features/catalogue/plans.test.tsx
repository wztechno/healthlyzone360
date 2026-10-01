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
import { fireEvent, screen, waitFor } from '@testing-library/react-native';

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
import { PlansScreen } from './screens/plans-screen.tsx';

/**
 * The HealthZone plan surfaces: `/plans` (intro, plan cards, the subscriber's band) and
 * `/plans/how-it-works` (rules, the balance calculator, the FAQ), plus the balance arithmetic both
 * stand on. The catalogue's kitchen filter and comparison behaviour stays covered in
 * `catalogue.test.tsx`.
 */

const routerState: { params: Record<string, string> } = { params: {} };

jest.mock('expo-router', () => {
    const push = jest.fn();
    const setParams = jest.fn();
    return {
        __esModule: true,
        useRouter: () => ({ push, replace: jest.fn(), setParams, back: jest.fn() }),
        usePathname: () => '/plans',
        useLocalSearchParams: () => routerState.params,
        Redirect: () => null,
        Link: ({ children }: { children: React.ReactNode }) => children,
        Slot: () => null,
        Stack: () => null,
        __push: push,
        __setParams: setParams,
    };
});

// eslint-disable-next-line @typescript-eslint/no-require-imports
const routerMock = require('expo-router') as { __push: jest.Mock; __setParams: jest.Mock };

beforeEach(() => {
    routerState.params = {};
    routerMock.__push.mockClear();
    routerMock.__setParams.mockClear();
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
        pricePerWeek: { amount: weekly, currency: 'AED' },
    };
}

const DURATIONS: readonly PlanDurationOption[] = [
    { duration: '1w', discountPercent: 0, totalPrice: null },
    { duration: '4w', discountPercent: 5, totalPrice: null },
    { duration: '12w', discountPercent: 12, totalPrice: null },
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
        sampleMealIds: [],
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
        duration: '4w',
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
        dietClassifications: [],
        excludeAllergens: [],
        selectedMealIds: [],
    },
    planName: 'Balanced week',
    kitchenId: KITCHEN_ID,
    weeklyPrice: { amount: 21000, currency: 'AED' },
    days: { total: 28, consumed: 6, remaining: 22 },
    nextDeliveryDate: '2026-10-05',
    skippedDates: ['2026-10-07'],
    pausedUntil: null,
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

    it('names a balance in delivery days, from the closed duration vocabulary', () => {
        expect(balanceDaysFor('1w')).toBe(7);
        expect(balanceDaysFor('4w')).toBe(28);
        expect(balanceDaysFor('12w')).toBe(84);
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
    it('opens on the intro and links to how plans work', async () => {
        await renderStubScreen(<PlansScreen />, { repositories: REPOSITORIES });

        expect(screen.getByTestId('plans-intro')).toBeTruthy();
        expect(screen.getByTestId('plans-title')).toBeTruthy();
        expect(screen.queryByTestId('plans-hero')).toBeNull();

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
        // The held plan offers "Manage plan" where the others offer "Choose …".
        expect(screen.queryByTestId('plan-card-balanced-week-open')).toBeNull();
        expect(screen.getByTestId('plan-card-lean-days-open')).toHaveTextContent(/Lean days/);
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

        await fireEvent.press(screen.getByTestId('plans-subscriber-dietary'));
        expect(routerMock.__push).toHaveBeenLastCalledWith('/customer/account/allergies');
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
        expect(routerMock.__setParams).toHaveBeenLastCalledWith({
            compare: String(LEAN.id),
        });
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
            screen.getByTestId('plans-calculator-size-4w').props.accessibilityState.selected,
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

        await fireEvent.press(screen.getByTestId('plans-calculator-size-12w'));
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
