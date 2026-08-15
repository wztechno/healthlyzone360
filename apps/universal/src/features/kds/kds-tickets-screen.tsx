import type { KitchenOrder } from '@healthy360/api-client/contracts';
import {
    Badge,
    Button,
    Callout,
    Card,
    EmptyState,
    ErrorState,
    Heading,
    Inline,
    Skeleton,
    Stack,
    Text,
    useBreakpoint,
} from '@healthy360/design-system';
import type { OrderId } from '@healthy360/domain-types';
import { useFormatter, useLocale } from '@healthy360/i18n';
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { Gate, useCan } from '../../access/gate.tsx';
import { toFailure } from '../../data/hooks.ts';
import {
    useConfirmOrderMutation,
    useFulfilOrderMutation,
    useKitchenOrdersQuery,
} from '../../data/kitchen-orders-hooks.ts';
import { useOnlineStatus } from '../../online/online-status.tsx';
import { useAccessState } from '../../session/session-provider.tsx';
import {
    ORDER_MANAGE_PERMISSION,
    ORDER_VIEW_PERMISSION,
} from '../kitchen-admin/entity-registry.ts';
import { displayName, humaniseCode } from '../kitchen-admin/format.ts';
import { canConfirmKitchenOrder, canFulfilKitchenOrder } from '../kitchen-admin/ops-format.ts';
import {
    bucketTickets,
    kdsColumnTestId,
    kdsTicketTestId,
    minutesSincePlaced,
    ticketAgeTone,
} from './kds-board.ts';
import type { KdsColumnKey } from './kds-board.ts';

/**
 * `/kds` — the kitchen display, a wall board over the order book (O6).
 *
 * ## It is a display, not a second order system
 *
 * Every ticket here is a `KitchenOrder` read through `useKitchenOrdersQuery`, and the two buttons on
 * a ticket are `confirmOrder` and `fulfilOrder` — the same endpoints, the same lock-versioned
 * writes, the same state machine that `/kitchen/orders` works. Nothing on this screen has a status
 * of its own, and `canConfirmKitchenOrder` / `canFulfilKitchenOrder` (`kitchen-admin/ops-format.ts`)
 * decide what a ticket offers, so a button here can never propose a transition the endpoint refuses.
 *
 * What the board deliberately does *not* carry is Cancel. Cancelling an order asks a customer-facing
 * question — why — and records an enum somebody will be held to; that is management work and it
 * stays on `/kitchen/orders`, where the person doing it has the address, the totals and a dialog.
 *
 * ## Bucketing, oldest first, and which finished tickets stay up
 *
 * `./kds-board.ts` holds the rule and the argument for it. In short: three columns matching the
 * three live statuses, `cancelled` in none of them, open work ordered oldest first because that is
 * the ticket somebody has been waiting on, and the Ready column bounded to **what this kitchen
 * finished today** — by `fulfilledAt`, the moment of the bump, rather than by the requested delivery
 * day, so a ticket bumped for tomorrow's delivery moves across the board instead of vanishing from
 * under the hand that pressed it.
 *
 * ## The branch narrowing is client-side, and that is not an oversight
 *
 * The list is fetched **without** `filters.branchId`. An order whose delivery resolved through an
 * organisation-wide zone carries `branch_id: NULL` — the live book's real orders do — so the server
 * filter would not scope the board, it would empty it while a kitchen had work waiting. The board
 * keeps unattributed tickets and its own branch's, and drops only what another branch has been given
 * (`ticketBelongsToBranch`). The trade is that the board reads one page of the book rather than a
 * server-narrowed slice of it; at the page size this endpoint answers, a kitchen's open work is on
 * it, and the alternative is open work nobody can see.
 *
 * ## Why the ticket sends the version it is displaying
 *
 * `/kitchen/orders` re-reads an order before acting on it, because its panel can sit open for
 * minutes. This board cannot: there is no detail read, and a wall screen that fetched an order
 * before every bump would put a round trip between a cook's hand and the ticket moving. So the
 * ticket sends the `lockVersion` it is showing — which the poll below keeps within fifteen seconds
 * of the truth — and when another station got there first the `resource.conflict` is shown as
 * exactly that, with a refresh, rather than being retried into a lost update.
 *
 * ## Live-ness
 *
 * The list polls every {@link KDS_POLL_MS} while the board is mounted, and stops while the device is
 * offline — KDS is online-only (ADR-0012), and an interval firing into a dead network is retries
 * nobody asked for. There is no push channel in this client slice and no focus manager on this
 * platform to hang a smarter cadence off (`refetchOnWindowFocus` is off application-wide), so a
 * plain interval is the honest mechanism rather than a placeholder for one. Fifteen seconds is
 * short enough that a new order reaches a cook before the customer wonders, and long enough that a
 * tablet left on all day is not making six requests a minute.
 */

/** Poll cadence for the board and its clock. See the header. */
export const KDS_POLL_MS = 15_000;

export function KdsTicketsScreen() {
    return (
        <Gate area="kds" requirement={{ allOf: [ORDER_VIEW_PERMISSION] }} testID="kds-tickets">
            <KdsTickets />
        </Gate>
    );
}

/**
 * A clock that advances on the poll cadence.
 *
 * The elapsed-time badge is the one thing on this board that changes without the data changing, so
 * something has to move. It ticks with the poll rather than every second: the label is minutes and
 * hours, and re-rendering every ticket once a second to say the same words is work a wall-mounted
 * tablet pays for in battery and heat.
 *
 * The write happens in the timer callback, never in the effect body — same rule as
 * `online/online-status.tsx`.
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

function KdsTickets() {
    const { t } = useTranslation();
    const { locale } = useLocale();
    const formatter = useFormatter();
    const { atLeast } = useBreakpoint();
    const access = useAccessState();
    const { online } = useOnlineStatus();
    const canManage = useCan(ORDER_MANAGE_PERMISSION);

    const branchId = access.branch?.id ?? null;
    const now = useTickingNow(KDS_POLL_MS, online);

    // No `filters.branchId`: an order delivered through an organisation-wide zone carries no branch
    // at all, and the server filter would drop exactly that work. See `./kds-board.ts`.
    const orders = useKitchenOrdersQuery(undefined, branchId !== null, {
        refetchInterval: online ? KDS_POLL_MS : false,
    });

    const confirmOrder = useConfirmOrderMutation();
    const fulfilOrder = useFulfilOrderMutation();

    const board = useMemo(
        () => bucketTickets(orders.data?.items ?? [], now, branchId),
        [orders.data, now, branchId],
    );

    const listFailure = toFailure(orders.error);
    const actionFailure = toFailure(confirmOrder.error) ?? toFailure(fulfilOrder.error);
    const isConflict = actionFailure?.code === 'resource.conflict';

    function clearActionState() {
        confirmOrder.reset();
        fulfilOrder.reset();
    }

    function bump(order: KitchenOrder, action: 'start' | 'ready') {
        clearActionState();
        const request = { id: order.id, lockVersion: order.lockVersion };
        if (action === 'start') confirmOrder.mutate(request);
        else fulfilOrder.mutate(request);
    }

    /** The ticket a write is in flight for, so only that one shows a spinner. */
    const pendingRequest = confirmOrder.isPending
        ? confirmOrder.variables
        : fulfilOrder.isPending
          ? fulfilOrder.variables
          : undefined;
    const pendingId: OrderId | null = pendingRequest?.id ?? null;
    const actionPending = confirmOrder.isPending || fulfilOrder.isPending;

    const empty =
        board.incoming.length === 0 && board.preparing.length === 0 && board.done.length === 0;

    function renderColumn(column: KdsColumnKey, tickets: readonly KitchenOrder[]) {
        return (
            <Stack
                space="sm"
                className={atLeast('md') ? 'flex-1' : undefined}
                testID={kdsColumnTestId(column)}
            >
                <Inline space="sm" align="center" justify="between">
                    <Heading level={2}>{t(`kitchen:kds.column.${column}`)}</Heading>
                    <Badge
                        testID={`${kdsColumnTestId(column)}-count`}
                        tone="neutral"
                        icon={null}
                        label={formatter.formatNumber(tickets.length)}
                    />
                </Inline>

                {tickets.length === 0 ? (
                    <Text
                        variant="caption"
                        tone="secondary"
                        testID={`${kdsColumnTestId(column)}-empty`}
                    >
                        {t(`kitchen:kds.columnEmpty.${column}`)}
                    </Text>
                ) : (
                    tickets.map((order) => (
                        <Ticket
                            key={String(order.id)}
                            order={order}
                            now={now}
                            locale={locale}
                            canManage={canManage}
                            pending={pendingId === order.id}
                            disabled={actionPending}
                            onBump={bump}
                        />
                    ))
                )}
            </Stack>
        );
    }

    if (branchId === null) {
        // The area requirement demands a branch (`permissions/requirements.ts`), so the gate should
        // have redirected before this renders. It is here because "no branch" is a state the access
        // state can express, and a board that silently listed another kitchen's tickets — or every
        // kitchen's — would be worse than one that says what is missing.
        return (
            <Stack space="md" className="flex-1 p-4" testID="kds-tickets">
                <EmptyState
                    testID="kds-tickets-no-branch"
                    title={t('kitchen:kds.noBranchTitle')}
                    body={t('kitchen:kds.noBranchBody')}
                />
            </Stack>
        );
    }

    return (
        <Stack space="md" className="flex-1 p-4" testID="kds-tickets">
            <Stack space="xs">
                <Heading level={1}>{t('kitchen:kds.title')}</Heading>
                <Inline space="sm" align="center" justify="between" wrap>
                    <Text tone="secondary" variant="caption">
                        {t('kitchen:kds.subtitle')}
                    </Text>
                    {orders.dataUpdatedAt === 0 ? null : (
                        <Text tone="secondary" variant="caption" testID="kds-tickets-updated">
                            {t('kitchen:kds.lastUpdated', {
                                time: formatter.formatDate(orders.dataUpdatedAt, {
                                    timeStyle: 'short',
                                }),
                            })}
                        </Text>
                    )}
                </Inline>
            </Stack>

            {actionFailure === null ? null : isConflict ? (
                <Callout
                    testID="kds-conflict"
                    tone="warning"
                    role="alert"
                    title={t('kitchen:kds.conflictTitle')}
                    body={t('kitchen:kds.conflictBody')}
                    actions={
                        <Button
                            testID="kds-conflict-refresh"
                            size="sm"
                            variant="secondary"
                            label={t('kitchen:kds.conflictRefresh')}
                            loading={orders.isFetching}
                            onPress={() => {
                                clearActionState();
                                void orders.refetch();
                            }}
                        />
                    }
                />
            ) : (
                <Text testID="kds-action-error" tone="danger">
                    {actionFailure.message}
                </Text>
            )}

            {orders.isPending ? (
                <Stack space="sm" testID="kds-tickets-loading">
                    {Array.from({ length: 3 }, (_, index) => (
                        <Skeleton key={index} heightClassName="h-24" />
                    ))}
                </Stack>
            ) : listFailure !== null ? (
                <ErrorState
                    testID="kds-tickets-error"
                    title={t('kitchen:kds.loadErrorTitle')}
                    failure={listFailure}
                    onRetry={() => {
                        void orders.refetch();
                    }}
                    retrying={orders.isFetching}
                />
            ) : empty ? (
                <EmptyState
                    testID="kds-tickets-empty"
                    title={t('kitchen:kds.emptyTitle')}
                    body={t('kitchen:kds.emptyBody')}
                />
            ) : atLeast('md') ? (
                // Three rails side by side on anything tablet-sized and up — a wall screen reads
                // left to right (or right to left; `Inline` gaps are direction-neutral). Below that
                // they stack, because three columns on a phone is three columns nobody can read.
                <Inline space="md" align="start" testID="kds-tickets-columns">
                    {renderColumn('incoming', board.incoming)}
                    {renderColumn('preparing', board.preparing)}
                    {renderColumn('done', board.done)}
                </Inline>
            ) : (
                <Stack space="lg" testID="kds-tickets-columns">
                    {renderColumn('incoming', board.incoming)}
                    {renderColumn('preparing', board.preparing)}
                    {renderColumn('done', board.done)}
                </Stack>
            )}
        </Stack>
    );
}

interface TicketProps {
    readonly order: KitchenOrder;
    readonly now: Date;
    readonly locale: string;
    readonly canManage: boolean;
    /** A write is in flight for *this* ticket. */
    readonly pending: boolean;
    /** A write is in flight for some ticket — every bump button waits for it. */
    readonly disabled: boolean;
    readonly onBump: (order: KitchenOrder, action: 'start' | 'ready') => void;
}

/**
 * One ticket.
 *
 * The order number is the biggest thing on it because that is what a cook and a driver say out loud
 * to each other. Everything below it is what the kitchen has to know before it starts cooking: what
 * to make, how much of it, what would put somebody in hospital, and when it has to leave.
 */
function Ticket({ order, now, locale, canManage, pending, disabled, onBump }: TicketProps) {
    const { t } = useTranslation();
    const formatter = useFormatter();

    const testID = kdsTicketTestId(String(order.id));
    const minutes = minutesSincePlaced(order, now);

    const deliveryDate =
        order.delivery.requestedDate === null
            ? null
            : formatter.formatDate(order.delivery.requestedDate, { dateStyle: 'medium' });

    return (
        <Card padding="md" testID={testID}>
            <Stack space="sm">
                <Inline space="sm" align="center" justify="between" wrap>
                    <Heading level={3} testID={`${testID}-number`}>
                        {order.orderNumber}
                    </Heading>
                    <Badge
                        testID={`${testID}-elapsed`}
                        tone={ticketAgeTone(minutes)}
                        label={t('kitchen:kds.placedAgo', {
                            elapsed: formatter.formatRelativeTime(order.placedAt, now),
                        })}
                    />
                </Inline>

                <Stack space="xs" testID={`${testID}-lines`}>
                    {order.lines.map((line) => (
                        <Stack space="none" key={line.id}>
                            <Text variant="bodyStrong">
                                {t('kitchen:kds.lineSummary', {
                                    name: displayName({ en: line.nameEn, ar: line.nameAr }, locale)
                                        .value,
                                    quantity: formatter.formatNumber(Number(line.quantity)),
                                })}
                            </Text>
                            {line.allergens.length === 0 ? null : (
                                <Inline space="xs" wrap testID={`${testID}-allergens`}>
                                    {line.allergens.map((allergen) => (
                                        <Badge
                                            key={allergen.allergenCode}
                                            // `contains` is the one that can hurt somebody;
                                            // "may contain" is a warning, and the two must not look
                                            // alike on a wall read at three metres.
                                            tone={
                                                allergen.containment === 'contains'
                                                    ? 'danger'
                                                    : 'warning'
                                            }
                                            label={humaniseCode(allergen.allergenCode)}
                                        />
                                    ))}
                                </Inline>
                            )}
                        </Stack>
                    ))}
                </Stack>

                <Text variant="caption" tone="secondary" testID={`${testID}-delivery`}>
                    {deliveryDate === null
                        ? t('kitchen:kds.deliveryUnknown')
                        : order.delivery.windowCode === null
                          ? t('kitchen:kds.deliveryOn', { date: deliveryDate })
                          : t('kitchen:kds.deliveryOnAt', {
                                date: deliveryDate,
                                window: humaniseCode(order.delivery.windowCode),
                            })}
                </Text>

                {!canManage ? null : canConfirmKitchenOrder(order.status) ? (
                    <Button
                        testID={`${testID}-start`}
                        block
                        label={t('kitchen:kds.start')}
                        loading={pending}
                        disabled={disabled}
                        onPress={() => {
                            onBump(order, 'start');
                        }}
                    />
                ) : canFulfilKitchenOrder(order.status) ? (
                    <Button
                        testID={`${testID}-ready`}
                        block
                        label={t('kitchen:kds.ready')}
                        loading={pending}
                        disabled={disabled}
                        onPress={() => {
                            onBump(order, 'ready');
                        }}
                    />
                ) : null}
            </Stack>
        </Card>
    );
}
