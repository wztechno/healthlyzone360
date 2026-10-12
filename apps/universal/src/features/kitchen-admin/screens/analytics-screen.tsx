import type {
    KitchenAnalyticsChannel,
    KitchenAnalyticsDay,
    KitchenAnalyticsItem,
} from '@healthy360/api-client/contracts';
import {
    Cascade,
    EmptyState,
    ErrorState,
    RecordSkeleton,
    SegmentedControl,
    Text,
} from '@healthy360/design-system';
import { useFormatter, useLocale } from '@healthy360/i18n';
import type { TFunction } from 'i18next';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';
import { Gate } from '../../../access/gate.tsx';
import { toFailure } from '../../../data/hooks.ts';
import { useKitchenAnalyticsQuery } from '../../../data/kitchen-ops-hooks.ts';
import { addDays, todayIso } from '../../commerce/dates.ts';
import { RatioBars } from '../analytics/ratio-bars.tsx';
import { StatMix } from '../analytics/stat-mix.tsx';
import { TrendBars } from '../analytics/trend-bars.tsx';
import { CatalogueList } from '../catalogue/catalogue-list.tsx';
import { CatalogueStatCards } from '../catalogue/catalogue-stat-cards.tsx';
import type { CatalogueStatCard } from '../catalogue/catalogue-stat-cards.tsx';
import type { CatalogueColumn } from '../catalogue/catalogue-column-spec.ts';
import { WithColumnPicker } from '../catalogue/column-picker.tsx';
import type { ControlledColumn } from '../catalogue/use-column-controls.tsx';
import {
    compareNumber,
    compareText,
    useColumnControls,
} from '../catalogue/use-column-controls.tsx';
import { ORDER_VIEW_PERMISSION } from '../entity-registry.ts';
import { WorkbenchSectionHeading } from '../workbench-parts.tsx';

/**
 * `/kitchen/analytics` — what the order book did over a range of days, as `Workbench.dc.html`
 * draws the dashboard (§3.3).
 *
 * ```
 * RANGE [ 7 days | 30 days | 90 days | Year to date ]
 * ┌ ORDERS ┐ ┌ UNITS SOLD ┐ ┌ ON-TIME RATE ┐ ┌ AVERAGE LEAD TIME ┐   each against the range before
 * UNITS SOLD  units a day / a week     ▁▂▃▅▆▇
 * ORDERS BY CHANNEL                    Subscription ▬▬▬▬▬▬▬▬  41
 * ORDER OUTCOMES  ▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬     ■ Fulfilled  ■ Open  ■ Cancelled
 * TOP ITEMS                            name · type · orders · units · share · last ordered
 * ```
 *
 * Every figure is `GET /catalogue/reports/kitchen-analytics`, computed from orders. Counts and
 * units only — no money — so it sits behind the order book's own read code. A range ends today on
 * this device's calendar; the server reads each order's day on its branch's clock.
 *
 * On time is fulfilled by the end of the requested delivery window; orders without a requested
 * date are outside that rate, and a range with none shows the dash rather than 0 %.
 *
 * The charts are `View`s and tokens, not SVG: the theme arrives for free, a test can read them, and
 * each carries its figure in words beside or on the drawing.
 */
export function AnalyticsScreen() {
    return (
        <Gate
            area="kitchen"
            requirement={{ allOf: [ORDER_VIEW_PERMISSION] }}
            testID="kitchen-analytics"
        >
            <AnalyticsDashboard />
        </Gate>
    );
}

export const ANALYTICS_RANGES = ['7d', '30d', '90d', 'ytd'] as const;
export type AnalyticsRange = (typeof ANALYTICS_RANGES)[number];

const RANGE_DAYS: Readonly<Record<Exclude<AnalyticsRange, 'ytd'>, number>> = {
    '7d': 7,
    '30d': 30,
    '90d': 90,
};

const CHANNEL_LABEL: Readonly<Record<KitchenAnalyticsChannel, string>> = {
    subscription: 'kitchen:analytics.charts.channels.subscription',
    b2b: 'kitchen:analytics.charts.channels.b2b',
    pos: 'kitchen:analytics.charts.channels.pos',
    a_la_carte: 'kitchen:analytics.charts.channels.aLaCarte',
};

/** The local days a range covers, ending today. Year to date starts on 1 January. */
export function rangeDates(
    range: AnalyticsRange,
    now: Date = new Date(),
): { readonly from: string; readonly to: string } {
    const to = todayIso(now);
    if (range === 'ytd') return { from: `${to.slice(0, 4)}-01-01`, to };
    return { from: addDays(to, 1 - RANGE_DAYS[range]) ?? to, to };
}

interface TrendBucket {
    readonly from: string;
    readonly to: string;
    readonly units: number;
}

/**
 * The trend's bars: one per day, or runs of `size` days ending on the last day. The oldest run
 * absorbs the remainder, so the newest bar is always a whole week ending today.
 */
export function trendBuckets(
    days: readonly KitchenAnalyticsDay[],
    size: number,
): readonly TrendBucket[] {
    const buckets: TrendBucket[] = [];
    for (let end = days.length; end > 0; end -= size) {
        const run = days.slice(Math.max(0, end - size), end);
        buckets.unshift({
            from: run[0]?.date ?? '',
            to: run[run.length - 1]?.date ?? '',
            units: run.reduce((sum, day) => sum + day.units, 0),
        });
    }
    return buckets;
}

/** `YYYY-MM-DD` as a local midnight, so the formatter shows the calendar day it names. */
function localDay(iso: string): Date {
    const [year = 0, month = 1, day = 1] = iso.split('-').map(Number);
    return new Date(year, month - 1, day);
}

function itemTypeLabel(type: string | null, t: TFunction): string {
    if (type === null) return t('kitchen:list.noValue');
    if (type === 'subscription_plan') return t('kitchen:priceLists.kindPlan');
    return t(`marketplace:itemTypes.${type}`);
}

function AnalyticsDashboard() {
    const { t } = useTranslation();
    const formatter = useFormatter();
    const { locale } = useLocale();
    const [range, setRange] = useState<AnalyticsRange>('30d');
    const { from, to } = useMemo(() => rangeDates(range), [range]);
    const report = useKitchenAnalyticsQuery(from, to);
    const failure = toFailure(report.error);
    const data = report.data;
    const items = useMemo(() => data?.items ?? [], [data]);

    const name = (item: KitchenAnalyticsItem): string =>
        locale === 'ar' && item.nameAr !== null && item.nameAr !== '' ? item.nameAr : item.nameEn;
    const totalUnits = data?.current.units ?? 0;
    const columns: readonly ControlledColumn<
        KitchenAnalyticsItem,
        CatalogueColumn<KitchenAnalyticsItem>
    >[] = [
        {
            key: 'name',
            role: 'title',
            value: name,
            label: t('kitchen:analytics.table.name'),
            width: 200,
            priority: 100,
            sort: (left, right, direction) => compareText(name(left), name(right), direction),
            render: (item) => (
                <Text variant="strong" numberOfLines={1}>
                    {name(item)}
                </Text>
            ),
        },
        {
            key: 'type',
            label: t('kitchen:analytics.table.type'),
            width: 110,
            priority: 60,
            grow: false,
            render: (item) => <Text tone="secondary">{itemTypeLabel(item.itemType, t)}</Text>,
        },
        {
            key: 'orders',
            role: 'metric',
            label: t('kitchen:analytics.table.orders'),
            width: 72,
            priority: 80,
            sort: (left, right, direction) => compareNumber(left.orders, right.orders, direction),
            render: (item) => <Text variant="mono">{formatter.formatNumber(item.orders)}</Text>,
        },
        {
            key: 'units',
            role: 'metric',
            label: t('kitchen:analytics.table.units'),
            width: 80,
            priority: 90,
            sort: (left, right, direction) => compareNumber(left.units, right.units, direction),
            render: (item) => <Text variant="mono">{formatter.formatNumber(item.units)}</Text>,
        },
        {
            key: 'share',
            label: t('kitchen:analytics.table.share'),
            width: 72,
            priority: 50,
            grow: false,
            sort: (left, right, direction) => compareNumber(left.units, right.units, direction),
            render: (item) => (
                <Text variant="mono">
                    {totalUnits === 0
                        ? t('kitchen:list.noValue')
                        : formatter.formatNumber(item.units / totalUnits, {
                              style: 'percent',
                              maximumFractionDigits: 1,
                          })}
                </Text>
            ),
        },
        {
            key: 'lastOrdered',
            label: t('kitchen:analytics.table.lastOrdered'),
            width: 120,
            priority: 40,
            grow: false,
            sort: (left, right, direction) =>
                compareText(left.lastOrderedAt, right.lastOrderedAt, direction),
            render: (item) => (
                <Text variant="caption" tone="secondary" numberOfLines={1}>
                    {formatter.formatDate(item.lastOrderedAt, { dateStyle: 'medium' })}
                </Text>
            ),
        },
    ];
    const controls = useColumnControls(items, columns, 'kitchen-analytics-table');

    const rangeControl = (
        <View
            testID="kitchen-analytics-filters"
            className="min-h-control-sm flex-row flex-wrap items-center gap-tight"
        >
            <SegmentedControl
                testID="kitchen-analytics-range"
                label={t('kitchen:analytics.filters.dateRange')}
                value={range}
                onChange={setRange}
                items={ANALYTICS_RANGES.map((value) => ({
                    value,
                    label: t(`kitchen:analytics.ranges.${value}`),
                    testID: `kitchen-analytics-range-${value}`,
                }))}
            />
        </View>
    );

    if (report.isPending) {
        return (
            <Cascade space="md" testID="kitchen-analytics-panel">
                {rangeControl}
                <RecordSkeleton
                    testID="kitchen-analytics-loading"
                    heading={false}
                    tiles={4}
                    rows={6}
                />
            </Cascade>
        );
    }
    if (failure !== null) {
        return (
            <Cascade space="md" testID="kitchen-analytics-panel">
                {rangeControl}
                <ErrorState
                    testID="kitchen-analytics-error"
                    failure={failure}
                    onRetry={() => {
                        void report.refetch();
                    }}
                    retrying={report.isFetching}
                />
            </Cascade>
        );
    }
    if (data === undefined) return null;

    const { current, previous } = data;
    const onTime = (totals: typeof current) =>
        totals.fulfilledWithDue === 0 ? null : totals.onTime / totals.fulfilledWithDue;
    const leadHours = (totals: typeof current) =>
        totals.avgLeadMinutes === null ? null : totals.avgLeadMinutes / 60;
    const currentOnTime = onTime(current);
    const currentLead = leadHours(current);
    const placed = current.fulfilled + current.open + current.cancelled;
    const weekly = range === '90d' || range === 'ytd';
    const buckets = trendBuckets(data.days, weekly ? 7 : 1);
    const channelMax = Math.max(1, ...data.channels.map((channel) => channel.orders));
    const short = { day: 'numeric', month: 'short' } as const;

    return (
        <Cascade space="md" testID="kitchen-analytics-panel">
            {rangeControl}
            <CatalogueStatCards
                testID="kitchen-analytics-kpis"
                cards={[
                    kpiCard(t, {
                        key: 'orders',
                        label: t('kitchen:analytics.kpi.orders'),
                        value: formatter.formatNumber(current.orders),
                        mark: 'clipboardCheck',
                        current: current.orders,
                        previous: previous.orders,
                        higherIsBetter: true,
                    }),
                    kpiCard(t, {
                        key: 'units',
                        label: t('kitchen:analytics.kpi.units'),
                        value: formatter.formatNumber(current.units),
                        mark: 'chartColumn',
                        current: current.units,
                        previous: previous.units,
                        higherIsBetter: true,
                    }),
                    kpiCard(t, {
                        key: 'onTime',
                        label: t('kitchen:analytics.kpi.onTime'),
                        value:
                            currentOnTime === null
                                ? t('kitchen:list.noValue')
                                : formatter.formatNumber(currentOnTime, { style: 'percent' }),
                        mark: 'circleCheck',
                        current: currentOnTime,
                        previous: onTime(previous),
                        higherIsBetter: true,
                    }),
                    kpiCard(t, {
                        key: 'leadTime',
                        label: t('kitchen:analytics.kpi.leadTime'),
                        value:
                            currentLead === null
                                ? t('kitchen:list.noValue')
                                : formatter.formatNumber(currentLead, {
                                      minimumFractionDigits: 1,
                                      maximumFractionDigits: 1,
                                  }),
                        unit: currentLead === null ? undefined : t('kitchen:analytics.units.hours'),
                        mark: 'clock',
                        current: currentLead,
                        previous: leadHours(previous),
                        higherIsBetter: false,
                    }),
                ]}
            />
            {placed === 0 ? (
                <EmptyState
                    testID="kitchen-analytics-empty"
                    title={t('kitchen:analytics.emptyTitle')}
                    body={t('kitchen:analytics.emptyBody')}
                />
            ) : (
                <Cascade space="md">
                    {/* One chart per line: side by side, the trend's bars had no room between them. */}
                    <View className="flex-col gap-loose">
                        <View className="flex-col gap-snug">
                            <WorkbenchSectionHeading
                                title={t('kitchen:analytics.charts.unitsTrend')}
                                aside={t(
                                    weekly
                                        ? 'kitchen:analytics.charts.perWeek'
                                        : 'kitchen:analytics.charts.perDay',
                                )}
                            />
                            <TrendBars
                                testID="kitchen-analytics-trend"
                                values={buckets.map((bucket) => bucket.units)}
                                tickEvery={Math.max(1, Math.ceil(buckets.length / 8))}
                                tickFor={(index) => {
                                    const bucket = buckets[index];
                                    if (bucket === undefined) return '';
                                    return formatter.formatDate(
                                        localDay(bucket.from),
                                        range === '7d'
                                            ? { weekday: 'short', day: 'numeric' }
                                            : short,
                                    );
                                }}
                                valueFor={(index) =>
                                    formatter.formatNumber(buckets[index]?.units ?? 0)
                                }
                                titleFor={(index) => {
                                    const bucket = buckets[index];
                                    if (bucket === undefined) return '';
                                    const fromLabel = formatter.formatDate(
                                        localDay(bucket.from),
                                        short,
                                    );
                                    return t('kitchen:analytics.charts.trendBarTitle', {
                                        label:
                                            bucket.from === bucket.to
                                                ? fromLabel
                                                : t('kitchen:calendar.range', {
                                                      from: fromLabel,
                                                      to: formatter.formatDate(
                                                          localDay(bucket.to),
                                                          short,
                                                      ),
                                                  }),
                                        value: formatter.formatNumber(bucket.units),
                                    });
                                }}
                            />
                        </View>
                        <View className="flex-col gap-snug">
                            <WorkbenchSectionHeading
                                title={t('kitchen:analytics.charts.channelVolume')}
                            />
                            <RatioBars
                                testID="kitchen-analytics-channels"
                                labelWidth={110}
                                valueWidth={56}
                                rows={data.channels.map((channel) => ({
                                    key: channel.key,
                                    label: t(CHANNEL_LABEL[channel.key]),
                                    value: formatter.formatNumber(channel.orders),
                                    share: channel.orders / channelMax,
                                }))}
                            />
                        </View>
                    </View>
                    <View className="flex-col gap-2.5">
                        <WorkbenchSectionHeading title={t('kitchen:analytics.charts.outcomeMix')} />
                        <StatMix
                            testID="kitchen-analytics-mix"
                            formatPercent={(pct) =>
                                formatter.formatNumber(pct / 100, { style: 'percent' })
                            }
                            segments={(
                                [
                                    ['fulfilled', current.fulfilled, 'success'],
                                    ['open', current.open, 'warning'],
                                    ['cancelled', current.cancelled, 'danger'],
                                ] as const
                            ).map(([key, count, tone]) => ({
                                key,
                                label: t(`kitchen:analytics.charts.outcomes.${key}`),
                                pct: (count / placed) * 100,
                                tone,
                            }))}
                        />
                    </View>
                    <View className="flex-col">
                        <WorkbenchSectionHeading title={t('kitchen:analytics.table.title')} />
                        <WithColumnPicker picker={controls.picker}>
                            <CatalogueList<KitchenAnalyticsItem>
                                testID="kitchen-analytics-table"
                                label={t('kitchen:analytics.table.caption')}
                                columns={controls.columns}
                                rows={controls.rows}
                                rowKey={(item) => item.catalogueItemId}
                                rowActionsLabel={t('kitchen:list.rowActions')}
                            />
                        </WithColumnPicker>
                    </View>
                </Cascade>
            )}
        </Cascade>
    );
}

interface KpiInput {
    readonly key: string;
    readonly label: string;
    readonly value: string;
    readonly unit?: string | undefined;
    readonly mark: CatalogueStatCard['mark'];
    readonly current: number | null;
    readonly previous: number | null;
    readonly higherIsBetter: boolean;
}

/**
 * A KPI as the admin's standard figure card: the change against the previous range is its caption.
 * No previous figure (or a zero one) has no percentage change, so it says so instead.
 */
function kpiCard(t: TFunction, kpi: KpiInput): CatalogueStatCard {
    const base = { key: kpi.key, label: kpi.label, value: kpi.value, unit: kpi.unit };
    if (kpi.current === null) {
        return { ...base, caption: t('kitchen:analytics.notEnoughData'), mark: kpi.mark };
    }
    if (kpi.previous === null || kpi.previous === 0) {
        return { ...base, caption: t('kitchen:analytics.trend.noComparison'), mark: kpi.mark };
    }
    const delta = Math.round(((kpi.current - kpi.previous) / kpi.previous) * 100);
    const good = kpi.higherIsBetter ? delta >= 0 : delta <= 0;
    return {
        ...base,
        caption:
            delta > 0
                ? t('kitchen:analytics.trend.up', { value: Math.abs(delta) })
                : delta < 0
                  ? t('kitchen:analytics.trend.down', { value: Math.abs(delta) })
                  : t('kitchen:analytics.trend.flat'),
        // The mark follows the direction; the tone says whether that direction is good.
        mark: delta > 0 ? 'trendingUp' : delta < 0 ? 'trendingDown' : 'trendFlat',
        tone: delta === 0 || good ? 'default' : 'danger',
    };
}
