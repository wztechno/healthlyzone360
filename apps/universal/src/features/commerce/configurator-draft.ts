import { PLAN_DURATIONS } from '@healthy360/domain-types';
import type {
    AllergenCode,
    DietClassification,
    MealId,
    PlanDuration,
} from '@healthy360/domain-types';

import { withQuery } from '../../navigation/return-to.ts';
import { createSessionDraftStore } from '../../navigation/session-draft.ts';
import { isConfiguratorStep } from './configurator.ts';
import type { ConfiguratorState, ConfiguratorStep } from './configurator.ts';

/**
 * Where a plan set-up is, and what has been chosen in it — kept outside the screen.
 *
 * `/customer/subscriptions/new` is one of the siblings in the customer area's `<Slot/>`, so every
 * detour — adding a delivery address, confirming a phone number, answering the dietary questions —
 * unmounts it, and so does Back, a refresh or a crumb. It used to hold its step and every choice in
 * `useState`, so each of those restarted it on step one with the terms box unticked (plans-03). The
 * state is now split by what it is:
 *
 * - **In the URL**: the plan, the calorie band (`variant`), the step and the saved address chosen
 *   (`address`). They are short, opaque and not personal, and they are what a detour's `returnTo`
 *   has to carry — the address editor comes back with `?address=<new id>` patched in, and the step
 *   is what makes Back walk Review → Delivery → Plan.
 * - **In a session draft** ({@link configuratorDrafts}): everything else the person changed — the
 *   length, the days, the start, the window, diet and allergies, the first week's meals. That is
 *   too many fields for a URL and some of it (what somebody cannot eat) does not belong in one. It
 *   is keyed by plan, survives a refresh and a detour in this tab, expires after two hours and is
 *   cleared once the subscription exists, by "Start over", and on sign-out.
 * - **Nowhere**: the terms tick. It acknowledges the summary as it reads at that moment, and a person
 *   who left to change their address has a different summary to acknowledge when they come back.
 */

export const CONFIGURATOR_PATH = '/customer/subscriptions/new';

/** Two hours: an unfinished set-up older than an afternoon is not one the person still holds. */
export const CONFIGURATOR_DRAFT_MAX_AGE_MS = 2 * 60 * 60 * 1000;

export interface ConfiguratorLocation {
    readonly plan?: string | undefined;
    readonly variant?: string | undefined;
    /** Absent on the first step, so the plain link from a plan page is the first step's URL. */
    readonly step?: ConfiguratorStep | undefined;
    /** The saved address chosen on the delivery step. */
    readonly address?: string | undefined;
}

type Params = Readonly<Record<string, unknown>>;

function single(value: unknown): string | undefined {
    const first = Array.isArray(value) ? (value[0] as unknown) : value;
    return typeof first === 'string' && first !== '' ? first : undefined;
}

/** A step from a query value, or `undefined` for anything that is not one. */
export function configuratorStepOf(value: unknown): ConfiguratorStep | undefined {
    const raw = single(value);
    return raw !== undefined && isConfiguratorStep(raw) ? raw : undefined;
}

export function readConfiguratorLocation(params: Params): ConfiguratorLocation {
    return {
        plan: single(params['plan']),
        variant: single(params['variant']),
        step: configuratorStepOf(params['step']),
        address: single(params['address']),
    };
}

/** `/customer/subscriptions/new` at a location; the first step and empty values are left out. */
export function configuratorHref(location: ConfiguratorLocation): string {
    return withQuery(CONFIGURATOR_PATH, {
        plan: location.plan,
        variant: location.variant,
        step: location.step === 'plan' ? undefined : location.step,
        address: location.address,
    });
}

/**
 * What a draft keeps: the person's own changes to the derived defaults, minus what lives elsewhere —
 * the band and the address in the URL, the terms tick nowhere.
 */
export type ConfiguratorEdits = Partial<
    Pick<
        ConfiguratorState,
        | 'duration'
        | 'startDate'
        | 'deliveryWeekdays'
        | 'slotCode'
        | 'dietClassifications'
        | 'excludeAllergens'
        | 'selectedMealIds'
        | 'checksAcknowledged'
        | 'allergensTouched'
    >
>;

const EDIT_KEYS = [
    'duration',
    'startDate',
    'deliveryWeekdays',
    'slotCode',
    'dietClassifications',
    'excludeAllergens',
    'selectedMealIds',
    'checksAcknowledged',
    'allergensTouched',
] as const satisfies readonly (keyof ConfiguratorEdits)[];

/** The part of a step's change that belongs in the draft; the band, address and terms go elsewhere. */
export function editsOf(patch: Partial<ConfiguratorState>): ConfiguratorEdits {
    const edits: Record<string, unknown> = {};
    for (const key of EDIT_KEYS) {
        if (patch[key] !== undefined) edits[key] = patch[key];
    }
    return edits as ConfiguratorEdits;
}

function stringList(value: unknown): string[] | null {
    return Array.isArray(value) && value.every((entry) => typeof entry === 'string')
        ? [...(value as string[])]
        : null;
}

/**
 * A stored draft, field by field. Anything malformed is dropped rather than trusted — the screen
 * validates what survives against the plan as it is now, so a band or a day the kitchen has since
 * withdrawn is refused there, not here.
 */
export function parseConfiguratorEdits(raw: unknown): ConfiguratorEdits | null {
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return null;
    const value = raw as Readonly<Record<string, unknown>>;
    const edits: {
        -readonly [K in keyof ConfiguratorEdits]: ConfiguratorEdits[K];
    } = {};

    const duration = value['duration'];
    if (
        typeof duration === 'string' &&
        (PLAN_DURATIONS as readonly string[]).includes(duration)
    ) {
        edits.duration = duration as PlanDuration;
    }
    if (typeof value['startDate'] === 'string') edits.startDate = value['startDate'];
    const weekdays = value['deliveryWeekdays'];
    if (
        Array.isArray(weekdays) &&
        weekdays.every((day) => Number.isInteger(day) && day >= 1 && day <= 7)
    ) {
        edits.deliveryWeekdays = [...(weekdays as number[])];
    }
    if (typeof value['slotCode'] === 'string') edits.slotCode = value['slotCode'];
    const diets = stringList(value['dietClassifications']);
    if (diets !== null) edits.dietClassifications = diets as DietClassification[];
    const allergens = stringList(value['excludeAllergens']);
    if (allergens !== null) edits.excludeAllergens = allergens as AllergenCode[];
    const meals = stringList(value['selectedMealIds']);
    if (meals !== null) edits.selectedMealIds = meals as MealId[];
    if (typeof value['checksAcknowledged'] === 'boolean') {
        edits.checksAcknowledged = value['checksAcknowledged'];
    }
    if (typeof value['allergensTouched'] === 'boolean') {
        edits.allergensTouched = value['allergensTouched'];
    }
    return edits;
}

/** One draft per plan, so setting up two plans in one tab never mixes their choices. */
export function configuratorDraftKey(planId: string): string {
    return `plan:${planId}`;
}

export const configuratorDrafts = createSessionDraftStore<ConfiguratorEdits>({
    namespace: 'configurator',
    maxAgeMs: CONFIGURATOR_DRAFT_MAX_AGE_MS,
    parse: parseConfiguratorEdits,
});
