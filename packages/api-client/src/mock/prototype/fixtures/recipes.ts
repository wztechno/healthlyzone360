import { amountValue, recipeNutritionFromIngredients } from '@healthy360/nutrition';
import type { IngredientQuantity, RecipeNutrition, Serving } from '@healthy360/nutrition';
import type {
    AllergenCode,
    DietClassification,
    KitchenId,
    MealType,
    Money,
    RecipeId,
} from '@healthy360/domain-types';

import type { Recipe, RecipeStep } from '../../../contracts/foods.ts';
import { PROTOTYPE_NOW, aed, atOrThrow, fromMapOrThrow } from '../constants.ts';
import { recipeIdAt } from '../ids.ts';
import { unionAllergens } from './allergens.ts';
import { ingredientByKey, makeIngredientQuantity } from './ingredients.ts';
import type { IngredientSuitability } from './ingredients.ts';
import { PROTOTYPE_KITCHEN_IDS } from './kitchens.ts';
import { makeServing } from './nutrients.ts';

/**
 * Twenty recipes, and the nutrition figures **derived** from their ingredients.
 *
 * Not one nutrition number below is typed by hand. Every recipe's per-recipe, per-serving and
 * per-100 g figures come from `recipeNutritionFromIngredients` in `@healthy360/nutrition`, rolled up
 * from the ingredient table. That is the property that makes the prototype defensible: a recipe's
 * label agrees with its ingredient list by construction, a portion adjustment scales it correctly,
 * and a day's total is the sum of its meals rather than a plausible-looking number somebody chose.
 *
 * Names, descriptions and method steps are original British-English copy written for this data set.
 */

type RecipeRow = readonly [
    key: string,
    name: string,
    description: string,
    mealTypes: readonly MealType[],
    cuisines: readonly string[],
    extraDiets: readonly DietClassification[],
    servings: number,
    servingLabel: string,
    ingredients: readonly (readonly [key: string, grams: number])[],
    steps: readonly (readonly [instruction: string, minutes: number | null])[],
    preparationMinutes: number,
    cookingMinutes: number,
    complexity: number,
    /** Set when this is a kitchen's own version of the recipe rather than the platform's. */
    kitchenKey: string | null,
];

const ROWS: readonly RecipeRow[] = [
    [
        'herbed_chicken_freekeh',
        'Herbed chicken and freekeh bowl',
        'Grilled chicken over smoky freekeh with charred courgette and a great deal of parsley.',
        ['lunch', 'dinner'],
        ['Levantine'],
        ['mediterranean'],
        2,
        '1 bowl',
        [
            ['chicken_breast', 300],
            ['freekeh', 240],
            ['courgette', 150],
            ['parsley', 20],
            ['olive_oil', 20],
            ['lemon_juice', 15],
        ],
        [
            ['Season the chicken and leave it at room temperature while the grill heats.', 10],
            ['Grill the chicken until cooked through, then rest it for five minutes.', 14],
            ['Char the courgette in the same pan and fold it through the warm freekeh.', 6],
            ['Slice the chicken, spoon over the lemon and oil, and finish with parsley.', 3],
        ],
        12,
        20,
        2,
        'verdant',
    ],
    [
        'lemon_tahini_salmon',
        'Lemon and tahini salmon tray',
        'A single tray of salmon, sweet potato and broccoli, finished with loosened tahini.',
        ['dinner'],
        ['Coastal'],
        ['mediterranean'],
        2,
        '1 tray portion',
        [
            ['salmon_fillet', 280],
            ['sweet_potato', 300],
            ['broccoli', 200],
            ['tahini', 30],
            ['lemon_juice', 20],
            ['olive_oil', 15],
        ],
        [
            ['Heat the oven and start the sweet potato on its own for a head start.', 15],
            ['Add the salmon and broccoli to the tray and roast until just set.', 12],
            ['Loosen the tahini with the lemon juice and a spoonful of water.', 3],
            ['Spoon the sauce over the tray straight from the oven.', null],
        ],
        10,
        27,
        2,
        'saffron',
    ],
    [
        'spiced_lentil_pumpkin_stew',
        'Spiced lentil and pumpkin stew',
        'A slow, soft stew of brown lentils and pumpkin that improves on the second day.',
        ['lunch', 'dinner'],
        ['Levantine'],
        ['vegan'],
        4,
        '1 bowl',
        [
            ['lentils_cooked', 400],
            ['pumpkin', 350],
            ['carrot', 120],
            ['red_onion', 100],
            ['garlic', 10],
            ['olive_oil', 20],
        ],
        [
            ['Soften the onion, carrot and garlic in the oil without colouring them.', 8],
            ['Add the pumpkin and spices and coat everything well.', 3],
            ['Add the lentils and water, then simmer until the pumpkin collapses.', 25],
            ['Season, and mash a little of the stew against the side of the pan to thicken it.', 2],
        ],
        12,
        36,
        2,
        null,
    ],
    [
        'grilled_halloumi_rocket',
        'Grilled halloumi and rocket plate',
        'Griddled halloumi on peppery rocket with tomato, cucumber and a molasses dressing.',
        ['lunch'],
        ['Mediterranean'],
        ['vegetarian', 'mediterranean'],
        2,
        '1 plate',
        [
            ['halloumi', 160],
            ['rocket', 80],
            ['tomato', 150],
            ['cucumber', 120],
            ['olive_oil', 15],
            ['pomegranate_molasses', 10],
        ],
        [
            ['Slice the halloumi thickly and dry it well so it colours rather than steams.', 4],
            ['Griddle on both sides until it is marked and softened.', 6],
            ['Dress the leaves and vegetables, then lay the cheese over them.', 3],
        ],
        8,
        6,
        1,
        null,
    ],
    [
        'slow_braised_lamb_bulgur',
        'Slow-braised lamb with bulgur',
        'Lamb braised until it gives way, served over bulgur that has taken up the braising liquid.',
        ['dinner'],
        ['Levantine'],
        [],
        4,
        '1 plate',
        [
            ['lamb_leg', 320],
            ['bulgur_wheat', 240],
            ['red_onion', 120],
            ['tomato', 200],
            ['garlic', 10],
            ['olive_oil', 20],
        ],
        [
            ['Brown the lamb hard on every side and set it aside.', 10],
            ['Soften the onion and garlic, add the tomato, and return the lamb.', 8],
            ['Cover and braise gently until the meat pulls apart.', 90],
            ['Cook the bulgur in the strained liquid and serve the lamb over it.', 15],
        ],
        18,
        118,
        3,
        null,
    ],
    [
        'charred_aubergine_chickpea',
        'Charred aubergine and chickpea salad',
        'Blistered aubergine folded through chickpeas with tahini, lemon and a lot of parsley.',
        ['lunch'],
        ['Levantine'],
        ['vegan'],
        3,
        '1 bowl',
        [
            ['aubergine', 350],
            ['chickpeas_cooked', 240],
            ['tomato', 150],
            ['parsley', 20],
            ['tahini', 25],
            ['lemon_juice', 20],
        ],
        [
            ['Char the aubergine whole until the skin blackens and the flesh slumps.', 20],
            ['Peel it while warm and tear the flesh into rough strips.', 5],
            ['Fold through the chickpeas, tomato and dressing, then rest before serving.', 10],
        ],
        10,
        20,
        2,
        null,
    ],
    [
        'morning_oats_dates_almonds',
        'Morning oats with dates and almonds',
        'Oats cooked in milk with chopped dates stirred through and toasted almonds on top.',
        ['breakfast'],
        ['Home cooking'],
        ['vegetarian'],
        2,
        '1 bowl',
        [
            ['rolled_oats', 80],
            ['semi_skimmed_milk', 300],
            ['dates_medjool', 40],
            ['almonds', 30],
            ['honey', 15],
        ],
        [
            ['Toast the almonds dry until they smell of almonds rather than nothing.', 4],
            ['Cook the oats in the milk, stirring, until they thicken.', 7],
            ['Stir the dates through off the heat and top with the almonds and honey.', 2],
        ],
        5,
        11,
        1,
        null,
    ],
    [
        'garden_omelette_spinach',
        'Garden omelette with spinach',
        'A soft omelette folded around wilted spinach, tomato and a little crumbled cheese.',
        ['breakfast'],
        ['Mediterranean'],
        ['vegetarian'],
        2,
        '1 omelette',
        [
            ['egg_whole', 165],
            ['spinach', 80],
            ['tomato', 100],
            ['feta_style_cheese', 40],
            ['olive_oil', 10],
        ],
        [
            ['Wilt the spinach with the tomato and drain off the liquid.', 4],
            ['Beat the eggs well and cook them gently, drawing the edges in.', 5],
            ['Add the filling, fold, and slide it out while the centre is still soft.', 2],
        ],
        6,
        7,
        2,
        null,
    ],
    [
        'harbour_prawn_quinoa',
        'Harbour prawn and quinoa salad',
        'Cold quinoa with quickly seared prawns, cucumber, red pepper and lemon.',
        ['lunch'],
        ['Coastal'],
        ['pescatarian', 'high_protein'],
        2,
        '1 bowl',
        [
            ['prawns', 240],
            ['quinoa_cooked', 300],
            ['cucumber', 150],
            ['red_pepper', 120],
            ['lemon_juice', 20],
            ['olive_oil', 15],
        ],
        [
            ['Sear the prawns in a very hot pan for barely a minute each side.', 3],
            ['Dress the cooled quinoa with the lemon and oil before anything else goes in.', 3],
            ['Fold through the vegetables and lay the prawns on top.', 3],
        ],
        12,
        4,
        1,
        null,
    ],
    [
        'tempeh_broccoli_stir_fry',
        'Tempeh and broccoli stir-fry',
        'Tempeh browned hard, then tossed with broccoli and pepper and served over rice.',
        ['dinner'],
        ['Contemporary'],
        ['vegan', 'high_protein'],
        2,
        '1 bowl',
        [
            ['tempeh', 240],
            ['broccoli', 250],
            ['red_pepper', 120],
            ['basmati_rice', 300],
            ['garlic', 10],
            ['olive_oil', 15],
        ],
        [
            ['Cut the tempeh into slabs and brown it properly on both sides.', 8],
            ['Add the broccoli and pepper with a splash of water and cover briefly.', 5],
            ['Add the garlic last so it perfumes rather than burns, and serve over rice.', 2],
        ],
        10,
        15,
        2,
        'verdant',
    ],
    [
        'sunrise_labneh_sourdough',
        'Sunrise labneh and sourdough plate',
        'Thick labneh, good bread, cold vegetables and olive oil — assembled rather than cooked.',
        ['breakfast'],
        ['Levantine'],
        ['vegetarian'],
        2,
        '1 plate',
        [
            ['labneh', 150],
            ['sourdough_bread', 120],
            ['cucumber', 100],
            ['tomato', 100],
            ['olive_oil', 12],
            ['mint', 5],
        ],
        [
            ['Spread the labneh on a cold plate and make a well in the middle.', 2],
            ['Pour the oil into the well and scatter over the torn mint.', 1],
            ['Toast the bread and serve it alongside the cut vegetables.', 4],
        ],
        7,
        4,
        1,
        null,
    ],
    [
        'roasted_cauliflower_wrap',
        'Roasted cauliflower and tahini wrap',
        'Deeply roasted cauliflower rolled into flatbread with tahini and rocket.',
        ['lunch'],
        ['Levantine'],
        ['vegan'],
        2,
        '1 wrap',
        [
            ['cauliflower', 300],
            ['wholemeal_flatbread', 120],
            ['tahini', 30],
            ['rocket', 40],
            ['lemon_juice', 15],
            ['olive_oil', 12],
        ],
        [
            ['Break the cauliflower small and roast it until the edges are properly dark.', 25],
            ['Loosen the tahini with lemon and water until it pours.', 2],
            ['Warm the bread, build the wrap, and roll it tightly.', 4],
        ],
        8,
        27,
        1,
        null,
    ],
    [
        'citrus_sea_bass_green_beans',
        'Citrus sea bass with green beans',
        'Sea bass baked over orange slices with green beans and crushed potatoes.',
        ['dinner'],
        ['Coastal'],
        ['pescatarian', 'mediterranean'],
        2,
        '1 plate',
        [
            ['sea_bass_fillet', 280],
            ['green_beans', 250],
            ['potato', 300],
            ['orange', 100],
            ['olive_oil', 18],
        ],
        [
            ['Boil the potatoes until they give, then crush them roughly with oil.', 18],
            ['Lay the fish over orange slices and bake until it flakes.', 12],
            ['Blanch the beans and dress them with the roasting juices.', 5],
        ],
        10,
        30,
        2,
        null,
    ],
    [
        'turkey_sweet_potato_hash',
        'Weeknight turkey and sweet potato hash',
        'Everything in one pan: turkey, sweet potato, pepper and onion, cooked until caught.',
        ['dinner'],
        ['Home cooking'],
        ['high_protein'],
        2,
        '1 pan portion',
        [
            ['turkey_breast', 300],
            ['sweet_potato', 350],
            ['red_pepper', 120],
            ['red_onion', 80],
            ['olive_oil', 18],
        ],
        [
            ['Dice the sweet potato small and give it a head start in the pan.', 10],
            ['Add the onion and pepper and let everything catch a little.', 6],
            ['Add the turkey last and cook it through without stirring too often.', 8],
        ],
        10,
        24,
        1,
        'riverstone',
    ],
    [
        'courgette_walnut_pasta',
        'Courgette and walnut pasta',
        'Courgette cooked down to a sauce, finished with toasted walnuts and parsley.',
        ['dinner'],
        ['Mediterranean'],
        ['vegan'],
        3,
        '1 bowl',
        [
            ['courgette', 300],
            ['wholewheat_pasta', 320],
            ['walnuts', 50],
            ['garlic', 10],
            ['olive_oil', 20],
            ['parsley', 15],
        ],
        [
            ['Cook the courgette slowly in oil until it stops looking like courgette.', 20],
            ['Toast and roughly chop the walnuts.', 4],
            ['Toss the drained pasta through the sauce with a little cooking water.', 3],
        ],
        8,
        24,
        2,
        null,
    ],
    [
        'red_bean_pepper_chilli',
        'Red bean and pepper chilli',
        'A bean chilli built on roasted peppers rather than mince, thickened by time.',
        ['dinner'],
        ['Contemporary'],
        ['vegan'],
        4,
        '1 bowl',
        [
            ['red_kidney_beans', 400],
            ['red_pepper', 200],
            ['tomato', 250],
            ['red_onion', 100],
            ['garlic', 10],
            ['olive_oil', 15],
        ],
        [
            ['Roast the peppers until blistered, then peel and chop them.', 22],
            ['Soften the onion and garlic, add the spices, and cook them out.', 6],
            ['Add the tomato, peppers and beans and simmer until it thickens.', 25],
        ],
        14,
        40,
        2,
        null,
    ],
    [
        'mint_yoghurt_chicken_skewers',
        'Mint yoghurt chicken skewers',
        'Thigh meat marinated in yoghurt, mint and garlic, then grilled hard and fast.',
        ['dinner'],
        ['Levantine'],
        ['high_protein'],
        2,
        '2 skewers',
        [
            ['chicken_thigh', 320],
            ['greek_yoghurt', 120],
            ['mint', 10],
            ['garlic', 8],
            ['lemon_juice', 15],
            ['olive_oil', 12],
        ],
        [
            ['Blend the marinade and coat the chicken; leave it as long as you can.', 10],
            ['Thread the meat loosely so the heat reaches the middle.', 5],
            ['Grill over a high heat, turning once, until charred at the edges.', 12],
        ],
        15,
        12,
        2,
        'riverstone',
    ],
    [
        'pistachio_pomegranate_bowl',
        'Pistachio and pomegranate fruit bowl',
        'Thick yoghurt, pomegranate seeds, chopped pistachios and a thread of honey.',
        ['snack', 'breakfast'],
        ['Levantine'],
        ['vegetarian'],
        2,
        '1 small bowl',
        [
            ['greek_yoghurt', 200],
            ['pomegranate_seeds', 100],
            ['pistachios', 30],
            ['honey', 15],
        ],
        [
            ['Spoon the yoghurt into cold bowls.', 1],
            ['Scatter the pomegranate and chopped pistachios over the top.', 2],
            ['Finish with honey, and eat before the seeds bleed into the yoghurt.', null],
        ],
        5,
        0,
        1,
        null,
    ],
    [
        'smoky_tofu_kale_bowl',
        'Smoky tofu and kale grain bowl',
        'Pressed tofu roasted until firm, with massaged kale, brown rice and a mustard dressing.',
        ['lunch'],
        ['Contemporary'],
        ['vegan', 'high_protein'],
        2,
        '1 bowl',
        [
            ['tofu_firm', 240],
            ['kale', 150],
            ['brown_rice', 300],
            ['sunflower_seeds', 25],
            ['olive_oil', 15],
            ['wholegrain_mustard', 10],
        ],
        [
            ['Press the tofu, cube it, and roast until the outside is firm.', 25],
            ['Massage the kale with a little oil until it darkens and softens.', 4],
            ['Whisk the mustard dressing and toss everything through the warm rice.', 3],
        ],
        12,
        27,
        2,
        null,
    ],
    [
        'calamari_rocket_salad',
        'Calamari and rocket salad',
        'Fast-cooked calamari on rocket and celery with lemon and thinly sliced onion.',
        ['lunch'],
        ['Coastal'],
        ['pescatarian'],
        2,
        '1 plate',
        [
            ['calamari', 240],
            ['rocket', 80],
            ['celery', 80],
            ['red_onion', 60],
            ['lemon_juice', 20],
            ['olive_oil', 18],
        ],
        [
            ['Slice the onion very thinly and soak it in the lemon juice.', 5],
            ['Cook the calamari in a hot pan for a minute — no longer.', 2],
            ['Toss everything together while the calamari is still warm.', 2],
        ],
        12,
        3,
        2,
        'saffron',
    ],
];

const SUITABILITY_RANK: Readonly<Record<IngredientSuitability, number>> = {
    vegan: 0,
    vegetarian: 1,
    pescatarian: 2,
    omnivore: 3,
};

const SUITABILITY_ORDER: readonly IngredientSuitability[] = [
    'vegan',
    'vegetarian',
    'pescatarian',
    'omnivore',
];

function suitabilityOf(keys: readonly string[]): IngredientSuitability {
    return keys.reduce<IngredientSuitability>((worst, key) => {
        const candidate = ingredientByKey(key).suitability;
        return SUITABILITY_RANK[candidate] > SUITABILITY_RANK[worst] ? candidate : worst;
    }, SUITABILITY_ORDER[0] ?? 'vegan');
}

/**
 * A recipe's classifications, derived from what is in it and from what it works out to.
 *
 * The energy-based tags (`high_protein`, `low_carb`, `keto`) are read off the *computed* per-serving
 * figures rather than asserted in the table, so a recipe cannot be tagged high-protein and then turn
 * out not to be.
 */
function classificationsFor(
    ingredientKeys: readonly string[],
    allergens: readonly AllergenCode[],
    nutrition: RecipeNutrition,
    extra: readonly DietClassification[],
): readonly DietClassification[] {
    const classifications = new Set<DietClassification>(extra);
    classifications.add('omnivore');
    classifications.add('halal_friendly');

    const suitability = suitabilityOf(ingredientKeys);
    if (suitability === 'vegan') {
        classifications.add('vegan');
        classifications.add('vegetarian');
        classifications.add('pescatarian');
    } else if (suitability === 'vegetarian') {
        classifications.add('vegetarian');
        classifications.add('pescatarian');
    } else if (suitability === 'pescatarian') {
        classifications.add('pescatarian');
    }

    const codes = new Set<string>(allergens);
    if (!codes.has('gluten')) classifications.add('gluten_free');
    if (!codes.has('milk')) classifications.add('dairy_free');
    if (!codes.has('tree_nut') && !codes.has('peanut')) classifications.add('nut_free');

    const protein = amountValue(nutrition.perServing, 'protein');
    const carbohydrate = amountValue(nutrition.perServing, 'carbohydrate');
    const fat = amountValue(nutrition.perServing, 'fat');
    const energy = amountValue(nutrition.perServing, 'energy');

    if (protein >= 25) classifications.add('high_protein');
    if (carbohydrate <= 30) classifications.add('low_carb');
    if (carbohydrate <= 15 && energy > 0 && (fat * 9) / energy >= 0.55) classifications.add('keto');

    return [...classifications];
}

export interface MakeRecipeOverrides {
    readonly name?: string | undefined;
    readonly version?: string | undefined;
    readonly servings?: number | undefined;
    readonly kitchenId?: KitchenId | null | undefined;
    readonly ingredients?: readonly IngredientQuantity[] | undefined;
    readonly steps?: readonly RecipeStep[] | undefined;
    readonly complexity?: number | undefined;
    readonly estimatedCost?: Money | null | undefined;
}

/** The version stamped on every recipe unless the table says otherwise. */
export const PROTOTYPE_RECIPE_VERSION = '2026.07.1';

/** Recipes a kitchen has since edited — proof the version is load-bearing, not decorative. */
const REVISED_RECIPES: Readonly<Record<string, string>> = {
    lemon_tahini_salmon: '2026.07.2',
    turkey_sweet_potato_hash: '2026.07.3',
};

export function makeRecipe(
    row: RecipeRow,
    ordinal: number,
    overrides: MakeRecipeOverrides = {},
): Recipe {
    const [
        key,
        name,
        description,
        mealTypes,
        cuisines,
        extraDiets,
        servings,
        servingLabel,
        ingredientRows,
        stepRows,
        preparationMinutes,
        cookingMinutes,
        complexity,
        kitchenKey,
    ] = row;

    const id: RecipeId = recipeIdAt(ordinal);
    const version = overrides.version ?? REVISED_RECIPES[key] ?? PROTOTYPE_RECIPE_VERSION;
    const ingredients =
        overrides.ingredients ??
        ingredientRows.map(([ingredientKey, grams]) =>
            makeIngredientQuantity(ingredientKey, grams),
        );

    const servingCount = overrides.servings ?? servings;
    const totalGrams = ingredients.reduce<number>(
        (sum, ingredient) => sum + (ingredient.optional ? 0 : (ingredient.grams ?? 0)),
        0,
    );
    const serving: Serving = makeServing({
        label: servingLabel,
        quantity: 1,
        unit: 'portion',
        grams: Math.round(totalGrams / servingCount),
    });

    const nutrition = recipeNutritionFromIngredients({
        recipeId: id,
        recipeVersion: version,
        servings: servingCount,
        serving,
        ingredients,
        derivation: {
            notes: [
                'Rolled up from the synthetic prototype ingredient table; no figure was entered by hand.',
            ],
        },
    });

    const allergens = unionAllergens(ingredients.map((ingredient) => ingredient.allergens));
    const ingredientKeys = ingredientRows.map(([ingredientKey]) => ingredientKey);

    const costs = ingredients.map((ingredient) => ingredient.estimatedCost);
    const estimatedCost =
        overrides.estimatedCost === undefined
            ? aed(costs.reduce<number>((sum, cost) => sum + (cost?.amount ?? 0), 0))
            : overrides.estimatedCost;

    const steps: readonly RecipeStep[] =
        overrides.steps ??
        stepRows.map(([instruction, minutes], index) => ({
            index: index + 1,
            instruction,
            minutes,
        }));

    return {
        id,
        version,
        name: overrides.name ?? name,
        slug: key.replace(/_/g, '-'),
        description,
        mealTypes,
        cuisines,
        dietClassifications: classificationsFor(ingredientKeys, allergens, nutrition, extraDiets),
        allergens,
        servings: servingCount,
        serving,
        ingredients,
        steps,
        preparationMinutes,
        cookingMinutes,
        complexity: overrides.complexity ?? complexity,
        nutrition,
        estimatedCost,
        imagePlaceholderId: `recipe-${key.replace(/_/g, '-')}`,
        kitchenId:
            overrides.kitchenId === undefined
                ? kitchenKey === null
                    ? null
                    : fromMapOrThrow(
                          new Map(Object.entries(PROTOTYPE_KITCHEN_IDS)),
                          kitchenKey,
                          'kitchen id',
                      )
                : overrides.kitchenId,
        updatedAt: PROTOTYPE_NOW,
    };
}

export const PROTOTYPE_RECIPES: readonly Recipe[] = ROWS.map((row, index) =>
    makeRecipe(row, index),
);

const BY_KEY: ReadonlyMap<string, Recipe> = new Map(
    ROWS.map((row, index) => [
        atOrThrow(row, 0, 'recipe key') as string,
        atOrThrow(PROTOTYPE_RECIPES, index, 'recipe'),
    ]),
);

const BY_ID: ReadonlyMap<string, Recipe> = new Map(
    PROTOTYPE_RECIPES.map((recipe) => [recipe.id, recipe]),
);

export function recipeByKey(key: string): Recipe {
    return fromMapOrThrow(BY_KEY, key, 'recipe');
}

export function recipeById(id: RecipeId): Recipe | null {
    return BY_ID.get(id) ?? null;
}

export function recipeAt(index: number): Recipe {
    return atOrThrow(PROTOTYPE_RECIPES, index, 'recipe');
}

/** The platform's own recipes — the ones a person cooks at home rather than a kitchen's version. */
export const HOME_RECIPES: readonly Recipe[] = PROTOTYPE_RECIPES.filter(
    (recipe) => recipe.kitchenId === null,
);

/** Total hands-on plus cooking time, which is what the planner's time filter actually means. */
export function totalRecipeMinutes(recipe: Recipe): number {
    return recipe.preparationMinutes + recipe.cookingMinutes;
}
