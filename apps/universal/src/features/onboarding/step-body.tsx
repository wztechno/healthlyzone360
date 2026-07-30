import {
    Badge,
    Callout,
    Card,
    Checkbox,
    Inline,
    NumberStepper,
    SegmentedControl,
    Select,
    Stack,
    Text,
} from '@healthy360/design-system';
import type { SelectOption } from '@healthy360/design-system';
import type {
    ActivityLevel,
    DietClassification,
    HealthGoal,
    MealType,
    MeasurementSystem,
    TargetPace,
} from '@healthy360/domain-types';
import type { PreparationMode } from '@healthy360/api-client/contracts';
import type { CalculationSex, NutritionConstraint } from '@healthy360/nutrition';
import { useTranslation } from 'react-i18next';

import { MedicalDisclaimer } from '../../safety/medical-disclaimer.tsx';
import { constraintLabelKey } from './constraints.ts';
import { ChipGroup, OptionGuide, StepIntro, StepRow } from './step-parts.tsx';
import { restrictionPresentation } from './steps.ts';
import type { OnboardingStepSlug } from './steps.ts';
import { BUDGET_CURRENCY, resizeMealSlots } from './state.ts';
import type { OnboardingAction, OnboardingAnswers } from './state.ts';
import type { StepErrors } from './schemas.ts';
import {
    ACTIVITY_LEVELS,
    ALLERGEN_CODES,
    BOUNDS,
    COOKING_SKILLS,
    CUISINE_CODES,
    DIET_CLASSIFICATIONS,
    DISLIKE_CODES,
    INTOLERANCE_CODES,
    MEAL_TIME_OPTIONS,
    MEAL_TYPES,
    MEDICAL_TOPIC_CODES,
    OBSERVANCE_CODES,
    fromFeetAndInches,
    fromPounds,
    toFeetAndInches,
    toPounds,
} from './vocabularies.ts';
import type { CookingSkill, CuisineCode } from './vocabularies.ts';

/**
 * The twenty-two step bodies.
 *
 * One module, because they are one thing: a step is a heading, an explanation, one or two controls
 * and an error. Splitting them across twenty-two files would multiply the import ceremony by
 * twenty-two and hide the fact that the whole wizard shares four control patterns.
 *
 * Every body is a pure function of `answers` and `errors` and communicates only through `dispatch`.
 * No body reads a repository except `restrictions`, which is handed the dietitian's constraints by
 * the shell — the one thing on this journey that is not the person's own answer.
 */

export interface StepBodyProps {
    readonly slug: OnboardingStepSlug;
    readonly answers: OnboardingAnswers;
    readonly errors: StepErrors;
    readonly dispatch: (action: OnboardingAction) => void;
    /** `dietitian_enforced` constraints read from the stored target. Read-only on this journey. */
    readonly enforced: readonly NutritionConstraint[];
    /** True while the stored target is still being read, for the restrictions step's own state. */
    readonly enforcedPending: boolean;
    /** The stored target could not be read. The step says so rather than showing an empty list. */
    readonly enforcedFailed: boolean;
}

const TEST_ID = 'onboarding-step';

export function StepBody(props: StepBodyProps) {
    switch (props.slug) {
        case 'introduction':
            return <IntroductionStep {...props} />;
        case 'units':
            return <UnitsStep {...props} />;
        case 'age':
            return <AgeStep {...props} />;
        case 'calculation-basis':
            return <CalculationBasisStep {...props} />;
        case 'height':
            return <HeightStep {...props} />;
        case 'weight':
            return <WeightStep {...props} />;
        case 'body-fat':
            return <BodyFatStep {...props} />;
        case 'activity':
            return <ActivityStep {...props} />;
        case 'goal':
            return <GoalStep {...props} />;
        case 'pace':
            return <PaceStep {...props} />;
        case 'diet':
            return <DietStep {...props} />;
        case 'allergies':
            return <AllergiesStep {...props} />;
        case 'restrictions':
            return <RestrictionsStep {...props} />;
        case 'dislikes':
            return <DislikesStep {...props} />;
        case 'cuisines':
            return <CuisinesStep {...props} />;
        case 'budget':
            return <BudgetStep {...props} />;
        case 'cooking':
            return <CookingStep {...props} />;
        case 'meals':
            return <MealsStep {...props} />;
        case 'meal-times':
            return <MealTimesStep {...props} />;
        case 'preparation':
            return <PreparationStep {...props} />;
        /* The last two steps are screens in their own right; the shell renders them directly. */
        case 'summary':
        case 'review':
            return null;
    }
}

/* ── 1 · introduction ────────────────────────────────────────────────────────────────────────── */

function IntroductionStep({ answers, errors, dispatch }: StepBodyProps) {
    const { t } = useTranslation();

    return (
        <Stack space="md" testID={`${TEST_ID}-introduction`}>
            <StepIntro
                title={t('onboarding:steps.introduction.title')}
                lead={t('onboarding:steps.introduction.lead')}
                testID={`${TEST_ID}-introduction`}
            />

            <Card padding="md" tone="sunken" testID="onboarding-introduction-promises">
                <Stack space="sm">
                    {(['whatWeAsk', 'whatWeDo', 'whatWeDoNot', 'notSaved'] as const).map((key) => (
                        <Stack space="none" key={key} testID={`onboarding-introduction-${key}`}>
                            <Text variant="bodyStrong">
                                {t(`onboarding:steps.introduction.promises.${key}.title`)}
                            </Text>
                            <Text tone="secondary" variant="caption">
                                {t(`onboarding:steps.introduction.promises.${key}.body`)}
                            </Text>
                        </Stack>
                    ))}
                </Stack>
            </Card>

            <MedicalDisclaimer context={t('onboarding:disclaimerContext')} />

            <Checkbox
                testID="onboarding-introduction-acknowledge"
                label={t('onboarding:steps.introduction.acknowledge')}
                checked={answers.introductionAcknowledged}
                onChange={(checked) => {
                    dispatch({ type: 'set', patch: { introductionAcknowledged: checked } });
                }}
                {...fieldError(errors, 'introductionAcknowledged')}
            />
        </Stack>
    );
}

/* ── 2 · units ───────────────────────────────────────────────────────────────────────────────── */

function UnitsStep({ answers, dispatch }: StepBodyProps) {
    const { t } = useTranslation();

    return (
        <Stack space="md" testID={`${TEST_ID}-units`}>
            <StepIntro
                title={t('onboarding:steps.units.title')}
                lead={t('onboarding:steps.units.lead')}
                testID={`${TEST_ID}-units`}
            />

            <SegmentedControl<MeasurementSystem>
                testID="onboarding-units-control"
                label={t('onboarding:steps.units.title')}
                block
                value={answers.measurementSystem}
                items={[
                    {
                        value: 'metric',
                        label: t('onboarding:units.metric'),
                        testID: 'onboarding-units-metric',
                    },
                    {
                        value: 'imperial',
                        label: t('onboarding:units.imperial'),
                        testID: 'onboarding-units-imperial',
                    },
                ]}
                onChange={(measurementSystem) => {
                    dispatch({ type: 'set', patch: { measurementSystem } });
                }}
            />

            <Callout
                testID="onboarding-units-note"
                role="note"
                tone="info"
                title={t('onboarding:steps.units.noteTitle')}
                body={t('onboarding:steps.units.noteBody')}
            />
        </Stack>
    );
}

/* ── 3 · age ─────────────────────────────────────────────────────────────────────────────────── */

/**
 * Age in years, not a date of birth.
 *
 * The equation takes a whole number of years and nothing else, so asking for a birth date would
 * collect a day and a month the calculation cannot use, put a stable personal identifier into a
 * medical-adjacent record, and buy the person a three-part control instead of one number. Data
 * minimisation is the honest reading of "pick one input", and the copy says why out loud.
 */
function AgeStep({ answers, errors, dispatch }: StepBodyProps) {
    const { t } = useTranslation();

    return (
        <Stack space="md" testID={`${TEST_ID}-age`}>
            <StepIntro
                title={t('onboarding:steps.age.title')}
                lead={t('onboarding:steps.age.lead')}
                testID={`${TEST_ID}-age`}
            />

            <NumberStepper
                testID="onboarding-age"
                label={t('onboarding:steps.age.label')}
                hint={t('onboarding:steps.age.hint')}
                unit={t('onboarding:units.years')}
                required
                min={BOUNDS.ageYears.min}
                max={BOUNDS.ageYears.max}
                value={answers.ageYears}
                onChange={(ageYears) => {
                    dispatch({ type: 'set', patch: { ageYears } });
                }}
                {...fieldError(errors, 'ageYears')}
            />
        </Stack>
    );
}

/* ── 4 · calculation basis and the constant it may need ──────────────────────────────────────── */

/**
 * The step the prompt asks to be shown "only when the selected method requires it".
 *
 * So the method is selected *here*, first, and the sex constant appears underneath it only for the
 * equation that reads one. Choosing body composition retires the question entirely — Katch–McArdle
 * works from fat-free mass and needs neither sex nor height — which is what lets a person decline
 * without being refused a calculation (doc 17, ONB-05).
 *
 * Declining is not free of consequence and the copy says so: the minimum-intake guard is still
 * chosen by that field, so the more cautious of the two is applied. Saying that before the choice
 * is what makes it a choice rather than a surprise.
 */
function CalculationBasisStep({ answers, errors, dispatch }: StepBodyProps) {
    const { t } = useTranslation();
    const usesBodyComposition = answers.calculationBasis === 'body_composition';

    return (
        <Stack space="md" testID={`${TEST_ID}-calculation-basis`}>
            <StepIntro
                title={t('onboarding:steps.calculationBasis.title')}
                lead={t('onboarding:steps.calculationBasis.lead')}
                testID={`${TEST_ID}-calculation-basis`}
            />

            <SegmentedControl
                testID="onboarding-basis-control"
                label={t('onboarding:steps.calculationBasis.methodLabel')}
                block
                value={answers.calculationBasis}
                items={[
                    {
                        value: 'measurements',
                        label: t('onboarding:calculationBasis.measurements'),
                        testID: 'onboarding-basis-measurements',
                    },
                    {
                        value: 'body_composition',
                        label: t('onboarding:calculationBasis.bodyComposition'),
                        testID: 'onboarding-basis-body-composition',
                    },
                ]}
                onChange={(calculationBasis) => {
                    dispatch({
                        type: 'set',
                        patch: {
                            calculationBasis,
                            // Switching to body composition retires the constant rather than
                            // keeping a stale answer nothing will read.
                            ...(calculationBasis === 'body_composition'
                                ? { sexForCalculation: null }
                                : {}),
                        },
                    });
                }}
            />

            <OptionGuide
                testID="onboarding-basis-guide"
                title={t('onboarding:steps.calculationBasis.guideTitle')}
                selectedKey={answers.calculationBasis}
                entries={[
                    {
                        key: 'measurements',
                        label: t('onboarding:calculationBasis.measurements'),
                        description: t('onboarding:calculationBasis.measurementsDetail'),
                    },
                    {
                        key: 'body_composition',
                        label: t('onboarding:calculationBasis.bodyComposition'),
                        description: t('onboarding:calculationBasis.bodyCompositionDetail'),
                    },
                ]}
            />

            {usesBodyComposition ? (
                <Callout
                    testID="onboarding-basis-declined"
                    role="note"
                    tone="info"
                    title={t('onboarding:steps.calculationBasis.declinedTitle')}
                    body={t('onboarding:steps.calculationBasis.declinedBody')}
                />
            ) : (
                <Stack space="sm" testID="onboarding-sex-section">
                    <Callout
                        testID="onboarding-sex-why"
                        role="note"
                        tone="info"
                        title={t('onboarding:steps.calculationBasis.whyTitle')}
                        body={t('onboarding:steps.calculationBasis.whyBody')}
                    />
                    <SegmentedControl<CalculationSex>
                        testID="onboarding-sex-control"
                        label={t('onboarding:steps.calculationBasis.sexLabel')}
                        block
                        value={answers.sexForCalculation ?? ('' as CalculationSex)}
                        items={[
                            {
                                value: 'female',
                                label: t('onboarding:calculationSex.female'),
                                testID: 'onboarding-sex-female',
                            },
                            {
                                value: 'male',
                                label: t('onboarding:calculationSex.male'),
                                testID: 'onboarding-sex-male',
                            },
                        ]}
                        onChange={(sexForCalculation) => {
                            dispatch({ type: 'set', patch: { sexForCalculation } });
                        }}
                    />
                    {errors['sexForCalculation'] === undefined ? null : (
                        <Text tone="danger" variant="caption" testID="onboarding-sex-error">
                            {errors['sexForCalculation']}
                        </Text>
                    )}
                </Stack>
            )}
        </Stack>
    );
}

/* ── 5 · height ──────────────────────────────────────────────────────────────────────────────── */

/**
 * Compound in imperial, single in metric (doc 17, ONB-02).
 *
 * Both halves write the same stored centimetre figure, so switching units on step 2 after answering
 * here converts the value rather than clearing it — the behaviour doc 17, ONB-03 asks for and the
 * one neither reference could be observed doing.
 */
function HeightStep({ answers, errors, dispatch }: StepBodyProps) {
    const { t } = useTranslation();
    const imperial = answers.measurementSystem === 'imperial';
    const parts = toFeetAndInches(answers.heightCentimetres ?? 0);

    const setImperial = (feet: number, inches: number) => {
        dispatch({
            type: 'set',
            patch: { heightCentimetres: fromFeetAndInches(feet, inches) },
        });
    };

    return (
        <Stack space="md" testID={`${TEST_ID}-height`}>
            <StepIntro
                title={t('onboarding:steps.height.title')}
                lead={t('onboarding:steps.height.lead')}
                testID={`${TEST_ID}-height`}
            />

            {imperial ? (
                <Stack space="xs">
                    <StepRow testID="onboarding-height-imperial">
                        <NumberStepper
                            testID="onboarding-height-feet"
                            label={t('onboarding:units.feet')}
                            required
                            min={BOUNDS.heightFeet.min}
                            max={BOUNDS.heightFeet.max}
                            value={answers.heightCentimetres === null ? null : parts.feet}
                            onChange={(feet) => {
                                setImperial(feet ?? 0, parts.inches);
                            }}
                        />
                        <NumberStepper
                            testID="onboarding-height-inches"
                            label={t('onboarding:units.inches')}
                            required
                            min={BOUNDS.heightInches.min}
                            max={BOUNDS.heightInches.max}
                            value={answers.heightCentimetres === null ? null : parts.inches}
                            onChange={(inches) => {
                                setImperial(parts.feet, inches ?? 0);
                            }}
                        />
                    </StepRow>
                    {errors['heightCentimetres'] === undefined ? null : (
                        <Text tone="danger" variant="caption" testID="onboarding-height-error">
                            {errors['heightCentimetres']}
                        </Text>
                    )}
                </Stack>
            ) : (
                <NumberStepper
                    testID="onboarding-height"
                    label={t('onboarding:steps.height.label')}
                    unit={t('onboarding:units.centimetres')}
                    required
                    min={BOUNDS.heightCentimetres.min}
                    max={BOUNDS.heightCentimetres.max}
                    value={answers.heightCentimetres}
                    onChange={(heightCentimetres) => {
                        dispatch({ type: 'set', patch: { heightCentimetres } });
                    }}
                    {...fieldError(errors, 'heightCentimetres')}
                />
            )}
        </Stack>
    );
}

/* ── 6 · weight ──────────────────────────────────────────────────────────────────────────────── */

function WeightStep({ answers, errors, dispatch }: StepBodyProps) {
    const { t } = useTranslation();
    const imperial = answers.measurementSystem === 'imperial';

    return (
        <Stack space="md" testID={`${TEST_ID}-weight`}>
            <StepIntro
                title={t('onboarding:steps.weight.title')}
                lead={t('onboarding:steps.weight.lead')}
                testID={`${TEST_ID}-weight`}
            />

            {imperial ? (
                <Stack space="xs">
                    <NumberStepper
                        testID="onboarding-weight-pounds"
                        label={t('onboarding:steps.weight.label')}
                        unit={t('onboarding:units.pounds')}
                        required
                        min={BOUNDS.weightPounds.min}
                        max={BOUNDS.weightPounds.max}
                        value={
                            answers.weightKilograms === null
                                ? null
                                : toPounds(answers.weightKilograms)
                        }
                        onChange={(pounds) => {
                            dispatch({
                                type: 'set',
                                patch: {
                                    weightKilograms: pounds === null ? null : fromPounds(pounds),
                                },
                            });
                        }}
                    />
                    {errors['weightKilograms'] === undefined ? null : (
                        <Text tone="danger" variant="caption" testID="onboarding-weight-error">
                            {errors['weightKilograms']}
                        </Text>
                    )}
                </Stack>
            ) : (
                <NumberStepper
                    testID="onboarding-weight"
                    label={t('onboarding:steps.weight.label')}
                    unit={t('onboarding:units.kilograms')}
                    required
                    min={BOUNDS.weightKilograms.min}
                    max={BOUNDS.weightKilograms.max}
                    value={answers.weightKilograms}
                    onChange={(weightKilograms) => {
                        dispatch({ type: 'set', patch: { weightKilograms } });
                    }}
                    {...fieldError(errors, 'weightKilograms')}
                />
            )}
        </Stack>
    );
}

/* ── 7 · body fat ────────────────────────────────────────────────────────────────────────────── */

function BodyFatStep({ answers, errors, dispatch }: StepBodyProps) {
    const { t } = useTranslation();
    const required = answers.calculationBasis === 'body_composition';

    return (
        <Stack space="md" testID={`${TEST_ID}-body-fat`}>
            <StepIntro
                title={t('onboarding:steps.bodyFat.title')}
                lead={
                    required
                        ? t('onboarding:steps.bodyFat.leadRequired')
                        : t('onboarding:steps.bodyFat.leadOptional')
                }
                testID={`${TEST_ID}-body-fat`}
            />

            <NumberStepper
                testID="onboarding-body-fat"
                label={t('onboarding:steps.bodyFat.label')}
                hint={t('onboarding:steps.bodyFat.hint')}
                unit="%"
                required={required}
                disabled={answers.bodyFatSkipped}
                min={BOUNDS.bodyFatPercentage.min}
                max={BOUNDS.bodyFatPercentage.max}
                value={answers.bodyFatPercentage}
                onChange={(bodyFatPercentage) => {
                    dispatch({
                        type: 'set',
                        patch: { bodyFatPercentage, bodyFatSkipped: false },
                    });
                }}
                {...fieldError(errors, 'bodyFatPercentage')}
            />

            {required ? (
                <Callout
                    testID="onboarding-body-fat-required"
                    role="note"
                    tone="info"
                    title={t('onboarding:steps.bodyFat.requiredTitle')}
                    body={t('onboarding:steps.bodyFat.requiredBody')}
                />
            ) : (
                <Checkbox
                    testID="onboarding-body-fat-skip"
                    label={t('onboarding:steps.bodyFat.skip')}
                    description={t('onboarding:steps.bodyFat.skipHint')}
                    checked={answers.bodyFatSkipped}
                    onChange={(bodyFatSkipped) => {
                        dispatch({
                            type: 'set',
                            patch: {
                                bodyFatSkipped,
                                ...(bodyFatSkipped ? { bodyFatPercentage: null } : {}),
                            },
                        });
                    }}
                />
            )}

            <Callout
                testID="onboarding-body-fat-no-bands"
                role="note"
                tone="info"
                title={t('onboarding:steps.bodyFat.noBandsTitle')}
                body={t('onboarding:steps.bodyFat.noBandsBody')}
            />
        </Stack>
    );
}

/* ── 8 · activity ────────────────────────────────────────────────────────────────────────────── */

function ActivityStep({ answers, errors, dispatch }: StepBodyProps) {
    const { t } = useTranslation();

    const options: readonly SelectOption<ActivityLevel>[] = ACTIVITY_LEVELS.map((level) => ({
        value: level,
        label: t(`onboarding:activityLevels.${level}.label`),
        description: t(`onboarding:activityLevels.${level}.description`),
    }));

    return (
        <Stack space="md" testID={`${TEST_ID}-activity`}>
            <StepIntro
                title={t('onboarding:steps.activity.title')}
                lead={t('onboarding:steps.activity.lead')}
                testID={`${TEST_ID}-activity`}
            />

            <Select<ActivityLevel>
                testID="onboarding-activity"
                label={t('onboarding:steps.activity.label')}
                required
                options={options}
                value={answers.activityLevel}
                placeholder={t('onboarding:steps.activity.placeholder')}
                onChange={(activityLevel) => {
                    dispatch({ type: 'set', patch: { activityLevel } });
                }}
                {...fieldError(errors, 'activityLevel')}
            />

            <OptionGuide
                testID="onboarding-activity-guide"
                title={t('onboarding:steps.activity.guideTitle')}
                selectedKey={answers.activityLevel}
                entries={ACTIVITY_LEVELS.map((level) => ({
                    key: level,
                    label: t(`onboarding:activityLevels.${level}.label`),
                    description: t(`onboarding:activityLevels.${level}.description`),
                }))}
            />
        </Stack>
    );
}

/* ── 9 · goal ────────────────────────────────────────────────────────────────────────────────── */

const HEALTH_GOALS: readonly HealthGoal[] = [
    'lose_weight',
    'maintain',
    'gain_muscle',
    'recomposition',
];

function GoalStep({ answers, errors, dispatch }: StepBodyProps) {
    const { t } = useTranslation();

    return (
        <Stack space="md" testID={`${TEST_ID}-goal`}>
            <StepIntro
                title={t('onboarding:steps.goal.title')}
                lead={t('onboarding:steps.goal.lead')}
                testID={`${TEST_ID}-goal`}
            />

            <Select<HealthGoal>
                testID="onboarding-goal"
                label={t('onboarding:steps.goal.label')}
                required
                options={HEALTH_GOALS.map((goal) => ({
                    value: goal,
                    label: t(`onboarding:goals.${goal}.label`),
                    description: t(`onboarding:goals.${goal}.description`),
                }))}
                value={answers.goal}
                placeholder={t('onboarding:steps.goal.placeholder')}
                onChange={(goal) => {
                    dispatch({ type: 'set', patch: { goal } });
                }}
                {...fieldError(errors, 'goal')}
            />

            <OptionGuide
                testID="onboarding-goal-guide"
                title={t('onboarding:steps.goal.guideTitle')}
                selectedKey={answers.goal}
                entries={HEALTH_GOALS.map((goal) => ({
                    key: goal,
                    label: t(`onboarding:goals.${goal}.label`),
                    description: t(`onboarding:goals.${goal}.description`),
                }))}
            />
        </Stack>
    );
}

/* ── 10 · pace ───────────────────────────────────────────────────────────────────────────────── */

const TARGET_PACES: readonly TargetPace[] = ['gentle', 'standard', 'ambitious'];

/**
 * Pace, with the safety copy attached to the option rather than to the screen.
 *
 * The ambitious pace at a weight-loss goal is one of the engine's own review triggers
 * (`aggressive_deficit`), so the warning here is not decoration: it is the same judgement the
 * calculation will make, said before the person commits to it rather than after.
 */
function PaceStep({ answers, errors, dispatch }: StepBodyProps) {
    const { t } = useTranslation();
    const flagged = answers.pace === 'ambitious' && answers.goal === 'lose_weight';

    return (
        <Stack space="md" testID={`${TEST_ID}-pace`}>
            <StepIntro
                title={t('onboarding:steps.pace.title')}
                lead={t('onboarding:steps.pace.lead')}
                testID={`${TEST_ID}-pace`}
            />

            <SegmentedControl<TargetPace>
                testID="onboarding-pace-control"
                label={t('onboarding:steps.pace.label')}
                block
                value={answers.pace ?? ('' as TargetPace)}
                items={TARGET_PACES.map((pace) => ({
                    value: pace,
                    label: t(`onboarding:paces.${pace}.label`),
                    testID: `onboarding-pace-${pace}`,
                }))}
                onChange={(pace) => {
                    dispatch({ type: 'set', patch: { pace } });
                }}
            />

            <OptionGuide
                testID="onboarding-pace-guide"
                title={t('onboarding:steps.pace.guideTitle')}
                selectedKey={answers.pace}
                entries={TARGET_PACES.map((pace) => ({
                    key: pace,
                    label: t(`onboarding:paces.${pace}.label`),
                    description: t(`onboarding:paces.${pace}.description`),
                }))}
            />

            <Callout
                testID="onboarding-pace-safety"
                role="note"
                tone="warning"
                title={t('onboarding:steps.pace.safetyTitle')}
                body={t('onboarding:steps.pace.safetyBody')}
            />

            {flagged ? (
                <Callout
                    testID="onboarding-pace-flagged"
                    role="status"
                    tone="warning"
                    title={t('onboarding:steps.pace.flaggedTitle')}
                    body={t('onboarding:steps.pace.flaggedBody')}
                />
            ) : null}

            {errors['pace'] === undefined ? null : (
                <Text tone="danger" variant="caption" testID="onboarding-pace-error">
                    {errors['pace']}
                </Text>
            )}
        </Stack>
    );
}

/* ── 11 · diet pattern and observance ────────────────────────────────────────────────────────── */

/**
 * Two questions on one step, because they look the same and are not.
 *
 * A diet classification is a *preference*: it ranks candidates and excludes nothing. An observance
 * is a *religious restriction*: it excludes, and no amount of "we found something similar" is an
 * acceptable answer to it. Collecting them together makes the difference visible at the moment a
 * person answers, which is the only moment the distinction can be explained cheaply.
 */
function DietStep({ answers, errors, dispatch }: StepBodyProps) {
    const { t } = useTranslation();

    return (
        <Stack space="md" testID={`${TEST_ID}-diet`}>
            <StepIntro
                title={t('onboarding:steps.diet.title')}
                lead={t('onboarding:steps.diet.lead')}
                testID={`${TEST_ID}-diet`}
            />

            <Select<DietClassification>
                testID="onboarding-diet"
                label={t('onboarding:steps.diet.label')}
                hint={t('onboarding:steps.diet.hint')}
                required
                options={DIET_CLASSIFICATIONS.map((diet) => ({
                    value: diet,
                    label: t(`onboarding:diets.${diet}`),
                }))}
                value={answers.diet}
                placeholder={t('onboarding:steps.diet.placeholder')}
                onChange={(diet) => {
                    dispatch({ type: 'set', patch: { diet } });
                }}
                {...fieldError(errors, 'diet')}
            />

            <Callout
                testID="onboarding-diet-distinction"
                role="note"
                tone="info"
                title={t('onboarding:steps.diet.distinctionTitle')}
                body={t('onboarding:steps.diet.distinctionBody')}
            />

            <ChipGroup
                testID="onboarding-observances"
                label={t('onboarding:steps.diet.observanceLabel')}
                hint={t('onboarding:steps.diet.observanceHint')}
                emptyLabel={t('onboarding:steps.diet.observanceEmpty')}
                options={OBSERVANCE_CODES.map((code) => ({
                    code,
                    label: t(`onboarding:observances.${code}`),
                }))}
                selected={answers.observances}
                onToggle={(code) => {
                    dispatch({ type: 'toggle', field: 'observances', code });
                }}
            />
        </Stack>
    );
}

/* ── 12 · allergies and intolerances ─────────────────────────────────────────────────────────── */

function AllergiesStep({ answers, dispatch }: StepBodyProps) {
    const { t } = useTranslation();
    const allergy = restrictionPresentation('allergy');
    const intolerance = restrictionPresentation('intolerance');

    return (
        <Stack space="md" testID={`${TEST_ID}-allergies`}>
            <StepIntro
                title={t('onboarding:steps.allergies.title')}
                lead={t('onboarding:steps.allergies.lead')}
                testID={`${TEST_ID}-allergies`}
            />

            <Callout
                testID="onboarding-allergies-severity"
                role="alert"
                tone="danger"
                icon={allergy.icon}
                title={t('onboarding:steps.allergies.severityTitle')}
                body={t('onboarding:steps.allergies.severityBody')}
            />

            <ChipGroup
                testID="onboarding-allergies"
                label={t('onboarding:steps.allergies.label')}
                hint={t('onboarding:steps.allergies.hint')}
                emptyLabel={t('onboarding:steps.allergies.empty')}
                options={ALLERGEN_CODES.map((code) => ({
                    code,
                    label: t(`onboarding:allergens.${code}`),
                }))}
                selected={answers.allergies}
                onToggle={(code) => {
                    dispatch({ type: 'toggle', field: 'allergies', code });
                }}
            />

            <Card padding="md" tone="sunken" testID="onboarding-intolerances-card">
                <Stack space="sm">
                    <Inline space="xs" align="center">
                        <Badge
                            testID="onboarding-intolerance-badge"
                            tone={intolerance.tone}
                            icon={intolerance.icon}
                            label={t('onboarding:restrictionKinds.intolerance.label')}
                        />
                    </Inline>
                    <Text tone="secondary" variant="caption">
                        {t('onboarding:steps.allergies.intoleranceExplainer')}
                    </Text>
                    <ChipGroup
                        testID="onboarding-intolerances"
                        label={t('onboarding:steps.allergies.intoleranceLabel')}
                        emptyLabel={t('onboarding:steps.allergies.intoleranceEmpty')}
                        options={INTOLERANCE_CODES.map((code) => ({
                            code,
                            label: t(`onboarding:intolerances.${code}`),
                        }))}
                        selected={answers.intolerances}
                        onToggle={(code) => {
                            dispatch({ type: 'toggle', field: 'intolerances', code });
                        }}
                    />
                </Stack>
            </Card>
        </Stack>
    );
}

/* ── 13 · medical and dietitian-enforced restrictions ────────────────────────────────────────── */

/**
 * The step where the product's most consequential distinction is made visible.
 *
 * A self-declared medical note and a dietitian-enforced restriction look identical in a list and
 * behave completely differently: the first is the person's own recollection, editable by them, and
 * grounds for review; the second was set by a named professional, may be lifted only by that
 * professional, and is presented here as fact rather than as a control. Rendering the second as an
 * editable chip would be the single most misleading thing this wizard could do.
 */
function RestrictionsStep({
    answers,
    dispatch,
    enforced,
    enforcedPending,
    enforcedFailed,
}: StepBodyProps) {
    const { t } = useTranslation();
    const selfDeclared = restrictionPresentation('self_declared_medical');
    const dietitianEnforced = restrictionPresentation('dietitian_enforced');

    return (
        <Stack space="md" testID={`${TEST_ID}-restrictions`}>
            <StepIntro
                title={t('onboarding:steps.restrictions.title')}
                lead={t('onboarding:steps.restrictions.lead')}
                testID={`${TEST_ID}-restrictions`}
            />

            <Card padding="md" testID="onboarding-self-declared-card">
                <Stack space="sm">
                    <Inline space="xs" align="center">
                        <Badge
                            testID="onboarding-self-declared-badge"
                            tone={selfDeclared.tone}
                            icon={selfDeclared.icon}
                            label={t('onboarding:restrictionKinds.self_declared_medical.label')}
                        />
                    </Inline>
                    <Text tone="secondary" variant="caption">
                        {t('onboarding:steps.restrictions.selfDeclaredExplainer')}
                    </Text>
                    <ChipGroup
                        testID="onboarding-self-declared"
                        label={t('onboarding:steps.restrictions.selfDeclaredLabel')}
                        emptyLabel={t('onboarding:steps.restrictions.selfDeclaredEmpty')}
                        options={MEDICAL_TOPIC_CODES.map((code) => ({
                            code,
                            label: t(`onboarding:medicalTopics.${code}`),
                        }))}
                        selected={answers.selfDeclaredMedical}
                        onToggle={(code) => {
                            dispatch({ type: 'toggle', field: 'selfDeclaredMedical', code });
                        }}
                    />
                </Stack>
            </Card>

            <Card padding="md" tone="sunken" testID="onboarding-enforced-card">
                <Stack space="sm">
                    <Inline space="xs" align="center">
                        <Badge
                            testID="onboarding-enforced-badge"
                            tone={dietitianEnforced.tone}
                            icon={dietitianEnforced.icon}
                            label={t('onboarding:restrictionKinds.dietitian_enforced.label')}
                        />
                    </Inline>
                    <Text tone="secondary" variant="caption">
                        {t('onboarding:steps.restrictions.enforcedExplainer')}
                    </Text>

                    {enforcedPending ? (
                        <Text tone="secondary" testID="onboarding-enforced-loading">
                            {t('onboarding:steps.restrictions.enforcedLoading')}
                        </Text>
                    ) : enforcedFailed ? (
                        <Callout
                            testID="onboarding-enforced-error"
                            role="status"
                            tone="warning"
                            title={t('onboarding:steps.restrictions.enforcedErrorTitle')}
                            body={t('onboarding:steps.restrictions.enforcedErrorBody')}
                        />
                    ) : enforced.length === 0 ? (
                        <Text tone="secondary" testID="onboarding-enforced-empty">
                            {t('onboarding:steps.restrictions.enforcedEmpty')}
                        </Text>
                    ) : (
                        <Stack space="xs" testID="onboarding-enforced-list">
                            {enforced.map((constraint) => (
                                <Inline
                                    key={constraint.code}
                                    space="xs"
                                    align="center"
                                    testID={`onboarding-enforced-${constraint.code}`}
                                >
                                    <Badge
                                        tone={dietitianEnforced.tone}
                                        icon={dietitianEnforced.icon}
                                        label={t(
                                            constraintLabelKey(
                                                'dietitian_enforced',
                                                constraint.code,
                                            ),
                                            { defaultValue: constraint.label },
                                        )}
                                    />
                                    <Text variant="caption" tone="secondary">
                                        {constraint.note ??
                                            t('onboarding:steps.restrictions.enforcedNoNote')}
                                    </Text>
                                </Inline>
                            ))}
                        </Stack>
                    )}

                    <Text variant="caption" tone="secondary" testID="onboarding-enforced-readonly">
                        {t('onboarding:steps.restrictions.enforcedReadOnly')}
                    </Text>
                </Stack>
            </Card>
        </Stack>
    );
}

/* ── 14 · dislikes ───────────────────────────────────────────────────────────────────────────── */

function DislikesStep({ answers, dispatch }: StepBodyProps) {
    const { t } = useTranslation();
    const dislike = restrictionPresentation('dislike');

    return (
        <Stack space="md" testID={`${TEST_ID}-dislikes`}>
            <StepIntro
                title={t('onboarding:steps.dislikes.title')}
                lead={t('onboarding:steps.dislikes.lead')}
                testID={`${TEST_ID}-dislikes`}
            />

            <Callout
                testID="onboarding-dislikes-note"
                role="note"
                tone="info"
                icon={dislike.icon}
                title={t('onboarding:steps.dislikes.noteTitle')}
                body={t('onboarding:steps.dislikes.noteBody')}
            />

            <ChipGroup
                testID="onboarding-dislikes"
                label={t('onboarding:steps.dislikes.label')}
                emptyLabel={t('onboarding:steps.dislikes.empty')}
                options={DISLIKE_CODES.map((code) => ({
                    code,
                    label: t(`onboarding:dislikes.${code}`),
                }))}
                selected={answers.dislikedIngredients}
                onToggle={(code) => {
                    dispatch({ type: 'toggle', field: 'dislikedIngredients', code });
                }}
            />
        </Stack>
    );
}

/* ── 15 · cuisines ───────────────────────────────────────────────────────────────────────────── */

function CuisinesStep({ answers, dispatch }: StepBodyProps) {
    const { t } = useTranslation();

    return (
        <Stack space="md" testID={`${TEST_ID}-cuisines`}>
            <StepIntro
                title={t('onboarding:steps.cuisines.title')}
                lead={t('onboarding:steps.cuisines.lead')}
                testID={`${TEST_ID}-cuisines`}
            />

            <ChipGroup
                testID="onboarding-cuisines"
                label={t('onboarding:steps.cuisines.label')}
                emptyLabel={t('onboarding:steps.cuisines.empty')}
                options={CUISINE_CODES.map((code) => ({
                    code,
                    label: t(`onboarding:cuisines.${code}`),
                }))}
                selected={answers.preferredCuisines}
                onToggle={(code) => {
                    dispatch({ type: 'toggleCuisine', code: code as CuisineCode });
                }}
            />
        </Stack>
    );
}

/* ── 16 · budget ─────────────────────────────────────────────────────────────────────────────── */

function BudgetStep({ answers, errors, dispatch }: StepBodyProps) {
    const { t } = useTranslation();

    return (
        <Stack space="md" testID={`${TEST_ID}-budget`}>
            <StepIntro
                title={t('onboarding:steps.budget.title')}
                lead={t('onboarding:steps.budget.lead')}
                testID={`${TEST_ID}-budget`}
            />

            <NumberStepper
                testID="onboarding-budget"
                label={t('onboarding:steps.budget.label')}
                hint={t('onboarding:steps.budget.hint')}
                unit={BUDGET_CURRENCY}
                step={25}
                min={BOUNDS.weeklyBudget.min}
                max={BOUNDS.weeklyBudget.max}
                value={answers.weeklyBudgetMajor}
                onChange={(weeklyBudgetMajor) => {
                    dispatch({ type: 'set', patch: { weeklyBudgetMajor } });
                }}
                {...fieldError(errors, 'weeklyBudgetMajor')}
            />

            <Callout
                testID="onboarding-budget-note"
                role="note"
                tone="info"
                title={t('onboarding:steps.budget.noteTitle')}
                body={t('onboarding:steps.budget.noteBody')}
            />
        </Stack>
    );
}

/* ── 17 · cooking availability ───────────────────────────────────────────────────────────────── */

function CookingStep({ answers, errors, dispatch }: StepBodyProps) {
    const { t } = useTranslation();

    return (
        <Stack space="md" testID={`${TEST_ID}-cooking`}>
            <StepIntro
                title={t('onboarding:steps.cooking.title')}
                lead={t('onboarding:steps.cooking.lead')}
                testID={`${TEST_ID}-cooking`}
            />

            <NumberStepper
                testID="onboarding-cooking-minutes"
                label={t('onboarding:steps.cooking.minutesLabel')}
                hint={t('onboarding:steps.cooking.minutesHint')}
                unit={t('onboarding:units.minutes')}
                step={5}
                required
                min={BOUNDS.cookingMinutesPerDay.min}
                max={BOUNDS.cookingMinutesPerDay.max}
                value={answers.cookingMinutesPerDay}
                onChange={(cookingMinutesPerDay) => {
                    dispatch({ type: 'set', patch: { cookingMinutesPerDay } });
                }}
                {...fieldError(errors, 'cookingMinutesPerDay')}
            />

            <Stack space="xs">
                <Text variant="label">{t('onboarding:steps.cooking.skillLabel')}</Text>
                <SegmentedControl<CookingSkill>
                    testID="onboarding-cooking-skill"
                    label={t('onboarding:steps.cooking.skillLabel')}
                    block
                    value={answers.cookingSkill ?? ('' as CookingSkill)}
                    items={COOKING_SKILLS.map((skill) => ({
                        value: skill,
                        label: t(`onboarding:cookingSkills.${skill}.label`),
                        testID: `onboarding-cooking-skill-${skill}`,
                    }))}
                    onChange={(cookingSkill) => {
                        dispatch({ type: 'set', patch: { cookingSkill } });
                    }}
                />
                {errors['cookingSkill'] === undefined ? null : (
                    <Text tone="danger" variant="caption" testID="onboarding-cooking-skill-error">
                        {errors['cookingSkill']}
                    </Text>
                )}
            </Stack>

            <OptionGuide
                testID="onboarding-cooking-guide"
                title={t('onboarding:steps.cooking.guideTitle')}
                selectedKey={answers.cookingSkill}
                entries={COOKING_SKILLS.map((skill) => ({
                    key: skill,
                    label: t(`onboarding:cookingSkills.${skill}.label`),
                    description: t(`onboarding:cookingSkills.${skill}.description`),
                }))}
            />
        </Stack>
    );
}

/* ── 18 · meals per day ──────────────────────────────────────────────────────────────────────── */

function MealsStep({ answers, errors, dispatch }: StepBodyProps) {
    const { t } = useTranslation();

    const setCounts = (meals: number | null, snacks: number | null) => {
        dispatch({
            type: 'setMealCounts',
            meals: meals ?? 0,
            snacks: snacks ?? 0,
        });
    };

    return (
        <Stack space="md" testID={`${TEST_ID}-meals`}>
            <StepIntro
                title={t('onboarding:steps.meals.title')}
                lead={t('onboarding:steps.meals.lead')}
                testID={`${TEST_ID}-meals`}
            />

            <NumberStepper
                testID="onboarding-meals-per-day"
                label={t('onboarding:steps.meals.mealsLabel')}
                required
                min={BOUNDS.mealsPerDay.min}
                max={BOUNDS.mealsPerDay.max}
                value={answers.mealsPerDay}
                onChange={(meals) => {
                    setCounts(meals, answers.snacksPerDay ?? 0);
                }}
                {...fieldError(errors, 'mealsPerDay')}
            />

            <NumberStepper
                testID="onboarding-snacks-per-day"
                label={t('onboarding:steps.meals.snacksLabel')}
                hint={t('onboarding:steps.meals.snacksHint')}
                required
                min={BOUNDS.snacksPerDay.min}
                max={BOUNDS.snacksPerDay.max}
                value={answers.snacksPerDay}
                onChange={(snacks) => {
                    setCounts(answers.mealsPerDay ?? 0, snacks);
                }}
                {...fieldError(errors, 'snacksPerDay')}
            />
        </Stack>
    );
}

/* ── 19 · meal times ─────────────────────────────────────────────────────────────────────────── */

/**
 * A row per slot: what kind of meal it is, and when.
 *
 * Meal *type* is editable rather than derived from the position, because a meal layout is a
 * first-class structure rather than a count (doc 17, PLN-06) and because a person who eats two
 * dinners and no breakfast should be able to say so without the interface arguing.
 */
function MealTimesStep({ answers, errors, dispatch }: StepBodyProps) {
    const { t } = useTranslation();

    // A person can reach this step from a deep link where the counts exist but the rows do not.
    const slots =
        answers.mealSlots.length > 0
            ? answers.mealSlots
            : resizeMealSlots([], answers.mealsPerDay ?? 3, answers.snacksPerDay ?? 0);

    const timeOptions: readonly SelectOption[] = MEAL_TIME_OPTIONS.map((time) => ({
        value: time,
        label: time,
    }));

    return (
        <Stack space="md" testID={`${TEST_ID}-meal-times`}>
            <StepIntro
                title={t('onboarding:steps.mealTimes.title')}
                lead={t('onboarding:steps.mealTimes.lead')}
                testID={`${TEST_ID}-meal-times`}
            />

            <Stack space="sm" testID="onboarding-meal-slots">
                {slots.map((slot, index) => (
                    <Card key={slot.key} padding="md" testID={`onboarding-meal-slot-${slot.key}`}>
                        <Stack space="sm">
                            <Text variant="label">
                                {slot.isSnack
                                    ? t('onboarding:steps.mealTimes.snackHeading', {
                                          number: index + 1,
                                      })
                                    : t('onboarding:steps.mealTimes.mealHeading', {
                                          number: index + 1,
                                      })}
                            </Text>
                            <Select<MealType>
                                testID={`onboarding-meal-slot-${slot.key}-type`}
                                label={t('onboarding:steps.mealTimes.typeLabel')}
                                options={MEAL_TYPES.map((mealType) => ({
                                    value: mealType,
                                    label: t(`onboarding:mealTypes.${mealType}`),
                                }))}
                                value={slot.mealType}
                                onChange={(mealType) => {
                                    dispatch({
                                        type: 'setMealSlot',
                                        key: slot.key,
                                        patch: { mealType },
                                    });
                                }}
                            />
                            <Select
                                testID={`onboarding-meal-slot-${slot.key}-time`}
                                label={t('onboarding:steps.mealTimes.timeLabel')}
                                options={timeOptions}
                                value={slot.time}
                                onChange={(time) => {
                                    dispatch({
                                        type: 'setMealSlot',
                                        key: slot.key,
                                        patch: { time },
                                    });
                                }}
                            />
                        </Stack>
                    </Card>
                ))}
            </Stack>

            {errors['mealSlots'] === undefined ? null : (
                <Text tone="danger" variant="caption" testID="onboarding-meal-times-error">
                    {errors['mealSlots']}
                </Text>
            )}
        </Stack>
    );
}

/* ── 20 · preparation mode ───────────────────────────────────────────────────────────────────── */

const PREPARATION_MODES: readonly PreparationMode[] = [
    'home_prepared',
    'kitchen_prepared',
    'mixed',
];

function PreparationStep({ answers, errors, dispatch }: StepBodyProps) {
    const { t } = useTranslation();

    return (
        <Stack space="md" testID={`${TEST_ID}-preparation`}>
            <StepIntro
                title={t('onboarding:steps.preparation.title')}
                lead={t('onboarding:steps.preparation.lead')}
                testID={`${TEST_ID}-preparation`}
            />

            <SegmentedControl<PreparationMode>
                testID="onboarding-preparation-control"
                label={t('onboarding:steps.preparation.label')}
                block
                value={answers.preparationMode ?? ('' as PreparationMode)}
                items={PREPARATION_MODES.map((mode) => ({
                    value: mode,
                    label: t(`onboarding:preparationModes.${mode}.label`),
                    testID: `onboarding-preparation-${mode}`,
                }))}
                onChange={(preparationMode) => {
                    dispatch({ type: 'set', patch: { preparationMode } });
                }}
            />

            <OptionGuide
                testID="onboarding-preparation-guide"
                title={t('onboarding:steps.preparation.guideTitle')}
                selectedKey={answers.preparationMode}
                entries={PREPARATION_MODES.map((mode) => ({
                    key: mode,
                    label: t(`onboarding:preparationModes.${mode}.label`),
                    description: t(`onboarding:preparationModes.${mode}.description`),
                }))}
            />

            {errors['preparationMode'] === undefined ? null : (
                <Text tone="danger" variant="caption" testID="onboarding-preparation-error">
                    {errors['preparationMode']}
                </Text>
            )}
        </Stack>
    );
}

/* ── shared ──────────────────────────────────────────────────────────────────────────────────── */

/**
 * Spreads an error onto a control only when there is one.
 *
 * `exactOptionalPropertyTypes` makes `error={undefined}` and "no error prop" different types, and
 * the design system's controls treat the *presence* of `error` as what marks a field invalid — so
 * passing `undefined` explicitly would mark every field invalid the moment it is not.
 */
function fieldError(errors: StepErrors, field: string): { readonly error?: string } {
    const message = errors[field];
    return message === undefined ? {} : { error: message };
}
