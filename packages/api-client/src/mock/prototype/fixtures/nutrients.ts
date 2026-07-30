import { CORE_NUTRIENT_DEFINITIONS } from '@healthy360/nutrition';
import type {
    NutrientAmount,
    NutrientDefinition,
    NutritionBasis,
    NutritionCalculation,
    NutritionFacts,
    NutritionValueKind,
    Serving,
    ToleranceRange,
} from '@healthy360/nutrition';

import { PROTOTYPE_NOW, SYNTHETIC_SOURCE, atOrThrow } from '../constants.ts';

/**
 * The nutrient catalogue the prototype renders.
 *
 * `CORE_NUTRIENT_DEFINITIONS` is deliberately small in `@healthy360/nutrition` — it is a
 * *definition*, not a data set — so the micronutrients the facts panel shows are added here, where
 * a data set belongs. Five of them, chosen because they are the ones a meal-planning product is
 * actually asked about; adding forty would make the panel unreadable and the fixtures unmaintainable.
 */
const MICRONUTRIENT_DEFINITIONS: readonly NutrientDefinition[] = [
    {
        id: 'calcium',
        group: 'mineral',
        unit: 'mg',
        displayName: 'Calcium',
        precision: 0,
        isCore: false,
        targetDirection: 'at_least',
    },
    {
        id: 'iron',
        group: 'mineral',
        unit: 'mg',
        displayName: 'Iron',
        precision: 1,
        isCore: false,
        targetDirection: 'at_least',
    },
    {
        id: 'potassium',
        group: 'mineral',
        unit: 'mg',
        displayName: 'Potassium',
        precision: 0,
        isCore: false,
        targetDirection: 'at_least',
    },
    {
        id: 'vitamin_c',
        group: 'vitamin',
        unit: 'mg',
        displayName: 'Vitamin C',
        precision: 1,
        isCore: false,
        targetDirection: 'at_least',
    },
    {
        id: 'vitamin_d',
        group: 'vitamin',
        unit: 'ug',
        displayName: 'Vitamin D',
        precision: 1,
        isCore: false,
        targetDirection: 'at_least',
    },
];

export const PROTOTYPE_NUTRIENT_DEFINITIONS: readonly NutrientDefinition[] = [
    ...CORE_NUTRIENT_DEFINITIONS,
    ...MICRONUTRIENT_DEFINITIONS,
];

const DEFINITIONS_BY_ID: ReadonlyMap<string, NutrientDefinition> = new Map(
    PROTOTYPE_NUTRIENT_DEFINITIONS.map((definition) => [definition.id, definition]),
);

export function prototypeNutrientDefinition(nutrientId: string): NutrientDefinition | null {
    return DEFINITIONS_BY_ID.get(nutrientId) ?? null;
}

/** The nutrients every set of prototype facts carries, in label order. */
export const MANDATORY_NUTRIENT_IDS: readonly string[] = [
    'energy',
    'protein',
    'carbohydrate',
    'fat',
    'fibre',
    'sugars',
    'saturated_fat',
    'sodium',
];

/** Micronutrients a fixture may add on top of the mandatory eight. */
export const OPTIONAL_NUTRIENT_IDS: readonly string[] = MICRONUTRIENT_DEFINITIONS.map(
    (definition) => definition.id,
);

/* ------------------------------------------------------------------------------------------------
 * Builders
 * ---------------------------------------------------------------------------------------------- */

export interface MakeAmountOptions {
    readonly kind?: NutritionValueKind | undefined;
    readonly tolerance?: ToleranceRange | null | undefined;
}

/** One nutrient amount, with the unit taken from the catalogue rather than restated by the caller. */
export function makeAmount(
    nutrientId: string,
    value: number,
    options: MakeAmountOptions = {},
): NutrientAmount {
    const definition = prototypeNutrientDefinition(nutrientId);
    return {
        nutrientId,
        unit: definition?.unit ?? 'g',
        value,
        kind: options.kind ?? 'planned',
        tolerance: options.tolerance ?? null,
    };
}

export interface MakeCalculationOptions {
    readonly method?: string | undefined;
    readonly basis?: NutritionBasis | undefined;
    readonly notes?: readonly string[] | undefined;
}

/** Provenance for a hand-authored fixture: prototype, synthetic, and honest about being both. */
export function makeSyntheticCalculation(
    options: MakeCalculationOptions = {},
): NutritionCalculation {
    return {
        method: options.method ?? 'fixture.synthetic_reference',
        basis: options.basis ?? 'per_100g',
        calculatedAt: PROTOTYPE_NOW,
        prototype: true,
        rounding:
            'Authored to the display precision of each nutrient; no further rounding applied.',
        notes: options.notes ?? [
            'Plausible synthetic values authored for the prototype. They describe no real product.',
        ],
    };
}

export interface MakeFactsOptions {
    readonly basis?: NutritionBasis | undefined;
    readonly kind?: NutritionValueKind | undefined;
    readonly serving?: Serving | null | undefined;
    readonly totalGrams?: number | null | undefined;
    readonly method?: string | undefined;
    readonly notes?: readonly string[] | undefined;
}

/**
 * A complete facts set from a nutrient → value map.
 *
 * Every set produced here carries {@link SYNTHETIC_SOURCE}; there is no parameter to override it,
 * which is the mechanism by which "all fixtures are labelled synthetic" survives a careless edit.
 */
export function makeFacts(
    values: Readonly<Record<string, number>>,
    options: MakeFactsOptions = {},
): NutritionFacts {
    const basis = options.basis ?? 'per_100g';
    const ordered = [...MANDATORY_NUTRIENT_IDS, ...OPTIONAL_NUTRIENT_IDS];
    const amounts: NutrientAmount[] = [];

    for (const nutrientId of ordered) {
        const value = values[nutrientId];
        if (value === undefined) {
            // Mandatory nutrients are always stated, even at zero: an absent line on a label reads
            // as "unknown", and every figure in this data set is known.
            if (MANDATORY_NUTRIENT_IDS.includes(nutrientId)) {
                amounts.push(makeAmount(nutrientId, 0, { kind: options.kind ?? 'planned' }));
            }
            continue;
        }
        amounts.push(makeAmount(nutrientId, value, { kind: options.kind ?? 'planned' }));
    }

    return {
        basis,
        kind: options.kind ?? 'planned',
        serving: options.serving ?? null,
        totalGrams: options.totalGrams === undefined ? null : options.totalGrams,
        amounts,
        source: SYNTHETIC_SOURCE,
        calculation: makeSyntheticCalculation({
            basis,
            ...(options.method === undefined ? {} : { method: options.method }),
            ...(options.notes === undefined ? {} : { notes: options.notes }),
        }),
    };
}

export interface MakeServingOptions {
    readonly label?: string | undefined;
    readonly quantity?: number | undefined;
    readonly unit?: Serving['unit'] | undefined;
    readonly grams?: number | null | undefined;
    readonly millilitres?: number | null | undefined;
    readonly householdMeasure?: string | null | undefined;
}

export function makeServing(options: MakeServingOptions = {}): Serving {
    return {
        label: options.label ?? '1 portion',
        quantity: options.quantity ?? 1,
        unit: options.unit ?? 'portion',
        grams: options.grams === undefined ? null : options.grams,
        millilitres: options.millilitres === undefined ? null : options.millilitres,
        householdMeasure: options.householdMeasure === undefined ? null : options.householdMeasure,
    };
}

/** The nutrient at a catalogue position — used by the showcase tables and by the id test. */
export function nutrientDefinitionAt(index: number): NutrientDefinition {
    return atOrThrow(PROTOTYPE_NUTRIENT_DEFINITIONS, index, 'nutrient definition');
}
