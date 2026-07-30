import type { DietitianId, KitchenId, Locale } from '@healthy360/domain-types';

import type { DietCategory, Dietitian } from '../../../contracts/marketplace.ts';
import { atOrThrow, fromMapOrThrow } from '../constants.ts';
import { dietitianIdAt } from '../ids.ts';
import { PROTOTYPE_KITCHEN_IDS } from './kitchens.ts';
import { PROTOTYPE_MEALS } from './meals.ts';
import { PROTOTYPE_PLANS } from './plans.ts';

/**
 * Five dietitian profiles, and the diet-category navigation.
 *
 * Every registration below is explicitly marked as a prototype record. A credential is the one
 * thing on a professional's profile that a person is entitled to take literally, so a synthetic
 * profile that carried a realistic-looking registration number would be the single most misleading
 * string in the whole data set. `Dietitian.credentials` says what it is.
 *
 * The first profile is Layla Haddad — the same person the mock store already signs in as the Cedar
 * Clinic dietitian — so the review queue a professional opens is about clients of somebody who
 * exists in the foundation world rather than a seventh name nobody has met.
 */

type DietitianRow = readonly [
    key: string,
    displayName: string,
    headline: string,
    biography: string,
    credentials: readonly string[],
    specialisms: readonly string[],
    locales: readonly Locale[],
    kitchenKeys: readonly string[],
    acceptingClients: boolean,
    rating: number | null,
    ratingCount: number,
];

const ROWS: readonly DietitianRow[] = [
    [
        'layla_haddad',
        'Layla Haddad',
        'Clinical dietitian working with weight management and metabolic health',
        'Works with people who have been given a target by a doctor and no idea what to do with ' +
            'it. Reviews prototype plans for energy and protein adequacy before they are followed.',
        ['Registered Dietitian — prototype registry entry PRD-0001 (synthetic record)'],
        ['Weight management', 'Metabolic health', 'Plan review'],
        ['en', 'ar'],
        ['verdant'],
        true,
        4.8,
        96,
    ],
    [
        'karim_nassar',
        'Karim Nassar',
        'Sports dietitian for strength and endurance athletes',
        'Focuses on people training four or more times a week, where the difficulty is eating ' +
            'enough rather than eating less.',
        ['Registered Dietitian — prototype registry entry PRD-0002 (synthetic record)'],
        ['Sports nutrition', 'Muscle gain', 'Endurance fuelling'],
        ['en'],
        ['riverstone'],
        true,
        4.7,
        64,
    ],
    [
        'maya_darwish',
        'Maya Darwish',
        'Paediatric and family nutrition',
        'Works with households rather than individuals, and with the practical question of what a ' +
            'family will actually sit down and eat.',
        ['Registered Dietitian — prototype registry entry PRD-0003 (synthetic record)'],
        ['Family nutrition', 'Fussy eating', 'Meal structure'],
        ['en', 'ar'],
        ['daily_pot'],
        false,
        4.6,
        41,
    ],
    [
        'hala_rizk',
        'Hala Rizk',
        'Plant-based nutrition and adequacy review',
        'Reviews plant-based plans for protein, iron, calcium and vitamin adequacy, and writes the ' +
            'substitutions people need rather than a list of what to avoid.',
        ['Registered Dietitian — prototype registry entry PRD-0004 (synthetic record)'],
        ['Plant-based nutrition', 'Micronutrient adequacy', 'Vegan transitions'],
        ['en'],
        ['verdant', 'saffron'],
        true,
        4.9,
        58,
    ],
    [
        'tarek_shammas',
        'Tarek Shammas',
        'Allergy, intolerance and exclusion diets',
        'Specialises in plans that have to exclude something — an allergen, an intolerance, or a ' +
            'restriction another clinician has set — without quietly leaving a nutrient behind.',
        ['Registered Dietitian — prototype registry entry PRD-0005 (synthetic record)'],
        ['Allergy management', 'Exclusion diets', 'Coeliac support'],
        ['en', 'ar'],
        ['saffron', 'riverstone'],
        true,
        4.5,
        37,
    ],
];

export interface MakeDietitianOverrides {
    readonly displayName?: string | undefined;
    readonly acceptingClients?: boolean | undefined;
    readonly kitchenIds?: readonly KitchenId[] | undefined;
    readonly rating?: number | null | undefined;
    readonly ratingCount?: number | undefined;
}

export function makeDietitian(
    row: DietitianRow,
    ordinal: number,
    overrides: MakeDietitianOverrides = {},
): Dietitian {
    const [
        key,
        displayName,
        headline,
        biography,
        credentials,
        specialisms,
        locales,
        kitchenKeys,
        acceptingClients,
        rating,
        ratingCount,
    ] = row;

    return {
        id: dietitianIdAt(ordinal),
        displayName: overrides.displayName ?? displayName,
        headline,
        biography,
        credentials,
        specialisms,
        locales,
        countryCode: 'AE',
        kitchenIds:
            overrides.kitchenIds ??
            kitchenKeys.map((kitchenKey) =>
                fromMapOrThrow(
                    new Map(Object.entries(PROTOTYPE_KITCHEN_IDS)),
                    kitchenKey,
                    'kitchen id',
                ),
            ),
        acceptingClients: overrides.acceptingClients ?? acceptingClients,
        imagePlaceholderId: `dietitian-${key.replace(/_/g, '-')}`,
        rating: overrides.rating === undefined ? rating : overrides.rating,
        ratingCount: overrides.ratingCount ?? ratingCount,
    };
}

export const PROTOTYPE_DIETITIANS: readonly Dietitian[] = ROWS.map((row, index) =>
    makeDietitian(row, index),
);

const BY_KEY: ReadonlyMap<string, Dietitian> = new Map(
    ROWS.map((row, index) => [
        atOrThrow(row, 0, 'dietitian key') as string,
        atOrThrow(PROTOTYPE_DIETITIANS, index, 'dietitian'),
    ]),
);

export function dietitianByKey(key: string): Dietitian {
    return fromMapOrThrow(BY_KEY, key, 'dietitian');
}

export function dietitianById(id: DietitianId): Dietitian | null {
    return PROTOTYPE_DIETITIANS.find((dietitian) => dietitian.id === id) ?? null;
}

/* ------------------------------------------------------------------------------------------------
 * Diet categories
 * ---------------------------------------------------------------------------------------------- */

type CategoryRow = readonly [
    slug: string,
    name: string,
    description: string,
    classification: DietCategory['classification'],
];

// prettier-ignore
const CATEGORY_ROWS: readonly CategoryRow[] = [
    ['balanced', 'Balanced', 'No single restriction — three meals and a snack, portioned to a target.', 'omnivore'],
    ['plant-based', 'Plant based', 'Entirely plant-derived, with the protein figure stated on every meal.', 'vegan'],
    ['vegetarian', 'Vegetarian', 'No meat or fish; dairy and eggs are used.', 'vegetarian'],
    ['pescatarian', 'Pescatarian', 'Fish and shellfish, with no meat or poultry.', 'pescatarian'],
    ['high-protein', 'High protein', 'Built around a protein floor per kilogram of body mass.', 'high_protein'],
    ['low-carb', 'Lower carbohydrate', 'Carbohydrate held down while protein stays high. Not a ketogenic plan.', 'low_carb'],
    ['mediterranean', 'Mediterranean', 'Vegetables, pulses, olive oil and fish, in that order of weight.', 'mediterranean'],
    ['gluten-free', 'Gluten free', 'No cereals containing gluten in any component of the meal.', 'gluten_free'],
    ['dairy-free', 'Dairy free', 'No milk or anything made from it, including in dressings.', 'dairy_free'],
    ['weight-management', 'Weight management', 'A controlled deficit with the tolerance band shown alongside.', null],
    ['family', 'Family', 'Dinner for a household, with portions that scale rather than repeat.', null],
    ['office', 'Office', 'One meal a day to one address, on working days only.', null],
    ['muscle-gain', 'Muscle gain', 'A bounded surplus with protein set per kilogram of body mass.', 'high_protein'],
];

export function makeDietCategory(row: CategoryRow): DietCategory {
    const [slug, name, description, classification] = row;
    const planCount = PROTOTYPE_PLANS.filter((plan) => plan.categorySlugs.includes(slug)).length;
    const mealCount =
        classification === null
            ? 0
            : PROTOTYPE_MEALS.filter((meal) => meal.dietClassifications.includes(classification))
                  .length;

    return {
        slug,
        name,
        description,
        classification,
        planCount,
        mealCount,
        imagePlaceholderId: `diet-${slug}`,
    };
}

export const PROTOTYPE_DIET_CATEGORIES: readonly DietCategory[] =
    CATEGORY_ROWS.map(makeDietCategory);

export function dietCategoryBySlug(slug: string): DietCategory | null {
    return PROTOTYPE_DIET_CATEGORIES.find((category) => category.slug === slug) ?? null;
}
