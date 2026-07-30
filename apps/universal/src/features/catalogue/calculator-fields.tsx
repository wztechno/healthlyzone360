import {
    Callout,
    Card,
    NumberStepper,
    SegmentedControl,
    Select,
    Stack,
    Text,
} from '@healthy360/design-system';
import type { SelectOption } from '@healthy360/design-system';
import {
    ACTIVITY_LEVELS,
    DIET_CLASSIFICATIONS,
    HEALTH_GOALS,
    MEASUREMENT_SYSTEMS,
    TARGET_PACES,
} from '@healthy360/domain-types';
import type {
    ActivityLevel,
    DietClassification,
    HealthGoal,
    MeasurementSystem,
    TargetPace,
} from '@healthy360/domain-types';
import type { CalculationSex, NutritionTargetRequest } from '@healthy360/nutrition';
import { View } from 'react-native';
import { useTranslation } from 'react-i18next';

import {
    centimetresFromFeetInches,
    feetInchesFromCentimetres,
    kilogramsFromPounds,
    poundsFromKilograms,
    roundToTenth,
} from './format.ts';

/**
 * The inputs both public calculators collect.
 *
 * ## Everything is stored in metric, whatever the person is typing
 *
 * The published equations take centimetres and kilograms, so those are the canonical fields and the
 * imperial controls are a *view* over them. That is what makes switching units preserve the answer
 * instead of clearing it — the behaviour doc 17, ONB-03 asks for and records as unobserved in both
 * references, so designed from first principles here.
 *
 * ## Two fields get help and the rest do not
 *
 * Doc 17, MKT-03: attach help to precisely the fields most likely to confuse, rather than uniformly.
 * Those are the calculation-sex input (which is not a question about identity, and says so) and the
 * optional body-fat input (where a guess makes the estimate worse, not better). Every other field
 * carries a label and nothing else, so the two that matter are not buried in a page of hints.
 *
 * ## Steppers, not sliders
 *
 * The design system has no slider on purpose (`forms/number-stepper.tsx`): a drag rail cannot be
 * operated without a pointer and cannot be hit accurately at 360 px. Every numeric field here is a
 * typeable spinbutton with two 44 dp controls.
 */
export interface CalculatorInputs {
    readonly measurementSystem: MeasurementSystem;
    readonly ageYears: number | null;
    readonly sexForCalculation: CalculationSex;
    readonly heightCentimetres: number | null;
    readonly weightKilograms: number | null;
    readonly bodyFatPercentage: number | null;
    readonly activityLevel: ActivityLevel;
    readonly goal: HealthGoal;
    readonly pace: TargetPace;
    /** Only the macro calculator collects this; it changes the split, never the energy figure. */
    readonly diet: DietClassification | null;
}

/**
 * A neutral starting point rather than a blank form.
 *
 * The three body measurements start empty — inventing a height would produce an "estimate" the
 * person never gave the inputs for — while the categorical choices start on their most common
 * value, so the form is one field away from an answer rather than nine.
 */
export const DEFAULT_CALCULATOR_INPUTS: CalculatorInputs = {
    measurementSystem: 'metric',
    ageYears: null,
    sexForCalculation: 'female',
    heightCentimetres: null,
    weightKilograms: null,
    bodyFatPercentage: null,
    activityLevel: 'moderately_active',
    goal: 'maintain',
    pace: 'standard',
    diet: null,
};

/** Bounds mirroring `MockNutritionTargetEngine`'s validation, so a control cannot produce a throw. */
export const CALCULATOR_BOUNDS = {
    age: { min: 16, max: 100 },
    heightCentimetres: { min: 50, max: 260 },
    heightFeet: { min: 1, max: 8 },
    heightInches: { min: 0, max: 11 },
    weightKilograms: { min: 20, max: 400 },
    weightPounds: { min: 45, max: 880 },
    bodyFat: { min: 3, max: 70 },
} as const;

/**
 * The request the engine is asked for, or `null` while the form is incomplete.
 *
 * A partial form has no answer, and rendering an estimate from three of five measurements is how a
 * calculator earns trust it has not deserved. `null` is what the screen's "still missing" state
 * hangs off.
 */
export function toTargetRequest(inputs: CalculatorInputs): NutritionTargetRequest | null {
    const { ageYears, heightCentimetres, weightKilograms } = inputs;
    if (ageYears === null || heightCentimetres === null || weightKilograms === null) return null;

    return {
        measurementSystem: inputs.measurementSystem,
        ageYears,
        sexForCalculation: inputs.sexForCalculation,
        heightCentimetres: roundToTenth(heightCentimetres),
        weightKilograms: roundToTenth(weightKilograms),
        ...(inputs.bodyFatPercentage === null
            ? {}
            : { bodyFatPercentage: inputs.bodyFatPercentage }),
        activityLevel: inputs.activityLevel,
        goal: inputs.goal,
        pace: inputs.pace,
        ...(inputs.diet === null ? {} : { diet: inputs.diet }),
    };
}

export interface CalculatorFieldsProps {
    readonly value: CalculatorInputs;
    readonly onChange: (next: CalculatorInputs) => void;
    /** The macro calculator adds the diet-preference split selector. */
    readonly showDiet?: boolean | undefined;
    readonly testID?: string | undefined;
}

export function CalculatorFields({
    value,
    onChange,
    showDiet = false,
    testID = 'calculator',
}: CalculatorFieldsProps) {
    const { t } = useTranslation();

    const patch = (next: Partial<CalculatorInputs>) => {
        onChange({ ...value, ...next });
    };

    const imperial = value.measurementSystem === 'imperial';
    const height =
        value.heightCentimetres === null
            ? { feet: null, inches: null }
            : feetInchesFromCentimetres(value.heightCentimetres);

    const activityOptions: readonly SelectOption<ActivityLevel>[] = ACTIVITY_LEVELS.map(
        (level) => ({
            value: level,
            label: t(`catalogue:tools.activity.${level}`),
            description: t(`catalogue:tools.activityHint.${level}`),
        }),
    );

    const goalOptions: readonly SelectOption<HealthGoal>[] = HEALTH_GOALS.map((goal) => ({
        value: goal,
        label: t(`catalogue:tools.goal.${goal}`),
    }));

    const dietOptions: readonly SelectOption<string>[] = [
        { value: 'any', label: t('catalogue:tools.dietAny') },
        ...DIET_CLASSIFICATIONS.map((diet) => ({
            value: diet,
            label: t(`marketplace:diets.${diet}`),
        })),
    ];

    return (
        <Card testID={testID} padding="md" tone="raised">
            <Stack space="lg">
                <Text variant="label">{t('catalogue:tools.inputsTitle')}</Text>

                <SegmentedControl
                    testID={`${testID}-units`}
                    label={t('catalogue:tools.unitsLabel')}
                    block
                    value={value.measurementSystem}
                    onChange={(next) => {
                        patch({ measurementSystem: next });
                    }}
                    items={MEASUREMENT_SYSTEMS.map((system) => ({
                        value: system,
                        label: t(`catalogue:tools.units.${system}`),
                        testID: `${testID}-units-${system}`,
                    }))}
                />

                <NumberStepper
                    testID={`${testID}-age`}
                    id={`${testID}-age`}
                    label={t('catalogue:tools.age')}
                    unit={t('catalogue:tools.ageUnit')}
                    value={value.ageYears}
                    min={CALCULATOR_BOUNDS.age.min}
                    max={CALCULATOR_BOUNDS.age.max}
                    required
                    onChange={(next) => {
                        patch({ ageYears: next });
                    }}
                />

                <Stack space="xs">
                    <SegmentedControl
                        testID={`${testID}-sex`}
                        label={t('catalogue:tools.sexLabel')}
                        block
                        value={value.sexForCalculation}
                        onChange={(next) => {
                            patch({ sexForCalculation: next });
                        }}
                        items={(['female', 'male'] as const).map((sex) => ({
                            value: sex,
                            label: t(`catalogue:tools.sex.${sex}`),
                            testID: `${testID}-sex-${sex}`,
                        }))}
                    />
                    <Text testID={`${testID}-sex-help`} tone="secondary" variant="caption">
                        {t('catalogue:tools.sexHelp')}
                    </Text>
                </Stack>

                {imperial ? (
                    <View className="flex-row items-start gap-3">
                        <NumberStepper
                            testID={`${testID}-height-feet`}
                            id={`${testID}-height-feet`}
                            className="flex-1"
                            label={t('catalogue:tools.heightFeet')}
                            unit={t('catalogue:tools.heightFeetUnit')}
                            value={height.feet}
                            min={CALCULATOR_BOUNDS.heightFeet.min}
                            max={CALCULATOR_BOUNDS.heightFeet.max}
                            onChange={(next) => {
                                patch({
                                    heightCentimetres:
                                        next === null
                                            ? null
                                            : centimetresFromFeetInches(next, height.inches ?? 0),
                                });
                            }}
                        />
                        <NumberStepper
                            testID={`${testID}-height-inches`}
                            id={`${testID}-height-inches`}
                            className="flex-1"
                            label={t('catalogue:tools.heightInches')}
                            unit={t('catalogue:tools.heightInchesUnit')}
                            value={height.inches}
                            min={CALCULATOR_BOUNDS.heightInches.min}
                            max={CALCULATOR_BOUNDS.heightInches.max}
                            onChange={(next) => {
                                patch({
                                    heightCentimetres:
                                        height.feet === null
                                            ? null
                                            : centimetresFromFeetInches(height.feet, next ?? 0),
                                });
                            }}
                        />
                    </View>
                ) : (
                    <NumberStepper
                        testID={`${testID}-height`}
                        id={`${testID}-height`}
                        label={t('catalogue:tools.heightMetric')}
                        unit={t('catalogue:tools.heightUnitMetric')}
                        value={
                            value.heightCentimetres === null
                                ? null
                                : Math.round(value.heightCentimetres)
                        }
                        min={CALCULATOR_BOUNDS.heightCentimetres.min}
                        max={CALCULATOR_BOUNDS.heightCentimetres.max}
                        required
                        onChange={(next) => {
                            patch({ heightCentimetres: next });
                        }}
                    />
                )}

                <NumberStepper
                    testID={`${testID}-weight`}
                    id={`${testID}-weight`}
                    label={
                        imperial
                            ? t('catalogue:tools.weightImperial')
                            : t('catalogue:tools.weightMetric')
                    }
                    unit={
                        imperial
                            ? t('catalogue:tools.weightUnitImperial')
                            : t('catalogue:tools.weightUnitMetric')
                    }
                    value={
                        value.weightKilograms === null
                            ? null
                            : imperial
                              ? Math.round(poundsFromKilograms(value.weightKilograms))
                              : roundToTenth(value.weightKilograms)
                    }
                    min={
                        imperial
                            ? CALCULATOR_BOUNDS.weightPounds.min
                            : CALCULATOR_BOUNDS.weightKilograms.min
                    }
                    max={
                        imperial
                            ? CALCULATOR_BOUNDS.weightPounds.max
                            : CALCULATOR_BOUNDS.weightKilograms.max
                    }
                    required
                    onChange={(next) => {
                        patch({
                            weightKilograms:
                                next === null ? null : imperial ? kilogramsFromPounds(next) : next,
                        });
                    }}
                />

                <Stack space="xs">
                    <NumberStepper
                        testID={`${testID}-body-fat`}
                        id={`${testID}-body-fat`}
                        label={t('catalogue:tools.bodyFat')}
                        unit={t('catalogue:tools.bodyFatUnit')}
                        value={value.bodyFatPercentage}
                        min={CALCULATOR_BOUNDS.bodyFat.min}
                        max={CALCULATOR_BOUNDS.bodyFat.max}
                        onChange={(next) => {
                            patch({ bodyFatPercentage: next });
                        }}
                    />
                    <Text testID={`${testID}-body-fat-help`} tone="secondary" variant="caption">
                        {t('catalogue:tools.bodyFatHelp')}
                    </Text>
                </Stack>

                <Select
                    testID={`${testID}-activity`}
                    id={`${testID}-activity`}
                    label={t('catalogue:tools.activityLabel')}
                    options={activityOptions}
                    value={value.activityLevel}
                    onChange={(next) => {
                        patch({ activityLevel: next });
                    }}
                />

                <Select
                    testID={`${testID}-goal`}
                    id={`${testID}-goal`}
                    label={t('catalogue:tools.goalLabel')}
                    options={goalOptions}
                    value={value.goal}
                    onChange={(next) => {
                        patch({ goal: next });
                    }}
                />

                <SegmentedControl
                    testID={`${testID}-pace`}
                    label={t('catalogue:tools.paceLabel')}
                    block
                    value={value.pace}
                    onChange={(next) => {
                        patch({ pace: next });
                    }}
                    items={TARGET_PACES.map((pace) => ({
                        value: pace,
                        label: t(`catalogue:tools.pace.${pace}`),
                        testID: `${testID}-pace-${pace}`,
                    }))}
                />

                {showDiet ? (
                    <Stack space="xs">
                        <Select
                            testID={`${testID}-diet`}
                            id={`${testID}-diet`}
                            label={t('catalogue:tools.dietLabel')}
                            options={dietOptions}
                            value={value.diet ?? 'any'}
                            onChange={(next) => {
                                patch({
                                    diet: next === 'any' ? null : (next as DietClassification),
                                });
                            }}
                        />
                        <Text tone="secondary" variant="caption">
                            {t('catalogue:tools.dietHint')}
                        </Text>
                    </Stack>
                ) : null}

                <Callout
                    testID={`${testID}-privacy`}
                    role="note"
                    tone="info"
                    icon="prototype"
                    title={t('catalogue:tools.prototypeFlag')}
                    body={t('catalogue:tools.prototypeBody')}
                />
            </Stack>
        </Card>
    );
}
