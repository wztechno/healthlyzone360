import type {
    CustomerAddress,
    PlanVariant,
    SetSubscriptionMealChoicesRequest,
    SubscriptionConfiguration,
    SubscriptionPlan,
} from '@healthy360/api-client/contracts';
import { AllergenCode, PLAN_DURATION_WEEKS } from '@healthy360/domain-types';
import type {
    DietClassification,
    MealId,
    Money,
    PlanDuration,
    PlanVariantId,
} from '@healthy360/domain-types';
import type { NutritionConstraint } from '@healthy360/nutrition';

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
 * meals, length), `delivery` (days, start, window, address, diet and allergies) and `review` (the
 * server's price, optional first-week meals, the terms).
 *
 * Doc 17, `SUB-02`'s two dispositive questions — does the kitchen deliver here, and what must be
 * left out — are still settled before anything is created: both live in `delivery`, an unserved
 * area is a hard stop, and dropping an allergy the profile records has to be acknowledged. What
 * changed is the price: it is shown from the first step, estimated on the client, and replaced by
 * the server's own figures on `review`. Hiding it until step seven of eight cost more than it
 * protected.
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

/**
 * The discounted total for a duration, in integer minor units.
 *
 * The same arithmetic the repository performs, deliberately duplicated so the summary can show a
 * total from the first step without a round trip per choice — and so a divergence between the two
 * is a failing test rather than a number that quietly disagrees with the invoice. `previewSubscription`
 * remains the authority; `review` shows *its* figures, not these.
 */
export function discountedTotalMinorUnits(
    weeklyMinorUnits: number,
    weeks: number,
    discountPercent: number,
): number {
    const gross = weeklyMinorUnits * weeks;
    return Math.round((gross * (100 - discountPercent)) / 100);
}

export function grossMinorUnits(weeklyMinorUnits: number, weeks: number): number {
    return weeklyMinorUnits * weeks;
}

/** What the duration discount is worth, in minor units. Zero when the duration earns none. */
export function savingMinorUnits(
    weeklyMinorUnits: number,
    weeks: number,
    discountPercent: number,
): number {
    return (
        grossMinorUnits(weeklyMinorUnits, weeks) -
        discountedTotalMinorUnits(weeklyMinorUnits, weeks, discountPercent)
    );
}

export function weeksFor(duration: PlanDuration): number {
    return PLAN_DURATION_WEEKS[duration];
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

/* ── dietary preferences and the allergy change ──────────────────────────────────────────────── */

/** The allergen codes a person's stored constraints already exclude. */
export function storedAllergenCodes(
    constraints: readonly NutritionConstraint[] | undefined,
): readonly AllergenCode[] {
    const codes = (constraints ?? [])
        .filter((constraint) => constraint.kind === 'allergy')
        .map((constraint) => AllergenCode.safeParse(constraint.code))
        .filter((code): code is AllergenCode => code !== null);
    return [...new Set(codes)];
}

/** The diet classifications a person's stored preferences already record. */
export function storedDietClassifications(
    constraints: readonly NutritionConstraint[] | undefined,
    available: readonly DietClassification[],
): readonly DietClassification[] {
    const preferred = new Set(
        (constraints ?? [])
            .filter((constraint) => constraint.kind === 'preference')
            .map((constraint) => constraint.code),
    );
    return available.filter((diet) => preferred.has(diet));
}

export interface AllergenChange {
    /** Newly excluded here — a tightening, and safe. */
    readonly added: readonly AllergenCode[];
    /** Excluded in the stored profile but **not** in this subscription — a relaxation, and not safe. */
    readonly removed: readonly AllergenCode[];
    readonly changed: boolean;
    /** True when at least one stored allergy has been dropped. Drives the safety callout. */
    readonly relaxed: boolean;
}

/**
 * How this subscription's allergen exclusions differ from the person's stored profile.
 *
 * The asymmetry is the point. Adding an exclusion narrows what a kitchen may send and needs no
 * ceremony. **Removing** one widens it — the person is telling the product to stop filtering for
 * something they previously recorded as an allergy — and that is a safety decision, so it raises a
 * warning and has to be acknowledged before the flow continues.
 */
export function diffAllergens(
    stored: readonly AllergenCode[],
    chosen: readonly AllergenCode[],
): AllergenChange {
    const storedSet = new Set<string>(stored);
    const chosenSet = new Set<string>(chosen);
    const added = chosen.filter((code) => !storedSet.has(code));
    const removed = stored.filter((code) => !chosenSet.has(code));
    return {
        added,
        removed,
        changed: added.length > 0 || removed.length > 0,
        relaxed: removed.length > 0,
    };
}

/* ── the state ───────────────────────────────────────────────────────────────────────────────── */

export interface ConfiguratorState {
    readonly variantId: PlanVariantId | null;
    readonly duration: PlanDuration;
    readonly startDate: string | null;
    readonly deliveryWeekdays: readonly number[];
    readonly slotCode: string;
    /**
     * The saved address the delivery step chose, in form shape ({@link savedAddressValues}), so the
     * configuration and the review read it like any other choice. Never typed in: placement takes
     * a saved address's identifier and nothing else (D-084).
     */
    readonly address: AddressValues;
    readonly dietClassifications: readonly DietClassification[];
    readonly excludeAllergens: readonly AllergenCode[];
    readonly selectedMealIds: readonly MealId[];
    /**
     * Ticked by a person who drops an allergy their profile records. Only asked — and only
     * required — when that has happened.
     */
    readonly checksAcknowledged: boolean;
    /** The terms summary on the confirm step. `createSubscription` rejects without it. */
    readonly termsAcknowledged: boolean;
    /** Set once the person edits the allergen set, so a no-op visit does not raise the callout. */
    readonly allergensTouched: boolean;
}

export interface InitialStateOptions {
    readonly plan: SubscriptionPlan;
    readonly variantId?: PlanVariantId | null | undefined;
    readonly startDate: string;
    readonly allowedWeekdays?: readonly number[] | undefined;
    readonly storedAllergens?: readonly AllergenCode[] | undefined;
    readonly storedDiets?: readonly DietClassification[] | undefined;
}

/**
 * The state a freshly opened configurator starts in.
 *
 * Pre-filled from the person's stored restrictions rather than blank. A subscription form that asks
 * somebody with a recorded peanut allergy to remember to declare it again is a form that will
 * eventually be filled in wrongly by somebody tired.
 */
export function initialConfiguratorState(options: InitialStateOptions): ConfiguratorState {
    const variant =
        variantById(options.plan, options.variantId ?? null) ?? defaultVariant(options.plan);
    const allowed = options.allowedWeekdays ?? [];
    return {
        variantId: variant?.id ?? null,
        duration: options.plan.durations[0]?.duration ?? '4w',
        startDate: options.startDate,
        deliveryWeekdays: [...allowed],
        slotCode: DEFAULT_SLOT_CODE,
        address: EMPTY_ADDRESS,
        dietClassifications: [...(options.storedDiets ?? [])],
        excludeAllergens: [...(options.storedAllergens ?? [])],
        selectedMealIds: [],
        checksAcknowledged: false,
        termsAcknowledged: false,
        allergensTouched: false,
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
    readonly earliestStartDate: string;
    /** The allergies the profile records; dropping one must be acknowledged. */
    readonly storedAllergens: readonly AllergenCode[];
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
                ...(context.plan.durations.some((option) => option.duration === state.duration)
                    ? []
                    : ['commerce:configurator.issues.duration']),
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
        const weekday = isoWeekday(state.startDate);
        if (allowed !== null && weekday !== null && !allowed.includes(weekday)) {
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

    // The two SUB-02 checks. `unserved` is a hard stop: there is no acknowledgement that makes a
    // kitchen deliver somewhere it does not deliver, and offering one would sell an unfulfillable
    // subscription — the exact outcome doc 11 §3 warns about. A dropped allergy is allowed, but
    // only once somebody has said they meant it.
    if (context.areaStatus === 'unserved') issues.push('commerce:configurator.issues.areaUnserved');
    if (
        diffAllergens(context.storedAllergens, state.excludeAllergens).relaxed &&
        !state.checksAcknowledged
    ) {
        issues.push('commerce:configurator.issues.checks');
    }

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
    if (state.variantId === null) return null;
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
        dietClassifications: [...state.dietClassifications],
        excludeAllergens: [...state.excludeAllergens],
        selectedMealIds: [...state.selectedMealIds],
    };
}

/**
 * The delivery days the current configuration produces, for the summary and the first-week meals.
 *
 * Derived from the same rule the repository applies, so the sample week a person chooses meals for
 * is the week they will actually receive.
 */
export function configuredDeliveryDates(state: ConfiguratorState): readonly string[] {
    if (state.startDate === null) return [];
    return deliveryDatesFor(state.startDate, state.deliveryWeekdays, weeksFor(state.duration));
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
    variant: PlanVariant | null,
): readonly SetSubscriptionMealChoicesRequest[] {
    if (state.selectedMealIds.length === 0) return [];
    const slot = firstWeekChoiceSlot(variant);
    return configuredDeliveryDates(state)
        .slice(0, FIRST_WEEK_DAYS)
        .flatMap((date, index) => {
            const mealId = state.selectedMealIds[index];
            return mealId === undefined ? [] : [{ date, choices: [{ slot, mealId }] }];
        });
}
