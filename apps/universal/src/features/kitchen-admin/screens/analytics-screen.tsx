import {
    Badge,
    Button,
    FadeIn,
    Heading,
    PageTransition,
    Stack,
    Table,
    Tabs,
    Text,
    TextInputField,
    useAnimatedNumber,
    useMotion,
    useTheme,
} from '@healthy360/design-system';
import type { TableColumn, TableSortDirection } from '@healthy360/design-system';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { Gate } from '../../../access/gate.tsx';
import { BarChart, ChartFrame, DonutChart, LineChart } from '../analytics-charts.tsx';
import {
    ANALYTICS_DATE_RANGES,
    ANALYTICS_SEGMENTS,
    buildKitchenAnalytics,
} from '../analytics-sample-data.ts';
import type {
    AnalyticsDateRange,
    AnalyticsKpi,
    AnalyticsSegment,
    AnalyticsTableRow,
} from '../analytics-sample-data.ts';
import { CATALOGUE_VIEW_PERMISSION } from '../entity-registry.ts';
import { KpiTile } from '../kpi-tile.tsx';

type SortKey = 'name' | 'volume' | 'completionPercent' | 'avgMinutes';

function formatKpiValue(kpi: AnalyticsKpi, animated: number): string {
    if (kpi.unit === 'percent') return `${animated}%`;
    if (kpi.unit === 'minutes') return `${animated}m`;
    return String(animated);
}

function trendIsPositive(kpi: AnalyticsKpi): boolean {
    if (kpi.higherIsBetter) return kpi.deltaPercent >= 0;
    return kpi.deltaPercent <= 0;
}

function KpiCard({ kpi, testID }: { readonly kpi: AnalyticsKpi; readonly testID: string }) {
    const { t } = useTranslation();
    const animated = useAnimatedNumber(kpi.value);
    const positive = trendIsPositive(kpi);
    const deltaLabel =
        kpi.deltaPercent > 0
            ? t('kitchen:analytics.trend.up', { value: Math.abs(kpi.deltaPercent) })
            : kpi.deltaPercent < 0
              ? t('kitchen:analytics.trend.down', { value: Math.abs(kpi.deltaPercent) })
              : t('kitchen:analytics.trend.flat');

    return (
        <KpiTile
            testID={testID}
            size="lg"
            label={t(kpi.labelKey)}
            value={formatKpiValue(kpi, animated)}
            trend={
                <Badge
                    testID={`${testID}-trend`}
                    tone={positive ? 'success' : 'danger'}
                    icon={positive ? 'chevronUp' : 'chevronDown'}
                    label={deltaLabel}
                />
            }
        />
    );
}

function sortRows(
    rows: readonly AnalyticsTableRow[],
    sortKey: SortKey,
    direction: TableSortDirection,
): AnalyticsTableRow[] {
    const factor = direction === 'asc' ? 1 : -1;
    return [...rows].sort((left, right) => {
        if (sortKey === 'name') {
            return left.name.localeCompare(right.name) * factor;
        }
        return (left[sortKey] - right[sortKey]) * factor;
    });
}

function AnalyticsDashboard() {
    const { t } = useTranslation();
    const { stagger } = useMotion();
    const { isDark, toggleTheme } = useTheme();

    const [range, setRange] = useState<AnalyticsDateRange>('30d');
    const [segment, setSegment] = useState<AnalyticsSegment>('all');
    const [query, setQuery] = useState('');
    const [statusFilter, setStatusFilter] = useState<'all' | AnalyticsTableRow['status']>('all');
    const [sortKey, setSortKey] = useState<SortKey>('volume');
    const [sortDirection, setSortDirection] = useState<TableSortDirection>('desc');

    const bundle = useMemo(() => buildKitchenAnalytics(range, segment), [range, segment]);
    const filterKey = `${range}:${segment}`;

    const filteredRows = useMemo(() => {
        const needle = query.trim().toLowerCase();
        const rows = bundle.rows.filter((row) => {
            if (statusFilter !== 'all' && row.status !== statusFilter) return false;
            if (needle.length === 0) return true;
            return (
                row.name.toLowerCase().includes(needle) ||
                row.segment.toLowerCase().includes(needle) ||
                row.updatedLabel.toLowerCase().includes(needle)
            );
        });
        return sortRows(rows, sortKey, sortDirection);
    }, [bundle.rows, query, statusFilter, sortKey, sortDirection]);

    const columns = useMemo<TableColumn<AnalyticsTableRow>[]>(
        () => [
            {
                key: 'name',
                header: t('kitchen:analytics.table.name'),
                rowHeader: true,
                sortable: true,
                flex: 1.4,
                render: (row) => (
                    <Text className="font-medium text-content-primary">{row.name}</Text>
                ),
            },
            {
                key: 'segment',
                header: t('kitchen:analytics.table.segment'),
                flex: 0.9,
                render: (row) => (
                    <Text tone="secondary">{t(`kitchen:analytics.segments.${row.segment}`)}</Text>
                ),
            },
            {
                key: 'status',
                header: t('kitchen:analytics.table.status'),
                flex: 0.9,
                render: (row) => (
                    <Badge
                        tone={
                            row.status === 'on_track'
                                ? 'success'
                                : row.status === 'watch'
                                  ? 'warning'
                                  : 'danger'
                        }
                        label={t(`kitchen:analytics.status.${statusKey(row.status)}`)}
                    />
                ),
            },
            {
                key: 'volume',
                header: t('kitchen:analytics.table.volume'),
                numeric: true,
                sortable: true,
                flex: 0.7,
                render: (row) => <Text variant="mono">{row.volume}</Text>,
            },
            {
                key: 'completionPercent',
                header: t('kitchen:analytics.table.completion'),
                numeric: true,
                sortable: true,
                flex: 0.8,
                render: (row) => <Text>{row.completionPercent}%</Text>,
            },
            {
                key: 'avgMinutes',
                header: t('kitchen:analytics.table.avgMinutes'),
                numeric: true,
                sortable: true,
                flex: 0.7,
                render: (row) => <Text>{row.avgMinutes}m</Text>,
            },
            {
                key: 'updated',
                header: t('kitchen:analytics.table.updated'),
                flex: 0.8,
                render: (row) => (
                    <Text tone="secondary" variant="caption">
                        {row.updatedLabel}
                    </Text>
                ),
            },
        ],
        [t],
    );

    return (
        <PageTransition testID="kitchen-analytics-panel" transitionKey={filterKey}>
            <Stack space="lg">
                <FadeIn delayMs={stagger(0)}>
                    <View className="flex-col gap-4 md:flex-row md:items-start md:justify-between">
                        <Stack space="xs" className="min-w-0 flex-1">
                            <Heading level={1} testID="kitchen-analytics-title">
                                {t('kitchen:analytics.title')}
                            </Heading>
                            <Text tone="secondary" testID="kitchen-analytics-subtitle">
                                {t('kitchen:analytics.subtitle')}
                            </Text>
                            <Badge
                                testID="kitchen-analytics-sample-badge"
                                tone="info"
                                icon="info"
                                label={t('kitchen:analytics.sampleBadge')}
                            />
                        </Stack>
                        <Button
                            testID="kitchen-analytics-theme-toggle"
                            variant="secondary"
                            size="sm"
                            label={
                                isDark
                                    ? t('kitchen:analytics.theme.light')
                                    : t('kitchen:analytics.theme.dark')
                            }
                            onPress={toggleTheme}
                        />
                    </View>
                </FadeIn>

                <FadeIn delayMs={stagger(1)}>
                    <View
                        testID="kitchen-analytics-filters"
                        className="gap-4 rounded-panel border border-brand-100 bg-surface-raised p-4 shadow-elevation-card"
                    >
                        <Tabs
                            testID="kitchen-analytics-range"
                            label={t('kitchen:analytics.filters.dateRange')}
                            variant="segmented"
                            block
                            value={range}
                            onChange={setRange}
                            items={ANALYTICS_DATE_RANGES.map((value) => ({
                                value,
                                label: t(`kitchen:analytics.ranges.${value}`),
                                testID: `kitchen-analytics-range-${value}`,
                            }))}
                        />
                        <Tabs
                            testID="kitchen-analytics-segment"
                            label={t('kitchen:analytics.filters.segment')}
                            variant="segmented"
                            block
                            value={segment}
                            onChange={setSegment}
                            items={ANALYTICS_SEGMENTS.map((value) => ({
                                value,
                                label: t(`kitchen:analytics.segments.${value}`),
                                testID: `kitchen-analytics-segment-${value}`,
                            }))}
                        />
                    </View>
                </FadeIn>

                <FadeIn delayMs={stagger(2)}>
                    <View testID="kitchen-analytics-kpis" className="flex-row flex-wrap gap-3">
                        {bundle.kpis.map((kpi) => (
                            <KpiCard
                                key={`${filterKey}-${kpi.key}`}
                                kpi={kpi}
                                testID={`kitchen-analytics-kpi-${kpi.key}`}
                            />
                        ))}
                    </View>
                </FadeIn>

                <FadeIn delayMs={stagger(3)}>
                    <View className="flex-col gap-3 lg:flex-row">
                        <ChartFrame
                            testID="kitchen-analytics-chart-line"
                            title={t('kitchen:analytics.charts.productionTrend')}
                        >
                            <LineChart
                                testID="kitchen-analytics-line"
                                points={bundle.productionTrend}
                            />
                        </ChartFrame>
                        <ChartFrame
                            testID="kitchen-analytics-chart-bar"
                            title={t('kitchen:analytics.charts.channelVolume')}
                        >
                            <BarChart
                                testID="kitchen-analytics-bar"
                                points={bundle.channelVolume.map((point) => ({
                                    ...point,
                                    label: t(`kitchen:analytics.charts.channels.${point.label}`),
                                }))}
                            />
                        </ChartFrame>
                    </View>
                </FadeIn>

                <FadeIn delayMs={stagger(4)}>
                    <ChartFrame
                        testID="kitchen-analytics-chart-donut"
                        title={t('kitchen:analytics.charts.statusMix')}
                    >
                        <DonutChart
                            testID="kitchen-analytics-donut"
                            slices={bundle.statusMix}
                            centerLabel={t('kitchen:analytics.charts.statusCenter')}
                            sliceLabel={(slice) => t(slice.labelKey)}
                        />
                    </ChartFrame>
                </FadeIn>

                <FadeIn delayMs={stagger(5)}>
                    <View
                        testID="kitchen-analytics-table-panel"
                        className="gap-4 rounded-panel border border-brand-100 bg-surface-raised p-4 shadow-elevation-card"
                    >
                        <Stack space="xs">
                            <Heading level={2}>{t('kitchen:analytics.table.title')}</Heading>
                            <Text tone="secondary">{t('kitchen:analytics.table.subtitle')}</Text>
                        </Stack>

                        <View className="flex-col gap-3 md:flex-row md:items-end">
                            <View className="min-w-0 flex-1">
                                <TextInputField
                                    testID="kitchen-analytics-table-search"
                                    label={t('kitchen:analytics.table.search')}
                                    value={query}
                                    onChangeText={setQuery}
                                    placeholder={t('kitchen:analytics.table.searchPlaceholder')}
                                    autoCorrect={false}
                                />
                            </View>
                            <Tabs
                                testID="kitchen-analytics-status-filter"
                                label={t('kitchen:analytics.table.statusFilter')}
                                variant="segmented"
                                value={statusFilter}
                                onChange={setStatusFilter}
                                items={[
                                    {
                                        value: 'all',
                                        label: t('kitchen:analytics.status.all'),
                                        testID: 'kitchen-analytics-status-all',
                                    },
                                    {
                                        value: 'on_track',
                                        label: t('kitchen:analytics.status.onTrack'),
                                        testID: 'kitchen-analytics-status-on_track',
                                    },
                                    {
                                        value: 'watch',
                                        label: t('kitchen:analytics.status.watch'),
                                        testID: 'kitchen-analytics-status-watch',
                                    },
                                    {
                                        value: 'blocked',
                                        label: t('kitchen:analytics.status.blocked'),
                                        testID: 'kitchen-analytics-status-blocked',
                                    },
                                ]}
                            />
                        </View>

                        <Table
                            testID="kitchen-analytics-table"
                            caption={t('kitchen:analytics.table.caption')}
                            columns={columns}
                            rows={filteredRows}
                            rowKey={(row) => row.id}
                            emptyLabel={t('kitchen:analytics.table.empty')}
                            sortKey={sortKey}
                            sortDirection={sortDirection}
                            onSortChange={(key, direction) => {
                                if (
                                    key === 'name' ||
                                    key === 'volume' ||
                                    key === 'completionPercent' ||
                                    key === 'avgMinutes'
                                ) {
                                    setSortKey(key);
                                    setSortDirection(direction);
                                }
                            }}
                        />
                    </View>
                </FadeIn>
            </Stack>
        </PageTransition>
    );
}

function statusKey(status: AnalyticsTableRow['status']): 'onTrack' | 'watch' | 'blocked' {
    if (status === 'on_track') return 'onTrack';
    return status;
}

export function AnalyticsScreen() {
    return (
        <Gate
            area="kitchen"
            requirement={{ allOf: [CATALOGUE_VIEW_PERMISSION] }}
            testID="kitchen-analytics"
        >
            <AnalyticsDashboard />
        </Gate>
    );
}
