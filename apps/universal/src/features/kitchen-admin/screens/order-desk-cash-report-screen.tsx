import type {
    OrderDeskCashReportRow,
    OrderDeskCashReportTotal,
} from '@healthy360/api-client/contracts';
import {
    Callout,
    DatePickerButton,
    EmptyState,
    ErrorState,
    Skeleton,
    Stack,
    Text,
} from '@healthy360/design-system';
import { useFormatter } from '@healthy360/i18n';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { Gate } from '../../../access/gate.tsx';
import { toFailure } from '../../../data/hooks.ts';
import { useOrderDeskCashReportQuery } from '../../../data/order-desk-hooks.ts';
import { todayIso } from '../../commerce/dates.ts';
import { formatMoney } from '../../marketplace/format.ts';
import { ORDER_MANAGE_PERMISSION } from '../entity-registry.ts';
import { CatalogueStatCards } from '../catalogue/index.ts';
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
import { ToolbarPanel } from '../catalogue/toolbar-panel.tsx';

/**
 * `/kitchen/order-desk/cash-report` — who took what, on one day.
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
 * ## The day boundary is UTC, and the screen prints it
 *
 * A receipt carries no branch, and the order behind it may carry none either — an organisation-wide
 * delivery zone leaves `branchId` null. So there is no branch clock true of every receipt in the
 * answer, and the server measures the day on UTC: the queue's own organisation-wide convention, the
 * only zone that is not a guess. `meta.timezone` is rendered rather than assumed, because a table of
 * a day's takings that did not say *which* midnight it was cut on is a table implying the reader's
 * own — and a kitchen whose evening runs past UTC midnight will see that evening split across two
 * reports. That is a visible, explicable fact, and it stops being one the moment it is unlabelled.
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
     * `todayIso()` reads the device's clock while the report is cut on UTC, and the two can differ
     * by a day either side of midnight. That is not papered over: the header states the day and the
     * zone the *server* used, so a reader whose "today" and the report's disagree can see that they
     * do rather than wonder why the figures look wrong.
     */
    const [date, setDate] = useState(() => todayIso());

    /**
     * The question, or `null` while the box holds something that is not a date.
     *
     * Memoised because the hook keys on the whole object (query-key shape rule 3) — a fresh literal
     * every render would be a fresh cache entry every render. `null` while `2026-0` is on screen,
     * because asking for it would spend a `422` per keystroke.
     *
     * **No `branchId`.** The endpoint accepts one and this screen sends none, on the queue's own
     * argument: narrowing goes through the order, and an order delivered through an
     * organisation-wide zone carries no branch — so sending the active branch would not scope the
     * report, it would silently drop takings from it. A reconciliation that quietly omitted money is
     * the one failure this screen cannot afford, and an in-screen branch picker belongs to the slice
     * where somebody chooses to narrow and can see that they have.
     */
    const filters = useMemo(() => (isIsoDate(date) ? { date } : null), [date]);

    const report = useOrderDeskCashReportQuery(filters);

    const failure = toFailure(report.error);
    const rows = report.data?.rows ?? [];
    const totals = report.data?.totals ?? [];
    const meta = report.data?.meta ?? null;

    const columns: readonly ControlledColumn<
        OrderDeskCashReportRow,
        CatalogueColumn<OrderDeskCashReportRow>
    >[] = [
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
            align: 'center',
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
            align: 'center',
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
            align: 'center',
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
    const controls = useColumnControls(rows, columns, 'kitchen-order-desk-cash-report-table');

    return (
        <Stack space="md" testID="kitchen-order-desk-cash-report-screen">
            {/*
             * The figures first, and only once there are rows to count — a zero here would claim an
             * answer the screen does not have yet.
             */}
            {filters === null ||
            report.isPending ||
            failure !== null ||
            rows.length === 0 ? null : (
                <CatalogueStatCards
                    testID="kitchen-order-desk-cash-report-figures"
                    cards={[
                        {
                            key: 'receipts',
                            label: t('kitchen:ops.cashReport.kpiReceipts'),
                            value: formatter.formatNumber(
                                rows.reduce((sum, row) => sum + row.receiptCount, 0),
                            ),
                            caption: t('kitchen:ops.cashReport.kpiReceiptsCaption'),
                            mark: 'receipt',
                            tone: 'brand',
                        },
                        {
                            key: 'rows',
                            label: t('kitchen:ops.cashReport.kpiRows'),
                            value: formatter.formatNumber(rows.length),
                            caption: t('kitchen:ops.cashReport.kpiRowsCaption'),
                            mark: 'list',
                        },
                        {
                            key: 'currencies',
                            label: t('kitchen:ops.cashReport.kpiCurrencies'),
                            value: formatter.formatNumber(
                                new Set(totals.map((total) => total.currencyCode)).size,
                            ),
                            caption: t('kitchen:ops.cashReport.kpiCurrenciesCaption'),
                            mark: 'coins',
                        },
                    ]}
                />
            )}

            {/* The day, below the figures, with the column picker at the row's inline end. */}
            <ToolbarPanel
                testID="kitchen-order-desk-cash-report-toolbar"
                end={rows.length === 0 ? undefined : <ColumnPicker {...controls.picker} />}
            >
                <DatePickerButton
                    testID="kitchen-order-desk-cash-report-date"
                    label={t('kitchen:ops.cashReport.dateLabel')}
                    value={date}
                    onChange={setDate}
                />
                {meta === null ? (
                    <Text variant="caption" tone="secondary">
                        {t('kitchen:ops.cashReport.dateHint')}
                    </Text>
                ) : null}
            </ToolbarPanel>

            {filters === null ? (
                <Callout
                    testID="kitchen-order-desk-cash-report-date-invalid"
                    tone="info"
                    title={t('kitchen:ops.cashReport.dateInvalidTitle')}
                    body={t('kitchen:ops.cashReport.dateInvalidBody')}
                />
            ) : report.isPending ? (
                <View testID="kitchen-order-desk-cash-report-loading" className="flex-col">
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
                        <View className="border-t border-stroke-subtle px-snug py-tight">
                            <Text
                                variant="caption"
                                tone="secondary"
                                testID="kitchen-order-desk-cash-report-totals-note"
                            >
                                {t('kitchen:ops.cashReport.totalsNote')}
                            </Text>
                        </View>
                    </View>
                </View>
            )}
        </Stack>
    );
}

/** How wide the totals panel may grow. It is a short list of pairs, not a second table. */
const TOTALS_MAX_WIDTH = 620;

/**
 * A row's identity, which is all three of its key parts.
 *
 * One agent legitimately appears three times — cash, counter cash and a transfer — and twice more if
 * the kitchen takes two currencies. Keying on the person alone would collapse rows React must keep
 * apart, and keying on the person and method would collapse exactly the currency distinction the
 * whole shape exists to preserve.
 */
function rowTestId(row: OrderDeskCashReportRow): string {
    return `kitchen-order-desk-cash-${row.confirmedBy}-${row.method}-${row.currencyCode}`;
}

/** The same rule one level up: a total is a method **and** a currency, never a method alone. */
function totalKey(total: OrderDeskCashReportTotal): string {
    return `${total.method}-${total.currencyCode}`;
}

/** `YYYY-MM-DD`, and a date that exists. `2026-02-31` parses and is not a day. */
function isIsoDate(value: string): boolean {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    const parsed = new Date(`${value}T00:00:00Z`);
    return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}
