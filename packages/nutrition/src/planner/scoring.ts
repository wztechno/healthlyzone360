import { roundTo } from '../facts/aggregate.ts';
import { PLANNER_SOFT_PREFERENCES, type PlannerSoftPreference } from './constraints.ts';

/**
 * A **proposed** scoring explanation for the internal planner.
 *
 * Stated plainly, because the prompt is: this is our own proposal for how a planner *could* rank
 * candidates. It is not a reconstruction of any competitor's rules. Those rules are not publicly
 * observable, no attempt was made to infer them, and a plausible-looking guess dressed up as
 * knowledge would be the worst of both worlds.
 *
 * There is no solver here on purpose. What exists is: the shape of a score, a documented
 * normalisation rule, a starting set of weights, and the arithmetic that combines them — enough
 * for a UI to explain *why* a suggestion was made once a real planner produces the signals, and
 * little enough that nothing can quietly come to depend on a search implementation that does not
 * exist yet.
 */

export interface ProposedScoreComponent {
    readonly preferenceId: string;
    readonly weight: number;
    /** How the raw signal is mapped onto 0–1, where 1 is always the better outcome. */
    readonly normalisation: string;
    /** Why the signal is worth what it is worth. */
    readonly rationale: string;
}

export interface ProposedScoringModel {
    readonly version: string;
    /** Always `proposed`. A production model would carry a different status and its own evidence. */
    readonly status: 'proposed';
    readonly summary: string;
    readonly formula: string;
    readonly components: readonly ProposedScoreComponent[];
    readonly notes: readonly string[];
}

const RATIONALES: Readonly<Record<string, { normalisation: string; rationale: string }>> = {
    cuisine_match: {
        normalisation:
            'Share of the candidate’s cuisine tags that appear in the person’s chosen cuisines, 0–1.',
        rationale:
            'Cuisine is the preference people state most confidently and notice fastest when it is ' +
            'ignored, so it carries one of the larger weights.',
    },
    favourite_foods: {
        normalisation:
            'Count of matched favourite ingredients or dishes, capped at three and divided by three.',
        rationale:
            'Capped because a dish stuffed with every favourite is not three times better than one ' +
            'built around a single favourite.',
    },
    dislikes: {
        normalisation:
            'Count of disliked ingredients present, capped at two and divided by two, then inverted.',
        rationale:
            'Weighted slightly above cuisine match: avoiding what someone does not want is worth ' +
            'more than hitting what they do, because one disliked ingredient spoils the whole meal.',
    },
    variety: {
        normalisation:
            'Distinct cuisines and protein sources in the week divided by the number of entries, ' +
            'clamped to 0–1.',
        rationale:
            'Evaluated at week scope, so it can only be judged once a week is assembled — which is ' +
            'why a per-entry greedy planner tends to produce monotonous weeks.',
    },
    cost: {
        normalisation:
            'Estimated day cost divided by the budget ceiling, clamped to 0–1, then inverted.',
        rationale:
            'The ceiling is already a hard constraint. This signal only distinguishes between plans ' +
            'that all fit, so it is weighted for comfort rather than for compliance.',
    },
    preparation_time: {
        normalisation:
            'Hands-on minutes divided by the minutes declared available for that day, clamped, ' +
            'inverted.',
        rationale:
            'A plan a person has no time to cook is not a plan. Normalising against the day’s own ' +
            'availability lets a busy Tuesday and a free Sunday be judged on the same scale.',
    },
    pantry_use: {
        normalisation: 'Share of the candidate’s ingredients already recorded in the pantry, 0–1.',
        rationale:
            'Real money and real waste, but only for people who keep the pantry current, so it is ' +
            'weighted below the signals everyone provides.',
    },
    ingredient_reuse: {
        normalisation:
            'Share of perishable ingredients that appear in at least one other entry that week, 0–1.',
        rationale:
            'Shortens the grocery list and reduces waste. Deliberately in tension with variety; the ' +
            'weights are what balance the two, and tuning them is the first thing a real planner ' +
            'would want to experiment with.',
    },
    kitchen_preference: {
        normalisation:
            'One for a preferred kitchen, 0.5 for one previously ordered from, zero otherwise.',
        rationale: 'A revealed preference, weaker than a stated one, so weighted below cuisine.',
    },
    delivery_convenience: {
        normalisation: 'One minus (distinct delivery slots in the day − 1) ÷ 3, clamped to 0–1.',
        rationale:
            'Three separate deliveries in a day is a worse experience than one, independently of ' +
            'what arrives.',
    },
    recipe_complexity: {
        normalisation:
            'Step count divided by the person’s comfortable maximum, clamped to 0–1, inverted.',
        rationale:
            'Distinct from preparation time: a twelve-step recipe can be quick and still feel ' +
            'daunting to somebody who does not cook often.',
    },
    repetition_avoidance: {
        normalisation:
            'Days since the same dish last appeared divided by fourteen, clamped to 0–1.',
        rationale:
            'The smallest weight, because some repetition is welcome — batch cooking depends on it ' +
            'and the leftovers indicator exists to support it.',
    },
};

function componentFor(preference: PlannerSoftPreference): ProposedScoreComponent {
    const entry = RATIONALES[preference.id];
    return {
        preferenceId: preference.id,
        weight: preference.defaultWeight,
        normalisation: entry?.normalisation ?? 'Not yet specified.',
        rationale: entry?.rationale ?? 'Not yet specified.',
    };
}

export const PROPOSED_SCORING_MODEL: ProposedScoringModel = {
    version: '0.1.0-proposed',
    status: 'proposed',
    summary:
        'A candidate that survives every hard constraint is ranked by a weighted sum of normalised ' +
        'soft signals. Entry-scope signals rank replacements inside one slot; day- and week-scope ' +
        'signals rank whole assemblies, which is why generating a week is not the same problem as ' +
        'generating seven days.',
    formula: 'score(candidate) = Σ over signals of weight × normalisedValue, with Σ weights = 1',
    components: PLANNER_SOFT_PREFERENCES.map(componentFor),
    notes: [
        'Proposed by us. Not derived from, and not an inference about, any reference product’s ' +
            'ranking rules — those are not publicly observable and no attempt was made to infer them.',
        'Hard constraints are filters applied before scoring, never penalties inside it. A meal ' +
            'that violates one is absent from the candidate set at any score.',
        'Every signal is normalised so that 1 is the better outcome; `minimise` preferences are ' +
            'inverted during normalisation rather than negated in the sum, so no weight is negative ' +
            'and no score can fall outside 0–1.',
        'The weights are a starting point for tuning against real behaviour, not a discovered ' +
            'optimum. They are stated here so a reviewer can argue with them.',
        'No solver, search or generation is implemented. Assembling a week under these rules is a ' +
            'constrained assignment problem and needs a design of its own.',
        'Whatever ranks a candidate must be explainable to the person: the top contributing signals ' +
            'are what a "why this meal?" panel would show.',
    ],
};

/** Sum of the default weights. `1` by construction; asserted by the tests. */
export function totalProposedWeight(): number {
    return roundTo(
        PROPOSED_SCORING_MODEL.components.reduce((total, component) => total + component.weight, 0),
        6,
    );
}

export interface SignalReading {
    readonly preferenceId: string;
    /** Already normalised to 0–1, where 1 is the better outcome. */
    readonly normalisedValue: number;
}

export class ScoringInputError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'ScoringInputError';
    }
}

/**
 * Combines normalised signal readings into one 0–1 score using the proposed weights.
 *
 * Only the readings supplied are counted, and the weights are renormalised over them — a signal
 * with no data (an empty pantry, a person who stated no cuisines) must not silently score zero and
 * drag every candidate down equally.
 *
 * This is arithmetic over values a caller has already computed. It is *not* a planner.
 */
export function weightedScore(readings: readonly SignalReading[]): number {
    if (readings.length === 0) {
        throw new ScoringInputError('A score needs at least one signal reading.');
    }

    let weighted = 0;
    let totalWeight = 0;

    for (const reading of readings) {
        const component = PROPOSED_SCORING_MODEL.components.find(
            (candidate) => candidate.preferenceId === reading.preferenceId,
        );
        if (component === undefined) {
            throw new ScoringInputError(`Unknown planner signal ${reading.preferenceId}.`);
        }
        if (!Number.isFinite(reading.normalisedValue)) {
            throw new ScoringInputError(
                `Signal ${reading.preferenceId} must be a finite number in 0–1.`,
            );
        }
        const clamped = Math.min(1, Math.max(0, reading.normalisedValue));
        weighted += component.weight * clamped;
        totalWeight += component.weight;
    }

    return roundTo(weighted / totalWeight, 6);
}

/** The proposal in prose, for the design document and the "why this meal?" panel. */
export function explainProposedScoring(): readonly string[] {
    return [
        PROPOSED_SCORING_MODEL.summary,
        PROPOSED_SCORING_MODEL.formula,
        ...PROPOSED_SCORING_MODEL.notes,
    ];
}
