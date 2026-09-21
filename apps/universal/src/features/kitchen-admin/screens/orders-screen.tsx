import type {
    KitchenOrder,
    KitchenOrderCancellationReason,
    KitchenOrderFilters,
    KitchenOrderLine,
    KitchenOrderStatus,
} from '@healthy360/api-client/contracts';
import {
    KITCHEN_ORDER_CANCELLATION_REASONS,
    KITCHEN_ORDER_STATUSES,
} from '@healthy360/api-client/contracts';
import {
    Badge,
    Button,
    Callout,
    Dialog,
    EmptyState,
    ErrorState,
    FilterChip,
    FormSection,
    Inline,
    Skeleton,
    Stack,
    Table,
    Text,
    useToast,
} from '@healthy360/design-system';
import type { MenuItem, RecordWindowField, TableColumn } from '@healthy360/design-system';
import { useFormatter } from '@healthy360/i18n';
import type { TFunction } from 'i18next';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { Gate, useCan } from '../../../access/gate.tsx';
import { toFailure } from '../../../data/hooks.ts';
import {
    useCancelOrderMutation,
    useConfirmOrderMutation,
    useFulfilOrderMutation,
    useKitchenOrderQuery,
    useKitchenOrdersQuery,
} from '../../../data/kitchen-orders-hooks.ts';
import { formatMoney } from '../../marketplace/format.ts';
import { CATALOGUE_ROW_ICONS } from '../catalogue/catalogue-list-item.tsx';
import { CatalogueList } from '../catalogue/catalogue-list.tsx';
import type { CatalogueColumn } from '../catalogue/catalogue-column-spec.ts';
import { CatalogueStatCards } from '../catalogue/catalogue-stat-cards.tsx';
import type { CatalogueStatCard } from '../catalogue/catalogue-stat-cards.tsx';
import { CatalogueToolbar } from '../catalogue/catalogue-toolbar.tsx';
import type { CatalogueStatusSegment } from '../catalogue/catalogue-toolbar.tsx';
import {
    compareNumber,
    compareText,
    useColumnControls,
} from '../catalogue/use-column-controls.tsx';
import type { ControlledColumn } from '../catalogue/use-column-controls.tsx';
import { EditorFrame } from '../editor-frame.tsx';
import { ORDER_MANAGE_PERMISSION, ORDER_VIEW_PERMISSION } from '../entity-registry.ts';
import { humaniseCode } from '../format.ts';
import {
    canCancelKitchenOrder,
    canConfirmKitchenOrder,
    canFulfilKitchenOrder,
    kitchenOrderCancellationReasonKey,
    kitchenOrderFulfilmentTypeKey,
    kitchenOrderRowTestId,
    kitchenOrderStatusKey,
    kitchenOrderStatusTone,
} from '../ops-format.ts';
import { useOptimisticConcurrency } from '../use-optimistic-concurrency.ts';
import { useUnsavedGuard } from '../use-unsaved-guard.ts';
import { RecordViewPage } from '../catalogue/record-view-page.tsx';
import { ColumnPicker } from '../catalogue/column-picker.tsx';

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

export function OrdersScreen() {
    return (
        <Gate
            area="kitchen"
            requirement={{ allOf: [ORDER_VIEW_PERMISSION] }}
            testID="kitchen-orders"
        >
            <Orders />
        </Gate>
    );
}

function Orders() {
    const { t } = useTranslation();
    const formatter = useFormatter();

    const [status, setStatus] = useState<StatusFilter>('all');
    /** The requested delivery day the Delivery header narrows to — sent as `requestedDeliveryDate`. */
    const [deliveryDate, setDeliveryDate] = useState<string | null>(null);
    const [query, setQuery] = useState('');
    const [cursor, setCursor] = useState<string | null>(null);
    /** The pages already read for the active filter. The current page is appended at render. */
    const [carried, setCarried] = useState<readonly KitchenOrder[]>([]);

    const [viewing, setViewing] = useState<KitchenOrder | null>(null);
    const [selected, setSelected] = useState<KitchenOrder | null>(null);

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

    const orders = useKitchenOrdersQuery(filters);
    const page = orders.data ?? null;
    const rows = useMemo(() => [...carried, ...(page?.items ?? [])], [carried, page]);

    /** A filter change is a new list: the cursor and everything carried under the old one go. */
    function changeStatus(next: StatusFilter) {
        setStatus(next);
        setCursor(null);
        setCarried([]);
        setViewing(null);
    }

    function changeDeliveryDate(next: string | null) {
        setDeliveryDate(next);
        setCursor(null);
        setCarried([]);
        setViewing(null);
    }

    function openRecord(row: KitchenOrder) {
        setViewing(null);
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
            value: (row) => formatter.formatDate(row.placedAt),
            sort: (left, right, direction) => compareText(left.placedAt, right.placedAt, direction),
            render: (row) => (
                <Text
                    variant="caption"
                    tone="secondary"
                    numberOfLines={1}
                    testID={`${kitchenOrderRowTestId(String(row.id))}-placed`}
                >
                    {formatter.formatDate(row.placedAt)}
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
                        .map((day) => ({ key: day, label: formatter.formatDate(day) })),
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
            align: 'end',
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
            align: 'end',
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

    if (selected !== null) {
        return (
            <OrderRecord
                seed={selected}
                onBack={() => {
                    setSelected(null);
                }}
            />
        );
    }

    const listFailure = toFailure(orders.error);
    const unfiltered = status === 'all' && deliveryDate === null && trimmed === '';

    const statusSegments: readonly CatalogueStatusSegment<StatusFilter>[] = [
        { value: 'all', label: t('kitchen:ops.orders.filterAll') },
        ...KITCHEN_ORDER_STATUSES.map((value) => ({
            value,
            label: t(kitchenOrderStatusKey(value)),
        })),
    ];

    if (viewing !== null) {
        return (
            <RecordViewPage
                testID="kitchen-orders-view"
                onBack={() => {
                    setViewing(null);
                }}
                title={t('kitchen:ops.orders.detailTitle', { number: viewing.orderNumber })}
                kind={t('kitchen:ops.orders.viewKind')}
                status={{
                    label: t(kitchenOrderStatusKey(viewing.status)),
                    tone: kitchenOrderStatusTone(viewing.status),
                }}
                {...(viewing.status === 'placed'
                    ? { note: t('kitchen:ops.orders.viewPlacedNote') }
                    : {})}
                fields={viewFields(viewing, t, formatter)}
                lines={<OrderLinesTable order={viewing} testID="kitchen-orders-view-lines" />}
                footNote={t('kitchen:ops.orders.cancelFinal')}
                primaryAction={{
                    label: t('kitchen:ops.orders.viewOpen'),
                    icon: null,
                    onPress: () => {
                        openRecord(viewing);
                    },
                }}
            />
        );
    }

    return (
        <Stack space="md" testID="kitchen-orders-screen">
            {orders.isPending && rows.length === 0 ? null : listFailure !== null ? null : (
                <CatalogueStatCards
                    testID="kitchen-orders-stats"
                    cards={statCards(rows, unfiltered, t, changeStatus, () => {
                        setQuery('');
                        setDeliveryDate(null);
                        changeStatus('all');
                    })}
                />
            )}

            <CatalogueToolbar<StatusFilter>
                testID="kitchen-orders-toolbar"
                search={query}
                onSearchChange={(next) => {
                    setQuery(next);
                    setCursor(null);
                    setCarried([]);
                    setViewing(null);
                }}
                searchLabel={t('kitchen:ops.orders.searchLabel')}
                searchPlaceholder={t('kitchen:ops.orders.searchHint')}
                statusLabel={t('kitchen:ops.orders.statusFilterLabel')}
                statusSegments={statusSegments}
                status={status}
                onStatusChange={changeStatus}
            >
                <ColumnPicker {...controls.picker} />
            </CatalogueToolbar>

            {orders.isPending && rows.length === 0 ? (
                <Stack space="xs" testID="kitchen-orders-loading">
                    {Array.from({ length: 5 }, (_, index) => (
                        <Skeleton
                            key={index}
                            testID={`kitchen-orders-skeleton-${String(index + 1)}`}
                            heightClassName="h-row-sm"
                        />
                    ))}
                </Stack>
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
                                onPress={() => {
                                    setQuery('');
                                    setDeliveryDate(null);
                                    changeStatus('all');
                                    controls.clearFilters();
                                }}
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
                        onRowPress={openRecord}
                        rowActionsLabel={t('kitchen:list.rowActions')}
                        rowActions={(row): readonly MenuItem[] => [
                            {
                                key: 'view',
                                label: t('kitchen:list.view'),
                                icon: CATALOGUE_ROW_ICONS.view,
                                testID: `${kitchenOrderRowTestId(String(row.id))}-view`,
                                onSelect: () => {
                                    setViewing(row);
                                },
                            },
                            {
                                key: 'open',
                                label: t('kitchen:catalogue.edit'),
                                icon: CATALOGUE_ROW_ICONS.edit,
                                testID: `${kitchenOrderRowTestId(String(row.id))}-open`,
                                onSelect: () => {
                                    openRecord(row);
                                },
                            },
                        ]}
                    />

                    <View className="flex-row flex-wrap items-center justify-between gap-tight">
                        <Text variant="caption" tone="secondary" testID="kitchen-orders-foot">
                            {t('kitchen:ops.orders.foot')}
                        </Text>
                        {page?.hasMore === true ? (
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
                        ) : (
                            <Text
                                testID="kitchen-orders-all-loaded"
                                tone="secondary"
                                variant="caption"
                            >
                                {t('kitchen:ops.orders.allLoaded')}
                            </Text>
                        )}
                    </View>
                </Stack>
            )}
        </Stack>
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
                                    label={allergen.allergenCode}
                                />
                            ))}
                        </Inline>
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
            key: 'unitPrice',
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
            rows={order.lines}
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
    const formatter = useFormatter();
    const toast = useToast();
    const canManage = useCan(ORDER_MANAGE_PERMISSION);

    const detail = useKitchenOrderQuery(seed.id);
    const confirmOrder = useConfirmOrderMutation();
    const fulfilOrder = useFulfilOrderMutation();
    const cancelOrder = useCancelOrderMutation();

    // Nothing on this page is typed, so there is never anything unsaved to guard; the frame still
    // needs the two objects it renders its dialogs from.
    const guard = useUnsavedGuard({ message: t('kitchen:unsaved.browserPrompt'), enabled: false });
    const concurrency = useOptimisticConcurrency({
        onReload: () => {
            void detail.refetch();
        },
    });

    const [cancelling, setCancelling] = useState(false);
    const [reason, setReason] = useState<KitchenOrderCancellationReason | null>(null);

    const order = detail.data ?? null;
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
                        : 'kitchen:ops.orders.fulfilledToast',
                    { number: next.orderNumber },
                ),
            });
        };
        if (action === 'confirm') confirmOrder.mutate(request, { onSuccess });
        else fulfilOrder.mutate(request, { onSuccess });
    }

    function closeCancel() {
        setCancelling(false);
        setReason(null);
    }

    function submitCancellation() {
        if (order === null || reason === null) return;
        cancelOrder.mutate(
            { id: order.id, lockVersion: order.lockVersion, reason },
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

    const forward =
        order === null || !canManage ? null : canConfirmKitchenOrder(order.status) ? (
            <Button
                testID="kitchen-orders-confirm"
                label={t('kitchen:ops.orders.confirm')}
                loading={confirmOrder.isPending}
                disabled={actionPending}
                onPress={() => {
                    transition('confirm');
                }}
            />
        ) : canFulfilKitchenOrder(order.status) ? (
            <Button
                testID="kitchen-orders-fulfil"
                label={t('kitchen:ops.orders.fulfil')}
                loading={fulfilOrder.isPending}
                disabled={actionPending}
                onPress={() => {
                    transition('fulfil');
                }}
            />
        ) : null;

    const rail =
        order === null ? undefined : (
            <Stack space="md" testID="kitchen-orders-detail-rail">
                <FormSection
                    first
                    testID="kitchen-orders-detail-totals"
                    title={t('kitchen:ops.orders.totalsHeading')}
                >
                    <Stack space="xs">
                        <FactRow
                            testID="kitchen-orders-detail-subtotal"
                            label={t('kitchen:ops.orders.subtotal')}
                            value={money(formatter, order.subtotalMinor, order.currencyCode)}
                        />
                        <FactRow
                            testID="kitchen-orders-detail-delivery-fee"
                            label={t('kitchen:ops.orders.deliveryFee')}
                            // `null` is not zero: a free delivery and an un-zoned address are
                            // different facts, and the contract keeps them apart on purpose.
                            value={
                                order.deliveryFeeMinor === null
                                    ? t('kitchen:ops.orders.noDeliveryFee')
                                    : money(formatter, order.deliveryFeeMinor, order.currencyCode)
                            }
                        />
                        <FactRow
                            testID="kitchen-orders-detail-total"
                            label={t('kitchen:ops.orders.total')}
                            value={money(formatter, order.totalMinor, order.currencyCode)}
                            strong
                        />
                        <Text variant="caption" tone="secondary">
                            {t('kitchen:ops.orders.currencyNote', {
                                currency: order.currencyCode,
                            })}
                        </Text>
                    </Stack>
                </FormSection>

                {!canManage ? null : (
                    <FormSection
                        testID="kitchen-orders-detail-actions"
                        title={t('kitchen:ops.orders.actionsHeading')}
                    >
                        <Stack space="xs">
                            {canCancelKitchenOrder(order.status) ? (
                                <View className="flex-row">
                                    <Button
                                        testID="kitchen-orders-cancel"
                                        variant="secondary"
                                        size="sm"
                                        label={t('kitchen:ops.orders.cancel')}
                                        disabled={actionPending}
                                        onPress={() => {
                                            clearActionState();
                                            setCancelling(true);
                                        }}
                                    />
                                </View>
                            ) : (
                                <Text
                                    variant="caption"
                                    tone="secondary"
                                    testID="kitchen-orders-detail-closed"
                                >
                                    {t('kitchen:ops.orders.nothingToDo')}
                                </Text>
                            )}
                            <Text variant="caption" tone="secondary">
                                {t('kitchen:ops.orders.cancelBody')}
                            </Text>
                        </Stack>
                    </FormSection>
                )}
            </Stack>
        );

    return (
        <>
            <EditorFrame
                testID="kitchen-orders-detail"
                title={t('kitchen:ops.orders.detailTitle', { number })}
                titleChip={{ label: t('kitchen:ops.orders.chip'), tone: 'warning' }}
                // No publishable meta on an order: the summary carries its status instead, which
                // also keeps the frame from stating a false "Draft · never saved".
                meta={null}
                summary={
                    <Inline space="xs" align="center" wrap>
                        {order === null ? null : (
                            <Badge
                                testID="kitchen-orders-detail-status"
                                tone={kitchenOrderStatusTone(order.status)}
                                label={t(kitchenOrderStatusKey(order.status))}
                            />
                        )}
                        {order === null ? null : (
                            <Text variant="caption" tone="secondary">
                                {t(kitchenOrderFulfilmentTypeKey(order.fulfilmentType))}
                            </Text>
                        )}
                    </Inline>
                }
                guard={guard}
                concurrency={concurrency}
                onSaveDraft={() => undefined}
                saveLabel={t('kitchen:ops.orders.confirm')}
                hideSave
                primaryAction={forward}
                onBack={onBack}
                backLabel={t('kitchen:ops.orders.backToOrders')}
                banner={
                    actionFailure === null ? null : isConflict ? (
                        <Callout
                            testID="kitchen-orders-conflict"
                            tone="warning"
                            role="alert"
                            title={t('kitchen:ops.orders.conflictTitle')}
                            body={t('kitchen:ops.orders.conflictBody')}
                            actions={
                                <Button
                                    testID="kitchen-orders-conflict-refresh"
                                    size="sm"
                                    variant="secondary"
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
                        <Text testID="kitchen-orders-action-error" tone="danger">
                            {actionFailure.message}
                        </Text>
                    )
                }
                rail={rail}
            >
                {detail.isPending ? (
                    <Skeleton testID="kitchen-orders-detail-loading" heightClassName="h-40" />
                ) : detailFailure !== null ? (
                    <ErrorState
                        testID="kitchen-orders-detail-error"
                        title={t('kitchen:ops.orders.detailLoadErrorTitle')}
                        failure={detailFailure}
                        onRetry={() => {
                            void detail.refetch();
                        }}
                        retrying={detail.isFetching}
                    />
                ) : order === null ? null : (
                    <View testID="kitchen-orders-detail-body" className="flex-col">
                        <FormSection
                            first
                            testID="kitchen-orders-detail-lines-section"
                            title={t('kitchen:ops.orders.linesHeading')}
                            aside={
                                <Text variant="caption" tone="secondary">
                                    {t('kitchen:ops.orders.lineCount', {
                                        count: order.lines.length,
                                    })}
                                </Text>
                            }
                        >
                            <OrderLinesTable order={order} testID="kitchen-orders-detail-lines" />
                        </FormSection>

                        <FormSection
                            testID="kitchen-orders-detail-delivery"
                            title={t('kitchen:ops.orders.deliveryHeading')}
                        >
                            <Stack space="xs">
                                <FactRow
                                    testID="kitchen-orders-detail-delivery-date"
                                    label={t('kitchen:ops.orders.deliveryDate')}
                                    value={
                                        order.delivery.requestedDate === null
                                            ? t('kitchen:common.notRecorded')
                                            : formatter.formatDate(order.delivery.requestedDate)
                                    }
                                />
                                <FactRow
                                    testID="kitchen-orders-detail-delivery-window"
                                    label={t('kitchen:ops.orders.deliveryWindow')}
                                    value={
                                        order.delivery.windowCode === null
                                            ? t('kitchen:common.notRecorded')
                                            : humaniseCode(order.delivery.windowCode)
                                    }
                                />
                                <FactRow
                                    testID="kitchen-orders-detail-delivery-area"
                                    label={t('kitchen:ops.orders.deliveryArea')}
                                    value={
                                        order.delivery.areaNameEn ??
                                        order.delivery.city ??
                                        t('kitchen:common.notRecorded')
                                    }
                                />
                                <FactRow
                                    testID="kitchen-orders-detail-delivery-zone"
                                    label={t('kitchen:ops.orders.deliveryZone')}
                                    value={
                                        order.delivery.zoneId === null
                                            ? t('kitchen:common.notRecorded')
                                            : String(order.delivery.zoneId)
                                    }
                                />
                                <FactRow
                                    testID="kitchen-orders-detail-delivery-address"
                                    label={t('kitchen:ops.orders.deliveryAddress')}
                                    value={addressText(order, t)}
                                />
                            </Stack>
                        </FormSection>

                        <FormSection
                            testID="kitchen-orders-detail-timeline"
                            title={t('kitchen:ops.orders.timelineHeading')}
                        >
                            <Stack space="xs">
                                <FactRow
                                    testID="kitchen-orders-detail-placed-at"
                                    label={t('kitchen:ops.orders.placedAt')}
                                    value={formatter.formatDate(order.placedAt)}
                                />
                                {/* The design states every step, recorded or not. */}
                                <FactRow
                                    testID="kitchen-orders-detail-confirmed-at"
                                    label={t('kitchen:ops.orders.confirmedAt')}
                                    value={stamp(order.confirmedAt, t, formatter)}
                                />
                                <FactRow
                                    testID="kitchen-orders-detail-fulfilled-at"
                                    label={t('kitchen:ops.orders.fulfilledAt')}
                                    value={stamp(order.fulfilledAt, t, formatter)}
                                />
                                {order.cancelledAt === null ? null : (
                                    <FactRow
                                        testID="kitchen-orders-detail-cancelled-at"
                                        label={t('kitchen:ops.orders.cancelledAt')}
                                        value={formatter.formatDate(order.cancelledAt)}
                                    />
                                )}
                                {order.cancellationReason === null ? null : (
                                    <FactRow
                                        testID="kitchen-orders-detail-cancellation-reason"
                                        label={t('kitchen:ops.orders.cancellationReason')}
                                        value={t(
                                            kitchenOrderCancellationReasonKey(
                                                order.cancellationReason,
                                            ),
                                        )}
                                    />
                                )}
                            </Stack>
                        </FormSection>
                    </View>
                )}
            </EditorFrame>

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
                            disabled={reason === null || actionPending}
                            onPress={submitCancellation}
                        />
                    </>
                }
            >
                <Stack space="sm">
                    <Text variant="strong">{t('kitchen:ops.orders.cancelReasonLabel')}</Text>
                    {/*
                     * Chips rather than a `Select`: the reason is required, there are exactly four
                     * of them and the enum is closed, so every option can be on screen at the
                     * moment of the decision instead of behind a second modal.
                     */}
                    <Inline space="xs" wrap testID="kitchen-orders-cancel-reasons">
                        {KITCHEN_ORDER_CANCELLATION_REASONS.map((candidate) => (
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
                    {cancelOrder.error === null ? null : (
                        <Text testID="kitchen-orders-cancel-error" tone="danger">
                            {toFailure(cancelOrder.error)?.message ??
                                t('kitchen:ops.orders.saveFailed')}
                        </Text>
                    )}
                </Stack>
            </Dialog>
        </>
    );
}

/* ── formatting ──────────────────────────────────────────────────────────────────────────────── */

type Formatter = ReturnType<typeof useFormatter>;

function money(
    formatter: Formatter,
    amount: number,
    currency: KitchenOrder['currencyCode'],
): string {
    return formatMoney(formatter, { amount, currency });
}

function stamp(value: string | null, t: TFunction, formatter: Formatter): string {
    return value === null ? t('kitchen:common.notRecorded') : formatter.formatDate(value);
}

/** "Delivery · 2026-09-14" — how it leaves and the day asked for. */
function deliveryText(row: KitchenOrder, t: TFunction, formatter: Formatter): string {
    const day =
        row.delivery.requestedDate === null
            ? t('kitchen:common.notRecorded')
            : formatter.formatDate(row.delivery.requestedDate);
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
            value: formatter.formatDate(row.placedAt),
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

/** Counted over the rows in hand, as the design's `CARDS` are. */
function statCards(
    rows: readonly KitchenOrder[],
    unfiltered: boolean,
    t: TFunction,
    narrow: (status: StatusFilter) => void,
    clear: () => void,
): readonly CatalogueStatCard[] {
    const count = (status: KitchenOrderStatus) =>
        rows.filter((row) => row.status === status).length;
    const awaiting = count('placed');
    const unit = t('kitchen:ops.orders.statUnit');
    return [
        {
            key: 'loaded',
            label: t('kitchen:ops.orders.metrics.loaded'),
            value: String(rows.length),
            unit,
            caption: unfiltered
                ? t('kitchen:ops.orders.statLoadedCaption')
                : t('kitchen:list.statShownFiltered'),
            mark: 'list',
            tone: 'brand',
            onPress: clear,
            accessibilityLabel: t('kitchen:list.statShownAction'),
        },
        {
            key: 'awaiting',
            label: t('kitchen:ops.orders.metrics.awaiting'),
            value: String(awaiting),
            unit,
            caption: t('kitchen:ops.orders.statAwaitingCaption'),
            mark: 'clock',
            tone: awaiting === 0 ? 'default' : 'warning',
            onPress: () => {
                narrow('placed');
            },
            accessibilityLabel: t('kitchen:ops.orders.metrics.awaiting'),
        },
        {
            key: 'confirmed',
            label: t('kitchen:ops.orders.metrics.confirmed'),
            value: String(count('confirmed')),
            unit,
            caption: t('kitchen:ops.orders.statConfirmedCaption'),
            mark: 'circleCheck',
            onPress: () => {
                narrow('confirmed');
            },
            accessibilityLabel: t('kitchen:ops.orders.metrics.confirmed'),
        },
        {
            key: 'fulfilled',
            label: t('kitchen:ops.orders.metricFulfilled'),
            value: String(count('fulfilled')),
            unit,
            caption: t('kitchen:ops.orders.statFulfilledCaption'),
            mark: 'packageCheck',
            onPress: () => {
                narrow('fulfilled');
            },
            accessibilityLabel: t('kitchen:ops.orders.metricFulfilled'),
        },
    ];
}
