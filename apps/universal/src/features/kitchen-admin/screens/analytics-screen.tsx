import { Badge, Cascade, DatePickerButton, Select, Text } from '@healthy360/design-system';
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
import { ANALYTICS_SEGMENTS, buildKitchenAnalytics } from '../analytics-sample-data.ts';
import type {
    AnalyticsKpi,
    AnalyticsSegment,
    AnalyticsTableRow,
} from '../analytics-sample-data.ts';
import { CatalogueList } from '../catalogue/catalogue-list.tsx';
import type { CatalogueColumn } from '../catalogue/catalogue-column-spec.ts';
import type { ControlledColumn } from '../catalogue/use-column-controls.tsx';
import {
    compareNumber,
    compareText,
    useColumnControls,
} from '../catalogue/use-column-controls.tsx';
import { CATALOGUE_VIEW_PERMISSION } from '../entity-registry.ts';
import { WorkbenchSectionHeading } from '../workbench-parts.tsx';
import { RecordViewPage } from '../catalogue/record-view-page.tsx';
import { ColumnPicker } from '../catalogue/column-picker.tsx';
import { LensBar } from '../catalogue/lens-bar.tsx';
import type { LensFigure } from '../catalogue/lens-bar.tsx';
import { PeriodScope, periodWindows } from '../catalogue/period-scope.tsx';
import { addDays, daysBetween, todayIso } from '../../commerce/dates.ts';
/**
 * `/kitchen/analytics` — the sample-data dashboard, as `Workbench.dc.html` draws it (§3.3).
 *
 * ```
 * Units produced 1 240 units  ● On-time rate 92 %  Review backlog 31  Avg prep time 34 min
 * [Period This month ▾] [2026-08-01 ▦] to [2026-08-29 ▦] [All ▾]             ▦ Columns 6 of 6
 * PRODUCTION TREND  units a day         VOLUME BY CHANNEL
 * ▁▂▃▅▆▇                               Subscription ▬▬▬▬▬▬▬▬  2 410
 * STATUS MIX  ▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬   ■ On track 62%  ■ Watch 26%  ■ Blocked 12%
 * LINE ITEMS  sample figures until live reporting lands
 * ```
 *
 * ## Sample data, said where it is read closely
 *
 * Every figure here is `analytics-sample-data.ts`. The page carries no badge over it (removed
 * 2026-11-02, the user's call); the line items' heading and the view window still say so. When live
 * reporting lands on this route it starts carrying real revenue, and at that point it needs the cost
 * permission Cost report already has (§6.5) — decided before the data changes, not after.
 *
 * ## The Lens bar is the summary
 *
 * The four KPIs are the bar's figures, as every list page's are — no cards. The change against last
 * period is behind each figure's (i); a KPI moving the wrong way carries a danger dot.
 *
 * ## The window is the other pages' window
 *
 * The Period shortcut and a From–To pair, as Stock gaps and Cash taken draw them. The sample builder
 * reads the window's length in days, so a custom window draws as well as a shortcut. It opens on
 * This month.
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
    const [today] = useState(() => todayIso());
    const [from, setFrom] = useState(() => periodWindows(today).month.from);
    const [to, setTo] = useState(today);
    const [segment, setSegment] = useState<AnalyticsSegment>('all');
    const [viewing, setViewing] = useState<AnalyticsTableRow | null>(null);
    // Both ends counted: Today is one day.
    const days = Math.max(1, (daysBetween(from, to) ?? 0) + 1);
    const bundle = useMemo(() => buildKitchenAnalytics(days, segment), [days, segment]);
    const spans = useMemo(
        () => bucketSpans(from, days, bundle.productionTrend.length),
        [from, days, bundle.productionTrend.length],
    );
    const pickWindow = (next: { readonly from: string; readonly to: string }) => {
        setFrom(next.from);
        setTo(next.to);
        setViewing(null);
    };
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
            sort: (left, right, direction) => compareNumber(left.volume, right.volume, direction),
            render: (row) => <Text variant="mono">{formatter.formatNumber(row.volume)}</Text>,
        },
        {
            key: 'done',
            label: t('kitchen:analytics.table.completion'),
            width: 64,
            priority: 50,
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
        <Cascade space="md" testID="kitchen-analytics-panel">
            <LensBar
                testID="kitchen-analytics-toolbar"
                label={t('kitchen:lens.label')}
                figures={bundle.kpis.map((kpi) => kpiFigure(kpi, t, formatter))}
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
                                onChange={(next) => {
                                    pickWindow({ from, to: next });
                                }}
                            />
                        </View>
                        {/* A fixed-width box, lifted so its menu is never covered by the charts. */}
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
                    </>
                }
                result={t('kitchen:lens.result', {
                    shown: controls.rows.length,
                    total: bundle.rows.length,
                })}
                clearLabel={t('kitchen:lens.clear')}
                {...(controls.filtered ? { onClear: controls.clearFilters } : {})}
                // Always the labelled button, "Columns 6 of 6", as on the other lists.
                trailing={<ColumnPicker {...controls.picker} />}
            />
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
                                days <= 7
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
                <CatalogueList<AnalyticsTableRow>
                    testID="kitchen-analytics-table"
                    label={t('kitchen:analytics.table.caption')}
                    columns={controls.columns}
                    rows={controls.rows}
                    rowKey={(row) => row.id}
                    onRowPress={setViewing}
                    rowActionsLabel={t('kitchen:list.rowActions')}
                />
            </View>
        </Cascade>
    );
}
/** The order desk's kind select width, so the two filters read as one control. */
const SEGMENT_WIDTH = 140;

/** A local day, `YYYY-MM-DD`, as a `Date` at its midnight. */
function localDay(iso: string): Date {
    return new Date(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)) - 1, Number(iso.slice(8, 10)));
}

/**
 * The real calendar days each trend bar stands for, across the window.
 *
 * The window is split into `count` equal runs of whole days, oldest first; the last run absorbs the
 * remainder so the final bar always ends on the window's last day.
 */
function bucketSpans(
    from: string,
    days: number,
    count: number,
): readonly { readonly from: Date; readonly to: Date }[] {
    const size = Math.max(1, Math.floor(days / Math.max(1, count)));
    const last = localDay(addDays(from, days - 1) ?? from);
    return Array.from({ length: count }, (_, index) => {
        const start = localDay(addDays(from, index * size) ?? from);
        const end =
            index === count - 1 ? last : localDay(addDays(from, (index + 1) * size - 1) ?? from);
        return { from: start, to: end < start ? start : end };
    });
}

/**
 * A KPI as a Lens bar figure: the value in its unit, the change against last period behind its (i),
 * and a danger dot when it moved the wrong way.
 */
function kpiFigure(
    kpi: AnalyticsKpi,
    t: TFunction,
    formatter: ReturnType<typeof useFormatter>,
): LensFigure {
    const good = kpi.higherIsBetter ? kpi.deltaPercent >= 0 : kpi.deltaPercent <= 0;
    const trend =
        kpi.deltaPercent > 0
            ? t('kitchen:analytics.trend.up', { value: Math.abs(kpi.deltaPercent) })
            : kpi.deltaPercent < 0
              ? t('kitchen:analytics.trend.down', { value: Math.abs(kpi.deltaPercent) })
              : t('kitchen:analytics.trend.flat');
    return {
        key: kpi.key,
        label: t(kpi.labelKey),
        value: kpi.value,
        display: `${formatter.formatNumber(kpi.value)} ${t(`kitchen:analytics.units.${kpi.unit}`)}`,
        info: trend,
        ...(kpi.deltaPercent === 0 || good ? {} : { tone: 'danger' as const }),
    };
}
