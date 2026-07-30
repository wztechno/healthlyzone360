import { AllergenCode } from '@healthy360/domain-types';

/**
 * The fourteen allergen codes the prototype declares.
 *
 * These are the allergen groups food-labelling regimes in the EU, the UK and the GCC require to be
 * declared. Using them is not borrowing from any product: they are the published regulatory
 * vocabulary, and a meal-planning product that invented its own would be unable to talk to a kitchen
 * or to a person's allergy card.
 *
 * `AllergenCode` is a code identifier rather than a UUID (`@healthy360/domain-types`), because a
 * fixture, a translation key and a kitchen's data-entry form all have to agree on the literal string.
 */
export interface PrototypeAllergen {
    readonly code: AllergenCode;
    /** British-English display name. Localised copy lives in `@healthy360/i18n`, keyed by `code`. */
    readonly displayName: string;
    /** One line a person can act on, shown under the allergen chip. */
    readonly description: string;
    /** True for the groups a trace exposure can be dangerous for. Drives the strongest warning. */
    readonly severeByDefault: boolean;
}

// prettier-ignore
const ROWS: readonly (readonly [string, string, string, boolean])[] = [
    ['gluten', 'Cereals containing gluten', 'Wheat, rye, barley, oats and spelt.', false],
    ['crustaceans', 'Crustaceans', 'Prawns, crab, lobster and langoustine.', true],
    ['egg', 'Eggs', 'Hen eggs and anything made with them, including mayonnaise.', true],
    ['fish', 'Fish', 'All finned fish, and stocks or sauces made from them.', true],
    ['peanut', 'Peanuts', 'Groundnuts, peanut butter and peanut oil.', true],
    ['soy', 'Soybeans', 'Tofu, tempeh, edamame, soy sauce and soy protein.', false],
    ['milk', 'Milk', 'Dairy milk and everything made from it, including lactose.', false],
    ['tree_nut', 'Tree nuts', 'Almonds, walnuts, pistachios, cashews and hazelnuts.', true],
    ['celery', 'Celery', 'Stalks, leaves, seeds and celeriac, including in stock.', false],
    ['mustard', 'Mustard', 'Mustard seed, powder, paste and prepared mustards.', false],
    ['sesame', 'Sesame', 'Sesame seeds, tahini and sesame oil.', true],
    ['sulphites', 'Sulphur dioxide and sulphites', 'Above 10 mg per kilogram or litre.', false],
    ['lupin', 'Lupin', 'Lupin flour and seeds, sometimes used in baking.', false],
    ['mollusc', 'Molluscs', 'Squid, mussels, clams, oysters and snails.', true],
];

function makeAllergen(row: (typeof ROWS)[number]): PrototypeAllergen {
    const [code, displayName, description, severeByDefault] = row;
    return {
        code: AllergenCode.parse(code),
        displayName,
        description,
        severeByDefault,
    };
}

export const PROTOTYPE_ALLERGENS: readonly PrototypeAllergen[] = ROWS.map(makeAllergen);

export const PROTOTYPE_ALLERGEN_CODES: readonly AllergenCode[] = PROTOTYPE_ALLERGENS.map(
    (allergen) => allergen.code,
);

const BY_CODE: ReadonlyMap<string, PrototypeAllergen> = new Map(
    PROTOTYPE_ALLERGENS.map((allergen) => [allergen.code, allergen]),
);

export function prototypeAllergen(code: string): PrototypeAllergen | null {
    return BY_CODE.get(code) ?? null;
}

/** Narrows a raw string to a declared allergen code, or throws — used when reading fixture tables. */
export function allergenCode(code: string): AllergenCode {
    const allergen = BY_CODE.get(code);
    if (allergen === undefined) {
        throw new Error(`"${code}" is not one of the fourteen declared allergen groups.`);
    }
    return allergen.code;
}

/** Sorted, de-duplicated union — how a recipe's allergen list is derived from its ingredients. */
export function unionAllergens(
    lists: readonly (readonly AllergenCode[])[],
): readonly AllergenCode[] {
    const seen = new Set<string>();
    for (const list of lists) for (const code of list) seen.add(code);
    return PROTOTYPE_ALLERGEN_CODES.filter((code) => seen.has(code));
}
