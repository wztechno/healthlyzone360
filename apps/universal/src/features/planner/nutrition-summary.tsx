import { Card, Inline, MeterBar, ProgressRing, Stack, Text } from '@healthy360/design-system';
import type { MealPlanEntry } from '@healthy360/api-client/contracts';
import type { Money } from '@healthy360/domain-types';
import { useFormatter } from '@healthy360/i18n';
import type { NutrientTarget, NutritionFacts } from '@healthy360/nutrition';
import { useTranslation } from 'react-i18next';

import { MedicalDisclaimer } from '../../safety/medical-disclaimer.tsx';
import { formatMoney } from '../marketplace/format.ts';
import { summaryReadings, totalCost, unpricedCount } from './format.ts';

/**
 * Planned nutrition against target, for a day or for a week.
 *
 * ## Planned, never "actual"
 *
 * `DailyNutritionSummary` carries `planned`, `actual` and `target` as three separate fields, and
 * `actual` is `null` until something has been logged. This panel renders `planned` and says so in
 * the heading; when `actual` is present it is shown *beside* the planned figure and labelled, never
 * merged into it. That separation is doc 17, PLN-02 in its least glamorous form: a planner that
 * quietly presented its intentions as a record of what somebody ate would be making a claim about a
 * person's body from a calendar entry.
 *
 * No contract operation records consumption today — that gap is in the wave report — so in the
 * prototype `actual` is always absent and the panel says "nothing logged yet" rather than drawing a
 * second empty meter.
 *
 * ## Tolerance is drawn, not just stated
 *
 * Doc 17, NUT-06 asks for the tolerance band to be visible rather than numeric-only. `MeterBar`
 * renders the five-stop level as a fill *and* an ordinal pattern mark *and* a numeric label, so the
 * reading survives greyscale (WCAG 1.4.1); the band itself is printed under the bar as the range it
 * is, because a target of 2,100 kcal ±150 is a different instruction from a target of 2,100.
 */
export interface NutritionSummaryProps {
    readonly planned: NutritionFacts;
    readonly actual?: NutritionFacts | null | undefined;
    readonly targets: readonly NutrientTarget[];
    readonly title: string;
    /** Rendered as a ring beside the meters — the day's or week's headline energy figure. */
    readonly headline?: boolean | undefined;
    readonly testID: string;
}

export function NutritionSummary({
    planned,
    actual,
    targets,
    title,
    headline = false,
    testID,
}: NutritionSummaryProps) {
    const { t } = useTranslation();
    const formatter = useFormatter();

    const readings = summaryReadings(planned, targets);
    const energy = readings.find((reading) => reading.nutrientId === 'energy');

    return (
        <Card testID={testID} padding="md" tone="sunken">
            <Stack space="md">
                <Stack space="none">
                    <Text variant="label">{title}</Text>
                    <Text testID={`${testID}-basis`} variant="caption" tone="secondary">
                        {t('planner:summary.plannedBasis')}
                    </Text>
                </Stack>

                {readings.length === 0 ? (
                    <Text testID={`${testID}-no-targets`} tone="secondary">
                        {t('planner:summary.noTargets')}
                    </Text>
                ) : (
                    <Inline space="md" align="center" wrap>
                        {headline && energy !== undefined ? (
                            <ProgressRing
                                testID={`${testID}-ring`}
                                label={t('planner:summary.energyRingLabel')}
                                value={energy.planned}
                                target={energy.target}
                                level={energy.level}
                                levelLabel={t(`marketplace:levels.${energy.level}`)}
                                caption={t('planner:summary.energyCaption')}
                            />
                        ) : null}

                        <Stack space="sm" grow className="min-w-[240px]">
                            {readings.map((reading) => (
                                <Stack key={reading.nutrientId} space="none">
                                    <MeterBar
                                        testID={`${testID}-meter-${reading.nutrientId}`}
                                        label={t(`marketplace:nutrients.${reading.nutrientId}`)}
                                        value={reading.planned}
                                        target={reading.target}
                                        level={reading.level}
                                        levelLabel={t(`marketplace:levels.${reading.level}`)}
                                        valueText={t('planner:summary.meterValue', {
                                            planned: formatter.formatNumber(reading.planned),
                                            target: formatter.formatNumber(reading.target),
                                            unit: reading.unit,
                                        })}
                                    />
                                    <Text
                                        testID={`${testID}-tolerance-${reading.nutrientId}`}
                                        variant="caption"
                                        tone="secondary"
                                    >
                                        {t('planner:summary.tolerance', {
                                            min: formatter.formatNumber(reading.tolerance.min),
                                            max: formatter.formatNumber(reading.tolerance.max),
                                            unit: reading.unit,
                                        })}
                                    </Text>
                                </Stack>
                            ))}
                        </Stack>
                    </Inline>
                )}

                <Text testID={`${testID}-actual`} variant="caption" tone="secondary">
                    {actual === null || actual === undefined
                        ? t('planner:summary.noActual')
                        : t('planner:summary.actualPresent')}
                </Text>

                {/*
                 * The standing test id, not a per-screen one. `medical-disclaimer` is how every
                 * wave asserts the notice reached a health surface (see the component's own note);
                 * renaming it here made the planner's summary look, to that assertion, like a
                 * screen with no disclaimer at all.
                 */}
                <MedicalDisclaimer />
            </Stack>
        </Card>
    );
}

/**
 * The estimated cost of a set of entries.
 *
 * Reports how many entries carry **no** estimate rather than silently treating them as free. A
 * planned restaurant meal has no price in the contract at all, and a weekly total that quietly
 * omitted it would be the most confidently wrong number on the screen.
 */
export interface CostEstimateProps {
    readonly entries: readonly MealPlanEntry[];
    /** The summary's own figure, when the projection carries one. Overrides the derived total. */
    readonly estimatedCost?: Money | null | undefined;
    readonly title: string;
    readonly testID: string;
}

export function CostEstimate({ entries, estimatedCost, title, testID }: CostEstimateProps) {
    const { t } = useTranslation();
    const formatter = useFormatter();

    const derived = totalCost(entries);
    const total = estimatedCost === undefined ? derived : estimatedCost;
    const missing = unpricedCount(entries);

    return (
        <Card testID={testID} padding="md" tone="sunken">
            <Stack space="xs">
                <Text variant="label">{title}</Text>
                <Text testID={`${testID}-total`} variant="bodyStrong">
                    {total === null ? t('planner:cost.unknown') : formatMoney(formatter, total)}
                </Text>
                <Text testID={`${testID}-note`} variant="caption" tone="secondary">
                    {missing === 0
                        ? t('planner:cost.allPriced')
                        : t('planner:cost.someUnpriced', {
                              items: missing,
                          })}
                </Text>
            </Stack>
        </Card>
    );
}
