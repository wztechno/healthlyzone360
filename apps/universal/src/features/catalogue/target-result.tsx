import {
    Accordion,
    Badge,
    Callout,
    Card,
    Inline,
    ProgressRing,
    Stack,
    Table,
    Text,
} from '@healthy360/design-system';
import type { TableColumn } from '@healthy360/design-system';
import { useFormatter } from '@healthy360/i18n';
import type { MacroTarget, NutritionTargetResult } from '@healthy360/nutrition';
import { View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { macroDistributionLevel } from './macro-rings.tsx';

/**
 * The calculator's answer, and everything needed to check it.
 *
 * Four requirements meet in this component, and each one is a place both reference products stop
 * short (doc 09 §5, doc 17 NUT-01 to NUT-04):
 *
 * 1. **Maintenance and target are shown separately.** Neither reference shows a separation at all,
 *    and people conflate the two constantly — "my calories" usually means whichever of them they
 *    last read. Two labelled figures with two sentences is the whole fix.
 * 2. **The method is named and cited.** Mifflin–St Jeor or Katch–McArdle, with the primary
 *    literature listed, so the arithmetic can be checked rather than trusted.
 * 3. **The target is a band, not a point.** A single number reports normal day-to-day variation as
 *    a failure. The engine publishes a tolerance; this renders it.
 * 4. **The result says it is a prototype, every time.** `NutritionTargetResult.prototype` is typed
 *    as the literal `true` precisely so this claim cannot be quietly switched off.
 *
 * The step-by-step working is an accordion rather than always-open prose: it is the answer to
 * "where did this come from?", which is a question asked once and then not again.
 */
export interface TargetResultCardProps {
    readonly result: NutritionTargetResult;
    readonly testID?: string | undefined;
}

export function TargetResultCard({ result, testID = 'target-result' }: TargetResultCardProps) {
    const { t } = useTranslation();
    const formatter = useFormatter();

    const kcal = (value: number) =>
        `${formatter.formatNumber(Math.round(value))} ${t('catalogue:tools.unitKcal')}`;

    return (
        <Card testID={testID} padding="md" tone="raised">
            <Stack space="lg">
                <Inline space="sm" align="center" wrap>
                    <Text variant="label">{t('catalogue:tools.resultTitle')}</Text>
                    <Badge
                        testID={`${testID}-prototype`}
                        tone="info"
                        icon="prototype"
                        label={t('catalogue:tools.prototypeFlag')}
                    />
                </Inline>

                <Stack space="xs" testID={`${testID}-maintenance`}>
                    <Text variant="label">{t('catalogue:tools.maintenanceLabel')}</Text>
                    <Text
                        testID={`${testID}-maintenance-value`}
                        variant="bodyStrong"
                        className="text-2xl"
                    >
                        {kcal(result.maintenanceEnergy)}
                    </Text>
                    <Text tone="secondary" variant="caption">
                        {t('catalogue:tools.maintenanceBody')}
                    </Text>
                </Stack>

                <Stack space="xs" testID={`${testID}-target`}>
                    <Text variant="label">{t('catalogue:tools.targetLabel')}</Text>
                    <Text
                        testID={`${testID}-target-value`}
                        variant="bodyStrong"
                        className="text-2xl"
                    >
                        {kcal(result.targetEnergy)}
                    </Text>
                    <Text tone="secondary" variant="caption">
                        {t('catalogue:tools.targetBody')}
                    </Text>
                </Stack>

                <Stack space="xs" testID={`${testID}-tolerance`}>
                    <Text variant="label">{t('catalogue:tools.toleranceLabel')}</Text>
                    <Text>
                        {t('catalogue:tools.toleranceValue', {
                            min: formatter.formatNumber(Math.round(result.energyTolerance.min)),
                            max: formatter.formatNumber(Math.round(result.energyTolerance.max)),
                        })}
                    </Text>
                    <Text tone="secondary" variant="caption">
                        {t('catalogue:tools.toleranceBody')}
                    </Text>
                </Stack>

                <Stack space="xs" testID={`${testID}-method`}>
                    <Text variant="label">{t('catalogue:tools.methodTitle')}</Text>
                    <Text>{t(`catalogue:tools.method.${result.method}`)}</Text>
                    <Text tone="secondary" variant="caption">
                        {t('catalogue:tools.bmrLabel')}: {kcal(result.basalMetabolicRate)}
                    </Text>
                    <Text tone="secondary" variant="caption">
                        {t('catalogue:tools.methodBody')}
                    </Text>
                </Stack>

                {result.requiresProfessionalReview ? (
                    <Callout
                        testID={`${testID}-review`}
                        role="status"
                        tone="warning"
                        title={t('catalogue:tools.reviewTitle')}
                        body={`${t('catalogue:tools.reviewBody')} ${result.reviewReasons.join(' ')}`}
                    />
                ) : null}

                <Accordion
                    testID={`${testID}-working`}
                    items={[
                        {
                            key: 'steps',
                            title: t('catalogue:tools.stepsTitle'),
                            testID: `${testID}-steps-header`,
                            children: (
                                <Stack space="sm">
                                    <Text tone="secondary">{result.explanation.summary}</Text>
                                    {result.explanation.steps.map((step) => (
                                        <Stack key={step.id} space="none">
                                            <Text variant="bodyStrong">{step.title}</Text>
                                            <Text tone="secondary" variant="caption">
                                                {step.detail}
                                            </Text>
                                            {step.formula === null ? null : (
                                                <Text tone="secondary" variant="caption">
                                                    {step.formula}
                                                </Text>
                                            )}
                                        </Stack>
                                    ))}
                                </Stack>
                            ),
                        },
                        {
                            key: 'assumptions',
                            title: t('catalogue:tools.assumptionsTitle'),
                            testID: `${testID}-assumptions-header`,
                            children: (
                                <Stack space="xs">
                                    {result.explanation.assumptions.map((assumption) => (
                                        <Text key={assumption} tone="secondary" variant="caption">
                                            {assumption}
                                        </Text>
                                    ))}
                                </Stack>
                            ),
                        },
                        {
                            key: 'citations',
                            title: t('catalogue:tools.citationsTitle'),
                            testID: `${testID}-citations-header`,
                            children: (
                                <Stack space="xs">
                                    {result.explanation.citations.map((citation) => (
                                        <Text key={citation} tone="secondary" variant="caption">
                                            {citation}
                                        </Text>
                                    ))}
                                </Stack>
                            ),
                        },
                    ]}
                />

                <Text testID={`${testID}-disclaimer`} tone="secondary" variant="caption">
                    {result.explanation.disclaimer}
                </Text>
            </Stack>
        </Card>
    );
}

/**
 * The macro split: grams first, percentages and calories second.
 *
 * Doc 09, CAL-09 and IMP-03 both land on the same conclusion, and the reference product's own
 * documentation argues it: a percentage target cannot be eaten. So the rings and the table lead
 * with absolute grams, and the share of energy is the secondary reading rather than the headline.
 */
export interface MacroTargetsPanelProps {
    readonly result: NutritionTargetResult;
    readonly testID?: string | undefined;
}

export function MacroTargetsPanel({ result, testID = 'macro-targets' }: MacroTargetsPanelProps) {
    const { t } = useTranslation();
    const formatter = useFormatter();

    const columns: readonly TableColumn<MacroTarget>[] = [
        {
            key: 'nutrient',
            header: t('catalogue:tools.macroColumn.nutrient'),
            rowHeader: true,
            render: (row) => (
                <Text variant="bodyStrong">{t(`marketplace:nutrients.${row.nutrientId}`)}</Text>
            ),
        },
        {
            key: 'grams',
            header: t('catalogue:tools.macroColumn.grams'),
            numeric: true,
            render: (row) => (
                <Text testID={`${testID}-grams-${row.nutrientId}`}>
                    {t('catalogue:tools.macroGrams', {
                        grams: formatter.formatNumber(Math.round(row.grams)),
                    })}
                </Text>
            ),
        },
        {
            key: 'percentage',
            header: t('catalogue:tools.macroColumn.percentage'),
            numeric: true,
            render: (row) => (
                <Text>
                    {t('catalogue:tools.macroPercent', {
                        percentage: formatter.formatNumber(row.percentageOfEnergy, {
                            maximumFractionDigits: 1,
                        }),
                    })}
                </Text>
            ),
        },
        {
            key: 'kilocalories',
            header: t('catalogue:tools.macroColumn.kilocalories'),
            numeric: true,
            render: (row) => (
                <Text>
                    {t('catalogue:tools.macroKilocalories', {
                        kilocalories: formatter.formatNumber(Math.round(row.kilocalories)),
                    })}
                </Text>
            ),
        },
        {
            key: 'tolerance',
            header: t('catalogue:tools.macroColumn.tolerance'),
            numeric: true,
            render: (row) => (
                <Text>
                    {t('catalogue:tools.macroTolerance', {
                        min: formatter.formatNumber(Math.round(row.tolerance.min)),
                        max: formatter.formatNumber(Math.round(row.tolerance.max)),
                    })}
                </Text>
            ),
        },
    ];

    return (
        <Card testID={testID} padding="md" tone="raised">
            <Stack space="lg">
                <Stack space="xs">
                    <Text variant="label">{t('catalogue:tools.macrosTitle')}</Text>
                    <Text tone="secondary" variant="caption">
                        {t('catalogue:tools.macrosBody')}
                    </Text>
                </Stack>

                <Inline space="lg" wrap align="start">
                    {result.macros.map((macro) => {
                        const nutrient = t(`marketplace:nutrients.${macro.nutrientId}`);
                        const level = macroDistributionLevel(
                            macro.nutrientId,
                            macro.percentageOfEnergy,
                        );
                        const verdict =
                            level === 'optimal'
                                ? t('catalogue:macros.inRange')
                                : t('catalogue:macros.outOfRange');

                        return (
                            <View
                                key={macro.nutrientId}
                                className="min-w-[140px] items-center gap-1"
                            >
                                <ProgressRing
                                    testID={`${testID}-ring-${macro.nutrientId}`}
                                    size="md"
                                    label={t('catalogue:macros.ringLabel', { nutrient })}
                                    value={macro.kilocalories}
                                    target={result.targetEnergy}
                                    level={level}
                                    levelLabel={verdict}
                                    caption={t('catalogue:macros.grams', {
                                        grams: formatter.formatNumber(Math.round(macro.grams)),
                                    })}
                                    valueText={t('catalogue:macros.ringValue', {
                                        grams: formatter.formatNumber(Math.round(macro.grams)),
                                        kilocalories: formatter.formatNumber(
                                            Math.round(macro.kilocalories),
                                        ),
                                        percentage: formatter.formatNumber(
                                            macro.percentageOfEnergy,
                                            { maximumFractionDigits: 1 },
                                        ),
                                        verdict,
                                    })}
                                />
                                <Text variant="bodyStrong">{nutrient}</Text>
                            </View>
                        );
                    })}
                </Inline>

                <Table
                    testID={`${testID}-table`}
                    caption={t('catalogue:tools.macroTable')}
                    columns={columns}
                    rows={result.macros}
                    rowKey={(row) => row.nutrientId}
                />

                {result.nutrients.length === 0 ? null : (
                    <Stack space="xs" testID={`${testID}-nutrients`}>
                        <Text variant="label">{t('catalogue:tools.nutrientsTitle')}</Text>
                        {result.nutrients.map((nutrient) => (
                            <Text key={nutrient.nutrientId}>
                                {t('catalogue:tools.nutrientRow', {
                                    nutrient: t(`marketplace:nutrients.${nutrient.nutrientId}`, {
                                        defaultValue: nutrient.nutrientId,
                                    }),
                                    value: formatter.formatNumber(Math.round(nutrient.value)),
                                    unit: nutrient.unit,
                                })}
                            </Text>
                        ))}
                    </Stack>
                )}
            </Stack>
        </Card>
    );
}
