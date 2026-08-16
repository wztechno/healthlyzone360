import type {
    KitchenOrder,
    KitchenOrderLine,
    OrderDeskQueueFilters,
    OrderDeskQueueRow,
    OrderDeskQueueStatus,
    OrderDeskWindow,
} from '@healthy360/api-client/contracts';
import { ORDER_DESK_QUEUE_STATUSES, ORDER_DESK_WINDOWS } from '@healthy360/api-client/contracts';
import {
    Badge,
    Button,
    Callout,
    Card,
    Drawer,
    EmptyState,
    ErrorState,
    FilterChip,
    Heading,
    Icon,
    Inline,
    SegmentedControl,
    Skeleton,
    Stack,
    Table,
    Text,
    TextInputField,
    useToast,
} from '@healthy360/design-system';
import type { TableColumn } from '@healthy360/design-system';
import { useFormatter } from '@healthy360/i18n';
import { useRouter } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { Gate, useCan } from '../../../access/gate.tsx';
import { toFailure } from '../../../data/hooks.ts';
import {
    useConfirmOrderMutation,
    useFulfilOrderMutation,
    useKitchenOrderQuery,
} from '../../../data/kitchen-orders-hooks.ts';
import { useOrderDeskQueueQuery } from '../../../data/order-desk-hooks.ts';
import { useOnlineStatus } from '../../../online/online-status.tsx';
import { formatMoney } from '../../marketplace/format.ts';
import { ORDER_MANAGE_PERMISSION, ORDER_VIEW_PERMISSION } from '../entity-registry.ts';
import { humaniseCode } from '../format.ts';
import {
    canConfirmKitchenOrder,
    canFulfilKitchenOrder,
    deliveryJobStatusKey,
    deliveryJobTrackingKey,
    kitchenOrderFulfilmentTypeKey,
    kitchenOrderPaymentMethodKey,
    kitchenOrderStatusKey,
    kitchenOrderStatusTone,
    orderDeskDeliveryState,
    orderDeskDeliveryStateKey,
    orderDeskDeliveryStateTone,
    orderDeskDueTone,
    orderDeskRowTestId,
} from '../ops-format.ts';

/**
 * `/kitchen/order-desk` — the open order book in the order somebody at a desk has to work it.
 *
 * ## Why this is a second screen over the same orders
 *
 * `/kitchen/orders` is the *book*: every order, newest first, paged, with the detail panel that
 * confirms, fulfils and cancels. This is the *queue*, and the difference is the sort. The endpoint
 * answers rows ordered by a `due_at` computed in SQL from the requested day, the delivery window's
 * opening hour and the branch's clock — a sort no client can reproduce and no cursor can page
 * through. So the queue is **bounded rather than paged** (see the truncation callout below) and it
 * carries **no sortable columns**: there is no server-sort plumbing anywhere in this application,
 * and a header that reordered two hundred rows locally would quietly answer a different question
 * from the one the screen exists to answer.
 *
 * ## The drawer re-reads the order it was opened from — and keeps the row it was opened from
 *
 * Two reads, and each answers something the other cannot. The **detail** read
 * (`useKitchenOrderQuery`) is what the transitions send `If-Match` from: the version a queue row was
 * rendered from can be a poll or two old, and sending it would earn a `resource.conflict` the person
 * did nothing to deserve. This is `orders-screen.tsx`'s rule, and the write responses are seeded
 * straight back into that entry by the hook, which is what lets "Fulfil" fire immediately after
 * "Confirm" with a version the server will accept.
 *
 * The **row** is kept because the detail endpoint does not serve a delivery job or a payment
 * position at all — those live only on the queue's own row. So the drawer holds the row it was
 * opened from and re-reads it out of the live queue on every poll, falling back to the last known
 * copy when the order leaves the queue (which is exactly what fulfilling it does). A drawer that
 * dropped its delivery block the instant the agent closed the order would look like a fault.
 *
 * ## Closing is offered on evidence, not gated on it
 *
 * "Fulfil" means *the customer has it*, and on a delivery the only evidence of that is the driver's
 * own stamp — which arrives on the job's tracking axis, minutes after it happened, and sometimes not
 * at all when a phone is in a pocket in a lift. So the desk is **not blocked** on
 * `tracking_status === 'delivered'`: an agent on the telephone to a customer who has the food in
 * their hands knows something the board does not. What the drawer does instead is put the tracking
 * status *beside* the button, so the close is made informed rather than blind.
 *
 * A counter sale never reaches this drawer needing anything: it arrives already `fulfilled` and
 * therefore is not in the open queue at all.
 *
 * ## The delivery column, and the assignment that is not here
 *
 * The column reads {@link orderDeskDeliveryState} — five states, four of which this queue meets
 * often (see `ops-format.ts` for what each one means and why none collapses into another).
 *
 * **There is no Assign control on this screen, and its absence is a wire gap rather than a
 * decision.** `POST /delivery/jobs/{job}/assign` takes a `driver_user_id` that must name an active
 * member of the organisation, and **no endpoint on this platform lists an organisation's members** —
 * not `/me/memberships` (the caller's own), not the invitations index (offers by email, gated behind
 * `membership.view_organisation`, and blind to anybody who joined another way). So a picker here
 * could only offer a free-text box for a UUID, which is not a control anybody can use correctly and
 * is a way to hand tonight's run to a typo. `orderDesk.assignDeliveryJob` is implemented and tested
 * on the client and is waiting for a directory to point at.
 *
 * ## The queue is organisation-wide, and that is a decision rather than an omission
 *
 * The endpoint takes a `branch_id` and this screen does not send one. Two things follow from that
 * parameter and only one of them is wanted here. It narrows the queue to orders *attributed* to a
 * branch — and an order delivered through an organisation-wide zone carries `branch_id: NULL`, as
 * the live book's real orders do, so sending the active branch would not scope the desk, it would
 * delete unattributed work from a screen whose whole job is that nothing goes unnoticed
 * (`features/kds/kds-board.ts` documents the same trap at length). It also names the clock `today`
 * is read on, and *that* is worth having — which is why the header states the day and the zone the
 * server actually used (`meta.today`, `meta.timezone`, echoed precisely because the client did not
 * choose them). Unnamed, the boundary is UTC. A branch picker is a later slice's, where somebody
 * chooses to narrow and can see that they have.
 *
 * ## Ageing is the kitchen display's scale, measured from a different instant
 *
 * `orderDeskDueTone` is `ticketAgeTone` — amber at fifteen minutes, red at thirty — against minutes
 * *past due*, clamped at zero so an order that is early is simply neutral. Colour never carries it
 * alone: the badge's label is the interval itself, spelled by the locale's own relative-time
 * formatter, so "in 3 hours" and "2 hours ago" read the same to somebody who cannot separate amber
 * from red. `ops-format.ts` holds the argument.
 *
 * ## The customer column must not look broken to somebody who may not read it
 *
 * `row.customer` is **absent** — not null — for a caller without
 * `order.view_customer_contact_organisation`, and `displayName` is null for an anonymised account
 * that the caller *may* read. Both render an em dash, deliberately: the screen has nothing to say in
 * either case, and a "you are not permitted" cell on every row of a queue somebody works all day
 * would be noise about the reader rather than information about the order. The distinction is kept
 * where it is useful — in the contract and the mapper — rather than shown here.
 */

/**
 * Poll cadence for the queue and its clock.
 *
 * Its own constant rather than an import of `KDS_POLL_MS`: that one lives in the kitchen display's
 * *screen* module, and importing it would pull the whole board — its queries, its mutations, its
 * tree — into this slice's dependency graph to read a number. Fifteen seconds for the same reason
 * the board picked it: short enough that an order reaches the desk before the customer wonders, long
 * enough that a tablet left on all day is not making six requests a minute.
 */
export const ORDER_DESK_POLL_MS = 15_000;

const WINDOW_LABEL_KEYS: Readonly<Record<OrderDeskWindow, string>> = {
    today: 'kitchen:desk.window.today',
    overdue: 'kitchen:desk.window.overdue',
    next_7: 'kitchen:desk.window.next7',
};

/**
 * What a cell with nothing to say renders as — the same character the cost report, the purchases
 * ledger and the exception queue use, kept as a named constant here because this screen has two
 * quite different reasons to reach for it and the name is what makes them read as one rule.
 */
const EM_DASH = '—';

/** One labelled fact in the drawer. Never a table: these are pairs, not a dataset. */
function DetailRow({
    testID,
    label,
    value,
}: {
    readonly testID: string;
    readonly label: string;
    readonly value: string;
}) {
    return (
        <Inline space="sm" align="start" justify="between" wrap>
            <Text tone="secondary" variant="caption">
                {label}
            </Text>
            <Text testID={testID}>{value}</Text>
        </Inline>
    );
}

export function OrderDeskScreen() {
    return (
        <Gate
            area="kitchen"
            requirement={{ allOf: [ORDER_VIEW_PERMISSION] }}
            testID="kitchen-order-desk"
        >
            <OrderDeskQueueList />
        </Gate>
    );
}

/**
 * A clock that advances on the poll cadence.
 *
 * The due badge is the one thing on this screen that changes without the data changing, so something
 * has to move. It ticks with the poll rather than every second, for the reason the kitchen display's
 * own clock does: the label is minutes and hours, and re-rendering two hundred rows once a second to
 * say the same words is work a counter tablet pays for in battery and heat.
 *
 * Written here rather than imported from `kds-tickets-screen.tsx`: that module is a *screen*, and
 * importing a twelve-line hook out of it would pull the kitchen display, its queries and its
 * mutations into this slice's dependency graph. The write happens in the timer callback, never in
 * the effect body — same rule as `online/online-status.tsx`.
 */
function useTickingNow(intervalMs: number, running: boolean): Date {
    const [now, setNow] = useState(() => new Date());

    useEffect(() => {
        if (!running) return;
        const timer = setInterval(() => {
            setNow(new Date());
        }, intervalMs);
        return () => {
            clearInterval(timer);
        };
    }, [intervalMs, running]);

    return now;
}

function OrderDeskQueueList() {
    const { t } = useTranslation();
    const formatter = useFormatter();
    const router = useRouter();
    const toast = useToast();
    const { online } = useOnlineStatus();
    const canManage = useCan(ORDER_MANAGE_PERMISSION);

    const [deskWindow, setDeskWindow] = useState<OrderDeskWindow>('today');
    const [statuses, setStatuses] = useState<readonly OrderDeskQueueStatus[]>([]);
    const [query, setQuery] = useState('');
    /**
     * The row the drawer was opened from, held rather than looked up by identifier.
     *
     * Fulfilling an order takes it out of the open queue, so a `rows.find(…)` alone would empty the
     * drawer at the moment of success. This is the last known copy; {@link selectedRow} prefers the
     * live one whenever the queue still has it.
     */
    const [selected, setSelected] = useState<OrderDeskQueueRow | null>(null);

    const now = useTickingNow(ORDER_DESK_POLL_MS, online);
    const trimmed = query.trim();

    /**
     * One object, memoised, because it *is* the query key (query-key shape rule 3). An equal-but-new
     * object on every render would make every render a different cache entry — a refetch per
     * keystroke of a list the person is reading.
     */
    const filters = useMemo<OrderDeskQueueFilters>(
        () => ({
            window: deskWindow,
            ...(statuses.length === 0 ? {} : { statuses }),
            ...(trimmed === '' ? {} : { query: trimmed }),
        }),
        [deskWindow, statuses, trimmed],
    );

    const queue = useOrderDeskQueueQuery(filters, true, {
        // Offline, the interval stops: an interval firing into a dead network is retries nobody
        // asked for. Same gate as the kitchen display's.
        refetchInterval: online ? ORDER_DESK_POLL_MS : false,
    });

    /**
     * Memoised because {@link selectedRow} depends on it: `?? []` would mint a fresh empty array on
     * every render, and the drawer would re-derive its row on every tick of the due clock.
     */
    const rows = useMemo<readonly OrderDeskQueueRow[]>(() => queue.data?.rows ?? [], [queue.data]);
    const meta = queue.data?.meta ?? null;
    const failure = toFailure(queue.error);
    const filtered = trimmed !== '' || statuses.length > 0 || deskWindow !== 'today';

    /**
     * The open row as the queue currently has it, or the copy the drawer was opened with.
     *
     * The fresh one while the order is still open — so a poll that lands a driver on the job updates
     * the drawer under the agent's eyes — and the stale one once the order leaves the queue, which
     * is what fulfilling it does. Neither is a lock version: the transitions read the detail for
     * that.
     */
    const selectedRow = useMemo<OrderDeskQueueRow | null>(() => {
        if (selected === null) return null;
        return rows.find((row) => row.id === selected.id) ?? selected;
    }, [rows, selected]);

    const detail = useKitchenOrderQuery(selected?.id ?? null);
    const confirmOrder = useConfirmOrderMutation();
    const fulfilOrder = useFulfilOrderMutation();

    const order = detail.data ?? null;
    const detailFailure = toFailure(detail.error);
    const actionPending = confirmOrder.isPending || fulfilOrder.isPending;
    const actionFailure = toFailure(confirmOrder.error) ?? toFailure(fulfilOrder.error);
    const isConflict = actionFailure?.code === 'resource.conflict';

    function toggleStatus(status: OrderDeskQueueStatus, selected: boolean) {
        setStatuses((current) =>
            selected ? [...current, status] : current.filter((entry) => entry !== status),
        );
    }

    function clearFilters() {
        setDeskWindow('today');
        setStatuses([]);
        setQuery('');
    }

    function clearActionState() {
        confirmOrder.reset();
        fulfilOrder.reset();
    }

    function openDetail(row: OrderDeskQueueRow) {
        clearActionState();
        setSelected(row);
    }

    function closeDetail() {
        setSelected(null);
        clearActionState();
    }

    /**
     * Confirm or close, with the version the **detail** read answered.
     *
     * Never `selectedRow.lockVersion`: the row was rendered from a poll that may be fifteen seconds
     * old, and the point of re-reading the order is to hold a validator the server will still
     * accept.
     */
    function transition(action: 'confirm' | 'fulfil') {
        if (order === null) return;
        const request = { id: order.id, lockVersion: order.lockVersion };
        const onSuccess = (next: KitchenOrder) => {
            toast.show({
                testID: `kitchen-order-desk-${action}ed-toast`,
                tone: 'success',
                message: t(
                    action === 'confirm'
                        ? 'kitchen:ops.orders.confirmedToast'
                        : 'kitchen:ops.orders.fulfilledToast',
                    { number: next.orderNumber },
                ),
            });
        };
        if (action === 'confirm') confirmOrder.mutate(request, { onSuccess });
        else fulfilOrder.mutate(request, { onSuccess });
    }

    const columns: readonly TableColumn<OrderDeskQueueRow>[] = [
        {
            key: 'number',
            header: t('kitchen:desk.columnNumber'),
            rowHeader: true,
            flex: 2,
            render: (row) => (
                <Text variant="bodyStrong" testID={`${orderDeskRowTestId(String(row.id))}-number`}>
                    {row.orderNumber}
                </Text>
            ),
        },
        {
            key: 'customer',
            header: t('kitchen:desk.columnCustomer'),
            flex: 2,
            render: (row) => {
                // Absent block and null name are one cell here on purpose — see the file header.
                const name = row.customer?.displayName ?? null;
                const phone = row.customer?.phone ?? null;
                return (
                    <Stack space="none">
                        <Text
                            testID={`${orderDeskRowTestId(String(row.id))}-customer`}
                            {...(name === null
                                ? { accessibilityLabel: t('kitchen:desk.a11y.noCustomerName') }
                                : {})}
                        >
                            {name ?? EM_DASH}
                        </Text>
                        {phone === null ? null : (
                            <Text
                                variant="caption"
                                tone="secondary"
                                testID={`${orderDeskRowTestId(String(row.id))}-customer-phone`}
                            >
                                {phone}
                            </Text>
                        )}
                    </Stack>
                );
            },
        },
        {
            key: 'due',
            header: t('kitchen:desk.columnDue'),
            flex: 2,
            render: (row) => (
                <Stack space="none">
                    <Text testID={`${orderDeskRowTestId(String(row.id))}-due`}>
                        {formatter.formatDate(row.dueAt, { timeStyle: 'short' })}
                    </Text>
                    <Badge
                        testID={`${orderDeskRowTestId(String(row.id))}-due-age`}
                        tone={orderDeskDueTone(row.dueAt, now)}
                        label={formatter.formatRelativeTime(row.dueAt, now)}
                    />
                </Stack>
            ),
        },
        {
            key: 'slot',
            header: t('kitchen:desk.columnSlot'),
            render: (row) => (
                <Text tone="secondary" testID={`${orderDeskRowTestId(String(row.id))}-slot`}>
                    {row.delivery.windowCode === null
                        ? t('kitchen:desk.noSlot')
                        : humaniseCode(row.delivery.windowCode)}
                </Text>
            ),
        },
        {
            key: 'status',
            header: t('kitchen:desk.columnStatus'),
            render: (row) => (
                <Badge
                    testID={`${orderDeskRowTestId(String(row.id))}-status`}
                    tone={kitchenOrderStatusTone(row.status)}
                    label={t(kitchenOrderStatusKey(row.status))}
                />
            ),
        },
        {
            key: 'delivery',
            header: t('kitchen:desk.columnDelivery'),
            flex: 2,
            render: (row) => {
                const state = orderDeskDeliveryState(row);
                const testID = `${orderDeskRowTestId(String(row.id))}-delivery`;

                // A pickup or a counter sale is never driven anywhere, so the cell has nothing to
                // say — the same em dash every other "nothing here" cell in this workspace uses,
                // rather than a badge announcing the absence of a thing that was never coming.
                if (state === 'not_delivered') {
                    return (
                        <Text
                            tone="secondary"
                            testID={testID}
                            accessibilityLabel={t(
                                'kitchen:desk.a11y.noDeliveryRun',
                                // The type is what makes the dash meaningful to somebody who cannot
                                // see the column beside it.
                                { type: t(kitchenOrderFulfilmentTypeKey(row.fulfilmentType)) },
                            )}
                        >
                            {EM_DASH}
                        </Text>
                    );
                }

                return (
                    <Stack space="none" testID={testID}>
                        <Badge
                            testID={`${testID}-state`}
                            tone={orderDeskDeliveryStateTone(state)}
                            label={t(orderDeskDeliveryStateKey(state))}
                        />
                        {/*
                         * The tracking axis, and only when there is a run to have one. It is what
                         * the *customer* has been told, which is a different fact from the dispatch
                         * state above it and the one an agent quotes on the telephone.
                         */}
                        {row.deliveryJob === null ? null : (
                            <Text variant="caption" tone="secondary" testID={`${testID}-tracking`}>
                                {t(deliveryJobTrackingKey(row.deliveryJob.trackingStatus))}
                            </Text>
                        )}
                    </Stack>
                );
            },
        },
        {
            key: 'payment',
            header: t('kitchen:desk.columnPayment'),
            flex: 2,
            render: (row) => {
                const testID = `${orderDeskRowTestId(String(row.id))}-payment`;
                return (
                    <Stack space="none" testID={testID}>
                        {/*
                         * The order's *intended* method, which is what an agent asks the customer
                         * for — read before any money arrives, so it is the leading line.
                         */}
                        <Text testID={`${testID}-method`}>
                            {t(kitchenOrderPaymentMethodKey(row.payment.method))}
                        </Text>
                        {/*
                         * "Receipted", never "paid". The platform holds no proof that money exists,
                         * only that somebody wrote down that it arrived — and the outstanding case
                         * shows the *shortfall* rather than a bare "no", because part-payments are
                         * ordinary and the number is what the agent has to collect.
                         */}
                        {row.payment.receipted ? (
                            <Badge
                                testID={`${testID}-state`}
                                tone="success"
                                label={t('kitchen:desk.payment.receipted')}
                            />
                        ) : (
                            <Text
                                variant="caption"
                                tone="secondary"
                                testID={`${testID}-outstanding`}
                            >
                                {t('kitchen:desk.payment.outstanding', {
                                    amount: formatMoney(formatter, {
                                        amount: row.totalMinor - row.payment.receivedMinor,
                                        currency: row.currencyCode,
                                    }),
                                })}
                            </Text>
                        )}
                    </Stack>
                );
            },
        },
        {
            key: 'total',
            header: t('kitchen:desk.columnTotal'),
            numeric: true,
            render: (row) => (
                <Text variant="bodyStrong" testID={`${orderDeskRowTestId(String(row.id))}-total`}>
                    {formatMoney(formatter, { amount: row.totalMinor, currency: row.currencyCode })}
                </Text>
            ),
        },
    ];

    const lineColumns: readonly TableColumn<KitchenOrderLine>[] = [
        {
            key: 'name',
            header: t('kitchen:ops.orders.linesHeading'),
            rowHeader: true,
            flex: 2,
            render: (line) => (
                <Stack space="none">
                    <Text variant="bodyStrong">{line.nameEn}</Text>
                    {line.variantLabel === null ? null : (
                        <Text variant="caption" tone="secondary">
                            {line.variantLabel}
                        </Text>
                    )}
                </Stack>
            ),
        },
        {
            key: 'quantity',
            header: t('kitchen:ops.orders.lineQuantity'),
            numeric: true,
            render: (line) => <Text>{formatter.formatNumber(Number(line.quantity))}</Text>,
        },
        {
            key: 'lineTotal',
            header: t('kitchen:ops.orders.lineTotal'),
            numeric: true,
            render: (line) => (
                <Text>
                    {formatMoney(formatter, {
                        amount: line.lineTotalMinor,
                        currency: line.currencyCode,
                    })}
                </Text>
            ),
        },
    ];

    return (
        <Stack space="lg" testID="kitchen-order-desk-screen">
            <Stack space="xs">
                <Heading level={1} testID="kitchen-order-desk-title">
                    {t('kitchen:desk.title')}
                </Heading>
                <Text tone="secondary" testID="kitchen-order-desk-subtitle">
                    {t('kitchen:desk.subtitle')}
                </Text>
                {meta === null ? null : (
                    // The day and the clock the server sorted against. Echoed by the endpoint
                    // because the screen did not choose them and cannot derive them — and with no
                    // branch named, the boundary is UTC rather than this kitchen's local midnight.
                    <Text
                        variant="caption"
                        tone="secondary"
                        testID="kitchen-order-desk-measured-on"
                    >
                        {t('kitchen:desk.measuredOn', {
                            date: formatter.formatDate(meta.today, { dateStyle: 'medium' }),
                            timezone: meta.timezone,
                        })}
                    </Text>
                )}
            </Stack>

            <Card tone="raised" padding="md" testID="kitchen-order-desk-toolbar">
                <Stack space="sm">
                    {/*
                     * The queue's primary action, and its first: this screen had none, because
                     * until the desk could sell there was nothing for one to do. It sits at the top
                     * of the toolbar rather than beside the filters — starting a sale is not a way
                     * of narrowing the queue, and a customer at the counter is not waiting for
                     * somebody to scroll.
                     *
                     * A `Link`-wrapped `Button` is not the house pattern here; the router push is,
                     * because the surrounding surfaces navigate that way and a nested anchor around
                     * a button is the nested-interactive trap the basket is built to avoid.
                     */}
                    <Inline space="sm" wrap testID="kitchen-order-desk-actions">
                        <Button
                            testID="kitchen-order-desk-new-sale"
                            label={t('kitchen:desk.newSale')}
                            onPress={() => {
                                router.push('/kitchen/order-desk/sale');
                            }}
                        />
                    </Inline>

                    <SegmentedControl<OrderDeskWindow>
                        testID="kitchen-order-desk-window"
                        label={t('kitchen:desk.windowLabel')}
                        block
                        value={deskWindow}
                        onChange={setDeskWindow}
                        items={ORDER_DESK_WINDOWS.map((candidate) => ({
                            value: candidate,
                            label: t(WINDOW_LABEL_KEYS[candidate]),
                            testID: `kitchen-order-desk-window-${candidate}`,
                        }))}
                    />

                    <TextInputField
                        testID="kitchen-order-desk-search"
                        id="kitchen-order-desk-search"
                        label={t('kitchen:desk.searchLabel')}
                        placeholder={t('kitchen:desk.searchPlaceholder')}
                        hint={t('kitchen:desk.searchHint')}
                        value={query}
                        onChangeText={setQuery}
                        autoCapitalize="none"
                        autoCorrect={false}
                        inputMode="search"
                        returnKeyType="search"
                        trailing={<Icon name="search" />}
                    />

                    <Stack space="xs">
                        <Text variant="label" testID="kitchen-order-desk-status-label">
                            {t('kitchen:desk.statusLabel')}
                        </Text>
                        {/*
                         * Chips rather than a segmented control: the two open statuses are a
                         * *subset* filter — a desk agent watching for unconfirmed work wants
                         * `placed` alone, and neither selected means both, which a single-choice
                         * control cannot say without inventing an "All" value the wire does not
                         * have.
                         */}
                        <Inline space="xs" wrap testID="kitchen-order-desk-status">
                            {ORDER_DESK_QUEUE_STATUSES.map((candidate) => (
                                <FilterChip
                                    key={candidate}
                                    testID={`kitchen-order-desk-status-${candidate}`}
                                    label={t(kitchenOrderStatusKey(candidate))}
                                    selected={statuses.includes(candidate)}
                                    onChange={(selected) => {
                                        toggleStatus(candidate, selected);
                                    }}
                                />
                            ))}
                        </Inline>
                    </Stack>

                    {meta === null ? null : (
                        <Text
                            testID="kitchen-order-desk-result-summary"
                            role="status"
                            aria-live="polite"
                            variant="label"
                        >
                            {t('kitchen:toolbar.resultCount', { count: meta.count })}
                        </Text>
                    )}
                </Stack>
            </Card>

            {queue.isPending ? (
                <Stack space="sm" testID="kitchen-order-desk-loading">
                    {Array.from({ length: 5 }, (_, index) => (
                        <Card key={index} padding="md">
                            <Stack space="xs">
                                <Skeleton
                                    testID={`kitchen-order-desk-skeleton-${String(index + 1)}`}
                                    heightClassName="h-5"
                                />
                                <Skeleton heightClassName="h-4" widthClassName="w-1/2" />
                            </Stack>
                        </Card>
                    ))}
                </Stack>
            ) : failure !== null ? (
                <ErrorState
                    testID="kitchen-order-desk-error"
                    title={t('kitchen:desk.loadErrorTitle')}
                    failure={failure}
                    onRetry={() => {
                        void queue.refetch();
                    }}
                    retrying={queue.isFetching}
                />
            ) : rows.length === 0 ? (
                <EmptyState
                    testID="kitchen-order-desk-empty"
                    title={t(
                        filtered ? 'kitchen:desk.filteredEmptyTitle' : 'kitchen:desk.emptyTitle',
                    )}
                    body={t(filtered ? 'kitchen:desk.filteredEmptyBody' : 'kitchen:desk.emptyBody')}
                    actions={
                        filtered ? (
                            <Button
                                testID="kitchen-order-desk-clear"
                                variant="secondary"
                                label={t('kitchen:desk.clearFilters')}
                                onPress={clearFilters}
                            />
                        ) : undefined
                    }
                />
            ) : (
                <Stack space="sm">
                    {meta?.truncated === true ? (
                        // A silent truncation would hide exactly the backlog this queue exists to
                        // surface, and there is no second page to offer instead — so the cap is
                        // stated, with the three ways to get under it.
                        <Callout
                            testID="kitchen-order-desk-truncated"
                            tone="info"
                            role="status"
                            title={t('kitchen:desk.truncatedTitle', { limit: meta.limit })}
                            body={t('kitchen:desk.truncatedBody')}
                        />
                    ) : null}

                    <Table<OrderDeskQueueRow>
                        testID="kitchen-order-desk-table"
                        caption={t('kitchen:desk.caption')}
                        captionHidden
                        columns={columns}
                        rows={rows}
                        rowKey={(row) => String(row.id)}
                        rowAction={{
                            header: t('kitchen:desk.columnActions'),
                            render: (row) => (
                                <Button
                                    testID={`${orderDeskRowTestId(String(row.id))}-open`}
                                    size="sm"
                                    variant="secondary"
                                    label={t('kitchen:desk.open')}
                                    onPress={() => {
                                        openDetail(row);
                                    }}
                                />
                            ),
                        }}
                    />
                </Stack>
            )}

            <Drawer
                testID="kitchen-order-desk-detail"
                placement="end"
                open={selected !== null}
                onClose={closeDetail}
                title={
                    selectedRow === null
                        ? t('kitchen:desk.title')
                        : t('kitchen:ops.orders.detailTitle', { number: selectedRow.orderNumber })
                }
                className="w-[520px]"
                footer={
                    order === null || !canManage ? undefined : (
                        <Inline space="sm" wrap justify="end" align="center">
                            {/*
                             * The driver's own axis, beside the button that closes the order rather
                             * than instead of it. The desk is not blocked on a delivery stamp — see
                             * the file header — so this is what makes the close an informed one.
                             */}
                            {selectedRow?.deliveryJob == null ||
                            !canFulfilKitchenOrder(order.status) ? null : (
                                <Text
                                    variant="caption"
                                    tone="secondary"
                                    testID="kitchen-order-desk-detail-fulfil-tracking"
                                >
                                    {t(
                                        deliveryJobTrackingKey(
                                            selectedRow.deliveryJob.trackingStatus,
                                        ),
                                    )}
                                </Text>
                            )}
                            {canConfirmKitchenOrder(order.status) ? (
                                <Button
                                    testID="kitchen-order-desk-detail-confirm"
                                    label={t('kitchen:ops.orders.confirm')}
                                    loading={confirmOrder.isPending}
                                    disabled={actionPending}
                                    onPress={() => {
                                        transition('confirm');
                                    }}
                                />
                            ) : null}
                            {canFulfilKitchenOrder(order.status) ? (
                                <Button
                                    testID="kitchen-order-desk-detail-fulfil"
                                    label={t('kitchen:ops.orders.fulfil')}
                                    loading={fulfilOrder.isPending}
                                    disabled={actionPending}
                                    onPress={() => {
                                        transition('fulfil');
                                    }}
                                />
                            ) : null}
                        </Inline>
                    )
                }
            >
                {detail.isPending ? (
                    <Skeleton testID="kitchen-order-desk-detail-loading" heightClassName="h-40" />
                ) : detailFailure !== null ? (
                    <ErrorState
                        testID="kitchen-order-desk-detail-error"
                        title={t('kitchen:ops.orders.detailLoadErrorTitle')}
                        failure={detailFailure}
                        onRetry={() => {
                            void detail.refetch();
                        }}
                        retrying={detail.isFetching}
                    />
                ) : order === null ? null : (
                    <Stack space="lg" testID="kitchen-order-desk-detail-body">
                        <Inline space="sm" align="center" wrap>
                            <Badge
                                testID="kitchen-order-desk-detail-status"
                                tone={kitchenOrderStatusTone(order.status)}
                                label={t(kitchenOrderStatusKey(order.status))}
                            />
                            <Badge
                                testID="kitchen-order-desk-detail-type"
                                tone="neutral"
                                icon={null}
                                label={t(kitchenOrderFulfilmentTypeKey(order.fulfilmentType))}
                            />
                        </Inline>

                        {actionFailure === null ? null : isConflict ? (
                            // Somebody else moved this order. The remedy is to re-read and show
                            // what actually happened — never a silent retry, which would resolve
                            // the race in favour of whoever clicked last.
                            <Callout
                                testID="kitchen-order-desk-detail-conflict"
                                tone="warning"
                                role="alert"
                                title={t('kitchen:ops.orders.conflictTitle')}
                                body={t('kitchen:ops.orders.conflictBody')}
                                actions={
                                    <Button
                                        testID="kitchen-order-desk-detail-conflict-refresh"
                                        size="sm"
                                        variant="secondary"
                                        label={t('kitchen:ops.orders.conflictRefresh')}
                                        loading={detail.isFetching}
                                        onPress={() => {
                                            clearActionState();
                                            void detail.refetch();
                                            void queue.refetch();
                                        }}
                                    />
                                }
                            />
                        ) : (
                            <Text testID="kitchen-order-desk-detail-action-error" tone="danger">
                                {actionFailure.message}
                            </Text>
                        )}

                        <Stack space="xs" testID="kitchen-order-desk-detail-payment">
                            <Heading level={3}>{t('kitchen:desk.paymentHeading')}</Heading>
                            <DetailRow
                                testID="kitchen-order-desk-detail-payment-method"
                                label={t('kitchen:desk.paymentMethod')}
                                value={t(
                                    kitchenOrderPaymentMethodKey(
                                        selectedRow?.payment.method ?? order.paymentMethod,
                                    ),
                                )}
                            />
                            {/*
                             * The receipt figures come from the queue row, because the detail
                             * endpoint does not serve them: an order read on its own says what was
                             * *intended*, and what has actually arrived is the queue's own column.
                             */}
                            {selectedRow === null ? null : (
                                <>
                                    <DetailRow
                                        testID="kitchen-order-desk-detail-payment-received"
                                        label={t('kitchen:desk.paymentReceived')}
                                        value={formatMoney(formatter, {
                                            amount: selectedRow.payment.receivedMinor,
                                            currency: selectedRow.currencyCode,
                                        })}
                                    />
                                    <DetailRow
                                        testID="kitchen-order-desk-detail-payment-state"
                                        label={t('kitchen:desk.paymentState')}
                                        value={t(
                                            selectedRow.payment.receipted
                                                ? 'kitchen:desk.payment.receipted'
                                                : 'kitchen:desk.payment.notReceipted',
                                        )}
                                    />
                                </>
                            )}
                        </Stack>

                        {/*
                         * The run, and only for an order that has one to have. A pickup showing an
                         * empty "Delivery" section would be a heading about nothing.
                         */}
                        {selectedRow === null ||
                        orderDeskDeliveryState(selectedRow) === 'not_delivered' ? null : (
                            <Stack space="xs" testID="kitchen-order-desk-detail-delivery">
                                <Heading level={3}>{t('kitchen:desk.deliveryHeading')}</Heading>
                                <DetailRow
                                    testID="kitchen-order-desk-detail-delivery-state"
                                    label={t('kitchen:desk.deliveryState')}
                                    value={t(
                                        orderDeskDeliveryStateKey(
                                            orderDeskDeliveryState(selectedRow),
                                        ),
                                    )}
                                />
                                {selectedRow.deliveryJob === null ? null : (
                                    <>
                                        <DetailRow
                                            testID="kitchen-order-desk-detail-delivery-status"
                                            label={t('kitchen:desk.deliveryStatus')}
                                            value={t(
                                                deliveryJobStatusKey(
                                                    selectedRow.deliveryJob.status,
                                                ),
                                            )}
                                        />
                                        <DetailRow
                                            testID="kitchen-order-desk-detail-delivery-tracking"
                                            label={t('kitchen:desk.deliveryTracking')}
                                            value={t(
                                                deliveryJobTrackingKey(
                                                    selectedRow.deliveryJob.trackingStatus,
                                                ),
                                            )}
                                        />
                                        <DetailRow
                                            testID="kitchen-order-desk-detail-delivery-assigned-at"
                                            label={t('kitchen:desk.deliveryAssignedAt')}
                                            // Null on a run nobody has taken — which the state row
                                            // above has already said in words.
                                            value={
                                                selectedRow.deliveryJob.assignedAt === null
                                                    ? t('kitchen:common.notRecorded')
                                                    : formatter.formatDate(
                                                          selectedRow.deliveryJob.assignedAt,
                                                      )
                                            }
                                        />
                                    </>
                                )}
                                {/*
                                 * Said once, in the one place somebody would look for the control
                                 * that is not there. The wire has the write; nothing on this
                                 * platform can name the people it takes.
                                 */}
                                {orderDeskDeliveryState(selectedRow) === 'unassigned' ? (
                                    <Callout
                                        testID="kitchen-order-desk-detail-assign-unavailable"
                                        tone="info"
                                        role="status"
                                        title={t('kitchen:desk.assignUnavailableTitle')}
                                        body={t('kitchen:desk.assignUnavailableBody')}
                                    />
                                ) : null}
                            </Stack>
                        )}

                        <Stack space="sm">
                            <Heading level={3} testID="kitchen-order-desk-detail-lines-heading">
                                {t('kitchen:ops.orders.linesHeading')}
                            </Heading>
                            {/*
                             * No `rowAction` and no pressable rows: every control in this drawer is
                             * in the footer, so nothing here can nest one interactive element
                             * inside another.
                             */}
                            <Table<KitchenOrderLine>
                                testID="kitchen-order-desk-detail-lines"
                                caption={t('kitchen:ops.orders.linesHeading')}
                                captionHidden
                                columns={lineColumns}
                                rows={order.lines}
                                rowKey={(line) => line.id}
                            />
                        </Stack>

                        <Stack space="xs" testID="kitchen-order-desk-detail-totals">
                            <Heading level={3}>{t('kitchen:ops.orders.totalsHeading')}</Heading>
                            <DetailRow
                                testID="kitchen-order-desk-detail-subtotal"
                                label={t('kitchen:ops.orders.subtotal')}
                                value={formatMoney(formatter, {
                                    amount: order.subtotalMinor,
                                    currency: order.currencyCode,
                                })}
                            />
                            <DetailRow
                                testID="kitchen-order-desk-detail-delivery-fee"
                                label={t('kitchen:ops.orders.deliveryFee')}
                                // `null` is not zero: a free delivery and a collection that never
                                // had a fee are different facts.
                                value={
                                    order.deliveryFeeMinor === null
                                        ? t('kitchen:ops.orders.noDeliveryFee')
                                        : formatMoney(formatter, {
                                              amount: order.deliveryFeeMinor,
                                              currency: order.currencyCode,
                                          })
                                }
                            />
                            <DetailRow
                                testID="kitchen-order-desk-detail-total"
                                label={t('kitchen:ops.orders.total')}
                                value={formatMoney(formatter, {
                                    amount: order.totalMinor,
                                    currency: order.currencyCode,
                                })}
                            />
                        </Stack>
                    </Stack>
                )}
            </Drawer>
        </Stack>
    );
}
