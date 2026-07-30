import { RESTRICTION_KINDS } from '@healthy360/domain-types';
import { describe, expect, it } from 'vitest';

import {
    OVERRIDE_POLICIES,
    PLANNER_HARD_CONSTRAINTS,
    PLANNER_SOFT_PREFERENCES,
    nonNegotiableConstraints,
    plannerHardConstraint,
    plannerSoftPreference,
} from './constraints.ts';
import {
    PROPOSED_SCORING_MODEL,
    ScoringInputError,
    explainProposedScoring,
    totalProposedWeight,
    weightedScore,
} from './scoring.ts';

describe('hard constraints', () => {
    it('covers all thirteen the specification lists', () => {
        expect(PLANNER_HARD_CONSTRAINTS.map((constraint) => constraint.id)).toEqual([
            'allergies',
            'medical_restrictions',
            'dietitian_enforced_restrictions',
            'prohibited_ingredients',
            'diet_classification',
            'calorie_boundaries',
            'macro_boundaries',
            'meal_type',
            'availability',
            'serving_constraints',
            'kitchen_delivery_area',
            'kitchen_operating_schedule',
            'budget_ceiling',
        ]);
    });

    it('gives every constraint a unique id, violation code and override policy', () => {
        const ids = PLANNER_HARD_CONSTRAINTS.map((constraint) => constraint.id);
        const codes = PLANNER_HARD_CONSTRAINTS.map((constraint) => constraint.violationCode);
        expect(new Set(ids).size).toBe(ids.length);
        expect(new Set(codes).size).toBe(codes.length);
        for (const constraint of PLANNER_HARD_CONSTRAINTS) {
            expect(OVERRIDE_POLICIES).toContain(constraint.overridePolicy);
            expect(constraint.scopes.length, constraint.id).toBeGreaterThan(0);
            expect(constraint.violationCode, constraint.id).toMatch(/^planner\./);
        }
    });

    it('makes allergies non-overridable by anybody', () => {
        const allergies = plannerHardConstraint('allergies');
        expect(allergies?.overridePolicy).toBe('never');
        expect(allergies?.restrictionKinds).toEqual(['allergy']);
    });

    it('lets only a professional lift a dietitian-enforced or medical restriction', () => {
        expect(plannerHardConstraint('dietitian_enforced_restrictions')?.overridePolicy).toBe(
            'professional_only',
        );
        expect(plannerHardConstraint('medical_restrictions')?.overridePolicy).toBe(
            'professional_only',
        );
    });

    it('references only declared restriction kinds', () => {
        for (const constraint of PLANNER_HARD_CONSTRAINTS) {
            for (const kind of constraint.restrictionKinds) {
                expect(RESTRICTION_KINDS, constraint.id).toContain(kind);
            }
        }
    });

    it('covers every restriction kind across the constraint set', () => {
        const covered = new Set(
            PLANNER_HARD_CONSTRAINTS.flatMap((constraint) => constraint.restrictionKinds),
        );
        for (const kind of RESTRICTION_KINDS) {
            // `dislike` is deliberately a soft preference, not a hard filter.
            if (kind === 'dislike') continue;
            expect(covered, kind).toContain(kind);
        }
    });

    it('lists the never-overridable constraints for the UI to hide controls for', () => {
        expect(nonNegotiableConstraints().map((constraint) => constraint.id)).toEqual([
            'allergies',
            'availability',
            'serving_constraints',
            'kitchen_delivery_area',
            'kitchen_operating_schedule',
        ]);
    });

    it('returns null for an unknown id rather than throwing', () => {
        expect(plannerHardConstraint('made_up')).toBeNull();
    });
});

describe('soft preferences', () => {
    it('covers all twelve the specification lists', () => {
        expect(PLANNER_SOFT_PREFERENCES).toHaveLength(12);
        expect(PLANNER_SOFT_PREFERENCES.map((preference) => preference.id)).toEqual([
            'cuisine_match',
            'favourite_foods',
            'dislikes',
            'variety',
            'cost',
            'preparation_time',
            'pantry_use',
            'ingredient_reuse',
            'kitchen_preference',
            'delivery_convenience',
            'recipe_complexity',
            'repetition_avoidance',
        ]);
    });

    it('gives every preference a positive weight and a direction', () => {
        for (const preference of PLANNER_SOFT_PREFERENCES) {
            expect(preference.defaultWeight, preference.id).toBeGreaterThan(0);
            expect(['maximise', 'minimise'], preference.id).toContain(preference.direction);
        }
    });

    it('treats a dislike as a preference rather than a filter', () => {
        expect(plannerSoftPreference('dislikes')?.direction).toBe('minimise');
        expect(plannerHardConstraint('dislikes')).toBeNull();
    });

    it('shares no id with any hard constraint', () => {
        const hard = new Set(PLANNER_HARD_CONSTRAINTS.map((constraint) => constraint.id));
        for (const preference of PLANNER_SOFT_PREFERENCES) {
            expect(hard.has(preference.id), preference.id).toBe(false);
        }
    });
});

describe('the proposed scoring model', () => {
    it('is labelled as a proposal, not a discovery', () => {
        expect(PROPOSED_SCORING_MODEL.status).toBe('proposed');
        expect(PROPOSED_SCORING_MODEL.version).toContain('proposed');
        expect(PROPOSED_SCORING_MODEL.notes.join(' ')).toContain('Not derived from');
    });

    it('states that hard constraints filter rather than penalise', () => {
        expect(PROPOSED_SCORING_MODEL.notes.join(' ')).toContain('filters applied before scoring');
    });

    it('states that no solver is implemented', () => {
        expect(PROPOSED_SCORING_MODEL.notes.join(' ')).toContain('No solver');
    });

    it('has one component per soft preference, with a normalisation and a rationale', () => {
        expect(
            PROPOSED_SCORING_MODEL.components.map((component) => component.preferenceId),
        ).toEqual(PLANNER_SOFT_PREFERENCES.map((preference) => preference.id));
        for (const component of PROPOSED_SCORING_MODEL.components) {
            expect(component.normalisation, component.preferenceId).not.toBe('Not yet specified.');
            expect(component.rationale, component.preferenceId).not.toBe('Not yet specified.');
        }
    });

    it('has weights that sum to exactly one', () => {
        expect(totalProposedWeight()).toBe(1);
    });

    it('explains itself in prose for the design document', () => {
        const lines = explainProposedScoring();
        expect(lines[0]).toBe(PROPOSED_SCORING_MODEL.summary);
        expect(lines[1]).toBe(PROPOSED_SCORING_MODEL.formula);
        expect(lines.length).toBe(2 + PROPOSED_SCORING_MODEL.notes.length);
    });
});

describe('weightedScore', () => {
    it('returns one when every supplied signal is perfect', () => {
        expect(
            weightedScore([
                { preferenceId: 'cuisine_match', normalisedValue: 1 },
                { preferenceId: 'cost', normalisedValue: 1 },
            ]),
        ).toBe(1);
    });

    it('returns zero when every supplied signal is at its worst', () => {
        expect(
            weightedScore([
                { preferenceId: 'cuisine_match', normalisedValue: 0 },
                { preferenceId: 'cost', normalisedValue: 0 },
            ]),
        ).toBe(0);
    });

    it('renormalises over the signals present, so missing data does not drag scores down', () => {
        // cuisine 0.12 and cost 0.12 carry equal weight, so one perfect and one absent gives 0.5.
        expect(
            weightedScore([
                { preferenceId: 'cuisine_match', normalisedValue: 1 },
                { preferenceId: 'cost', normalisedValue: 0 },
            ]),
        ).toBe(0.5);

        expect(weightedScore([{ preferenceId: 'cuisine_match', normalisedValue: 1 }])).toBe(1);
    });

    it('weights heavier signals more', () => {
        const heavy = weightedScore([
            { preferenceId: 'dislikes', normalisedValue: 1 },
            { preferenceId: 'repetition_avoidance', normalisedValue: 0 },
        ]);
        const light = weightedScore([
            { preferenceId: 'dislikes', normalisedValue: 0 },
            { preferenceId: 'repetition_avoidance', normalisedValue: 1 },
        ]);
        expect(heavy).toBeGreaterThan(light);
        expect(heavy + light).toBeCloseTo(1, 6);
    });

    it('clamps out-of-range readings rather than producing a score outside 0–1', () => {
        expect(weightedScore([{ preferenceId: 'cost', normalisedValue: 5 }])).toBe(1);
        expect(weightedScore([{ preferenceId: 'cost', normalisedValue: -5 }])).toBe(0);
    });

    it('rejects an unknown signal, an empty reading list and a non-finite value', () => {
        expect(() => weightedScore([])).toThrow(ScoringInputError);
        expect(() => weightedScore([{ preferenceId: 'nope', normalisedValue: 1 }])).toThrow(
            ScoringInputError,
        );
        expect(() =>
            weightedScore([{ preferenceId: 'cost', normalisedValue: Number.NaN }]),
        ).toThrow(ScoringInputError);
    });

    it('is deterministic', () => {
        const readings = [
            { preferenceId: 'cuisine_match', normalisedValue: 0.7 },
            { preferenceId: 'variety', normalisedValue: 0.3 },
            { preferenceId: 'cost', normalisedValue: 0.9 },
        ];
        const first = weightedScore(readings);
        for (let index = 0; index < 20; index += 1) {
            expect(weightedScore(readings)).toBe(first);
        }
    });
});
