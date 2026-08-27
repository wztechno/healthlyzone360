import type {
    OrderDeskCashReportRow,
    OrderDeskCashReportTotal,
} from '@healthy360/api-client/contracts';
import {
    Callout,
    Card,
    EmptyState,
    ErrorState,
    Heading,
    Inline,
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

import { Gate } from '../../../access/gate.tsx';
import { toFailure } from '../../../data/hooks.ts';
import { useOrderDeskCashReportQuery } from '../../../data/order-desk-hooks.ts';
import { todayIso } from '../../commerce/dates.ts';
import { formatMoney } from '../../marketplace/format.ts';
import { ORDER_MANAGE_PERMISSION } from '../entity-registry.ts';
import { KitchenPageHeader } from '../kitchen-page-header.tsx';
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

    const columns: readonly TableColumn<OrderDeskCashReportRow>[] = [
        {
            key: 'agent',
            header: t('kitchen:ops.cashReport.columnAgent'),
            rowHeader: true,
            flex: 2,
            render: (row) => (
                <Text
                    variant="bodyStrong"
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
            header: t('kitchen:ops.cashReport.columnMethod'),
            render: (row) => (
                <Text testID={`${rowTestId(row)}-method`}>
                    {t(kitchenOrderPaymentMethodKey(row.method))}
                </Text>
            ),
        },
        {
            key: 'count',
            header: t('kitchen:ops.cashReport.columnCount'),
            numeric: true,
            render: (row) => (
                <Text tone="secondary" testID={`${rowTestId(row)}-count`}>
                    {formatter.formatNumber(row.receiptCount)}
                </Text>
            ),
        },
        {
            key: 'amount',
            header: t('kitchen:ops.cashReport.columnAmount'),
            numeric: true,
            render: (row) => (
                <Text variant="bodyStrong" testID={`${rowTestId(row)}-amount`}>
                    {formatMoney(formatter, {
                        amount: row.amountMinorSum,
                        currency: row.currencyCode,
                    })}
                </Text>
            ),
        },
    ];

    return (
        <Stack space="lg" testID="kitchen-order-desk-cash-report-screen">
            <KitchenPageHeader
                testID="kitchen-order-desk-cash-report-header"
                title={t('kitchen:ops.cashReport.title')}
                subtitle={t('kitchen:ops.cashReport.subtitle')}
                titleTestID="kitchen-order-desk-cash-report-title"
                subtitleTestID="kitchen-order-desk-cash-report-subtitle"
                meta={
                    meta === null ? undefined : (
                        // The day and the clock the server cut on. Printed rather than assumed —
                        // see the file header.
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
                    )
                }
            />

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

            <Card tone="raised" padding="md" testID="kitchen-order-desk-cash-report-toolbar">
                <Inline space="sm" align="end" wrap>
                    <TextInputField
                        testID="kitchen-order-desk-cash-report-date"
                        id="kitchen-order-desk-cash-report-date"
                        label={t('kitchen:ops.cashReport.dateLabel')}
                        hint={t('kitchen:ops.cashReport.dateHint')}
                        value={date}
                        onChangeText={setDate}
                        placeholder="YYYY-MM-DD"
                        className="w-40"
                    />
                </Inline>
            </Card>

            {filters === null ? (
                <Callout
                    testID="kitchen-order-desk-cash-report-date-invalid"
                    tone="info"
                    title={t('kitchen:ops.cashReport.dateInvalidTitle')}
                    body={t('kitchen:ops.cashReport.dateInvalidBody')}
                />
            ) : report.isPending ? (
                <Stack space="sm" testID="kitchen-order-desk-cash-report-loading">
                    {Array.from({ length: 4 }, (_, index) => (
                        <Skeleton key={index} heightClassName="h-10" />
                    ))}
                </Stack>
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
                <Stack space="md">
                    <Table<OrderDeskCashReportRow>
                        testID="kitchen-order-desk-cash-report-table"
                        caption={t('kitchen:ops.cashReport.caption')}
                        captionHidden
                        columns={columns}
                        rows={rows}
                        rowKey={rowTestId}
                    />

                    {/*
                     * The totals, as a list of labelled pairs rather than a footer row of the table
                     * above. Two reasons, and the second is the load-bearing one.
                     *
                     * A footer row would have to sit under the "Agent" column with nothing to put in
                     * it, and `Table` has no footer slot to put it in honestly. And a total per
                     * *(method, currency)* is not a column sum: three agents taking dirhams and one
                     * taking dollars produce two totals, not one, and a row across the bottom would
                     * be a shape that could only show one of them.
                     */}
                    <Stack space="xs" testID="kitchen-order-desk-cash-report-totals">
                        <Heading level={2}>{t('kitchen:ops.cashReport.totalsHeading')}</Heading>
                        <Text
                            variant="caption"
                            tone="secondary"
                            testID="kitchen-order-desk-cash-report-totals-note"
                        >
                            {t('kitchen:ops.cashReport.totalsNote')}
                        </Text>
                        {totals.map((total) => (
                            <Inline
                                key={totalKey(total)}
                                space="sm"
                                align="start"
                                justify="between"
                                wrap
                            >
                                {/*
                                 * The method alone, through the shared table the queue and the sale
                                 * wizard read. The currency is not repeated in the label because the
                                 * formatted amount beside it already carries one — two totals for
                                 * one method are told apart by the money, which is the only place
                                 * the distinction is unambiguous.
                                 */}
                                <Text tone="secondary" variant="caption">
                                    {t(kitchenOrderPaymentMethodKey(total.method))}
                                </Text>
                                <Text
                                    variant="bodyStrong"
                                    testID={`kitchen-order-desk-cash-report-total-${totalKey(total)}`}
                                >
                                    {formatMoney(formatter, {
                                        amount: total.amountMinorSum,
                                        currency: total.currencyCode,
                                    })}
                                </Text>
                            </Inline>
                        ))}
                    </Stack>
                </Stack>
            )}
        </Stack>
    );
}

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
