import type { MonthlyCostReportRow } from '@healthy360/api-client/contracts';
import {
    Badge,
    Button,
    Callout,
    DatePickerButton,
    EmptyState,
    ErrorState,
    RecordWindow,
    Skeleton,
    Stack,
    Text,
} from '@healthy360/design-system';
import { useFormatter } from '@healthy360/i18n';
import { useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';
import { Gate } from '../../../access/gate.tsx';
import { addDays, todayIso } from '../../commerce/dates.ts';
import { toFailure } from '../../../data/hooks.ts';
import { useCostReportQuery } from '../../../data/kitchen-ops-hooks.ts';
import { PairedBars } from '../analytics/paired-bars.tsx';
import { RatioBars } from '../analytics/ratio-bars.tsx';
import { CatalogueList } from '../catalogue/catalogue-list.tsx';
import { CatalogueStatCards } from '../catalogue/catalogue-stat-cards.tsx';
import type { CatalogueColumn } from '../catalogue/catalogue-column-spec.ts';
import type { ControlledColumn } from '../catalogue/use-column-controls.tsx';
import {
    compareNumber,
    compareText,
    useColumnControls,
} from '../catalogue/use-column-controls.tsx';
import { INVENTORY_VIEW_COSTS_PERMISSION } from '../entity-registry.ts';
import { WorkbenchSectionHeading } from '../workbench-parts.tsx';
/**
 * `/kitchen/cost-report` — the monthly cost report (INV1.4), as `Workbench.dc.html` draws it (§3.4).
 *
 * ```
 * Monthly cost report  [ COSTS ]
 * From month [ 2026-03 ▦ ]  To month [ 2026-08 ▦ ]  Currency [ USD ▾ ]
 * ⚠ Two months' COGS may be understated. …  Open consumption exceptions
 * ⓘ Some purchases are still waiting on their prices. …
 * ┌ SPEND ┐ ┌ COGS ┐ ┌ REVENUE ┐ ┌ MARGIN ┐
 * REVENUE AND COGS BY MONTH            REVENUE BY LINE OF BUSINESS  2026-08
 * MONTHLY COST REPORT
 * MONTH              SPEND       COGS      REVENUE     MARGIN   MARGIN %
 * ```
 *
 * Real repository figures, behind `inventory.view_costs_organisation`: the report *is* the valuation.
 *
 * ## Two banners, because two different figures can be short
 *
 * `dataQuality` (warning) when a month in range has unresolved consumption exceptions — COGS is
 * understated, and the banner links to the exceptions queue because that is where the fix is.
 * `spendIncomplete` (info) when a receipt line has no usable price — spend is understated. Merging
 * them would leave a manager unable to tell which number to distrust. The `Understated` badge on a
 * month row is the warning's row-level echo, and both are derived from the same rows.
 *
 * ## One currency at a time
 *
 * Currency is a filter, never a mix: there is no exchange rate, so there is no grand total across
 * currencies and no component on this screen with a slot that could add one.
 *
 * ## No summary strip
 *
 * The four cost tiles are the summary (§3z). Margin is the one tile in brand ink.
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
function CostReport() {
    const { t } = useTranslation();
    const formatter = useFormatter();
    const router = useRouter();
    // Today to a week out by default, as the order desk's pickers open.
    const [fromDate, setFromDate] = useState(() => todayIso());
    const [toDate, setToDate] = useState(() => addDays(todayIso(), 7) ?? todayIso());
    const from = fromDate.slice(0, 7);
    const to = toDate.slice(0, 7);
    const [viewing, setViewing] = useState<MonthlyCostReportRow | null>(null);
    const filter = useMemo(
        () => ({
            ...(from === '' || !isMonthOrEmpty(from) ? {} : { from }),
            ...(to === '' || !isMonthOrEmpty(to) ? {} : { to }),
        }),
        [from, to],
    );
    const report = useCostReportQuery(filter);
    const rows = useMemo(() => report.data ?? [], [report.data]);
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
    const flaggedCount = currencyRows.filter((row) => row.hasDataQualityFlag).length;
    // Counted once per month, not per row: the lines are a month fact repeated across currencies.
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
                            testID={`kitchen-cost-report-${row.month}-flag`}
                            tone="warning"
                            label={t('kitchen:ops.costReport.flagged')}
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
                align: 'end',
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
            align: 'end',
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
            align: 'end',
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
            align: 'end',
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
    return (
        <Stack space="md" testID="kitchen-cost-report-screen">
            <View
                testID="kitchen-cost-report-filters"
                className="z-10 min-h-control-sm flex-row flex-wrap items-center gap-tight"
            >
                {/* The order desk's date picker. The report is monthly, so a picked day stands for
                    its month — the query sends `YYYY-MM`. */}
                <DatePickerButton
                    testID="kitchen-cost-report-filter-from"
                    label={t('kitchen:ops.costReport.filterFrom')}
                    value={fromDate}
                    max={toDate === '' ? undefined : toDate}
                    onChange={(next) => {
                        setFromDate(next);
                        setViewing(null);
                    }}
                />
                <Text variant="caption" tone="secondary" aria-hidden>
                    {t('kitchen:ops.requirements.windowTo')}
                </Text>
                <DatePickerButton
                    testID="kitchen-cost-report-filter-to"
                    label={t('kitchen:ops.costReport.filterTo')}
                    value={toDate}
                    min={fromDate === '' ? undefined : fromDate}
                    onChange={(next) => {
                        setToDate(next);
                        setViewing(null);
                    }}
                />
            </View>
            {report.isPending ? (
                <View testID="kitchen-cost-report-loading" className="flex-col">
                    {Array.from({ length: 6 }, (_, index) => (
                        <View
                            key={index}
                            className="h-row-md flex-row items-center border-b border-stroke-subtle"
                        >
                            <Skeleton heightClassName="h-2" />
                        </View>
                    ))}
                </View>
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
                <Stack space="md">
                    {flaggedCount > 0 ? (
                        <Callout
                            testID="kitchen-cost-report-data-quality"
                            role="alert"
                            tone="warning"
                            title={t('kitchen:ops.costReport.dataQualityTitle', {
                                count: flaggedCount,
                            })}
                            body={t('kitchen:ops.costReport.dataQualityBody', {
                                count: flaggedCount,
                            })}
                            actions={
                                <Button
                                    testID="kitchen-cost-report-open-exceptions"
                                    variant="ghost"
                                    size="sm"
                                    label={t('kitchen:ops.costReport.openExceptions')}
                                    onPress={() => {
                                        router.push('/kitchen/consumption-exceptions' as never);
                                    }}
                                />
                            }
                        />
                    ) : null}
                    {incompleteSpend.months.length > 0 ? (
                        <Callout
                            testID="kitchen-cost-report-spend-quality"
                            role="note"
                            tone="info"
                            title={t('kitchen:ops.costReport.spendIncompleteTitle')}
                            body={t('kitchen:ops.costReport.spendIncompleteBody', {
                                count: incompleteSpend.lineCount,
                                months: incompleteSpend.months.join(', '),
                            })}
                        />
                    ) : null}
                    <CatalogueStatCards
                        testID="kitchen-cost-report-tile"
                        cards={(
                            [
                                ['spend', 'tileSpend', latest.spendAmount, 'hintSpend', 'basket'],
                                ['cogs', 'tileCogs', latest.cogsAmount, 'hintCogs', 'warning'],
                                [
                                    'revenue',
                                    'tileRevenue',
                                    latest.revenueAmount,
                                    'hintRevenue',
                                    'calendar',
                                ],
                                [
                                    'margin',
                                    'tileMargin',
                                    latest.grossMarginAmount,
                                    'hintMargin',
                                    'check',
                                ],
                            ] as const
                        ).map(([key, labelKey, value, hintKey, mark]) => ({
                            key,
                            label: t(`kitchen:ops.costReport.${labelKey}`, { month: latest.month }),
                            value: amount(value),
                            ...(activeCurrency === null ? {} : { unit: activeCurrency }),
                            caption: t(`kitchen:ops.costReport.${hintKey}`),
                            mark,
                            tone: key === 'margin' ? ('brand' as const) : ('default' as const),
                        }))}
                    />
                    <View className="flex-row flex-wrap gap-4">
                        <View className="min-w-[300px] flex-1 flex-col gap-snug">
                            <WorkbenchSectionHeading
                                title={t('kitchen:ops.costReport.chartRevenueCogs')}
                            />
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
                        </View>
                        {mixRows.length === 0 ? null : (
                            <View className="min-w-[300px] flex-1 flex-col gap-snug">
                                <WorkbenchSectionHeading
                                    title={t('kitchen:ops.costReport.chartRevenueMixTitle')}
                                    aside={latest.month}
                                />
                                <RatioBars
                                    testID="kitchen-cost-report-chart-mix"
                                    labelWidth={88}
                                    valueWidth={84}
                                    rows={mixRows}
                                />
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
                </Stack>
            )}
            {viewing === null ? null : (
                <RecordWindow
                    testID="kitchen-cost-report-window"
                    open
                    onClose={() => {
                        setViewing(null);
                    }}
                    title={viewing.month}
                    kind={t('kitchen:ops.costReport.window.kind')}
                    {...(viewing.hasDataQualityFlag
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
                        onPress: () => {
                            setViewing(null);
                            router.push('/kitchen/purchases-ledger' as never);
                        },
                    }}
                />
            )}
        </Stack>
    );
}
