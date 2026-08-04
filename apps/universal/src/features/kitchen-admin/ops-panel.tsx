import {
    Badge,
    EmptyState,
    FadeIn,
    Heading,
    Inline,
    PageTransition,
    Stack,
    Text,
    useMotion,
} from '@healthy360/design-system';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

/**
 * Shared chrome for stock / procurement / production / QC — intentional ops panels that are
 * UI-ready but do not invent API numbers.
 */

export interface OpsMetricPlaceholder {
    readonly key: string;
    readonly labelKey: string;
}

export interface OpsPanelProps {
    readonly testID: string;
    readonly titleKey: string;
    readonly subtitleKey: string;
    readonly metrics: readonly OpsMetricPlaceholder[];
    readonly emptyTitleKey: string;
    readonly emptyBodyKey: string;
    readonly children?: ReactNode | undefined;
}

function MetricSlot({
    testID,
    label,
}: {
    readonly testID: string;
    readonly label: string;
}) {
    const { t } = useTranslation();

    return (
        <View
            testID={testID}
            className="min-h-[88px] flex-1 rounded-[14px] border border-brand-100 bg-surface-raised p-4 shadow-elevation-1"
        >
            <Text
                testID={`${testID}-value`}
                className="font-display text-[25px] font-bold text-content-secondary"
            >
                —
            </Text>
            <Text tone="secondary" variant="caption" className="mt-0.5">
                {label}
            </Text>
            <Text tone="secondary" variant="caption" className="mt-1.5 font-bold text-brand-600">
                {t('kitchen:ops.metricUnavailable')}
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
    children,
}: OpsPanelProps) {
    const { t } = useTranslation();
    const { stagger } = useMotion();

    return (
        <PageTransition testID={testID} transitionKey={testID}>
            <Stack space="lg">
                <FadeIn delayMs={stagger(0)}>
                    <Inline space="sm" align="center" wrap>
                        <Stack space="xs" grow>
                            <Heading level={1} testID={`${testID}-title`}>
                                {t(titleKey)}
                            </Heading>
                            <Text tone="secondary" testID={`${testID}-subtitle`}>
                                {t(subtitleKey)}
                            </Text>
                        </Stack>
                        <Badge
                            testID={`${testID}-status`}
                            tone="brand"
                            label={t('kitchen:ops.readyForApi')}
                        />
                    </Inline>
                </FadeIn>

                <FadeIn delayMs={stagger(1)} testID={`${testID}-metrics`}>
                    <View className="flex-col gap-3.5 md:flex-row">
                        {metrics.map((metric) => (
                            <MetricSlot
                                key={metric.key}
                                testID={`${testID}-metric-${metric.key}`}
                                label={t(metric.labelKey)}
                            />
                        ))}
                    </View>
                </FadeIn>

                <FadeIn delayMs={stagger(2)}>
                    <View className="rounded-2xl border border-brand-100 bg-surface-raised p-4 shadow-elevation-1 md:p-5">
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
