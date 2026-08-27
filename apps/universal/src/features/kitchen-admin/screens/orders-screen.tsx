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
    Drawer,
    EmptyState,
    ErrorState,
    FilterChip,
    Heading,
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
import type { OrderId } from '@healthy360/domain-types';
import { useFormatter } from '@healthy360/i18n';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

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
import { ORDER_MANAGE_PERMISSION, ORDER_VIEW_PERMISSION } from '../entity-registry.ts';
import { humaniseCode } from '../format.ts';
import {
    canCancelKitchenOrder,
    canConfirmKitchenOrder,
    canFulfilKitchenOrder,
    kitchenOrderCancellationReasonKey,
    kitchenOrderRowTestId,
    kitchenOrderStatusKey,
    kitchenOrderStatusTone,
} from '../ops-format.ts';
import { OpsPanel } from '../ops-panel.tsx';
import type { OpsMetric } from '../ops-panel.tsx';

/**
 * `/kitchen/orders` — the order book (O6), and the first screen in this workspace that *writes to a
 * lock-versioned resource from a panel rather than an editor*.
 *
 * ## Why the detail is a slide-in and not a route
 *
 * A kitchen works the list: read the next ticket, confirm it, go back, read the one after. A route
 * would put a navigation and a back press either side of every one of those, and would lose the
 * filter the person set on the way in. The panel keeps the list behind it, which is also what makes
 * confirm → fulfil possible without the list ever refetching.
 *
 * ## Why the panel re-reads the order it was opened from
 *
 * The row in the list carries a `lockVersion`, and the panel deliberately does not use it. The three
 * actions send `If-Match`, and the version a list row was rendered from can be minutes old — another
 * tablet confirming the same order makes it stale, and sending it would earn a `resource.conflict`
 * the person did nothing to deserve. So the panel reads the order on its own
 * (`useKitchenOrderQuery`), and each write's response is seeded straight back into that entry by the
 * hook, which is what lets "Fulfil" fire immediately after "Confirm" with a version the server will
 * accept.
 *
 * ## Paging is accumulated here rather than in the hook
 *
 * `useKitchenOrdersQuery` is a plain query over one keyset page, so "Load more" carries the page it
 * already has into local state and asks for the next cursor. Every filter change resets both, in the
 * setter rather than in an effect: a filter change is a *new list*, and carrying rows across one
 * would show a person orders that do not match what they asked for. The alternative — an infinite
 * query in the data layer — is a change to the client slice, not to this screen.
 *
 * ## What the action buttons decide from
 *
 * `canConfirmKitchenOrder` / `canFulfilKitchenOrder` / `canCancelKitchenOrder` (`../ops-format.ts`)
 * are the same table the mock store enforces and the real endpoint enforces. A button that offered
 * an illegal transition would be a conflict this screen manufactured on somebody's behalf.
 *
 * The panel's own container is `kitchen-orders-detail-body` rather than `-content`, because
 * `Drawer` already publishes `${testID}-content` for its scroller and two nodes under one id is a
 * query that silently finds the wrong one.
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

/** One labelled fact in the detail panel. Never a table: these are pairs, not a dataset. */
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

function Orders() {
    const { t } = useTranslation();
    const formatter = useFormatter();
    const toast = useToast();
    const canManage = useCan(ORDER_MANAGE_PERMISSION);

    const [status, setStatus] = useState<StatusFilter>('all');
    const [query, setQuery] = useState('');
    const [cursor, setCursor] = useState<string | null>(null);
    /** The pages already read for the active filter. The current page is appended at render. */
    const [carried, setCarried] = useState<readonly KitchenOrder[]>([]);

    const [selectedId, setSelectedId] = useState<OrderId | null>(null);
    const [cancelling, setCancelling] = useState(false);
    const [reason, setReason] = useState<KitchenOrderCancellationReason | null>(null);

    const trimmed = query.trim();
    const filters = useMemo<KitchenOrderFilters>(
        () => ({
            ...(status === 'all' ? {} : { status }),
            ...(trimmed === '' ? {} : { query: trimmed }),
            ...(cursor === null ? {} : { cursor }),
        }),
        [status, trimmed, cursor],
    );

    const orders = useKitchenOrdersQuery(filters);
    const detail = useKitchenOrderQuery(selectedId);

    const confirmOrder = useConfirmOrderMutation();
    const fulfilOrder = useFulfilOrderMutation();
    const cancelOrder = useCancelOrderMutation();

    const page = orders.data ?? null;
    const rows = useMemo(() => [...carried, ...(page?.items ?? [])], [carried, page]);

    /** A filter change is a new list: the cursor and everything carried under the old one go. */
    function resetPaging() {
        setCursor(null);
        setCarried([]);
    }

    const metrics: readonly OpsMetric[] = [
        {
            key: 'loaded',
            labelKey: 'kitchen:ops.orders.metrics.loaded',
            value: orders.isPending ? null : rows.length,
        },
        {
            key: 'awaiting',
            labelKey: 'kitchen:ops.orders.metrics.awaiting',
            value: orders.isPending ? null : rows.filter((row) => row.status === 'placed').length,
        },
        {
            key: 'confirmed',
            labelKey: 'kitchen:ops.orders.metrics.confirmed',
            value: orders.isPending
                ? null
                : rows.filter((row) => row.status === 'confirmed').length,
        },
    ];

    const order = detail.data ?? null;
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

    function closeDetail() {
        setSelectedId(null);
        setCancelling(false);
        setReason(null);
        clearActionState();
    }

    function openDetail(orderId: OrderId) {
        clearActionState();
        setSelectedId(orderId);
    }

    const columns: readonly TableColumn<KitchenOrder>[] = [
        {
            key: 'number',
            header: t('kitchen:ops.orders.columnNumber'),
            rowHeader: true,
            flex: 2,
            render: (row) => (
                <Text
                    variant="bodyStrong"
                    testID={`${kitchenOrderRowTestId(String(row.id))}-number`}
                >
                    {row.orderNumber}
                </Text>
            ),
        },
        {
            key: 'status',
            header: t('kitchen:ops.orders.columnStatus'),
            render: (row) => (
                <Badge
                    testID={`${kitchenOrderRowTestId(String(row.id))}-status`}
                    tone={kitchenOrderStatusTone(row.status)}
                    label={t(kitchenOrderStatusKey(row.status))}
                />
            ),
        },
        {
            key: 'placed',
            header: t('kitchen:ops.orders.columnPlaced'),
            render: (row) => (
                <Text
                    variant="caption"
                    tone="secondary"
                    testID={`${kitchenOrderRowTestId(String(row.id))}-placed`}
                >
                    {formatter.formatDate(row.placedAt)}
                </Text>
            ),
        },
        {
            key: 'delivery',
            header: t('kitchen:ops.orders.columnDelivery'),
            flex: 2,
            render: (row) => (
                <Stack space="none">
                    <Text testID={`${kitchenOrderRowTestId(String(row.id))}-delivery`}>
                        {row.delivery.requestedDate === null
                            ? t('kitchen:common.notRecorded')
                            : formatter.formatDate(row.delivery.requestedDate)}
                    </Text>
                    {row.delivery.windowCode === null ? null : (
                        <Text variant="caption" tone="secondary">
                            {humaniseCode(row.delivery.windowCode)}
                        </Text>
                    )}
                </Stack>
            ),
        },
        {
            key: 'items',
            header: t('kitchen:ops.orders.columnItems'),
            numeric: true,
            render: (row) => (
                <Text testID={`${kitchenOrderRowTestId(String(row.id))}-items`}>
                    {formatter.formatNumber(row.lineCount)}
                </Text>
            ),
        },
        {
            key: 'total',
            header: t('kitchen:ops.orders.columnTotal'),
            numeric: true,
            primary: true,
            render: (row) => (
                <Text
                    variant="bodyStrong"
                    testID={`${kitchenOrderRowTestId(String(row.id))}-total`}
                >
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
                    {formatMoney(formatter, {
                        amount: line.unitPriceMinor,
                        currency: line.currencyCode,
                    })}
                </Text>
            ),
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

    const listFailure = toFailure(orders.error);
    const detailFailure = toFailure(detail.error);
    const filtered = status !== 'all' || trimmed !== '';

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

    function submitCancellation() {
        if (order === null || reason === null) return;
        cancelOrder.mutate(
            { id: order.id, lockVersion: order.lockVersion, reason },
            {
                onSuccess: (next) => {
                    setCancelling(false);
                    setReason(null);
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

    return (
        <Stack space="lg" testID="kitchen-orders-screen">
            <OpsPanel
                testID="kitchen-orders-panel"
                titleKey="kitchen:ops.orders.title"
                subtitleKey="kitchen:ops.orders.subtitle"
                metrics={metrics}
                emptyTitleKey="kitchen:ops.orders.emptyTitle"
                emptyBodyKey="kitchen:ops.orders.emptyBody"
            >
                <Stack space="md" testID="kitchen-orders-content">
                    <Stack space="sm" testID="kitchen-orders-toolbar">
                        <SegmentedControl<StatusFilter>
                            testID="kitchen-orders-status-filter"
                            label={t('kitchen:ops.orders.statusFilterLabel')}
                            block
                            value={status}
                            onChange={(next) => {
                                setStatus(next);
                                resetPaging();
                            }}
                            items={[
                                {
                                    value: 'all',
                                    label: t('kitchen:ops.orders.filterAll'),
                                    testID: 'kitchen-orders-status-all',
                                },
                                ...KITCHEN_ORDER_STATUSES.map((candidate) => ({
                                    value: candidate,
                                    label: t(kitchenOrderStatusKey(candidate)),
                                    testID: `kitchen-orders-status-${candidate}`,
                                })),
                            ]}
                        />
                        <TextInputField
                            testID="kitchen-orders-search"
                            id="kitchen-orders-search"
                            label={t('kitchen:ops.orders.searchLabel')}
                            hint={t('kitchen:ops.orders.searchHint')}
                            value={query}
                            onChangeText={(next) => {
                                setQuery(next);
                                resetPaging();
                            }}
                            autoCapitalize="none"
                            autoCorrect={false}
                        />
                    </Stack>

                    {orders.isPending && rows.length === 0 ? (
                        <Stack space="sm" testID="kitchen-orders-loading">
                            {Array.from({ length: 4 }, (_, index) => (
                                <Skeleton key={index} heightClassName="h-10" />
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
                    ) : rows.length === 0 ? (
                        <EmptyState
                            testID="kitchen-orders-empty"
                            title={t(
                                filtered
                                    ? 'kitchen:ops.orders.filteredEmptyTitle'
                                    : 'kitchen:ops.orders.emptyTitle',
                            )}
                            body={t(
                                filtered
                                    ? 'kitchen:ops.orders.filteredEmptyBody'
                                    : 'kitchen:ops.orders.emptyBody',
                            )}
                            actions={
                                filtered ? (
                                    <Button
                                        testID="kitchen-orders-clear"
                                        variant="secondary"
                                        label={t('kitchen:ops.orders.clearFilters')}
                                        onPress={() => {
                                            setStatus('all');
                                            setQuery('');
                                            resetPaging();
                                        }}
                                    />
                                ) : undefined
                            }
                        />
                    ) : (
                        <Stack space="sm">
                            <Table<KitchenOrder>
                                testID="kitchen-orders-table"
                                caption={t('kitchen:ops.orders.caption')}
                                captionHidden
                                columns={columns}
                                rows={rows}
                                rowKey={(row) => String(row.id)}
                                rowAction={{
                                    header: t('kitchen:ops.orders.columnActions'),
                                    render: (row) => (
                                        <Button
                                            testID={`${kitchenOrderRowTestId(String(row.id))}-open`}
                                            size="sm"
                                            variant="secondary"
                                            label={t('kitchen:ops.orders.open')}
                                            onPress={() => {
                                                openDetail(row.id);
                                            }}
                                        />
                                    ),
                                }}
                            />

                            {page?.hasMore === true ? (
                                <Button
                                    testID="kitchen-orders-load-more"
                                    variant="secondary"
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
                        </Stack>
                    )}
                </Stack>
            </OpsPanel>

            <Drawer
                testID="kitchen-orders-detail"
                placement="end"
                open={selectedId !== null}
                onClose={closeDetail}
                title={
                    order === null
                        ? t('kitchen:ops.orders.title')
                        : t('kitchen:ops.orders.detailTitle', { number: order.orderNumber })
                }
                className="w-[520px]"
                footer={
                    order === null || !canManage ? undefined : (
                        <Inline space="sm" wrap justify="end">
                            {canCancelKitchenOrder(order.status) ? (
                                <Button
                                    testID="kitchen-orders-cancel"
                                    variant="ghost"
                                    label={t('kitchen:ops.orders.cancel')}
                                    disabled={actionPending}
                                    onPress={() => {
                                        clearActionState();
                                        setCancelling(true);
                                    }}
                                />
                            ) : null}
                            {canConfirmKitchenOrder(order.status) ? (
                                <Button
                                    testID="kitchen-orders-confirm"
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
                                    testID="kitchen-orders-fulfil"
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
                    <Stack space="lg" testID="kitchen-orders-detail-body">
                        <Inline space="sm" align="center" wrap>
                            <Badge
                                testID="kitchen-orders-detail-status"
                                tone={kitchenOrderStatusTone(order.status)}
                                label={t(kitchenOrderStatusKey(order.status))}
                            />
                        </Inline>

                        {actionFailure === null ? null : isConflict ? (
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
                        )}

                        <Stack space="sm">
                            <Heading level={3} testID="kitchen-orders-detail-lines-heading">
                                {t('kitchen:ops.orders.linesHeading')}
                            </Heading>
                            <Table<KitchenOrderLine>
                                testID="kitchen-orders-detail-lines"
                                caption={t('kitchen:ops.orders.linesHeading')}
                                captionHidden
                                columns={lineColumns}
                                rows={order.lines}
                                rowKey={(line) => line.id}
                            />
                        </Stack>

                        <Stack space="xs" testID="kitchen-orders-detail-totals">
                            <Heading level={3}>{t('kitchen:ops.orders.totalsHeading')}</Heading>
                            <DetailRow
                                testID="kitchen-orders-detail-subtotal"
                                label={t('kitchen:ops.orders.subtotal')}
                                value={formatMoney(formatter, {
                                    amount: order.subtotalMinor,
                                    currency: order.currencyCode,
                                })}
                            />
                            <DetailRow
                                testID="kitchen-orders-detail-delivery-fee"
                                label={t('kitchen:ops.orders.deliveryFee')}
                                // `null` is not zero: a free delivery and an un-zoned address are
                                // different facts, and the contract keeps them apart on purpose.
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
                                testID="kitchen-orders-detail-total"
                                label={t('kitchen:ops.orders.total')}
                                value={formatMoney(formatter, {
                                    amount: order.totalMinor,
                                    currency: order.currencyCode,
                                })}
                            />
                        </Stack>

                        <Stack space="xs" testID="kitchen-orders-detail-delivery">
                            <Heading level={3}>{t('kitchen:ops.orders.deliveryHeading')}</Heading>
                            <DetailRow
                                testID="kitchen-orders-detail-delivery-date"
                                label={t('kitchen:ops.orders.deliveryDate')}
                                value={
                                    order.delivery.requestedDate === null
                                        ? t('kitchen:common.notRecorded')
                                        : formatter.formatDate(order.delivery.requestedDate)
                                }
                            />
                            <DetailRow
                                testID="kitchen-orders-detail-delivery-window"
                                label={t('kitchen:ops.orders.deliveryWindow')}
                                value={
                                    order.delivery.windowCode === null
                                        ? t('kitchen:common.notRecorded')
                                        : humaniseCode(order.delivery.windowCode)
                                }
                            />
                            <DetailRow
                                testID="kitchen-orders-detail-delivery-address"
                                label={t('kitchen:ops.orders.deliveryAddress')}
                                value={[order.delivery.lineOne, order.delivery.lineTwo]
                                    .filter((part): part is string => part !== null && part !== '')
                                    .join(t('kitchen:common.listSeparator'))}
                            />
                            <DetailRow
                                testID="kitchen-orders-detail-delivery-area"
                                label={t('kitchen:ops.orders.deliveryArea')}
                                value={
                                    order.delivery.areaNameEn ??
                                    order.delivery.city ??
                                    t('kitchen:common.notRecorded')
                                }
                            />
                            <DetailRow
                                testID="kitchen-orders-detail-delivery-zone"
                                label={t('kitchen:ops.orders.deliveryZone')}
                                value={
                                    order.delivery.zoneId === null
                                        ? t('kitchen:common.notRecorded')
                                        : String(order.delivery.zoneId)
                                }
                            />
                        </Stack>

                        <Stack space="xs" testID="kitchen-orders-detail-timeline">
                            <Heading level={3}>{t('kitchen:ops.orders.timelineHeading')}</Heading>
                            <DetailRow
                                testID="kitchen-orders-detail-placed-at"
                                label={t('kitchen:ops.orders.placedAt')}
                                value={formatter.formatDate(order.placedAt)}
                            />
                            {order.confirmedAt === null ? null : (
                                <DetailRow
                                    testID="kitchen-orders-detail-confirmed-at"
                                    label={t('kitchen:ops.orders.confirmedAt')}
                                    value={formatter.formatDate(order.confirmedAt)}
                                />
                            )}
                            {order.fulfilledAt === null ? null : (
                                <DetailRow
                                    testID="kitchen-orders-detail-fulfilled-at"
                                    label={t('kitchen:ops.orders.fulfilledAt')}
                                    value={formatter.formatDate(order.fulfilledAt)}
                                />
                            )}
                            {order.cancelledAt === null ? null : (
                                <DetailRow
                                    testID="kitchen-orders-detail-cancelled-at"
                                    label={t('kitchen:ops.orders.cancelledAt')}
                                    value={formatter.formatDate(order.cancelledAt)}
                                />
                            )}
                        </Stack>

                        {order.cancellationReason === null ? null : (
                            <Stack space="xs" testID="kitchen-orders-detail-cancellation">
                                <Heading level={3}>
                                    {t('kitchen:ops.orders.cancellationHeading')}
                                </Heading>
                                <DetailRow
                                    testID="kitchen-orders-detail-cancellation-reason"
                                    label={t('kitchen:ops.orders.cancellationReason')}
                                    value={t(
                                        kitchenOrderCancellationReasonKey(order.cancellationReason),
                                    )}
                                />
                            </Stack>
                        )}
                    </Stack>
                )}
            </Drawer>

            <Dialog
                testID="kitchen-orders-cancel-dialog"
                open={cancelling && order !== null}
                onClose={() => {
                    setCancelling(false);
                    setReason(null);
                }}
                title={
                    order === null
                        ? t('kitchen:ops.orders.cancel')
                        : t('kitchen:ops.orders.cancelTitle', { number: order.orderNumber })
                }
                description={t('kitchen:ops.orders.cancelBody')}
                actions={
                    <>
                        <Button
                            testID="kitchen-orders-cancel-dismiss"
                            variant="quiet"
                            label={t('kitchen:ops.orders.cancelDismiss')}
                            onPress={() => {
                                setCancelling(false);
                                setReason(null);
                            }}
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
                    <Text variant="bodyStrong">{t('kitchen:ops.orders.cancelReasonLabel')}</Text>
                    {/*
                     * Chips rather than a `Select`: the reason is required, there are exactly four
                     * of them and they are permanently four (the enum is closed, and there is no
                     * free-text note beside it by design), so every option can be on screen at the
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
        </Stack>
    );
}
