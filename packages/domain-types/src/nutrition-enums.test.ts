import { describe, expect, it } from 'vitest';

import {
    ACTIVITY_LEVELS,
    DIET_CLASSIFICATIONS,
    HEALTH_GOALS,
    MEAL_TYPES,
    MEASUREMENT_SYSTEMS,
    NUTRITION_CALCULATION_METHODS,
    PLAN_DURATIONS,
    RESTRICTION_KINDS,
    SALES_CHANNELS,
    SUBSCRIPTION_STATES,
    TARGET_PACES,
    VD_SESSION_STATES,
    hasPrivatePricing,
    isActivityLevel,
    isDietClassification,
    isHealthGoal,
    isLiveSubscriptionState,
    isMealType,
    isMeasurementSystem,
    isNutritionCalculationMethod,
    isPlanDuration,
    isRestrictionKind,
    isSafetyCriticalRestriction,
    isSalesChannel,
    isSubscriptionState,
    isTargetPace,
    isVdSessionState,
    isVdUnhappyState,
    planDuration,
    planDurationDays,
} from './nutrition-enums.ts';

const UNIONS = [
    ['MEAL_TYPES', MEAL_TYPES],
    ['DIET_CLASSIFICATIONS', DIET_CLASSIFICATIONS],
    ['ACTIVITY_LEVELS', ACTIVITY_LEVELS],
    ['HEALTH_GOALS', HEALTH_GOALS],
    ['TARGET_PACES', TARGET_PACES],
    ['MEASUREMENT_SYSTEMS', MEASUREMENT_SYSTEMS],
    ['NUTRITION_CALCULATION_METHODS', NUTRITION_CALCULATION_METHODS],
    ['RESTRICTION_KINDS', RESTRICTION_KINDS],
    ['SALES_CHANNELS', SALES_CHANNELS],
    ['SUBSCRIPTION_STATES', SUBSCRIPTION_STATES],
    ['PLAN_DURATIONS', PLAN_DURATIONS],
    ['VD_SESSION_STATES', VD_SESSION_STATES],
] as const;

describe('closed unions', () => {
    it.each(UNIONS)('%s has no duplicate members', (_name, values) => {
        expect(new Set(values).size).toBe(values.length);
    });

    it.each(UNIONS)('%s uses lower_snake_case members only', (_name, values) => {
        for (const value of values) {
            // Plan durations are the one deliberate exception: `7d` reads as a duration everywhere.
            if (/^\d+d$/.test(value)) continue;
            expect(value, value).toMatch(/^[a-z][a-z0-9]*(?:_[a-z0-9]+)*$/);
        }
    });

    it('declares the four meal types', () => {
        expect([...MEAL_TYPES]).toEqual(['breakfast', 'lunch', 'dinner', 'snack']);
    });

    it('declares the five activity levels the published multipliers are defined over', () => {
        expect(ACTIVITY_LEVELS).toHaveLength(5);
        expect([...ACTIVITY_LEVELS]).toEqual([
            'sedentary',
            'lightly_active',
            'moderately_active',
            'very_active',
            'extra_active',
        ]);
    });

    it('declares the four health goals and three paces', () => {
        expect([...HEALTH_GOALS]).toEqual([
            'lose_weight',
            'maintain',
            'gain_muscle',
            'recomposition',
        ]);
        expect([...TARGET_PACES]).toEqual(['gentle', 'standard', 'ambitious']);
    });

    it('declares exactly the seven restriction kinds, each distinct', () => {
        expect([...RESTRICTION_KINDS]).toEqual([
            'preference',
            'self_declared_medical',
            'dietitian_enforced',
            'allergy',
            'intolerance',
            'dislike',
            'religious',
        ]);
    });

    it('declares the eight sales channels a kitchen can be configured for', () => {
        expect([...SALES_CHANNELS]).toEqual([
            'b2c',
            'b2b',
            'marketplace',
            'pos',
            'subscription',
            'delivery',
            'pickup',
            'corporate',
        ]);
    });

    it('declares the six subscription states', () => {
        expect([...SUBSCRIPTION_STATES]).toEqual([
            'draft',
            'active',
            'paused',
            'skipped_today',
            'cancelled',
            'expired',
        ]);
    });

    it('declares every Virtual Dietitian UI state from the specification', () => {
        expect([...VD_SESSION_STATES]).toEqual([
            'initial_interview',
            'analysing',
            'missing_information',
            'suggested_targets',
            'suggested_meal_structure',
            'draft_generated',
            'review_requested',
            'professionally_approved',
            'generation_failed',
            'restriction_conflict',
            'no_suitable_meals',
            'safety_escalation',
        ]);
        expect(VD_SESSION_STATES).toHaveLength(12);
    });

    it('declares the three calculation methods, one of which is a human decision', () => {
        expect([...NUTRITION_CALCULATION_METHODS]).toEqual([
            'mifflin_st_jeor',
            'katch_mcardle',
            'professional_override',
        ]);
    });
});

describe('guards', () => {
    const cases = [
        ['isMealType', isMealType, MEAL_TYPES],
        ['isDietClassification', isDietClassification, DIET_CLASSIFICATIONS],
        ['isActivityLevel', isActivityLevel, ACTIVITY_LEVELS],
        ['isHealthGoal', isHealthGoal, HEALTH_GOALS],
        ['isTargetPace', isTargetPace, TARGET_PACES],
        ['isMeasurementSystem', isMeasurementSystem, MEASUREMENT_SYSTEMS],
        [
            'isNutritionCalculationMethod',
            isNutritionCalculationMethod,
            NUTRITION_CALCULATION_METHODS,
        ],
        ['isRestrictionKind', isRestrictionKind, RESTRICTION_KINDS],
        ['isSalesChannel', isSalesChannel, SALES_CHANNELS],
        ['isSubscriptionState', isSubscriptionState, SUBSCRIPTION_STATES],
        ['isPlanDuration', isPlanDuration, PLAN_DURATIONS],
        ['isVdSessionState', isVdSessionState, VD_SESSION_STATES],
    ] as const;

    it.each(cases)('%s accepts every declared member', (_name, guard, values) => {
        for (const value of values) expect(guard(value)).toBe(true);
    });

    it.each(cases)('%s rejects unknown and non-string values', (_name, guard) => {
        expect(guard('definitely-not-a-member')).toBe(false);
        expect(guard('')).toBe(false);
        expect(guard(null)).toBe(false);
        expect(guard(undefined)).toBe(false);
        expect(guard(0)).toBe(false);
    });
});

describe('restriction severity', () => {
    it('treats allergy, dietitian-enforced and self-declared medical as safety-critical', () => {
        for (const kind of RESTRICTION_KINDS) {
            expect(isSafetyCriticalRestriction(kind), kind).toBe(
                kind === 'allergy' ||
                    kind === 'dietitian_enforced' ||
                    kind === 'self_declared_medical',
            );
        }
    });
});

describe('sales channels', () => {
    it('marks only b2b and corporate as carrying private pricing', () => {
        for (const channel of SALES_CHANNELS) {
            expect(hasPrivatePricing(channel), channel).toBe(
                channel === 'b2b' || channel === 'corporate',
            );
        }
    });
});

describe('subscription states', () => {
    it('treats active and skipped_today as live', () => {
        for (const state of SUBSCRIPTION_STATES) {
            expect(isLiveSubscriptionState(state), state).toBe(
                state === 'active' || state === 'skipped_today',
            );
        }
    });
});

describe('plan durations', () => {
    it('names a run by its delivery days and reads the count back', () => {
        expect(planDuration(5)).toBe('5d');
        expect(planDuration(28)).toBe('28d');
        expect(planDurationDays('5d')).toBe(5);
        expect(planDurationDays('84d')).toBe(84);
    });

    it('accepts any positive whole number of days and nothing else', () => {
        expect(isPlanDuration('5d')).toBe(true);
        expect(isPlanDuration('365d')).toBe(true);
        expect(isPlanDuration('0d')).toBe(false);
        expect(isPlanDuration('4w')).toBe(false);
        expect(isPlanDuration('d')).toBe(false);
        expect(isPlanDuration('5')).toBe(false);
        expect(() => planDuration(0)).toThrow(RangeError);
        expect(() => planDuration(1.5)).toThrow(RangeError);
    });

    it('keeps the marketed set in ascending order', () => {
        const days = PLAN_DURATIONS.map(planDurationDays);
        expect(days).toEqual([...days].sort((a, b) => a - b));
    });
});

describe('Virtual Dietitian states', () => {
    it('classifies exactly the four blocked outcomes as unhappy', () => {
        const unhappy = VD_SESSION_STATES.filter(isVdUnhappyState);
        expect([...unhappy]).toEqual([
            'generation_failed',
            'restriction_conflict',
            'no_suitable_meals',
            'safety_escalation',
        ]);
    });
});
