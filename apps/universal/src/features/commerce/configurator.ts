import type {
    CustomerAddress,
    PlanDurationOption,
    PlanVariant,
    SetSubscriptionMealChoicesRequest,
    SubscriptionConfiguration,
    SubscriptionPlan,
} from '@healthy360/api-client/contracts';
import type { MealId, Money, PlanDuration, PlanVariantId } from '@healthy360/domain-types';

import { balanceTotal } from '../catalogue/plan-balance.ts';
import { EMPTY_ADDRESS } from './address.ts';
import type { AddressValues } from './address.ts';
import type { DeliveryAreaStatus } from './delivery.ts';
import { DEFAULT_SLOT_CODE, isDeliverySlotCode } from './delivery.ts';
import { deliveryDatesFor, isIsoDate, isoWeekday } from './dates.ts';

/**
 * The subscription configurator: its steps, its arithmetic and its rules.
 *
 * Everything in this module is pure. The screen renders it; it renders nothing. That split is what
 * makes "may this person move on from the delivery step?" a question a test can ask directly,
 * instead of one that can only be asked by pressing a button in a rendered tree.
 *
 * ## Three steps
 *
 * Doc 11, `SUB-01`/`SUB-03` record the reference product's whole pre-purchase configuration as
 * three decisions, and doc 17, `SUB-01` endorses keeping configuration short. So: `plan` (band,
 * meals, length), `delivery` (days, start, window, address) and `review` (the server's price,
 * optional first-week meals, the terms).
 *
 * Doc 17, `SUB-02`'s two dispositive questions — does the kitchen deliver here, and what must be
 * left out — are still settled before anything is created. The first lives in `delivery`, and an
 * unserved area is a hard stop. The second is answered by the person's dietary profile, which is
 * what generation actually reads: the steps show which of the plan's dishes cross it and where to
 * change it, rather than collecting a second list that went nowhere. The price is shown from the
 * first step, estimated on the client, and replaced by the server's own figures on `review`.
 *
 * ## Combination and band are not independent, and the interface says so
 *
 * Doc 17, `SUB-08` says meal combination and snack inclusion should be **two modelled attributes**
 * of a variant, derived from kitchen configuration, rather than a hand-curated flat list. Our
 * catalogue contract gets half way: `PlanVariant` carries `mealsPerDay` and `snacksPerDay` as
 * separate fields (good), but it binds them to the same object that carries the calorie band, so
 * choosing "three meals and two snacks" also chooses an energy band. {@link mealCombinations}
 * surfaces the combinations that genuinely exist on a plan and {@link variantForCombination} moves
 * between them; the screen states the coupling rather than hiding it. Recorded as a contract gap.
 */

export const CONFIGURATOR_STEPS = ['plan', 'delivery', 'review'] as const;
export type ConfiguratorStep = (typeof CONFIGURATOR_STEPS)[number];

export const CONFIGURATOR_STEP_COUNT = CONFIGURATOR_STEPS.length;

export function isConfiguratorStep(value: string): value is ConfiguratorStep {
    return (CONFIGURATOR_STEPS as readonly string[]).includes(value);
}

/** 1-based, for the progress indicator. */
export function stepPosition(step: ConfiguratorStep): number {
    return CONFIGURATOR_STEPS.indexOf(step) + 1;
}

export function nextConfiguratorStep(step: ConfiguratorStep): ConfiguratorStep | null {
    return CONFIGURATOR_STEPS[CONFIGURATOR_STEPS.indexOf(step) + 1] ?? null;
}

export function previousConfiguratorStep(step: ConfiguratorStep): ConfiguratorStep | null {
    const index = CONFIGURATOR_STEPS.indexOf(step);
    return index <= 0 ? null : (CONFIGURATOR_STEPS[index - 1] ?? null);
}

/* ── plan-derived options ────────────────────────────────────────────────────────────────────── */

export interface MealCombination {
    readonly mealsPerDay: number;
    readonly snacksPerDay: number;
    /** Every variant of the plan offering this combination, in catalogue order. */
    readonly variantIds: readonly PlanVariantId[];
}

/** A stable key for a combination — used as a control value and a React key. */
export function combinationKey(combination: {
    readonly mealsPerDay: number;
    readonly snacksPerDay: number;
}): string {
    return `${String(combination.mealsPerDay)}m-${String(combination.snacksPerDay)}s`;
}

/**
 * The distinct meal/snack combinations a plan actually offers.
 *
 * Distinct rather than one-per-variant: three variants that all deliver three meals and one snack
 * are one combination with three energy bands, and listing it three times would ask a person to
 * choose between three identical options.
 */
export function mealCombinations(plan: SubscriptionPlan): readonly MealCombination[] {
    const byKey = new Map<
        string,
        { mealsPerDay: number; snacksPerDay: number; ids: PlanVariantId[] }
    >();

    for (const variant of plan.variants) {
        const key = combinationKey(variant);
        const entry = byKey.get(key);
        if (entry === undefined) {
            byKey.set(key, {
                mealsPerDay: variant.mealsPerDay,
                snacksPerDay: variant.snacksPerDay,
                ids: [variant.id],
            });
            continue;
        }
        entry.ids.push(variant.id);
    }

    return [...byKey.values()].map((entry) => ({
        mealsPerDay: entry.mealsPerDay,
        snacksPerDay: entry.snacksPerDay,
        variantIds: entry.ids,
    }));
}

export function variantById(
    plan: SubscriptionPlan,
    variantId: PlanVariantId | null,
): PlanVariant | null {
    if (variantId === null) return null;
    return plan.variants.find((variant) => variant.id === variantId) ?? null;
}

/** The advertised variant: the middle one, matching the catalogue's own "from" price. */
export function defaultVariant(plan: SubscriptionPlan): PlanVariant | null {
    return plan.variants[Math.floor(plan.variants.length / 2)] ?? null;
}

/**
 * The variant to move to when a person picks a different combination.
 *
 * Keeps the energy band as close as the new combination allows, because changing "add a second
 * snack" should not silently move somebody from 1,600 kcal to 2,300. The band that changes least is
 * the one whose midpoint is nearest the current variant's midpoint.
 */
export function variantForCombination(
    plan: SubscriptionPlan,
    combination: MealCombination,
    current: PlanVariant | null,
): PlanVariant | null {
    const candidates = plan.variants.filter((variant) =>
        combination.variantIds.includes(variant.id),
    );
    const [first] = candidates;
    if (first === undefined) return null;
    if (current === null) return first;

    const midpoint = (variant: PlanVariant): number =>
        (variant.energyRange.min + variant.energyRange.max) / 2;
    const target = midpoint(current);

    return candidates.reduce<PlanVariant>(
        (closest, variant) =>
            Math.abs(midpoint(variant) - target) < Math.abs(midpoint(closest) - target)
                ? variant
                : closest,
        first,
    );
}

/* ── pricing ─────────────────────────────────────────────────────────────────────────────────── */

/** The duration option a state names, or `undefined` when the plan no longer offers it. */
export function durationOption(
    plan: SubscriptionPlan,
    duration: PlanDuration | null,
): PlanDurationOption | undefined {
    if (duration === null) return undefined;
    return plan.durations.find((option) => option.duration === duration);
}

/**
 * The estimated total for a variant over a duration: the server's own figure when it states one,
 * else the discounted per-day price × the days, rounded the way `SubscriptionPricing` rounds
 * (`balanceTotal`). Shown from the first step without a round trip per choice; `previewSubscription`
 * remains the authority and `review` shows *its* figures, not these.
 */
export function estimatedTotal(
    variant: PlanVariant | null,
    option: PlanDurationOption | undefined,
): Money | null {
    if (option === undefined) return null;
    if (option.totalPrice !== null) return option.totalPrice;
    if (variant === null) return null;
    return balanceTotal(variant, option);
}

/**
 * What one delivery costs.
 *
 * Doc 11, `PRC-03` records the reference quoting a per-meal price on the catalogue card and a total
 * in the configurator — two units in one journey, at exactly the moment somebody is comparing. Doc
 * 17, `SUB-09` says show both in both places. This is the derived one, and it is labelled as
 * derived: `null` when there are no deliveries, because dividing by zero deliveries produces a
 * number rather than an answer.
 *
 * Currency is carried through untouched. There is no addition across currencies anywhere in this
 * module, which is the only safe policy when a catalogue can quote in AED and SAR.
 */
export function perDeliveryPrice(total: Money, deliveryCount: number): Money | null {
    if (deliveryCount <= 0) return null;
    return { amount: Math.round(total.amount / deliveryCount), currency: total.currency };
}

/* ── the state ───────────────────────────────────────────────────────────────────────────────── */

export interface ConfiguratorState {
    readonly variantId: PlanVariantId | null;
    /** `null` when the plan offers no length this storefront can sell; the plan step says so. */
    readonly duration: PlanDuration | null;
    readonly startDate: string | null;
    readonly deliveryWeekdays: readonly number[];
    readonly slotCode: string;
    /**
     * The saved address the delivery step chose, in form shape ({@link savedAddressValues}), so the
     * configuration and the review read it like any other choice. Never typed in: placement takes
     * a saved address's identifier and nothing else (D-084).
     */
    readonly address: AddressValues;
    readonly selectedMealIds: readonly MealId[];
    /** The terms summary on the confirm step. `createSubscription` rejects without it. */
    readonly termsAcknowledged: boolean;
}

export interface InitialStateOptions {
    readonly plan: SubscriptionPlan;
    readonly variantId?: PlanVariantId | null | undefined;
    readonly startDate: string;
    readonly allowedWeekdays?: readonly number[] | undefined;
}

/** The state a freshly opened configurator starts in: the advertised band, the shortest length. */
export function initialConfiguratorState(options: InitialStateOptions): ConfiguratorState {
    const variant =
        variantById(options.plan, options.variantId ?? null) ?? defaultVariant(options.plan);
    const allowed = options.allowedWeekdays ?? [];
    return {
        variantId: variant?.id ?? null,
        duration: options.plan.durations[0]?.duration ?? null,
        startDate: options.startDate,
        deliveryWeekdays: [...allowed],
        slotCode: DEFAULT_SLOT_CODE,
        address: EMPTY_ADDRESS,
        selectedMealIds: [],
        termsAcknowledged: false,
    };
}

/* ── validation ──────────────────────────────────────────────────────────────────────────────── */

export interface StepContext {
    readonly plan: SubscriptionPlan;
    /** `null` while the allowed set is still being determined; weekday rules are not enforced yet. */
    readonly allowedWeekdays: readonly number[] | null;
    readonly areaStatus: DeliveryAreaStatus;
    /**
     * Whether a saved address-book entry is selected — the only way the address requirement is met.
     *
     * There used to be a second way: with nothing saved, the step drew an inline address form and
     * accepted it once every field was filled in. Nothing ever saved that address, and
     * `createSubscription` takes only a saved address's identifier (D-084: delivery resolves zone,
     * window and fee from the address book, the rule the checkout follows), so a new account passed
     * all three steps and was refused at Subscribe every time, with no way to add one (plans-02).
     * The step now offers "Add a delivery address", which saves one and comes back with it chosen.
     */
    readonly hasSavedAddress: boolean;
    /** Tomorrow, or later when the plan's change cut-off reaches past it (`earliestStartDate`). */
    readonly earliestStartDate: string;
    readonly translate: (key: string) => string;
}

/** Message keys, in the order they should be shown. Empty means the step may be left. */
export type StepIssues = readonly string[];

export function validateConfiguratorStep(
    step: ConfiguratorStep,
    state: ConfiguratorState,
    context: StepContext,
): StepIssues {
    switch (step) {
        case 'plan':
            return [
                ...(state.variantId === null ? ['commerce:configurator.issues.variant'] : []),
                ...(durationOption(context.plan, state.duration) === undefined
                    ? ['commerce:configurator.issues.duration']
                    : []),
            ];

        case 'delivery':
            return deliveryIssues(state, context);

        case 'review':
            return state.termsAcknowledged ? [] : ['commerce:configurator.issues.terms'];
    }
}

function deliveryIssues(state: ConfiguratorState, context: StepContext): StepIssues {
    const issues: string[] = [];
    const allowed = context.allowedWeekdays;

    if (state.startDate === null || !isIsoDate(state.startDate)) {
        issues.push('commerce:configurator.issues.startDate');
    } else {
        if (state.startDate < context.earliestStartDate) {
            issues.push('commerce:configurator.issues.startTooSoon');
        }
        // The first delivery is the start, so it has to fall on one of the chosen days — the
        // purchase refuses a start it would otherwise have to move.
        const weekday = isoWeekday(state.startDate);
        const days = state.deliveryWeekdays.length > 0 ? state.deliveryWeekdays : allowed;
        if (days !== null && weekday !== null && !days.includes(weekday)) {
            issues.push('commerce:configurator.issues.startWeekday');
        }
    }

    if (state.deliveryWeekdays.length === 0) {
        issues.push('commerce:configurator.issues.noDeliveryDays');
    } else if (allowed !== null && state.deliveryWeekdays.some((day) => !allowed.includes(day))) {
        issues.push('commerce:configurator.issues.deliveryDayUnavailable');
    }

    if (!isDeliverySlotCode(state.slotCode)) issues.push('commerce:configurator.issues.slot');

    if (!context.hasSavedAddress) issues.push('commerce:configurator.issues.address');

    // SUB-02's delivery check. `unserved` is a hard stop: there is no acknowledgement that makes a
    // kitchen deliver somewhere it does not deliver, and offering one would sell an unfulfillable
    // subscription — the exact outcome doc 11 §3 warns about.
    if (context.areaStatus === 'unserved') issues.push('commerce:configurator.issues.areaUnserved');

    return issues;
}

/** Whether every step up to and including `step` is satisfied — the deep-link guard. */
export function isStepReachable(
    step: ConfiguratorStep,
    state: ConfiguratorState,
    context: StepContext,
): boolean {
    return CONFIGURATOR_STEPS.slice(0, CONFIGURATOR_STEPS.indexOf(step)).every(
        (earlier) => validateConfiguratorStep(earlier, state, context).length === 0,
    );
}

/** The first step that is not yet satisfied, or `null` when the whole flow is complete. */
export function firstIncompleteStep(
    state: ConfiguratorState,
    context: StepContext,
): ConfiguratorStep | null {
    return (
        CONFIGURATOR_STEPS.find(
            (step) => validateConfiguratorStep(step, state, context).length > 0,
        ) ?? null
    );
}

/* ── the request ─────────────────────────────────────────────────────────────────────────────── */

/**
 * A saved address in the form shape the configuration is built from.
 *
 * The address book carries no city or country — the area it names is a gazetteer entry the server
 * resolves — so both are left empty, exactly as the subscription's own address change sends them.
 * The identifier travels beside the configuration as `addressId`; this is only what the review and
 * the preview describe.
 */
export function savedAddressValues(entry: CustomerAddress): AddressValues {
    return {
        label: entry.label,
        line1: entry.line1,
        line2: entry.line2 ?? '',
        area: entry.areaName,
        city: '',
        countryCode: '',
        instructions: entry.notes ?? '',
    };
}

/**
 * The configuration a preview or a creation is made from.
 *
 * `null` until it is genuinely complete. Sending a half-built configuration would produce a priced
 * answer for something nobody chose, and `previewSubscription` would answer it rather than reject
 * it — a preview is a query over a proposal, and a proposal with no delivery days is still a
 * proposal.
 */
export function toConfiguration(
    state: ConfiguratorState,
    plan: SubscriptionPlan,
    toAddress: (values: AddressValues) => SubscriptionConfiguration['address'],
): SubscriptionConfiguration | null {
    if (state.variantId === null || state.duration === null) return null;
    if (state.startDate === null || !isIsoDate(state.startDate)) return null;
    if (state.deliveryWeekdays.length === 0) return null;

    return {
        planId: plan.id,
        variantId: state.variantId,
        duration: state.duration,
        startDate: state.startDate,
        deliveryWeekdays: [...state.deliveryWeekdays].sort((left, right) => left - right),
        slotCode: state.slotCode,
        address: toAddress(state.address),
        selectedMealIds: [...state.selectedMealIds],
    };
}

/**
 * The delivery days the current configuration produces, for the summary and the first-week meals.
 *
 * Derived from the same rule the repository applies, so the sample week a person chooses meals for
 * is the week they will actually receive. Empty until the plan offers the chosen length.
 */
export function configuredDeliveryDates(
    state: ConfiguratorState,
    plan: SubscriptionPlan,
): readonly string[] {
    const option = durationOption(plan, state.duration);
    if (state.startDate === null || option === undefined) return [];
    return deliveryDatesFor(state.startDate, state.deliveryWeekdays, option.days);
}

/** How many delivery days the first-week picker covers: one week, the rotation the kitchen publishes. */
export const FIRST_WEEK_DAYS = 7;

/**
 * The meal slot a first-week pick is sent under.
 *
 * The picker offers one dish per day, and the public plan does not publish its menu's slots. Lunch
 * is the sitting every meals-per-day count includes, so a pick there takes the place of the
 * kitchen's lunch rather than arriving beside it; a snacks-only band has no lunch to replace.
 */
export function firstWeekChoiceSlot(variant: PlanVariant | null): string {
    return variant !== null && variant.mealsPerDay === 0 && variant.snacksPerDay > 0
        ? 'snack'
        : 'lunch';
}

/**
 * One `PUT …/choices` per day the person picked a dish for in the first week.
 *
 * Nothing when they never opened the picker: the plan's own rotation is what they agreed to, and
 * sending its defaults back as choices would pin the kitchen's menu as though the person chose it.
 */
export function firstWeekChoices(
    state: ConfiguratorState,
    plan: SubscriptionPlan,
    variant: PlanVariant | null,
): readonly SetSubscriptionMealChoicesRequest[] {
    if (state.selectedMealIds.length === 0) return [];
    const slot = firstWeekChoiceSlot(variant);
    return configuredDeliveryDates(state, plan)
        .slice(0, FIRST_WEEK_DAYS)
        .flatMap((date, index) => {
            const mealId = state.selectedMealIds[index];
            return mealId === undefined ? [] : [{ date, choices: [{ slot, mealId }] }];
        });
}
