import type {
    KitchenAnalyticsChannel,
    KitchenAnalyticsDay,
    KitchenAnalyticsItem,
    KitchenAnalyticsReport,
    KitchenAnalyticsTotals,
} from '@healthy360/api-client/contracts';
import {
    Cascade,
    DatePickerButton,
    EmptyState,
    ErrorState,
    RecordSkeleton,
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
import { RatioBars } from '../analytics/ratio-bars.tsx';
import { StatMix } from '../analytics/stat-mix.tsx';
import { TrendBars } from '../analytics/trend-bars.tsx';
import { CatalogueList } from '../catalogue/catalogue-list.tsx';
import type { CatalogueColumn } from '../catalogue/catalogue-column-spec.ts';
import type { ControlledColumn } from '../catalogue/use-column-controls.tsx';
import {
    compareNumber,
    compareText,
    useColumnControls,
} from '../catalogue/use-column-controls.tsx';
import { ORDER_VIEW_PERMISSION } from '../entity-registry.ts';
import { WorkbenchSectionHeading } from '../workbench-parts.tsx';
import { ColumnPicker } from '../catalogue/column-picker.tsx';
import { LensBar } from '../catalogue/lens-bar.tsx';
import type { LensFigure } from '../catalogue/lens-bar.tsx';
import { PeriodScope, periodWindows } from '../catalogue/period-scope.tsx';
import { addDays, daysBetween, todayIso } from '../../commerce/dates.ts';
/**
 * `/kitchen/analytics` — what the order book did over a window of days, as `Workbench.dc.html`
 * draws the dashboard (§3.3).
 *
 * ```
 * Orders 41  Units sold 96  ● On-time rate 92 %  Average lead time 3.2 h
 * [Period This month ▾] [2026-08-01 ▦] to [2026-08-29 ▦]                     ▦ Columns 6 of 6
 * UNITS SOLD  units a day / a week     ▁▂▃▅▆▇
 * ORDERS BY CHANNEL                    Subscription ▬▬▬▬▬▬▬▬  41
 * ORDER OUTCOMES  ▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬     ■ Fulfilled  ■ Open  ■ Cancelled
 * TOP ITEMS                            name · type · orders · units · share · last ordered
 * ```
 *
 * Every figure is `GET /catalogue/reports/kitchen-analytics`, computed from orders. Counts and
 * units only — no money — so it sits behind the order book's own read code. The server reads each
 * order's day on its branch's clock.
 *
 * On time is fulfilled by the end of the requested delivery window; orders without a requested
 * date are outside that rate, and a window with none shows the dash rather than 0 %.
 *
 * ## The Lens bar is the summary
 *
 * The four KPIs are the bar's figures, as every list page's are — no cards. The change against the
 * equal window before this one is behind each figure's (i); a KPI moving the wrong way carries a
 * danger dot.
 *
 * ## The window is the other pages' window
 *
 * The Period shortcut and a From–To pair, as Stock gaps and Cash taken draw them. It opens on This
 * month, and the pickers stop at the server's 366 days.
 *
 * ## The charts are boxes
 *
 * `TrendBars`, `RatioBars` and `StatMix` draw with `View`s and tokens, not SVG: the theme arrives for
 * free, a test can read them, and each carries its figure in words beside or on the drawing.
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

/** One day short of the server's cap: the window counts both of its ends. */
const WINDOW_REACH = 365;

/** A window longer than a month draws a bar a week, or its bars have no room between them. */
const DAILY_DAYS = 31;

const CHANNEL_LABEL: Readonly<Record<KitchenAnalyticsChannel, string>> = {
    subscription: 'kitchen:analytics.charts.channels.subscription',
    b2b: 'kitchen:analytics.charts.channels.b2b',
    pos: 'kitchen:analytics.charts.channels.pos',
    a_la_carte: 'kitchen:analytics.charts.channels.aLaCarte',
};

const KPI_KEYS = ['orders', 'units', 'onTime', 'leadTime'] as const;

interface TrendBucket {
    readonly from: string;
    readonly to: string;
    readonly units: number;
}

/**
 * The trend's bars: one per day, or runs of `size` days ending on the last day. The oldest run
 * absorbs the remainder, so the newest bar is always a whole week ending on the window's last day.
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

/** A local day, `YYYY-MM-DD`, as a `Date` at its midnight. */
function localDay(iso: string): Date {
    return new Date(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)) - 1, Number(iso.slice(8, 10)));
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
    const [today] = useState(() => todayIso());
    const [from, setFrom] = useState(() => periodWindows(today).month.from);
    const [to, setTo] = useState(today);
    const pickWindow = (next: { readonly from: string; readonly to: string }) => {
        setFrom(next.from);
        setTo(next.to);
    };
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
            filter: {
                values: (loaded) =>
                    [...new Set(loaded.map((item) => item.itemType))].map((value) => ({
                        key: value ?? '',
                        label: itemTypeLabel(value, t),
                    })),
                match: (item, value) => (item.itemType ?? '') === value,
            },
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

    const figures: readonly LensFigure[] =
        data !== undefined
            ? reportFigures(data, t, formatter)
            : report.isPending
              ? KPI_KEYS.map((key) => ({
                    key,
                    label: t(`kitchen:analytics.kpi.${key}`),
                    value: null,
                }))
              : [];
    const lens = (
        <LensBar
            testID="kitchen-analytics-toolbar"
            layout="split"
            label={t('kitchen:lens.label')}
            figures={figures}
            scope={
                <>
                    <PeriodScope
                        testID="kitchen-analytics-period"
                        today={today}
                        value={{ from, to }}
                        onChange={pickWindow}
                    />
                    <View className="z-auto flex-row items-center gap-tight">
                        <DatePickerButton
                            testID="kitchen-analytics-from"
                            label={t('kitchen:analytics.filters.from')}
                            value={from}
                            min={addDays(to, -WINDOW_REACH) ?? undefined}
                            max={to}
                            onChange={(next) => {
                                pickWindow({ from: next, to });
                            }}
                        />
                        <Text variant="caption" tone="secondary" aria-hidden>
                            {t('kitchen:ops.requirements.windowTo')}
                        </Text>
                        <DatePickerButton
                            testID="kitchen-analytics-to"
                            label={t('kitchen:analytics.filters.to')}
                            value={to}
                            min={from}
                            max={addDays(from, WINDOW_REACH) ?? undefined}
                            onChange={(next) => {
                                pickWindow({ from, to: next });
                            }}
                        />
                    </View>
                </>
            }
            result={
                report.isPending
                    ? null
                    : t('kitchen:lens.result', { shown: controls.rows.length, total: items.length })
            }
            clearLabel={t('kitchen:lens.clear')}
            {...(controls.filtered ? { onClear: controls.clearFilters } : {})}
            // Always the labelled button, "Columns 6 of 6", as on the other lists.
            trailing={<ColumnPicker {...controls.picker} />}
        />
    );

    if (report.isPending) {
        return (
            <Cascade space="md" testID="kitchen-analytics-panel">
                {lens}
                <RecordSkeleton
                    testID="kitchen-analytics-loading"
                    heading={false}
                    tiles={0}
                    rows={6}
                />
            </Cascade>
        );
    }
    if (failure !== null) {
        return (
            <Cascade space="md" testID="kitchen-analytics-panel">
                {lens}
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

    const { current } = data;
    const placed = current.fulfilled + current.open + current.cancelled;
    // Both ends counted: Today is one day.
    const days = Math.max(1, (daysBetween(from, to) ?? 0) + 1);
    const weekly = days > DAILY_DAYS;
    const buckets = trendBuckets(data.days, weekly ? 7 : 1);
    const channelMax = Math.max(1, ...data.channels.map((channel) => channel.orders));
    const short = { day: 'numeric', month: 'short' } as const;

    return (
        <Cascade space="md" testID="kitchen-analytics-panel">
            {lens}
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
                                        days <= 7 ? { weekday: 'short', day: 'numeric' } : short,
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
                        <CatalogueList<KitchenAnalyticsItem>
                            testID="kitchen-analytics-table"
                            label={t('kitchen:analytics.table.caption')}
                            columns={controls.columns}
                            rows={controls.rows}
                            rowKey={(item) => item.catalogueItemId}
                            rowActionsLabel={t('kitchen:list.rowActions')}
                        />
                    </View>
                </Cascade>
            )}
        </Cascade>
    );
}

interface KpiInput {
    readonly key: (typeof KPI_KEYS)[number];
    readonly display: string;
    readonly current: number | null;
    readonly previous: number | null;
    readonly higherIsBetter: boolean;
}

/** The report's four KPIs, each against the equal window before this one. */
function reportFigures(
    { current, previous }: KitchenAnalyticsReport,
    t: TFunction,
    formatter: ReturnType<typeof useFormatter>,
): readonly LensFigure[] {
    const onTime = (totals: KitchenAnalyticsTotals) =>
        totals.fulfilledWithDue === 0 ? null : totals.onTime / totals.fulfilledWithDue;
    const leadHours = (totals: KitchenAnalyticsTotals) =>
        totals.avgLeadMinutes === null ? null : totals.avgLeadMinutes / 60;
    const currentOnTime = onTime(current);
    const currentLead = leadHours(current);
    const kpis: readonly KpiInput[] = [
        {
            key: 'orders',
            display: formatter.formatNumber(current.orders),
            current: current.orders,
            previous: previous.orders,
            higherIsBetter: true,
        },
        {
            key: 'units',
            display: formatter.formatNumber(current.units),
            current: current.units,
            previous: previous.units,
            higherIsBetter: true,
        },
        {
            key: 'onTime',
            display:
                currentOnTime === null
                    ? t('kitchen:list.noValue')
                    : formatter.formatNumber(currentOnTime, { style: 'percent' }),
            current: currentOnTime,
            previous: onTime(previous),
            higherIsBetter: true,
        },
        {
            key: 'leadTime',
            display:
                currentLead === null
                    ? t('kitchen:list.noValue')
                    : `${formatter.formatNumber(currentLead, {
                          minimumFractionDigits: 1,
                          maximumFractionDigits: 1,
                      })} ${t('kitchen:analytics.units.hours')}`,
            current: currentLead,
            previous: leadHours(previous),
            higherIsBetter: false,
        },
    ];
    return kpis.map((kpi) => kpiFigure(kpi, t));
}

/**
 * A KPI as a Lens bar figure: the change against the previous window behind its (i), and a danger
 * dot when it moved the wrong way. No previous figure (or a zero one) has no percentage change, so
 * the (i) says so instead.
 */
function kpiFigure(kpi: KpiInput, t: TFunction): LensFigure {
    const base = {
        key: kpi.key,
        label: t(`kitchen:analytics.kpi.${kpi.key}`),
        // `null` means still in flight on the bar; a loaded figure with no value draws its dash.
        value: kpi.current ?? 0,
        display: kpi.display,
    };
    if (kpi.current === null) return { ...base, info: t('kitchen:analytics.notEnoughData') };
    if (kpi.previous === null || kpi.previous === 0) {
        return { ...base, info: t('kitchen:analytics.trend.noComparison') };
    }
    const delta = Math.round(((kpi.current - kpi.previous) / kpi.previous) * 100);
    const good = kpi.higherIsBetter ? delta >= 0 : delta <= 0;
    return {
        ...base,
        info:
            delta > 0
                ? t('kitchen:analytics.trend.up', { value: Math.abs(delta) })
                : delta < 0
                  ? t('kitchen:analytics.trend.down', { value: Math.abs(delta) })
                  : t('kitchen:analytics.trend.flat'),
        ...(delta === 0 || good ? {} : { tone: 'danger' as const }),
    };
}
