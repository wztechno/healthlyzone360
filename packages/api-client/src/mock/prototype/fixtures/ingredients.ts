import type {
    AllergenCode,
    DietClassification,
    IngredientId,
    Money,
} from '@healthy360/domain-types';
import type {
    IngredientQuantity,
    MeasureUnit,
    NutritionFacts,
    Serving,
} from '@healthy360/nutrition';

import { aed, atOrThrow, fromMapOrThrow } from '../constants.ts';
import { ingredientIdAt } from '../ids.ts';
import { allergenCode } from './allergens.ts';
import { makeFacts, makeServing } from './nutrients.ts';

/**
 * The ingredient reference table.
 *
 * **Every number below is synthetic.** They were authored to be *plausible and internally
 * consistent* — a gram of protein contributes four kilocalories, saturated fat never exceeds total
 * fat, sugars never exceed carbohydrate — so that a recipe rolled up from them produces a defensible
 * label. They are not transcribed from any food-composition database, any product packaging or any
 * reference product, and every set of facts carries `source.kind = 'synthetic_prototype'` to say so.
 *
 * The table is a tuple list rather than sixty object literals for a reason beyond brevity: with
 * `exactOptionalPropertyTypes` on, an object-literal table is where optional-property mistakes
 * accumulate silently. A fixed-arity tuple cannot be half-filled, and `makeIngredient` is then the
 * single place a default is decided.
 */

/** The most restrictive diet an ingredient suits; every less restrictive diet inherits it. */
export const INGREDIENT_SUITABILITIES = ['vegan', 'vegetarian', 'pescatarian', 'omnivore'] as const;
export type IngredientSuitability = (typeof INGREDIENT_SUITABILITIES)[number];

type IngredientRow = readonly [
    key: string,
    name: string,
    suitability: IngredientSuitability,
    aisle: string,
    energy: number,
    protein: number,
    carbohydrate: number,
    fat: number,
    fibre: number,
    sugars: number,
    saturatedFat: number,
    sodium: number,
    allergens: readonly string[],
    costPer100gFils: number,
];

/**
 * Formatting is preserved deliberately: one row per ingredient, columns aligned by position.
 * Reflowed to one value per line this table is nine hundred lines long and impossible to review.
 */
// prettier-ignore
const ROWS: readonly IngredientRow[] = [
    // ── poultry, meat, fish and seafood ────────────────────────────────────────────────────────
    ['chicken_breast', 'Chicken breast', 'omnivore', 'Butchery', 165, 31, 0, 3.6, 0, 0, 1, 74, [], 340],
    ['chicken_thigh', 'Chicken thigh', 'omnivore', 'Butchery', 209, 26, 0, 10.9, 0, 0, 3, 86, [], 260],
    ['beef_mince_lean', 'Lean beef mince', 'omnivore', 'Butchery', 187, 21, 0, 11, 0, 0, 4.5, 66, [], 420],
    ['lamb_leg', 'Lamb leg', 'omnivore', 'Butchery', 201, 25, 0, 11, 0, 0, 4.8, 72, [], 520],
    ['turkey_breast', 'Turkey breast', 'omnivore', 'Butchery', 135, 29, 0, 1.7, 0, 0, 0.5, 60, [], 380],
    ['salmon_fillet', 'Salmon fillet', 'pescatarian', 'Fishmonger', 208, 20, 0, 13, 0, 0, 3.1, 59, ['fish'], 610],
    ['sea_bass_fillet', 'Sea bass fillet', 'pescatarian', 'Fishmonger', 124, 24, 0, 2.6, 0, 0, 0.6, 68, ['fish'], 570],
    ['prawns', 'Prawns', 'pescatarian', 'Fishmonger', 99, 24, 0.2, 0.3, 0, 0, 0.1, 111, ['crustaceans'], 640],
    ['calamari', 'Calamari rings', 'pescatarian', 'Fishmonger', 92, 15.6, 3.1, 1.4, 0, 0, 0.4, 44, ['mollusc'], 480],

    // ── eggs and dairy ────────────────────────────────────────────────────────────────────────
    ['egg_whole', 'Hen egg', 'vegetarian', 'Chilled', 143, 12.6, 0.7, 9.5, 0, 0.4, 3.1, 142, ['egg'], 190],
    ['egg_white', 'Egg white', 'vegetarian', 'Chilled', 52, 10.9, 0.7, 0.2, 0, 0.7, 0, 166, ['egg'], 210],
    ['halloumi', 'Halloumi', 'vegetarian', 'Chilled', 321, 22, 2.2, 25, 0, 2.2, 16, 1100, ['milk'], 540],
    ['feta_style_cheese', 'Feta-style cheese', 'vegetarian', 'Chilled', 264, 14, 4.1, 21, 0, 4.1, 14, 917, ['milk'], 470],
    ['labneh', 'Labneh', 'vegetarian', 'Chilled', 174, 9, 5, 13, 0, 5, 8, 90, ['milk'], 300],
    ['greek_yoghurt', 'Greek-style yoghurt', 'vegetarian', 'Chilled', 97, 9, 3.6, 5, 0, 3.6, 3.2, 36, ['milk'], 180],
    ['cottage_cheese', 'Cottage cheese', 'vegetarian', 'Chilled', 98, 11, 3.4, 4.3, 0, 2.7, 1.7, 364, ['milk'], 200],
    ['semi_skimmed_milk', 'Semi-skimmed milk', 'vegetarian', 'Chilled', 47, 3.4, 4.8, 1.7, 0, 4.8, 1.1, 44, ['milk'], 60],

    // ── soy, pulses and legumes ───────────────────────────────────────────────────────────────
    ['tofu_firm', 'Firm tofu', 'vegan', 'Chilled', 144, 17, 2.8, 8.7, 2.3, 0.6, 1.3, 14, ['soy'], 230],
    ['tempeh', 'Tempeh', 'vegan', 'Chilled', 192, 20, 7.6, 11, 4.8, 0.5, 2.2, 9, ['soy'], 290],
    ['chickpeas_cooked', 'Cooked chickpeas', 'vegan', 'Store cupboard', 164, 8.9, 27, 2.6, 7.6, 4.8, 0.3, 7, [], 90],
    ['lentils_cooked', 'Cooked brown lentils', 'vegan', 'Store cupboard', 116, 9, 20, 0.4, 7.9, 1.8, 0.1, 2, [], 80],
    ['red_kidney_beans', 'Red kidney beans', 'vegan', 'Store cupboard', 127, 8.7, 22.8, 0.5, 7.4, 0.3, 0.1, 5, [], 85],
    ['broad_beans', 'Broad beans', 'vegan', 'Store cupboard', 110, 7.6, 19.6, 0.4, 5.4, 1.8, 0.1, 8, [], 95],

    // ── grains and breads ─────────────────────────────────────────────────────────────────────
    ['brown_rice', 'Brown rice, cooked', 'vegan', 'Store cupboard', 123, 2.7, 25.6, 1, 1.6, 0.4, 0.2, 4, [], 45],
    ['basmati_rice', 'Basmati rice, cooked', 'vegan', 'Store cupboard', 130, 2.7, 28, 0.3, 0.4, 0.1, 0.1, 1, [], 50],
    ['bulgur_wheat', 'Bulgur wheat, cooked', 'vegan', 'Store cupboard', 83, 3.1, 18.6, 0.2, 4.5, 0.1, 0, 5, ['gluten'], 55],
    ['freekeh', 'Freekeh, cooked', 'vegan', 'Store cupboard', 118, 4.6, 23.5, 0.7, 5.2, 0.3, 0.1, 6, ['gluten'], 75],
    ['quinoa_cooked', 'Quinoa, cooked', 'vegan', 'Store cupboard', 120, 4.4, 21.3, 1.9, 2.8, 0.9, 0.2, 7, [], 110],
    ['wholemeal_flatbread', 'Wholemeal flatbread', 'vegan', 'Bakery', 265, 9.2, 47, 3.9, 6.5, 2.1, 0.7, 460, ['gluten'], 120],
    ['sourdough_bread', 'Sourdough bread', 'vegan', 'Bakery', 254, 8.5, 48, 1.9, 2.9, 2.4, 0.4, 490, ['gluten'], 140],
    ['wholewheat_pasta', 'Wholewheat pasta, cooked', 'vegan', 'Store cupboard', 149, 6.3, 30, 1.1, 4.5, 1.1, 0.2, 4, ['gluten'], 70],
    ['rolled_oats', 'Rolled oats', 'vegan', 'Store cupboard', 379, 13.2, 67.7, 6.5, 10.1, 1, 1.1, 6, ['gluten'], 65],

    // ── roots and squashes ────────────────────────────────────────────────────────────────────
    ['sweet_potato', 'Sweet potato', 'vegan', 'Greengrocer', 86, 1.6, 20.1, 0.1, 3, 4.2, 0, 55, [], 45],
    ['potato', 'Potato', 'vegan', 'Greengrocer', 77, 2, 17.5, 0.1, 2.2, 0.8, 0, 6, [], 30],
    ['pumpkin', 'Pumpkin', 'vegan', 'Greengrocer', 26, 1, 6.5, 0.1, 0.5, 2.8, 0.1, 1, [], 40],
    ['carrot', 'Carrot', 'vegan', 'Greengrocer', 41, 0.9, 9.6, 0.2, 2.8, 4.7, 0, 69, [], 25],

    // ── vegetables and leaves ─────────────────────────────────────────────────────────────────
    ['courgette', 'Courgette', 'vegan', 'Greengrocer', 17, 1.2, 3.1, 0.3, 1, 2.5, 0.1, 8, [], 55],
    ['aubergine', 'Aubergine', 'vegan', 'Greengrocer', 25, 1, 5.9, 0.2, 3, 3.5, 0, 2, [], 50],
    ['tomato', 'Tomato', 'vegan', 'Greengrocer', 18, 0.9, 3.9, 0.2, 1.2, 2.6, 0, 5, [], 40],
    ['cucumber', 'Cucumber', 'vegan', 'Greengrocer', 15, 0.7, 3.6, 0.1, 0.5, 1.7, 0, 2, [], 35],
    ['red_onion', 'Red onion', 'vegan', 'Greengrocer', 40, 1.1, 9.3, 0.1, 1.7, 4.2, 0, 4, [], 30],
    ['garlic', 'Garlic', 'vegan', 'Greengrocer', 149, 6.4, 33, 0.5, 2.1, 1, 0.1, 17, [], 90],
    ['red_pepper', 'Red pepper', 'vegan', 'Greengrocer', 31, 1, 6, 0.3, 2.1, 4.2, 0.1, 4, [], 60],
    ['spinach', 'Spinach', 'vegan', 'Greengrocer', 23, 2.9, 3.6, 0.4, 2.2, 0.4, 0.1, 79, [], 70],
    ['rocket', 'Rocket', 'vegan', 'Greengrocer', 25, 2.6, 3.7, 0.7, 1.6, 2.1, 0.1, 27, [], 95],
    ['kale', 'Kale', 'vegan', 'Greengrocer', 35, 2.9, 4.4, 1.5, 4.1, 0.8, 0.2, 53, [], 75],
    ['broccoli', 'Broccoli', 'vegan', 'Greengrocer', 34, 2.8, 6.6, 0.4, 2.6, 1.7, 0.1, 33, [], 65],
    ['cauliflower', 'Cauliflower', 'vegan', 'Greengrocer', 25, 1.9, 5, 0.3, 2, 1.9, 0.1, 30, [], 55],
    ['green_beans', 'Green beans', 'vegan', 'Greengrocer', 31, 1.8, 7, 0.1, 3.4, 3.3, 0, 6, [], 60],
    ['celery', 'Celery', 'vegan', 'Greengrocer', 16, 0.7, 3, 0.2, 1.6, 1.3, 0, 80, ['celery'], 45],
    ['parsley', 'Flat-leaf parsley', 'vegan', 'Greengrocer', 36, 3, 6.3, 0.8, 3.3, 0.9, 0.1, 56, [], 80],
    ['mint', 'Fresh mint', 'vegan', 'Greengrocer', 44, 3.3, 8.4, 0.7, 6.8, 0.2, 0.2, 31, [], 85],

    // ── fruit ─────────────────────────────────────────────────────────────────────────────────
    ['lemon_juice', 'Lemon juice', 'vegan', 'Greengrocer', 22, 0.4, 6.9, 0.2, 0.3, 2.5, 0, 1, [], 70],
    ['pomegranate_seeds', 'Pomegranate seeds', 'vegan', 'Greengrocer', 83, 1.7, 18.7, 1.2, 4, 13.7, 0.1, 3, [], 130],
    ['orange', 'Orange', 'vegan', 'Greengrocer', 47, 0.9, 11.8, 0.1, 2.4, 9.4, 0, 0, [], 40],
    ['dates_medjool', 'Medjool dates', 'vegan', 'Store cupboard', 277, 1.8, 75, 0.2, 6.7, 66.5, 0, 1, [], 190],

    // ── nuts, seeds and pastes ────────────────────────────────────────────────────────────────
    ['almonds', 'Almonds', 'vegan', 'Store cupboard', 579, 21.2, 21.6, 49.9, 12.5, 4.4, 3.8, 1, ['tree_nut'], 420],
    ['walnuts', 'Walnuts', 'vegan', 'Store cupboard', 654, 15.2, 13.7, 65.2, 6.7, 2.6, 6.1, 2, ['tree_nut'], 480],
    ['pistachios', 'Pistachios', 'vegan', 'Store cupboard', 560, 20.2, 27.2, 45.3, 10.6, 7.7, 5.9, 1, ['tree_nut'], 650],
    ['sunflower_seeds', 'Sunflower seeds', 'vegan', 'Store cupboard', 584, 20.8, 20, 51.5, 8.6, 2.6, 4.5, 9, [], 210],
    ['tahini', 'Tahini', 'vegan', 'Store cupboard', 595, 17, 21, 53.8, 9.3, 0.5, 7.5, 115, ['sesame'], 320],
    ['peanut_butter', 'Peanut butter', 'vegan', 'Store cupboard', 588, 25.1, 20, 50, 6, 9.2, 10.3, 17, ['peanut'], 260],

    // ── oils, condiments and sweeteners ───────────────────────────────────────────────────────
    ['olive_oil', 'Extra-virgin olive oil', 'vegan', 'Store cupboard', 884, 0, 0, 100, 0, 0, 13.8, 2, [], 250],
    ['wholegrain_mustard', 'Wholegrain mustard', 'vegan', 'Store cupboard', 143, 8, 6.4, 10, 4.5, 1.6, 0.6, 1120, ['mustard'], 180],
    ['pomegranate_molasses', 'Pomegranate molasses', 'vegan', 'Store cupboard', 267, 0.5, 66, 0.1, 0.5, 60, 0, 12, [], 230],
    ['honey', 'Honey', 'vegetarian', 'Store cupboard', 304, 0.3, 82.4, 0, 0.2, 82.1, 0, 4, [], 280],
];

/**
 * Micronutrients, for the handful of ingredients that carry the panel's five optional lines.
 *
 * Only a few, on purpose: a facts panel that shows calcium on every one of sixty ingredients invites
 * a reader to believe the data set is a laboratory analysis, which it is not.
 */
const MICRONUTRIENTS: Readonly<Record<string, Readonly<Record<string, number>>>> = {
    salmon_fillet: { potassium: 363, vitamin_d: 11.1 },
    sea_bass_fillet: { potassium: 256, vitamin_d: 5.2 },
    egg_whole: { calcium: 56, iron: 1.8, vitamin_d: 2 },
    greek_yoghurt: { calcium: 110, potassium: 141 },
    semi_skimmed_milk: { calcium: 120, potassium: 150 },
    halloumi: { calcium: 700 },
    labneh: { calcium: 150 },
    tofu_firm: { calcium: 350, iron: 2.7 },
    lentils_cooked: { iron: 3.3, potassium: 369 },
    chickpeas_cooked: { iron: 2.9, potassium: 291 },
    spinach: { calcium: 99, iron: 2.7, potassium: 558, vitamin_c: 28.1 },
    kale: { calcium: 254, iron: 1.6, potassium: 348, vitamin_c: 93.4 },
    broccoli: { calcium: 47, potassium: 316, vitamin_c: 89.2 },
    red_pepper: { potassium: 211, vitamin_c: 127.7 },
    orange: { calcium: 40, potassium: 181, vitamin_c: 53.2 },
    almonds: { calcium: 269, iron: 3.7, potassium: 733 },
    tahini: { calcium: 426, iron: 8.9 },
};

/** Typical single portion, grams, for the ingredients a person logs as a portion rather than by mass. */
const TYPICAL_PORTION_GRAMS: Readonly<Record<string, number>> = {
    chicken_breast: 150,
    salmon_fillet: 140,
    sea_bass_fillet: 140,
    egg_whole: 55,
    wholemeal_flatbread: 60,
    sourdough_bread: 40,
    dates_medjool: 24,
    almonds: 30,
    walnuts: 30,
    pistachios: 30,
    olive_oil: 14,
    tahini: 15,
    peanut_butter: 16,
    greek_yoghurt: 170,
};

export interface PrototypeIngredient {
    readonly id: IngredientId;
    /** Stable slug used by the recipe tables; never rendered. */
    readonly key: string;
    readonly name: string;
    readonly suitability: IngredientSuitability;
    /** Grocery-list grouping. */
    readonly aisle: string;
    readonly per100g: NutritionFacts;
    readonly allergens: readonly AllergenCode[];
    readonly dietClassifications: readonly DietClassification[];
    readonly servings: readonly Serving[];
    readonly costPer100g: Money;
}

/**
 * Which classifications an ingredient satisfies.
 *
 * Derived rather than restated in the table: a classification that has to be typed sixty times is a
 * classification that will disagree with the allergen list on row forty-one.
 */
function classificationsFor(
    suitability: IngredientSuitability,
    allergens: readonly string[],
    protein: number,
    carbohydrate: number,
): readonly DietClassification[] {
    const classifications: DietClassification[] = ['omnivore'];
    if (suitability === 'vegan') classifications.push('vegan', 'vegetarian', 'pescatarian');
    if (suitability === 'vegetarian') classifications.push('vegetarian', 'pescatarian');
    if (suitability === 'pescatarian') classifications.push('pescatarian');

    // Nothing in this data set is pork or alcohol, so every row is halal-friendly. Stated rather
    // than assumed, because "we did not add any" is not the same claim as "none is present".
    classifications.push('halal_friendly');

    if (!allergens.includes('gluten')) classifications.push('gluten_free');
    if (!allergens.includes('milk')) classifications.push('dairy_free');
    if (!allergens.includes('tree_nut') && !allergens.includes('peanut')) {
        classifications.push('nut_free');
    }
    if (protein >= 15) classifications.push('high_protein');
    if (carbohydrate <= 10) classifications.push('low_carb', 'keto');
    return classifications;
}

export interface MakeIngredientOverrides {
    readonly name?: string | undefined;
    readonly aisle?: string | undefined;
    readonly allergens?: readonly AllergenCode[] | undefined;
    readonly costPer100g?: Money | undefined;
    readonly servings?: readonly Serving[] | undefined;
}

/** Builds one ingredient from a table row. Every default is decided here and nowhere else. */
export function makeIngredient(
    row: IngredientRow,
    ordinal: number,
    overrides: MakeIngredientOverrides = {},
): PrototypeIngredient {
    const [
        key,
        name,
        suitability,
        aisle,
        energy,
        protein,
        carbohydrate,
        fat,
        fibre,
        sugars,
        saturatedFat,
        sodium,
        allergens,
        costPer100gFils,
    ] = row;

    const micros = MICRONUTRIENTS[key] ?? {};
    const portionGrams = TYPICAL_PORTION_GRAMS[key] ?? 100;

    return {
        id: ingredientIdAt(ordinal),
        key,
        name: overrides.name ?? name,
        suitability,
        aisle: overrides.aisle ?? aisle,
        per100g: makeFacts(
            {
                energy,
                protein,
                carbohydrate,
                fat,
                fibre,
                sugars,
                saturated_fat: saturatedFat,
                sodium,
                ...micros,
            },
            { basis: 'per_100g', totalGrams: 100, method: 'fixture.ingredient_reference' },
        ),
        allergens: overrides.allergens ?? allergens.map(allergenCode),
        dietClassifications: classificationsFor(suitability, allergens, protein, carbohydrate),
        servings: overrides.servings ?? [
            makeServing({ label: '100 g', quantity: 100, unit: 'g', grams: 100 }),
            makeServing({
                label: '1 typical portion',
                quantity: 1,
                unit: 'portion',
                grams: portionGrams,
            }),
        ],
        costPer100g: overrides.costPer100g ?? aed(costPer100gFils),
    };
}

export const PROTOTYPE_INGREDIENTS: readonly PrototypeIngredient[] = ROWS.map((row, index) =>
    makeIngredient(row, index),
);

const BY_KEY: ReadonlyMap<string, PrototypeIngredient> = new Map(
    PROTOTYPE_INGREDIENTS.map((ingredient) => [ingredient.key, ingredient]),
);

const BY_ID: ReadonlyMap<string, PrototypeIngredient> = new Map(
    PROTOTYPE_INGREDIENTS.map((ingredient) => [ingredient.id, ingredient]),
);

export function ingredientByKey(key: string): PrototypeIngredient {
    return fromMapOrThrow(BY_KEY, key, 'ingredient');
}

/** Accepts a plain string as well as a branded id: a `food` planner entry carries the raw form. */
export function ingredientById(id: IngredientId | string): PrototypeIngredient | null {
    return BY_ID.get(id) ?? null;
}

export function ingredientAt(index: number): PrototypeIngredient {
    return atOrThrow(PROTOTYPE_INGREDIENTS, index, 'ingredient');
}

/** Cost of `grams` of an ingredient, rounded to whole fils — money is integral by construction. */
export function ingredientCost(ingredient: PrototypeIngredient, grams: number): Money {
    return aed(Math.round((ingredient.costPer100g.amount * grams) / 100));
}

export interface MakeIngredientQuantityOptions {
    readonly unit?: MeasureUnit | undefined;
    readonly quantity?: number | undefined;
    readonly optional?: boolean | undefined;
}

/** A recipe line: how much of an ingredient, with the reference facts attached. */
export function makeIngredientQuantity(
    key: string,
    grams: number,
    options: MakeIngredientQuantityOptions = {},
): IngredientQuantity {
    const ingredient = ingredientByKey(key);
    return {
        ingredientId: ingredient.id,
        name: ingredient.name,
        quantity: options.quantity ?? grams,
        unit: options.unit ?? 'g',
        grams,
        per100g: ingredient.per100g,
        allergens: ingredient.allergens,
        optional: options.optional ?? false,
        estimatedCost: ingredientCost(ingredient, grams),
    };
}
