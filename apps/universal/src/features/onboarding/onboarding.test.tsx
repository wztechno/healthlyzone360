import { RESTRICTION_KINDS, isSafetyCriticalRestriction } from '@healthy360/domain-types';
import { MOCK_SCENARIOS } from '@healthy360/api-client/mock';
import { ENERGY_FLOOR_KCAL, MockNutritionTargetEngine } from '@healthy360/nutrition';
import { act, fireEvent, screen, waitFor } from '@testing-library/react-native';

import { renderScreen } from '../../testing/render-screen.tsx';
import {
    buildConstraints,
    constraintLabelKey,
    groupByRestrictionKind,
    mergeConstraints,
    safetyCriticalKinds,
} from './constraints.ts';
import { OnboardingIndexScreen, OnboardingScreen } from './onboarding-screen.tsx';
import { OnboardingProvider } from './onboarding-provider.tsx';
import { validateStep } from './schemas.ts';
import {
    ONBOARDING_STEPS,
    ONBOARDING_STEP_COUNT,
    ONBOARDING_STEP_SLUGS,
    RESTRICTION_DISPLAY_ORDER,
    RESTRICTION_PRESENTATION,
    everyRestrictionKindIsPresented,
    isOnboardingStepSlug,
    nextStep,
    previousStep,
} from './steps.ts';
import {
    DECLINED_SEX_FALLBACK,
    INITIAL_ANSWERS,
    firstIncompleteStep,
    isReadyToCalculate,
    isStepComplete,
    isStepReachable,
    onboardingReducer,
    resizeMealSlots,
    toTargetRequest,
    weeklyBudgetMoney,
} from './state.ts';
import type { OnboardingAnswers } from './state.ts';
import { BOUNDS, ENGINE_BOUNDS, fromFeetAndInches, toFeetAndInches } from './vocabularies.ts';

const CONSUMER = MOCK_SCENARIOS['consumer-prototype'].primaryEmail;

/**
 * Router state, mocked.
 *
 * `Redirect` records rather than renders, because "where does an unreachable step send somebody?"
 * is the single most important routing rule in this feature and asserting it through a component
 * that renders `null` would be asserting nothing.
 */
const routerState: { params: Record<string, string>; redirects: string[] } = {
    params: {},
    redirects: [],
};

jest.mock('expo-router', () => {
    const push = jest.fn();
    const replace = jest.fn();
    return {
        __esModule: true,
        useRouter: () => ({ push, replace, back: jest.fn(), setParams: jest.fn() }),
        usePathname: () => '/customer/onboarding',
        useLocalSearchParams: () => routerState.params,
        Redirect: ({ href }: { href: string }) => {
            routerState.redirects.push(href);
            return null;
        },
        Link: ({ children }: { children: React.ReactNode }) => children,
        Slot: () => null,
        Stack: () => null,
        __push: push,
        __replace: replace,
    };
});

// eslint-disable-next-line @typescript-eslint/no-require-imports
const routerMock = require('expo-router') as { __push: jest.Mock; __replace: jest.Mock };

beforeEach(() => {
    routerState.params = {};
    routerState.redirects = [];
    routerMock.__push.mockClear();
    routerMock.__replace.mockClear();
});

/* ------------------------------------------------------------------------------------------------
 * Answer fixtures — the wizard's own state, not the mock world's
 * ---------------------------------------------------------------------------------------------- */

function answersThrough(slug: (typeof ONBOARDING_STEP_SLUGS)[number]): OnboardingAnswers {
    const complete = completeAnswers();
    const index = ONBOARDING_STEP_SLUGS.indexOf(slug);
    // Everything up to `slug` answered, everything from `slug` on left at its initial value.
    return ONBOARDING_STEP_SLUGS.slice(index).reduce<OnboardingAnswers>(
        (state, later) => ({ ...state, ...resetFor(later) }),
        complete,
    );
}

function resetFor(slug: (typeof ONBOARDING_STEP_SLUGS)[number]): Partial<OnboardingAnswers> {
    switch (slug) {
        case 'introduction':
            return { introductionAcknowledged: false };
        case 'age':
            return { ageYears: null };
        case 'calculation-basis':
            return { sexForCalculation: null, calculationBasis: 'measurements' };
        case 'height':
            return { heightCentimetres: null };
        case 'weight':
            return { weightKilograms: null };
        case 'body-fat':
            return { bodyFatPercentage: null, bodyFatSkipped: false };
        case 'activity':
            return { activityLevel: null };
        case 'goal':
            return { goal: null };
        case 'pace':
            return { pace: null };
        case 'diet':
            return { diet: null };
        case 'cooking':
            return { cookingMinutesPerDay: null, cookingSkill: null };
        case 'meals':
            return { mealsPerDay: null, snacksPerDay: null, mealSlots: [] };
        case 'summary':
            return { summaryAcknowledged: false };
        case 'review':
            return { professionalReviewAcknowledged: false };
        default:
            return {};
    }
}

function completeAnswers(overrides: Partial<OnboardingAnswers> = {}): OnboardingAnswers {
    return {
        ...INITIAL_ANSWERS,
        introductionAcknowledged: true,
        measurementSystem: 'metric',
        ageYears: 34,
        calculationBasis: 'measurements',
        sexForCalculation: 'female',
        heightCentimetres: 165,
        weightKilograms: 68,
        bodyFatPercentage: null,
        bodyFatSkipped: true,
        activityLevel: 'moderately_active',
        goal: 'lose_weight',
        pace: 'standard',
        diet: 'mediterranean',
        observances: ['no_pork'],
        allergies: ['tree_nut'],
        intolerances: ['lactose'],
        selfDeclaredMedical: ['sodium'],
        dislikedIngredients: ['aubergine'],
        preferredCuisines: ['levantine'],
        weeklyBudgetMajor: 450,
        cookingMinutesPerDay: 30,
        cookingSkill: 'confident',
        mealsPerDay: 3,
        snacksPerDay: 1,
        mealSlots: resizeMealSlots([], 3, 1),
        preparationMode: 'mixed',
        summaryAcknowledged: true,
        professionalReviewAcknowledged: false,
        ...overrides,
    };
}

/**
 * Flushes one macrotask inside `act`.
 *
 * TanStack delivers cache notifications through a batched timeout, so a screen that fires a query
 * on mount updates a tick after `render` resolves. A test that asserts synchronously and ends would
 * receive that update outside any `act` boundary — the "not wrapped in act" warning, and a genuine
 * cross-test leak rather than cosmetic noise.
 */
async function settleQueries() {
    // Twice: the session query is enabled by a token-store notification, so its result lands one
    // batch after the queries that fire directly on mount.
    for (let pass = 0; pass < 2; pass += 1) {
        await act(async () => {
            await new Promise((resolve) => {
                setTimeout(resolve, 0);
            });
        });
    }
}

interface RenderStepOptions {
    readonly scenario?: 'consumer-prototype' | 'consumer-onboarding' | undefined;
    /** Leave the on-mount queries in flight, for the tests that assert a loading state. */
    readonly settle?: boolean | undefined;
}

async function renderStep(
    slug: (typeof ONBOARDING_STEP_SLUGS)[number],
    answers: OnboardingAnswers,
    options: RenderStepOptions = {},
) {
    const harness = await renderScreen(
        <OnboardingProvider initialAnswers={answers}>
            <OnboardingScreen slug={slug} />
        </OnboardingProvider>,
        { scenario: options.scenario ?? 'consumer-prototype', signInAs: CONSUMER },
    );
    if (options.settle !== false) await settleQueries();
    return harness;
}

/* ------------------------------------------------------------------------------------------------
 * The step table
 * ---------------------------------------------------------------------------------------------- */

describe('the step table', () => {
    it('has exactly the twenty-two steps the specification names', () => {
        expect(ONBOARDING_STEP_COUNT).toBe(22);
        expect(new Set(ONBOARDING_STEP_SLUGS).size).toBe(22);
        expect(ONBOARDING_STEPS.map((step) => step.position)).toEqual(
            Array.from({ length: 22 }, (_, index) => index + 1),
        );
    });

    it('links each step to its neighbours and stops at both ends', () => {
        expect(previousStep('introduction')).toBeNull();
        expect(nextStep('review')).toBeNull();
        expect(nextStep('introduction')).toBe('units');
        expect(previousStep('review')).toBe('summary');
    });

    it('recognises real slugs and rejects invented ones', () => {
        expect(isOnboardingStepSlug('units')).toBe(true);
        expect(isOnboardingStepSlug('step-2')).toBe(false);
        expect(isOnboardingStepSlug(2)).toBe(false);
    });

    it('mirrors the engine bounds without ever exceeding them', () => {
        expect(BOUNDS.ageYears.min).toBeGreaterThanOrEqual(ENGINE_BOUNDS.ageYears.min);
        expect(BOUNDS.ageYears.max).toBeLessThanOrEqual(ENGINE_BOUNDS.ageYears.max);
        expect(BOUNDS.heightCentimetres.min).toBeGreaterThanOrEqual(
            ENGINE_BOUNDS.heightCentimetres.min,
        );
        expect(BOUNDS.weightKilograms.max).toBeLessThanOrEqual(ENGINE_BOUNDS.weightKilograms.max);
        expect(BOUNDS.bodyFatPercentage.max).toBeLessThanOrEqual(
            ENGINE_BOUNDS.bodyFatPercentage.max,
        );
    });
});

/* ------------------------------------------------------------------------------------------------
 * The seven restriction kinds
 * ---------------------------------------------------------------------------------------------- */

describe('the seven restriction kinds', () => {
    it('presents every kind the domain declares, and nothing else', () => {
        expect(everyRestrictionKindIsPresented()).toBe(true);
        expect([...RESTRICTION_DISPLAY_ORDER].sort()).toEqual([...RESTRICTION_KINDS].sort());
        expect(RESTRICTION_DISPLAY_ORDER).toHaveLength(7);
    });

    it('gives each kind its own glyph, so none is distinguished by colour alone', () => {
        const icons = RESTRICTION_KINDS.map((kind) => RESTRICTION_PRESENTATION[kind].icon);
        expect(new Set(icons).size).toBe(7);
    });

    it('agrees with the domain about which kinds nobody may override casually', () => {
        for (const kind of RESTRICTION_KINDS) {
            const presentation = RESTRICTION_PRESENTATION[kind];
            if (isSafetyCriticalRestriction(kind)) {
                // The three the domain calls safety-critical are never lifted by a confirmation.
                expect(presentation.authority).not.toBe('confirmation');
            } else {
                expect(presentation.authority).not.toBe('nobody');
            }
        }
        expect(RESTRICTION_PRESENTATION.allergy.authority).toBe('nobody');
        expect(RESTRICTION_PRESENTATION.dietitian_enforced.authority).toBe('dietitian');
        expect(RESTRICTION_PRESENTATION.dietitian_enforced.editable).toBe(false);
    });

    it('maps every answer group onto the right kind, severity and source', () => {
        const constraints = buildConstraints(completeAnswers());
        const byKind = Object.fromEntries(
            constraints.map((constraint) => [constraint.kind, constraint]),
        );

        expect(byKind['allergy']).toMatchObject({
            code: 'tree_nut',
            severity: 'critical',
            source: 'user',
        });
        expect(byKind['intolerance']).toMatchObject({ code: 'lactose', severity: 'strict' });
        expect(byKind['religious']).toMatchObject({ code: 'no_pork', severity: 'strict' });
        expect(byKind['self_declared_medical']).toMatchObject({
            code: 'sodium',
            severity: 'strict',
        });
        expect(byKind['dislike']).toMatchObject({ code: 'aubergine', severity: 'advisory' });
        expect(byKind['preference']).toMatchObject({ code: 'mediterranean', severity: 'advisory' });
        // A dietitian's restriction is never produced from the person's own answers.
        expect(byKind['dietitian_enforced']).toBeUndefined();
    });

    it('groups into all seven, including the empty ones', () => {
        const groups = groupByRestrictionKind(buildConstraints(INITIAL_ANSWERS));
        expect(groups).toHaveLength(7);
        expect(groups.every((group) => group.constraints.length === 0)).toBe(true);
    });

    it('keeps a dietitian restriction when the person edits their own answers', () => {
        const enforced = [
            {
                kind: 'dietitian_enforced' as const,
                code: 'added_sugar',
                label: 'Added sugar limit',
                severity: 'strict' as const,
                source: 'dietitian' as const,
                note: null,
            },
        ];
        const merged = mergeConstraints(buildConstraints(completeAnswers()), enforced);
        expect(merged.filter((c) => c.kind === 'dietitian_enforced')).toHaveLength(1);
        expect(safetyCriticalKinds(merged)).toEqual([
            'allergy',
            'dietitian_enforced',
            'self_declared_medical',
        ]);
    });

    it('routes each kind to a translation key in its own family', () => {
        expect(constraintLabelKey('allergy', 'tree_nut')).toBe('onboarding:allergens.tree_nut');
        expect(constraintLabelKey('intolerance', 'lactose')).toBe(
            'onboarding:intolerances.lactose',
        );
        expect(constraintLabelKey('religious', 'no_pork')).toBe('onboarding:observances.no_pork');
        expect(constraintLabelKey('dislike', 'okra')).toBe('onboarding:dislikes.okra');
        expect(constraintLabelKey('preference', 'keto')).toBe('onboarding:diets.keto');
    });

    it('renders seven visually distinct groups on the summary', async () => {
        await renderStep('summary', completeAnswers());

        await waitFor(() => {
            expect(screen.getByTestId('onboarding-summary-restrictions')).toBeTruthy();
        });

        // All seven groups exist as their own block, each with its own badge.
        for (const kind of RESTRICTION_KINDS) {
            expect(screen.getByTestId(`onboarding-restriction-group-${kind}`)).toBeTruthy();
            expect(screen.getByTestId(`onboarding-restriction-badge-${kind}`)).toBeTruthy();
        }

        // The six the person supplied carry an item; the dietitian's group is empty here and says so.
        expect(screen.getByTestId('onboarding-restriction-item-allergy-tree_nut')).toBeTruthy();
        expect(screen.getByTestId('onboarding-restriction-item-intolerance-lactose')).toBeTruthy();
        expect(screen.getByTestId('onboarding-restriction-item-religious-no_pork')).toBeTruthy();
        expect(
            screen.getByTestId('onboarding-restriction-item-self_declared_medical-sodium'),
        ).toBeTruthy();
        expect(screen.getByTestId('onboarding-restriction-item-dislike-aubergine')).toBeTruthy();
        expect(
            screen.getByTestId('onboarding-restriction-item-preference-mediterranean'),
        ).toBeTruthy();

        // Only the dietitian's group is locked; every other one offers a way back to its step.
        expect(screen.getByTestId('onboarding-restriction-locked-dietitian_enforced')).toBeTruthy();
        expect(screen.queryByTestId('onboarding-restriction-edit-dietitian_enforced')).toBeNull();
        expect(screen.getByTestId('onboarding-restriction-edit-allergy')).toBeTruthy();
    });
});

/* ------------------------------------------------------------------------------------------------
 * Navigation and prerequisites
 * ---------------------------------------------------------------------------------------------- */

describe('navigation', () => {
    it('sends a fresh visitor to the first step', async () => {
        await renderScreen(
            <OnboardingProvider>
                <OnboardingIndexScreen />
            </OnboardingProvider>,
            { scenario: 'consumer-onboarding', signInAs: CONSUMER },
        );

        expect(routerState.redirects).toContain('/customer/onboarding/introduction');
    });

    it('resumes at the first unanswered step', async () => {
        await renderScreen(
            <OnboardingProvider initialAnswers={answersThrough('activity')}>
                <OnboardingIndexScreen />
            </OnboardingProvider>,
            { scenario: 'consumer-onboarding', signInAs: CONSUMER },
        );

        expect(routerState.redirects).toContain('/customer/onboarding/activity');
    });

    it('bounces a deep link whose prerequisites are missing', async () => {
        await renderStep('budget', INITIAL_ANSWERS);

        expect(routerState.redirects).toContain('/customer/onboarding/introduction');
        expect(screen.queryByTestId('onboarding-step-budget')).toBeNull();
    });

    it('lets a deep link land on any step whose prerequisites are met', async () => {
        await renderStep('budget', answersThrough('budget'));

        expect(routerState.redirects).toEqual([]);
        expect(screen.getByTestId('onboarding-step-budget')).toBeTruthy();
    });

    it('computes reachability, completeness and readiness consistently', () => {
        expect(isStepReachable('units', INITIAL_ANSWERS)).toBe(false);
        expect(isStepReachable('introduction', INITIAL_ANSWERS)).toBe(true);
        expect(firstIncompleteStep(INITIAL_ANSWERS)).toBe('introduction');
        expect(isReadyToCalculate(INITIAL_ANSWERS)).toBe(false);
        expect(isReadyToCalculate(completeAnswers())).toBe(true);
        // Steps whose empty answer is a real answer never block anybody.
        for (const slug of [
            'allergies',
            'restrictions',
            'dislikes',
            'cuisines',
            'budget',
        ] as const) {
            expect(isStepComplete(slug, INITIAL_ANSWERS)).toBe(true);
        }
    });

    it('shows progress and moves forward when the step validates', async () => {
        await renderStep('units', answersThrough('units'));

        expect(screen.getByTestId('onboarding-stepper')).toBeTruthy();
        await fireEvent.press(screen.getByTestId('onboarding-next'));

        expect(routerMock.__push).toHaveBeenCalledWith('/customer/onboarding/age');
    });

    it('refuses to move on when the step does not validate, and says why', async () => {
        await renderStep('introduction', INITIAL_ANSWERS);

        await fireEvent.press(screen.getByTestId('onboarding-next'));

        await waitFor(() => {
            expect(screen.getByTestId('onboarding-introduction-acknowledge-error')).toBeTruthy();
        });
        expect(routerMock.__push).not.toHaveBeenCalled();
    });

    it('goes back a step', async () => {
        await renderStep('age', answersThrough('age'));

        await fireEvent.press(screen.getByTestId('onboarding-back'));
        expect(routerMock.__push).toHaveBeenCalledWith('/customer/onboarding/units');
    });
});

/* ------------------------------------------------------------------------------------------------
 * Individual steps
 * ---------------------------------------------------------------------------------------------- */

describe('step 1 — introduction', () => {
    it('says what happens with the data and carries the disclaimer', async () => {
        await renderStep('introduction', INITIAL_ANSWERS);

        expect(screen.getByTestId('onboarding-introduction-promises')).toBeTruthy();
        for (const key of ['whatWeAsk', 'whatWeDo', 'whatWeDoNot', 'notSaved']) {
            expect(screen.getByTestId(`onboarding-introduction-${key}`)).toBeTruthy();
        }
        expect(screen.getAllByTestId('medical-disclaimer').length).toBeGreaterThan(0);
    });
});

describe('step 2 — units', () => {
    it('offers both systems and explains that switching converts rather than clears', async () => {
        await renderStep('units', answersThrough('units'));

        expect(screen.getByTestId('onboarding-units-metric')).toBeTruthy();
        expect(screen.getByTestId('onboarding-units-imperial')).toBeTruthy();
        expect(screen.getByTestId('onboarding-units-note')).toBeTruthy();
    });
});

describe('step 4 — the calculation input', () => {
    it('asks for the constant only when the chosen equation reads one', async () => {
        await renderStep('calculation-basis', answersThrough('calculation-basis'));

        expect(screen.getByTestId('onboarding-sex-section')).toBeTruthy();
        expect(screen.getByTestId('onboarding-sex-why')).toBeTruthy();

        await fireEvent.press(screen.getByTestId('onboarding-basis-body-composition'));

        await waitFor(() => {
            expect(screen.getByTestId('onboarding-basis-declined')).toBeTruthy();
        });
        expect(screen.queryByTestId('onboarding-sex-section')).toBeNull();
    });

    it('will not advance from the measurement path without a constant', async () => {
        await renderStep('calculation-basis', answersThrough('calculation-basis'));

        await fireEvent.press(screen.getByTestId('onboarding-next'));

        await waitFor(() => {
            expect(screen.getByTestId('onboarding-sex-error')).toBeTruthy();
        });
        expect(routerMock.__push).not.toHaveBeenCalled();
    });
});

describe('steps 5 and 6 — height and weight', () => {
    it('is a single control in metric and a compound one in imperial', async () => {
        const metric = answersThrough('height');
        const { view } = await renderStep('height', metric);
        expect(screen.getByTestId('onboarding-height')).toBeTruthy();
        view.unmount();

        await renderStep('height', { ...metric, measurementSystem: 'imperial' });
        expect(screen.getByTestId('onboarding-height-feet')).toBeTruthy();
        expect(screen.getByTestId('onboarding-height-inches')).toBeTruthy();
    });

    it('converts rather than clears, and carries a whole-inch overflow correctly', () => {
        expect(toFeetAndInches(182.9)).toEqual({ feet: 6, inches: 0 });
        expect(toFeetAndInches(165)).toEqual({ feet: 5, inches: 5 });
        expect(fromFeetAndInches(5, 5)).toBeCloseTo(165.1, 1);
    });
});

describe('step 7 — body fat', () => {
    it('is skippable, and skipping is recorded as an answer rather than an absence', async () => {
        await renderStep('body-fat', answersThrough('body-fat'));

        expect(screen.getByTestId('onboarding-body-fat-skip')).toBeTruthy();
        expect(screen.getByTestId('onboarding-body-fat-no-bands')).toBeTruthy();

        await fireEvent.press(screen.getByTestId('onboarding-skip'));
        expect(routerMock.__push).toHaveBeenCalledWith('/customer/onboarding/activity');
    });

    it('becomes required, and unskippable, on the body-composition path', async () => {
        await renderStep('body-fat', {
            ...answersThrough('body-fat'),
            calculationBasis: 'body_composition',
            sexForCalculation: null,
        });

        expect(screen.getByTestId('onboarding-body-fat-required')).toBeTruthy();
        expect(screen.queryByTestId('onboarding-skip')).toBeNull();

        await fireEvent.press(screen.getByTestId('onboarding-next'));
        await waitFor(() => {
            expect(screen.getByTestId('onboarding-body-fat-error')).toBeTruthy();
        });
    });
});

describe('step 8 — activity', () => {
    it('never shows a bare multiplier: every band gets a sentence', async () => {
        await renderStep('activity', answersThrough('activity'));

        for (const level of [
            'sedentary',
            'lightly_active',
            'moderately_active',
            'very_active',
            'extra_active',
        ]) {
            expect(screen.getByTestId(`onboarding-activity-guide-${level}`)).toBeTruthy();
        }
    });
});

describe('step 10 — pace', () => {
    it('carries standing safety copy, and flags the combination the engine will flag', async () => {
        const answers = answersThrough('pace');
        const { view } = await renderStep('pace', answers);
        expect(screen.getByTestId('onboarding-pace-safety')).toBeTruthy();
        expect(screen.queryByTestId('onboarding-pace-flagged')).toBeNull();
        view.unmount();

        await renderStep('pace', { ...answers, goal: 'lose_weight', pace: 'ambitious' });
        expect(screen.getByTestId('onboarding-pace-flagged')).toBeTruthy();
    });
});

describe('steps 11 and 12 — preference, observance, allergy, intolerance', () => {
    it('separates a preference from an observance on the diet step', async () => {
        await renderStep('diet', answersThrough('diet'));

        expect(screen.getByTestId('onboarding-diet')).toBeTruthy();
        expect(screen.getByTestId('onboarding-diet-distinction')).toBeTruthy();
        expect(screen.getByTestId('onboarding-observances')).toBeTruthy();
        expect(screen.getByTestId('onboarding-observances-no_pork')).toBeTruthy();
    });

    it('separates an allergy from an intolerance, and warns about the first', async () => {
        await renderStep('allergies', answersThrough('allergies'));

        expect(screen.getByTestId('onboarding-allergies-severity')).toBeTruthy();
        expect(screen.getByTestId('onboarding-allergies-tree_nut')).toBeTruthy();
        expect(screen.getByTestId('onboarding-intolerances-lactose')).toBeTruthy();
        expect(screen.getByTestId('onboarding-intolerance-badge')).toBeTruthy();
    });

    it('records nothing selected as "none recorded" rather than as unanswered', async () => {
        await renderStep('allergies', {
            ...answersThrough('allergies'),
            allergies: [],
            intolerances: [],
        });

        expect(screen.getByTestId('onboarding-allergies-empty')).toBeTruthy();
        expect(screen.getByTestId('onboarding-intolerances-empty')).toBeTruthy();
    });
});

describe('step 13 — medical and dietitian restrictions', () => {
    it('shows a dietitian restriction from the stored target, read-only', async () => {
        await renderStep('restrictions', answersThrough('restrictions'));

        await waitFor(() => {
            expect(screen.getByTestId('onboarding-enforced-list')).toBeTruthy();
        });
        // The prototype world's dietitian set an added-sugar limit.
        expect(screen.getByTestId('onboarding-enforced-added_sugar')).toBeTruthy();
        expect(screen.getByTestId('onboarding-enforced-readonly')).toBeTruthy();
        // And it is not offered as a chip anybody can untick.
        expect(screen.queryByTestId('onboarding-self-declared-added_sugar-check')).toBeNull();
    });

    it('says plainly when no dietitian has set anything', async () => {
        await renderStep('restrictions', answersThrough('restrictions'), {
            scenario: 'consumer-onboarding',
        });

        await waitFor(() => {
            expect(screen.getByTestId('onboarding-enforced-empty')).toBeTruthy();
        });
    });

    it('shows its own loading state while the stored target is being read', async () => {
        await renderStep('restrictions', answersThrough('restrictions'), { settle: false });
        expect(screen.getByTestId('onboarding-enforced-loading')).toBeTruthy();
        await waitFor(() => screen.getByTestId('onboarding-enforced-list'));
    });
});

describe('steps 18 and 19 — meals and their times', () => {
    it('resizes the slot list when the counts change, keeping what was already set', () => {
        const three = resizeMealSlots([], 3, 1);
        expect(three).toHaveLength(4);
        expect(three.filter((slot) => slot.isSnack)).toHaveLength(1);

        const edited = three.map((slot) =>
            slot.key === 'meal-1' ? { ...slot, time: '06:15' } : slot,
        );
        const two = resizeMealSlots(edited, 2, 0);
        expect(two).toHaveLength(2);
        expect(two[0]?.time).toBe('06:15');

        const backToThree = resizeMealSlots(two, 3, 1);
        expect(backToThree[0]?.time).toBe('06:15');
    });

    it('renders a control pair per slot', async () => {
        await renderStep('meal-times', answersThrough('meal-times'));

        expect(screen.getByTestId('onboarding-meal-slots')).toBeTruthy();
        expect(screen.getByTestId('onboarding-meal-slot-meal-1-type')).toBeTruthy();
        expect(screen.getByTestId('onboarding-meal-slot-meal-1-time')).toBeTruthy();
        expect(screen.getByTestId('onboarding-meal-slot-snack-1-time')).toBeTruthy();
    });

    it('rejects main meals that are out of order but leaves snacks alone', () => {
        const t = (key: string) => key;
        const scrambled = completeAnswers({
            mealSlots: [
                { key: 'meal-1', mealType: 'breakfast', time: '20:00', isSnack: false },
                { key: 'meal-2', mealType: 'lunch', time: '07:30', isSnack: false },
                { key: 'snack-1', mealType: 'snack', time: '05:00', isSnack: true },
            ],
        });
        expect(validateStep('meal-times', scrambled, t)['mealSlots']).toBeDefined();

        const ordered = completeAnswers({
            mealSlots: [
                { key: 'meal-1', mealType: 'breakfast', time: '07:30', isSnack: false },
                { key: 'meal-2', mealType: 'lunch', time: '13:00', isSnack: false },
                { key: 'snack-1', mealType: 'snack', time: '05:00', isSnack: true },
            ],
        });
        expect(validateStep('meal-times', ordered, t)).toEqual({});
    });
});

/* ------------------------------------------------------------------------------------------------
 * Summary and submission
 * ---------------------------------------------------------------------------------------------- */

describe('step 21 — the summary', () => {
    it('shows a live preview calculated through the repository', async () => {
        await renderStep('summary', completeAnswers(), { settle: false });

        // The preview renders a skeleton while the calculation is in flight. Against a
        // zero-latency repository the request can resolve inside `render`, so which of the two
        // states is on screen at this instant is a race the test must not depend on — the same
        // "either is correct, neither is not" convention the consumer-home test uses. What is
        // asserted strictly is that the settled content arrives, below.
        expect(
            screen.queryByTestId('onboarding-summary-preview-loading') ??
                screen.queryByTestId('onboarding-summary-preview-content'),
        ).toBeTruthy();

        await waitFor(() => {
            expect(screen.getByTestId('onboarding-summary-preview-content')).toBeTruthy();
        });
        expect(screen.getByTestId('onboarding-summary-target')).toBeTruthy();
        expect(screen.getByTestId('onboarding-summary-maintenance')).toBeTruthy();
    });

    it('groups every answer with a way back to the step that asked it', async () => {
        await renderStep('summary', completeAnswers());

        for (const section of ['aboutYou', 'yourGoal', 'whatYouEat', 'howYouCook']) {
            expect(screen.getByTestId(`onboarding-summary-${section}`)).toBeTruthy();
        }
        expect(screen.getByTestId('onboarding-summary-value-age')).toBeTruthy();

        await fireEvent.press(screen.getByTestId('onboarding-summary-edit-age'));
        expect(routerMock.__push).toHaveBeenCalledWith('/customer/onboarding/age');
    });

    it('will not finish until the caveat is acknowledged', async () => {
        await renderStep('summary', completeAnswers({ summaryAcknowledged: false }));

        await fireEvent.press(screen.getByTestId('onboarding-next'));
        await waitFor(() => {
            expect(screen.getByTestId('onboarding-summary-acknowledge-error')).toBeTruthy();
        });
        expect(routerMock.__replace).not.toHaveBeenCalled();
    });

    it('saves through the repository and routes on what the engine said', async () => {
        // A gentle maintenance target with no medical answers raises no review flag, so the
        // completion goes straight to the nutrition page.
        const clean = completeAnswers({
            goal: 'maintain',
            pace: 'gentle',
            allergies: [],
            selfDeclaredMedical: [],
            intolerances: [],
            observances: [],
        });
        const { repositories } = await renderStep('summary', clean, {
            scenario: 'consumer-onboarding',
            settle: false,
        });

        await waitFor(() => screen.getByTestId('onboarding-summary-preview-content'));
        await fireEvent.press(screen.getByTestId('onboarding-next'));

        await waitFor(() => {
            expect(routerMock.__replace).toHaveBeenCalledWith('/customer/nutrition');
        });

        // The target really was stored, in a world that started without one.
        const stored = await repositories.nutrition.getCurrentTargets();
        expect(stored).not.toBeNull();
        expect(stored?.result.prototype).toBe(true);
    });

    it('routes to the warning step when the engine asks for a review', async () => {
        await renderStep('summary', completeAnswers({ goal: 'lose_weight', pace: 'ambitious' }), {
            scenario: 'consumer-onboarding',
            settle: false,
        });

        await waitFor(() => screen.getByTestId('onboarding-summary-preview-content'));
        expect(screen.getByTestId('onboarding-summary-review-flag')).toBeTruthy();

        await fireEvent.press(screen.getByTestId('onboarding-next'));

        await waitFor(() => {
            expect(routerMock.__push).toHaveBeenCalledWith('/customer/onboarding/review');
        });
    });
});

describe('step 22 — the professional-review warning', () => {
    it('lists the engine reasons and offers a real review request', async () => {
        const { repositories } = await renderStep(
            'review',
            completeAnswers({ professionalReviewAcknowledged: false }),
        );

        await waitFor(() => {
            expect(screen.getByTestId('onboarding-review-warning')).toBeTruthy();
        });
        expect(screen.getByTestId('onboarding-review-reasons')).toBeTruthy();

        await fireEvent.press(screen.getByTestId('onboarding-review-request'));

        await waitFor(() => {
            expect(screen.getByTestId('onboarding-review-requested')).toBeTruthy();
        });

        // The request reached the professional queue rather than only the screen.
        const queue = await repositories.professional.listReviewQueue({
            subjects: ['nutrition_target'],
        });
        expect(queue.items.length).toBeGreaterThan(0);
    });

    it('requires the acknowledgement before continuing anyway', async () => {
        await renderStep('review', completeAnswers({ professionalReviewAcknowledged: false }));

        await waitFor(() => screen.getByTestId('onboarding-review-warning'));

        // The control is live rather than disabled: pressing it explains the refusal on the
        // acknowledgement itself instead of silently doing nothing.
        await fireEvent.press(screen.getByTestId('onboarding-review-continue'));
        expect(routerMock.__replace).not.toHaveBeenCalled();
        await waitFor(() => {
            expect(screen.getByTestId('onboarding-review-acknowledge-error')).toBeTruthy();
        });

        await fireEvent.press(screen.getByTestId('onboarding-review-acknowledge-control'));
        await fireEvent.press(screen.getByTestId('onboarding-review-continue'));

        await waitFor(() => {
            expect(routerMock.__replace).toHaveBeenCalledWith('/customer/nutrition');
        });
    });

    it('shows its own loading state', async () => {
        await renderStep('review', completeAnswers(), { settle: false });
        expect(screen.getByTestId('onboarding-review-loading')).toBeTruthy();
        await waitFor(() => screen.getByTestId('onboarding-review-warning'));
    });
});

/* ------------------------------------------------------------------------------------------------
 * The request the engine actually receives
 * ---------------------------------------------------------------------------------------------- */

describe('the calculation request', () => {
    it('is null until every answering step is done', () => {
        expect(toTargetRequest(INITIAL_ANSWERS)).toBeNull();
        expect(toTargetRequest(completeAnswers())).not.toBeNull();
    });

    it('forces the method the person chose rather than letting the engine infer one', () => {
        const measured = toTargetRequest(
            completeAnswers({ bodyFatPercentage: 27, bodyFatSkipped: false }),
        );
        expect(measured?.method).toBe('mifflin_st_jeor');
        expect(measured?.bodyFatPercentage).toBe(27);

        const composition = toTargetRequest(
            completeAnswers({
                calculationBasis: 'body_composition',
                sexForCalculation: null,
                bodyFatPercentage: 27,
                bodyFatSkipped: false,
            }),
        );
        expect(composition?.method).toBe('katch_mcardle');
    });

    it('applies the more cautious minimum-intake guard when nobody supplied a constant', () => {
        const request = toTargetRequest(
            completeAnswers({
                calculationBasis: 'body_composition',
                sexForCalculation: null,
                bodyFatPercentage: 27,
                bodyFatSkipped: false,
            }),
        );
        expect(request?.sexForCalculation).toBe(DECLINED_SEX_FALLBACK);
        expect(ENERGY_FLOOR_KCAL[DECLINED_SEX_FALLBACK]).toBeGreaterThan(ENERGY_FLOOR_KCAL.female);
    });

    it('carries every constraint the person supplied, and counts snacks as meals', () => {
        const request = toTargetRequest(completeAnswers());
        expect(request?.mealsPerDay).toBe(4);
        expect(new Set(request?.constraints?.map((c) => c.kind))).toEqual(
            new Set([
                'allergy',
                'intolerance',
                'religious',
                'self_declared_medical',
                'dislike',
                'preference',
            ]),
        );
    });

    it('produces something the real engine accepts', () => {
        const request = toTargetRequest(completeAnswers());
        const result = new MockNutritionTargetEngine().calculate(request!);
        expect(result.prototype).toBe(true);
        expect(result.targetEnergy).toBeGreaterThan(0);
        expect(result.reviewReasons).toContain('safety_critical_restriction');
    });

    it('converts a budget to integer minor units, and keeps "no ceiling" distinct from zero', () => {
        expect(weeklyBudgetMoney(completeAnswers({ weeklyBudgetMajor: 450 }))).toEqual({
            amount: 45000,
            currency: 'AED',
        });
        expect(weeklyBudgetMoney(completeAnswers({ weeklyBudgetMajor: 0 }))).toEqual({
            amount: 0,
            currency: 'AED',
        });
        expect(weeklyBudgetMoney(completeAnswers({ weeklyBudgetMajor: null }))).toBeNull();
    });
});

/* ------------------------------------------------------------------------------------------------
 * The reducer
 * ---------------------------------------------------------------------------------------------- */

describe('the reducer', () => {
    it('toggles a code on and off', () => {
        const once = onboardingReducer(INITIAL_ANSWERS, {
            type: 'toggle',
            field: 'allergies',
            code: 'egg',
        });
        expect(once.allergies).toEqual(['egg']);

        const twice = onboardingReducer(once, {
            type: 'toggle',
            field: 'allergies',
            code: 'egg',
        });
        expect(twice.allergies).toEqual([]);
    });

    it('clears a stale skip when the body-composition path is chosen', () => {
        const skipped = { ...INITIAL_ANSWERS, bodyFatSkipped: true };
        const switched = onboardingReducer(skipped, {
            type: 'set',
            patch: { calculationBasis: 'body_composition' },
        });
        expect(switched.bodyFatSkipped).toBe(false);
    });

    it('rebuilds the slot list when the counts change', () => {
        const state = onboardingReducer(INITIAL_ANSWERS, {
            type: 'setMealCounts',
            meals: 2,
            snacks: 1,
        });
        expect(state.mealSlots).toHaveLength(3);

        const edited = onboardingReducer(state, {
            type: 'setMealSlot',
            key: 'meal-1',
            patch: { time: '08:00' },
        });
        expect(edited.mealSlots[0]?.time).toBe('08:00');
    });

    it('resets to nothing', () => {
        expect(onboardingReducer(completeAnswers(), { type: 'reset' })).toEqual(INITIAL_ANSWERS);
    });
});

/* ------------------------------------------------------------------------------------------------
 * Schemas
 * ---------------------------------------------------------------------------------------------- */

describe('step validation', () => {
    const t = (key: string) => key;

    it('reports a bounded number outside its range', () => {
        expect(validateStep('age', completeAnswers({ ageYears: 4 }), t)['ageYears']).toBe(
            'onboarding:validation.range',
        );
        expect(validateStep('age', completeAnswers({ ageYears: 34 }), t)).toEqual({});
    });

    it('accepts an empty answer where empty is an answer', () => {
        expect(
            validateStep('allergies', completeAnswers({ allergies: [], intolerances: [] }), t),
        ).toEqual({});
        expect(validateStep('budget', completeAnswers({ weeklyBudgetMajor: null }), t)).toEqual({});
    });

    it('demands a body-fat figure only on the path that needs one', () => {
        const declined = completeAnswers({
            calculationBasis: 'body_composition',
            bodyFatPercentage: null,
            bodyFatSkipped: false,
        });
        expect(validateStep('body-fat', declined, t)['bodyFatPercentage']).toBe(
            'onboarding:validation.bodyFatNeeded',
        );

        const skipped = completeAnswers({ bodyFatPercentage: null, bodyFatSkipped: true });
        expect(validateStep('body-fat', skipped, t)).toEqual({});
    });
});
