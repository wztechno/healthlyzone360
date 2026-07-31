import { createMemoryTokenStore } from '@healthy360/api-client';
import { MOCK_SCENARIOS, createMockRepositories } from '@healthy360/api-client/mock';
import type { MockRepositories } from '@healthy360/api-client/mock';
import type { SubscriptionPlan } from '@healthy360/api-client/contracts';
import { PLAN_DURATIONS, SUBSCRIPTION_STATES } from '@healthy360/domain-types';
import type { AllergenCode, PlanDuration, SubscriptionId } from '@healthy360/domain-types';
import type { NutritionConstraint } from '@healthy360/nutrition';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import type { ReactNode } from 'react';

import { AppProviders } from '../../providers.tsx';
import { TEST_METRICS, createTestQueryClient } from '../../testing/render-screen.tsx';
import {
    EMPTY_ADDRESS,
    formatAddress,
    fromDeliveryAddress,
    isAddressComplete,
    toDeliveryAddress,
    validateAddress,
} from './address.ts';
import {
    CONFIGURATOR_STEPS,
    combinationKey,
    configuredDeliveryDates,
    diffAllergens,
    discountedTotalMinorUnits,
    firstIncompleteStep,
    grossMinorUnits,
    initialConfiguratorState,
    isBeforePriceStep,
    isStepReachable,
    mealCombinations,
    nextConfiguratorStep,
    perDeliveryPrice,
    previousConfiguratorStep,
    savingMinorUnits,
    stepPosition,
    storedAllergenCodes,
    storedDietClassifications,
    toConfiguration,
    validateConfiguratorStep,
    variantForCombination,
    weeksFor,
} from './configurator.ts';
import type { ConfiguratorState, StepContext } from './configurator.ts';
import {
    addDays,
    daysBetween,
    deliveryDatesFor,
    earliestStartDate,
    isIsoDate,
    isoWeekday,
    nextAllowedDate,
    todayIso,
    upcomingDeliveryDates,
} from './dates.ts';
import {
    DELIVERY_SLOTS,
    deliveryAreaStatus,
    deliverySlotByCode,
    isDeliverySlotCode,
    servedAreas,
    toContractSlot,
} from './delivery.ts';
import { CartScreen } from './screens/cart-screen.tsx';
import { CheckoutScreen } from './screens/checkout-screen.tsx';
import { SubscriptionConfiguratorScreen } from './screens/subscription-configurator-screen.tsx';
import { SubscriptionDetailScreen } from './screens/subscription-detail-screen.tsx';
import { SubscriptionsScreen } from './screens/subscriptions-screen.tsx';
import {
    canChangeDelivery,
    canPauseOrSkip,
    canResume,
    isTerminalSubscriptionState,
} from './state-badge.tsx';
import {
    ALLERGEN_CONFLICT_WARNING,
    CHECKOUT_EMPTY_CART,
    SUBSCRIPTION_DAY_UNAVAILABLE,
    displayableWarnings,
    isCriticalWarning,
    isKnownWarning,
    warningMessageKey,
} from './warnings.ts';

const CONSUMER = MOCK_SCENARIOS['consumer-prototype'].primaryEmail;

/**
 * Route parameters are the one thing these screens cannot reach through a repository, so the router
 * is mocked rather than rendered — the same seam the marketplace and catalogue suites use.
 */
jest.mock('expo-router', () => {
    const push = jest.fn();
    const replace = jest.fn();
    return {
        __esModule: true,
        useRouter: () => ({ push, replace, setParams: jest.fn(), back: jest.fn() }),
        usePathname: () => '/customer/cart',
        useLocalSearchParams: () => ({}),
        Redirect: () => null,
        Link: ({ children }: { children: ReactNode }) => children,
        Slot: () => null,
        Stack: () => null,
        __push: push,
        __replace: replace,
    };
});

// eslint-disable-next-line @typescript-eslint/no-require-imports
const routerMock = require('expo-router') as { __push: jest.Mock; __replace: jest.Mock };

beforeEach(() => {
    routerMock.__push.mockClear();
    routerMock.__replace.mockClear();
    globalThis.localStorage?.clear();
});

/**
 * A render whose world can be seeded **before** the first frame.
 *
 * The shared harness renders immediately, which is right for a screen that only reads. A basket is
 * different: "what does the cart look like with two lines in it?" is a question about a world that
 * has to exist before the query fires, and invalidating afterwards would test the refetch path
 * rather than the first paint.
 */
interface CommerceHarness {
    readonly repositories: MockRepositories;
    readonly queryClient: ReturnType<typeof createTestQueryClient>;
}

interface RenderOptions {
    readonly seed?: ((repositories: MockRepositories) => Promise<void>) | undefined;
    readonly latencyMs?: number | undefined;
}

async function renderCommerce(
    node: ReactNode,
    options: RenderOptions = {},
): Promise<CommerceHarness> {
    const tokenStore = createMemoryTokenStore();
    const repositories = createMockRepositories({
        scenario: 'consumer-prototype',
        latencyMs: options.latencyMs ?? 5,
        tokenStore,
    });
    await repositories.auth.login({ email: CONSUMER, password: 'password' });
    if (options.seed !== undefined) await options.seed(repositories);

    const queryClient = createTestQueryClient();
    await render(
        <AppProviders
            initialMetrics={TEST_METRICS}
            repositories={repositories}
            tokenStore={tokenStore}
            queryClient={queryClient}
            initialOnline
        >
            {node}
        </AppProviders>,
    );

    return { repositories, queryClient };
}

/**
 * Identifiers and fixture facts come from a throwaway bundle rather than by scraping a rendered
 * tree: rendering a second tree inside a test leaves `screen` pointing at one the test unmounts.
 */
const scratch = createMockRepositories({ scenario: 'consumer-prototype', latencyMs: 0 });

async function planBySlug(slug: string): Promise<SubscriptionPlan> {
    const page = await scratch.marketplace.listPlans({ limit: 20 });
    const plan = page.items.find((candidate) => candidate.slug === slug);
    if (plan === undefined) throw new Error(`The prototype world has no ${slug} plan.`);
    return plan;
}

async function seededSubscriptionId(): Promise<SubscriptionId> {
    const page = await scratch.commerce.listSubscriptions();
    const subscription = page.items[0];
    if (subscription === undefined) throw new Error('The prototype world seeds no subscription.');
    return subscription.id;
}

/* ══ pure: calendar arithmetic ═════════════════════════════════════════════════════════════════ */

describe('delivery calendar arithmetic', () => {
    it('adds days across a month and a year boundary without drifting', () => {
        expect(addDays('2026-01-31', 1)).toBe('2026-02-01');
        expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
        expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
    });

    it('numbers weekdays from Monday, with Sunday as seven', () => {
        // 2026-07-27 is a Monday in the prototype world's pinned week.
        expect(isoWeekday('2026-07-27')).toBe(1);
        expect(isoWeekday('2026-08-02')).toBe(7);
    });

    it('answers null rather than throwing on something that is not a date', () => {
        expect(isIsoDate('not-a-date')).toBe(false);
        expect(isIsoDate('2026-02-30')).toBe(false);
        expect(addDays('nonsense', 1)).toBeNull();
        expect(isoWeekday('nonsense')).toBeNull();
        expect(daysBetween('nonsense', '2026-01-01')).toBeNull();
    });

    it('reads today from the local clock, so a person east of Greenwich is not a day behind', () => {
        const midnightLocal = new Date(2026, 6, 30, 0, 30);
        expect(todayIso(midnightLocal)).toBe('2026-07-30');
        expect(earliestStartDate(midnightLocal)).toBe('2026-07-31');
    });

    it('never offers today as a start date', () => {
        expect(daysBetween(todayIso(), earliestStartDate())).toBe(1);
    });

    it('produces the delivery dates a whole-week configuration implies', () => {
        // Monday, Wednesday, Friday across two weeks from a Monday start: six deliveries.
        const dates = deliveryDatesFor('2026-07-27', [1, 3, 5], 2);
        expect(dates).toEqual([
            '2026-07-27',
            '2026-07-29',
            '2026-07-31',
            '2026-08-03',
            '2026-08-05',
            '2026-08-07',
        ]);
    });

    it('produces nothing at all when no weekday was chosen', () => {
        expect(deliveryDatesFor('2026-07-27', [], 4)).toEqual([]);
        expect(deliveryDatesFor('2026-07-27', [1], 0)).toEqual([]);
    });

    it('includes the day it starts from when listing upcoming deliveries', () => {
        const dates = upcomingDeliveryDates('2026-07-27', [1, 3, 5], 3);
        expect(dates).toEqual(['2026-07-27', '2026-07-29', '2026-07-31']);
    });

    it('does not offer a day that has already been skipped', () => {
        const dates = upcomingDeliveryDates('2026-07-27', [1, 3, 5], 3, {
            skipped: ['2026-07-29'],
        });
        expect(dates).toEqual(['2026-07-27', '2026-07-31', '2026-08-03']);
    });

    it('repairs a start date onto the next day the plan actually delivers', () => {
        // Saturday, on a plan that delivers Monday to Friday.
        expect(nextAllowedDate('2026-08-01', [1, 2, 3, 4, 5])).toBe('2026-08-03');
        expect(nextAllowedDate('2026-08-03', [1, 2, 3, 4, 5])).toBe('2026-08-03');
    });
});

/* ══ pure: delivery slots and the area check ═══════════════════════════════════════════════════ */

describe('delivery slots', () => {
    it('publishes exactly the codes the repository accepts', async () => {
        const subscriptionId = await seededSubscriptionId();
        const world = createMockRepositories({ scenario: 'consumer-prototype', latencyMs: 0 });

        for (const slot of DELIVERY_SLOTS) {
            const updated = await world.commerce.changeSlot(subscriptionId, {
                slotCode: slot.code,
            });
            expect(updated.configuration.slotCode).toBe(slot.code);
        }
    });

    it('rejects a code that is not on the list', () => {
        expect(isDeliverySlotCode('midday')).toBe(true);
        expect(isDeliverySlotCode('midnight')).toBe(false);
        expect(deliverySlotByCode('midnight')).toBeNull();
        expect(deliverySlotByCode('morning')?.startsAt).toBe('07:00');
    });

    it('takes its label from the caller so no English is frozen into the slot', () => {
        const slot = DELIVERY_SLOTS[0];
        expect(slot).toBeDefined();
        expect(toContractSlot(slot!, 'صباحًا')).toEqual({
            code: 'morning',
            label: 'صباحًا',
            startsAt: '07:00',
            endsAt: '10:00',
        });
    });
});

describe('the delivery-area check (doc 17, SUB-02)', () => {
    it('answers from the kitchen’s own published zones', async () => {
        const plan = await planBySlug('balanced-week');
        const kitchen = await scratch.marketplace.getKitchen(plan.kitchenId);
        const areas = servedAreas(kitchen);

        expect(areas.length).toBeGreaterThan(0);
        expect(deliveryAreaStatus(kitchen, areas[0] ?? '')).toBe('served');
    });

    it('ignores case and stray whitespace, because people type their own address', async () => {
        const plan = await planBySlug('balanced-week');
        const kitchen = await scratch.marketplace.getKitchen(plan.kitchenId);
        const area = servedAreas(kitchen)[0] ?? '';

        expect(deliveryAreaStatus(kitchen, `  ${area.toLocaleUpperCase()} `)).toBe('served');
    });

    it('says unserved for somewhere the kitchen does not publish', async () => {
        const plan = await planBySlug('balanced-week');
        const kitchen = await scratch.marketplace.getKitchen(plan.kitchenId);
        expect(deliveryAreaStatus(kitchen, 'Somewhere Else Entirely')).toBe('unserved');
    });

    it('treats silence as unknown rather than as coverage', () => {
        expect(deliveryAreaStatus(undefined, 'Business Bay')).toBe('unknown');
    });
});

/* ══ pure: the address form ════════════════════════════════════════════════════════════════════ */

const translate = (key: string): string => key;

const COMPLETE_ADDRESS = {
    label: 'Home',
    line1: 'Apartment 3, Palm Court',
    line2: '',
    area: 'Business Bay',
    city: 'Dubai',
    countryCode: 'ae',
    instructions: '',
};

describe('the delivery address', () => {
    it('names every field a delivery genuinely needs', () => {
        const errors = validateAddress(EMPTY_ADDRESS, translate);
        expect(Object.keys(errors).sort()).toEqual([
            'area',
            'city',
            'countryCode',
            'label',
            'line1',
        ]);
    });

    it('accepts a complete address and treats the optional lines as optional', () => {
        expect(validateAddress(COMPLETE_ADDRESS, translate)).toEqual({});
        expect(isAddressComplete(COMPLETE_ADDRESS, translate)).toBe(true);
    });

    it('normalises the country code rather than rejecting a lowercase one', () => {
        expect(toDeliveryAddress(COMPLETE_ADDRESS).countryCode).toBe('AE');
        expect(
            validateAddress({ ...COMPLETE_ADDRESS, countryCode: 'UAE' }, translate).countryCode,
        ).toBe('commerce:validation.countryCode');
    });

    it('sends absence as null rather than as an empty string', () => {
        const address = toDeliveryAddress(COMPLETE_ADDRESS);
        expect(address.line2).toBeNull();
        expect(address.instructions).toBeNull();
    });

    it('round-trips a stored address back into the form', () => {
        const address = toDeliveryAddress({ ...COMPLETE_ADDRESS, line2: 'Floor 4' });
        expect(fromDeliveryAddress(address).line2).toBe('Floor 4');
        expect(fromDeliveryAddress(address).instructions).toBe('');
    });

    it('drops the empty parts when writing one line', () => {
        const line = formatAddress(toDeliveryAddress(COMPLETE_ADDRESS));
        expect(line).toBe('Apartment 3, Palm Court, Business Bay, Dubai, AE');
    });

    it('refuses a value longer than the field allows', () => {
        const long = 'x'.repeat(200);
        expect(validateAddress({ ...COMPLETE_ADDRESS, line1: long }, translate).line1).toBe(
            'commerce:validation.tooLong',
        );
    });
});

/* ══ pure: the configurator ════════════════════════════════════════════════════════════════════ */

describe('configurator steps', () => {
    it('asks both dispositive questions before it shows a price', () => {
        expect([...CONFIGURATOR_STEPS]).toEqual([
            'plan',
            'combination',
            'duration',
            'dietary',
            'delivery',
            'meals',
            'summary',
            'confirm',
        ]);
        // Doc 17, SUB-02: allergies (step 4) and delivery area (step 5) both precede the price.
        expect(stepPosition('dietary')).toBeLessThan(stepPosition('summary'));
        expect(stepPosition('delivery')).toBeLessThan(stepPosition('summary'));
    });

    it('marks every step up to the sample week as being before the price', () => {
        expect(isBeforePriceStep('delivery')).toBe(true);
        expect(isBeforePriceStep('meals')).toBe(true);
        expect(isBeforePriceStep('summary')).toBe(false);
        expect(isBeforePriceStep('confirm')).toBe(false);
    });

    it('walks forwards and backwards and stops at both ends', () => {
        expect(previousConfiguratorStep('plan')).toBeNull();
        expect(nextConfiguratorStep('confirm')).toBeNull();
        expect(nextConfiguratorStep('plan')).toBe('combination');
        expect(previousConfiguratorStep('summary')).toBe('meals');
    });
});

describe('meal combinations (doc 17, SUB-08)', () => {
    it('lists each meal-and-snack combination once, however many bands offer it', async () => {
        const plan = await planBySlug('balanced-week');
        const combinations = mealCombinations(plan);

        expect(combinations.length).toBeLessThan(plan.variants.length);
        expect(new Set(combinations.map((entry) => combinationKey(entry))).size).toBe(
            combinations.length,
        );
        const totalVariants = combinations.reduce((sum, entry) => sum + entry.variantIds.length, 0);
        expect(totalVariants).toBe(plan.variants.length);
    });

    it('moves to the band closest to the one the person was already on', async () => {
        const plan = await planBySlug('balanced-week');
        const combinations = mealCombinations(plan);
        const twoSnacks = combinations.find((entry) => entry.snacksPerDay === 2);
        const light = plan.variants[0];

        expect(twoSnacks).toBeDefined();
        expect(light).toBeDefined();
        const moved = variantForCombination(plan, twoSnacks!, light ?? null);
        expect(moved).not.toBeNull();
        expect(twoSnacks?.variantIds).toContain(moved?.id);
    });
});

describe('duration pricing', () => {
    it.each(PLAN_DURATIONS)(
        'derives the same %s total the repository prices the subscription at',
        async (duration: PlanDuration) => {
            const plan = await planBySlug('balanced-week');
            const variant = plan.variants[1] ?? plan.variants[0];
            const option = plan.durations.find((entry) => entry.duration === duration);
            expect(variant).toBeDefined();
            expect(option).toBeDefined();

            const preview = await scratch.commerce.previewSubscription({
                planId: plan.id,
                variantId: variant!.id,
                duration,
                startDate: '2026-08-03',
                deliveryWeekdays: [1, 3, 5],
                slotCode: 'midday',
                address: toDeliveryAddress(COMPLETE_ADDRESS),
                dietClassifications: [],
                excludeAllergens: [],
                selectedMealIds: [],
            });

            expect(
                discountedTotalMinorUnits(
                    variant!.pricePerWeek.amount,
                    weeksFor(duration),
                    preview.discountPercent,
                ),
            ).toBe(preview.total.amount);
        },
    );

    it('reports the saving as the difference between gross and discounted', () => {
        const gross = grossMinorUnits(47_500, 4);
        expect(gross).toBe(190_000);
        expect(discountedTotalMinorUnits(47_500, 4, 10)).toBe(171_000);
        expect(savingMinorUnits(47_500, 4, 10)).toBe(19_000);
        expect(savingMinorUnits(47_500, 1, 0)).toBe(0);
    });

    it('divides a total across its deliveries, and refuses to divide by none', () => {
        expect(perDeliveryPrice({ amount: 171_000, currency: 'AED' }, 12)).toEqual({
            amount: 14_250,
            currency: 'AED',
        });
        expect(perDeliveryPrice({ amount: 171_000, currency: 'AED' }, 0)).toBeNull();
    });

    it('keeps the currency it was given rather than assuming the default', () => {
        expect(perDeliveryPrice({ amount: 3000, currency: 'SAR' }, 3)?.currency).toBe('SAR');
    });
});

describe('the allergy change (doc 11, DEF-06)', () => {
    const treeNut = 'tree_nut' as AllergenCode;
    const milk = 'milk' as AllergenCode;

    it('treats an added exclusion as a tightening that needs no ceremony', () => {
        const change = diffAllergens([treeNut], [treeNut, milk]);
        expect(change.added).toEqual([milk]);
        expect(change.removed).toEqual([]);
        expect(change.changed).toBe(true);
        expect(change.relaxed).toBe(false);
    });

    it('flags a removed exclusion as a relaxation, because that is a safety decision', () => {
        const change = diffAllergens([treeNut, milk], [milk]);
        expect(change.removed).toEqual([treeNut]);
        expect(change.relaxed).toBe(true);
    });

    it('reports no change when the sets match, whatever their order', () => {
        const change = diffAllergens([treeNut, milk], [milk, treeNut]);
        expect(change.changed).toBe(false);
        expect(change.relaxed).toBe(false);
    });

    it('reads only the allergy constraints out of a stored profile', () => {
        const constraints: readonly NutritionConstraint[] = [
            {
                kind: 'allergy',
                code: 'tree_nut',
                label: 'tree_nut',
                severity: 'critical',
                source: 'user',
                note: null,
            },
            {
                kind: 'intolerance',
                code: 'milk',
                label: 'milk',
                severity: 'strict',
                source: 'user',
                note: null,
            },
        ];
        expect(storedAllergenCodes(constraints)).toEqual([treeNut]);
        expect(storedAllergenCodes(undefined)).toEqual([]);
    });

    it('reads a diet preference only when the plan can actually cook to it', () => {
        const constraints: readonly NutritionConstraint[] = [
            {
                kind: 'preference',
                code: 'mediterranean',
                label: 'mediterranean',
                severity: 'advisory',
                source: 'user',
                note: null,
            },
        ];
        expect(storedDietClassifications(constraints, ['omnivore', 'mediterranean'])).toEqual([
            'mediterranean',
        ]);
        expect(storedDietClassifications(constraints, ['vegan'])).toEqual([]);
    });
});

describe('step validation', () => {
    async function fixture(): Promise<{
        readonly state: ConfiguratorState;
        readonly context: StepContext;
    }> {
        const plan = await planBySlug('balanced-week');
        const state: ConfiguratorState = {
            ...initialConfiguratorState({
                plan,
                startDate: '2026-08-03',
                allowedWeekdays: [1, 2, 3, 4, 5, 7],
            }),
            address: COMPLETE_ADDRESS,
            checksAcknowledged: true,
            termsAcknowledged: true,
        };
        const context: StepContext = {
            plan,
            allowedWeekdays: [1, 2, 3, 4, 5, 7],
            areaStatus: 'served',
            earliestStartDate: '2026-07-31',
            translate,
        };
        return { state, context };
    }

    it('lets a complete configuration through every step', async () => {
        const { state, context } = await fixture();
        for (const step of CONFIGURATOR_STEPS) {
            expect(validateConfiguratorStep(step, state, context)).toEqual([]);
        }
        expect(firstIncompleteStep(state, context)).toBeNull();
    });

    it('refuses a delivery day the plan does not deliver on', async () => {
        const { state, context } = await fixture();
        const issues = validateConfiguratorStep(
            'delivery',
            { ...state, deliveryWeekdays: [6] },
            context,
        );
        expect(issues).toContain('commerce:configurator.issues.deliveryDayUnavailable');
    });

    it('refuses a start date on a weekday the plan does not deliver on', async () => {
        const { state, context } = await fixture();
        // 2026-08-01 is a Saturday; this plan delivers on every day except Saturday.
        const issues = validateConfiguratorStep(
            'delivery',
            { ...state, startDate: '2026-08-01' },
            context,
        );
        expect(issues).toContain('commerce:configurator.issues.startWeekday');
    });

    it('refuses a start date earlier than tomorrow', async () => {
        const { state, context } = await fixture();
        const issues = validateConfiguratorStep(
            'delivery',
            { ...state, startDate: '2026-07-27' },
            context,
        );
        expect(issues).toContain('commerce:configurator.issues.startTooSoon');
    });

    it('refuses a configuration with no delivery days at all', async () => {
        const { state, context } = await fixture();
        const issues = validateConfiguratorStep(
            'delivery',
            { ...state, deliveryWeekdays: [] },
            context,
        );
        expect(issues).toContain('commerce:configurator.issues.noDeliveryDays');
    });

    it('enforces no weekday rule while the allowed set is still unknown', async () => {
        const { state, context } = await fixture();
        const issues = validateConfiguratorStep(
            'delivery',
            { ...state, deliveryWeekdays: [6] },
            { ...context, allowedWeekdays: null },
        );
        expect(issues).not.toContain('commerce:configurator.issues.deliveryDayUnavailable');
    });

    it('stops an unserved area outright rather than offering to acknowledge it away', async () => {
        const { state, context } = await fixture();
        const issues = validateConfiguratorStep('delivery', state, {
            ...context,
            areaStatus: 'unserved',
        });
        expect(issues).toContain('commerce:configurator.issues.areaUnserved');
    });

    it('lets an unknown area through, because silence is not a refusal', async () => {
        const { state, context } = await fixture();
        const issues = validateConfiguratorStep('delivery', state, {
            ...context,
            areaStatus: 'unknown',
        });
        expect(issues).toEqual([]);
    });

    it('will not leave the delivery step until both checks are acknowledged', async () => {
        const { state, context } = await fixture();
        const issues = validateConfiguratorStep(
            'delivery',
            { ...state, checksAcknowledged: false },
            context,
        );
        expect(issues).toContain('commerce:configurator.issues.checks');
    });

    it('will not leave the delivery step on an incomplete address', async () => {
        const { state, context } = await fixture();
        const issues = validateConfiguratorStep(
            'delivery',
            { ...state, address: EMPTY_ADDRESS },
            context,
        );
        expect(issues).toContain('commerce:configurator.issues.address');
    });

    it('will not confirm without the terms acknowledgement the repository requires', async () => {
        const { state, context } = await fixture();
        expect(
            validateConfiguratorStep('confirm', { ...state, termsAcknowledged: false }, context),
        ).toEqual(['commerce:configurator.issues.terms']);
    });

    it('makes a later step unreachable while an earlier one is unanswered', async () => {
        const { state, context } = await fixture();
        const broken = { ...state, deliveryWeekdays: [] };
        expect(isStepReachable('summary', broken, context)).toBe(false);
        expect(isStepReachable('dietary', broken, context)).toBe(true);
        expect(firstIncompleteStep(broken, context)).toBe('delivery');
    });
});

describe('turning the configurator state into a request', () => {
    it('sorts the delivery weekdays so the same choice always sends the same request', async () => {
        const plan = await planBySlug('balanced-week');
        const state: ConfiguratorState = {
            ...initialConfiguratorState({ plan, startDate: '2026-08-03' }),
            deliveryWeekdays: [5, 1, 3],
            address: COMPLETE_ADDRESS,
        };
        const configuration = toConfiguration(state, plan, toDeliveryAddress);
        expect(configuration?.deliveryWeekdays).toEqual([1, 3, 5]);
    });

    it('answers null rather than sending an incomplete proposal', async () => {
        const plan = await planBySlug('balanced-week');
        const base = initialConfiguratorState({ plan, startDate: '2026-08-03' });

        expect(toConfiguration({ ...base, variantId: null }, plan, toDeliveryAddress)).toBeNull();
        expect(toConfiguration({ ...base, startDate: null }, plan, toDeliveryAddress)).toBeNull();
        expect(
            toConfiguration({ ...base, deliveryWeekdays: [] }, plan, toDeliveryAddress),
        ).toBeNull();
    });

    it('derives the same delivery dates the repository will bill for', async () => {
        const plan = await planBySlug('balanced-week');
        const state: ConfiguratorState = {
            ...initialConfiguratorState({ plan, startDate: '2026-08-03' }),
            deliveryWeekdays: [1, 3, 5],
            address: COMPLETE_ADDRESS,
        };
        const configuration = toConfiguration(state, plan, toDeliveryAddress);
        expect(configuration).not.toBeNull();

        const preview = await scratch.commerce.previewSubscription(configuration!);
        expect(configuredDeliveryDates(state).length).toBe(preview.deliveryCount);
        expect(configuredDeliveryDates(state)[0]).toBe(preview.firstDeliveryDate);
    });
});

/* ══ pure: warnings and states ═════════════════════════════════════════════════════════════════ */

describe('preview warnings', () => {
    it('has written copy for every code the repository can emit', () => {
        expect(isKnownWarning(CHECKOUT_EMPTY_CART)).toBe(true);
        expect(isKnownWarning(SUBSCRIPTION_DAY_UNAVAILABLE)).toBe(true);
        expect(warningMessageKey(SUBSCRIPTION_DAY_UNAVAILABLE)).toBe(
            'commerce:warnings.subscription_delivery_day_unavailable',
        );
    });

    it('falls back to one generic sentence for a code it has never seen', () => {
        expect(isKnownWarning('subscription.invented_later')).toBe(false);
        expect(warningMessageKey('subscription.invented_later')).toBe('commerce:warnings.unknown');
    });

    it('treats an allergen conflict as critical and a scheduling note as not', () => {
        expect(isCriticalWarning(ALLERGEN_CONFLICT_WARNING)).toBe(true);
        expect(isCriticalWarning(SUBSCRIPTION_DAY_UNAVAILABLE)).toBe(false);
    });

    it('drops the empty-basket warning, which the empty state already says', () => {
        expect(displayableWarnings([CHECKOUT_EMPTY_CART, ALLERGEN_CONFLICT_WARNING])).toEqual([
            ALLERGEN_CONFLICT_WARNING,
        ]);
    });
});

describe('what each subscription state permits', () => {
    it('covers every state in the domain vocabulary', () => {
        for (const state of SUBSCRIPTION_STATES) {
            expect(typeof canPauseOrSkip(state)).toBe('boolean');
            expect(typeof isTerminalSubscriptionState(state)).toBe('boolean');
        }
    });

    it('permits pause and skip only from the two live states', () => {
        expect(SUBSCRIPTION_STATES.filter(canPauseOrSkip)).toEqual(['active', 'skipped_today']);
    });

    it('permits resume only from paused', () => {
        expect(SUBSCRIPTION_STATES.filter(canResume)).toEqual(['paused']);
    });

    it('permits address and slot changes from every live or paused state', () => {
        expect(SUBSCRIPTION_STATES.filter(canChangeDelivery)).toEqual([
            'active',
            'paused',
            'skipped_today',
        ]);
    });

    it('treats cancelled and expired as read-only', () => {
        expect(SUBSCRIPTION_STATES.filter(isTerminalSubscriptionState)).toEqual([
            'cancelled',
            'expired',
        ]);
    });
});

/* ══ the repository guards these screens rely on ═══════════════════════════════════════════════ */

describe('guarded transitions', () => {
    it('refuses to resume a subscription that was never paused', async () => {
        const world = createMockRepositories({ scenario: 'consumer-prototype', latencyMs: 0 });
        const id = await seededSubscriptionId();

        await expect(world.commerce.resume(id)).rejects.toMatchObject({
            failure: { code: 'validation.failed' },
        });
    });

    it('refuses to pause a subscription that is already paused', async () => {
        const world = createMockRepositories({ scenario: 'consumer-prototype', latencyMs: 0 });
        const id = await seededSubscriptionId();

        await world.commerce.pause(id);
        await expect(world.commerce.pause(id)).rejects.toMatchObject({
            failure: { code: 'validation.failed' },
        });
    });

    it('refuses a delivery slot that does not exist', async () => {
        const world = createMockRepositories({ scenario: 'consumer-prototype', latencyMs: 0 });
        const id = await seededSubscriptionId();

        await expect(world.commerce.changeSlot(id, { slotCode: 'midnight' })).rejects.toMatchObject(
            { failure: { code: 'validation.failed' } },
        );
    });

    it('refuses to create a subscription whose summary was never acknowledged', async () => {
        const world = createMockRepositories({ scenario: 'consumer-prototype', latencyMs: 0 });
        const plan = await planBySlug('balanced-week');
        const variant = plan.variants[1] ?? plan.variants[0];
        expect(variant).toBeDefined();

        await expect(
            world.commerce.createSubscription({
                configuration: {
                    planId: plan.id,
                    variantId: variant!.id,
                    duration: '4w',
                    startDate: '2026-08-03',
                    deliveryWeekdays: [1, 3, 5],
                    slotCode: 'midday',
                    address: toDeliveryAddress(COMPLETE_ADDRESS),
                    dietClassifications: [],
                    excludeAllergens: [],
                    selectedMealIds: [],
                },
                acknowledgedTerms: false,
            }),
        ).rejects.toMatchObject({ failure: { code: 'validation.failed' } });
    });
});

/* ══ screens: the basket ═══════════════════════════════════════════════════════════════════════ */

async function seedBasket(quantity = 2) {
    const page = await scratch.marketplace.listMeals({ limit: 1 });
    const meal = page.items[0];
    if (meal === undefined) throw new Error('The prototype world has no marketplace meals.');

    return async (repositories: MockRepositories) => {
        const cart = await repositories.commerce.getCart();
        await repositories.commerce.addCartItem(cart.id, { mealId: meal.id, quantity });
    };
}

describe('CartScreen', () => {
    it('shows skeletons before the basket arrives', async () => {
        await renderCommerce(<CartScreen />, { latencyMs: 60 });
        expect(screen.getByTestId('cart-loading')).toBeTruthy();
        await waitFor(() => {
            expect(screen.getByTestId('cart-empty')).toBeTruthy();
        });
    });

    it('offers a way to the marketplace when the basket is empty', async () => {
        await renderCommerce(<CartScreen />);
        await waitFor(() => {
            expect(screen.getByTestId('cart-empty')).toBeTruthy();
        });
        await fireEvent.press(screen.getByTestId('cart-browse'));
        expect(routerMock.__push).toHaveBeenCalledWith('/meals');
    });

    it('renders every line with its own price, and a priced total from the preview', async () => {
        await renderCommerce(<CartScreen />, { seed: await seedBasket(2) });

        await waitFor(() => {
            expect(screen.getByTestId('cart-lines')).toBeTruthy();
        });
        expect(screen.getByTestId('cart-count')).toBeTruthy();
        await waitFor(() => {
            expect(screen.getByTestId('cart-price-total-amount')).toBeTruthy();
        });
        expect(screen.getByTestId('cart-price-subtotal-amount')).toBeTruthy();
        expect(screen.getByTestId('cart-price-no-payment')).toBeTruthy();
    });

    it('raises a quantity for real, and the total moves with it', async () => {
        const harness = await renderCommerce(<CartScreen />, { seed: await seedBasket(1) });
        await waitFor(() => {
            expect(screen.getByTestId('cart-lines')).toBeTruthy();
        });

        const before = await harness.repositories.commerce.getCart();
        expect(before.itemCount).toBe(1);

        const increment = screen.getByTestId(
            `cart-line-${String(before.items[0]?.id)}-quantity-increment`,
        );
        await act(async () => {
            fireEvent.press(increment);
        });

        await waitFor(async () => {
            const after = await harness.repositories.commerce.getCart();
            expect(after.itemCount).toBe(2);
        });
    });

    it('lowers a quantity by rebuilding the line, since the contract cannot set one', async () => {
        const harness = await renderCommerce(<CartScreen />, { seed: await seedBasket(3) });
        await waitFor(() => {
            expect(screen.getByTestId('cart-lines')).toBeTruthy();
        });

        const before = await harness.repositories.commerce.getCart();
        const decrement = screen.getByTestId(
            `cart-line-${String(before.items[0]?.id)}-quantity-decrement`,
        );
        await act(async () => {
            fireEvent.press(decrement);
        });

        await waitFor(async () => {
            const after = await harness.repositories.commerce.getCart();
            expect(after.itemCount).toBe(2);
            expect(after.items).toHaveLength(1);
        });
    });

    it('removes a line for real and falls back to the empty state', async () => {
        const harness = await renderCommerce(<CartScreen />, { seed: await seedBasket(1) });
        await waitFor(() => {
            expect(screen.getByTestId('cart-lines')).toBeTruthy();
        });

        const before = await harness.repositories.commerce.getCart();
        await act(async () => {
            fireEvent.press(screen.getByTestId(`cart-line-${String(before.items[0]?.id)}-remove`));
        });

        await waitFor(() => {
            expect(screen.getByTestId('cart-empty')).toBeTruthy();
        });
    });

    it('sends a full basket onward to checkout', async () => {
        await renderCommerce(<CartScreen />, { seed: await seedBasket(1) });
        await waitFor(() => {
            expect(screen.getByTestId('cart-checkout')).toBeTruthy();
        });
        await fireEvent.press(screen.getByTestId('cart-checkout'));
        expect(routerMock.__push).toHaveBeenCalledWith('/customer/checkout');
    });
});

/* ══ screens: checkout ═════════════════════════════════════════════════════════════════════════ */

async function fillAddress(prefix: string) {
    await act(async () => {
        fireEvent.changeText(screen.getByTestId(`${prefix}-label-input`), 'Home');
        fireEvent.changeText(screen.getByTestId(`${prefix}-line1-input`), 'Apartment 3');
        fireEvent.changeText(screen.getByTestId(`${prefix}-city-input`), 'Dubai');
        fireEvent.changeText(screen.getByTestId(`${prefix}-countryCode-input`), 'AE');
    });
}

describe('CheckoutScreen', () => {
    it('says there is nothing to check out when the basket is empty', async () => {
        await renderCommerce(<CheckoutScreen />);
        await waitFor(() => {
            expect(screen.getByTestId('checkout-empty')).toBeTruthy();
        });
        expect(screen.getByTestId('checkout-prototype-notice')).toBeTruthy();
    });

    it('collects an address and a window, and never a payment instrument', async () => {
        await renderCommerce(<CheckoutScreen />, { seed: await seedBasket(1) });
        await waitFor(() => {
            expect(screen.getByTestId('checkout-address-form')).toBeTruthy();
        });

        expect(screen.getByTestId('checkout-slot-picker')).toBeTruthy();
        expect(screen.getByTestId('checkout-date-field')).toBeTruthy();
        expect(screen.getByTestId('checkout-address-form-storage-note')).toBeTruthy();

        // The property that matters most on this screen is an absence.
        expect(screen.queryByTestId('checkout-card-number')).toBeNull();
        expect(screen.queryByTestId('checkout-payment')).toBeNull();
    });

    it('refuses to review an incomplete address and says which field is missing', async () => {
        await renderCommerce(<CheckoutScreen />, { seed: await seedBasket(1) });
        await waitFor(() => {
            expect(screen.getByTestId('checkout-review')).toBeTruthy();
        });

        await act(async () => {
            fireEvent.press(screen.getByTestId('checkout-review'));
        });

        await waitFor(() => {
            expect(screen.getByTestId('checkout-address-form-line1')).toBeTruthy();
        });
        // Still on the collecting phase: no place-order control has appeared.
        expect(screen.queryByTestId('checkout-place-order')).toBeNull();
    });

    it('commits the delivery details and re-prices against them', async () => {
        await renderCommerce(<CheckoutScreen />, { seed: await seedBasket(1) });
        await waitFor(() => {
            expect(screen.getByTestId('checkout-address-form')).toBeTruthy();
        });
        await fillAddress('checkout-address-form');
        await act(async () => {
            fireEvent.changeText(
                screen.getByTestId('checkout-address-form-area-input'),
                'Downtown',
            );
        });

        await act(async () => {
            fireEvent.press(screen.getByTestId('checkout-review'));
        });

        await waitFor(() => {
            expect(screen.getByTestId('checkout-place-order')).toBeTruthy();
        });
        expect(screen.getByTestId('checkout-committed-address')).toBeTruthy();
        expect(screen.getByTestId('checkout-committed-slot')).toBeTruthy();
    });

    it('answers "place order" with a success screen that says no payment was taken', async () => {
        const harness = await renderCommerce(<CheckoutScreen />, { seed: await seedBasket(1) });
        await waitFor(() => {
            expect(screen.getByTestId('checkout-address-form')).toBeTruthy();
        });
        await fillAddress('checkout-address-form');
        await act(async () => {
            fireEvent.changeText(
                screen.getByTestId('checkout-address-form-area-input'),
                'Downtown',
            );
        });
        await act(async () => {
            fireEvent.press(screen.getByTestId('checkout-review'));
        });
        await waitFor(() => {
            expect(screen.getByTestId('checkout-place-order')).toBeTruthy();
        });

        await act(async () => {
            fireEvent.press(screen.getByTestId('checkout-place-order'));
        });

        await waitFor(() => {
            expect(screen.getByTestId('checkout-success-screen')).toBeTruthy();
        });
        expect(screen.getByTestId('checkout-success-prototype')).toBeTruthy();
        expect(screen.getByTestId('checkout-success-price-total-amount')).toBeTruthy();

        // The basket is deliberately untouched: emptying it would assert that an order exists.
        const cart = await harness.repositories.commerce.getCart();
        expect(cart.items).toHaveLength(1);
    });
});

/* ══ screens: the configurator ═════════════════════════════════════════════════════════════════ */

describe('SubscriptionConfiguratorScreen', () => {
    it('answers a malformed plan identifier with the not-found state', async () => {
        await renderCommerce(<SubscriptionConfiguratorScreen planId="not-a-uuid" />);
        expect(screen.getByTestId('configurator-empty')).toBeTruthy();
    });

    it('reports a failure rather than an empty page for an unknown plan', async () => {
        await renderCommerce(
            <SubscriptionConfiguratorScreen planId="01935f6d-d000-7000-8000-0000000000ff" />,
            { latencyMs: 40 },
        );
        expect(screen.getByTestId('configurator-loading')).toBeTruthy();
        await waitFor(() => {
            expect(screen.getByTestId('configurator-error')).toBeTruthy();
        });
    });

    it('opens on the calorie band, the macro ranges and their variability caveat', async () => {
        const plan = await planBySlug('balanced-week');
        await renderCommerce(<SubscriptionConfiguratorScreen planId={String(plan.id)} />);

        await waitFor(() => {
            expect(screen.getByTestId('configurator-step-plan')).toBeTruthy();
        });
        expect(screen.getByTestId('configurator-energy-band')).toBeTruthy();
        expect(screen.getByTestId('configurator-macro-protein')).toBeTruthy();
        expect(screen.getByTestId('medical-disclaimer')).toBeTruthy();
        expect(screen.getByTestId('configurator-stepper')).toBeTruthy();
    });

    it('shows no price at all before the summary step, and says why', async () => {
        const plan = await planBySlug('balanced-week');
        await renderCommerce(<SubscriptionConfiguratorScreen planId={String(plan.id)} />);

        await waitFor(() => {
            expect(screen.getByTestId('configurator-step-plan')).toBeTruthy();
        });
        expect(screen.getByTestId('configurator-price-later')).toBeTruthy();
        expect(screen.queryByTestId('configurator-price')).toBeNull();
    });

    it('opens on the variant the plan page was showing when one is supplied', async () => {
        const plan = await planBySlug('balanced-week');
        const light = plan.variants[0];
        expect(light).toBeDefined();

        await renderCommerce(
            <SubscriptionConfiguratorScreen
                planId={String(plan.id)}
                variantId={String(light!.id)}
            />,
        );

        await waitFor(() => {
            expect(screen.getByTestId('configurator-energy-band')).toBeTruthy();
        });
        expect(screen.getByTestId(`configurator-variant-${String(light!.id)}`)).toBeTruthy();
    });

    it('states that the combination and the calorie band are not independent', async () => {
        const plan = await planBySlug('balanced-week');
        await renderCommerce(<SubscriptionConfiguratorScreen planId={String(plan.id)} />);
        await waitFor(() => {
            expect(screen.getByTestId('configurator-step-plan')).toBeTruthy();
        });

        await act(async () => {
            fireEvent.press(screen.getByTestId('configurator-next'));
        });

        await waitFor(() => {
            expect(screen.getByTestId('configurator-step-combination')).toBeTruthy();
        });
        expect(screen.getByTestId('configurator-combination-note')).toBeTruthy();
    });

    it('attaches the discount to the duration option itself (doc 17, SUB-05)', async () => {
        const plan = await planBySlug('balanced-week');
        await renderCommerce(<SubscriptionConfiguratorScreen planId={String(plan.id)} />);
        await waitFor(() => {
            expect(screen.getByTestId('configurator-step-plan')).toBeTruthy();
        });

        for (let index = 0; index < 2; index += 1) {
            await act(async () => {
                fireEvent.press(screen.getByTestId('configurator-next'));
            });
        }

        await waitFor(() => {
            expect(screen.getByTestId('configurator-step-duration')).toBeTruthy();
        });
        expect(screen.getByTestId('configurator-duration-4w-discount')).toBeTruthy();
        expect(screen.getByTestId('configurator-duration-4w-total')).toBeTruthy();
        expect(screen.queryByTestId('configurator-price')).toBeNull();
    });

    it('pre-fills the allergies already on the profile, and flags removing one', async () => {
        const plan = await planBySlug('balanced-week');
        await renderCommerce(<SubscriptionConfiguratorScreen planId={String(plan.id)} />);
        await waitFor(() => {
            expect(screen.getByTestId('configurator-step-plan')).toBeTruthy();
        });

        for (let index = 0; index < 3; index += 1) {
            await act(async () => {
                fireEvent.press(screen.getByTestId('configurator-next'));
            });
        }
        await waitFor(() => {
            expect(screen.getByTestId('configurator-step-dietary')).toBeTruthy();
        });

        // The consumer fixture records one allergy: tree nuts.
        const chip = await waitFor(() => screen.getByTestId('configurator-allergen-tree_nut'));
        await act(async () => {
            fireEvent.press(chip);
        });

        await waitFor(() => {
            expect(screen.getByTestId('configurator-allergen-relaxed')).toBeTruthy();
        });
        expect(screen.getByTestId('medical-disclaimer')).toBeTruthy();
    });

    it('will not leave the delivery step until the two checks are acknowledged', async () => {
        const plan = await planBySlug('balanced-week');
        await renderCommerce(<SubscriptionConfiguratorScreen planId={String(plan.id)} />);
        await waitFor(() => {
            expect(screen.getByTestId('configurator-step-plan')).toBeTruthy();
        });

        for (let index = 0; index < 4; index += 1) {
            await act(async () => {
                fireEvent.press(screen.getByTestId('configurator-next'));
            });
        }
        await waitFor(() => {
            expect(screen.getByTestId('configurator-step-delivery')).toBeTruthy();
        });
        expect(screen.getByTestId('configurator-checks')).toBeTruthy();

        await act(async () => {
            fireEvent.press(screen.getByTestId('configurator-next'));
        });

        await waitFor(() => {
            expect(screen.getByTestId('configurator-issues')).toBeTruthy();
        });
        expect(screen.getByTestId('configurator-step-delivery')).toBeTruthy();
    });

    it('disables the weekdays the plan does not deliver on', async () => {
        // The office plan is the sharpest case: no weekend deliveries at all.
        const plan = await planBySlug('desk-lunch-club');
        await renderCommerce(<SubscriptionConfiguratorScreen planId={String(plan.id)} />);
        await waitFor(() => {
            expect(screen.getByTestId('configurator-step-plan')).toBeTruthy();
        });

        for (let index = 0; index < 4; index += 1) {
            await act(async () => {
                fireEvent.press(screen.getByTestId('configurator-next'));
            });
        }

        await waitFor(() => {
            expect(screen.getByTestId('configurator-weekdays-limited')).toBeTruthy();
        });
        const saturday = screen.getByTestId('configurator-weekday-6');
        expect(saturday.props.accessibilityState?.disabled ?? saturday.props['aria-disabled']).toBe(
            true,
        );
    });

    it('walks all eight steps and creates a real subscription at the end', async () => {
        const plan = await planBySlug('balanced-week');
        const kitchen = await scratch.marketplace.getKitchen(plan.kitchenId);
        const area = servedAreas(kitchen)[0] ?? 'Business Bay';

        const harness = await renderCommerce(
            <SubscriptionConfiguratorScreen planId={String(plan.id)} />,
        );
        await waitFor(() => {
            expect(screen.getByTestId('configurator-step-plan')).toBeTruthy();
        });

        const before = await harness.repositories.commerce.listSubscriptions();

        // 1 plan → 2 combination → 3 duration → 4 dietary
        for (let index = 0; index < 4; index += 1) {
            await act(async () => {
                fireEvent.press(screen.getByTestId('configurator-next'));
            });
        }

        // 5 delivery: address, the repair chip when tomorrow is not a delivery day, and the checks.
        await waitFor(() => {
            expect(screen.getByTestId('configurator-step-delivery')).toBeTruthy();
        });
        await fillAddress('configurator-address-form');
        await act(async () => {
            fireEvent.changeText(screen.getByTestId('configurator-address-form-area-input'), area);
        });
        await waitFor(() => {
            expect(screen.getByTestId('configurator-area-served')).toBeTruthy();
        });

        // The default start is tomorrow, which is a delivery day on most weeks and not on others.
        // The repair chip is the designed answer either way, so it is pressed when it is offered.
        const repair = screen.queryByTestId('configurator-start-date-repair');
        if (repair !== null) {
            await act(async () => {
                fireEvent.press(repair);
            });
        }

        await act(async () => {
            fireEvent.press(screen.getByTestId('configurator-checks-acknowledge-control'));
        });
        await act(async () => {
            fireEvent.press(screen.getByTestId('configurator-next'));
        });

        // 6 the sample week
        await waitFor(() => {
            expect(screen.getByTestId('configurator-step-meals')).toBeTruthy();
        });
        expect(screen.getByTestId('configurator-meals-note')).toBeTruthy();
        await act(async () => {
            fireEvent.press(screen.getByTestId('configurator-next'));
        });

        // 7 the first price anybody has seen
        await waitFor(
            () => {
                expect(screen.getByTestId('configurator-price-total-amount')).toBeTruthy();
            },
            { timeout: 5000 },
        );
        expect(screen.getByTestId('configurator-price-per-delivery-amount')).toBeTruthy();
        expect(screen.getByTestId('configurator-summary-checks')).toBeTruthy();
        await act(async () => {
            fireEvent.press(screen.getByTestId('configurator-next'));
        });

        // 8 confirm
        await waitFor(() => {
            expect(screen.getByTestId('configurator-step-confirm')).toBeTruthy();
        });
        await act(async () => {
            fireEvent.press(screen.getByTestId('configurator-confirm-acknowledge-control'));
        });
        await act(async () => {
            fireEvent.press(screen.getByTestId('configurator-create'));
        });

        await waitFor(
            () => {
                expect(screen.getByTestId('configurator-success-screen')).toBeTruthy();
            },
            { timeout: 5000 },
        );
        expect(screen.getByTestId('configurator-success-state')).toBeTruthy();

        const after = await harness.repositories.commerce.listSubscriptions();
        expect(after.items.length).toBe(before.items.length + 1);
    }, 30_000);

    it('surfaces the repository refusal when the summary was never acknowledged', async () => {
        const plan = await planBySlug('balanced-week');
        await renderCommerce(<SubscriptionConfiguratorScreen planId={String(plan.id)} />);
        await waitFor(() => {
            expect(screen.getByTestId('configurator-step-plan')).toBeTruthy();
        });

        for (let index = 0; index < 4; index += 1) {
            await act(async () => {
                fireEvent.press(screen.getByTestId('configurator-next'));
            });
        }
        await waitFor(() => {
            expect(screen.getByTestId('configurator-step-delivery')).toBeTruthy();
        });

        // Pressing Next without the acknowledgement names the missing answer rather than
        // silently doing nothing, which is the whole point of the checkpoint.
        await act(async () => {
            fireEvent.press(screen.getByTestId('configurator-next'));
        });
        await waitFor(() => {
            expect(screen.getByTestId('configurator-issue-checks')).toBeTruthy();
        });
    });
});

/* ══ screens: subscription list and detail ═════════════════════════════════════════════════════ */

describe('SubscriptionsScreen', () => {
    it('shows skeletons before the list arrives', async () => {
        await renderCommerce(<SubscriptionsScreen />, { latencyMs: 60 });
        expect(screen.getByTestId('subscriptions-loading')).toBeTruthy();
        await waitFor(() => {
            expect(screen.getByTestId('subscriptions-list')).toBeTruthy();
        });
    });

    it('renders each subscription with its state and its next delivery', async () => {
        const id = await seededSubscriptionId();
        await renderCommerce(<SubscriptionsScreen />);

        await waitFor(() => {
            expect(screen.getByTestId(`subscription-row-${String(id)}`)).toBeTruthy();
        });
        expect(screen.getByTestId(`subscription-row-${String(id)}-state`)).toBeTruthy();
        expect(screen.getByTestId(`subscription-row-${String(id)}-next`)).toBeTruthy();
    });

    it('opens a row', async () => {
        const id = await seededSubscriptionId();
        await renderCommerce(<SubscriptionsScreen />);
        await waitFor(() => {
            expect(screen.getByTestId(`subscription-row-${String(id)}-open`)).toBeTruthy();
        });

        await fireEvent.press(screen.getByTestId(`subscription-row-${String(id)}-open`));
        expect(routerMock.__push).toHaveBeenCalledWith(`/customer/subscriptions/${String(id)}`);
    });

    it('has a real empty state for a filter nothing matches', async () => {
        await renderCommerce(<SubscriptionsScreen />);
        await waitFor(() => {
            expect(screen.getByTestId('subscriptions-list')).toBeTruthy();
        });

        await act(async () => {
            fireEvent.press(screen.getByTestId('subscriptions-filter-ended'));
        });

        await waitFor(() => {
            expect(screen.getByTestId('subscriptions-empty')).toBeTruthy();
        });
        expect(screen.getByTestId('subscriptions-clear-filter')).toBeTruthy();
    });
});

describe('SubscriptionDetailScreen', () => {
    it('answers a malformed identifier with the not-found state', async () => {
        await renderCommerce(<SubscriptionDetailScreen subscriptionId="not-a-uuid" />);
        expect(screen.getByTestId('subscription-detail-empty')).toBeTruthy();
    });

    it('reports a failure for an identifier that is well formed but unknown', async () => {
        await renderCommerce(
            <SubscriptionDetailScreen subscriptionId="01935f6d-a000-7000-8000-0000000000ff" />,
            { latencyMs: 40 },
        );
        expect(screen.getByTestId('subscription-detail-loading')).toBeTruthy();
        await waitFor(() => {
            expect(screen.getByTestId('subscription-detail-error')).toBeTruthy();
        });
    });

    it('renders the record, the configuration table and the actions', async () => {
        const id = await seededSubscriptionId();
        await renderCommerce(<SubscriptionDetailScreen subscriptionId={String(id)} />);

        await waitFor(() => {
            expect(screen.getByTestId('subscription-detail-name')).toBeTruthy();
        });
        expect(screen.getByTestId('subscription-detail-timeline')).toBeTruthy();
        expect(screen.getByTestId('subscription-detail-config-table')).toBeTruthy();
        expect(screen.getByTestId('subscription-detail-next')).toBeTruthy();
        expect(screen.getByTestId('subscription-pause')).toBeTruthy();
        expect(screen.getByTestId('subscription-skip')).toBeTruthy();
        expect(screen.getByTestId('subscription-change-address')).toBeTruthy();
        expect(screen.getByTestId('subscription-change-slot')).toBeTruthy();
        // Resume is not offered from an active subscription: the repository would refuse it.
        expect(screen.queryByTestId('subscription-resume')).toBeNull();
    });

    it('pauses for real, through a dialog that states the consequence', async () => {
        const id = await seededSubscriptionId();
        const harness = await renderCommerce(
            <SubscriptionDetailScreen subscriptionId={String(id)} />,
        );
        await waitFor(() => {
            expect(screen.getByTestId('subscription-pause')).toBeTruthy();
        });

        await act(async () => {
            fireEvent.press(screen.getByTestId('subscription-pause'));
        });
        await waitFor(() => {
            expect(screen.getByTestId('subscription-pause-consequence')).toBeTruthy();
        });
        await act(async () => {
            fireEvent.press(screen.getByTestId('subscription-pause-confirm'));
        });

        await waitFor(async () => {
            const updated = await harness.repositories.commerce.getSubscription(id);
            expect(updated.state).toBe('paused');
        });
        await waitFor(() => {
            expect(screen.getByTestId('subscription-resume')).toBeTruthy();
        });
    });

    it('resumes a paused subscription for real', async () => {
        const id = await seededSubscriptionId();
        const harness = await renderCommerce(
            <SubscriptionDetailScreen subscriptionId={String(id)} />,
            {
                seed: async (repositories) => {
                    await repositories.commerce.pause(id);
                },
            },
        );
        await waitFor(() => {
            expect(screen.getByTestId('subscription-resume')).toBeTruthy();
        });

        await act(async () => {
            fireEvent.press(screen.getByTestId('subscription-resume'));
        });
        await waitFor(() => {
            expect(screen.getByTestId('subscription-resume-dialog')).toBeTruthy();
        });
        await act(async () => {
            fireEvent.press(screen.getByTestId('subscription-resume-confirm'));
        });

        await waitFor(async () => {
            const updated = await harness.repositories.commerce.getSubscription(id);
            expect(updated.state).toBe('active');
        });
    });

    it('skips a chosen delivery day for real', async () => {
        const id = await seededSubscriptionId();
        const harness = await renderCommerce(
            <SubscriptionDetailScreen subscriptionId={String(id)} />,
        );
        await waitFor(() => {
            expect(screen.getByTestId('subscription-skip')).toBeTruthy();
        });

        await act(async () => {
            fireEvent.press(screen.getByTestId('subscription-skip'));
        });
        await waitFor(() => {
            expect(screen.getByTestId('subscription-skip-sheet')).toBeTruthy();
        });

        const current = await harness.repositories.commerce.getSubscription(id);
        const target = current.nextDeliveryDate;
        expect(target).not.toBeNull();

        await act(async () => {
            fireEvent.press(screen.getByTestId(`subscription-skip-option-${String(target)}`));
        });
        await waitFor(() => {
            expect(screen.getByTestId('subscription-skip-consequence')).toBeTruthy();
        });
        await act(async () => {
            fireEvent.press(screen.getByTestId('subscription-skip-confirm'));
        });

        await waitFor(async () => {
            const updated = await harness.repositories.commerce.getSubscription(id);
            expect(updated.skippedDates).toContain(target);
        });
    });

    it('changes the delivery window for real', async () => {
        const id = await seededSubscriptionId();
        const harness = await renderCommerce(
            <SubscriptionDetailScreen subscriptionId={String(id)} />,
        );
        await waitFor(() => {
            expect(screen.getByTestId('subscription-change-slot')).toBeTruthy();
        });

        await act(async () => {
            fireEvent.press(screen.getByTestId('subscription-change-slot'));
        });
        await waitFor(() => {
            expect(screen.getByTestId('subscription-slot-picker')).toBeTruthy();
        });
        await act(async () => {
            fireEvent.press(screen.getByTestId('subscription-slot-evening'));
        });
        await act(async () => {
            fireEvent.press(screen.getByTestId('subscription-slot-confirm'));
        });

        await waitFor(async () => {
            const updated = await harness.repositories.commerce.getSubscription(id);
            expect(updated.configuration.slotCode).toBe('evening');
        });
    });

    it('changes the delivery address for real', async () => {
        const id = await seededSubscriptionId();
        const harness = await renderCommerce(
            <SubscriptionDetailScreen subscriptionId={String(id)} />,
        );
        await waitFor(() => {
            expect(screen.getByTestId('subscription-change-address')).toBeTruthy();
        });

        await act(async () => {
            fireEvent.press(screen.getByTestId('subscription-change-address'));
        });
        await waitFor(() => {
            expect(screen.getByTestId('subscription-address-form')).toBeTruthy();
        });
        await act(async () => {
            fireEvent.changeText(
                screen.getByTestId('subscription-address-form-line1-input'),
                'Villa 12, Garden Row',
            );
        });
        await act(async () => {
            fireEvent.press(screen.getByTestId('subscription-address-confirm'));
        });

        await waitFor(async () => {
            const updated = await harness.repositories.commerce.getSubscription(id);
            expect(updated.configuration.address.line1).toBe('Villa 12, Garden Row');
        });
    });

    it('shows the repository’s own refusal when the screen has gone stale', async () => {
        const id = await seededSubscriptionId();
        const harness = await renderCommerce(
            <SubscriptionDetailScreen subscriptionId={String(id)} />,
        );
        await waitFor(() => {
            expect(screen.getByTestId('subscription-pause')).toBeTruthy();
        });

        await act(async () => {
            fireEvent.press(screen.getByTestId('subscription-pause'));
        });
        await waitFor(() => {
            expect(screen.getByTestId('subscription-pause-confirm')).toBeTruthy();
        });

        // Somebody else — another tab, another device — pauses it while the dialog is open.
        await harness.repositories.commerce.pause(id);

        await act(async () => {
            fireEvent.press(screen.getByTestId('subscription-pause-confirm'));
        });

        await waitFor(() => {
            expect(screen.getByTestId('subscription-detail-error')).toBeTruthy();
        });
    });

    /**
     * The read-only path cannot be reached from the interface, and that is a **fixture and contract
     * gap rather than an omission**: `CommerceRepository` publishes no `cancel`, and the prototype
     * world seeds no cancelled or expired subscription, so there is no way to put one in front of
     * the screen. What is asserted here is the pair of facts the rule is built from — that a live
     * subscription shows its controls and not the closed notice, and that the two terminal states
     * are the ones the rule excludes — with the missing fixture recorded rather than papered over.
     */
    it('shows the controls, and not the closed notice, while a subscription is live', async () => {
        const id = await seededSubscriptionId();
        await renderCommerce(<SubscriptionDetailScreen subscriptionId={String(id)} />);

        await waitFor(() => {
            expect(screen.getByTestId('subscription-detail-actions')).toBeTruthy();
        });
        expect(screen.queryByTestId('subscription-detail-read-only')).toBeNull();
        expect(SUBSCRIPTION_STATES.filter(isTerminalSubscriptionState)).toEqual([
            'cancelled',
            'expired',
        ]);
    });
});
