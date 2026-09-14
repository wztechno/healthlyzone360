import type {
    OrderDeskCashReportRow,
    OrderDeskCashReportTotal,
} from '@healthy360/api-client/contracts';
import {
    Callout,
    DataList,
    EmptyState,
    ErrorState,
    Skeleton,
    Stack,
    Text,
    TextInputField,
} from '@healthy360/design-system';
import type { DataListColumn } from '@healthy360/design-system';
import { useFormatter } from '@healthy360/i18n';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { Gate } from '../../../access/gate.tsx';
import { toFailure } from '../../../data/hooks.ts';
import { useOrderDeskCashReportQuery } from '../../../data/order-desk-hooks.ts';
import { todayIso } from '../../commerce/dates.ts';
import { formatMoney } from '../../marketplace/format.ts';
import { CataloguePageHeader, CatalogueSummaryBar } from '../catalogue/index.ts';
import { ORDER_MANAGE_PERMISSION } from '../entity-registry.ts';
import { kitchenOrderPaymentMethodKey } from '../ops-format.ts';

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

    const columns: readonly DataListColumn<OrderDeskCashReportRow>[] = [
        {
            key: 'agent',
            label: t('kitchen:ops.cashReport.columnAgent'),
            width: 180,
            priority: 100,
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
            label: t('kitchen:ops.cashReport.columnMethod'),
            width: 160,
            priority: 90,
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
            align: 'end',
            render: (row) => (
                <Text variant="mono" tone="secondary" testID={`${rowTestId(row)}-count`}>
                    {formatter.formatNumber(row.receiptCount)}
                </Text>
            ),
        },
        {
            key: 'amount',
            label: t('kitchen:ops.cashReport.columnAmount'),
            width: 140,
            priority: 95,
            align: 'end',
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

    return (
        <Stack space="md" testID="kitchen-order-desk-cash-report-screen">
            <CataloguePageHeader
                testID="kitchen-order-desk-cash-report-header"
                title={t('kitchen:ops.cashReport.title')}
                titleTestID="kitchen-order-desk-cash-report-title"
            />

            <CatalogueSummaryBar
                testID="kitchen-order-desk-cash-report-subtitle"
                segments={[
                    t('kitchen:ops.cashReport.subtitle'),
                    ...(rows.length === 0
                        ? []
                        : [
                              t('kitchen:ops.cashReport.summaryRows', { count: rows.length }),
                              t('kitchen:ops.cashReport.summaryCurrencies', {
                                  count: new Set(totals.map((total) => total.currencyCode)).size,
                              }),
                          ]),
                ]}
            />

            {/* One 28px row: the day, and the clock it was cut on. */}
            <View
                testID="kitchen-order-desk-cash-report-toolbar"
                className="min-h-control-sm flex-row flex-wrap items-center gap-tight"
            >
                <View style={{ width: DATE_WIDTH }}>
                    <TextInputField
                        testID="kitchen-order-desk-cash-report-date"
                        id="kitchen-order-desk-cash-report-date"
                        label={t('kitchen:ops.cashReport.dateLabel')}
                        labelHidden
                        size="sm"
                        value={date}
                        onChangeText={setDate}
                        placeholder="YYYY-MM-DD"
                    />
                </View>
                {meta === null ? (
                    <Text variant="caption" tone="secondary">
                        {t('kitchen:ops.cashReport.dateHint')}
                    </Text>
                ) : (
                    // The day and the clock the server cut on. Printed rather than assumed — see
                    // the file header.
                    <Text
                        variant="caption"
                        tone="secondary"
                        testID="kitchen-order-desk-cash-report-measured-on"
                    >
                        {t('kitchen:ops.cashReport.measuredOn', {
                            date: formatter.formatDate(meta.date, { dateStyle: 'medium' }),
                            timezone: meta.timezone,
                        })}
                    </Text>
                )}
            </View>

            {/*
             * Stated once, at the top, and not as a warning tone: nothing here is wrong. It is the
             * limit of what the figures below mean, and a manager who took this table for a drawer
             * reconciliation would be trusting it further than it goes.
             */}
            <Callout
                testID="kitchen-order-desk-cash-report-scope"
                tone="info"
                role="status"
                title={t('kitchen:ops.cashReport.scopeTitle')}
                body={t('kitchen:ops.cashReport.scopeBody')}
            />

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
                    <DataList<OrderDeskCashReportRow>
                        testID="kitchen-order-desk-cash-report-table"
                        label={t('kitchen:ops.cashReport.caption')}
                        columns={columns}
                        rows={rows}
                        rowKey={rowTestId}
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
                        className="flex-col rounded border border-stroke bg-surface-sunken"
                    >
                        <View className="px-snug pb-hair pt-tight">
                            <Text variant="micro" tone="secondary" accessibilityRole="header">
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

/** The date field's width — wide enough for `YYYY-MM-DD`. A style: there is no token for it. */
const DATE_WIDTH = 140;

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
