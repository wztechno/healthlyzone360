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
    Tabs,
    Text,
    useBreakpoint,
    useToast,
} from '@healthy360/design-system';
import type { BranchId, OrderId } from '@healthy360/domain-types';
import { useFormatter, useLocale } from '@healthy360/i18n';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { Gate, useCan } from '../../access/gate.tsx';
import { toFailure } from '../../data/hooks.ts';
import {
    useFulfilOrderMutation,
    useConfirmOrderMutation,
    useMarkOrderReadyMutation,
    useStartOrderMutation,
    useKitchenDisplayQuery,
} from '../../data/kitchen-orders-hooks.ts';
import { useOnlineStatus } from '../../online/online-status.tsx';
import { dishOptionsLine } from '../../ui/dish-choices.tsx';
import { useAccessState } from '../../session/session-provider.tsx';
import {
    ORDER_MANAGE_PERMISSION,
    ORDER_PREPARE_PERMISSION,
    ORDER_VIEW_PERMISSION,
} from '../kitchen-admin/entity-registry.ts';
import { displayName, humaniseCode } from '../kitchen-admin/format.ts';
import {
    allergenLabel,
    allergyBanner,
    canFulfilKitchenOrder,
} from '../kitchen-admin/ops-format.ts';
import { playAlertTone } from './alert-tone.ts';
import {
    KDS_COLUMN_KEYS,
    bucketTickets,
    isAlarming,
    isAwaitingStart,
    isUpcoming,
    kdsColumnTestId,
    kdsTicketTestId,
    minutesSincePlaced,
    placedTicketIds,
    ticketAgeTone,
    unseenTickets,
} from './kds-board.ts';
import type { KdsColumnKey } from './kds-board.ts';
import { useWakeLock } from './use-wake-lock.ts';

/**
 * `/kds` — the kitchen display, a wall board over the order book (O6).
 *
 * ## It is a display, not a second order system
 *
 * Every ticket here is a `KitchenOrder` read through `useKitchenDisplayQuery`, and the buttons on
 * a ticket are `startOrder` (which confirms a placed order first), `markOrderReady` and
 * `fulfilOrder` — the same lock-versioned writes, the same state machine that `/kitchen/orders`
 * works. Nothing on this screen has a status of its own; `isAwaitingStart` (`./kds-board.ts`) and
 * `canFulfilKitchenOrder` (`kitchen-admin/ops-format.ts`) decide what a ticket offers, so a button
 * here can never propose a write the endpoint refuses.
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
 * The display endpoint names no branch. An order whose delivery resolved through an
 * organisation-wide zone carries `branch_id: NULL` — the live book's real orders do — so a server
 * filter would not scope the board, it would empty it while a kitchen had work waiting. The board
 * keeps unattributed tickets and its own branch's, and drops only what another branch has been given
 * (`ticketBelongsToBranch`). It reads every open order, not a page of the book, and says so when the
 * server's cap cut any.
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
 *
 * A refresh that fails keeps the last board on screen under a banner saying when it last updated: a
 * kitchen working from a slightly old board is better off than one looking at an error. Only with
 * nothing to show is it an error.
 *
 * ## Tone and alarm
 *
 * The rule is the bell's: the first read is silent, and only a ticket this page load has not met
 * sounds (`unseenTickets`), so a reload replays nothing. A browser holds audio until a press, hence
 * "Turn on sound". A placed ticket past the kitchen's limit goes red with an icon and words, and the
 * tone repeats until it is accepted. Both figures come from the server, in minutes while open.
 *
 * ## Ten seconds to take back Ready and Handed over
 *
 * A wall is pressed with wet hands, so Ready and Handed over wait {@link KDS_UNDO_MS} under a toast
 * with Undo before they are sent, and the ticket says it is waiting. Accept and Start go at once:
 * Accept deducts stock and closes the customer's cancel window, which is not something to hold in a
 * browser tab (owner ruling, 3 Nov 2026).
 *
 * ## One lane at a time on a phone
 *
 * From `md` the three columns stand side by side. Below it they are `Tabs`, one lane on screen, each
 * tab carrying its count, so a phone is not three screens of scrolling to find the Ready column.
 */

/** Poll cadence for the board and its clock. See the header. */
export const KDS_POLL_MS = 15_000;

/** How often the tone repeats while a ticket is alarming. */
export const KDS_ALARM_TONE_MS = 30_000;

/** How long Ready and Handed over are held before they are sent, so a mis-press can be undone. */
export const KDS_UNDO_MS = 10_000;

/** What a ticket's buttons do: accept it, start it, mark it cooked, or hand it over. */
type KdsAction = 'accept' | 'start' | 'ready' | 'handOver';

export function KdsTicketsScreen() {
    return (
        <Gate
            area="kds"
            requirement={{ anyOf: [ORDER_VIEW_PERMISSION, ORDER_PREPARE_PERMISSION] }}
            testID="kds-tickets"
        >
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

/**
 * The tone for a new ticket and the repeating one for an alarm, once the reader has allowed sound.
 *
 * `canSound` is the same test `playAlertTone` makes: native has no `AudioContext`, and a button that
 * turned on nothing would be a lie.
 */
function useTicketTones(
    orders: readonly KitchenOrder[] | undefined,
    branchId: BranchId | null,
    alarming: boolean,
) {
    const [soundOn, setSoundOn] = useState(false);
    const seen = useRef<ReadonlySet<string> | null>(null);

    useEffect(() => {
        if (orders === undefined) return;
        const ids = placedTicketIds(orders, branchId);
        const fresh = unseenTickets(ids, seen.current);
        seen.current = new Set(ids);
        if (soundOn && fresh.length > 0) playAlertTone();
    }, [orders, branchId, soundOn]);

    useEffect(() => {
        if (!soundOn || !alarming) return;
        const timer = setInterval(playAlertTone, KDS_ALARM_TONE_MS);
        return () => {
            clearInterval(timer);
        };
    }, [soundOn, alarming]);

    return {
        soundOffered: !soundOn && typeof AudioContext !== 'undefined',
        turnOnSound: () => {
            // Inside the press, which is what lets the browser start audio at all.
            playAlertTone();
            setSoundOn(true);
        },
    };
}

interface HeldBump {
    readonly timer: ReturnType<typeof setTimeout>;
    readonly toastId: string;
    readonly send: () => void;
}

/**
 * Bumps held for {@link KDS_UNDO_MS} under a toast with Undo, keyed by order id.
 *
 * `ponytail:` the hold lives in this page, so closing the tab inside the ten seconds loses the bump;
 * the upgrade is a server-side reverse transition. Leaving the board inside the app sends what is
 * held rather than dropping it.
 */
function useHeldBumps(undoLabel: string) {
    const { show, dismiss } = useToast();
    const held = useRef(new Map<string, HeldBump>());
    const [heldIds, setHeldIds] = useState<ReadonlySet<string>>(() => new Set());

    useEffect(() => {
        const pending = held.current;
        return () => {
            for (const bump of pending.values()) {
                clearTimeout(bump.timer);
                dismiss(bump.toastId);
                bump.send();
            }
            pending.clear();
        };
    }, [dismiss]);

    function release(id: string): HeldBump | undefined {
        const bump = held.current.get(id);
        held.current.delete(id);
        setHeldIds(new Set(held.current.keys()));
        return bump;
    }

    function hold(id: string, message: string, send: () => void) {
        if (held.current.has(id)) return;
        const testID = kdsTicketTestId(id);
        const toastId = show({
            testID: `${testID}-undo-toast`,
            message,
            durationMs: KDS_UNDO_MS,
            action: {
                testID: `${testID}-undo`,
                label: undoLabel,
                onPress: () => {
                    const bump = release(id);
                    if (bump !== undefined) clearTimeout(bump.timer);
                },
            },
        });
        const timer = setTimeout(() => {
            release(id);
            send();
        }, KDS_UNDO_MS);
        held.current.set(id, { timer, toastId, send });
        setHeldIds(new Set(held.current.keys()));
    }

    return { heldIds, hold };
}

function KdsTickets() {
    const { t } = useTranslation();
    const { locale } = useLocale();
    const formatter = useFormatter();
    const { atLeast } = useBreakpoint();
    const access = useAccessState();
    const { online } = useOnlineStatus();
    const canManage = useCan(ORDER_MANAGE_PERMISSION);
    const canPrepare = useCan(ORDER_PREPARE_PERMISSION) || canManage;

    const branchId = access.branch?.id ?? null;
    const now = useTickingNow(KDS_POLL_MS, online);

    const display = useKitchenDisplayQuery(branchId !== null, online ? KDS_POLL_MS : false);
    const orders = display.data?.orders;

    useWakeLock(branchId !== null);

    const acceptOrder = useConfirmOrderMutation();
    const startOrder = useStartOrderMutation();
    const markReady = useMarkOrderReadyMutation();
    const fulfilOrder = useFulfilOrderMutation();
    const { heldIds, hold } = useHeldBumps(t('kitchen:common.undo'));
    const [lane, setLane] = useState<KdsColumnKey>('incoming');

    const board = useMemo(
        () => bucketTickets(orders ?? [], now, branchId),
        [orders, now, branchId],
    );

    /** The open minutes a ticket has waited, while it is alarming; null otherwise. */
    function alarmMinutes(order: KitchenOrder): number | null {
        const open = display.data?.unacceptedOpenMinutes[String(order.id)];
        return display.data === undefined ||
            open === undefined ||
            !isAlarming(open, display.data.alarmAfterMinutes)
            ? null
            : open;
    }

    const alarming = [...board.incoming, ...board.upcoming.flatMap((day) => day.tickets)].some(
        (order) => alarmMinutes(order) !== null,
    );
    const { soundOffered, turnOnSound } = useTicketTones(orders, branchId, alarming);

    const listFailure = toFailure(display.error);
    const actionFailure =
        toFailure(acceptOrder.error) ??
        toFailure(startOrder.error) ??
        toFailure(markReady.error) ??
        toFailure(fulfilOrder.error);
    const isConflict = actionFailure?.code === 'resource.conflict';

    function clearActionState() {
        acceptOrder.reset();
        startOrder.reset();
        markReady.reset();
        fulfilOrder.reset();
    }

    function send(order: KitchenOrder, action: KdsAction) {
        clearActionState();
        const request = { id: order.id, lockVersion: order.lockVersion };
        if (action === 'accept') acceptOrder.mutate(request);
        else if (action === 'start') startOrder.mutate(request);
        else if (action === 'ready') markReady.mutate(request);
        else fulfilOrder.mutate(request);
    }

    /** Accept and Start go now; Ready and Handed over are held for the undo. See the header. */
    function bump(order: KitchenOrder, action: KdsAction) {
        if (action === 'accept' || action === 'start') {
            send(order, action);
            return;
        }
        hold(
            String(order.id),
            t(action === 'ready' ? 'kitchen:kds.readyHeld' : 'kitchen:kds.handedOverHeld', {
                number: order.orderNumber,
            }),
            () => {
                send(order, action);
            },
        );
    }

    /** The ticket a write is in flight for, so only that one shows a spinner. */
    const pendingRequest = acceptOrder.isPending
        ? acceptOrder.variables
        : startOrder.isPending
          ? startOrder.variables
          : markReady.isPending
            ? markReady.variables
            : fulfilOrder.isPending
              ? fulfilOrder.variables
              : undefined;
    const pendingId: OrderId | null = pendingRequest?.id ?? null;
    const actionPending =
        acceptOrder.isPending ||
        startOrder.isPending ||
        markReady.isPending ||
        fulfilOrder.isPending;

    const empty =
        board.incoming.length === 0 &&
        board.preparing.length === 0 &&
        board.done.length === 0 &&
        board.upcoming.length === 0;

    function renderTicket(order: KitchenOrder) {
        return (
            <Ticket
                key={String(order.id)}
                order={order}
                now={now}
                locale={locale}
                alarmMinutes={alarmMinutes(order)}
                canManage={canManage}
                canPrepare={canPrepare}
                held={heldIds.has(String(order.id))}
                pending={pendingId === order.id || heldIds.has(String(order.id))}
                disabled={actionPending}
                onBump={bump}
            />
        );
    }

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
                    tickets.map(renderTicket)
                )}
            </Stack>
        );
    }

    const updatedAt = formatter.formatDate(display.dataUpdatedAt, { timeStyle: 'short' });

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
                    <Inline space="sm" align="center" wrap>
                        {soundOffered ? (
                            <Button
                                testID="kds-sound-on"
                                size="sm"
                                variant="secondary"
                                label={t('kitchen:kds.soundOn')}
                                onPress={turnOnSound}
                            />
                        ) : null}
                        {display.dataUpdatedAt === 0 ? null : (
                            <Text tone="secondary" variant="caption" testID="kds-tickets-updated">
                                {t('kitchen:kds.lastUpdated', { time: updatedAt })}
                            </Text>
                        )}
                    </Inline>
                </Inline>
            </Stack>

            {display.isRefetchError ? (
                <Callout
                    testID="kds-stale"
                    tone="warning"
                    role="alert"
                    title={t('kitchen:kds.staleTitle')}
                    body={t('kitchen:kds.staleBody', { time: updatedAt })}
                />
            ) : null}

            {display.data?.truncated === true ? (
                <Callout
                    testID="kds-truncated"
                    tone="warning"
                    role="status"
                    title={t('kitchen:kds.truncatedTitle')}
                    body={t('kitchen:kds.truncatedBody')}
                />
            ) : null}

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
                            loading={display.isFetching}
                            onPress={() => {
                                clearActionState();
                                void display.refetch();
                            }}
                        />
                    }
                />
            ) : (
                <Text testID="kds-action-error" tone="danger">
                    {actionFailure.message}
                </Text>
            )}

            {display.isPending ? (
                <Stack space="sm" testID="kds-tickets-loading">
                    {Array.from({ length: 3 }, (_, index) => (
                        <Skeleton key={index} heightClassName="h-24" />
                    ))}
                </Stack>
            ) : listFailure !== null && orders === undefined ? (
                <ErrorState
                    testID="kds-tickets-error"
                    title={t('kitchen:kds.loadErrorTitle')}
                    failure={listFailure}
                    onRetry={() => {
                        void display.refetch();
                    }}
                    retrying={display.isFetching}
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
                // one lane at a time under tabs, because three columns on a phone is three columns
                // nobody can read.
                <Inline space="md" align="start" testID="kds-tickets-columns">
                    {renderColumn('incoming', board.incoming)}
                    {renderColumn('preparing', board.preparing)}
                    {renderColumn('done', board.done)}
                </Inline>
            ) : (
                <Stack space="md" testID="kds-tickets-columns">
                    <Tabs
                        testID="kds-lanes"
                        label={t('kitchen:kds.lanes')}
                        variant="segmented"
                        block
                        value={lane}
                        onChange={setLane}
                        items={KDS_COLUMN_KEYS.map((column) => ({
                            value: column,
                            label: t(`kitchen:kds.column.${column}`),
                            count: board[column].length,
                            testID: `kds-lane-${column}`,
                        }))}
                    />
                    {renderColumn(lane, board[lane])}
                </Stack>
            )}

            {/*
             * Scheduled work for later days (HA-27): out of today's columns so the wall shows what
             * to cook now, but on screen so it can be accepted the day it arrives. It moves into
             * Incoming by itself on its day.
             */}
            {board.upcoming.length === 0 ? null : (
                <Stack space="sm" testID="kds-upcoming">
                    <Heading level={2}>{t('kitchen:kds.upcoming')}</Heading>
                    {board.upcoming.map((group) => (
                        <Stack space="sm" key={group.day} testID={`kds-upcoming-${group.day}`}>
                            <Inline space="sm" align="center">
                                <Heading level={3}>
                                    {formatter.formatDate(group.day, {
                                        weekday: 'short',
                                        day: 'numeric',
                                        month: 'short',
                                    })}
                                </Heading>
                                <Badge
                                    testID={`kds-upcoming-${group.day}-count`}
                                    tone="neutral"
                                    icon={null}
                                    label={formatter.formatNumber(group.tickets.length)}
                                />
                            </Inline>
                            {atLeast('md') ? (
                                <Inline space="md" align="start" wrap>
                                    {group.tickets.map((order) => (
                                        <View key={String(order.id)} className="w-[320px]">
                                            {renderTicket(order)}
                                        </View>
                                    ))}
                                </Inline>
                            ) : (
                                <Stack space="sm">{group.tickets.map(renderTicket)}</Stack>
                            )}
                        </Stack>
                    ))}
                </Stack>
            )}
        </Stack>
    );
}

interface TicketProps {
    readonly order: KitchenOrder;
    readonly now: Date;
    readonly locale: string;
    /** Open minutes this placed ticket has waited, while it is alarming; null otherwise. */
    readonly alarmMinutes: number | null;
    /** Accept and Handed over: the desk's and the manager's. */
    readonly canManage: boolean;
    /** Start and Ready: the line's. */
    readonly canPrepare: boolean;
    /** Ready or Handed over was pressed and is waiting out the undo. */
    readonly held: boolean;
    /** A write is in flight, or held, for *this* ticket. */
    readonly pending: boolean;
    /** A write is in flight for some ticket — every bump button waits for it. */
    readonly disabled: boolean;
    readonly onBump: (order: KitchenOrder, action: KdsAction) => void;
}

/**
 * One ticket.
 *
 * The order number is the biggest thing on it because that is what a cook and a driver say out loud
 * to each other. Everything below it is what the kitchen has to know before it starts cooking: what
 * to make, how much of it, what would put somebody in hospital, and when it has to leave.
 */
function Ticket({
    order,
    now,
    locale,
    alarmMinutes,
    canManage,
    canPrepare,
    held,
    pending,
    disabled,
    onBump,
}: TicketProps) {
    const { t } = useTranslation();
    const formatter = useFormatter();

    const testID = kdsTicketTestId(String(order.id));
    const minutes = minutesSincePlaced(order, now);
    const later = isUpcoming(order, now);

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
                        tone={alarmMinutes === null ? ticketAgeTone(minutes) : 'danger'}
                        label={t('kitchen:kds.placedAgo', {
                            elapsed: formatter.formatRelativeTime(order.placedAt, now),
                        })}
                    />
                </Inline>

                {alarmMinutes === null ? null : (
                    <Callout
                        testID={`${testID}-alarm`}
                        tone="danger"
                        icon="warning"
                        size="regular"
                        role="alert"
                        title={t('kitchen:kds.alarmTitle')}
                        body={t('kitchen:kds.alarmBody', {
                            minutes: formatter.formatNumber(alarmMinutes),
                        })}
                    />
                )}

                {/* Above the food: it decides how everything under it is cooked. */}
                {order.allergy === null ? null : (
                    <Callout
                        {...allergyBanner(order.allergy, order.lines, locale, t)}
                        size="regular"
                        testID={`${testID}-allergy`}
                    />
                )}

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
                            {dishOptionsLine(line.options, locale, t) === null ? null : (
                                <Text variant="body" testID={`${testID}-options`}>
                                    {dishOptionsLine(line.options, locale, t)}
                                </Text>
                            )}
                            {line.note == null ? null : (
                                <Text variant="body" testID={`${testID}-note`}>
                                    {t('kitchen:dishOptions.lineNote', { note: line.note })}
                                </Text>
                            )}
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
                                            // Colour alone is not the claim: the words say it.
                                            label={
                                                allergen.containment === 'contains'
                                                    ? allergenLabel(allergen.allergenCode, t)
                                                    : t('kitchen:kds.mayContain', {
                                                          allergen: allergenLabel(
                                                              allergen.allergenCode,
                                                              t,
                                                          ),
                                                      })
                                            }
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
                                window:
                                    (locale.toLowerCase().startsWith('ar')
                                        ? order.delivery.windowNameAr
                                        : order.delivery.windowNameEn) ??
                                    order.delivery.windowNameEn ??
                                    humaniseCode(order.delivery.windowCode),
                            })}
                </Text>

                {/* The ticket's foot: what is waiting, then what can be pressed. */}
                <Stack space="xs" testID={`${testID}-footer`}>
                    {held ? (
                        <Text variant="caption" tone="secondary" testID={`${testID}-held`}>
                            {t('kitchen:kds.held')}
                        </Text>
                    ) : null}
                    {!canPrepare ? null : isAwaitingStart(order) ? (
                        /*
                         * Accept and Start are two moments (HA-26). Accept tells the customer the order
                         * was seen — a scheduled order is accepted the day it arrives; Start says it is
                         * cooking, on the day. A later day's ticket offers only Accept; today's offers
                         * Start, which accepts a new order too, so a same-day order is still one press.
                         */
                        <Stack space="xs">
                            {order.status === 'confirmed' ? (
                                <Text
                                    variant="caption"
                                    tone="secondary"
                                    testID={`${testID}-accepted`}
                                >
                                    {t('kitchen:kds.accepted')}
                                </Text>
                            ) : null}
                            {later ? null : (
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
                            )}
                            {canManage && order.status === 'placed' ? (
                                <Button
                                    testID={`${testID}-accept`}
                                    block
                                    variant={later ? 'primary' : 'secondary'}
                                    label={t('kitchen:kds.accept')}
                                    loading={later && pending}
                                    disabled={disabled}
                                    onPress={() => {
                                        onBump(order, 'accept');
                                    }}
                                />
                            ) : null}
                        </Stack>
                    ) : canFulfilKitchenOrder(order.status) && (order.readyAt ?? null) === null ? (
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
                    ) : canFulfilKitchenOrder(order.status) &&
                      order.fulfilmentType === 'delivery' ? (
                        // A delivery leaves with a driver, and it is the driver's Picked up that puts it
                        // on the road (HA-19) — so the board shows where the run is rather than offering
                        // a Handed over that would tell the customer it had arrived.
                        <Text variant="caption" tone="secondary" testID={`${testID}-driver`}>
                            {t(
                                order.deliveryRun?.status === 'failed'
                                    ? 'kitchen:kds.deliveryFailed'
                                    : (order.deliveryRun?.pickedUpAt ?? null) === null
                                      ? 'kitchen:kds.waitingForDriver'
                                      : 'kitchen:kds.withDriver',
                            )}
                        </Text>
                    ) : canManage && canFulfilKitchenOrder(order.status) ? (
                        // Cooked and waiting for its customer: handing it over is the step that fulfils it.
                        <Button
                            testID={`${testID}-handed-over`}
                            block
                            variant="secondary"
                            label={t('kitchen:kds.handedOver')}
                            loading={pending}
                            disabled={disabled}
                            onPress={() => {
                                onBump(order, 'handOver');
                            }}
                        />
                    ) : null}
                </Stack>
            </Stack>
        </Card>
    );
}
