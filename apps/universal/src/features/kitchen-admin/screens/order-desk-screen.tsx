import type {
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
} from '@healthy360/design-system';
import type { TableColumn } from '@healthy360/design-system';
import { useFormatter } from '@healthy360/i18n';
import { useRouter } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { Gate } from '../../../access/gate.tsx';
import { toFailure } from '../../../data/hooks.ts';
import { useOrderDeskQueueQuery } from '../../../data/order-desk-hooks.ts';
import { useOnlineStatus } from '../../../online/online-status.tsx';
import { formatMoney } from '../../marketplace/format.ts';
import { ORDER_VIEW_PERMISSION } from '../entity-registry.ts';
import { humaniseCode } from '../format.ts';
import {
    kitchenOrderStatusKey,
    kitchenOrderStatusTone,
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
 * ## What it does not do yet
 *
 * Nothing on a row is pressable. The detail drawer, the payment column and the delivery column all
 * arrive with the slices that give them something to show; a row that opened nothing, or an
 * `onPress` with an empty body, would be a dead control shipped as a placeholder.
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
    const { online } = useOnlineStatus();

    const [deskWindow, setDeskWindow] = useState<OrderDeskWindow>('today');
    const [statuses, setStatuses] = useState<readonly OrderDeskQueueStatus[]>([]);
    const [query, setQuery] = useState('');

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

    const rows = queue.data?.rows ?? [];
    const meta = queue.data?.meta ?? null;
    const failure = toFailure(queue.error);
    const filtered = trimmed !== '' || statuses.length > 0 || deskWindow !== 'today';

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
                    />
                </Stack>
            )}
        </Stack>
    );
}
