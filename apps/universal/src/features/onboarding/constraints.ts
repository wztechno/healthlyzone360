import type { RestrictionKind } from '@healthy360/domain-types';
import type { NutritionConstraint } from '@healthy360/nutrition';

import { RESTRICTION_DISPLAY_ORDER } from './steps.ts';
import type { OnboardingAnswers } from './state.ts';

/**
 * Turning twenty-two screens of answers into the seven kinds of constraint the rest of the product
 * honours.
 *
 * This module is the whole reason the onboarding taxonomy is worth having, so it is worth being
 * precise about what each column means.
 *
 * | kind | severity | source | who may lift it |
 * | --- | --- | --- | --- |
 * | `allergy` | `critical` | `user` | nobody — not the person, not a dietitian, not a confirmation |
 * | `dietitian_enforced` | `strict` | `dietitian` | only the dietitian who set it |
 * | `self_declared_medical` | `strict` | `user` | the person, but it flags the target for review |
 * | `intolerance` | `strict` | `user` | the person, per dish, by explicit confirmation |
 * | `religious` | `strict` | `user` | the person, per dish, by explicit confirmation |
 * | `preference` | `advisory` | `user` | nothing to lift — it ranks, it does not exclude |
 * | `dislike` | `advisory` | `user` | nothing to lift — it ranks, it does not exclude |
 *
 * Severity is not decoration. `@healthy360/nutrition`'s planner reads it, and the engine raises a
 * `safety_critical_restriction` review flag for any of the three kinds
 * `isSafetyCriticalRestriction` names. A dislike recorded as `strict` would quietly turn "I would
 * rather not" into "never, under any circumstances"; an allergy recorded as `advisory` would be a
 * safety defect. So the mapping is written once, here, and asserted by test.
 *
 * Nothing produced here carries a `note` in the person's own words: the notes on the *fixture*
 * constraints are a dietitian's or a fixture author's prose, and inventing one on the person's
 * behalf ("declared at onboarding, tolerated in small amounts") would be putting words in their
 * mouth about their own health. The interface says who supplied a constraint and how hard it bites,
 * and leaves the sentence to whoever actually wrote one.
 */

/** Translation key for a constraint's human label, by kind. Resolved at the call site. */
export function constraintLabelKey(kind: RestrictionKind, code: string): string {
    switch (kind) {
        case 'allergy':
            return `onboarding:allergens.${code}`;
        case 'intolerance':
            return `onboarding:intolerances.${code}`;
        case 'religious':
            return `onboarding:observances.${code}`;
        case 'self_declared_medical':
        case 'dietitian_enforced':
            return `onboarding:medicalTopics.${code}`;
        case 'dislike':
            return `onboarding:dislikes.${code}`;
        case 'preference':
            return `onboarding:diets.${code}`;
    }
}

interface ConstraintSeed {
    readonly kind: RestrictionKind;
    readonly codes: readonly string[];
    readonly severity: NutritionConstraint['severity'];
}

/**
 * The constraint set the calculation and the planner receive.
 *
 * `label` is the code itself rather than a translated string, and that is deliberate: a constraint
 * travels to the backend, into a stored `NutritionTargetRequest` and back out again, and a label
 * frozen in the language the person happened to be using at the time would resurface in the wrong
 * language for the rest of the account's life. The interface translates at render time from
 * `constraintLabelKey`; the contract carries the stable code.
 */
export function buildConstraints(answers: OnboardingAnswers): readonly NutritionConstraint[] {
    const seeds: readonly ConstraintSeed[] = [
        { kind: 'allergy', codes: answers.allergies, severity: 'critical' },
        { kind: 'intolerance', codes: answers.intolerances, severity: 'strict' },
        { kind: 'religious', codes: answers.observances, severity: 'strict' },
        { kind: 'self_declared_medical', codes: answers.selfDeclaredMedical, severity: 'strict' },
        { kind: 'dislike', codes: answers.dislikedIngredients, severity: 'advisory' },
        {
            kind: 'preference',
            codes: answers.diet === null ? [] : [answers.diet],
            severity: 'advisory',
        },
    ];

    return seeds.flatMap((seed) =>
        seed.codes.map((code): NutritionConstraint => ({
            kind: seed.kind,
            code,
            label: code,
            severity: seed.severity,
            source: 'user',
            note: null,
        })),
    );
}

/**
 * The full set the summary shows: everything the person supplied, plus everything a dietitian set.
 *
 * The two arrive from different places and must not be merged before this point. The person's
 * answers are local state; the dietitian's are read from the stored target's request through the
 * repository, are not editable here, and would be lost if the wizard simply overwrote the
 * constraint list with its own.
 */
export function mergeConstraints(
    fromAnswers: readonly NutritionConstraint[],
    enforced: readonly NutritionConstraint[],
): readonly NutritionConstraint[] {
    return [
        ...enforced.filter((constraint) => constraint.kind === 'dietitian_enforced'),
        ...fromAnswers,
    ];
}

/** The `dietitian_enforced` constraints carried by a stored target's request, if any. */
export function enforcedConstraintsOf(
    constraints: readonly NutritionConstraint[] | undefined,
): readonly NutritionConstraint[] {
    return (constraints ?? []).filter((constraint) => constraint.kind === 'dietitian_enforced');
}

export interface RestrictionGroup {
    readonly kind: RestrictionKind;
    readonly constraints: readonly NutritionConstraint[];
}

/**
 * The seven groups, in display order, **always all seven**.
 *
 * An empty group is rendered as "none recorded" rather than dropped. That is the point of the
 * screen: a person reviewing what the product believes about their eating has to be able to see
 * that it believes they have no allergies, and a group that vanishes when empty cannot say that.
 * It is also what makes "are these seven really distinct?" checkable by a test rather than by
 * whoever happens to have filled every field in.
 */
export function groupByRestrictionKind(
    constraints: readonly NutritionConstraint[],
): readonly RestrictionGroup[] {
    return RESTRICTION_DISPLAY_ORDER.map((kind) => ({
        kind,
        constraints: constraints.filter((constraint) => constraint.kind === kind),
    }));
}

/** Kinds the engine treats as grounds for professional review, for the warning step's copy. */
export function safetyCriticalKinds(
    constraints: readonly NutritionConstraint[],
): readonly RestrictionKind[] {
    const present = new Set(constraints.map((constraint) => constraint.kind));
    return (['allergy', 'dietitian_enforced', 'self_declared_medical'] as const).filter((kind) =>
        present.has(kind),
    );
}
