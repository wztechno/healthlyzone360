import type { MonthlyCostReportRow } from '@healthy360/api-client/contracts';
import {
    Badge,
    Cascade,
    DatePickerButton,
    EmptyState,
    ErrorState,
    TableSkeleton,
    Text,
} from '@healthy360/design-system';
import { useFormatter } from '@healthy360/i18n';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';
import { Gate } from '../../../access/gate.tsx';
import { todayIso } from '../../commerce/dates.ts';
import { toFailure } from '../../../data/hooks.ts';
import { useCostReportQuery } from '../../../data/kitchen-ops-hooks.ts';
import { PairedBars } from '../analytics/paired-bars.tsx';
import { RatioBars } from '../analytics/ratio-bars.tsx';
import { CatalogueList } from '../catalogue/catalogue-list.tsx';
import type { CatalogueColumn } from '../catalogue/catalogue-column-spec.ts';
import type { ControlledColumn } from '../catalogue/use-column-controls.tsx';
import {
    compareNumber,
    compareText,
    useColumnControls,
} from '../catalogue/use-column-controls.tsx';
import { INVENTORY_VIEW_COSTS_PERMISSION } from '../entity-registry.ts';
import { RecordTile } from '../catalogue/record-tiles.tsx';
import { RecordViewPage } from '../catalogue/record-view-page.tsx';
import { ColumnPicker } from '../catalogue/column-picker.tsx';
import { LensBar } from '../catalogue/lens-bar.tsx';
import type { LensFigure } from '../catalogue/lens-bar.tsx';
import { PeriodScope, periodWindows } from '../catalogue/period-scope.tsx';
/**
 * `/kitchen/cost-report` — the monthly cost report (INV1.4), as `Workbench.dc.html` draws it (§3.4).
 *
 * ```
 * Spend · 2026-08 4 210.00 USD  COGS · 2026-08 …  Revenue · 2026-08 …  ● Margin · 2026-08 …
 * [Period This month ▾] [2026-08-01 ▦] to [2026-08-29 ▦]                6 of 6   ▦ Columns
 * REVENUE AND COGS BY MONTH            REVENUE BY LINE OF BUSINESS  2026-08
 * MONTHLY COST REPORT
 * MONTH              SPEND       COGS      REVENUE     MARGIN   MARGIN %
 * ```
 *
 * Real repository figures, behind `inventory.view_costs_organisation`: the report *is* the valuation.
 *
 * ## No issue tray
 *
 * The tray's two cards — COGS understated, spend incomplete — were taken off on 2026-11-02, the
 * user's call. A month with unresolved consumption exceptions still carries its `Understated` badge
 * in the table, and its record says why. A month whose cost is incomplete says so the same way, with
 * `Margin withheld`: a margin over the costed half would read as a complete one and be too high.
 *
 * ## One currency at a time
 *
 * Currency is a filter, never a mix: there is no exchange rate, so there is no grand total across
 * currencies and no component on this screen with a slot that could add one.
 *
 * ## The Lens bar is the summary
 *
 * The latest month's four figures sit on the Lens bar, as every list page's do — no cards. Margin
 * is the one with a brand dot. The figure's meaning is behind its (i).
 *
 * ## The window is in months
 *
 * The Period shortcut offers months (This month, Last month, Last 3 months, This year) and the two
 * day pickers stand for the months they fall in — the query sends `YYYY-MM`. It opens on This month,
 * or on the latest month with figures when this one has none yet.
 *
 * ## The range and the open month are in the address
 *
 * `?from=`, `?to=` and `?month=`, never component state. The stock gaps and the ledger this report
 * opens are pages of their own, and Back from either has to land on the report as it was left — the
 * same range, the same month open — rather than on today's default range with nothing open.
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
/** `YYYY-MM`, or empty for an open bound. Anything else is not sent. */
function isMonthOrEmpty(value: string): boolean {
    return value === '' || /^\d{4}-(0[1-9]|1[0-2])$/.test(value);
}
/** A picked day as the address carries it, `YYYY-MM-DD`. */
function isIsoDay(value: unknown): value is string {
    return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value);
}
/** A `YYYY-MM` as the first and last day the range pickers show. */
function monthWindow(month: string): { from: string; to: string } {
    const [year, monthNumber] = month.split('-').map(Number);
    const lastDay = new Date(Date.UTC(year ?? 1970, monthNumber ?? 1, 0)).getUTCDate();
    return { from: `${month}-01`, to: `${month}-${String(lastDay).padStart(2, '0')}` };
}

function CostReport() {
    const { t } = useTranslation();
    const formatter = useFormatter();
    const router = useRouter();
    const params = useLocalSearchParams<{ from?: string; to?: string; month?: string }>();
    // This month by default — the Period shortcut's first.
    const [today] = useState(() => todayIso());
    const thisMonth = periodWindows(today).month;
    const fromDate = isIsoDay(params.from) ? params.from : thisMonth.from;
    const toDate = isIsoDay(params.to) ? params.to : thisMonth.to;
    const from = fromDate.slice(0, 7);
    const to = toDate.slice(0, 7);
    // Cleared with an empty value, which parses as no month — the recipe list's `?kind=` precedent.
    const setViewing = (row: MonthlyCostReportRow | null) => {
        router.setParams({ month: row === null ? '' : row.month });
    };
    const filter = useMemo(
        () => ({
            ...(from === '' || !isMonthOrEmpty(from) ? {} : { from }),
            ...(to === '' || !isMonthOrEmpty(to) ? {} : { to }),
        }),
        [from, to],
    );
    const report = useCostReportQuery(filter);
    const rows = useMemo(() => report.data ?? [], [report.data]);
    // A new month opens empty. With no range asked for, go to the latest month that has figures.
    const defaulted = !isIsoDay(params.from) && !isIsoDay(params.to);
    const history = useCostReportQuery({}, defaulted && report.data?.length === 0);
    const latestWithData = history.data?.[0]?.month;
    useEffect(() => {
        if (latestWithData !== undefined) router.setParams(monthWindow(latestWithData));
    }, [latestWithData, router]);
    const currencies = useMemo(() => [...new Set(rows.map((row) => row.currencyCode))], [rows]);
    // No currency picker: the report shows the first currency the answer carries.
    const activeCurrency = currencies[0] ?? null;
    const currencyRows = useMemo(
        () => rows.filter((row) => row.currencyCode === activeCurrency),
        [rows, activeCurrency],
    );
    const chronological = useMemo(
        () => [...currencyRows].sort((left, right) => left.month.localeCompare(right.month)),
        [currencyRows],
    );
    const latest = currencyRows[0] ?? null;
    // The month in the address, once the report has it — a range moved past it opens nothing.
    const viewing = currencyRows.find((row) => row.month === params.month) ?? null;
    /** A major-unit decimal, two places, without the code — the code is the column's or tile's unit. */
    const amount = (value: string | null): string =>
        value === null
            ? t('kitchen:list.noValue')
            : formatter.formatNumber(Number(value), {
                  minimumFractionDigits: 2,
                  maximumFractionDigits: 2,
              });
    const percent = (value: string | null): string =>
        value === null
            ? t('kitchen:list.noValue')
            : formatter.formatNumber(Number(value) / 100, {
                  style: 'percent',
                  maximumFractionDigits: 1,
              });
    const withCode = (value: string | null): string =>
        value === null || activeCurrency === null
            ? t('kitchen:list.noValue')
            : `${amount(value)} ${activeCurrency}`;
    const columns: readonly ControlledColumn<
        MonthlyCostReportRow,
        CatalogueColumn<MonthlyCostReportRow>
    >[] = [
        {
            key: 'month',
            role: 'title',
            value: (row) => row.month,
            label: t('kitchen:ops.costReport.columnMonth'),
            width: 180,
            priority: 100,
            sort: (left, right, direction) => compareText(left.month, right.month, direction),
            render: (row) => (
                <View className="flex-row flex-wrap items-center gap-1.5">
                    <Text variant="mono" testID={`kitchen-cost-report-${row.month}-month`}>
                        {row.month}
                    </Text>
                    {row.hasDataQualityFlag ? (
                        <Badge
                            icon={null}
                            testID={`kitchen-cost-report-${row.month}-flag`}
                            tone="warning"
                            label={t('kitchen:ops.costReport.flagged')}
                        />
                    ) : null}
                    {row.isMarginWithheld ? (
                        <Badge
                            icon={null}
                            testID={`kitchen-cost-report-${row.month}-withheld`}
                            tone="warning"
                            label={t('kitchen:ops.costReport.marginWithheld')}
                        />
                    ) : null}
                </View>
            ),
        },
        ...(
            [
                ['spend', 'columnSpend', (row: MonthlyCostReportRow) => row.spendAmount, 70],
                ['cogs', 'columnCogs', (row: MonthlyCostReportRow) => row.cogsAmount, 80],
                ['revenue', 'columnRevenue', (row: MonthlyCostReportRow) => row.revenueAmount, 75],
                /*
                 * The three production figures (PROD1), each at a lower priority
                 * than the four above so they hide first on a narrow viewport —
                 * a kitchen reads spend, COGS, revenue and margin every day and
                 * these on the days it made something.
                 *
                 * Rendered as columns beside the others and **never** added to
                 * them. What a batch ate is not cost of goods sold; what it
                 * wasted is already inside the waste figure; what it yielded is
                 * neither revenue nor expense.
                 */
                [
                    'productionConsumption',
                    'columnProductionConsumption',
                    (row: MonthlyCostReportRow) => row.productionConsumptionAmount,
                    45,
                ],
                [
                    'productionWaste',
                    'columnProductionWaste',
                    (row: MonthlyCostReportRow) => row.productionWasteAmount,
                    40,
                ],
                [
                    'productionYield',
                    'columnProductionYield',
                    (row: MonthlyCostReportRow) => row.productionYieldValueAmount,
                    35,
                ],
            ] as const
        ).map(
            ([key, labelKey, read, priority]): ControlledColumn<
                MonthlyCostReportRow,
                CatalogueColumn<MonthlyCostReportRow>
            > => ({
                key,
                label: t(`kitchen:ops.costReport.${labelKey}`),
                width: 110,
                priority,
                sort: (left, right, direction) =>
                    compareNumber(Number(read(left) ?? 0), Number(read(right) ?? 0), direction),
                render: (row) => <Text variant="mono">{amount(read(row))}</Text>,
            }),
        ),
        {
            key: 'margin',
            role: 'metric',
            label: t('kitchen:ops.costReport.columnMargin'),
            width: 110,
            priority: 90,
            sort: (left, right, direction) =>
                compareNumber(
                    Number(left.grossMarginAmount ?? 0),
                    Number(right.grossMarginAmount ?? 0),
                    direction,
                ),
            render: (row) => (
                <Text
                    variant="mono"
                    tone="brand"
                    className="font-medium"
                    testID={`kitchen-cost-report-${row.month}-margin`}
                >
                    {amount(row.grossMarginAmount)}
                </Text>
            ),
        },
        {
            /*
             * The estimated margin, beside the actual one (PROD1). The gap
             * between them is what a kitchen is actually looking for: it priced
             * against the estimate and lived with the actual.
             *
             * An em dash where the server withheld it, and that is not the same
             * as a zero margin: the estimate is null whenever any sold line of
             * the month had no frozen figure, because a total over the priced
             * half reads exactly like a complete one and is too small.
             */
            key: 'estimatedMargin',
            label: t('kitchen:ops.costReport.columnEstimatedMargin'),
            width: 110,
            priority: 55,
            sort: (left, right, direction) =>
                compareNumber(
                    Number(left.estimatedMarginAmount ?? 0),
                    Number(right.estimatedMarginAmount ?? 0),
                    direction,
                ),
            render: (row) => (
                <Text
                    variant="mono"
                    tone="secondary"
                    testID={`kitchen-cost-report-${row.month}-estimated-margin`}
                >
                    {amount(row.estimatedMarginAmount)}
                </Text>
            ),
        },
        {
            key: 'marginPercent',
            label: t('kitchen:ops.costReport.columnMarginPercent'),
            width: 90,
            priority: 50,
            sort: (left, right, direction) =>
                compareNumber(
                    Number(left.grossMarginPercent ?? 0),
                    Number(right.grossMarginPercent ?? 0),
                    direction,
                ),
            render: (row) => (
                <Text variant="mono" tone="secondary">
                    {percent(row.grossMarginPercent)}
                </Text>
            ),
        },
    ];
    const controls = useColumnControls(currencyRows, columns, 'kitchen-cost-report-table');
    const failure = toFailure(report.error);
    const mixRows = (() => {
        if (latest === null) return [];
        const parts = [
            ['meal', 'mixMeal', Number(latest.mealRevenueAmount)],
            ['product', 'mixProduct', Number(latest.productRevenueAmount)],
            ['other', 'mixOther', Number(latest.otherRevenueAmount)],
        ] as const;
        const total = parts.reduce((sum, [, , value]) => sum + Math.max(0, value), 0);
        if (total <= 0) return [];
        return parts.map(([key, labelKey, value]) => ({
            key,
            label: t(`kitchen:ops.costReport.${labelKey}`),
            value: formatter.formatNumber(value, {
                minimumFractionDigits: 2,
                maximumFractionDigits: 2,
            }),
            share: Math.max(0, value) / total,
        }));
    })();
    const viewPopup =
        viewing === null ? null : (
            <RecordViewPage
                testID="kitchen-cost-report-window"
                look="board"
                eyebrow={t('kitchen:recordView.eyebrowCostReport')}
                onBack={() => {
                    setViewing(null);
                }}
                title={viewing.month}
                kind={t('kitchen:ops.costReport.window.kind')}
                {...(viewing.isMarginWithheld
                    ? {
                          status: {
                              label: t('kitchen:ops.costReport.marginWithheld'),
                              tone: 'warning' as const,
                          },
                          note: t('kitchen:ops.costReport.window.withheldNote', {
                              lines: viewing.uncostedLineCount,
                              exceptions: viewing.exceptionCount,
                              batches: viewing.unvaluedBatchCount,
                          }),
                      }
                    : viewing.hasDataQualityFlag
                      ? {
                            status: {
                                label: t('kitchen:ops.costReport.flagged'),
                                tone: 'warning' as const,
                            },
                            note: t('kitchen:ops.costReport.window.flaggedNote'),
                        }
                      : {})}
                fields={[
                    {
                        key: 'spend',
                        label: t('kitchen:ops.costReport.columnSpend'),
                        value: withCode(viewing.spendAmount),
                        mono: true,
                    },
                    {
                        key: 'cogs',
                        label: t('kitchen:ops.costReport.columnCogs'),
                        value: withCode(viewing.cogsAmount),
                        mono: true,
                    },
                    {
                        key: 'revenue',
                        label: t('kitchen:ops.costReport.columnRevenue'),
                        value: withCode(viewing.revenueAmount),
                        mono: true,
                    },
                    {
                        key: 'refunds',
                        label: t('kitchen:ops.costReport.columnRefunds'),
                        value: withCode(viewing.refundsAmount),
                        mono: true,
                    },
                    {
                        key: 'margin',
                        label: t('kitchen:ops.costReport.columnMargin'),
                        value: withCode(viewing.grossMarginAmount),
                        mono: true,
                    },
                    {
                        key: 'marginPercent',
                        label: t('kitchen:ops.costReport.columnMarginPercent'),
                        value: percent(viewing.grossMarginPercent),
                        mono: true,
                    },
                    // An operating cost, after the margin it is not part of.
                    {
                        key: 'courierExpense',
                        label: t('kitchen:ops.costReport.columnCourierExpense'),
                        value: withCode(viewing.courierExpenseAmount),
                        mono: true,
                    },
                    {
                        key: 'currency',
                        label: t('kitchen:ops.costReport.currencyLabel'),
                        value: t('kitchen:ops.costReport.window.currencyValue', {
                            currency: viewing.currencyCode,
                        }),
                    },
                ]}
                primaryAction={{
                    label: t('kitchen:ops.costReport.window.openLedger'),
                    icon: null,
                    // The month stays open behind it, so Back from the ledger returns to it.
                    onPress: () => {
                        router.push('/kitchen/purchases-ledger' as never);
                    },
                }}
            />
        );

    const showsReport =
        !report.isPending && failure === null && currencyRows.length > 0 && latest !== null;
    /** A figure of the latest month: a placeholder in flight, a dash with nothing to show. */
    const figure = (value: string | null): Pick<LensFigure, 'value' | 'display'> =>
        report.isPending
            ? { value: null }
            : !showsReport || value === null
              ? { value: 0, display: t('kitchen:list.noValue') }
              : { value: Number(value), display: withCode(value) };
    const month = latest?.month ?? '';
    const lensBar = (
        <LensBar
            testID="kitchen-cost-report-toolbar"
            layout="split"
            label={t('kitchen:lens.label')}
            figures={(
                [
                    ['spend', 'Spend', latest?.spendAmount ?? null],
                    ['cogs', 'Cogs', latest?.cogsAmount ?? null],
                    ['revenue', 'Revenue', latest?.revenueAmount ?? null],
                    ['margin', 'Margin', latest?.grossMarginAmount ?? null],
                ] as const
            ).map(([key, name, value]): LensFigure => ({
                key,
                // "Margin · 2026-08" once there is a month to name, the bare name before.
                label:
                    month === ''
                        ? t(`kitchen:ops.costReport.column${name}`)
                        : t(`kitchen:ops.costReport.tile${name}`, { month }),
                ...figure(value),
                info: t(`kitchen:ops.costReport.hint${name}`),
                ...(key === 'margin' ? { tone: 'brand' as const, separated: true } : {}),
            }))}
            /*
             * The Period shortcut in months, then the window it stands for. A picked day stands
             * for its month; picking either closes the month that was open.
             */
            scope={
                <>
                    <PeriodScope
                        testID="kitchen-cost-report-filter-period"
                        today={today}
                        unit="month"
                        value={{ from: fromDate, to: toDate }}
                        onChange={(next) => {
                            router.setParams({ from: next.from, to: next.to, month: '' });
                        }}
                    />
                    <View className="z-auto flex-row items-center gap-tight">
                        <DatePickerButton
                            testID="kitchen-cost-report-filter-from"
                            label={t('kitchen:ops.costReport.filterFrom')}
                            value={fromDate}
                            max={toDate}
                            onChange={(next) => {
                                router.setParams({ from: next, month: '' });
                            }}
                        />
                        <Text variant="caption" tone="secondary" aria-hidden>
                            {t('kitchen:ops.requirements.windowTo')}
                        </Text>
                        <DatePickerButton
                            testID="kitchen-cost-report-filter-to"
                            label={t('kitchen:ops.costReport.filterTo')}
                            value={toDate}
                            min={fromDate}
                            onChange={(next) => {
                                router.setParams({ to: next, month: '' });
                            }}
                        />
                    </View>
                </>
            }
            result={
                report.isPending
                    ? null
                    : t('kitchen:lens.result', {
                          shown: controls.rows.length,
                          total: currencyRows.length,
                      })
            }
            clearLabel={t('kitchen:lens.clear')}
            {...(controls.filtered ? { onClear: controls.clearFilters } : {})}
            // Always the labelled button, "Columns 6 of 6", as on the other lists.
            trailing={showsReport ? <ColumnPicker {...controls.picker} compact /> : undefined}
        />
    );

    return (
        <Cascade space="md" testID="kitchen-cost-report-screen">
            {lensBar}
            {report.isPending ? (
                <TableSkeleton testID="kitchen-cost-report-loading" rows={6} />
            ) : failure !== null ? (
                <ErrorState
                    testID="kitchen-cost-report-error"
                    failure={failure}
                    onRetry={() => {
                        void report.refetch();
                    }}
                    retrying={report.isFetching}
                />
            ) : currencyRows.length === 0 || latest === null ? (
                <EmptyState
                    testID="kitchen-cost-report-empty"
                    title={t('kitchen:ops.costReport.emptyTitle')}
                    body={t('kitchen:ops.costReport.emptyBody')}
                />
            ) : (
                /*
                 * The report's own run of sections, as a cascade that continues the page's count:
                 * when the months land they arrive in order in place of the skeleton, rather than
                 * all at once.
                 */
                <Cascade space="md">
                    <View className="flex-row flex-wrap gap-4">
                        <View className="min-w-[300px] flex-1 flex-col">
                            <RecordTile
                                testID="kitchen-cost-report-tile-revenue-cogs"
                                title={t('kitchen:ops.costReport.chartRevenueCogs')}
                            >
                                <PairedBars
                                    testID="kitchen-cost-report-chart-revenue-cogs"
                                    aLabel={t('kitchen:ops.costReport.columnRevenue')}
                                    bLabel={t('kitchen:ops.costReport.columnCogs')}
                                    series={chronological.map((row) => ({
                                        tick: row.month.slice(5),
                                        a: Number(row.revenueAmount),
                                        b: Number(row.cogsAmount),
                                        aTitle: `${row.month} · ${t('kitchen:ops.costReport.columnRevenue')} ${withCode(row.revenueAmount)}`,
                                        bTitle: `${row.month} · ${t('kitchen:ops.costReport.columnCogs')} ${withCode(row.cogsAmount)}`,
                                    }))}
                                />
                            </RecordTile>
                        </View>
                        {mixRows.length === 0 ? null : (
                            <View className="min-w-[300px] flex-1 flex-col">
                                <RecordTile
                                    testID="kitchen-cost-report-tile-mix"
                                    title={t('kitchen:ops.costReport.chartRevenueMixTitle')}
                                    trailing={
                                        <Text variant="caption" tone="secondary">
                                            {latest.month}
                                        </Text>
                                    }
                                >
                                    <RatioBars
                                        testID="kitchen-cost-report-chart-mix"
                                        labelWidth={88}
                                        valueWidth={84}
                                        rows={mixRows}
                                    />
                                </RecordTile>
                            </View>
                        )}
                    </View>
                    <CatalogueList<MonthlyCostReportRow>
                        testID="kitchen-cost-report-table"
                        label={t('kitchen:ops.costReport.caption')}
                        columns={controls.columns}
                        rows={controls.rows}
                        rowKey={(row) => `${row.month}-${row.currencyCode}`}
                        onRowPress={setViewing}
                        rowActionsLabel={t('kitchen:list.rowActions')}
                    />
                </Cascade>
            )}

            {viewPopup}
        </Cascade>
    );
}
