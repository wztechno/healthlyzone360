import type { MonthlyCostReportRow } from '@healthy360/api-client/contracts';
import {
    Badge,
    EmptyState,
    ErrorState,
    Inline,
    Select,
    Skeleton,
    Stack,
    Table,
    Text,
    TextInputField,
} from '@healthy360/design-system';
import type { TableColumn } from '@healthy360/design-system';
import { useFormatter } from '@healthy360/i18n';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { Gate } from '../../../access/gate.tsx';
import { toFailure } from '../../../data/hooks.ts';
import { useCostReportQuery } from '../../../data/kitchen-ops-hooks.ts';
import { BarChart, ChartFrame, DonutChart, LineChart } from '../analytics-charts.tsx';
import { INVENTORY_VIEW_COSTS_PERMISSION } from '../entity-registry.ts';
import { KpiTile } from '../kpi-tile.tsx';

/**
 * `/kitchen/cost-report` — the monthly cost report (INV1.4).
 *
 * Purchasing spend and cost of goods sold set beside the month's selling revenue, so a manager
 * reads the margin at a glance — real repository figures, not the sample data the analytics
 * dashboard runs on. Behind `inventory.view_costs_organisation`: the report *is* the valuation and
 * the margin reconstructable from it, so a person without the cost permission never reaches it.
 *
 * Figures are never summed across currencies (there is no exchange rate — §4.4), so the screen picks
 * one currency at a time; every amount is a major-unit decimal.
 *
 * **Two honesty notes, because two different figures can be short.** A month whose COGS is
 * understated by unresolved consumption exceptions is flagged rather than shown as complete
 * (INV1.2); and since SUP6 a month whose *spend* is understated — a delivery whose invoice has not
 * been entered, or a price that could not be valued in the ingredient's currency (§3.6) — says so on
 * its own note. Merging them would leave a manager unable to tell which number to distrust. The
 * purchases ledger's weekly and monthly summary is where the affected deliveries are found.
 */
export function CostReportScreen() {
    return (
        <Gate
            area="kitchen"
            requirement={{ allOf: [INVENTORY_VIEW_COSTS_PERMISSION] }}
            testID="kitchen-cost-report"
        >
            <CostReport />
        </Gate>
    );
}

function StatTile({
    testID,
    label,
    value,
}: {
    readonly testID: string;
    readonly label: string;
    readonly value: string;
}) {
    return <KpiTile testID={testID} size="lg" label={label} value={value} />;
}

function CostReport() {
    const { t } = useTranslation();
    const formatter = useFormatter();

    const [from, setFrom] = useState('');
    const [to, setTo] = useState('');

    const filter = useMemo(
        () => ({
            ...(from.trim() === '' ? {} : { from: from.trim() }),
            ...(to.trim() === '' ? {} : { to: to.trim() }),
        }),
        [from, to],
    );
    const report = useCostReportQuery(filter);
    const rows = useMemo(() => report.data ?? [], [report.data]);

    // Figures are never summed across currencies, so the screen shows one at a time. Default to the
    // currency of the newest row; a second currency (rare — GreenLife is USD) offers a selector.
    const currencies = useMemo(() => [...new Set(rows.map((row) => row.currencyCode))], [rows]);
    const [currency, setCurrency] = useState<string | null>(null);
    const activeCurrency = currency ?? currencies[0] ?? null;

    const currencyRows = useMemo(
        () => rows.filter((row) => row.currencyCode === activeCurrency),
        [rows, activeCurrency],
    );

    // Charts read a trend, so oldest → newest; the table and tiles read newest first.
    const chronological = useMemo(
        () => [...currencyRows].sort((left, right) => left.month.localeCompare(right.month)),
        [currencyRows],
    );
    const latest = currencyRows[0] ?? null;
    const flaggedCount = currencyRows.filter((row) => row.hasDataQualityFlag).length;

    // The spend side's own completeness (SUP6, §3.6), read separately from the COGS flag above
    // because the two undermine different figures. The lines are counted once per month rather than
    // once per row: they are a month fact repeated across a month's currencies, so summing the rows
    // would double-count a month that traded in two currencies.
    const incompleteSpend = useMemo(() => {
        const byMonth = new Map<string, number>();
        for (const row of currencyRows) {
            if (row.isSpendComplete) continue;
            byMonth.set(row.month, row.unpricedLineCount + row.valuationPendingLineCount);
        }
        const months = [...byMonth.keys()].sort((left, right) => right.localeCompare(left));
        return {
            months,
            lineCount: [...byMonth.values()].reduce((sum, count) => sum + count, 0),
        };
    }, [currencyRows]);

    const money = (amount: string | null): string => {
        if (amount === null || activeCurrency === null) return '—';
        return `${formatter.formatNumber(Number(amount), {
            minimumFractionDigits: 2,
            maximumFractionDigits: 2,
        })} ${activeCurrency}`;
    };

    const percent = (value: string | null): string =>
        value === null ? '—' : `${formatter.formatNumber(Number(value))}%`;

    // The line-of-business donut is a mix, so amounts become percentages of their own total; the
    // absolute figures live in the table. Values are integers summing to ~100, which is the donut's
    // own shape (it appends a '%').
    const mixSlices = useMemo(() => {
        if (latest === null) return [];
        const meal = Number(latest.mealRevenueAmount);
        const product = Number(latest.productRevenueAmount);
        const other = Number(latest.otherRevenueAmount);
        const total = meal + product + other;
        if (total <= 0) return [];
        const pct = (value: number) => Math.round((value / total) * 100);
        return [
            {
                key: 'meal',
                labelKey: 'kitchen:ops.costReport.mixMeal',
                value: pct(meal),
                colorClass: 'bg-brand-500',
                colorToken: '#16a34a',
            },
            {
                key: 'product',
                labelKey: 'kitchen:ops.costReport.mixProduct',
                value: pct(product),
                colorClass: 'bg-info',
                colorToken: '#0ea5e9',
            },
            {
                key: 'other',
                labelKey: 'kitchen:ops.costReport.mixOther',
                value: pct(other),
                colorClass: 'bg-warning',
                colorToken: '#f59e0b',
            },
        ].filter((slice) => slice.value > 0);
    }, [latest]);

    // The COGS mix (INV1.5), the mirror of the revenue mix — meal-versus-product cost of goods sold,
    // shown beside it so a manager reads where the month's cost fell as well as where its revenue did.
    const cogsMixSlices = useMemo(() => {
        if (latest === null) return [];
        const meal = Number(latest.mealCogsAmount);
        const product = Number(latest.productCogsAmount);
        const other = Number(latest.otherCogsAmount);
        const total = meal + product + other;
        if (total <= 0) return [];
        const pct = (value: number) => Math.round((value / total) * 100);
        return [
            {
                key: 'meal',
                labelKey: 'kitchen:ops.costReport.mixMeal',
                value: pct(meal),
                colorClass: 'bg-brand-500',
                colorToken: '#16a34a',
            },
            {
                key: 'product',
                labelKey: 'kitchen:ops.costReport.mixProduct',
                value: pct(product),
                colorClass: 'bg-info',
                colorToken: '#0ea5e9',
            },
            {
                key: 'other',
                labelKey: 'kitchen:ops.costReport.mixOther',
                value: pct(other),
                colorClass: 'bg-warning',
                colorToken: '#f59e0b',
            },
        ].filter((slice) => slice.value > 0);
    }, [latest]);

    const columns: readonly TableColumn<MonthlyCostReportRow>[] = [
        {
            key: 'month',
            header: t('kitchen:ops.costReport.columnMonth'),
            rowHeader: true,
            render: (row) => (
                <Inline space="xs" className="items-center">
                    <Text testID={`kitchen-cost-report-${row.month}-month`} variant="bodyStrong">
                        {row.month}
                    </Text>
                    {row.hasDataQualityFlag ? (
                        <Badge
                            testID={`kitchen-cost-report-${row.month}-flag`}
                            tone="warning"
                            icon="warning"
                            label={t('kitchen:ops.costReport.flagged')}
                        />
                    ) : null}
                </Inline>
            ),
        },
        {
            key: 'spend',
            header: t('kitchen:ops.costReport.columnSpend'),
            numeric: true,
            render: (row) => <Text>{money(row.spendAmount)}</Text>,
        },
        {
            key: 'cogs',
            header: t('kitchen:ops.costReport.columnCogs'),
            numeric: true,
            render: (row) => <Text>{money(row.cogsAmount)}</Text>,
        },
        {
            key: 'revenue',
            header: t('kitchen:ops.costReport.columnRevenue'),
            numeric: true,
            render: (row) => <Text>{money(row.revenueAmount)}</Text>,
        },
        {
            key: 'margin',
            header: t('kitchen:ops.costReport.columnMargin'),
            numeric: true,
            render: (row) => (
                <Text variant="bodyStrong" testID={`kitchen-cost-report-${row.month}-margin`}>
                    {money(row.grossMarginAmount)}
                </Text>
            ),
        },
        {
            key: 'marginPercent',
            header: t('kitchen:ops.costReport.columnMarginPercent'),
            numeric: true,
            render: (row) => <Text tone="secondary">{percent(row.grossMarginPercent)}</Text>,
        },
    ];

    const failure = toFailure(report.error);

    return (
        <Stack space="lg" testID="kitchen-cost-report-screen">
            <Stack space="xs">
                <Text
                    className="font-display text-[28px] font-bold text-content-primary"
                    testID="kitchen-cost-report-title"
                >
                    {t('kitchen:ops.costReport.title')}
                </Text>
                <Text tone="secondary" testID="kitchen-cost-report-subtitle">
                    {t('kitchen:ops.costReport.subtitle')}
                </Text>
            </Stack>

            <View
                testID="kitchen-cost-report-filters"
                className="gap-4 rounded-panel border border-brand-100 bg-surface-raised p-4 shadow-elevation-1"
            >
                <Inline space="sm" align="end" wrap>
                    <TextInputField
                        testID="kitchen-cost-report-filter-from"
                        label={t('kitchen:ops.costReport.filterFrom')}
                        value={from}
                        onChangeText={setFrom}
                        placeholder="YYYY-MM"
                        className="w-40"
                    />
                    <TextInputField
                        testID="kitchen-cost-report-filter-to"
                        label={t('kitchen:ops.costReport.filterTo')}
                        value={to}
                        onChangeText={setTo}
                        placeholder="YYYY-MM"
                        className="w-40"
                    />
                    {currencies.length > 1 ? (
                        <Select
                            testID="kitchen-cost-report-filter-currency"
                            label={t('kitchen:ops.costReport.currencyLabel')}
                            options={currencies.map((code) => ({ value: code, label: code }))}
                            value={activeCurrency ?? ''}
                            onChange={(value) => {
                                setCurrency(value);
                            }}
                            className="min-w-[140px]"
                        />
                    ) : null}
                </Inline>
            </View>

            {report.isPending ? (
                <Stack space="sm" testID="kitchen-cost-report-loading">
                    {Array.from({ length: 4 }, (_, index) => (
                        <Skeleton key={index} heightClassName="h-16" />
                    ))}
                </Stack>
            ) : failure !== null ? (
                <ErrorState
                    testID="kitchen-cost-report-error"
                    failure={failure}
                    onRetry={() => {
                        void report.refetch();
                    }}
                    retrying={report.isFetching}
                />
            ) : currencyRows.length === 0 ? (
                <EmptyState
                    testID="kitchen-cost-report-empty"
                    title={t('kitchen:ops.costReport.emptyTitle')}
                    body={t('kitchen:ops.costReport.emptyBody')}
                />
            ) : (
                <Stack space="lg">
                    {flaggedCount > 0 ? (
                        <View
                            testID="kitchen-cost-report-data-quality"
                            className="flex-row items-start gap-3 rounded-panel border border-warning/40 bg-warning/10 p-4"
                        >
                            <Badge
                                tone="warning"
                                icon="warning"
                                label={t('kitchen:ops.costReport.flagged')}
                            />
                            <Stack space="none" className="min-w-0 flex-1">
                                <Text variant="bodyStrong">
                                    {t('kitchen:ops.costReport.dataQualityTitle')}
                                </Text>
                                <Text tone="secondary" variant="caption">
                                    {t('kitchen:ops.costReport.dataQualityBody', {
                                        count: flaggedCount,
                                    })}
                                </Text>
                            </Stack>
                        </View>
                    ) : null}

                    {incompleteSpend.months.length > 0 ? (
                        <View
                            testID="kitchen-cost-report-spend-quality"
                            className="flex-row items-start gap-3 rounded-panel border border-warning/40 bg-warning/10 p-4"
                        >
                            <Badge
                                tone="warning"
                                icon="warning"
                                label={t('kitchen:ops.costReport.spendIncomplete')}
                            />
                            <Stack space="none" className="min-w-0 flex-1">
                                <Text variant="bodyStrong">
                                    {t('kitchen:ops.costReport.spendIncompleteTitle')}
                                </Text>
                                <Text tone="secondary" variant="caption">
                                    {t('kitchen:ops.costReport.spendIncompleteBody', {
                                        count: incompleteSpend.lineCount,
                                        months: incompleteSpend.months.join(', '),
                                    })}
                                </Text>
                            </Stack>
                        </View>
                    ) : null}

                    {latest !== null ? (
                        <View
                            testID="kitchen-cost-report-tiles"
                            className="flex-row flex-wrap gap-3"
                        >
                            <StatTile
                                testID="kitchen-cost-report-tile-spend"
                                label={t('kitchen:ops.costReport.tileSpend', {
                                    month: latest.month,
                                })}
                                value={money(latest.spendAmount)}
                            />
                            <StatTile
                                testID="kitchen-cost-report-tile-cogs"
                                label={t('kitchen:ops.costReport.tileCogs', {
                                    month: latest.month,
                                })}
                                value={money(latest.cogsAmount)}
                            />
                            <StatTile
                                testID="kitchen-cost-report-tile-revenue"
                                label={t('kitchen:ops.costReport.tileRevenue', {
                                    month: latest.month,
                                })}
                                value={money(latest.revenueAmount)}
                            />
                            <StatTile
                                testID="kitchen-cost-report-tile-margin"
                                label={t('kitchen:ops.costReport.tileMargin', {
                                    month: latest.month,
                                })}
                                value={money(latest.grossMarginAmount)}
                            />
                        </View>
                    ) : null}

                    <View className="flex-col gap-3 lg:flex-row">
                        <ChartFrame
                            testID="kitchen-cost-report-chart-revenue"
                            title={t('kitchen:ops.costReport.chartRevenueTrend')}
                        >
                            <LineChart
                                testID="kitchen-cost-report-revenue-line"
                                points={chronological.map((row) => ({
                                    label: row.month,
                                    value: Math.round(Number(row.revenueAmount)),
                                }))}
                            />
                        </ChartFrame>
                        <ChartFrame
                            testID="kitchen-cost-report-chart-cogs"
                            title={t('kitchen:ops.costReport.chartCogs')}
                        >
                            <BarChart
                                testID="kitchen-cost-report-cogs-bar"
                                points={chronological.map((row) => ({
                                    label: row.month,
                                    value: Math.round(Number(row.cogsAmount)),
                                }))}
                            />
                        </ChartFrame>
                    </View>

                    {mixSlices.length > 0 || cogsMixSlices.length > 0 ? (
                        <View className="flex-col gap-3 lg:flex-row">
                            {mixSlices.length > 0 ? (
                                <ChartFrame
                                    testID="kitchen-cost-report-chart-mix"
                                    title={t('kitchen:ops.costReport.chartRevenueMix', {
                                        month: latest?.month ?? '',
                                    })}
                                >
                                    <DonutChart
                                        testID="kitchen-cost-report-mix-donut"
                                        slices={mixSlices}
                                        centerLabel={t('kitchen:ops.costReport.mixCenter')}
                                        sliceLabel={(slice) => t(slice.labelKey)}
                                    />
                                </ChartFrame>
                            ) : null}
                            {cogsMixSlices.length > 0 ? (
                                <ChartFrame
                                    testID="kitchen-cost-report-chart-cogs-mix"
                                    title={t('kitchen:ops.costReport.chartCogsMix', {
                                        month: latest?.month ?? '',
                                    })}
                                >
                                    <DonutChart
                                        testID="kitchen-cost-report-cogs-mix-donut"
                                        slices={cogsMixSlices}
                                        centerLabel={t('kitchen:ops.costReport.cogsMixCenter')}
                                        sliceLabel={(slice) => t(slice.labelKey)}
                                    />
                                </ChartFrame>
                            ) : null}
                        </View>
                    ) : null}

                    <View
                        testID="kitchen-cost-report-table-panel"
                        className="gap-4 rounded-panel border border-brand-100 bg-surface-raised p-4 shadow-elevation-1"
                    >
                        <Table<MonthlyCostReportRow>
                            testID="kitchen-cost-report-table"
                            caption={t('kitchen:ops.costReport.caption')}
                            captionHidden
                            columns={columns}
                            rows={currencyRows}
                            rowKey={(row) => `${row.month}-${row.currencyCode}`}
                        />
                    </View>
                </Stack>
            )}
        </Stack>
    );
}
