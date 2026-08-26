import { EmptyState, FadeIn, PageTransition, Stack, Text, useMotion } from '@healthy360/design-system';
import { useFormatter } from '@healthy360/i18n';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { KitchenPageHeader } from './kitchen-page-header.tsx';

/**
 * Shared chrome for stock / procurement / production / QC.
 *
 * ## Metrics are live list counts, not KPIs
 *
 * Every `OpsMetric.value` is a count of rows a screen actually fetched — never a fabricated figure.
 * `null` is the honest "not known yet" state (the underlying query is still pending, or it failed),
 * and renders as an em dash rather than a zero, because a zero would tell a kitchen manager there is
 * nothing on hand when the true answer is "the count could not be read".
 */

export interface OpsMetric {
    readonly key: string;
    readonly labelKey: string;
    /** A count from a list the screen fetched. `null` while pending or unavailable. */
    readonly value: number | null;
}

export interface OpsPanelProps {
    readonly testID: string;
    readonly titleKey: string;
    readonly subtitleKey: string;
    readonly metrics: readonly OpsMetric[];
    readonly emptyTitleKey: string;
    readonly emptyBodyKey: string;
    /** Status badge beside the title, where the board has a state ("1 item short"). */
    readonly statusChip?: ReactNode | undefined;
    /** Right-aligned on the title row. One primary maximum (Rule 4). */
    readonly actions?: ReactNode | undefined;
    readonly children?: ReactNode | undefined;
}

function MetricSlot({
    testID,
    label,
    value,
}: {
    readonly testID: string;
    readonly label: string;
    readonly value: number | null;
}) {
    const formatter = useFormatter();

    return (
        <View
            testID={testID}
            className="min-h-[88px] flex-1 rounded-panel border border-brand-100 bg-surface-raised p-4 shadow-elevation-card"
        >
            <Text
                testID={`${testID}-value`}
                className="font-display text-[25px] font-bold text-content-primary"
            >
                {value === null ? '—' : formatter.formatNumber(value)}
            </Text>
            <Text tone="secondary" variant="caption" className="mt-0.5">
                {label}
            </Text>
        </View>
    );
}

export function OpsPanel({
    testID,
    titleKey,
    subtitleKey,
    metrics,
    emptyTitleKey,
    emptyBodyKey,
    statusChip,
    actions,
    children,
}: OpsPanelProps) {
    const { t } = useTranslation();
    const { stagger } = useMotion();

    return (
        <PageTransition testID={testID} transitionKey={testID}>
            <Stack space="lg">
                <FadeIn delayMs={stagger(0)}>
                    <KitchenPageHeader
                        testID={`${testID}-header`}
                        title={t(titleKey)}
                        subtitle={t(subtitleKey)}
                        titleTestID={`${testID}-title`}
                        subtitleTestID={`${testID}-subtitle`}
                        statusChip={statusChip}
                        actions={actions}
                    />
                </FadeIn>

                <FadeIn delayMs={stagger(1)} testID={`${testID}-metrics`}>
                    <View className="flex-col gap-3.5 md:flex-row">
                        {metrics.map((metric) => (
                            <MetricSlot
                                key={metric.key}
                                testID={`${testID}-metric-${metric.key}`}
                                label={t(metric.labelKey)}
                                value={metric.value}
                            />
                        ))}
                    </View>
                </FadeIn>

                <FadeIn delayMs={stagger(2)}>
                    <View className="rounded-panel border border-brand-100 bg-surface-raised p-4 shadow-elevation-card md:p-5">
                        {children ?? (
                            <EmptyState
                                testID={`${testID}-empty`}
                                title={t(emptyTitleKey)}
                                body={t(emptyBodyKey)}
                            />
                        )}
                    </View>
                </FadeIn>
            </Stack>
        </PageTransition>
    );
}
