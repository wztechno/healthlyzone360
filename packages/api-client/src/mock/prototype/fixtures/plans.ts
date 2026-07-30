import { PLAN_DURATION_WEEKS, PLAN_DURATIONS } from '@healthy360/domain-types';
import type {
    DietClassification,
    MealId,
    Money,
    PlanDuration,
    SubscriptionPlanId,
} from '@healthy360/domain-types';

import type {
    PlanDurationOption,
    PlanVariant,
    SubscriptionPlan,
} from '../../../contracts/marketplace.ts';
import { aed, atOrThrow, fromMapOrThrow } from '../constants.ts';
import { planVariantIdAt, subscriptionPlanIdAt } from '../ids.ts';
import { kitchenByKey } from './kitchens.ts';
import { mealsForKitchen } from './meals.ts';

/**
 * Eight subscription plans, their variants and their duration pricing.
 *
 * Three things here are derived rather than typed, because typing them is how a catalogue acquires
 * a plan whose macros do not add up to its calories:
 *
 * - **Macro ranges** come from the variant's energy band and the plan's macro profile, converted at
 *   the Atwater factors. A 1,600–1,900 kcal band at a 30 % protein share *is* 120–143 g of protein.
 * - **Duration prices** come from the weekly price, the number of weeks and the duration discount.
 * - **Sample menus** are drawn from the meals the owning kitchen actually sells.
 *
 * Delivery-day constraints live in {@link PLAN_DELIVERY_WEEKDAYS} rather than on `SubscriptionPlan`:
 * the consumer contract has no field for them, and inventing one would put a scheduling rule in a
 * catalogue shape where nobody would look for it.
 */

/** Whole percent off the weekly price. Longer commitments earn more; a week earns nothing. */
export const DURATION_DISCOUNT_PERCENT: Readonly<Record<PlanDuration, number>> = {
    '1w': 0,
    '2w': 5,
    '4w': 10,
    '12w': 15,
};

interface MacroProfile {
    readonly protein: number;
    readonly carbohydrate: number;
    readonly fat: number;
}

type VariantRow = readonly [
    name: string,
    energyMin: number,
    energyMax: number,
    mealsPerDay: number,
    snacksPerDay: number,
    pricePerWeekFils: number,
];

type PlanRow = readonly [
    key: string,
    name: string,
    summary: string,
    description: string,
    kitchenKey: string,
    categorySlugs: readonly string[],
    diets: readonly DietClassification[],
    macros: MacroProfile,
    variants: readonly VariantRow[],
    /** ISO weekdays the plan can be delivered on. */
    deliveryWeekdays: readonly number[],
    rating: number | null,
    ratingCount: number,
];

const ROWS: readonly PlanRow[] = [
    [
        'balanced_week',
        'Balanced Week',
        'Three meals and a snack a day, portioned to a maintenance target.',
        'A general plan for somebody who wants the decisions taken away without a particular ' +
            'restriction. Meals rotate weekly and every day is built to land inside the energy band ' +
            'of the variant you choose.',
        'verdant',
        ['balanced', 'weight-management'],
        ['omnivore', 'mediterranean'],
        { protein: 0.28, carbohydrate: 0.42, fat: 0.3 },
        [
            ['Light', 1400, 1600, 3, 1, 42000],
            ['Standard', 1700, 1900, 3, 1, 47500],
            ['Generous', 2000, 2300, 3, 2, 54000],
        ],
        [1, 2, 3, 4, 5, 7],
        4.6,
        318,
    ],
    [
        'plant_forward',
        'Plant Forward',
        'Entirely plant-based, with the protein figure stated on every meal.',
        'A plant-based plan that does not treat protein as an afterthought: every day is built to a ' +
            'stated protein floor from pulses, tofu, tempeh and grains.',
        'verdant',
        ['plant-based', 'balanced'],
        ['vegan', 'vegetarian'],
        { protein: 0.24, carbohydrate: 0.48, fat: 0.28 },
        [
            ['Light', 1400, 1600, 3, 1, 39500],
            ['Standard', 1700, 1900, 3, 1, 44000],
            ['Generous', 2000, 2300, 3, 2, 50500],
        ],
        [1, 2, 3, 4, 5],
        4.5,
        204,
    ],
    [
        'coastal_light',
        'Coastal Light',
        'Fish-led days at a moderate deficit.',
        'Built around fish and shellfish, with a moderate energy deficit and a deliberately high ' +
            'vegetable weight per day.',
        'saffron',
        ['weight-management', 'pescatarian'],
        ['pescatarian', 'mediterranean'],
        { protein: 0.32, carbohydrate: 0.38, fat: 0.3 },
        [
            ['Light', 1300, 1500, 3, 1, 48000],
            ['Standard', 1600, 1800, 3, 1, 53500],
            ['Generous', 1900, 2100, 3, 2, 59000],
        ],
        [1, 3, 5],
        4.4,
        127,
    ],
    [
        'everyday_family_box',
        'Everyday Family Box',
        'Dinner for a household, five nights a week.',
        'Five dinners a week for two to four people, cooked the same day and delivered in the ' +
            'evening. No calorie band is imposed; portions scale with the household size.',
        'daily_pot',
        ['family', 'balanced'],
        ['omnivore', 'halal_friendly'],
        { protein: 0.26, carbohydrate: 0.46, fat: 0.28 },
        [
            ['Two people', 1600, 1900, 1, 0, 36000],
            ['Three people', 1600, 1900, 1, 0, 51000],
            ['Four people', 1600, 1900, 1, 0, 66000],
        ],
        [1, 2, 3, 4, 5],
        4.2,
        88,
    ],
    [
        'strength_build',
        'Strength Build',
        'A protein-led surplus for people lifting three or more times a week.',
        'A surplus plan with protein set per kilogram of body mass rather than as a share of ' +
            'energy, and two snacks a day to make the total reachable.',
        'riverstone',
        ['high-protein', 'muscle-gain'],
        ['high_protein', 'omnivore'],
        { protein: 0.34, carbohydrate: 0.41, fat: 0.25 },
        [
            ['Build 2400', 2300, 2500, 4, 2, 62000],
            ['Build 2800', 2700, 2900, 4, 2, 68500],
            ['Build 3200', 3100, 3300, 5, 2, 76000],
        ],
        [1, 2, 3, 4, 5, 6],
        4.7,
        241,
    ],
    [
        'lean_cut',
        'Lean Cut',
        'Lower carbohydrate, higher protein, at a controlled deficit.',
        'A deficit plan that holds protein high while carbohydrate comes down, for people who ' +
            'prefer that split. It is not a ketogenic plan and does not claim to be.',
        'riverstone',
        ['high-protein', 'weight-management', 'low-carb'],
        ['high_protein', 'low_carb'],
        { protein: 0.38, carbohydrate: 0.27, fat: 0.35 },
        [
            ['Cut 1500', 1400, 1600, 3, 1, 51000],
            ['Cut 1800', 1700, 1900, 3, 1, 56500],
            ['Cut 2100', 2000, 2200, 4, 1, 62000],
        ],
        [1, 2, 3, 4, 5],
        4.5,
        163,
    ],
    [
        'desk_lunch_club',
        'Desk Lunch Club',
        'One lunch a day, delivered to an office, on working days only.',
        'A single meal a day for the working week. Designed for offices: one delivery window, one ' +
            'address, and no weekend deliveries at all.',
        'verdant',
        ['office', 'balanced'],
        ['omnivore', 'vegetarian'],
        { protein: 0.3, carbohydrate: 0.42, fat: 0.28 },
        [
            ['Standard lunch', 550, 700, 1, 0, 17500],
            ['Larger lunch', 700, 900, 1, 0, 21000],
            ['Lunch and snack', 800, 1000, 1, 1, 24500],
        ],
        [1, 2, 3, 4, 5],
        4.3,
        142,
    ],
    [
        'mediterranean_reset',
        'Mediterranean Reset',
        'Four weeks of vegetable-heavy Mediterranean cooking.',
        'A four-week plan built on vegetables, pulses, olive oil and fish, with a fixed rotation so ' +
            'the shopping and the cooking stay predictable.',
        'saffron',
        ['mediterranean', 'balanced'],
        ['mediterranean', 'pescatarian'],
        { protein: 0.26, carbohydrate: 0.44, fat: 0.3 },
        [
            ['Reset 1600', 1500, 1700, 3, 1, 45000],
            ['Reset 1900', 1800, 2000, 3, 1, 50500],
            ['Reset 2200', 2100, 2300, 3, 2, 56000],
        ],
        [2, 4, 6],
        4.6,
        199,
    ],
];

/** Grams of a macronutrient for an energy figure at a given share, at the Atwater factors. */
function gramsFor(energy: number, share: number, kilocaloriesPerGram: number): number {
    return Math.round((energy * share) / kilocaloriesPerGram);
}

function rangeFor(
    energyMin: number,
    energyMax: number,
    share: number,
    kilocaloriesPerGram: number,
): { readonly min: number; readonly max: number } {
    return {
        min: gramsFor(energyMin, share, kilocaloriesPerGram),
        max: gramsFor(energyMax, share, kilocaloriesPerGram),
    };
}

export interface MakePlanVariantOverrides {
    readonly name?: string | undefined;
    readonly mealsPerDay?: number | undefined;
    readonly snacksPerDay?: number | undefined;
    readonly pricePerWeek?: Money | undefined;
}

export function makePlanVariant(
    row: VariantRow,
    planId: SubscriptionPlanId,
    macros: MacroProfile,
    ordinal: number,
    overrides: MakePlanVariantOverrides = {},
): PlanVariant {
    const [name, energyMin, energyMax, mealsPerDay, snacksPerDay, pricePerWeekFils] = row;
    return {
        id: planVariantIdAt(ordinal),
        planId,
        name: overrides.name ?? name,
        energyRange: { min: energyMin, max: energyMax },
        proteinRange: rangeFor(energyMin, energyMax, macros.protein, 4),
        carbohydrateRange: rangeFor(energyMin, energyMax, macros.carbohydrate, 4),
        fatRange: rangeFor(energyMin, energyMax, macros.fat, 9),
        mealsPerDay: overrides.mealsPerDay ?? mealsPerDay,
        snacksPerDay: overrides.snacksPerDay ?? snacksPerDay,
        pricePerWeek: overrides.pricePerWeek ?? aed(pricePerWeekFils),
    };
}

/** Duration options priced from a weekly figure. Discounts are whole percents off the total. */
export function makeDurationOptions(pricePerWeek: Money): readonly PlanDurationOption[] {
    return PLAN_DURATIONS.map((duration) => {
        const weeks = PLAN_DURATION_WEEKS[duration];
        const discountPercent = DURATION_DISCOUNT_PERCENT[duration];
        const gross = pricePerWeek.amount * weeks;
        return {
            duration,
            discountPercent,
            totalPrice: aed(Math.round((gross * (100 - discountPercent)) / 100)),
        };
    });
}

export interface MakeSubscriptionPlanOverrides {
    readonly name?: string | undefined;
    readonly variants?: readonly PlanVariant[] | undefined;
    readonly durations?: readonly PlanDurationOption[] | undefined;
    readonly sampleMealIds?: readonly MealId[] | undefined;
    readonly rating?: number | null | undefined;
    readonly ratingCount?: number | undefined;
}

export function makeSubscriptionPlan(
    row: PlanRow,
    ordinal: number,
    variantOrdinalBase: number,
    overrides: MakeSubscriptionPlanOverrides = {},
): SubscriptionPlan {
    const [
        key,
        name,
        summary,
        description,
        kitchenKey,
        categorySlugs,
        diets,
        macros,
        variantRows,
        ,
        rating,
        ratingCount,
    ] = row;

    const id = subscriptionPlanIdAt(ordinal);
    const kitchen = kitchenByKey(kitchenKey);
    const variants =
        overrides.variants ??
        variantRows.map((variantRow, index) =>
            makePlanVariant(variantRow, id, macros, variantOrdinalBase + index),
        );

    // The middle variant is the advertised one; a catalogue that prices from the cheapest variant
    // and then shows the standard one is the oldest trick in the book, and not one we are playing.
    const advertised = atOrThrow(variants, Math.floor(variants.length / 2), 'plan variant');
    const kitchenMeals = mealsForKitchen(kitchen.id);

    return {
        id,
        kitchenId: kitchen.id,
        name: overrides.name ?? name,
        slug: key.replace(/_/g, '-'),
        summary,
        description,
        categorySlugs,
        dietClassifications: diets,
        variants,
        durations: overrides.durations ?? makeDurationOptions(advertised.pricePerWeek),
        sampleMealIds: overrides.sampleMealIds ?? kitchenMeals.slice(0, 5).map((meal) => meal.id),
        imagePlaceholderId: `plan-${key.replace(/_/g, '-')}`,
        rating: overrides.rating === undefined ? rating : overrides.rating,
        ratingCount: overrides.ratingCount ?? ratingCount,
    };
}

export const PROTOTYPE_PLANS: readonly SubscriptionPlan[] = ROWS.map((row, index) =>
    makeSubscriptionPlan(row, index, index * 3),
);

/**
 * Delivery-day constraints, keyed by plan identifier.
 *
 * The office plan does not deliver at weekends; the coastal plan runs on alternate days because
 * that is when its supplier lands. A configuration that asks for a day outside this set is not
 * rejected — it is warned about, and the preview says so.
 */
export const PLAN_DELIVERY_WEEKDAYS: ReadonlyMap<string, readonly number[]> = new Map(
    ROWS.map((row, index) => [atOrThrow(PROTOTYPE_PLANS, index, 'plan').id, row[9]]),
);

const BY_KEY: ReadonlyMap<string, SubscriptionPlan> = new Map(
    ROWS.map((row, index) => [
        atOrThrow(row, 0, 'plan key') as string,
        atOrThrow(PROTOTYPE_PLANS, index, 'plan'),
    ]),
);

const BY_ID: ReadonlyMap<string, SubscriptionPlan> = new Map(
    PROTOTYPE_PLANS.map((plan) => [plan.id, plan]),
);

export function planByKey(key: string): SubscriptionPlan {
    return fromMapOrThrow(BY_KEY, key, 'subscription plan');
}

export function planById(id: SubscriptionPlanId): SubscriptionPlan | null {
    return BY_ID.get(id) ?? null;
}

export function planAt(index: number): SubscriptionPlan {
    return atOrThrow(PROTOTYPE_PLANS, index, 'subscription plan');
}

export const PROTOTYPE_PLAN_VARIANTS: readonly PlanVariant[] = PROTOTYPE_PLANS.flatMap(
    (plan) => plan.variants,
);

export function planVariantById(id: string): PlanVariant | null {
    return PROTOTYPE_PLAN_VARIANTS.find((variant) => variant.id === id) ?? null;
}

/** The weekdays a plan delivers on; every weekday when the plan declares none. */
export function deliveryWeekdaysFor(planId: SubscriptionPlanId): readonly number[] {
    return PLAN_DELIVERY_WEEKDAYS.get(planId) ?? [1, 2, 3, 4, 5, 6, 7];
}
