import { OrderId } from '@healthy360/domain-types';
import {
    Cascade,
    EmptyState,
    ErrorState,
    Icon,
    IssueTrayFrame,
    TableSkeleton,
} from '@healthy360/design-system';
import type { IssueTrayContent } from '@healthy360/design-system';
import { useFormatter } from '@healthy360/i18n';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { Gate, useCan } from '../../../access/gate.tsx';
import { useOrderDeskDriversQuery } from '../../../data/order-desk-hooks.ts';
import { withQuery, withReturnTo } from '../../../navigation/return-to.ts';
import { useCurrentHref } from '../../../navigation/use-return-to.ts';
import { CatalogueList } from '../catalogue/catalogue-list.tsx';
import { CATALOGUE_PAGE_SIZE, CataloguePager } from '../catalogue/catalogue-pager.tsx';
import { LensBar } from '../catalogue/lens-bar.tsx';
import type { LensFigure, LensToken } from '../catalogue/lens-bar.tsx';
import {
    ORDER_CREATE_ON_BEHALF_PERMISSION,
    ORDER_MANAGE_PERMISSION,
    ORDER_VIEW_PERMISSION,
    SUBSCRIPTION_VIEW_PERMISSION,
} from '../entity-registry.ts';
import { kitchenOrderStatusKey } from '../ops-format.ts';
import { DeskButton, DeskSelect, DeskTabs, ListGroupRow } from '../desk-kit/index.ts';
import { KitchenPauseBanner, KitchenPauseButton } from '../order-desk/kitchen-pause.tsx';
import { useWindowName } from '../order-desk/use-window-name.ts';
import { useListPage } from '../use-list-page.ts';
import { CalendarTab, SlotScope, useSlotHours, useSlotName } from '../orders/orders-calendar.tsx';
import { DayStepper } from '../orders/day-stepper.tsx';
import { longDay, orderColumnControls, shortDay } from '../orders/order-columns.tsx';
import { useColumnControls } from '../catalogue/use-column-controls.tsx';
import type { OrderColumnContext } from '../orders/order-columns.tsx';
import {
    DATES_FILTERS,
    compareByDue,
    datesSpan,
    inSpan,
    localToday,
    matchesKind,
    matchesQuick,
    matchesSearch,
    matchesSlot,
    orderDay,
    slotKeyOf,
} from '../orders/order-book.ts';
import type {
    BookRow,
    DatesFilter,
    KindFilter,
    QuickFilter,
    StatusFilter,
} from '../orders/order-book.ts';
import { OrderRecordPopup } from '../orders/order-record-popup.tsx';
import { ORDERS_HREF, ordersParams, readOrdersQuery } from '../orders/orders-url.ts';
import type { OrdersQuery, OrdersTab } from '../orders/orders-url.ts';
import {
    ORDERS_POLL_MS,
    useDayOrders,
    useDeliveryWindows,
    useLateOrders,
    useNeedsDriverOrders,
    useToCollectOrders,
    useToConfirmOrders,
    useBookPage,
} from '../orders/use-order-book.ts';
import type { BookRead } from '../orders/use-order-book.ts';
import { useOrderSteps } from '../orders/use-order-steps.tsx';

/**
 * `/kitchen/orders` — every order the kitchen has, on one page with three tabs (the Orders
 * redesign, Option A, 2026-11-10). It replaces the Order desk, the Orders book and the Order
 * calendar, which now redirect here.
 *
 * - **Today** — one day at a time, grouped by slot, the late ones from earlier days first.
 * - **Calendar** — a month or a week; a day opens beside the grid with its orders and what to cook.
 * - **All orders** — the whole book, newest first, narrowed by dates, status, slot and kind.
 *
 * Above the tabs' lists, four figures say what needs somebody: To confirm, Late, Needs a driver and
 * Money to collect. Pressing one opens All orders on just those, with a chip to take it off.
 *
 * Every row says the day, the customer, the status, the driver and the money, and ends in the one
 * button for its next step, so nobody has to open another page to find a fact. The row opens the
 * order's pop-up — the same one from every tab — which holds everything else.
 *
 * Everything on the page is in the address (`orders-url.ts`), so New order and Edit order come back
 * to the view they left, on the order's own day, with the order lit up.
 */

export function OrdersScreen() {
    return (
        <Gate
            area="kitchen"
            requirement={{ allOf: [ORDER_VIEW_PERMISSION] }}
            testID="kitchen-orders"
        >
            <OrdersPage />
        </Gate>
    );
}

/** A clock that moves with the poll, so a slot passing turns its orders late without a reload. */
function useTickingNow(intervalMs: number): Date {
    const [now, setNow] = useState(() => new Date());
    useEffect(() => {
        const timer = setInterval(() => {
            setNow(new Date());
        }, intervalMs);
        return () => {
            clearInterval(timer);
        };
    }, [intervalMs]);
    return now;
}

const QUICK_KEYS: Readonly<Record<QuickFilter, string>> = {
    confirm: 'kitchen:orders.figure.confirm',
    late: 'kitchen:orders.figure.late',
    driver: 'kitchen:orders.figure.driver',
    collect: 'kitchen:orders.figure.collect',
};

const DATES_KEYS: Readonly<Record<DatesFilter, string>> = {
    all: 'kitchen:orders.filter.all',
    week: 'kitchen:orders.dates.week',
    next7: 'kitchen:orders.dates.next7',
    last7: 'kitchen:orders.dates.last7',
    month: 'kitchen:orders.dates.month',
};

function OrdersPage() {
    const { t } = useTranslation();
    const formatter = useFormatter();
    const router = useRouter();
    const params = useLocalSearchParams();
    const query = readOrdersQuery(params);
    const currentHref = useCurrentHref();
    const now = useTickingNow(ORDERS_POLL_MS);
    const today = localToday(now);
    const windows = useDeliveryWindows();
    const windowName = useWindowName();
    const canManage = useCan(ORDER_MANAGE_PERMISSION);
    const canSell = useCan(ORDER_CREATE_ON_BEHALF_PERMISSION);
    const canCalendar = useCan(SUBSCRIPTION_VIEW_PERMISSION);

    function update(patch: Partial<OrdersQuery>) {
        router.setParams(ordersParams({ ...query, ...patch }) as never);
    }

    const day = query.day ?? today;
    const dayRead = useDayOrders(day);
    const lateRead = useLateOrders();
    const confirmRead = useToConfirmOrders();
    const driverRead = useNeedsDriverOrders(today);
    const collectRead = useToCollectOrders(today);

    const drivers = useOrderDeskDriversQuery(canManage);
    const driverName = (userId: string): string | null =>
        drivers.data?.rows.find((driver) => driver.userId === userId)?.displayName ?? null;

    const steps = useOrderSteps({
        onRefresh: () => {
            dayRead.refetch();
            lateRead.refetch();
        },
        refreshing: dayRead.fetching,
    });

    const tab: OrdersTab = query.tab === 'calendar' && !canCalendar ? 'today' : query.tab;

    /** Pressing a figure opens All orders on just those; pressing it again takes it off. */
    function pickQuick(quick: QuickFilter) {
        if (query.quick === quick) {
            update({ quick: null });
            return;
        }
        update({
            tab: 'all',
            quick,
            dates: 'all',
            status: 'all',
            slot: 'all',
            kind: 'all',
            q: '',
            hl: null,
        });
    }

    const figureOf = (
        quick: QuickFilter,
        read: BookRead,
        count: number | null,
        tone: LensFigure['tone'],
    ): LensFigure => ({
        key: quick,
        label: t(QUICK_KEYS[quick]),
        value: read.pending ? null : count,
        ...(count === null || read.pending
            ? {}
            : {
                  display: read.truncated
                      ? t('kitchen:orders.figure.more', { count })
                      : formatter.formatNumber(count),
              }),
        tone,
        active: query.quick === quick,
        accessibilityLabel: t('kitchen:orders.figure.show', { figure: t(QUICK_KEYS[quick]) }),
        onPress: () => {
            pickQuick(quick);
        },
    });

    const figures: readonly LensFigure[] = [
        figureOf('confirm', confirmRead, confirmRead.rows.length, 'warning'),
        figureOf('late', lateRead, lateRead.count ?? lateRead.rows.length, 'danger'),
        figureOf('driver', driverRead, driverRead.rows.length, 'warning'),
        figureOf('collect', collectRead, collectRead.rows.length, 'info'),
    ];

    const columnContext: OrderColumnContext = {
        t,
        formatter,
        today,
        now,
        windows,
        windowName,
        driverName,
        onStep: canManage
            ? (order, step) => {
                  steps.run(order, step);
              }
            : null,
        pendingId: steps.pendingId,
    };

    /**
     * The row an order was opened from — drawn in its pop-up while the order is re-read — and the
     * list it was in, which the pop-up's ‹ › step through.
     */
    const [opened, setOpened] = useState<{
        readonly row: BookRow;
        readonly list: readonly BookRow[];
    } | null>(null);

    function openOrder(order: BookRow, list: readonly BookRow[] = []) {
        setOpened({ row: order, list });
        update({ view: String(order.id), hl: String(order.id) });
    }

    /** New order — for a day when one is given — and back to exactly here afterwards. */
    function newOrder(forDay: string | null) {
        const sale =
            forDay === null
                ? '/kitchen/order-desk/sale'
                : withQuery('/kitchen/order-desk/sale', { day: forDay });
        router.push(withReturnTo(sale, withQuery(currentHref, { view: null })) as never);
    }

    function openRequirements(forDay: string) {
        router.push(
            withReturnTo(
                withQuery('/kitchen/order-desk/requirements', { from: forDay, to: forDay }),
                currentHref,
            ) as never,
        );
    }

    const dayCount = dayRead.pending
        ? undefined
        : dayRead.rows.filter((row) => row.status !== 'cancelled').length;

    const tabs = [
        {
            value: 'today' as const,
            label: day === today ? t('kitchen:orders.tab.today') : shortDay(day, formatter),
            ...(dayCount === undefined ? {} : { count: dayCount }),
            testID: 'kitchen-orders-tab-today',
        },
        ...(canCalendar
            ? [
                  {
                      value: 'calendar' as const,
                      label: t('kitchen:orders.tab.calendar'),
                      testID: 'kitchen-orders-tab-calendar',
                  },
              ]
            : []),
        {
            value: 'all' as const,
            label: t('kitchen:orders.tab.all'),
            testID: 'kitchen-orders-tab-all',
        },
    ];

    const actions = (
        <View className="z-auto flex-row items-center gap-2">
            <KitchenPauseButton />
            {canSell ? (
                <DeskButton
                    testID="kitchen-orders-new"
                    variant="primary"
                    label={t('kitchen:orders.newOrder')}
                    iconStart={<Icon name="plus" size="md" className="text-content-on-brand" />}
                    onPress={() => {
                        newOrder(
                            tab === 'today' && day >= today
                                ? day
                                : tab === 'calendar' && query.sel !== null && query.sel >= today
                                  ? query.sel
                                  : null,
                        );
                    }}
                />
            ) : null}
        </View>
    );

    const tray: IssueTrayContent = {
        title: t('kitchen:tray.title'),
        testID: 'kitchen-orders-tray',
        hideWhenClear: true,
        groups: [],
    };

    return (
        <IssueTrayFrame tray={tray}>
            <Cascade space="md" testID="kitchen-orders-screen">
                <View className="z-20 flex-row flex-wrap items-center gap-3">
                    <DeskTabs<OrdersTab>
                        testID="kitchen-orders-tabs"
                        label={t('kitchen:orders.tab.label')}
                        value={tab}
                        onChange={(next) => {
                            update({ tab: next, quick: null, view: null, hl: null });
                        }}
                        items={tabs}
                    />
                    <View className="z-auto ms-auto">{actions}</View>
                </View>
                <KitchenPauseBanner />

                {tab === 'today' ? (
                    <TodayTab
                        query={query}
                        update={update}
                        day={day}
                        today={today}
                        dayRead={dayRead}
                        lateRead={lateRead}
                        figures={figures}
                        columns={columnContext}
                        canSell={canSell}
                        onOpenOrder={openOrder}
                        onNewOrder={newOrder}
                    />
                ) : tab === 'calendar' ? (
                    <CalendarTab
                        query={query}
                        update={update}
                        today={today}
                        now={now}
                        figures={figures}
                        onOpenOrder={openOrder}
                        onNewOrder={newOrder}
                        onOpenRequirements={openRequirements}
                    />
                ) : (
                    <AllOrdersTab
                        query={query}
                        update={update}
                        today={today}
                        now={now}
                        figures={figures}
                        columns={columnContext}
                        quickReads={{
                            confirm: confirmRead,
                            late: lateRead,
                            driver: driverRead,
                            collect: collectRead,
                        }}
                        onOpenOrder={openOrder}
                    />
                )}

                {query.view === null ? null : (
                    <OrderRecordPopup
                        orderId={OrderId.unsafe(query.view)}
                        steps={steps}
                        now={now}
                        today={today}
                        windowName={windowName}
                        driverName={driverName}
                        returnTo={withQuery(currentHref, { view: null })}
                        seed={opened?.row ?? null}
                        siblings={opened?.list ?? []}
                        onOpen={(row) => {
                            openOrder(row, opened?.list ?? []);
                        }}
                        onClose={() => {
                            update({ view: null });
                        }}
                    />
                )}
                {steps.dialogs}
            </Cascade>
        </IssueTrayFrame>
    );
}

/* ── shared parts ────────────────────────────────────────────────────────────────────────────── */

const KIND_FILTERS: readonly KindFilter[] = ['all', 'delivery', 'pickup', 'counter'];

function KindScope({
    value,
    onChange,
    testID,
}: {
    readonly value: KindFilter;
    readonly onChange: (kind: KindFilter) => void;
    readonly testID: string;
}) {
    const { t } = useTranslation();
    return (
        <DeskSelect<KindFilter>
            testID={testID}
            label={t('kitchen:orders.filter.kind')}
            value={value}
            onChange={onChange}
            options={KIND_FILTERS.map((kind) => ({
                value: kind,
                label: t(
                    kind === 'all' ? 'kitchen:orders.filter.all' : `kitchen:orders.kind.${kind}`,
                ),
                testID: `${testID}-${kind}`,
            }))}
        />
    );
}

/** The heading over a slot's orders — or over the late ones carried in from earlier days. */
function GroupHeading({
    title,
    sub,
    count,
    late = false,
    onSeeAll,
    testID,
}: {
    readonly title: string;
    readonly sub: string | null;
    readonly count: number;
    readonly late?: boolean | undefined;
    /** The late group's way on: the whole row opens every late order. */
    readonly onSeeAll?: (() => void) | undefined;
    readonly testID: string;
}) {
    const { t } = useTranslation();
    return (
        <ListGroupRow
            testID={testID}
            tone={late ? 'danger' : 'neutral'}
            title={title}
            sub={sub}
            count={t('kitchen:orders.count', { count })}
            {...(onSeeAll === undefined
                ? {}
                : {
                      onPress: onSeeAll,
                      actionLabel: t('kitchen:orders.group.lateAll'),
                      actionTestID: `${testID}-all`,
                  })}
        />
    );
}

/** The table, its loading and its empty states — the same for Today and All orders. */
function OrdersTable({
    read,
    rows,
    columns,
    highlighted,
    onOpenOrder,
    sectionHeader,
    empty,
    paged,
    testID,
}: {
    readonly read: Pick<BookRead, 'pending' | 'failure' | 'fetching' | 'refetch'>;
    readonly rows: readonly BookRow[];
    readonly columns: OrderColumnContext;
    readonly highlighted: string | null;
    readonly onOpenOrder: (order: BookRow, list?: readonly BookRow[]) => void;
    readonly sectionHeader?:
        ((row: BookRow, previous: BookRow | undefined) => ReactNode) | undefined;
    readonly empty: ReactNode;
    readonly paged?: ReactNode;
    readonly testID: string;
}) {
    const { t } = useTranslation();
    const allColumns = useMemo(() => orderColumnControls(columns), [columns]);
    const everyKey = useMemo(() => allColumns.map((column) => column.key), [allColumns]);
    // Every column stays drawn — this table has no column picker — and the header menus filter.
    const controls = useColumnControls(rows, allColumns, testID, {
        menuLook: 'card',
        picker: { defaults: everyKey, locked: everyKey, max: everyKey.length },
    });
    if (read.pending) {
        return <TableSkeleton testID={`${testID}-loading`} partTestID={testID} rows={8} />;
    }
    if (read.failure !== null) {
        return (
            <ErrorState
                testID={`${testID}-error`}
                title={t('kitchen:orders.loadErrorTitle')}
                failure={read.failure}
                onRetry={read.refetch}
                retrying={read.fetching}
            />
        );
    }
    return (
        <View className="flex-col gap-3">
            <CatalogueList<BookRow>
                testID={testID}
                joined
                frameEmpty
                label={t('kitchen:orders.caption')}
                columns={controls.columns}
                rows={controls.rows}
                rowKey={(row) => String(row.id)}
                density="sm"
                highlightedId={highlighted}
                onRowPress={(row) => {
                    onOpenOrder(row, controls.rows);
                }}
                rowActionsLabel={t('kitchen:list.rowActions')}
                sectionHeader={sectionHeader}
                emptyState={empty}
            />
            {paged}
        </View>
    );
}

/* ── Today ───────────────────────────────────────────────────────────────────────────────────── */

const LATE_GROUP = 'late';

/**
 * How many late orders from earlier days Today shows before its own: the oldest few, so today's
 * slots stay on the first page. The heading says how many there are and opens them all.
 */
const LATE_ON_TODAY = 5;

function TodayTab({
    query,
    update,
    day,
    today,
    dayRead,
    lateRead,
    figures,
    columns,
    canSell,
    onOpenOrder,
    onNewOrder,
}: {
    readonly query: OrdersQuery;
    readonly update: (patch: Partial<OrdersQuery>) => void;
    readonly day: string;
    readonly today: string;
    readonly dayRead: BookRead;
    readonly lateRead: BookRead;
    readonly figures: readonly LensFigure[];
    readonly columns: OrderColumnContext;
    readonly canSell: boolean;
    readonly onOpenOrder: (order: BookRow, list?: readonly BookRow[]) => void;
    readonly onNewOrder: (day: string | null) => void;
}) {
    const { t } = useTranslation();
    const { formatter } = columns;
    const slotName = useSlotName();
    const slotHours = useSlotHours();

    const passes = (row: BookRow) =>
        matchesSlot(row, query.slot) && matchesKind(row, query.kind) && matchesSearch(row, query.q);

    const late = useMemo(
        () =>
            day === today
                ? lateRead.rows
                      .filter((row) => orderDay(row) < today && passes(row))
                      .sort(compareByDue)
                : [],
        // `passes` reads only the query, which the list below names.
        // eslint-disable-next-line react-hooks/exhaustive-deps
        [day, today, lateRead.rows, query.slot, query.kind, query.q],
    );
    const lateIds = new Set(late.map((row) => String(row.id)));
    const dayRows = dayRead.rows
        .filter((row) => !lateIds.has(String(row.id)) && passes(row))
        .sort(compareByDue);
    const rows = [...late.slice(0, LATE_ON_TODAY), ...dayRows];

    const groupOf = (row: BookRow) => (lateIds.has(String(row.id)) ? LATE_GROUP : slotKeyOf(row));
    const groupCounts = new Map<string, number>([[LATE_GROUP, late.length]]);
    for (const row of dayRows) {
        groupCounts.set(groupOf(row), (groupCounts.get(groupOf(row)) ?? 0) + 1);
    }

    const filtered = query.slot !== 'all' || query.kind !== 'all' || query.q.trim() !== '';
    const read = {
        pending: dayRead.pending,
        failure: dayRead.failure,
        fetching: dayRead.fetching,
        refetch: dayRead.refetch,
    };

    return (
        <View className="z-10">
            <LensBar
                testID="kitchen-orders-today-toolbar"
                layout="split"
                compactSearch
                joined={!dayRead.pending && dayRead.failure === null}
                label={t('kitchen:orders.tab.today')}
                figures={figures}
                scope={
                    <>
                        <DayStepper
                            testID="kitchen-orders-day"
                            day={day}
                            today={today}
                            onChange={(next) => {
                                update({ day: next === today ? null : next, hl: null });
                            }}
                        />
                        <SlotScope
                            testID="kitchen-orders-today-slot"
                            value={query.slot}
                            onChange={(slot) => {
                                update({ slot });
                            }}
                        />
                        <KindScope
                            testID="kitchen-orders-today-kind"
                            value={query.kind}
                            onChange={(kind) => {
                                update({ kind });
                            }}
                        />
                    </>
                }
                search={query.q}
                onSearchChange={(q) => {
                    update({ q });
                }}
                searchLabel={t('kitchen:orders.search.label')}
                searchPlaceholder={t('kitchen:orders.search.placeholder')}
                result={
                    dayRead.pending
                        ? null
                        : t('kitchen:orders.count', { count: late.length + dayRows.length })
                }
                clearLabel={t('kitchen:orders.clearFilters')}
                {...(filtered
                    ? {
                          onClear: () => {
                              update({ slot: 'all', kind: 'all', q: '' });
                          },
                      }
                    : {})}
            />
            <OrdersTable
                testID="kitchen-orders-today-table"
                read={read}
                rows={rows}
                columns={columns}
                highlighted={query.hl}
                onOpenOrder={onOpenOrder}
                sectionHeader={(row, previous) => {
                    const group = groupOf(row);
                    if (previous !== undefined && groupOf(previous) === group) return null;
                    return group === LATE_GROUP ? (
                        <GroupHeading
                            testID="kitchen-orders-group-late"
                            late
                            title={t('kitchen:orders.group.late')}
                            sub={t('kitchen:orders.group.lateSub')}
                            count={groupCounts.get(group) ?? 0}
                            onSeeAll={() => {
                                update({
                                    tab: 'all',
                                    quick: 'late',
                                    dates: 'all',
                                    status: 'all',
                                    slot: query.slot,
                                    kind: query.kind,
                                    q: '',
                                });
                            }}
                        />
                    ) : (
                        <GroupHeading
                            testID={`kitchen-orders-group-${group}`}
                            title={slotName(group)}
                            sub={slotHours(group)}
                            count={groupCounts.get(group) ?? 0}
                        />
                    );
                }}
                empty={
                    <EmptyState
                        testID="kitchen-orders-today-empty"
                        shape="table"
                        icon={filtered ? 'searchLens' : 'receipt'}
                        title={
                            filtered
                                ? t('kitchen:orders.empty.filtered')
                                : t('kitchen:orders.empty.day', { day: longDay(day, formatter) })
                        }
                        actions={
                            filtered ? (
                                <DeskButton
                                    testID="kitchen-orders-today-clear"
                                    variant="secondary"
                                    label={t('kitchen:orders.clearFilters')}
                                    onPress={() => {
                                        update({ slot: 'all', kind: 'all', q: '' });
                                    }}
                                />
                            ) : canSell && day >= today ? (
                                <DeskButton
                                    testID="kitchen-orders-today-new"
                                    variant="secondary"
                                    label={t('kitchen:orders.newForDay')}
                                    onPress={() => {
                                        onNewOrder(day);
                                    }}
                                />
                            ) : undefined
                        }
                    />
                }
            />
        </View>
    );
}

/* ── All orders ──────────────────────────────────────────────────────────────────────────────── */

const STATUS_FILTERS: readonly StatusFilter[] = [
    'all',
    'placed',
    'confirmed',
    'fulfilled',
    'cancelled',
];

function AllOrdersTab({
    query,
    update,
    today,
    now,
    figures,
    columns,
    quickReads,
    onOpenOrder,
}: {
    readonly query: OrdersQuery;
    readonly update: (patch: Partial<OrdersQuery>) => void;
    readonly today: string;
    readonly now: Date;
    readonly figures: readonly LensFigure[];
    readonly columns: OrderColumnContext;
    readonly quickReads: Readonly<Record<QuickFilter, BookRead>>;
    readonly onOpenOrder: (order: BookRow, list?: readonly BookRow[]) => void;
}) {
    const { t } = useTranslation();
    const quick = query.quick;
    const resetKey = `${query.dates}|${query.status}|${query.slot}|${query.kind}|${query.q}`;
    const [page, setPage] = useListPage(resetKey);
    const book = useBookPage(
        {
            dates: query.dates,
            status: query.status,
            slot: query.slot,
            kind: query.kind,
            query: query.q,
            today,
            page,
            perPage: CATALOGUE_PAGE_SIZE,
        },
        quick === null,
    );

    /*
     * A figure's own list: the read behind the figure, narrowed here by the same filters. These are
     * small — the open, the late, the owed — so they are held whole and the table pages them.
     */
    const quickRows = useMemo(() => {
        if (quick === null) return [];
        const span = datesSpan(query.dates, today);
        return quickReads[quick].rows
            .filter(
                (row) =>
                    matchesQuick(row, quick, now, columns.windows) &&
                    inSpan(orderDay(row), span) &&
                    (query.status === 'all' || row.status === query.status) &&
                    matchesSlot(row, query.slot) &&
                    matchesKind(row, query.kind) &&
                    matchesSearch(row, query.q),
            )
            .sort((left, right) => -compareByDue(left, right));
    }, [quick, quickReads, query, today, now, columns.windows]);

    const read = quick === null ? book : quickReads[quick];
    const rows = quick === null ? book.rows : quickRows;
    const total = quick === null ? book.totalCount : quickRows.length;
    const filtered =
        quick !== null ||
        query.dates !== 'all' ||
        query.status !== 'all' ||
        query.slot !== 'all' ||
        query.kind !== 'all' ||
        query.q.trim() !== '';

    function clearAll() {
        update({ quick: null, dates: 'all', status: 'all', slot: 'all', kind: 'all', q: '' });
    }

    const tokens: readonly LensToken[] =
        quick === null
            ? []
            : [
                  {
                      key: 'quick',
                      label: t('kitchen:orders.showing', { figure: t(QUICK_KEYS[quick]) }),
                      removeLabel: t('kitchen:toolbar.removeFilter', {
                          filter: t(QUICK_KEYS[quick]),
                      }),
                      onRemove: () => {
                          update({ quick: null });
                      },
                  },
              ];

    return (
        <View className="z-10">
            <LensBar
                testID="kitchen-orders-all-toolbar"
                layout="split"
                compactSearch
                joined={!read.pending && read.failure === null}
                label={t('kitchen:orders.tab.all')}
                figures={figures}
                scope={
                    <>
                        <DeskSelect<DatesFilter>
                            testID="kitchen-orders-all-dates"
                            label={t('kitchen:orders.filter.dates')}
                            value={query.dates}
                            onChange={(dates) => {
                                update({ dates });
                            }}
                            options={DATES_FILTERS.map((dates) => ({
                                value: dates,
                                label: t(DATES_KEYS[dates]),
                                testID: `kitchen-orders-all-dates-${dates}`,
                            }))}
                        />
                        <DeskSelect<StatusFilter>
                            testID="kitchen-orders-all-status"
                            label={t('kitchen:orders.filter.status')}
                            value={query.status}
                            onChange={(status) => {
                                update({ status });
                            }}
                            options={STATUS_FILTERS.map((status) => ({
                                value: status,
                                label:
                                    status === 'all'
                                        ? t('kitchen:orders.filter.all')
                                        : status === 'placed'
                                          ? t('kitchen:orders.status.toConfirm')
                                          : status === 'fulfilled'
                                            ? t('kitchen:orders.status.done')
                                            : t(kitchenOrderStatusKey(status)),
                                testID: `kitchen-orders-all-status-${status}`,
                            }))}
                        />
                        <SlotScope
                            testID="kitchen-orders-all-slot"
                            value={query.slot}
                            onChange={(slot) => {
                                update({ slot });
                            }}
                        />
                        <KindScope
                            testID="kitchen-orders-all-kind"
                            value={query.kind}
                            onChange={(kind) => {
                                update({ kind });
                            }}
                        />
                    </>
                }
                search={query.q}
                onSearchChange={(q) => {
                    update({ q });
                }}
                searchLabel={t('kitchen:orders.search.label')}
                searchPlaceholder={t(
                    quick === null
                        ? 'kitchen:orders.search.numberPlaceholder'
                        : 'kitchen:orders.search.placeholder',
                )}
                tokens={tokens}
                result={
                    read.pending || total === null
                        ? null
                        : t('kitchen:orders.count', { count: total })
                }
                clearLabel={t('kitchen:orders.clearFilters')}
                {...(filtered ? { onClear: clearAll } : {})}
            />
            <OrdersTable
                testID="kitchen-orders-all-table"
                read={read}
                rows={rows}
                columns={columns}
                highlighted={query.hl}
                onOpenOrder={onOpenOrder}
                paged={
                    quick === null && book.totalPages > 1 ? (
                        <CataloguePager
                            testID="kitchen-orders-all-pagination"
                            page={page}
                            totalPages={book.totalPages}
                            onPageChange={setPage}
                            label={t('kitchen:catalogue.pagerLabel')}
                        />
                    ) : null
                }
                empty={
                    <EmptyState
                        testID="kitchen-orders-all-empty"
                        shape="table"
                        icon={filtered ? 'searchLens' : 'receipt'}
                        title={t(
                            filtered
                                ? 'kitchen:orders.empty.filtered'
                                : 'kitchen:orders.empty.book',
                        )}
                        actions={
                            filtered ? (
                                <DeskButton
                                    testID="kitchen-orders-all-clear"
                                    variant="secondary"
                                    label={t('kitchen:orders.clearFilters')}
                                    onPress={clearAll}
                                />
                            ) : undefined
                        }
                    />
                }
            />
        </View>
    );
}

export { ORDERS_HREF };
