import { scaleFacts } from '@healthy360/nutrition';
import type { NutritionFacts, Serving } from '@healthy360/nutrition';
import type { KitchenId, MealId, MealType, Money } from '@healthy360/domain-types';

import type { MarketplaceMeal, MealAvailability } from '../../../contracts/marketplace.ts';
import type { Recipe } from '../../../contracts/foods.ts';
import {
    PROTOTYPE_AVAILABILITY_DAYS,
    PROTOTYPE_WEEK_START,
    addDays,
    aed,
    atOrThrow,
    fromMapOrThrow,
    instantAt,
    isoWeekday,
} from '../constants.ts';
import { mealIdAt } from '../ids.ts';
import { kitchenByKey } from './kitchens.ts';
import { makeServing } from './nutrients.ts';
import { recipeByKey, totalRecipeMinutes } from './recipes.ts';

/**
 * Forty marketplace meals — a kitchen's sellable product, built on a kitchen's version of a recipe.
 *
 * The prompt insists that an *ingredient*, a *recipe*, a *kitchen recipe version* and a *marketplace
 * meal* stay four different things, so a meal here is not a recipe with a price bolted on: it names
 * the recipe and the version its figures were computed from, scales them by the portion the kitchen
 * actually sells, and carries its own availability, rating and price.
 *
 * **Prices are derived, not typed.** Each price is the recipe's ingredient cost per serving,
 * multiplied by the kitchen's margin and rounded to the nearest half-dirham. That keeps a meal from
 * ever being priced below what it is made of — the sort of inconsistency a reviewer notices
 * immediately in a hand-typed fixture set.
 */

/** Gross margin multiplier applied to the ingredient cost per serving, by kitchen. */
const KITCHEN_PRICE_MULTIPLIER: Readonly<Record<string, number>> = {
    verdant: 2.6,
    saffron: 2.9,
    daily_pot: 2.3,
    riverstone: 2.8,
};

type MealRow = readonly [
    key: string,
    name: string,
    description: string,
    kitchenKey: string,
    recipeKey: string,
    /** Portion the kitchen sells, relative to one recipe serving. */
    portionFactor: number,
    rating: number | null,
    ratingCount: number,
    /** ISO weekdays the kitchen does not offer this meal. */
    unavailableWeekdays: readonly number[],
];

// One row per meal. Reflowed, forty meals become six hundred lines of single values.
// prettier-ignore
const ROWS: readonly MealRow[] = [
    ['verdant_herb_garden_bowl', 'Herb Garden Chicken Bowl', 'Grilled chicken, smoky freekeh and charred courgette, portioned to a protein figure.', 'verdant', 'herbed_chicken_freekeh', 1, 4.7, 214, []],
    ['riverstone_training_freekeh', 'Training Day Chicken and Freekeh', 'The same bowl at a larger portion, built for a heavier training day.', 'riverstone', 'herbed_chicken_freekeh', 1.35, 4.6, 121, [7]],
    ['saffron_tahini_salmon_tray', 'Tahini Salmon Tray', 'Salmon roasted with sweet potato and broccoli under a loosened tahini dressing.', 'saffron', 'lemon_tahini_salmon', 1, 4.8, 176, []],
    ['verdant_lemon_salmon_plate', 'Lemon Salmon Plate', 'A lighter plating of the salmon tray for a midweek dinner.', 'verdant', 'lemon_tahini_salmon', 0.85, 4.4, 88, [1]],
    ['verdant_pumpkin_lentil_pot', 'Pumpkin and Lentil Pot', 'A soft, slow-cooked lentil and pumpkin stew that reheats well.', 'verdant', 'spiced_lentil_pumpkin_stew', 1, 4.5, 132, []],
    ['daily_pot_house_lentil_stew', 'House Lentil Stew', 'The counter’s everyday lentil pot, ladled hot.', 'daily_pot', 'spiced_lentil_pumpkin_stew', 1.2, 4.1, 64, []],
    ['daily_pot_halloumi_plate', 'Griddled Halloumi Plate', 'Halloumi off the griddle with rocket, tomato and cucumber.', 'daily_pot', 'grilled_halloumi_rocket', 1, 4.3, 71, [7]],
    ['verdant_halloumi_garden_plate', 'Halloumi Garden Plate', 'A vegetable-heavier version of the halloumi plate.', 'verdant', 'grilled_halloumi_rocket', 1.1, 4.4, 59, []],
    ['daily_pot_braised_lamb', 'Braised Lamb and Bulgur', 'Lamb braised until it gives way, over bulgur cooked in the liquid.', 'daily_pot', 'slow_braised_lamb_bulgur', 1, 4.6, 143, [1, 2]],
    ['riverstone_lamb_recovery_plate', 'Recovery Lamb Plate', 'A larger braised lamb portion for the end of a heavy week.', 'riverstone', 'slow_braised_lamb_bulgur', 1.3, 4.5, 77, [1, 2]],
    ['verdant_aubergine_chickpea_bowl', 'Charred Aubergine Bowl', 'Blistered aubergine folded through chickpeas with tahini and lemon.', 'verdant', 'charred_aubergine_chickpea', 1, 4.5, 168, []],
    ['saffron_aubergine_mezze', 'Aubergine Mezze Bowl', 'A smaller mezze portion of the aubergine and chickpea salad.', 'saffron', 'charred_aubergine_chickpea', 0.7, 4.2, 46, []],
    ['verdant_morning_oats', 'Morning Oats Pot', 'Oats cooked in milk with dates and toasted almonds.', 'verdant', 'morning_oats_dates_almonds', 1, 4.6, 205, []],
    ['daily_pot_counter_oats', 'Counter Oats', 'The breakfast pot from the counter, made each morning.', 'daily_pot', 'morning_oats_dates_almonds', 0.9, 4, 52, [6, 7]],
    ['daily_pot_garden_omelette', 'Garden Omelette', 'A soft omelette folded around spinach, tomato and crumbled cheese.', 'daily_pot', 'garden_omelette_spinach', 1, 4.2, 63, []],
    ['verdant_spinach_omelette_box', 'Spinach Omelette Box', 'The omelette boxed cold, to be warmed at a desk.', 'verdant', 'garden_omelette_spinach', 1, 4.1, 39, [6, 7]],
    ['saffron_harbour_prawn_bowl', 'Harbour Prawn Bowl', 'Seared prawns over dressed quinoa with cucumber and red pepper.', 'saffron', 'harbour_prawn_quinoa', 1, 4.7, 154, []],
    ['riverstone_prawn_protein_bowl', 'Prawn Protein Bowl', 'A larger prawn and quinoa bowl for a higher protein target.', 'riverstone', 'harbour_prawn_quinoa', 1.3, 4.6, 92, []],
    ['verdant_tempeh_stir_fry', 'Tempeh Stir-Fry Bowl', 'Browned tempeh with broccoli and pepper over basmati.', 'verdant', 'tempeh_broccoli_stir_fry', 1, 4.4, 118, []],
    ['riverstone_tempeh_power_bowl', 'Tempeh Power Bowl', 'The tempeh bowl at a training portion.', 'riverstone', 'tempeh_broccoli_stir_fry', 1.35, 4.5, 84, [7]],
    ['daily_pot_labneh_breakfast', 'Labneh Breakfast Plate', 'Thick labneh, sourdough, cut vegetables and olive oil.', 'daily_pot', 'sunrise_labneh_sourdough', 1, 4.3, 96, []],
    ['verdant_sunrise_labneh_box', 'Sunrise Labneh Box', 'The labneh plate, boxed for collection before eight.', 'verdant', 'sunrise_labneh_sourdough', 0.9, 4.2, 44, [7]],
    ['verdant_cauliflower_wrap', 'Roast Cauliflower Wrap', 'Deeply roasted cauliflower rolled with tahini and rocket.', 'verdant', 'roasted_cauliflower_wrap', 1, 4.5, 187, []],
    ['daily_pot_cauliflower_roll', 'Cauliflower Roll', 'The counter’s cauliflower wrap, made to order.', 'daily_pot', 'roasted_cauliflower_wrap', 1.1, 4, 48, []],
    ['saffron_citrus_sea_bass', 'Citrus Sea Bass', 'Sea bass baked over orange with green beans and crushed potatoes.', 'saffron', 'citrus_sea_bass_green_beans', 1, 4.8, 139, [1]],
    ['riverstone_sea_bass_lean_plate', 'Lean Sea Bass Plate', 'A leaner plating of the sea bass, lighter on the potato.', 'riverstone', 'citrus_sea_bass_green_beans', 0.85, 4.5, 61, [1]],
    ['riverstone_turkey_hash', 'Turkey and Sweet Potato Hash', 'Turkey, sweet potato, pepper and onion cooked until caught.', 'riverstone', 'turkey_sweet_potato_hash', 1, 4.6, 173, []],
    ['daily_pot_weeknight_hash', 'Weeknight Hash', 'The hash from the counter, in a box.', 'daily_pot', 'turkey_sweet_potato_hash', 1.1, 4.1, 57, [7]],
    ['daily_pot_courgette_pasta', 'Courgette and Walnut Pasta', 'Courgette cooked down to a sauce with toasted walnuts.', 'daily_pot', 'courgette_walnut_pasta', 1, 4.2, 82, []],
    ['saffron_walnut_pasta_plate', 'Walnut Pasta Plate', 'A restrained plating of the courgette pasta.', 'saffron', 'courgette_walnut_pasta', 0.9, 4.3, 51, [7]],
    ['daily_pot_bean_chilli', 'Red Bean Chilli', 'A bean chilli built on roasted peppers rather than mince.', 'daily_pot', 'red_bean_pepper_chilli', 1, 4.4, 110, []],
    ['riverstone_chilli_batch_bowl', 'Batch Chilli Bowl', 'The chilli in a batch-cook portion for the week ahead.', 'riverstone', 'red_bean_pepper_chilli', 1.4, 4.3, 66, []],
    ['riverstone_mint_chicken_skewers', 'Mint Yoghurt Skewers', 'Thigh meat marinated in yoghurt, mint and garlic, grilled hard.', 'riverstone', 'mint_yoghurt_chicken_skewers', 1, 4.7, 198, []],
    ['daily_pot_grill_skewers', 'Grill Counter Skewers', 'Two skewers off the counter grill.', 'daily_pot', 'mint_yoghurt_chicken_skewers', 0.9, 4.2, 74, [1]],
    ['verdant_pistachio_yoghurt_pot', 'Pistachio Yoghurt Pot', 'Thick yoghurt with pomegranate, pistachio and honey.', 'verdant', 'pistachio_pomegranate_bowl', 1, 4.5, 231, []],
    ['saffron_pomegranate_pot', 'Pomegranate Pot', 'A smaller afternoon pot of the same.', 'saffron', 'pistachio_pomegranate_bowl', 0.7, 4.3, 68, []],
    ['riverstone_smoky_tofu_bowl', 'Smoky Tofu Grain Bowl', 'Roasted tofu with massaged kale, brown rice and mustard dressing.', 'riverstone', 'smoky_tofu_kale_bowl', 1, 4.5, 129, []],
    ['verdant_tofu_kale_box', 'Tofu and Kale Box', 'The tofu bowl boxed cold for a desk lunch.', 'verdant', 'smoky_tofu_kale_bowl', 1, 4.4, 87, [6, 7]],
    ['saffron_calamari_salad', 'Calamari and Rocket Salad', 'Fast-cooked calamari on rocket and celery with lemon.', 'saffron', 'calamari_rocket_salad', 1, 4.6, 105, [1]],
    ['daily_pot_calamari_plate', 'Calamari Plate', 'The counter’s calamari salad, plated warm.', 'daily_pot', 'calamari_rocket_salad', 1.1, 4, 41, [1, 2]],
];

/** Rounds a price to the nearest half-dirham; a marketplace that quotes 13.47 AED is a prototype tell. */
function roundPrice(fils: number): number {
    return Math.max(50, Math.round(fils / 50) * 50);
}

function priceFor(recipe: Recipe, kitchenKey: string, portionFactor: number): Money {
    const costPerServing = (recipe.estimatedCost?.amount ?? 0) / recipe.servings;
    const multiplier = KITCHEN_PRICE_MULTIPLIER[kitchenKey] ?? 2.5;
    return aed(roundPrice(costPerServing * multiplier * portionFactor));
}

/** Time the person spends on a kitchen meal: unpacking and warming, not cooking. */
function reheatMinutes(recipe: Recipe): number {
    return Math.min(10, Math.max(2, Math.round(totalRecipeMinutes(recipe) / 8)));
}

export interface MakeAvailabilityOptions {
    readonly weekStart?: string | undefined;
    readonly days?: number | undefined;
    readonly unavailableWeekdays?: readonly number[] | undefined;
    readonly remaining?: number | null | undefined;
    readonly cutOffTime?: string | undefined;
}

/**
 * A published availability window.
 *
 * Fourteen days from the fixture week's Monday: enough for "order for next week" to be reachable,
 * short enough that a calendar can render it. Remaining stock is a deterministic function of the day
 * rather than a random number, so an "only two left" badge is reproducible.
 */
export function makeAvailability(
    options: MakeAvailabilityOptions = {},
): readonly MealAvailability[] {
    const weekStart = options.weekStart ?? PROTOTYPE_WEEK_START;
    const days = options.days ?? PROTOTYPE_AVAILABILITY_DAYS;
    const closed = new Set(options.unavailableWeekdays ?? []);
    const cutOff = options.cutOffTime ?? '18:00';

    return Array.from({ length: days }, (_unused, offset) => {
        const date = addDays(weekStart, offset);
        const available = !closed.has(isoWeekday(date));
        return {
            date,
            available,
            remaining:
                options.remaining === undefined
                    ? available
                        ? 4 + ((offset * 7) % 21)
                        : 0
                    : options.remaining,
            orderCutOffAt: available ? instantAt(date, cutOff) : null,
        };
    });
}

export interface MakeMarketplaceMealOverrides {
    readonly name?: string | undefined;
    readonly price?: Money | undefined;
    readonly mealTypes?: readonly MealType[] | undefined;
    readonly availability?: readonly MealAvailability[] | undefined;
    readonly preparationMinutes?: number | null | undefined;
    readonly rating?: number | null | undefined;
    readonly ratingCount?: number | undefined;
}

export function makeMarketplaceMeal(
    row: MealRow,
    ordinal: number,
    overrides: MakeMarketplaceMealOverrides = {},
): MarketplaceMeal {
    const [
        key,
        name,
        description,
        kitchenKey,
        recipeKey,
        portionFactor,
        rating,
        ratingCount,
        unavailableWeekdays,
    ] = row;

    const kitchen = kitchenByKey(kitchenKey);
    const recipe = recipeByKey(recipeKey);

    const servingGrams = recipe.serving.grams;
    const serving: Serving = makeServing({
        label:
            portionFactor === 1
                ? recipe.serving.label
                : `${recipe.serving.label} (kitchen portion)`,
        quantity: 1,
        unit: 'portion',
        grams: servingGrams === null ? null : Math.round(servingGrams * portionFactor),
        householdMeasure: null,
    });

    const nutrition: NutritionFacts = scaleFacts(recipe.nutrition.perServing, portionFactor, {
        basis: 'per_serving',
        serving,
        method: 'fixture.meal_from_recipe_serving',
        notes: [
            `Derived from recipe ${recipe.slug} version ${recipe.version}, scaled to the portion this kitchen sells.`,
        ],
    });

    return {
        id: mealIdAt(ordinal),
        kitchenId: kitchen.id,
        kitchenName: kitchen.name,
        name: overrides.name ?? name,
        slug: key.replace(/_/g, '-'),
        description,
        mealTypes: overrides.mealTypes ?? recipe.mealTypes,
        dietClassifications: recipe.dietClassifications,
        cuisines: recipe.cuisines,
        allergens: recipe.allergens,
        serving,
        nutrition,
        price: overrides.price ?? priceFor(recipe, kitchenKey, portionFactor),
        preparationMinutes:
            overrides.preparationMinutes === undefined
                ? reheatMinutes(recipe)
                : overrides.preparationMinutes,
        imagePlaceholderId: `meal-${key.replace(/_/g, '-')}`,
        availability: overrides.availability ?? makeAvailability({ unavailableWeekdays }),
        channels: kitchen.channels,
        rating: overrides.rating === undefined ? rating : overrides.rating,
        ratingCount: overrides.ratingCount ?? ratingCount,
    };
}

export const PROTOTYPE_MEALS: readonly MarketplaceMeal[] = ROWS.map((row, index) =>
    makeMarketplaceMeal(row, index),
);

const BY_KEY: ReadonlyMap<string, MarketplaceMeal> = new Map(
    ROWS.map((row, index) => [
        atOrThrow(row, 0, 'meal key') as string,
        atOrThrow(PROTOTYPE_MEALS, index, 'meal'),
    ]),
);

const BY_ID: ReadonlyMap<string, MarketplaceMeal> = new Map(
    PROTOTYPE_MEALS.map((meal) => [meal.id, meal]),
);

/**
 * Which recipe (and which version of it) a meal's figures came from.
 *
 * Deliberately an index rather than a field on `MarketplaceMeal`: the consumer contract has no
 * business exposing a kitchen's internal recipe identifier, but the planner needs the link to turn
 * "swap this kitchen meal for the home-cooked version" into something real.
 */
export const MEAL_RECIPE_INDEX: ReadonlyMap<string, { recipeKey: string; version: string }> =
    new Map(
        ROWS.map((row, index) => {
            const meal = atOrThrow(PROTOTYPE_MEALS, index, 'meal');
            const recipe = recipeByKey(row[4]);
            return [meal.id, { recipeKey: row[4], version: recipe.version }];
        }),
    );

export function mealByKey(key: string): MarketplaceMeal {
    return fromMapOrThrow(BY_KEY, key, 'marketplace meal');
}

export function mealById(id: MealId): MarketplaceMeal | null {
    return BY_ID.get(id) ?? null;
}

export function mealAt(index: number): MarketplaceMeal {
    return atOrThrow(PROTOTYPE_MEALS, index, 'marketplace meal');
}

/** Meals belonging to one kitchen. */
export function mealsForKitchen(kitchenId: KitchenId): readonly MarketplaceMeal[] {
    return PROTOTYPE_MEALS.filter((meal) => meal.kitchenId === kitchenId);
}

/** Meals offered for a meal type, in identifier order — the candidate set regeneration rotates. */
export function mealsForType(mealType: MealType): readonly MarketplaceMeal[] {
    return PROTOTYPE_MEALS.filter((meal) => meal.mealTypes.includes(mealType));
}
