import type {
    OrderDeskCashReportMeta,
    OrderDeskCashReportRow,
    OrderDeskCashReportTotal,
} from '@healthy360/api-client/contracts';
import {
    Callout,
    Cascade,
    DatePickerButton,
    EmptyState,
    ErrorState,
    Select,
    TableSkeleton,
    Text,
} from '@healthy360/design-system';
import type { BranchId } from '@healthy360/domain-types';
import { useFormatter } from '@healthy360/i18n';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { Gate } from '../../../access/gate.tsx';
import { toFailure } from '../../../data/hooks.ts';
import { useOrderDeskCashReportQuery } from '../../../data/order-desk-hooks.ts';
import { daysBetween, isIsoDate, todayIso } from '../../commerce/dates.ts';
import { formatMoney } from '../../marketplace/format.ts';
import { ORDER_MANAGE_PERMISSION } from '../entity-registry.ts';
import { CatalogueList } from '../catalogue/catalogue-list.tsx';
import type { CatalogueColumn } from '../catalogue/catalogue-column-spec.ts';
import type { ControlledColumn } from '../catalogue/use-column-controls.tsx';
import {
    compareNumber,
    compareText,
    useColumnControls,
} from '../catalogue/use-column-controls.tsx';
import { kitchenOrderPaymentMethodKey } from '../ops-format.ts';
import { ColumnPicker } from '../catalogue/column-picker.tsx';
import { LensBar } from '../catalogue/lens-bar.tsx';
import type { LensFigure } from '../catalogue/lens-bar.tsx';
import { PeriodScope } from '../catalogue/period-scope.tsx';

/**
 * `/kitchen/order-desk/cash-report` — who took what, day by day.
 *
 * ## A window of days, each still its own till-day
 *
 * The reader picks a From–To window (at most {@link MAX_WINDOW_DAYS} days) or one of the period
 * shortcuts. The day is part of every row's key on the server, so a week is seven days of rows,
 * never one row summing Monday and Tuesday — and the Day column is how each one is stood next to its
 * own cash box. The totals panel sums the whole window, per method and currency.
 *
 * ## What this is, and what it is honestly not
 *
 * The desk takes cash, and this platform has **no shift table**: nothing opens a drawer with a
 * float, nothing closes it against a count, nothing records a variance. That gap was accepted
 * knowingly when the receipts ledger landed, on the condition that the money at least be
 * *attributable* — a manager must be able to ask "what did each agent take yesterday?" and get an
 * answer they can stand a cash box next to.
 *
 * This screen is that answer and deliberately not more. **It cannot say whether the box balances**,
 * because nothing on this platform has ever been told what was in it, and the screen states that
 * rather than letting a reader infer a reconciliation from a table of figures. A real drawer
 * reconciliation is a later table; when it lands, this reads from the same ledger.
 *
 * ## The day is the kitchen's
 *
 * The server cuts days on the chosen till's branch clock, or with All branches on the
 * organisation's, the clock the daily close uses, and echoes it in `meta.timezone`.
 *
 * ## Three columns of money and no grand total
 *
 * A row is one agent, one method, one currency, and the currency is part of that identity rather
 * than a label on it. The totals underneath are per method **and currency**, and there is no line
 * adding them up: it would have to add currencies, and a number in no currency is worse than no
 * number. The screen therefore renders exactly what the server sent and folds nothing — the same
 * discipline the calendar's three bases keep, for the same reason.
 *
 * ## Em dashes
 *
 * One unknown on this surface and one only: an agent whose profile was never completed has no name.
 * They still took the money, so the row is still there, with the workspace's em dash and an
 * accessible label — a dash is silent to a screen reader, and a reconciliation is not the place to
 * leave somebody guessing which colleague a blank cell means.
 *
 * Everything else here is a true figure. A day with no receipts is an **empty table**, not a hole:
 * the server walked the day and found nothing, which is an answer.
 *
 * ## `order.manage_organisation`
 *
 * A manager's reconciliation of their agents' takings, not an agent's view of their own work — the
 * same code the driver picker and the lifecycle writes take, and one step above the
 * `order.view_organisation` that everybody working a queue holds.
 */

/** What an agent with no name on their profile renders as — the workspace's one unknown character. */
const EM_DASH = '—';

/** The picker's whole-kitchen option, as on the daily close. Never a branch identifier. */
const ALL_BRANCHES = '__all__';

export function OrderDeskCashReportScreen() {
    return (
        <Gate
            area="kitchen"
            requirement={{ allOf: [ORDER_MANAGE_PERMISSION] }}
            testID="kitchen-order-desk-cash-report"
        >
            <OrderDeskCashReport />
        </Gate>
    );
}

function OrderDeskCashReport() {
    const { t } = useTranslation();
    const formatter = useFormatter();

    /**
     * Opens on today, which is the day somebody reconciling a till almost always wants.
     *
     * `todayIso()` reads the device's clock while the report is cut on the kitchen's, and the two
     * can differ by a day either side of midnight. The Day column prints the day the *server* filed each row
     * under, so a reader whose "today" and the report's disagree can see that they do.
     */
    const [today] = useState(() => todayIso());
    const [from, setFrom] = useState(today);
    const [to, setTo] = useState(today);

    /**
     * The question, or `null` while the window is not one the server would answer — a half-typed
     * date, To before From, or longer than {@link MAX_WINDOW_DAYS}. Asking for any of those would
     * spend a `422`.
     *
     * Memoised because the hook keys on the whole object (query-key shape rule 3) — a fresh literal
     * every render would be a fresh cache entry every render.
     *
     * **`branchId` only when a till is picked.** The picker is the daily close's: All branches by
     * default, then each till the server listed in `meta.branches`. A till's report reads the same
     * money as its close, and its days are cut on that branch's clock.
     */
    const span = isIsoDate(from) && isIsoDate(to) ? daysBetween(from, to) : null;
    const tooLong = span !== null && span >= MAX_WINDOW_DAYS;
    const [branch, setBranch] = useState(ALL_BRANCHES);
    const filters = useMemo(
        () =>
            span !== null && span >= 0 && !tooLong
                ? { from, to, ...(branch === ALL_BRANCHES ? {} : { branchId: branch as BranchId }) }
                : null,
        [from, to, span, tooLong, branch],
    );

    const report = useOrderDeskCashReportQuery(filters);

    // The tills outlive a reload: a new window or till is a new query with no data yet, and the
    // picker must not vanish from under the hand that just used it.
    const [branches, setBranches] = useState<OrderDeskCashReportMeta['branches']>([]);
    const loadedBranches = report.data?.meta.branches;
    if (loadedBranches !== undefined && loadedBranches !== branches) setBranches(loadedBranches);

    const failure = toFailure(report.error);
    const rows = report.data?.rows ?? [];
    const totals = report.data?.totals ?? [];
    const adjustments = report.data?.adjustments ?? [];

    const columns: readonly ControlledColumn<
        OrderDeskCashReportRow,
        CatalogueColumn<OrderDeskCashReportRow>
    >[] = [
        {
            key: 'day',
            label: t('kitchen:ops.cashReport.columnDay'),
            width: 130,
            priority: 98,
            sort: (left, right, direction) => compareText(left.day, right.day, direction),
            render: (row) => (
                <Text tone="secondary" className="tabular-nums" testID={`${rowTestId(row)}-day`}>
                    {formatter.formatDate(row.day, {
                        weekday: 'short',
                        day: 'numeric',
                        month: 'short',
                        // The day is a bare date, parsed as UTC midnight; read in a local zone
                        // west of Greenwich it would print as the day before.
                        timeZone: 'UTC',
                    })}
                </Text>
            ),
        },
        {
            key: 'agent',
            role: 'title',
            value: (row) => row.displayName ?? EM_DASH,
            label: t('kitchen:ops.cashReport.columnAgent'),
            width: 180,
            priority: 100,
            sort: (left, right, direction) =>
                compareText(left.displayName, right.displayName, direction),
            render: (row) => (
                <Text
                    variant="strong"
                    tone={row.displayName === null ? 'secondary' : 'primary'}
                    testID={`${rowTestId(row)}-agent`}
                    // The dash is silent to a screen reader, so the cell says in words what it has
                    // instead of a name.
                    {...(row.displayName === null
                        ? { accessibilityLabel: t('kitchen:ops.cashReport.a11y.unnamedAgent') }
                        : {})}
                >
                    {row.displayName ?? EM_DASH}
                </Text>
            ),
        },
        {
            key: 'method',
            role: 'meta',
            label: t('kitchen:ops.cashReport.columnMethod'),
            width: 160,
            priority: 90,
            filter: {
                values: (loaded) =>
                    [...new Set(loaded.map((row) => row.method))].map((method) => ({
                        key: method,
                        label: t(kitchenOrderPaymentMethodKey(method)),
                    })),
                match: (row, value) => row.method === value,
            },
            render: (row) => (
                <Text tone="secondary" testID={`${rowTestId(row)}-method`}>
                    {t(kitchenOrderPaymentMethodKey(row.method))}
                </Text>
            ),
        },
        {
            key: 'currency',
            label: t('kitchen:ops.cashReport.columnCurrency'),
            width: 80,
            priority: 70,
            filter: {
                values: (loaded) =>
                    [...new Set(loaded.map((row) => row.currencyCode))].map((code) => ({
                        key: code,
                        label: code,
                    })),
                match: (row, value) => row.currencyCode === value,
            },
            render: (row) => (
                <Text variant="mono" tone="secondary" testID={`${rowTestId(row)}-currency`}>
                    {row.currencyCode}
                </Text>
            ),
        },
        {
            key: 'count',
            label: t('kitchen:ops.cashReport.columnCount'),
            width: 80,
            priority: 60,
            sort: (left, right, direction) =>
                compareNumber(left.receiptCount, right.receiptCount, direction),
            render: (row) => (
                <Text variant="mono" tone="secondary" testID={`${rowTestId(row)}-count`}>
                    {formatter.formatNumber(row.receiptCount)}
                </Text>
            ),
        },
        {
            key: 'amount',
            role: 'metric',
            label: t('kitchen:ops.cashReport.columnAmount'),
            width: 140,
            priority: 95,
            sort: (left, right, direction) =>
                compareNumber(left.amountMinorSum, right.amountMinorSum, direction),
            render: (row) => (
                <Text variant="mono" testID={`${rowTestId(row)}-amount`}>
                    {formatMoney(formatter, {
                        amount: row.amountMinorSum,
                        currency: row.currencyCode,
                    })}
                </Text>
            ),
        },
    ];
    // `.v2` since the Day column: a column choice saved before it existed would otherwise hide it.
    const controls = useColumnControls(rows, columns, 'kitchen-order-desk-cash-report-table', {
        picker: { storageKey: 'kitchen-order-desk-cash-report.v2' },
    });

    return (
        <Cascade space="md" testID="kitchen-order-desk-cash-report-screen">
            {/*
             * The Lens bar: the day's figures over the day picker, as on every list page. While the
             * day is in flight each figure holds a placeholder — a zero there would claim an answer
             * the screen does not have yet — and with no day to read, or a failed read, a dash.
             */}
            <LensBar
                testID="kitchen-order-desk-cash-report-toolbar"
                label={t('kitchen:lens.label')}
                figures={(() => {
                    const unknown = filters === null || failure !== null;
                    const figure = (count: number): Pick<LensFigure, 'value' | 'display'> =>
                        unknown
                            ? { value: 0, display: t('kitchen:list.noValue') }
                            : report.isPending
                              ? { value: null }
                              : { value: count, display: formatter.formatNumber(count) };
                    return [
                        {
                            key: 'receipts',
                            label: t('kitchen:ops.cashReport.kpiReceipts'),
                            ...figure(rows.reduce((sum, row) => sum + row.receiptCount, 0)),
                        },
                        {
                            key: 'rows',
                            label: t('kitchen:ops.cashReport.kpiRows'),
                            ...figure(rows.length),
                            tone: 'brand',
                            separated: true,
                        },
                        {
                            key: 'currencies',
                            label: t('kitchen:ops.cashReport.kpiCurrencies'),
                            ...figure(new Set(totals.map((total) => total.currencyCode)).size),
                            tone: 'info',
                        },
                    ];
                })()}
                /*
                 * The period shortcut, then the window it stands for. Picking a shortcut writes both
                 * days; editing either day by hand reads back as Custom, because the shortcut is
                 * derived from the window rather than stored beside it.
                 */
                scope={
                    <>
                        <PeriodScope
                            testID="kitchen-order-desk-cash-report-period"
                            today={today}
                            value={{ from, to }}
                            onChange={(next) => {
                                setFrom(next.from);
                                setTo(next.to);
                            }}
                        />
                        <View className="z-auto flex-row items-center gap-tight">
                            <DatePickerButton
                                testID="kitchen-order-desk-cash-report-from"
                                label={t('kitchen:ops.cashReport.fromLabel')}
                                value={from}
                                max={to}
                                onChange={setFrom}
                            />
                            <Text variant="caption" tone="secondary" aria-hidden>
                                {t('kitchen:ops.requirements.windowTo')}
                            </Text>
                            <DatePickerButton
                                testID="kitchen-order-desk-cash-report-to"
                                label={t('kitchen:ops.cashReport.toLabel')}
                                value={to}
                                min={from}
                                onChange={setTo}
                            />
                        </View>
                    </>
                }
                result={
                    report.isPending && filters !== null
                        ? null
                        : t('kitchen:lens.result', {
                              shown: controls.rows.length,
                              total: rows.length,
                          })
                }
                clearLabel={t('kitchen:lens.clear')}
                {...(controls.filtered ? { onClear: controls.clearFilters } : {})}
                trailing={
                    rows.length === 0
                        ? undefined
                        : (narrow) => <ColumnPicker {...controls.picker} compact={narrow} />
                }
            />

            {/* The daily close's till picker, shown once the kitchen has more than one till. */}
            {branches.length > 1 ? (
                <View className="w-field">
                    <Select
                        testID="kitchen-order-desk-cash-report-branch"
                        label={t('kitchen:ops.dailyClose.branchLabel')}
                        size="sm"
                        value={branch}
                        options={[
                            {
                                value: ALL_BRANCHES,
                                label: t('kitchen:ops.dailyClose.allBranches'),
                            },
                            ...branches.map((option) => ({
                                value: option.id,
                                label: option.name,
                            })),
                        ]}
                        onChange={setBranch}
                    />
                </View>
            ) : null}

            {filters === null ? (
                tooLong ? (
                    <Callout
                        testID="kitchen-order-desk-cash-report-window-too-long"
                        tone="info"
                        title={t('kitchen:ops.cashReport.windowTooLongTitle', {
                            count: MAX_WINDOW_DAYS,
                        })}
                    />
                ) : (
                    <Callout
                        testID="kitchen-order-desk-cash-report-date-invalid"
                        tone="info"
                        title={t('kitchen:ops.cashReport.dateInvalidTitle')}
                        body={t('kitchen:ops.cashReport.dateInvalidBody')}
                    />
                )
            ) : report.isPending ? (
                <TableSkeleton testID="kitchen-order-desk-cash-report-loading" rows={6} />
            ) : failure !== null ? (
                <ErrorState
                    testID="kitchen-order-desk-cash-report-error"
                    title={t('kitchen:ops.cashReport.loadErrorTitle')}
                    failure={failure}
                    onRetry={() => {
                        void report.refetch();
                    }}
                    retrying={report.isFetching}
                />
            ) : rows.length === 0 ? (
                <EmptyState
                    testID="kitchen-order-desk-cash-report-empty"
                    title={t('kitchen:ops.cashReport.emptyTitle')}
                    body={t('kitchen:ops.cashReport.emptyBody')}
                />
            ) : (
                <View className="flex-col gap-loose">
                    <CatalogueList<OrderDeskCashReportRow>
                        testID="kitchen-order-desk-cash-report-table"
                        label={t('kitchen:ops.cashReport.caption')}
                        columns={controls.columns}
                        rows={controls.rows}
                        rowKey={rowTestId}
                        rowActionsLabel={t('kitchen:list.rowActions')}
                    />

                    {/*
                     * The totals, as a panel of labelled pairs rather than a footer row of the list
                     * above. A total per *(method, currency)* is not a column sum: three agents taking
                     * dirhams and one taking dollars produce two totals, not one, and a row across the
                     * bottom would be a shape that could only show one of them. The panel has no
                     * grand-total line to fill, because that would add currencies together.
                     */}
                    <View
                        testID="kitchen-order-desk-cash-report-totals"
                        style={{ maxWidth: TOTALS_MAX_WIDTH }}
                        // The green card: the brand's subtle ground, raised like the figures.
                        className="flex-col rounded-panel border border-brand-100 bg-surface-brand-subtle shadow-elevation-card"
                    >
                        {/* A heading a step above the pairs under it, so it reads as their title. */}
                        <View className="px-snug pb-hair pt-snug">
                            <Text variant="section" tone="brand" accessibilityRole="header">
                                {t('kitchen:ops.cashReport.totalsHeading')}
                            </Text>
                        </View>
                        {totals.map((total) => (
                            <View
                                key={totalKey(total)}
                                className="flex-row items-baseline justify-between gap-snug border-t border-stroke-subtle px-snug py-tight"
                            >
                                {/*
                                 * The method alone, through the shared table the queue and the sale
                                 * wizard read. The currency is not repeated in the label because the
                                 * formatted amount beside it already carries one — two totals for one
                                 * method are told apart by the money, which is the only place the
                                 * distinction is unambiguous.
                                 */}
                                <Text variant="label">
                                    {t(kitchenOrderPaymentMethodKey(total.method))}
                                </Text>
                                <Text
                                    variant="strong"
                                    tone="brand"
                                    className="tabular-nums"
                                    testID={`kitchen-order-desk-cash-report-total-${totalKey(total)}`}
                                >
                                    {formatMoney(formatter, {
                                        amount: total.amountMinorSum,
                                        currency: total.currencyCode,
                                    })}
                                </Text>
                            </View>
                        ))}
                    </View>

                    {/* What came off those takings, one panel down and never netted into them. */}
                    {adjustments.length === 0 ? null : (
                        <View
                            testID="kitchen-order-desk-cash-report-adjustments"
                            style={{ maxWidth: TOTALS_MAX_WIDTH }}
                            className="flex-col rounded-panel border border-stroke-subtle bg-surface-raised shadow-elevation-card"
                        >
                            <View className="px-snug pb-hair pt-snug">
                                <Text variant="section" accessibilityRole="header">
                                    {t('kitchen:ops.cashReport.adjustmentsHeading')}
                                </Text>
                            </View>
                            {adjustments.map((adjustment) => (
                                <View
                                    key={`${adjustment.day}-${adjustment.kind}-${adjustment.displayName ?? ''}-${adjustment.currencyCode}`}
                                    className="flex-row items-baseline justify-between gap-snug border-t border-stroke-subtle px-snug py-tight"
                                >
                                    <Text variant="label">
                                        {[
                                            t(
                                                `kitchen:ops.cashReport.adjustment.${adjustment.kind}`,
                                            ),
                                            adjustment.displayName ?? EM_DASH,
                                            formatter.formatDate(adjustment.day, {
                                                day: 'numeric',
                                                month: 'short',
                                                timeZone: 'UTC',
                                            }),
                                        ].join(t('kitchen:common.listSeparator'))}
                                    </Text>
                                    <Text variant="strong" className="tabular-nums">
                                        {formatMoney(formatter, {
                                            amount: adjustment.amountMinorSum,
                                            currency: adjustment.currencyCode,
                                        })}
                                    </Text>
                                </View>
                            ))}
                        </View>
                    )}
                </View>
            )}
        </Cascade>
    );
}

/** How wide the totals panel may grow. It is a short list of pairs, not a second table. */
const TOTALS_MAX_WIDTH = 620;

/** The longest window the server answers, both ends counted — any calendar month fits. */
const MAX_WINDOW_DAYS = 31;

/**
 * A row's identity, which is all four of its key parts — the day first.
 *
 * One agent legitimately appears three times — cash, counter cash and a transfer — and twice more if
 * the kitchen takes two currencies. Keying on the person alone would collapse rows React must keep
 * apart, and keying on the person and method would collapse exactly the currency distinction the
 * whole shape exists to preserve.
 */
function rowTestId(row: OrderDeskCashReportRow): string {
    return `kitchen-order-desk-cash-${row.day}-${row.confirmedBy}-${row.method}-${row.currencyCode}`;
}

/** The same rule one level up: a total is a method **and** a currency, never a method alone. */
function totalKey(total: OrderDeskCashReportTotal): string {
    return `${total.method}-${total.currencyCode}`;
}
