/**
 * Closed unions for the nutrition, meal-planning and commerce prototype (Prompt 2).
 *
 * Same discipline as `enums.ts`: every union is a `const` tuple first, so runtime code can iterate
 * it (guards, select options, table-driven tests) and the type is derived from that single source.
 *
 * These are *our* vocabularies. None of them is copied from a reference product; where a value
 * mirrors a published public standard (dietary classifications, activity multipliers) that is
 * because the standard is the vocabulary, not because a competitor's schema was inspected.
 */

/**
 * Local copy of the `memberOf` helper in `enums.ts`. Duplicated on purpose — exporting it from
 * there would widen that module's public surface for the sake of four lines.
 */
function memberOf<T extends readonly string[]>(values: T) {
    const set: ReadonlySet<string> = new Set<string>(values);
    return (value: unknown): value is T[number] => typeof value === 'string' && set.has(value);
}

/** Where a meal sits in the day. Snacks are a single type; ordering is handled by meal *times*. */
export const MEAL_TYPES = ['breakfast', 'lunch', 'dinner', 'snack'] as const;
export type MealType = (typeof MEAL_TYPES)[number];

/**
 * How a person describes the pattern of what they eat. A classification is a *preference filter*,
 * never a medical restriction — those are modelled by `RESTRICTION_KINDS` and carry a severity.
 */
export const DIET_CLASSIFICATIONS = [
    'omnivore',
    'vegetarian',
    'vegan',
    'pescatarian',
    'keto',
    'low_carb',
    'high_protein',
    'mediterranean',
    'halal_friendly',
    'gluten_free',
    'dairy_free',
    'nut_free',
] as const;
export type DietClassification = (typeof DIET_CLASSIFICATIONS)[number];

/** The five habitual-activity bands the published total-energy multipliers are defined over. */
export const ACTIVITY_LEVELS = [
    'sedentary',
    'lightly_active',
    'moderately_active',
    'very_active',
    'extra_active',
] as const;
export type ActivityLevel = (typeof ACTIVITY_LEVELS)[number];

export const HEALTH_GOALS = ['lose_weight', 'maintain', 'gain_muscle', 'recomposition'] as const;
export type HealthGoal = (typeof HEALTH_GOALS)[number];

/** How aggressively the goal is pursued. Bounded by published safe-rate guidance, not by ambition. */
export const TARGET_PACES = ['gentle', 'standard', 'ambitious'] as const;
export type TargetPace = (typeof TARGET_PACES)[number];

export const MEASUREMENT_SYSTEMS = ['metric', 'imperial'] as const;
export type MeasurementSystem = (typeof MEASUREMENT_SYSTEMS)[number];

/**
 * Which published equation produced a nutrition target. `professional_override` is not an equation:
 * it records that a qualified dietitian replaced the computed figure with their own.
 */
export const NUTRITION_CALCULATION_METHODS = [
    'mifflin_st_jeor',
    'katch_mcardle',
    'professional_override',
] as const;
export type NutritionCalculationMethod = (typeof NUTRITION_CALCULATION_METHODS)[number];

/**
 * Why an ingredient, meal or plan is excluded for a person.
 *
 * These are deliberately **not** collapsed into one "restriction" bucket. A dislike may be
 * overridden by the person; an allergy may not be overridden by anybody; a dietitian-enforced
 * restriction may only be lifted by the dietitian who set it. Losing that distinction is a safety
 * defect, so the vocabulary keeps all seven separate and the UI labels each one differently.
 */
export const RESTRICTION_KINDS = [
    'preference',
    'self_declared_medical',
    'dietitian_enforced',
    'allergy',
    'intolerance',
    'dislike',
    'religious',
] as const;
export type RestrictionKind = (typeof RESTRICTION_KINDS)[number];

/** Restriction kinds a person may not silently override in the planner. */
const SAFETY_CRITICAL_RESTRICTIONS: ReadonlySet<RestrictionKind> = new Set<RestrictionKind>([
    'allergy',
    'dietitian_enforced',
    'self_declared_medical',
]);

/**
 * True when a restriction must block a suggestion outright rather than merely down-rank it.
 * Intolerances and religious restrictions are honoured as hard filters too, but the product allows
 * an explicit, recorded user confirmation for those; the three below allow none.
 */
export function isSafetyCriticalRestriction(kind: RestrictionKind): boolean {
    return SAFETY_CRITICAL_RESTRICTIONS.has(kind);
}

/** The channels a kitchen may be configured to sell through (prompt: B2C and B2B presentation). */
export const SALES_CHANNELS = [
    'b2c',
    'b2b',
    'marketplace',
    'pos',
    'subscription',
    'delivery',
    'pickup',
    'corporate',
] as const;
export type SalesChannel = (typeof SALES_CHANNELS)[number];

/** Channels whose prices are contract-private and must never reach a consumer screen. */
const PRIVATE_PRICE_CHANNELS: ReadonlySet<SalesChannel> = new Set<SalesChannel>([
    'b2b',
    'corporate',
]);

export function hasPrivatePricing(channel: SalesChannel): boolean {
    return PRIVATE_PRICE_CHANNELS.has(channel);
}

export const SUBSCRIPTION_STATES = [
    'draft',
    'active',
    'paused',
    'skipped_today',
    'cancelled',
    'expired',
] as const;
export type SubscriptionState = (typeof SUBSCRIPTION_STATES)[number];

/** States in which a subscription is still billable and still produces deliveries. */
export function isLiveSubscriptionState(state: SubscriptionState): boolean {
    return state === 'active' || state === 'skipped_today';
}

/**
 * A plan's run length, named by the delivery days it buys: `'5d'`, `'7d'`, `'28d'`.
 *
 * A kitchen configures any whole number of days (`plan_durations.duration_days`), and the
 * storefront quotes and buys a run by that count, so the vocabulary is open. It used to be the
 * closed set `1w | 2w | 4w | 12w`, which dropped every run that was not a multiple of seven days
 * before it reached a screen — a five-day plan had no length to choose and could not be bought.
 */
export type PlanDuration = `${number}d`;

const PLAN_DURATION_PATTERN = /^[1-9]\d*d$/;

export function isPlanDuration(value: unknown): value is PlanDuration {
    return typeof value === 'string' && PLAN_DURATION_PATTERN.test(value);
}

/** The duration that buys `days` delivery days. `days` must be a positive whole number. */
export function planDuration(days: number): PlanDuration {
    if (!Number.isInteger(days) || days < 1) {
        throw new RangeError(
            `A plan duration needs a positive whole number of days, got ${String(days)}.`,
        );
    }
    return `${days}d`;
}

/** How many delivery days a duration buys. */
export function planDurationDays(duration: PlanDuration): number {
    return Number.parseInt(duration.slice(0, -1), 10);
}

/**
 * The lengths the marketing copy and the fixtures reach for. A kitchen may offer any other; this is
 * a convenience for seeded worlds and tests, not a limit a screen enforces.
 */
export const PLAN_DURATIONS: readonly PlanDuration[] = ['7d', '14d', '28d', '84d'];

/**
 * Every state the Virtual Dietitian journey can be observed in.
 *
 * Twelve, not eleven: the prompt's UI-state list enumerates twelve, and the terminal safety state
 * is one of them. They are exhaustive on purpose — each has a designed screen, and a state with no
 * screen is how a prototype ends up with a dead end.
 */
export const VD_SESSION_STATES = [
    'initial_interview',
    'analysing',
    'missing_information',
    'suggested_targets',
    'suggested_meal_structure',
    'draft_generated',
    'review_requested',
    'professionally_approved',
    'generation_failed',
    'restriction_conflict',
    'no_suitable_meals',
    'safety_escalation',
] as const;
export type VdSessionState = (typeof VD_SESSION_STATES)[number];

/** States that represent a failed or blocked outcome rather than progress through the interview. */
const VD_UNHAPPY_STATES: ReadonlySet<VdSessionState> = new Set<VdSessionState>([
    'generation_failed',
    'restriction_conflict',
    'no_suitable_meals',
    'safety_escalation',
]);

export function isVdUnhappyState(state: VdSessionState): boolean {
    return VD_UNHAPPY_STATES.has(state);
}

export const isMealType = memberOf(MEAL_TYPES);
export const isDietClassification = memberOf(DIET_CLASSIFICATIONS);
export const isActivityLevel = memberOf(ACTIVITY_LEVELS);
export const isHealthGoal = memberOf(HEALTH_GOALS);
export const isTargetPace = memberOf(TARGET_PACES);
export const isMeasurementSystem = memberOf(MEASUREMENT_SYSTEMS);
export const isNutritionCalculationMethod = memberOf(NUTRITION_CALCULATION_METHODS);
export const isRestrictionKind = memberOf(RESTRICTION_KINDS);
export const isSalesChannel = memberOf(SALES_CHANNELS);
export const isSubscriptionState = memberOf(SUBSCRIPTION_STATES);
export const isVdSessionState = memberOf(VD_SESSION_STATES);
