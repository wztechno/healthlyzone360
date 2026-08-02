import type { AllergenDeclaration, AllergenSeverity, DietaryProfile } from './repositories-shim.ts';

/**
 * The allergy declaration's rules, as functions rather than as branches inside a screen.
 *
 * Everything here is pure and testable without a rendered tree, which is the same split the
 * commerce feature uses (`features/commerce/configurator.ts`). It exists mostly so that the one
 * genuinely load-bearing decision on the allergies screen — *"has this person answered the question
 * at all?"* — is written once and named.
 */

/**
 * The three severities, restated.
 *
 * `contracts/account.ts` declares `ALLERGEN_SEVERITIES` and the contracts module is not exported
 * from the package yet (see `./repositories-shim.ts`), so the array is restated here while the type
 * is still derived from the contract. When the integrator wave exports the contracts, this becomes
 * a re-export and the `satisfies` below stops it having drifted in the meantime.
 */
export const ALLERGEN_SEVERITIES = [
    'avoidance',
    'intolerance',
    'allergy',
] as const satisfies readonly AllergenSeverity[];

/** Only a declared `allergy` is a hard exclusion; the other two are filters a person may pass. */
export function isHardExclusion(declaration: AllergenDeclaration): boolean {
    return declaration.severity === 'allergy';
}

/**
 * Whether the person has answered the allergy question, as distinct from having any allergies.
 *
 * The distinction is the whole reason the screen has a Yes/No branch. "I have no allergies" is an
 * *answer* — it completes the step, it is what the configurator relies on to stop asking, and it is
 * a decision somebody made. An empty profile that has never been saved is not that; it is silence.
 * `updatedAt` is the only field that tells the two apart, which is why the screen reads it rather
 * than counting the declarations.
 */
export function hasAnsweredAllergyQuestion(profile: DietaryProfile): boolean {
    return profile.updatedAt !== null;
}

/** The Yes/No branch's initial position: `null` until the person has answered. */
export function initialAllergyAnswer(profile: DietaryProfile): boolean | null {
    if (!hasAnsweredAllergyQuestion(profile)) return null;
    return profile.allergens.length > 0;
}

/**
 * The declarations to save for a given answer.
 *
 * Answering "no" clears the list rather than leaving it alone: a person who ticked peanuts, changed
 * their mind and answered "no allergies" has said something specific, and a save that kept the
 * peanut row would contradict them. The edited list is kept in component state either way, so
 * flipping back to "yes" within the same visit does not lose their work.
 */
export function declarationsFor(
    hasAllergies: boolean,
    edited: readonly AllergenDeclaration[],
): readonly AllergenDeclaration[] {
    return hasAllergies ? edited : [];
}
