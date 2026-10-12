import type { KitchenOrder } from '@healthy360/api-client/contracts';
import {
    Badge,
    Button,
    Callout,
    EmptyState,
    ErrorState,
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
import { Text as RNText, ScrollView, View } from 'react-native';

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
                className={atLeast('md') ? 'min-w-0 flex-1' : undefined}
                testID={kdsColumnTestId(column)}
            >
                {/* The column's name over a rule in its own colour — amber for what is waiting,
                    green for what is cooking, pale for what has gone. */}
                <View
                    className={`flex-row items-center gap-2 border-b-2 px-1 pb-2 ${COLUMN_RULE_CLASS[column]}`}
                >
                    <RNText
                        accessibilityRole="header"
                        aria-level={2}
                        className="font-display text-lg font-bold text-content-on-canopy text-start"
                    >
                        {t(`kitchen:kds.column.${column}`)}
                    </RNText>
                    <View
                        testID={`${kdsColumnTestId(column)}-count`}
                        accessibilityRole="text"
                        accessibilityLabel={formatter.formatNumber(tickets.length)}
                        className="h-7 min-w-7 items-center justify-center rounded-full bg-content-on-canopy/15 px-2"
                    >
                        <RNText className="font-display text-sm font-bold tabular-nums text-content-on-canopy">
                            {formatter.formatNumber(tickets.length)}
                        </RNText>
                    </View>
                </View>

                {tickets.length === 0 ? (
                    <RNText
                        testID={`${kdsColumnTestId(column)}-empty`}
                        className="px-1 text-sm text-content-on-canopy-muted text-start"
                    >
                        {t(`kitchen:kds.columnEmpty.${column}`)}
                    </RNText>
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
            <View className="flex-1 bg-surface-canopy p-4 md:p-7" testID="kds-tickets">
                <View className="rounded-2xl bg-surface-raised p-4">
                    <EmptyState
                        testID="kds-tickets-no-branch"
                        title={t('kitchen:kds.noBranchTitle')}
                        body={t('kitchen:kds.noBranchBody')}
                    />
                </View>
            </View>
        );
    }

    return (
        /*
         * The board is the deep forest canopy in both themes: it hangs on a wall and is read at
         * three metres, so it is one dark field with light tickets rather than a page that follows
         * the room's theme. The kiosk shell has no scroll port of its own, so the board is one.
         */
        <ScrollView
            testID="kds-tickets"
            className="flex-1 bg-surface-canopy"
            contentContainerClassName="flex-grow gap-4 p-4 md:p-7"
        >
            <View className="flex-row flex-wrap items-center gap-3 border-b border-content-on-canopy/15 pb-4">
                {/* A floor under the title, so on a phone the live pill and clock wrap beneath it
                    rather than crushing it into a column a word wide. */}
                <View className="min-w-[240px] flex-1">
                    <RNText
                        accessibilityRole="header"
                        aria-level={1}
                        className="font-display text-2xl font-bold text-content-on-canopy text-start"
                    >
                        {t('kitchen:kds.title')}
                    </RNText>
                    <RNText className="text-sm text-content-on-canopy-muted text-start">
                        {t('kitchen:kds.subtitle')}
                    </RNText>
                </View>
                {orders.dataUpdatedAt === 0 ? null : (
                    <View className="flex-row items-center gap-2 rounded-full bg-content-on-canopy/10 px-3.5 py-1.5">
                        <View
                            aria-hidden
                            className={`h-2 w-2 rounded-full ${online ? 'bg-success' : 'bg-warning'}`}
                        />
                        <RNText
                            testID="kds-tickets-updated"
                            className="text-sm font-semibold text-content-on-canopy"
                        >
                            {t('kitchen:kds.lastUpdated', {
                                time: formatter.formatDate(orders.dataUpdatedAt, {
                                    timeStyle: 'short',
                                }),
                            })}
                        </RNText>
                    </View>
                )}
                <RNText
                    aria-hidden
                    className="font-display text-2xl font-bold tabular-nums text-content-on-canopy"
                >
                    {formatter.formatDate(now, { timeStyle: 'short' })}
                </RNText>
            </View>

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
                <View className="self-start rounded-xl bg-danger-subtle px-4 py-3">
                    <Text testID="kds-action-error" tone="danger">
                        {actionFailure.message}
                    </Text>
                </View>
            )}

            {orders.isPending ? (
                <Stack space="sm" testID="kds-tickets-loading">
                    {Array.from({ length: 3 }, (_, index) => (
                        <Skeleton key={index} heightClassName="h-24" />
                    ))}
                </Stack>
            ) : listFailure !== null ? (
                <View className="rounded-2xl bg-surface-raised p-4">
                    <ErrorState
                        testID="kds-tickets-error"
                        title={t('kitchen:kds.loadErrorTitle')}
                        failure={listFailure}
                        onRetry={() => {
                            void orders.refetch();
                        }}
                        retrying={orders.isFetching}
                    />
                </View>
            ) : empty ? (
                <View className="rounded-2xl bg-surface-raised p-4">
                    <EmptyState
                        testID="kds-tickets-empty"
                        title={t('kitchen:kds.emptyTitle')}
                        body={t('kitchen:kds.emptyBody')}
                    />
                </View>
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
        </ScrollView>
    );
}

/** The rule under each column's name, in the column's own colour. */
const COLUMN_RULE_CLASS: Readonly<Record<KdsColumnKey, string>> = {
    incoming: 'border-warning-border',
    preparing: 'border-success-border',
    done: 'border-content-on-canopy/30',
};

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

    const late = ticketAgeTone(minutes) === 'danger';

    return (
        /*
         * A light-on-dark ticket on the canopy, a step lighter than the board. A late ticket takes
         * a thick danger edge as well as the red age pill, so lateness reads from across the room in
         * shape as well as colour.
         */
        <View
            testID={testID}
            className={`gap-3 rounded-2xl border bg-content-on-canopy/5 p-4 ${
                late ? 'border-s-4 border-danger-border' : 'border-content-on-canopy/15'
            }`}
        >
            <Inline space="sm" align="center" justify="between" wrap>
                <RNText
                    testID={`${testID}-number`}
                    accessibilityRole="header"
                    aria-level={3}
                    className="font-display text-xl font-bold tabular-nums text-content-on-canopy"
                >
                    {order.orderNumber}
                </RNText>
                <Badge
                    testID={`${testID}-elapsed`}
                    tone={ticketAgeTone(minutes)}
                    label={t('kitchen:kds.placedAgo', {
                        elapsed: formatter.formatRelativeTime(order.placedAt, now),
                    })}
                />
            </Inline>

            <View
                className="gap-2 border-t border-content-on-canopy/15 pt-3"
                testID={`${testID}-lines`}
            >
                {order.lines.map((line) => (
                    <Stack space="xs" key={line.id}>
                        <RNText className="text-base font-semibold text-content-on-canopy text-start">
                            {t('kitchen:kds.lineSummary', {
                                name: displayName({ en: line.nameEn, ar: line.nameAr }, locale)
                                    .value,
                                quantity: formatter.formatNumber(Number(line.quantity)),
                            })}
                        </RNText>
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
            </View>

            <RNText
                testID={`${testID}-delivery`}
                className="text-sm text-content-on-canopy-muted text-start"
            >
                {deliveryDate === null
                    ? t('kitchen:kds.deliveryUnknown')
                    : order.delivery.windowCode === null
                      ? t('kitchen:kds.deliveryOn', { date: deliveryDate })
                      : t('kitchen:kds.deliveryOnAt', {
                            date: deliveryDate,
                            window: humaniseCode(order.delivery.windowCode),
                        })}
            </RNText>

            {!canManage ? null : canConfirmKitchenOrder(order.status) ? (
                <Button
                    testID={`${testID}-start`}
                    block
                    size="lg"
                    className="min-h-12"
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
                    size="lg"
                    variant="secondary"
                    className="min-h-12"
                    label={t('kitchen:kds.ready')}
                    loading={pending}
                    disabled={disabled}
                    onPress={() => {
                        onBump(order, 'ready');
                    }}
                />
            ) : null}
        </View>
    );
}
