import {
    Badge,
    Button,
    Callout,
    Card,
    Checkbox,
    Heading,
    Inline,
    Skeleton,
    Stack,
    Table,
    Text,
} from '@healthy360/design-system';
import { useFormatter } from '@healthy360/i18n';
import type { Formatter } from '@healthy360/i18n';
import type { NutritionConstraint } from '@healthy360/nutrition';
import { useTranslation } from 'react-i18next';

import { toFailure } from '../../data/nutrition-hooks.ts';
import { MedicalDisclaimer } from '../../safety/medical-disclaimer.tsx';
import { formatMoney } from '../marketplace/format.ts';
import {
    buildConstraints,
    constraintLabelKey,
    groupByRestrictionKind,
    mergeConstraints,
} from './constraints.ts';
import { StepIntro } from './step-parts.tsx';
import { restrictionPresentation } from './steps.ts';
import type { OnboardingSection, OnboardingStepSlug } from './steps.ts';
import { weeklyBudgetMoney } from './state.ts';
import type { OnboardingAnswers } from './state.ts';
import { toFeetAndInches, toPounds } from './vocabularies.ts';
import type { NutritionTargetResult } from '@healthy360/nutrition';
import type { ApiFailure } from '@healthy360/api-client';

/**
 * Step 21 — everything the product now believes, with a way to change each of it.
 *
 * Two things make this more than a receipt.
 *
 * **Every row edits.** A summary a person cannot act on is a wall of text they scroll past. Each
 * row carries a control that returns to the step that produced it, and returning is cheap because
 * every earlier step is by definition already complete (`isStepReachable`).
 *
 * **The seven restriction kinds are seven groups.** Not one list with seven colours, not a single
 * "restrictions" row with a count. Seven headed groups, each with its own glyph, its own label and
 * its own sentence about who may lift it — including the empty ones, because "we believe you have
 * no allergies" is exactly the belief a person most needs to be able to check. This is the product's
 * clearest lead over both reference products (doc 17, ONB-08) and the place it is most visible.
 */

export interface SummaryStepProps {
    readonly answers: OnboardingAnswers;
    readonly errors: Readonly<Record<string, string>>;
    readonly enforced: readonly NutritionConstraint[];
    readonly onAcknowledge: (value: boolean) => void;
    readonly onEdit: (slug: OnboardingStepSlug) => void;
    /** The live preview of what the answers produce. Loading, error and success are all rendered. */
    readonly preview: {
        readonly data: NutritionTargetResult | undefined;
        readonly isPending: boolean;
        readonly error: unknown;
    };
}

interface SummaryRow {
    readonly key: string;
    readonly label: string;
    readonly value: string;
    readonly step: OnboardingStepSlug;
}

const SECTION_STEPS: Readonly<Record<OnboardingSection, readonly OnboardingStepSlug[]>> = {
    aboutYou: ['units', 'age', 'calculation-basis', 'height', 'weight', 'body-fat', 'activity'],
    yourGoal: ['goal', 'pace'],
    whatYouEat: ['diet', 'allergies', 'restrictions', 'dislikes', 'cuisines'],
    howYouCook: ['budget', 'cooking', 'meals', 'meal-times', 'preparation'],
};

export function SummaryStep({
    answers,
    errors,
    enforced,
    onAcknowledge,
    onEdit,
    preview,
}: SummaryStepProps) {
    const { t } = useTranslation();
    const formatter = useFormatter();

    const constraints = mergeConstraints(buildConstraints(answers), enforced);
    const groups = groupByRestrictionKind(constraints);

    const rows = buildRows(answers, t, formatter);
    const failure: ApiFailure | null = toFailure(preview.error);

    return (
        <Stack space="lg" testID="onboarding-summary">
            <StepIntro
                title={t('onboarding:steps.summary.title')}
                lead={t('onboarding:steps.summary.lead')}
                testID="onboarding-summary"
            />

            {/* ── the live preview ─────────────────────────────────────────────────────────── */}
            <Card padding="md" tone="brand" testID="onboarding-summary-preview">
                <Stack space="sm">
                    <Heading level={3}>{t('onboarding:steps.summary.previewTitle')}</Heading>

                    {preview.isPending ? (
                        <Stack space="xs" testID="onboarding-summary-preview-loading">
                            <Skeleton heightClassName="h-8" widthClassName="w-2/3" />
                            <Skeleton heightClassName="h-4" widthClassName="w-1/2" />
                        </Stack>
                    ) : failure !== null ? (
                        <Callout
                            testID="onboarding-summary-preview-error"
                            role="alert"
                            tone="danger"
                            title={t('onboarding:steps.summary.previewErrorTitle')}
                            body={t('onboarding:steps.summary.previewErrorBody')}
                        />
                    ) : preview.data === undefined ? (
                        <Text tone="secondary" testID="onboarding-summary-preview-empty">
                            {t('onboarding:steps.summary.previewEmpty')}
                        </Text>
                    ) : (
                        <Stack space="xs" testID="onboarding-summary-preview-content">
                            <Text variant="bodyStrong" testID="onboarding-summary-target">
                                {t('onboarding:steps.summary.previewTarget', {
                                    energy: formatter.formatNumber(preview.data.targetEnergy),
                                })}
                            </Text>
                            <Text tone="secondary" testID="onboarding-summary-maintenance">
                                {t('onboarding:steps.summary.previewMaintenance', {
                                    energy: formatter.formatNumber(preview.data.maintenanceEnergy),
                                })}
                            </Text>
                            <Text variant="caption" tone="secondary">
                                {t('onboarding:steps.summary.previewMethod', {
                                    method: t(`nutrition:methods.${preview.data.method}`),
                                })}
                            </Text>
                            {preview.data.requiresProfessionalReview ? (
                                <Badge
                                    testID="onboarding-summary-review-flag"
                                    tone="warning"
                                    icon="warning"
                                    label={t('onboarding:steps.summary.reviewFlag')}
                                />
                            ) : null}
                        </Stack>
                    )}
                </Stack>
            </Card>

            {/* ── answers, by section ──────────────────────────────────────────────────────── */}
            {(Object.keys(SECTION_STEPS) as OnboardingSection[]).map((section) => {
                const sectionRows = rows.filter((row) => SECTION_STEPS[section].includes(row.step));
                return (
                    <Stack space="sm" key={section} testID={`onboarding-summary-${section}`}>
                        <Heading level={3}>{t(`onboarding:sections.${section}`)}</Heading>
                        <Card padding="none">
                            <Table<SummaryRow>
                                testID={`onboarding-summary-${section}-table`}
                                caption={t(`onboarding:sections.${section}`)}
                                captionHidden
                                rowKey={(row) => row.key}
                                rows={sectionRows}
                                columns={[
                                    {
                                        key: 'label',
                                        header: t('onboarding:steps.summary.columnQuestion'),
                                        rowHeader: true,
                                        render: (row) => <Text>{row.label}</Text>,
                                    },
                                    {
                                        key: 'value',
                                        header: t('onboarding:steps.summary.columnAnswer'),
                                        render: (row) => (
                                            <Text
                                                variant="bodyStrong"
                                                testID={`onboarding-summary-value-${row.key}`}
                                            >
                                                {row.value}
                                            </Text>
                                        ),
                                    },
                                    {
                                        key: 'edit',
                                        header: t('onboarding:steps.summary.columnEdit'),
                                        render: (row) => (
                                            <Button
                                                testID={`onboarding-summary-edit-${row.key}`}
                                                size="sm"
                                                variant="ghost"
                                                label={t('onboarding:steps.summary.edit')}
                                                accessibilityHint={t(
                                                    'onboarding:steps.summary.editHint',
                                                    { question: row.label },
                                                )}
                                                onPress={() => {
                                                    onEdit(row.step);
                                                }}
                                            />
                                        ),
                                    },
                                ]}
                            />
                        </Card>
                    </Stack>
                );
            })}

            {/* ── the seven kinds ──────────────────────────────────────────────────────────── */}
            <Stack space="sm" testID="onboarding-summary-restrictions">
                <Heading level={3}>{t('onboarding:steps.summary.restrictionsTitle')}</Heading>
                <Text tone="secondary">{t('onboarding:steps.summary.restrictionsLead')}</Text>

                {groups.map((group) => {
                    const presentation = restrictionPresentation(group.kind);
                    return (
                        <Card
                            key={group.kind}
                            padding="md"
                            testID={`onboarding-restriction-group-${group.kind}`}
                        >
                            <Stack space="xs">
                                <Inline space="xs" align="center">
                                    <Badge
                                        testID={`onboarding-restriction-badge-${group.kind}`}
                                        tone={presentation.tone}
                                        icon={presentation.icon}
                                        label={t(`onboarding:restrictionKinds.${group.kind}.label`)}
                                    />
                                    <Text variant="caption" tone="secondary">
                                        {t(
                                            `onboarding:restrictionAuthority.${presentation.authority}`,
                                        )}
                                    </Text>
                                </Inline>

                                <Text variant="caption" tone="secondary">
                                    {t(`onboarding:restrictionKinds.${group.kind}.description`)}
                                </Text>

                                {group.constraints.length === 0 ? (
                                    <Text
                                        tone="secondary"
                                        testID={`onboarding-restriction-empty-${group.kind}`}
                                    >
                                        {t('onboarding:steps.summary.noneRecorded')}
                                    </Text>
                                ) : (
                                    <Inline
                                        space="xs"
                                        wrap
                                        testID={`onboarding-restriction-items-${group.kind}`}
                                    >
                                        {group.constraints.map((constraint) => (
                                            <Badge
                                                key={`${group.kind}-${constraint.code}`}
                                                testID={`onboarding-restriction-item-${group.kind}-${constraint.code}`}
                                                tone={presentation.tone}
                                                icon={presentation.icon}
                                                label={t(
                                                    constraintLabelKey(group.kind, constraint.code),
                                                    { defaultValue: constraint.label },
                                                )}
                                            />
                                        ))}
                                    </Inline>
                                )}

                                {presentation.editable ? (
                                    <Button
                                        testID={`onboarding-restriction-edit-${group.kind}`}
                                        size="sm"
                                        variant="ghost"
                                        label={t('onboarding:steps.summary.edit')}
                                        onPress={() => {
                                            onEdit(presentation.capturedAt);
                                        }}
                                    />
                                ) : (
                                    <Text
                                        variant="caption"
                                        tone="secondary"
                                        testID={`onboarding-restriction-locked-${group.kind}`}
                                    >
                                        {t('onboarding:steps.summary.setByDietitian')}
                                    </Text>
                                )}
                            </Stack>
                        </Card>
                    );
                })}
            </Stack>

            <MedicalDisclaimer context={t('onboarding:disclaimerContext')} />

            <Checkbox
                testID="onboarding-summary-acknowledge"
                label={t('onboarding:steps.summary.acknowledge')}
                description={t('onboarding:steps.summary.acknowledgeDescription')}
                checked={answers.summaryAcknowledged}
                onChange={onAcknowledge}
                {...(errors['summaryAcknowledged'] === undefined
                    ? {}
                    : { error: errors['summaryAcknowledged'] })}
            />
        </Stack>
    );
}

/* ------------------------------------------------------------------------------------------------
 * Rows
 * ---------------------------------------------------------------------------------------------- */

type Translate = ReturnType<typeof useTranslation>['t'];

function buildRows(
    answers: OnboardingAnswers,
    t: Translate,
    formatter: Formatter,
): readonly SummaryRow[] {
    const imperial = answers.measurementSystem === 'imperial';
    const unanswered = t('onboarding:steps.summary.unanswered');
    const budget = weeklyBudgetMoney(answers);
    const height = answers.heightCentimetres;
    const feetInches = height === null ? null : toFeetAndInches(height);

    const list = (codes: readonly string[], prefix: string): string =>
        codes.length === 0
            ? t('onboarding:steps.summary.noneRecorded')
            : codes.map((code) => t(`${prefix}.${code}`, { defaultValue: code })).join(', ');

    return [
        {
            key: 'units',
            step: 'units',
            label: t('onboarding:steps.units.title'),
            value: t(`onboarding:units.${answers.measurementSystem}`),
        },
        {
            key: 'age',
            step: 'age',
            label: t('onboarding:steps.age.title'),
            value:
                answers.ageYears === null
                    ? unanswered
                    : t('onboarding:steps.summary.ageValue', { years: answers.ageYears }),
        },
        {
            key: 'basis',
            step: 'calculation-basis',
            label: t('onboarding:steps.calculationBasis.title'),
            value:
                answers.calculationBasis === 'body_composition'
                    ? t('onboarding:calculationBasis.bodyComposition')
                    : t('onboarding:steps.summary.basisWithSex', {
                          basis: t('onboarding:calculationBasis.measurements'),
                          sex:
                              answers.sexForCalculation === null
                                  ? unanswered
                                  : t(`onboarding:calculationSex.${answers.sexForCalculation}`),
                      }),
        },
        {
            key: 'height',
            step: 'height',
            label: t('onboarding:steps.height.title'),
            value:
                height === null
                    ? unanswered
                    : imperial && feetInches !== null
                      ? t('onboarding:steps.summary.heightImperial', {
                            feet: feetInches.feet,
                            inches: feetInches.inches,
                        })
                      : t('onboarding:steps.summary.heightMetric', { centimetres: height }),
        },
        {
            key: 'weight',
            step: 'weight',
            label: t('onboarding:steps.weight.title'),
            value:
                answers.weightKilograms === null
                    ? unanswered
                    : imperial
                      ? t('onboarding:steps.summary.weightImperial', {
                            pounds: toPounds(answers.weightKilograms),
                        })
                      : t('onboarding:steps.summary.weightMetric', {
                            kilograms: answers.weightKilograms,
                        }),
        },
        {
            key: 'body-fat',
            step: 'body-fat',
            label: t('onboarding:steps.bodyFat.title'),
            value:
                answers.bodyFatPercentage === null
                    ? t('onboarding:steps.summary.bodyFatSkipped')
                    : t('onboarding:steps.summary.bodyFatValue', {
                          percentage: answers.bodyFatPercentage,
                      }),
        },
        {
            key: 'activity',
            step: 'activity',
            label: t('onboarding:steps.activity.title'),
            value:
                answers.activityLevel === null
                    ? unanswered
                    : t(`onboarding:activityLevels.${answers.activityLevel}.label`),
        },
        {
            key: 'goal',
            step: 'goal',
            label: t('onboarding:steps.goal.title'),
            value: answers.goal === null ? unanswered : t(`onboarding:goals.${answers.goal}.label`),
        },
        {
            key: 'pace',
            step: 'pace',
            label: t('onboarding:steps.pace.title'),
            value: answers.pace === null ? unanswered : t(`onboarding:paces.${answers.pace}.label`),
        },
        {
            key: 'diet',
            step: 'diet',
            label: t('onboarding:steps.diet.title'),
            value: answers.diet === null ? unanswered : t(`onboarding:diets.${answers.diet}`),
        },
        {
            key: 'allergies',
            step: 'allergies',
            label: t('onboarding:steps.allergies.title'),
            value: list(answers.allergies, 'onboarding:allergens'),
        },
        {
            key: 'restrictions',
            step: 'restrictions',
            label: t('onboarding:steps.restrictions.title'),
            value: list(answers.selfDeclaredMedical, 'onboarding:medicalTopics'),
        },
        {
            key: 'dislikes',
            step: 'dislikes',
            label: t('onboarding:steps.dislikes.title'),
            value: list(answers.dislikedIngredients, 'onboarding:dislikes'),
        },
        {
            key: 'cuisines',
            step: 'cuisines',
            label: t('onboarding:steps.cuisines.title'),
            value: list(answers.preferredCuisines, 'onboarding:cuisines'),
        },
        {
            key: 'budget',
            step: 'budget',
            label: t('onboarding:steps.budget.title'),
            value:
                budget === null
                    ? t('onboarding:steps.summary.noBudget')
                    : t('onboarding:steps.summary.budgetValue', {
                          amount: formatMoney(formatter, budget),
                      }),
        },
        {
            key: 'cooking',
            step: 'cooking',
            label: t('onboarding:steps.cooking.title'),
            value:
                answers.cookingMinutesPerDay === null || answers.cookingSkill === null
                    ? unanswered
                    : t('onboarding:steps.summary.cookingValue', {
                          minutes: answers.cookingMinutesPerDay,
                          skill: t(`onboarding:cookingSkills.${answers.cookingSkill}.label`),
                      }),
        },
        {
            key: 'meals',
            step: 'meals',
            label: t('onboarding:steps.meals.title'),
            value:
                answers.mealsPerDay === null || answers.snacksPerDay === null
                    ? unanswered
                    : t('onboarding:steps.summary.mealsValue', {
                          meals: answers.mealsPerDay,
                          snacks: answers.snacksPerDay,
                      }),
        },
        {
            key: 'meal-times',
            step: 'meal-times',
            label: t('onboarding:steps.mealTimes.title'),
            value:
                answers.mealSlots.length === 0
                    ? unanswered
                    : answers.mealSlots
                          .map(
                              (slot) =>
                                  `${t(`onboarding:mealTypes.${slot.mealType}`)} ${slot.time}`,
                          )
                          .join(' · '),
        },
        {
            key: 'preparation',
            step: 'preparation',
            label: t('onboarding:steps.preparation.title'),
            value:
                answers.preparationMode === null
                    ? unanswered
                    : t(`onboarding:preparationModes.${answers.preparationMode}.label`),
        },
    ];
}
