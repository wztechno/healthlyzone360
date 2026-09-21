import { Badge, SegmentedControl, Select, Stack, Text } from '@healthy360/design-system';
import type { BadgeTone } from '@healthy360/design-system';
import { useFormatter } from '@healthy360/i18n';
import type { TFunction } from 'i18next';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';
import { Gate } from '../../../access/gate.tsx';
import { RatioBars } from '../analytics/ratio-bars.tsx';
import { StatMix } from '../analytics/stat-mix.tsx';
import type { StatMixTone } from '../analytics/stat-mix.tsx';
import { TrendBars } from '../analytics/trend-bars.tsx';
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
import { CatalogueList } from '../catalogue/catalogue-list.tsx';
import { CatalogueStatCards } from '../catalogue/catalogue-stat-cards.tsx';
import type { CatalogueColumn } from '../catalogue/catalogue-column-spec.ts';
import type { ControlledColumn } from '../catalogue/use-column-controls.tsx';
import {
    compareNumber,
    compareText,
    useColumnControls,
} from '../catalogue/use-column-controls.tsx';
import type { CatalogueStatCard } from '../catalogue/catalogue-stat-cards.tsx';
import { CATALOGUE_VIEW_PERMISSION } from '../entity-registry.ts';
import { WorkbenchSectionHeading } from '../workbench-parts.tsx';
import { RecordViewPage } from '../catalogue/record-view-page.tsx';
import { WithColumnPicker } from '../catalogue/column-picker.tsx';
/**
 * `/kitchen/analytics` — the sample-data dashboard, as `Workbench.dc.html` draws it (§3.3).
 *
 * ```
 * Kitchen analytics  [ SAMPLE DATA ]
 * RANGE [ 7 days | 30 days | 90 days | Year to date ]  [ All ▾ ]            [ Dark mode ]
 * ┌ UNITS PRODUCED ┐ ┌ ON-TIME RATE ┐ ┌ REVIEW BACKLOG ┐ ┌ AVG PREP TIME ┐
 * PRODUCTION TREND  units a day         VOLUME BY CHANNEL
 * ▁▂▃▅▆▇                               Subscription ▬▬▬▬▬▬▬▬  2 410
 * STATUS MIX  ▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬   ■ On track 62%  ■ Watch 26%  ■ Blocked 12%
 * LINE ITEMS  sample figures until live reporting lands
 * ```
 *
 * ## The `Sample data` chip is not optional
 *
 * Every figure here is `analytics-sample-data.ts`. The chip is in the page header, not in a tooltip,
 * and the view window says it again. When live reporting lands on this route it starts carrying real
 * revenue, and at that point it needs the cost permission Cost report already has (§6.5) — decided
 * before the data changes, not after.
 *
 * ## No summary strip
 *
 * The four KPI tiles *are* the summary; a count strip above them would say it twice (§3z).
 *
 * ## The charts are boxes
 *
 * `TrendBars`, `RatioBars` and `StatMix` draw with `View`s and tokens, not SVG: the theme arrives for
 * free, a test can read them, and each carries its figure in words beside or on the drawing.
 *
 * The theme toggle is real app chrome — this is the one screen the app already puts it on.
 */
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
const MIX_TONE: Readonly<Record<string, StatMixTone>> = {
    on_track: 'success',
    watch: 'warning',
    blocked: 'danger',
};
const STATUS_TONE: Readonly<Record<AnalyticsTableRow['status'], BadgeTone>> = {
    on_track: 'success',
    watch: 'warning',
    blocked: 'danger',
};
function statusKey(status: AnalyticsTableRow['status']): string {
    return `kitchen:analytics.status.${status === 'on_track' ? 'onTrack' : status}`;
}
function AnalyticsDashboard() {
    const { t } = useTranslation();
    const formatter = useFormatter();
    const [range, setRange] = useState<AnalyticsDateRange>('30d');
    const [segment, setSegment] = useState<AnalyticsSegment>('all');
    const [viewing, setViewing] = useState<AnalyticsTableRow | null>(null);
    const bundle = useMemo(() => buildKitchenAnalytics(range, segment), [range, segment]);
    const spans = useMemo(
        () => bucketSpans(range, bundle.productionTrend.length, new Date()),
        [range, bundle.productionTrend.length],
    );
    const channelMax = Math.max(1, ...bundle.channelVolume.map((point) => point.value));
    const columns: readonly ControlledColumn<
        AnalyticsTableRow,
        CatalogueColumn<AnalyticsTableRow>
    >[] = [
        {
            key: 'name',
            role: 'title',
            value: (row) => row.name,
            label: t('kitchen:analytics.table.name'),
            width: 200,
            priority: 100,
            sort: (left, right, direction) => compareText(left.name, right.name, direction),
            render: (row) => (
                <Text variant="strong" numberOfLines={1}>
                    {row.name}
                </Text>
            ),
        },
        {
            key: 'segment',
            label: t('kitchen:analytics.table.segment'),
            width: 110,
            priority: 60,
            filter: {
                values: (loaded) =>
                    [...new Set(loaded.map((row) => row.segment))].map((value) => ({
                        key: value,
                        label: t(`kitchen:analytics.segments.${value}`),
                    })),
                match: (row, value) => row.segment === value,
            },
            render: (row) => (
                <Text tone="secondary">{t(`kitchen:analytics.segments.${row.segment}`)}</Text>
            ),
        },
        {
            key: 'status',
            role: 'status',
            label: t('kitchen:analytics.table.status'),
            width: 96,
            priority: 80,
            filter: {
                values: () =>
                    (['on_track', 'watch', 'blocked'] as const).map((value) => ({
                        key: value,
                        label: t(statusKey(value)),
                    })),
                match: (row, value) => row.status === value,
            },
            render: (row) => (
                <Badge tone={STATUS_TONE[row.status]} label={t(statusKey(row.status))} />
            ),
        },
        {
            key: 'volume',
            role: 'metric',
            label: t('kitchen:analytics.table.volume'),
            width: 80,
            priority: 85,
            align: 'center',
            sort: (left, right, direction) => compareNumber(left.volume, right.volume, direction),
            render: (row) => <Text variant="mono">{formatter.formatNumber(row.volume)}</Text>,
        },
        {
            key: 'done',
            label: t('kitchen:analytics.table.completion'),
            width: 64,
            priority: 50,
            align: 'center',
            sort: (left, right, direction) =>
                compareNumber(left.completionPercent, right.completionPercent, direction),
            render: (row) => (
                <Text variant="mono">
                    {formatter.formatNumber(row.completionPercent / 100, { style: 'percent' })}
                </Text>
            ),
        },
        {
            key: 'avg',
            label: t('kitchen:analytics.table.avgMinutes'),
            width: 76,
            priority: 45,
            align: 'center',
            sort: (left, right, direction) =>
                compareNumber(left.avgMinutes, right.avgMinutes, direction),
            render: (row) => <Text variant="mono">{formatter.formatNumber(row.avgMinutes)}</Text>,
        },
        {
            key: 'updated',
            label: t('kitchen:analytics.table.updated'),
            width: 110,
            priority: 20,
            // Oldest first when ascending, as a timestamp sorts: the label is "5h ago", so the
            // larger the hours, the earlier the change.
            sort: (left, right, direction) =>
                compareNumber(right.updatedHoursAgo, left.updatedHoursAgo, direction),
            render: (row) => (
                <Text variant="caption" tone="secondary" numberOfLines={1}>
                    {row.updatedLabel}
                </Text>
            ),
        },
    ];
    const controls = useColumnControls(bundle.rows, columns, 'kitchen-analytics-table');
    if (viewing !== null) {
        return (
            <RecordViewPage
                testID="kitchen-analytics-window"
                onBack={() => {
                    setViewing(null);
                }}
                title={viewing.name}
                kind={t('kitchen:analytics.window.kind')}
                status={{
                    label: t(statusKey(viewing.status)),
                    tone: STATUS_TONE[viewing.status],
                }}
                note={t('kitchen:analytics.window.note')}
                fields={[
                    {
                        key: 'segment',
                        label: t('kitchen:analytics.table.segment'),
                        value: t(`kitchen:analytics.segments.${viewing.segment}`),
                    },
                    {
                        key: 'volume',
                        label: t('kitchen:analytics.table.volume'),
                        value: formatter.formatNumber(viewing.volume),
                        mono: true,
                    },
                    {
                        key: 'done',
                        label: t('kitchen:analytics.table.completion'),
                        value: formatter.formatNumber(viewing.completionPercent / 100, {
                            style: 'percent',
                        }),
                        mono: true,
                    },
                    {
                        key: 'avg',
                        label: t('kitchen:analytics.table.avgMinutes'),
                        value: formatter.formatNumber(viewing.avgMinutes),
                        mono: true,
                    },
                    {
                        key: 'updated',
                        label: t('kitchen:analytics.table.updated'),
                        value: viewing.updatedLabel,
                    },
                ]}
                // No primary: a sample line item has no record to open, and a button that went
                // nowhere would be the one dishonest control on an honestly labelled screen.
            />
        );
    }

    return (
        <Stack space="md" testID="kitchen-analytics-panel">
            {/* Every figure on this screen is `analytics-sample-data.ts` — the label says so first. */}
            <View className="flex-row">
                <Badge
                    testID="kitchen-analytics-sample"
                    tone="info"
                    label={t('kitchen:analytics.sampleBadge')}
                />
            </View>
            <CatalogueStatCards
                testID="kitchen-analytics-kpis"
                cards={bundle.kpis.map((kpi) => kpiCard(kpi, t, formatter))}
            />
            <View
                testID="kitchen-analytics-filters"
                className="z-10 min-h-control-sm flex-row flex-wrap items-center gap-tight"
            >
                <SegmentedControl
                    testID="kitchen-analytics-range"
                    label={t('kitchen:analytics.filters.dateRange')}
                    value={range}
                    onChange={(next) => {
                        setRange(next);
                        setViewing(null);
                    }}
                    items={ANALYTICS_DATE_RANGES.map((value) => ({
                        value,
                        label: t(`kitchen:analytics.ranges.${value}`),
                        testID: `kitchen-analytics-range-${value}`,
                    }))}
                />
                {/* The order desk's kind select, as it sits there: a fixed-width box, lifted above
                    the cards below so its menu is never covered. */}
                <View className="z-tooltip" style={{ width: SEGMENT_WIDTH }}>
                    <Select<AnalyticsSegment>
                        testID="kitchen-analytics-segment"
                        id="kitchen-analytics-segment"
                        label={t('kitchen:analytics.filters.segment')}
                        labelHidden
                        value={segment}
                        onChange={(next) => {
                            setSegment(next);
                            setViewing(null);
                        }}
                        options={ANALYTICS_SEGMENTS.map((value) => ({
                            value,
                            label: t(`kitchen:analytics.segments.${value}`),
                        }))}
                    />
                </View>
            </View>
            {/* One chart per line: side by side, the trend's bars had no room between them. */}
            <View className="flex-col gap-loose">
                <View className="flex-col gap-snug">
                    <WorkbenchSectionHeading
                        title={t('kitchen:analytics.charts.productionTrend')}
                        aside={t('kitchen:analytics.charts.productionTrendUnit')}
                    />
                    <TrendBars
                        testID="kitchen-analytics-trend"
                        values={bundle.productionTrend.map((point) => point.value)}
                        tickEvery={Math.max(1, Math.ceil(bundle.productionTrend.length / 8))}
                        tickFor={(index) => {
                            const span = spans[index];
                            if (span === undefined) return '';
                            return formatter.formatDate(
                                span.from,
                                range === '7d'
                                    ? { weekday: 'short', day: 'numeric' }
                                    : { day: 'numeric', month: 'short' },
                            );
                        }}
                        valueFor={(index) =>
                            formatter.formatNumber(bundle.productionTrend[index]?.value ?? 0)
                        }
                        titleFor={(index) => {
                            const span = spans[index];
                            const short = { day: 'numeric', month: 'short' } as const;
                            return t('kitchen:analytics.charts.trendBarTitle', {
                                label:
                                    span === undefined
                                        ? ''
                                        : span.from.getTime() === span.to.getTime()
                                          ? formatter.formatDate(span.from, short)
                                          : t('kitchen:calendar.range', {
                                                from: formatter.formatDate(span.from, short),
                                                to: formatter.formatDate(span.to, short),
                                            }),
                                value: formatter.formatNumber(
                                    bundle.productionTrend[index]?.value ?? 0,
                                ),
                            });
                        }}
                    />
                </View>
                <View className="flex-col gap-snug">
                    <WorkbenchSectionHeading title={t('kitchen:analytics.charts.channelVolume')} />
                    <RatioBars
                        testID="kitchen-analytics-channels"
                        labelWidth={110}
                        valueWidth={56}
                        rows={bundle.channelVolume.map((point) => ({
                            key: point.label,
                            label: t(`kitchen:analytics.charts.channels.${point.label}`),
                            value: formatter.formatNumber(point.value),
                            share: point.value / channelMax,
                        }))}
                    />
                </View>
            </View>
            <View className="flex-col gap-2.5">
                <WorkbenchSectionHeading title={t('kitchen:analytics.charts.statusMix')} />
                <StatMix
                    testID="kitchen-analytics-mix"
                    formatPercent={(pct) => formatter.formatNumber(pct / 100, { style: 'percent' })}
                    segments={bundle.statusMix.map((slice) => ({
                        key: slice.key,
                        label: t(slice.labelKey),
                        pct: slice.value,
                        tone: MIX_TONE[slice.key] ?? 'warning',
                    }))}
                />
            </View>
            <View className="flex-col">
                <WorkbenchSectionHeading
                    title={t('kitchen:analytics.table.title')}
                    aside={t('kitchen:analytics.table.sampleNote')}
                />
                <WithColumnPicker picker={controls.picker}>
                    <CatalogueList<AnalyticsTableRow>
                        testID="kitchen-analytics-table"
                        label={t('kitchen:analytics.table.caption')}
                        columns={controls.columns}
                        rows={controls.rows}
                        rowKey={(row) => row.id}
                        onRowPress={setViewing}
                        rowActionsLabel={t('kitchen:list.rowActions')}
                    />
                </WithColumnPicker>
            </View>
        </Stack>
    );
}
const DAY_MS = 86_400_000;

/** The order desk's kind select width, so the two filters read as one control. */
const SEGMENT_WIDTH = 140;

/**
 * The real calendar days each trend bar stands for, ending today.
 *
 * The range is split into `count` equal runs of whole days, oldest first; the last run absorbs the
 * remainder so the final bar always ends today. Year to date starts on 1 January.
 */
function bucketSpans(
    range: AnalyticsDateRange,
    count: number,
    now: Date,
): readonly { readonly from: Date; readonly to: Date }[] {
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const days =
        range === '7d'
            ? 7
            : range === '30d'
              ? 30
              : range === '90d'
                ? 90
                : Math.round(
                      (today.getTime() - new Date(today.getFullYear(), 0, 1).getTime()) / DAY_MS,
                  ) + 1;
    const start = today.getTime() - (days - 1) * DAY_MS;
    const size = Math.max(1, Math.floor(days / Math.max(1, count)));
    return Array.from({ length: count }, (_, index) => {
        const from = new Date(start + index * size * DAY_MS);
        const to =
            index === count - 1 ? today : new Date(start + ((index + 1) * size - 1) * DAY_MS);
        return { from, to: to < from ? from : to };
    });
}

/** A KPI as the admin's standard figure card: the change against last period is its caption. */
function kpiCard(
    kpi: AnalyticsKpi,
    t: TFunction,
    formatter: ReturnType<typeof useFormatter>,
): CatalogueStatCard {
    const good = kpi.higherIsBetter ? kpi.deltaPercent >= 0 : kpi.deltaPercent <= 0;
    const caption =
        kpi.deltaPercent > 0
            ? t('kitchen:analytics.trend.up', { value: Math.abs(kpi.deltaPercent) })
            : kpi.deltaPercent < 0
              ? t('kitchen:analytics.trend.down', { value: Math.abs(kpi.deltaPercent) })
              : t('kitchen:analytics.trend.flat');
    return {
        key: kpi.key,
        label: t(kpi.labelKey),
        value: formatter.formatNumber(kpi.value),
        unit: t(`kitchen:analytics.units.${kpi.unit}`),
        caption,
        mark: kpi.deltaPercent === 0 || good ? 'calendar' : 'warning',
        tone: kpi.deltaPercent === 0 || good ? 'default' : 'danger',
    };
}
