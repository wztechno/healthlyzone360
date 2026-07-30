import type { RestrictionKind } from '@healthy360/domain-types';

/**
 * The internal meal planner, **as a design** (Prompt 2, "Original internal planner preparation").
 *
 * This module declares *what* the planner must respect. It contains no solver, no search and no
 * generation: the prompt asks for the preparation, not the implementation, and a half-written
 * solver would be worse than none because screens would start to depend on it.
 *
 * Nothing here is reverse-engineered. The hard constraints are the ones the product's own safety
 * and commercial rules require; the soft preferences are the ones our onboarding actually collects.
 */

/** Where in the plan a rule is evaluated. */
export const CONSTRAINT_SCOPES = ['entry', 'day', 'week', 'kitchen'] as const;
export type ConstraintScope = (typeof CONSTRAINT_SCOPES)[number];

/** Who, if anyone, may set a rule aside. */
export const OVERRIDE_POLICIES = ['never', 'professional_only', 'user_confirmed'] as const;
export type OverridePolicy = (typeof OVERRIDE_POLICIES)[number];

/**
 * A rule a candidate must satisfy to be eligible at all.
 *
 * Hard constraints are filters, never penalties. A meal that violates one is removed from the
 * candidate set; it is never merely ranked lower, because a sufficiently attractive meal would
 * then win on score and be served to somebody who is allergic to it.
 */
export interface PlannerHardConstraint {
    readonly id: string;
    readonly label: string;
    readonly description: string;
    readonly scopes: readonly ConstraintScope[];
    /** The failure surfaced to the UI when the constraint eliminates every candidate. */
    readonly violationCode: string;
    readonly overridePolicy: OverridePolicy;
    /** Restriction kinds that feed this constraint; empty when it is not restriction-driven. */
    readonly restrictionKinds: readonly RestrictionKind[];
}

export const PLANNER_HARD_CONSTRAINTS: readonly PlannerHardConstraint[] = [
    {
        id: 'allergies',
        label: 'Allergies',
        description:
            'Any candidate containing a declared allergen, or produced on a line the kitchen ' +
            'declares as cross-contaminating for it, is ineligible. No score can outweigh this.',
        scopes: ['entry'],
        violationCode: 'planner.allergen_conflict',
        overridePolicy: 'never',
        restrictionKinds: ['allergy'],
    },
    {
        id: 'medical_restrictions',
        label: 'Self-declared medical restrictions',
        description:
            'Restrictions a person has recorded about their own health. Honoured as a filter, and ' +
            'the plan is flagged for professional review rather than quietly generated around them.',
        scopes: ['entry', 'day'],
        violationCode: 'planner.medical_restriction_conflict',
        overridePolicy: 'professional_only',
        restrictionKinds: ['self_declared_medical'],
    },
    {
        id: 'dietitian_enforced_restrictions',
        label: 'Dietitian-enforced restrictions',
        description:
            'Restrictions set by the person’s dietitian. Only that dietitian may lift them; the ' +
            'person cannot, and neither can the planner by finding no alternative.',
        scopes: ['entry', 'day', 'week'],
        violationCode: 'planner.dietitian_restriction_conflict',
        overridePolicy: 'professional_only',
        restrictionKinds: ['dietitian_enforced'],
    },
    {
        id: 'prohibited_ingredients',
        label: 'Prohibited ingredients',
        description:
            'Ingredients excluded for intolerance or religious reasons. The person may confirm an ' +
            'exception explicitly, and the confirmation is recorded on the entry.',
        scopes: ['entry'],
        violationCode: 'planner.prohibited_ingredient',
        overridePolicy: 'user_confirmed',
        restrictionKinds: ['intolerance', 'religious'],
    },
    {
        id: 'diet_classification',
        label: 'Diet classification',
        description:
            'The candidate must satisfy the selected classification — a vegan plan admits no ' +
            'animal-derived ingredient, a keto plan respects its carbohydrate ceiling.',
        scopes: ['entry', 'day'],
        violationCode: 'planner.diet_conflict',
        overridePolicy: 'user_confirmed',
        restrictionKinds: ['preference'],
    },
    {
        id: 'calorie_boundaries',
        label: 'Calorie boundaries',
        description:
            'A day must land inside the energy tolerance band of the person’s target, and a single ' +
            'entry may not exceed its share of the day by more than the configured slack.',
        scopes: ['entry', 'day'],
        violationCode: 'planner.energy_out_of_range',
        overridePolicy: 'user_confirmed',
        restrictionKinds: [],
    },
    {
        id: 'macro_boundaries',
        label: 'Macronutrient boundaries',
        description:
            'Protein, carbohydrate and fat must each land inside their tolerance band across the ' +
            'day. Protein is a floor; the other two are bands.',
        scopes: ['day', 'week'],
        violationCode: 'planner.macros_out_of_range',
        overridePolicy: 'user_confirmed',
        restrictionKinds: [],
    },
    {
        id: 'meal_type',
        label: 'Meal type',
        description:
            'A candidate must be offered for the slot it is placed in: a kitchen’s breakfast item ' +
            'does not become a dinner because the arithmetic happens to work.',
        scopes: ['entry'],
        violationCode: 'planner.meal_type_mismatch',
        overridePolicy: 'user_confirmed',
        restrictionKinds: [],
    },
    {
        id: 'availability',
        label: 'Availability',
        description:
            'The item must be orderable on the target date — published, in season, not sold out ' +
            'and not past the kitchen’s cut-off time for that day.',
        scopes: ['entry', 'day'],
        violationCode: 'planner.unavailable',
        overridePolicy: 'never',
        restrictionKinds: [],
    },
    {
        id: 'serving_constraints',
        label: 'Serving constraints',
        description:
            'Portion adjustments must stay inside the range the kitchen or recipe supports. A meal ' +
            'sold as one sealed portion cannot be planned at 0.6 of one.',
        scopes: ['entry'],
        violationCode: 'planner.serving_out_of_range',
        overridePolicy: 'never',
        restrictionKinds: [],
    },
    {
        id: 'kitchen_delivery_area',
        label: 'Kitchen delivery area',
        description:
            'A kitchen-prepared entry is only eligible when the person’s delivery address falls ' +
            'inside one of that kitchen’s delivery zones.',
        scopes: ['entry', 'kitchen'],
        violationCode: 'planner.outside_delivery_area',
        overridePolicy: 'never',
        restrictionKinds: [],
    },
    {
        id: 'kitchen_operating_schedule',
        label: 'Kitchen operating schedule',
        description:
            'The kitchen must be operating, and accepting orders for the requested slot, on the ' +
            'target date — including its published closures.',
        scopes: ['entry', 'day', 'kitchen'],
        violationCode: 'planner.kitchen_closed',
        overridePolicy: 'never',
        restrictionKinds: [],
    },
    {
        id: 'budget_ceiling',
        label: 'Budget ceiling',
        description:
            'The estimated cost of a day, and of the week, must stay within the person’s stated ' +
            'ceiling. Costs are compared in a single currency; a mixed-currency plan is a defect.',
        scopes: ['day', 'week'],
        violationCode: 'planner.over_budget',
        overridePolicy: 'user_confirmed',
        restrictionKinds: [],
    },
];

/** Direction a soft signal is optimised in. */
export const PREFERENCE_DIRECTIONS = ['maximise', 'minimise'] as const;
export type PreferenceDirection = (typeof PREFERENCE_DIRECTIONS)[number];

/**
 * A signal that ranks the candidates a hard constraint has already admitted.
 *
 * `defaultWeight` values are a *starting point for tuning*, not a discovered optimum. They sum to
 * 1 so that a score is directly readable as "how well does this fit, out of one".
 */
export interface PlannerSoftPreference {
    readonly id: string;
    readonly label: string;
    readonly description: string;
    readonly defaultWeight: number;
    readonly direction: PreferenceDirection;
    readonly scope: ConstraintScope;
}

export const PLANNER_SOFT_PREFERENCES: readonly PlannerSoftPreference[] = [
    {
        id: 'cuisine_match',
        label: 'Preferred cuisines',
        description: 'How well the candidate matches the cuisines the person chose in onboarding.',
        defaultWeight: 0.12,
        direction: 'maximise',
        scope: 'entry',
    },
    {
        id: 'favourite_foods',
        label: 'Favourite foods',
        description: 'Presence of ingredients or dishes the person has marked as favourites.',
        defaultWeight: 0.1,
        direction: 'maximise',
        scope: 'entry',
    },
    {
        id: 'dislikes',
        label: 'Dislikes',
        description:
            'Presence of disliked ingredients. A dislike is a penalty rather than a filter — that ' +
            'is precisely what separates it from an intolerance.',
        defaultWeight: 0.12,
        direction: 'minimise',
        scope: 'entry',
    },
    {
        id: 'variety',
        label: 'Variety',
        description: 'Spread of cuisines, protein sources and preparation styles across the week.',
        defaultWeight: 0.1,
        direction: 'maximise',
        scope: 'week',
    },
    {
        id: 'cost',
        label: 'Cost',
        description:
            'Estimated cost against the person’s budget, once the hard ceiling is satisfied. Below ' +
            'the ceiling, cheaper is better but not at any price in the other signals.',
        defaultWeight: 0.12,
        direction: 'minimise',
        scope: 'day',
    },
    {
        id: 'preparation_time',
        label: 'Preparation time',
        description:
            'Hands-on time against the cooking availability the person declared for that day.',
        defaultWeight: 0.1,
        direction: 'minimise',
        scope: 'day',
    },
    {
        id: 'pantry_use',
        label: 'Pantry use',
        description: 'Proportion of the ingredients the person already has at home.',
        defaultWeight: 0.07,
        direction: 'maximise',
        scope: 'day',
    },
    {
        id: 'ingredient_reuse',
        label: 'Ingredient reuse',
        description:
            'Overlap of perishable ingredients across the week, which shortens the grocery list ' +
            'and reduces waste.',
        defaultWeight: 0.07,
        direction: 'maximise',
        scope: 'week',
    },
    {
        id: 'kitchen_preference',
        label: 'Kitchen preference',
        description: 'Preference for kitchens the person has chosen, ordered from or rated well.',
        defaultWeight: 0.06,
        direction: 'maximise',
        scope: 'entry',
    },
    {
        id: 'delivery_convenience',
        label: 'Delivery convenience',
        description:
            'Fewer distinct deliveries and slots per day, and slots inside the person’s stated ' +
            'availability.',
        defaultWeight: 0.05,
        direction: 'maximise',
        scope: 'day',
    },
    {
        id: 'recipe_complexity',
        label: 'Recipe complexity',
        description:
            'Step count and technique against the complexity the person is comfortable with.',
        defaultWeight: 0.05,
        direction: 'minimise',
        scope: 'entry',
    },
    {
        id: 'repetition_avoidance',
        label: 'Repetition avoidance',
        description:
            'Distance since the same dish last appeared. Deliberately separate from variety: a ' +
            'week can be varied in cuisine and still repeat one dish four times.',
        defaultWeight: 0.04,
        direction: 'minimise',
        scope: 'week',
    },
];

const HARD_CONSTRAINTS_BY_ID: ReadonlyMap<string, PlannerHardConstraint> = new Map(
    PLANNER_HARD_CONSTRAINTS.map((constraint) => [constraint.id, constraint]),
);

const SOFT_PREFERENCES_BY_ID: ReadonlyMap<string, PlannerSoftPreference> = new Map(
    PLANNER_SOFT_PREFERENCES.map((preference) => [preference.id, preference]),
);

export function plannerHardConstraint(id: string): PlannerHardConstraint | null {
    return HARD_CONSTRAINTS_BY_ID.get(id) ?? null;
}

export function plannerSoftPreference(id: string): PlannerSoftPreference | null {
    return SOFT_PREFERENCES_BY_ID.get(id) ?? null;
}

/** Constraints nobody may set aside — the ones the UI must never offer an override control for. */
export function nonNegotiableConstraints(): readonly PlannerHardConstraint[] {
    return PLANNER_HARD_CONSTRAINTS.filter((constraint) => constraint.overridePolicy === 'never');
}
