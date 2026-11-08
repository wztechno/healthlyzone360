import { OrderId } from '@healthy360/domain-types';
import type {
    DeliveryFailureReason,
    KitchenOrder,
    KitchenOrderCancellationDisposition,
    KitchenOrderFilters,
    KitchenOrderLine,
    KitchenOrderPickableCancellationReason,
    KitchenOrderStatus,
} from '@healthy360/api-client/contracts';
import {
    DELIVERY_FAILURE_REASONS,
    KITCHEN_ORDER_CANCELLATION_DISPOSITIONS,
    KITCHEN_ORDER_PICKABLE_CANCELLATION_REASONS,
    KITCHEN_ORDER_STATUSES,
} from '@healthy360/api-client/contracts';
import {
    Badge,
    Button,
    Callout,
    Cascade,
    DatePickerButton,
    Dialog,
    EmptyState,
    ErrorState,
    FilterChip,
    Inline,
    Select,
    Stack,
    Table,
    TableSkeleton,
    Text,
    TextInputField,
    useToast,
} from '@healthy360/design-system';
import type { MenuItem, RecordWindowField, TableColumn } from '@healthy360/design-system';
import { useFormatter, useLocale } from '@healthy360/i18n';
import type { TFunction } from 'i18next';
import { useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { dishOptionsLine } from '../../../ui/dish-choices.tsx';
import { Gate, useCan } from '../../../access/gate.tsx';
import { useWindowName } from '../order-desk/use-window-name.ts';
import { toFailure } from '../../../data/hooks.ts';
import {
    useCancelOrderMutation,
    useCloseFailedDeliveryMutation,
    useConfirmOrderMutation,
    useFailDeliveryMutation,
    useFulfilOrderMutation,
    useKitchenOrderQuery,
    useKitchenOrdersQuery,
    useRedeliverOrderMutation,
} from '../../../data/kitchen-orders-hooks.ts';
import { useOrderDeskDeliveryWindowsQuery } from '../../../data/order-desk-hooks.ts';
import { useOnlineStatus } from '../../../online/online-status.tsx';
import { formatMoney } from '../../marketplace/format.ts';
import { CATALOGUE_ROW_ICONS } from '../catalogue/catalogue-list-item.tsx';
import { CatalogueList } from '../catalogue/catalogue-list.tsx';
import { PlanDayMeals, isPlanDayLine, visibleOrderLines } from '../plan-day-meals.tsx';
import type { CatalogueColumn } from '../catalogue/catalogue-column-spec.ts';
import { LensBar } from '../catalogue/lens-bar.tsx';
import type { LensFigure, LensMixPart, LensToken, LensTone } from '../catalogue/lens-bar.tsx';
import { RecordViewPage } from '../catalogue/record-view-page.tsx';
import type { RecordViewSection } from '../catalogue/record-view-page.tsx';
import type { RecordAction } from '../catalogue/record-popup.tsx';
import {
    compareNumber,
    compareText,
    useColumnControls,
} from '../catalogue/use-column-controls.tsx';
import type { ControlledColumn } from '../catalogue/use-column-controls.tsx';
import {
    ORDER_CREATE_ON_BEHALF_PERMISSION,
    ORDER_MANAGE_PERMISSION,
    ORDER_SUPERVISE_PERMISSION,
    ORDER_VIEW_PERMISSION,
} from '../entity-registry.ts';
import { humaniseCode } from '../format.ts';
import { OrderComplaintAction } from '../order-complaint-action.tsx';
import { OrderRefundsSection } from '../order-refunds-section.tsx';
import {
    canCancelKitchenOrder,
    canConfirmKitchenOrder,
    canFulfilKitchenOrder,
    deliveryFailureReasonKey,
    kitchenOrderCancellationDispositionKey,
    kitchenOrderCancellationReasonKey,
    kitchenOrderFulfilmentTypeKey,
    kitchenOrderRowTestId,
    kitchenOrderStatusKey,
    kitchenOrderStatusTone,
    allergenLabel,
    allergyBanner,
} from '../ops-format.ts';
import { ColumnPicker } from '../catalogue/column-picker.tsx';
import {
    useListMemory,
    useRememberedFilter,
    useRememberedOpened,
    useRememberedQuery,
} from '../list-memory.ts';
import { RECORD_NOT_FOUND, useViewedRecord } from '../use-viewed-record.ts';
import { ORDER_DESK_POLL_MS } from './order-desk-screen.tsx';

/** The order `?view=` names, read on its own when the loaded page does not hold it. */
function useOrderById(id: string | null) {
    const parsed = OrderId.safeParse(id);
    const record = useKitchenOrderQuery(parsed);
    return parsed === null ? RECORD_NOT_FOUND : record;
}

/**
 * `/kitchen/orders` — the order book (O6), drawn as the Operations handoff draws it: the Catalogue
 * list (stat cards, toolbar, `CatalogueList`, View window) and an order record page (`edOrder`).
 *
 * ```
 * ┌ LOADED ┐ ┌ AWAITING ┐ ┌ CONFIRMED ┐ ┌ FULFILLED ┐
 * [ ⌕ order number ]            [ All | Placed | Confirmed | Fulfilled | Cancelled ]
 * ORDER            PLACED    DELIVERY           ITEMS  TOTAL    STATUS   ⋯
 * Newest first. Cancelling is final and needs a reason.            [ Load more ]
 * ```
 *
 * ## Why the record is a mode of this screen and not a route
 *
 * A kitchen works the list: read the next ticket, confirm it, go back, read the one after. A route
 * would lose the filter and the pages already loaded on the way in. The record replaces the list in
 * place while the list's state stays held here, so "Back to orders" lands exactly where it left.
 *
 * ## Why the record re-reads the order it was opened from
 *
 * The row in the list carries a `lockVersion`, and the record deliberately does not use it. The
 * three actions send `If-Match`, and the version a list row was rendered from can be minutes old —
 * another tablet confirming the same order makes it stale. So the record reads the order on its own
 * (`useKitchenOrderQuery`), and each write's response is seeded straight back into that entry by
 * the hook, which is what lets "Mark fulfilled" fire immediately after "Confirm".
 *
 * ## Paging is accumulated here rather than in the hook
 *
 * `useKitchenOrdersQuery` is a plain query over one keyset page, so "Load more" carries the page it
 * already has into local state and asks for the next cursor. A keyset has no page count, which is
 * why this list keeps Load more rather than `CataloguePager`. Every filter change resets both, in
 * the setter rather than in an effect: a filter change is a *new list*.
 *
 * ## Stat cards count the rows in hand
 *
 * As the design's `CARDS` do. The endpoint publishes no totals, so "Loaded" is honest about being
 * the pages read so far, not the book.
 *
 * ## What the action buttons decide from
 *
 * `canConfirmKitchenOrder` / `canFulfilKitchenOrder` / `canCancelKitchenOrder` (`../ops-format.ts`)
 * are the same table the endpoint enforces. A button offering an illegal transition would be a
 * conflict this screen manufactured on somebody's behalf.
 *
 * ## What the design shows that has no data
 *
 * The design names the customer beside the order number. `KitchenOrder` carries no customer, so the
 * row does not either.
 */

type StatusFilter = KitchenOrderStatus | 'all';

/** The admin's one date style — "Oct 12, 2026", as every other kitchen page reads. */
const MEDIUM_DATE: Intl.DateTimeFormatOptions = { dateStyle: 'medium' };
/** A timeline step: the day and the minute, because "when did it leave" is a time question. */
const STEP_TIME: Intl.DateTimeFormatOptions = { dateStyle: 'medium', timeStyle: 'short' };

export function OrdersScreen({ view }: { readonly view?: string | undefined }) {
    return (
        <Gate
            area="kitchen"
            requirement={{ allOf: [ORDER_VIEW_PERMISSION] }}
            testID="kitchen-orders"
        >
            <Orders view={view} />
        </Gate>
    );
}

function Orders({ view }: { readonly view?: string | undefined }) {
    const { t } = useTranslation();
    const formatter = useFormatter();

    // The filters and the order last opened survive leaving the list. The pages already loaded do
    // not: they are a snapshot of a live queue, and the list re-reads from its first page.
    const memory = useListMemory('kitchen.orders');
    const [status, setStatus] = useRememberedFilter<StatusFilter>(memory, 'status', 'all');
    /** The requested delivery day the Delivery header narrows to — sent as `requestedDeliveryDate`. */
    const [deliveryDate, setDeliveryDate] = useRememberedFilter<string | null>(
        memory,
        'deliveryDate',
        null,
    );
    const [query, setQuery] = useRememberedQuery(memory);
    const [lastOpenedId, rememberOpened] = useRememberedOpened(memory);
    const [cursor, setCursor] = useState<string | null>(null);
    /** The pages already read for the active filter. The current page is appended at render. */
    const [carried, setCarried] = useState<readonly KitchenOrder[]>([]);

    const trimmed = query.trim();
    const filters = useMemo<KitchenOrderFilters>(
        () => ({
            ...(status === 'all' ? {} : { status }),
            ...(deliveryDate === null ? {} : { requestedDeliveryDate: deliveryDate }),
            ...(trimmed === '' ? {} : { query: trimmed }),
            ...(cursor === null ? {} : { cursor }),
        }),
        [status, deliveryDate, trimmed, cursor],
    );

    // Polled like the desk queue, so an order placed while the book is open appears on its own.
    // Offline the interval stops, as the desk's does.
    const { online } = useOnlineStatus();
    const orders = useKitchenOrdersQuery(filters, true, online ? ORDER_DESK_POLL_MS : false);
    const page = orders.data ?? null;
    const rows = useMemo(() => [...carried, ...(page?.items ?? [])], [carried, page]);
    // The open order is an address, `?view=`, so Back and a refresh keep it open.
    const { viewing: selected, setViewing: setSelected } = useViewedRecord(
        view,
        rows,
        (row) => String(row.id),
        orders.isSuccess && !orders.isFetching,
        { useLookup: useOrderById },
    );

    /** A filter change is a new list: the cursor and everything carried under the old one go. */
    function changeStatus(next: StatusFilter) {
        setStatus(next);
        setCursor(null);
        setCarried([]);
    }

    function changeDeliveryDate(next: string | null) {
        setDeliveryDate(next);
        setCursor(null);
        setCarried([]);
    }

    function openRecord(row: KitchenOrder) {
        rememberOpened(String(row.id));
        setSelected(row);
    }

    const columns: readonly ControlledColumn<KitchenOrder, CatalogueColumn<KitchenOrder>>[] = [
        {
            key: 'number',
            role: 'title',
            label: t('kitchen:ops.orders.columnNumber'),
            width: 180,
            priority: 100,
            value: (row) => row.orderNumber,
            sort: (left, right, direction) =>
                compareText(left.orderNumber, right.orderNumber, direction),
            render: (row) => (
                <Text
                    variant="strong"
                    numberOfLines={1}
                    testID={`${kitchenOrderRowTestId(String(row.id))}-number`}
                >
                    {row.orderNumber}
                </Text>
            ),
        },
        {
            key: 'placed',
            role: 'meta',
            label: t('kitchen:ops.orders.columnPlaced'),
            width: 130,
            priority: 70,
            value: (row) => formatter.formatDate(row.placedAt, MEDIUM_DATE),
            sort: (left, right, direction) => compareText(left.placedAt, right.placedAt, direction),
            render: (row) => (
                <Text
                    variant="caption"
                    tone="secondary"
                    numberOfLines={1}
                    testID={`${kitchenOrderRowTestId(String(row.id))}-placed`}
                >
                    {formatter.formatDate(row.placedAt, MEDIUM_DATE)}
                </Text>
            ),
        },
        {
            key: 'delivery',
            label: t('kitchen:ops.orders.columnDelivery'),
            width: 190,
            priority: 60,
            value: (row) => deliveryText(row, t, formatter),
            // Screen-owned: the day travels as `requestedDeliveryDate`, so the whole book narrows
            // rather than the pages already loaded. The days offered are the ones in hand, plus
            // the chosen one so it can always be unticked.
            filter: {
                values: (loaded) =>
                    [
                        ...new Set([
                            ...(deliveryDate === null ? [] : [deliveryDate]),
                            ...loaded
                                .map((row) => row.delivery.requestedDate)
                                .filter((day): day is string => day !== null),
                        ]),
                    ]
                        .sort((left, right) => left.localeCompare(right))
                        .map((day) => ({
                            key: day,
                            label: formatter.formatDate(day, MEDIUM_DATE),
                        })),
                external: { value: deliveryDate, onChange: changeDeliveryDate },
            },
            render: (row) => (
                <Stack space="none">
                    <Text
                        numberOfLines={1}
                        testID={`${kitchenOrderRowTestId(String(row.id))}-delivery`}
                    >
                        {deliveryText(row, t, formatter)}
                    </Text>
                    <Text variant="caption" tone="secondary" numberOfLines={1}>
                        {whereText(row, t)}
                    </Text>
                </Stack>
            ),
        },
        {
            key: 'items',
            role: 'metric',
            label: t('kitchen:ops.orders.columnItems'),
            width: 70,
            priority: 50,
            value: (row) => formatter.formatNumber(row.lineCount),
            sort: (left, right, direction) =>
                compareNumber(left.lineCount, right.lineCount, direction),
            render: (row) => (
                <Text testID={`${kitchenOrderRowTestId(String(row.id))}-items`}>
                    {formatter.formatNumber(row.lineCount)}
                </Text>
            ),
        },
        {
            key: 'total',
            role: 'metric',
            label: t('kitchen:ops.orders.columnTotal'),
            width: 110,
            priority: 85,
            value: (row) => money(formatter, row.totalMinor, row.currencyCode),
            sort: (left, right, direction) =>
                compareNumber(left.totalMinor, right.totalMinor, direction),
            render: (row) => (
                <Text variant="strong" testID={`${kitchenOrderRowTestId(String(row.id))}-total`}>
                    {money(formatter, row.totalMinor, row.currencyCode)}
                </Text>
            ),
        },
        {
            key: 'status',
            role: 'status',
            label: t('kitchen:ops.orders.columnStatus'),
            width: 100,
            priority: 80,
            value: (row) => t(kitchenOrderStatusKey(row.status)),
            // The same server-side status the toolbar's segments send, reached from the column.
            filter: {
                values: () =>
                    KITCHEN_ORDER_STATUSES.map((value) => ({
                        key: value,
                        label: t(kitchenOrderStatusKey(value)),
                    })),
                external: {
                    value: status === 'all' ? null : status,
                    onChange: (next) => {
                        changeStatus(
                            KITCHEN_ORDER_STATUSES.find((value) => value === next) ?? 'all',
                        );
                    },
                },
            },
            render: (row) => (
                <Badge
                    testID={`${kitchenOrderRowTestId(String(row.id))}-status`}
                    tone={kitchenOrderStatusTone(row.status)}
                    label={t(kitchenOrderStatusKey(row.status))}
                />
            ),
        },
    ];

    const controls = useColumnControls(rows, columns, 'kitchen-orders');

    const viewPopup =
        selected === null ? null : (
            <OrderRecord
                seed={selected}
                onBack={() => {
                    setSelected(null);
                }}
            />
        );

    const listFailure = toFailure(orders.error);
    const unfiltered = status === 'all' && deliveryDate === null && trimmed === '';

    function clearAll() {
        setQuery('');
        setDeliveryDate(null);
        changeStatus('all');
        controls.clearFilters();
    }

    const pending = orders.isPending && rows.length === 0;

    return (
        <Cascade space="md" testID="kitchen-orders-screen">
            <LensBar
                testID="kitchen-orders-toolbar"
                label={t('kitchen:lens.label')}
                // A failed read has no figures to state; they hold their placeholders over the error.
                figures={lensFigures(
                    rows,
                    pending || listFailure !== null,
                    status,
                    t,
                    changeStatus,
                )}
                {...(pending || listFailure !== null ? {} : lensMix(rows, status, t))}
                search={query}
                onSearchChange={(next) => {
                    setQuery(next);
                    setCursor(null);
                    setCarried([]);
                }}
                searchLabel={t('kitchen:ops.orders.searchLabel')}
                searchPlaceholder={t('kitchen:ops.orders.searchHint')}
                tokens={lensTokens(
                    status,
                    deliveryDate,
                    t,
                    formatter,
                    changeStatus,
                    changeDeliveryDate,
                )}
                result={
                    pending || listFailure !== null
                        ? null
                        : t('kitchen:lens.result', {
                              shown: controls.rows.length,
                              total: rows.length,
                          })
                }
                clearLabel={t('kitchen:lens.clear')}
                {...(unfiltered && !controls.filtered ? {} : { onClear: clearAll })}
                trailing={(narrow) => <ColumnPicker {...controls.picker} compact={narrow} />}
            />

            {orders.isPending && rows.length === 0 ? (
                <TableSkeleton testID="kitchen-orders-loading" partTestID="kitchen-orders" />
            ) : listFailure !== null ? (
                <ErrorState
                    testID="kitchen-orders-error"
                    title={t('kitchen:ops.orders.loadErrorTitle')}
                    failure={listFailure}
                    onRetry={() => {
                        void orders.refetch();
                    }}
                    retrying={orders.isFetching}
                />
            ) : controls.rows.length === 0 ? (
                <EmptyState
                    testID="kitchen-orders-empty"
                    title={t(
                        unfiltered
                            ? 'kitchen:ops.orders.emptyTitle'
                            : 'kitchen:ops.orders.filteredEmptyTitle',
                    )}
                    body={t(
                        unfiltered
                            ? 'kitchen:ops.orders.emptyBody'
                            : 'kitchen:ops.orders.filteredEmptyBody',
                    )}
                    actions={
                        unfiltered ? undefined : (
                            <Button
                                testID="kitchen-orders-clear"
                                variant="secondary"
                                size="sm"
                                label={t('kitchen:ops.orders.clearFilters')}
                                onPress={clearAll}
                            />
                        )
                    }
                />
            ) : (
                <Stack space="sm">
                    <CatalogueList<KitchenOrder>
                        testID="kitchen-orders-table"
                        label={t('kitchen:ops.orders.caption')}
                        columns={controls.columns}
                        rows={controls.rows}
                        rowKey={(row) => String(row.id)}
                        density="sm"
                        highlightedId={lastOpenedId}
                        onRowPress={openRecord}
                        rowActionsLabel={t('kitchen:list.rowActions')}
                        rowActions={(row): readonly MenuItem[] => [
                            {
                                key: 'view',
                                label: t('kitchen:list.view'),
                                icon: CATALOGUE_ROW_ICONS.view,
                                testID: `${kitchenOrderRowTestId(String(row.id))}-view`,
                                onSelect: () => {
                                    openRecord(row);
                                },
                            },
                        ]}
                    />

                    {page?.hasMore === true ? (
                        <View className="flex-row justify-end">
                            <Button
                                testID="kitchen-orders-load-more"
                                variant="secondary"
                                size="sm"
                                label={
                                    orders.isFetching
                                        ? t('kitchen:ops.orders.loadingMore')
                                        : t('kitchen:ops.orders.loadMore')
                                }
                                disabled={orders.isFetching || page.nextCursor === null}
                                onPress={() => {
                                    if (page.nextCursor === null) return;
                                    setCarried(rows);
                                    setCursor(page.nextCursor);
                                }}
                            />
                        </View>
                    ) : null}
                </Stack>
            )}

            {viewPopup}
        </Cascade>
    );
}

/* ── the order record (`edOrder`) ────────────────────────────────────────────────────────────── */

/** One labelled fact. Never a table: these are pairs, not a dataset. */
function FactRow({
    testID,
    label,
    value,
    strong = false,
}: {
    readonly testID: string;
    readonly label: string;
    readonly value: string;
    readonly strong?: boolean | undefined;
}) {
    return (
        <Inline space="sm" align="start" justify="between" wrap>
            <Text tone="secondary" variant="caption">
                {label}
            </Text>
            <Text testID={testID} variant={strong ? 'strong' : 'body'}>
                {value}
            </Text>
        </Inline>
    );
}

function OrderLinesTable({
    order,
    testID,
}: {
    readonly order: KitchenOrder;
    readonly testID: string;
}) {
    const { t } = useTranslation();
    const formatter = useFormatter();

    const lineColumns: readonly TableColumn<KitchenOrderLine>[] = [
        {
            key: 'name',
            header: t('kitchen:ops.orders.lineItem'),
            rowHeader: true,
            flex: 2,
            render: (line) => (
                <Stack space="none">
                    <Text variant="strong">{line.nameEn}</Text>
                    {line.variantLabel === null ? null : (
                        <Text variant="caption" tone="secondary">
                            {line.variantLabel}
                        </Text>
                    )}
                    {dishOptionsLine(line.options, 'en', t) === null ? null : (
                        <Text variant="caption" testID={`${testID}-options`}>
                            {dishOptionsLine(line.options, 'en', t)}
                        </Text>
                    )}
                    {line.note == null ? null : (
                        <Text variant="caption" testID={`${testID}-note`}>
                            {t('kitchen:dishOptions.lineNote', { note: line.note })}
                        </Text>
                    )}
                    {/* A subscription day: which dish is for which sitting, under the plan. */}
                    {isPlanDayLine(order, line) ? (
                        <PlanDayMeals order={order} testID={`${testID}-plan-day`} />
                    ) : null}
                    {line.allergens.length === 0 ? (
                        <Text variant="caption" tone="secondary">
                            {t('kitchen:ops.orders.noAllergens')}
                        </Text>
                    ) : (
                        <Inline space="xs" wrap>
                            {line.allergens.map((allergen) => (
                                <Badge
                                    key={allergen.allergenCode}
                                    tone={
                                        allergen.containment === 'contains' ? 'danger' : 'warning'
                                    }
                                    label={allergenLabel(allergen.allergenCode, t)}
                                />
                            ))}
                        </Inline>
                    )}
                </Stack>
            ),
        },
        {
            key: 'quantity',
            width: 104,
            header: t('kitchen:ops.orders.lineQuantity'),
            numeric: true,
            render: (line) => <Text>{formatter.formatNumber(Number(line.quantity))}</Text>,
        },
        {
            key: 'unitPrice',
            width: 104,
            header: t('kitchen:ops.orders.lineUnitPrice'),
            numeric: true,
            render: (line) => (
                <Text tone="secondary">
                    {money(formatter, line.unitPriceMinor, line.currencyCode)}
                </Text>
            ),
        },
        {
            key: 'lineTotal',
            width: 104,
            header: t('kitchen:ops.orders.lineTotal'),
            numeric: true,
            render: (line) => (
                <Text>{money(formatter, line.lineTotalMinor, line.currencyCode)}</Text>
            ),
        },
    ];

    return (
        <Table<KitchenOrderLine>
            testID={testID}
            caption={t('kitchen:ops.orders.linesHeading')}
            captionHidden
            columns={lineColumns}
            rows={visibleOrderLines(order)}
            rowKey={(line) => line.id}
        />
    );
}

function OrderRecord({
    seed,
    onBack,
}: {
    /** The list row it was opened from — for the title only; every fact is re-read. */
    readonly seed: KitchenOrder;
    readonly onBack: () => void;
}) {
    const { t } = useTranslation();
    const windowName = useWindowName();
    const formatter = useFormatter();
    const { locale } = useLocale();
    const toast = useToast();
    const router = useRouter();
    const canManage = useCan(ORDER_MANAGE_PERMISSION);
    const canSell = useCan(ORDER_CREATE_ON_BEHALF_PERMISSION);
    const canSupervise = useCan(ORDER_SUPERVISE_PERMISSION);

    const detail = useKitchenOrderQuery(seed.id);
    const confirmOrder = useConfirmOrderMutation();
    const fulfilOrder = useFulfilOrderMutation();
    const cancelOrder = useCancelOrderMutation();

    const [cancelling, setCancelling] = useState(false);
    const [reason, setReason] = useState<KitchenOrderPickableCancellationReason | null>(null);
    const [disposition, setDisposition] = useState<KitchenOrderCancellationDisposition | null>(
        null,
    );
    const [delivering, setDelivering] = useState(false);
    const [deliveryAction, setDeliveryAction] = useState<DeliveryAction | null>(null);

    const order = detail.data ?? null;
    // A delivery order's normal end is the driver's Mark delivered (HA-19). Closing it here is
    // the escape hatch, offered once it is ready and behind a confirmation, because it also ends
    // the driver's run (HA-29).
    const isDelivery = order?.fulfilmentType === 'delivery';
    // Cooking has started, so cancelling takes a manager and an answer about the food. Once it has
    // been picked up nobody can cancel it: it ends as delivered or failed.
    const started = (order?.preparingAt ?? order?.readyAt ?? null) !== null;
    const pickedUp = (order?.delivery.pickedUpAt ?? null) !== null;
    const run = order?.deliveryRun ?? null;
    const remakeOf = order?.remakeOf ?? null;
    // A failed run waits for a manager, and is not marked delivered until it has been sent out again.
    const failed = run?.status === 'failed';
    const courierName = run?.courierName ?? null;
    const withCourier = run?.status === 'in_transit' && courierName !== null;
    const detailFailure = toFailure(detail.error);
    const actionPending = confirmOrder.isPending || fulfilOrder.isPending || cancelOrder.isPending;
    const actionFailure =
        toFailure(confirmOrder.error) ??
        toFailure(fulfilOrder.error) ??
        toFailure(cancelOrder.error);
    const isConflict = actionFailure?.code === 'resource.conflict';

    function clearActionState() {
        confirmOrder.reset();
        fulfilOrder.reset();
        cancelOrder.reset();
    }

    function transition(action: 'confirm' | 'fulfil') {
        if (order === null) return;
        const request = { id: order.id, lockVersion: order.lockVersion };
        const onSuccess = (next: KitchenOrder) => {
            toast.show({
                testID: `kitchen-orders-${action}ed-toast`,
                tone: 'success',
                message: t(
                    action === 'confirm'
                        ? 'kitchen:ops.orders.confirmedToast'
                        : isDelivery
                          ? 'kitchen:ops.orders.deliveredToast'
                          : 'kitchen:ops.orders.fulfilledToast',
                    { number: next.orderNumber },
                ),
            });
        };
        if (action === 'confirm') confirmOrder.mutate(request, { onSuccess });
        else
            fulfilOrder.mutate(request, {
                onSuccess,
                onSettled: () => {
                    setDelivering(false);
                },
            });
    }

    function closeCancel() {
        setCancelling(false);
        setReason(null);
        setDisposition(null);
    }

    function submitCancellation() {
        if (order === null || reason === null) return;
        cancelOrder.mutate(
            {
                id: order.id,
                lockVersion: order.lockVersion,
                reason,
                ...(disposition === null ? {} : { disposition }),
            },
            {
                onSuccess: (next) => {
                    closeCancel();
                    toast.show({
                        testID: 'kitchen-orders-cancelled-toast',
                        tone: 'success',
                        message: t('kitchen:ops.orders.cancelledToast', {
                            number: next.orderNumber,
                        }),
                    });
                },
            },
        );
    }

    const number = order?.orderNumber ?? seed.orderNumber;

    // The list row draws the page at once; the re-read replaces it, so every fact is current.
    const shown = order ?? seed;

    /*
     * A confirm, fulfil or cancel the server turned down, at the head of the pop-up — a tray
     * beside the page would sit behind its backdrop. A stale version is its own banner, whose way
     * out is to read the order again; anything else keeps the server's own words.
     */
    const failureBanner =
        actionFailure === null ? undefined : isConflict ? (
            <Callout
                testID="kitchen-orders-conflict"
                tone="warning"
                role="alert"
                title={t('kitchen:ops.orders.conflictTitle')}
                actions={
                    <Button
                        testID="kitchen-orders-conflict-refresh"
                        variant="secondary"
                        size="sm"
                        label={t('kitchen:ops.orders.conflictRefresh')}
                        loading={detail.isFetching}
                        onPress={() => {
                            clearActionState();
                            void detail.refetch();
                        }}
                    />
                }
            />
        ) : (
            <Callout
                testID="kitchen-orders-action-error"
                tone="danger"
                role="alert"
                title={t('kitchen:ops.orders.saveFailed')}
                {...(actionFailure.message === undefined || actionFailure.message === null
                    ? {}
                    : { body: actionFailure.message })}
            />
        );

    // What the status tile says — no tile at all when there is nothing to say, now that its
    // buttons are behind the pop-up's ⋯.
    const runNote = order !== null && isDelivery && canFulfilKitchenOrder(order.status);
    const cancelNote =
        canManage &&
        order !== null &&
        (!canCancelKitchenOrder(order.status) || (!pickedUp && started && !canSupervise));
    const actionContent =
        !runNote && !cancelNote ? undefined : (
            <Stack space="sm">
                {order === null || !isDelivery || !canFulfilKitchenOrder(order.status) ? null : (
                    // Where the run stands, in the kitchen display's words.
                    <Text
                        variant="caption"
                        tone="secondary"
                        testID="kitchen-orders-detail-run-state"
                    >
                        {failed
                            ? [
                                  t('kitchen:ops.orders.deliveryFailedNote', {
                                      reason: t(
                                          deliveryFailureReasonKey(run.failureReason ?? 'other'),
                                      ),
                                  }),
                                  run.failureNote,
                              ]
                                  .filter((part) => part !== null && part !== undefined)
                                  .join(t('kitchen:common.listSeparator'))
                            : withCourier
                              ? t('kitchen:ops.orders.withCourier', { name: courierName })
                              : t(
                                    (order.readyAt ?? null) === null
                                        ? 'kitchen:ops.orders.notReadyYet'
                                        : (order.deliveryRun?.pickedUpAt ?? null) === null
                                          ? 'kitchen:kds.waitingForDriver'
                                          : 'kitchen:kds.withDriver',
                                )}
                    </Text>
                )}
                {!canManage || order === null ? null : !canCancelKitchenOrder(order.status) ? (
                    <Text variant="caption" tone="secondary" testID="kitchen-orders-detail-closed">
                        {t('kitchen:ops.orders.nothingToDo')}
                    </Text>
                ) : pickedUp ? null : started && !canSupervise ? (
                    <Text variant="caption" tone="secondary" testID="kitchen-orders-cancel-manager">
                        {t('kitchen:ops.orders.cancelNeedsManager')}
                    </Text>
                ) : null}
            </Stack>
        );

    // Every action the order has left, behind the pop-up's ⋯ after `forward`.
    const orderActions: RecordAction[] = [
        ...(order === null
            ? []
            : [
                  {
                      key: 'print-ticket',
                      label: t('kitchen:kds.print'),
                      icon: 'fileText' as const,
                      testID: 'kitchen-orders-print-ticket',
                      onSelect: () => {
                          router.push(
                              `/kitchen/orders/ticket?order=${encodeURIComponent(String(order.id))}` as never,
                          );
                      },
                  },
              ]),
        // A complaint's remake links back to the order complained about.
        ...(remakeOf === null
            ? []
            : [
                  {
                      key: 'remake-of',
                      label: t('kitchen:ops.orders.remakeOf', { number: remakeOf.number }),
                      icon: 'chevronBackward' as const,
                      testID: 'kitchen-orders-remake-of',
                      onSelect: () => {
                          router.push(
                              `/kitchen/orders?view=${encodeURIComponent(String(remakeOf.id))}` as never,
                          );
                      },
                  },
              ]),
        ...(order === null || !failed || !canSupervise
            ? []
            : [
                  {
                      key: 'redeliver',
                      label: t('kitchen:ops.orders.redeliver'),
                      icon: 'truck' as const,
                      testID: 'kitchen-orders-redeliver',
                      disabled: actionPending,
                      onSelect: () => {
                          setDeliveryAction('redeliver');
                      },
                  },
                  {
                      key: 'close-failed',
                      label: t('kitchen:ops.orders.closeFailed'),
                      icon: 'circleX' as const,
                      testID: 'kitchen-orders-close-failed',
                      disabled: actionPending,
                      onSelect: () => {
                          setDeliveryAction('close');
                      },
                  },
              ]),
        ...(order === null || !withCourier || !canManage
            ? []
            : [
                  {
                      key: 'fail-delivery',
                      label: t('kitchen:ops.orders.failDelivery'),
                      icon: 'alert' as const,
                      testID: 'kitchen-orders-fail-delivery',
                      disabled: actionPending,
                      onSelect: () => {
                          setDeliveryAction('fail');
                      },
                  },
              ]),
        ...(!canManage ||
        order === null ||
        !canCancelKitchenOrder(order.status) ||
        pickedUp ||
        (started && !canSupervise)
            ? []
            : [
                  {
                      key: 'cancel',
                      label: t('kitchen:ops.orders.cancel'),
                      icon: 'ban' as const,
                      tone: 'danger' as const,
                      testID: 'kitchen-orders-cancel',
                      disabled: actionPending,
                      onSelect: () => {
                          clearActionState();
                          setCancelling(true);
                      },
                  },
              ]),
        // The server's `amendable` decides; the desk's sale page edits it.
        ...(order === null || !order.amendable || !canSell
            ? []
            : [
                  {
                      key: 'edit',
                      label: t('kitchen:desk.edit.open'),
                      icon: 'pen' as const,
                      testID: 'kitchen-orders-edit',
                      separated: true,
                      onSelect: () => {
                          router.push(
                              `/kitchen/order-desk/sale?order=${encodeURIComponent(String(order.id))}`,
                          );
                      },
                  },
              ]),
    ];

    const sections: RecordViewSection[] = [
        // Right under the details, as the view drew it: what was ordered comes before where it goes.
        {
            key: 'items',
            title: t('kitchen:ops.orders.linesHeading'),
            content: (
                <View testID="kitchen-orders-detail-lines" className="flex-col gap-snug">
                    {shown.allergy === null ? null : (
                        <Callout
                            {...allergyBanner(shown.allergy, shown.lines, locale, t)}
                            testID="kitchen-orders-detail-allergy"
                        />
                    )}
                    <OrderLinesTable order={shown} testID="kitchen-orders-detail-lines-table" />
                </View>
            ),
        },
        {
            key: 'delivery',
            title: t('kitchen:ops.orders.deliveryHeading'),
            content: (
                <Stack space="xs" testID="kitchen-orders-detail-delivery">
                    <FactRow
                        testID="kitchen-orders-detail-delivery-date"
                        label={t('kitchen:ops.orders.deliveryDate')}
                        value={
                            shown.delivery.requestedDate === null
                                ? t('kitchen:common.notRecorded')
                                : formatter.formatDate(shown.delivery.requestedDate, MEDIUM_DATE)
                        }
                    />
                    <FactRow
                        testID="kitchen-orders-detail-delivery-window"
                        label={t('kitchen:ops.orders.deliveryWindow')}
                        value={
                            shown.delivery.windowCode === null
                                ? t('kitchen:common.notRecorded')
                                : windowName(shown.delivery.windowCode)
                        }
                    />
                    <FactRow
                        testID="kitchen-orders-detail-delivery-area"
                        label={t('kitchen:ops.orders.deliveryArea')}
                        value={
                            shown.delivery.areaNameEn ??
                            shown.delivery.city ??
                            t('kitchen:common.notRecorded')
                        }
                    />
                    <FactRow
                        testID="kitchen-orders-detail-delivery-zone"
                        label={t('kitchen:ops.orders.deliveryZone')}
                        value={zoneName(shown, locale) ?? t('kitchen:common.notRecorded')}
                    />
                    <FactRow
                        testID="kitchen-orders-detail-delivery-address"
                        label={t('kitchen:ops.orders.deliveryAddress')}
                        value={addressText(shown, t)}
                    />
                </Stack>
            ),
        },
        {
            key: 'timeline',
            title: t('kitchen:ops.orders.timelineHeading'),
            content: (
                <Stack space="xs" testID="kitchen-orders-detail-timeline">
                    <FactRow
                        testID="kitchen-orders-detail-placed-at"
                        label={t('kitchen:ops.orders.placedAt')}
                        value={formatter.formatDate(shown.placedAt, STEP_TIME)}
                    />
                    {/* The design states every step, recorded or not. */}
                    <FactRow
                        testID="kitchen-orders-detail-confirmed-at"
                        label={t('kitchen:ops.orders.confirmedAt')}
                        value={stamp(shown.confirmedAt, t, formatter)}
                    />
                    <FactRow
                        testID="kitchen-orders-detail-preparing-at"
                        label={t('kitchen:ops.orders.preparingAt')}
                        value={stamp(shown.preparingAt ?? null, t, formatter)}
                    />
                    <FactRow
                        testID="kitchen-orders-detail-ready-at"
                        label={t('kitchen:ops.orders.readyAt')}
                        value={stamp(shown.readyAt ?? null, t, formatter)}
                    />
                    {/*
                     * A delivery's drive (HA-19): who has it, when they collected it and when they
                     * handed it over. A pickup or counter order has no run and no rows for one.
                     */}
                    {shown.fulfilmentType !== 'delivery' ? null : (
                        <>
                            <FactRow
                                testID="kitchen-orders-detail-driver"
                                label={t('kitchen:ops.orders.driver')}
                                value={
                                    shown.deliveryRun?.courierName ??
                                    shown.deliveryRun?.driverName ??
                                    t('kitchen:ops.orders.driverNone')
                                }
                            />
                            <FactRow
                                testID="kitchen-orders-detail-picked-up-at"
                                label={t('kitchen:ops.orders.pickedUpAt')}
                                value={stamp(shown.deliveryRun?.pickedUpAt ?? null, t, formatter)}
                            />
                            <FactRow
                                testID="kitchen-orders-detail-delivered-at"
                                label={t('kitchen:ops.orders.deliveredAt')}
                                value={stamp(shown.deliveryRun?.deliveredAt ?? null, t, formatter)}
                            />
                        </>
                    )}
                    <FactRow
                        testID="kitchen-orders-detail-fulfilled-at"
                        label={t('kitchen:ops.orders.fulfilledAt')}
                        value={stamp(shown.fulfilledAt, t, formatter)}
                    />
                    {shown.cancelledAt === null ? null : (
                        <FactRow
                            testID="kitchen-orders-detail-cancelled-at"
                            label={t('kitchen:ops.orders.cancelledAt')}
                            value={formatter.formatDate(shown.cancelledAt, STEP_TIME)}
                        />
                    )}
                    {shown.cancellationReason === null ? null : (
                        <FactRow
                            testID="kitchen-orders-detail-cancellation-reason"
                            label={t('kitchen:ops.orders.cancellationReason')}
                            value={t(kitchenOrderCancellationReasonKey(shown.cancellationReason))}
                        />
                    )}
                    {(shown.cancelledByName ?? null) === null ? null : (
                        <FactRow
                            testID="kitchen-orders-detail-cancelled-by"
                            label={t('kitchen:ops.orders.cancelledBy')}
                            value={shown.cancelledByName ?? ''}
                        />
                    )}
                    {(shown.cancellationDisposition ?? null) === null ? null : (
                        <FactRow
                            testID="kitchen-orders-detail-cancellation-disposition"
                            label={t('kitchen:ops.orders.dispositionLabel')}
                            value={t(
                                kitchenOrderCancellationDispositionKey(
                                    shown.cancellationDisposition ?? 'returned',
                                ),
                            )}
                        />
                    )}
                </Stack>
            ),
        },
    ];
    if (detailFailure !== null) {
        sections.unshift({
            key: 'error',
            title: t('kitchen:ops.orders.detailLoadErrorTitle'),
            tone: 'warning',
            content: (
                <ErrorState
                    testID="kitchen-orders-detail-error"
                    title={t('kitchen:ops.orders.detailLoadErrorTitle')}
                    failure={detailFailure}
                    onRetry={() => {
                        void detail.refetch();
                    }}
                    retrying={detail.isFetching}
                />
            ),
        });
    }

    if (order !== null && canSupervise) {
        sections.push({
            key: 'refunds',
            title: t('kitchen:ops.orders.refunds.heading'),
            content: <OrderRefundsSection order={order} />,
        });
        sections.push({
            key: 'complaint',
            title: t('kitchen:complaints.sectionTitle'),
            content: <OrderComplaintAction order={order} />,
        });
    }

    const totals: RecordViewSection = {
        key: 'totals',
        title: t('kitchen:ops.orders.totalsHeading'),
        content: (
            <Stack space="xs" testID="kitchen-orders-detail-totals">
                <FactRow
                    testID="kitchen-orders-detail-subtotal"
                    label={t('kitchen:ops.orders.subtotal')}
                    value={money(formatter, shown.subtotalMinor, shown.currencyCode)}
                />
                <FactRow
                    testID="kitchen-orders-detail-delivery-fee"
                    label={t('kitchen:ops.orders.deliveryFee')}
                    // `null` is not zero: a free delivery and an un-zoned address are different
                    // facts, and the contract keeps them apart on purpose.
                    value={
                        shown.deliveryFeeMinor === null
                            ? t('kitchen:ops.orders.noDeliveryFee')
                            : money(formatter, shown.deliveryFeeMinor, shown.currencyCode)
                    }
                />
                <FactRow
                    testID="kitchen-orders-detail-total"
                    label={t('kitchen:ops.orders.total')}
                    value={money(formatter, shown.totalMinor, shown.currencyCode)}
                    strong
                />
            </Stack>
        ),
    };

    // The status card's one button moves the order forward; Cancel sits above it.
    const forward =
        order === null || !canManage
            ? undefined
            : canConfirmKitchenOrder(order.status)
              ? {
                    label: t('kitchen:ops.orders.confirm'),
                    icon: null,
                    testID: 'kitchen-orders-confirm',
                    loading: confirmOrder.isPending,
                    disabled: actionPending,
                    onPress: () => {
                        transition('confirm');
                    },
                }
              : canFulfilKitchenOrder(order.status) && isDelivery
                ? (order.readyAt ?? null) === null || failed
                    ? undefined
                    : {
                          label: t('kitchen:ops.orders.markDelivered'),
                          icon: null,
                          testID: 'kitchen-orders-mark-delivered',
                          loading: fulfilOrder.isPending,
                          disabled: actionPending,
                          onPress: () => {
                              clearActionState();
                              setDelivering(true);
                          },
                      }
                : canFulfilKitchenOrder(order.status)
                  ? {
                        label: t('kitchen:ops.orders.fulfil'),
                        icon: null,
                        testID: 'kitchen-orders-fulfil',
                        loading: fulfilOrder.isPending,
                        disabled: actionPending,
                        onPress: () => {
                            transition('fulfil');
                        },
                    }
                  : undefined;

    return (
        <>
            <RecordViewPage
                testID="kitchen-orders-detail"
                banner={failureBanner}
                onBack={onBack}
                title={t('kitchen:ops.orders.detailTitle', { number })}
                kind={t('kitchen:ops.orders.viewKind')}
                status={{
                    label: t(kitchenOrderStatusKey(shown.status)),
                    tone: kitchenOrderStatusTone(shown.status),
                }}
                titleAside={
                    <Text variant="caption" tone="secondary">
                        {t(kitchenOrderFulfilmentTypeKey(shown.fulfilmentType))}
                    </Text>
                }
                {...(shown.status === 'placed'
                    ? { note: t('kitchen:ops.orders.viewPlacedNote') }
                    : {})}
                fields={viewFields(shown, t, formatter)}
                sections={sections}
                rail={[totals]}
                statusContent={actionContent}
                footNote={t('kitchen:ops.orders.cancelFinal')}
                primaryAction={forward}
                actions={orderActions}
            />

            <Dialog
                testID="kitchen-orders-mark-delivered-dialog"
                open={delivering && order !== null}
                onClose={() => {
                    setDelivering(false);
                }}
                title={t('kitchen:ops.orders.markDeliveredTitle', { number })}
                description={t('kitchen:ops.orders.markDeliveredBody')}
                actions={
                    <>
                        <Button
                            testID="kitchen-orders-mark-delivered-dismiss"
                            variant="quiet"
                            label={t('kitchen:ops.orders.markDeliveredDismiss')}
                            onPress={() => {
                                setDelivering(false);
                            }}
                        />
                        <Button
                            testID="kitchen-orders-mark-delivered-confirm"
                            label={t('kitchen:ops.orders.markDelivered')}
                            loading={fulfilOrder.isPending}
                            disabled={actionPending}
                            onPress={() => {
                                transition('fulfil');
                            }}
                        />
                    </>
                }
            />

            <Dialog
                testID="kitchen-orders-cancel-dialog"
                open={cancelling && order !== null}
                onClose={closeCancel}
                title={t('kitchen:ops.orders.cancelTitle', { number })}
                description={t('kitchen:ops.orders.cancelBody')}
                actions={
                    <>
                        <Button
                            testID="kitchen-orders-cancel-dismiss"
                            variant="quiet"
                            label={t('kitchen:ops.orders.cancelDismiss')}
                            onPress={closeCancel}
                        />
                        <Button
                            testID="kitchen-orders-cancel-confirm"
                            variant="danger"
                            label={t('kitchen:ops.orders.cancelConfirm')}
                            loading={cancelOrder.isPending}
                            disabled={
                                reason === null ||
                                (started && disposition === null) ||
                                actionPending
                            }
                            onPress={submitCancellation}
                        />
                    </>
                }
            >
                <Stack space="sm">
                    <Text variant="strong">{t('kitchen:ops.orders.cancelReasonLabel')}</Text>
                    {/*
                     * Chips rather than a `Select`: the reason is required, there are exactly four
                     * a person can pick and the enum is closed, so every option can be on screen at
                     * the moment of the decision instead of behind a second modal.
                     */}
                    <Inline space="xs" wrap testID="kitchen-orders-cancel-reasons">
                        {KITCHEN_ORDER_PICKABLE_CANCELLATION_REASONS.map((candidate) => (
                            <FilterChip
                                key={candidate}
                                testID={`kitchen-orders-cancel-reason-${candidate}`}
                                label={t(kitchenOrderCancellationReasonKey(candidate))}
                                selected={reason === candidate}
                                onChange={() => {
                                    setReason(candidate);
                                }}
                            />
                        ))}
                    </Inline>
                    {!started ? null : (
                        <>
                            <Text variant="strong">{t('kitchen:ops.orders.dispositionLabel')}</Text>
                            <Inline space="xs" wrap testID="kitchen-orders-cancel-dispositions">
                                {KITCHEN_ORDER_CANCELLATION_DISPOSITIONS.map((candidate) => (
                                    <FilterChip
                                        key={candidate}
                                        testID={`kitchen-orders-cancel-disposition-${candidate}`}
                                        label={t(kitchenOrderCancellationDispositionKey(candidate))}
                                        selected={disposition === candidate}
                                        onChange={() => {
                                            setDisposition(candidate);
                                        }}
                                    />
                                ))}
                            </Inline>
                        </>
                    )}
                    {cancelOrder.error === null ? null : (
                        <Text testID="kitchen-orders-cancel-error" tone="danger">
                            {toFailure(cancelOrder.error)?.message ??
                                t('kitchen:ops.orders.saveFailed')}
                        </Text>
                    )}
                </Stack>
            </Dialog>

            {deliveryAction === null || order === null ? null : (
                <DeliveryActionDialog
                    action={deliveryAction}
                    order={order}
                    onClose={() => {
                        setDeliveryAction(null);
                    }}
                />
            )}
        </>
    );
}

type DeliveryAction = 'fail' | 'redeliver' | 'close';

/** The empty choice in the window picker: the order keeps the one it has. */
const KEEP_WINDOW = '';

/**
 * What the kitchen does about a run: say a courier's delivery failed, send a failed one out again,
 * or close it. Mounted only while open, so every opening starts clean.
 */
function DeliveryActionDialog({
    action,
    order,
    onClose,
}: {
    readonly action: DeliveryAction;
    readonly order: KitchenOrder;
    readonly onClose: () => void;
}) {
    const { t } = useTranslation();
    const { locale } = useLocale();
    const toast = useToast();
    // Open to the desk and to supervisors. Anyone else can still move the day.
    const canBook = useCan(ORDER_CREATE_ON_BEHALF_PERMISSION);
    const canSupervise = useCan(ORDER_SUPERVISE_PERMISSION);
    const windows = useOrderDeskDeliveryWindowsQuery(
        action === 'redeliver' && (canBook || canSupervise),
    );

    const failDelivery = useFailDeliveryMutation();
    const redeliver = useRedeliverOrderMutation();
    const closeFailed = useCloseFailedDeliveryMutation();

    const [reason, setReason] = useState<DeliveryFailureReason | null>(null);
    const [note, setNote] = useState('');
    const [date, setDate] = useState('');
    const [window, setWindow] = useState(KEEP_WINDOW);
    const [disposition, setDisposition] = useState<KitchenOrderCancellationDisposition | null>(
        null,
    );

    const pending = failDelivery.isPending || redeliver.isPending || closeFailed.isPending;
    const failure =
        toFailure(failDelivery.error) ?? toFailure(redeliver.error) ?? toFailure(closeFailed.error);
    const ready =
        action === 'fail' ? reason !== null : action === 'close' ? disposition !== null : true;
    const number = order.orderNumber;

    function done(message: string) {
        onClose();
        toast.show({ testID: 'kitchen-orders-delivery-toast', tone: 'success', message });
    }

    function submit() {
        const version = { id: order.id, lockVersion: order.lockVersion };
        if (action === 'fail' && reason !== null) {
            failDelivery.mutate(
                { id: order.id, reason, note },
                { onSuccess: () => done(t('kitchen:ops.orders.failedToast', { number })) },
            );
        } else if (action === 'close' && disposition !== null) {
            closeFailed.mutate(
                { ...version, disposition },
                { onSuccess: () => done(t('kitchen:ops.orders.closedFailedToast', { number })) },
            );
        } else if (action === 'redeliver') {
            redeliver.mutate(
                {
                    ...version,
                    ...(date === '' ? {} : { date }),
                    ...(window === KEEP_WINDOW ? {} : { window }),
                },
                { onSuccess: () => done(t('kitchen:ops.orders.redeliveredToast', { number })) },
            );
        }
    }

    return (
        <Dialog
            testID="kitchen-orders-delivery-dialog"
            open
            onClose={onClose}
            title={t(`kitchen:ops.orders.deliveryAction.${action}Title`, { number })}
            description={t(`kitchen:ops.orders.deliveryAction.${action}Body`)}
            actions={
                <>
                    <Button
                        testID="kitchen-orders-delivery-dismiss"
                        variant="quiet"
                        label={t('kitchen:common.cancel')}
                        onPress={onClose}
                    />
                    <Button
                        testID="kitchen-orders-delivery-confirm"
                        {...(action === 'redeliver' ? {} : { variant: 'danger' as const })}
                        label={t(`kitchen:ops.orders.deliveryAction.${action}Confirm`)}
                        loading={pending}
                        disabled={!ready || pending}
                        onPress={submit}
                    />
                </>
            }
        >
            <Stack space="sm">
                {action !== 'fail' ? null : (
                    <>
                        <Text variant="strong">{t('kitchen:driver.failReasonLabel')}</Text>
                        <Inline space="xs" wrap testID="kitchen-orders-delivery-reasons">
                            {DELIVERY_FAILURE_REASONS.map((candidate) => (
                                <FilterChip
                                    key={candidate}
                                    testID={`kitchen-orders-delivery-reason-${candidate}`}
                                    label={t(deliveryFailureReasonKey(candidate))}
                                    selected={reason === candidate}
                                    onChange={() => {
                                        setReason(candidate);
                                    }}
                                />
                            ))}
                        </Inline>
                        <TextInputField
                            testID="kitchen-orders-delivery-note"
                            id="kitchen-orders-delivery-note"
                            label={t('kitchen:driver.failNoteLabel')}
                            value={note}
                            onChangeText={setNote}
                            multiline
                            maxLength={1000}
                        />
                    </>
                )}
                {action !== 'redeliver' ? null : (
                    <>
                        <DatePickerButton
                            testID="kitchen-orders-delivery-date"
                            label={t('kitchen:ops.orders.deliveryAction.dateLabel')}
                            labelVisible
                            placeholder={t('kitchen:ops.orders.deliveryAction.keepDate')}
                            value={date}
                            onChange={setDate}
                            onClear={() => {
                                setDate('');
                            }}
                        />
                        {(windows.data ?? []).length === 0 ? null : (
                            <Select<string>
                                testID="kitchen-orders-delivery-window"
                                label={t('kitchen:ops.orders.deliveryWindow')}
                                size="sm"
                                value={window}
                                onChange={setWindow}
                                options={[
                                    {
                                        value: KEEP_WINDOW,
                                        label: t('kitchen:ops.orders.deliveryAction.keepWindow'),
                                    },
                                    ...(windows.data ?? []).map((candidate) => ({
                                        value: candidate.code,
                                        label: locale.toLowerCase().startsWith('ar')
                                            ? candidate.nameAr
                                            : candidate.nameEn,
                                    })),
                                ]}
                            />
                        )}
                    </>
                )}
                {action !== 'close' ? null : (
                    <>
                        <Text variant="strong">{t('kitchen:ops.orders.dispositionLabel')}</Text>
                        <Inline space="xs" wrap testID="kitchen-orders-delivery-dispositions">
                            {KITCHEN_ORDER_CANCELLATION_DISPOSITIONS.map((candidate) => (
                                <FilterChip
                                    key={candidate}
                                    testID={`kitchen-orders-delivery-disposition-${candidate}`}
                                    label={t(kitchenOrderCancellationDispositionKey(candidate))}
                                    selected={disposition === candidate}
                                    onChange={() => {
                                        setDisposition(candidate);
                                    }}
                                />
                            ))}
                        </Inline>
                    </>
                )}
                {failure === null ? null : (
                    <Text testID="kitchen-orders-delivery-error" tone="danger" role="alert">
                        {failure.message}
                    </Text>
                )}
            </Stack>
        </Dialog>
    );
}

/* ── formatting ──────────────────────────────────────────────────────────────────────────────── */

type Formatter = ReturnType<typeof useFormatter>;

function viewFields(
    row: KitchenOrder,
    t: TFunction,
    formatter: Formatter,
): readonly RecordWindowField[] {
    return [
        {
            key: 'reference',
            label: t('kitchen:ops.orders.columnNumber'),
            value: row.orderNumber,
            mono: true,
        },
        {
            key: 'placed',
            label: t('kitchen:ops.orders.columnPlaced'),
            value: formatter.formatDate(row.placedAt, MEDIUM_DATE),
            mono: true,
        },
        {
            key: 'delivery',
            label: t('kitchen:ops.orders.columnDelivery'),
            value: `${deliveryText(row, t, formatter)} · ${whereText(row, t)}`,
        },
        {
            key: 'items',
            label: t('kitchen:ops.orders.columnItems'),
            value: formatter.formatNumber(row.lineCount),
            mono: true,
        },
        {
            key: 'total',
            label: t('kitchen:ops.orders.columnTotal'),
            value: money(formatter, row.totalMinor, row.currencyCode),
            mono: true,
        },
    ];
}

function money(
    formatter: Formatter,
    amount: number,
    currency: KitchenOrder['currencyCode'],
): string {
    return formatMoney(formatter, { amount, currency });
}

/**
 * The zone the order fell into, by name in the reader's language or the other one (HA-21). Never
 * the identifier: a kitchen reads "Inner city", and a code on the page reads as a fault.
 */
function zoneName(order: KitchenOrder, locale: string): string | null {
    const arabic = locale.toLowerCase().startsWith('ar');
    const preferred = arabic ? order.delivery.zoneNameAr : order.delivery.zoneNameEn;
    const other = arabic ? order.delivery.zoneNameEn : order.delivery.zoneNameAr;
    return preferred ?? other ?? null;
}

function stamp(value: string | null, t: TFunction, formatter: Formatter): string {
    return value === null
        ? t('kitchen:common.notRecorded')
        : formatter.formatDate(value, STEP_TIME);
}

/** "Delivery · 2026-09-14" — how it leaves and the day asked for. */
function deliveryText(row: KitchenOrder, t: TFunction, formatter: Formatter): string {
    const day =
        row.delivery.requestedDate === null
            ? t('kitchen:common.notRecorded')
            : formatter.formatDate(row.delivery.requestedDate, MEDIUM_DATE);
    return `${t(kitchenOrderFulfilmentTypeKey(row.fulfilmentType))} · ${day}`;
}

/** The window and the area, whichever are recorded. */
function whereText(row: KitchenOrder, t: TFunction): string {
    const parts = [
        row.delivery.windowCode === null ? null : humaniseCode(row.delivery.windowCode),
        row.delivery.areaNameEn ?? row.delivery.city,
    ].filter((part): part is string => part !== null && part !== '');
    return parts.length === 0 ? t('kitchen:common.notRecorded') : parts.join(' · ');
}

function addressText(order: KitchenOrder, t: TFunction): string {
    const parts = [order.delivery.lineOne, order.delivery.lineTwo].filter(
        (part): part is string => part !== null && part !== '',
    );
    return parts.length === 0
        ? t('kitchen:common.notRecorded')
        : parts.join(t('kitchen:common.listSeparator'));
}

const STATUS_LENS_TONES: Readonly<Record<KitchenOrderStatus, LensTone>> = {
    placed: 'warning',
    confirmed: 'info',
    fulfilled: 'success',
    cancelled: 'neutral',
};

/**
 * The Lens bar's figures: All, then one per status. Counted over the rows in hand, as the design's
 * `CARDS` are — this endpoint answers no total.
 */
function lensFigures(
    rows: readonly KitchenOrder[],
    pending: boolean,
    status: StatusFilter,
    t: TFunction,
    narrow: (status: StatusFilter) => void,
): readonly LensFigure[] {
    const count = (value: KitchenOrderStatus) =>
        pending ? null : rows.filter((row) => row.status === value).length;
    return [
        {
            key: 'all',
            label: t('kitchen:lens.allOrders'),
            value: pending ? null : rows.length,
            active: status === 'all',
            onPress: () => {
                narrow('all');
            },
            accessibilityLabel: t('kitchen:lens.allAction'),
        },
        ...KITCHEN_ORDER_STATUSES.map((value, index): LensFigure => ({
            key: value,
            label: t(kitchenOrderStatusKey(value)),
            value: count(value),
            tone: STATUS_LENS_TONES[value],
            separated: index === 0,
            active: status === value,
            onPress: () => {
                narrow(value);
            },
            accessibilityLabel: t('kitchen:lens.showOnlyStatus', {
                status: t(kitchenOrderStatusKey(value)),
            }),
        })),
    ];
}

/** How the rows in hand divide between the statuses, and the same in words. */
function lensMix(
    rows: readonly KitchenOrder[],
    status: StatusFilter,
    t: TFunction,
): { readonly mix: readonly LensMixPart[]; readonly mixLabel: string } {
    const count = (value: KitchenOrderStatus) => rows.filter((row) => row.status === value).length;
    return {
        mix: KITCHEN_ORDER_STATUSES.map((value) => ({
            key: value,
            value: count(value),
            tone: STATUS_LENS_TONES[value],
            dimmed: status !== 'all' && status !== value,
        })),
        mixLabel: t('kitchen:lens.ordersMix', {
            placed: count('placed'),
            confirmed: count('confirmed'),
            fulfilled: count('fulfilled'),
            cancelled: count('cancelled'),
        }),
    };
}

/** The status and the delivery day in force, each removable on its own. */
function lensTokens(
    status: StatusFilter,
    deliveryDate: string | null,
    t: TFunction,
    formatter: Formatter,
    changeStatus: (next: StatusFilter) => void,
    changeDeliveryDate: (next: string | null) => void,
): readonly LensToken[] {
    const token = (key: string, label: string, onRemove: () => void): LensToken => ({
        key,
        label,
        removeLabel: t('kitchen:toolbar.removeFilter', { filter: label }),
        onRemove,
    });
    return [
        ...(status === 'all'
            ? []
            : [
                  token(
                      'status',
                      t('kitchen:lens.token', {
                          label: t('kitchen:ops.orders.statusFilterLabel'),
                          value: t(kitchenOrderStatusKey(status)),
                      }),
                      () => {
                          changeStatus('all');
                      },
                  ),
              ]),
        ...(deliveryDate === null
            ? []
            : [
                  token(
                      'delivery',
                      t('kitchen:lens.token', {
                          label: t('kitchen:ops.orders.columnDelivery'),
                          value: formatter.formatDate(deliveryDate, MEDIUM_DATE),
                      }),
                      () => {
                          changeDeliveryDate(null);
                      },
                  ),
              ]),
    ];
}
