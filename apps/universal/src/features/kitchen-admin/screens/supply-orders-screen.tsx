import type { OrderProposalItem, PurchaseOrder } from '@healthy360/api-client/contracts';
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
    Table,
    Text,
} from '@healthy360/design-system';
import type { TableColumn } from '@healthy360/design-system';
import { useFormatter } from '@healthy360/i18n';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';

import { Gate } from '../../../access/gate.tsx';
import { toFailure } from '../../../data/hooks.ts';
import {
    useOrderProposalQuery,
    usePurchaseOrdersQuery,
    useSupplyNeedsCountQuery,
} from '../../../data/kitchen-ops-hooks.ts';
import { useAccessState } from '../../../session/session-provider.tsx';
import { INVENTORY_ORDER_SUPPLIES_PERMISSION } from '../entity-registry.ts';
import { KitchenPageHeader } from '../kitchen-page-header.tsx';
import { OpsPanel } from '../ops-panel.tsx';
import type { OpsMetric } from '../ops-panel.tsx';
import {
    purchaseOrderRowTestId,
    purchaseOrderStatusKey,
    purchaseOrderStatusTone,
    supplyOrderRowTestId,
} from '../ops-format.ts';

/**
 * `/kitchen/supply-orders` — what the branch is short of, and the way into ordering it (SUP3).
 *
 * ## Two numbers, and they are not the same number
 *
 * The panel shows *out of stock* and *running low* separately because a person reads them
 * differently: nothing left is a service problem this shift, below the threshold is a purchasing
 * problem this week. Their sum is the queue, so the screen never adds a third tile claiming a total
 * — the count endpoint publishes all three and the two shown partition the one that is not.
 *
 * ## The preview is a preview, not the builder
 *
 * Eight rows and a count of the rest. It exists so somebody can tell at a glance whether the queue
 * is *four things* or *forty*, which changes whether they open the builder now or after service. It
 * deliberately carries no quantity boxes and no supplier pickers: a half-usable builder on the
 * landing page would be a second place to do the same job, and the two would drift.
 *
 * The rows come from the proposal endpoint rather than a second summary read, so the preview and the
 * builder are literally the same list — the first eight of it. The order is the server's and is
 * never re-sorted here either.
 *
 * ## Nothing to order is a good state, and it is dressed as one
 *
 * An empty queue is a kitchen that is fully stocked, not a screen with no content, so it reads
 * "Nothing needs ordering" with the tick icon rather than the shrug an empty list usually gets. The
 * secondary action stays: a manager who wants to order ahead of a busy weekend is not blocked by
 * the shelves currently being fine.
 *
 * `EmptyState` has two variants, `empty` and `prototype`, and neither is a positive one — so the
 * positivity is carried by the `success` icon and the wording rather than by a variant that does
 * not exist. Adding a third variant to a component seven screens depend on, for one screen's tone,
 * would be the wrong direction of change.
 *
 * ## The orders you have made, between the panel and the preview
 *
 * The order book's newest page, and it sits *above* the shortage preview on purpose: a person
 * opening this screen most often wants to know what happened to the order they placed yesterday,
 * not to start another one. An empty book is dressed as the beginning of something rather than as a
 * failure — a kitchen that has never ordered through this screen has not lost anything.
 *
 * ## The batch that was just created gets a standing notice, not a toast action (SUP7)
 *
 * The builder replaces itself with this page and passes `?created=`. §7 wants **Print them** offered
 * the moment several drafts exist, and the design system's toast carries no action slot — so the
 * link lives in a success callout above the panel, which survives a glance away and a refresh. It
 * counts from the query string rather than from the book, because a keyset page cannot tell you how
 * many orders were made.
 *
 * **The metrics row does not grow a "drafts" tile**, and the reason is arithmetic rather than taste.
 * The list is a keyset page: `totalCount` is `null` by contract, so counting drafts from the rows in
 * hand would answer "3" whether the kitchen has three drafts or thirty. A number that is right only
 * on short lists is worse than no number, and the two shortage tiles beside it are exact. The status
 * column on each row is where a person sees which orders are still drafts.
 */

/** How much of the queue the landing page shows before it starts counting instead. */
const PREVIEW_ROWS = 8;

const EM_DASH = '—';

export interface SupplyOrdersScreenProps {
    /**
     * The `created` query parameter the builder hands back — comma-separated identifiers of the
     * drafts it has just raised (SUP7). Absent on every other way of arriving here.
     */
    readonly created?: string | undefined;
}

export function SupplyOrdersScreen({ created }: SupplyOrdersScreenProps) {
    return (
        <Gate
            area="kitchen"
            requirement={{ allOf: [INVENTORY_ORDER_SUPPLIES_PERMISSION] }}
            testID="kitchen-supply-orders"
        >
            <SupplyOrders created={created} />
        </Gate>
    );
}

function SupplyOrders({ created }: SupplyOrdersScreenProps) {
    const { t } = useTranslation();
    const formatter = useFormatter();
    const router = useRouter();
    const access = useAccessState();

    const branchId = access.branch?.id ?? null;

    const needs = useSupplyNeedsCountQuery(branchId);
    const proposal = useOrderProposalQuery(branchId);
    /**
     * The order book, unfiltered by branch — the endpoint takes no branch filter and does not need
     * one. "What is short at this site" has no organisation-wide meaning; "what have we ordered"
     * does, and an order placed for another branch is still this kitchen's.
     *
     * It is nonetheless held back until a branch is resolved, and only because of *rendering*: the
     * whole body of this screen is replaced by the choose-a-branch state without one, so firing this
     * would be a request for something nobody is about to look at.
     */
    const orders = usePurchaseOrdersQuery({}, branchId !== null);

    /**
     * `null` while pending, which `OpsMetric` renders as an em dash — the three-way collapse the
     * hub's KPI tiles use. A zero here would claim the shelves are fine before anybody has looked.
     */
    const metrics: readonly OpsMetric[] = [
        {
            key: 'outOfStock',
            labelKey: 'kitchen:ops.supplyOrders.metrics.outOfStock',
            value: needs.data?.outOfStockCount ?? null,
        },
        {
            key: 'low',
            labelKey: 'kitchen:ops.supplyOrders.metrics.low',
            value: needs.data?.lowStockCount ?? null,
        },
    ];

    const rows = proposal.data?.items ?? [];
    const preview = rows.slice(0, PREVIEW_ROWS);
    const remaining = Math.max(rows.length - preview.length, 0);

    const failure = toFailure(needs.error ?? proposal.error);
    const isPending = needs.isPending || proposal.isPending;
    const isEmpty = !isPending && failure === null && rows.length === 0;

    // Its own failure and its own empty state: the book failing to load is not a reason to hide the
    // shortage queue, and a kitchen with nothing short may still have five orders out.
    const orderRows = orders.data?.items ?? [];
    const ordersFailure = toFailure(orders.error);

    /*
     * SUP7. The builder replaces itself with this page and passes the identifiers it just created;
     * the callout below is where **Print them** lives. A standing notice rather than a toast action
     * on purpose — see the builder's own note: a control inside something that vanishes on a timer
     * is a control a person loses by looking away.
     *
     * Counted from the query string rather than from the order book, because the book is a keyset
     * page whose `totalCount` is null by contract: "4 orders created" must be the number that was
     * actually created, not the number of rows that happen to be on the first page.
     */
    const createdIds = (created ?? '')
        .split(',')
        .map((segment) => segment.trim())
        .filter((segment) => segment !== '');

    const orderColumns: readonly TableColumn<PurchaseOrder>[] = [
        {
            key: 'number',
            header: t('kitchen:ops.supplyOrders.columnNumber'),
            rowHeader: true,
            render: (row) => (
                <Text
                    variant="bodyStrong"
                    testID={`${purchaseOrderRowTestId(String(row.id))}-number`}
                >
                    {row.number}
                </Text>
            ),
        },
        {
            key: 'supplier',
            header: t('kitchen:ops.supplyOrders.columnSupplier'),
            flex: 2,
            render: (row) => (
                <Text testID={`${purchaseOrderRowTestId(String(row.id))}-supplier`}>
                    {/*
                     * The **live** supplier, even on an issued order. The frozen snapshot is what a
                     * reprint of the document reads; a book that a person scans to find an order is
                     * looking for the supplier they know by name today.
                     */}
                    {row.supplier?.nameEn ?? EM_DASH}
                </Text>
            ),
        },
        {
            key: 'madeOn',
            header: t('kitchen:ops.supplyOrders.columnMadeOn'),
            render: (row) => (
                <Text tone="secondary" testID={`${purchaseOrderRowTestId(String(row.id))}-made-on`}>
                    {row.createdAt === null
                        ? EM_DASH
                        : formatter.formatDate(row.createdAt, { dateStyle: 'medium' })}
                </Text>
            ),
        },
        {
            key: 'lines',
            header: t('kitchen:ops.supplyOrders.columnLines'),
            numeric: true,
            render: (row) => (
                <Text testID={`${purchaseOrderRowTestId(String(row.id))}-lines`}>
                    {formatter.formatNumber(row.lineCount)}
                </Text>
            ),
        },
        {
            key: 'status',
            header: t('kitchen:ops.supplyOrders.columnStatus'),
            render: (row) => (
                <Badge
                    testID={`${purchaseOrderRowTestId(String(row.id))}-status`}
                    tone={purchaseOrderStatusTone(row.status)}
                    label={t(purchaseOrderStatusKey(row.status))}
                />
            ),
        },
    ];

    const columns: readonly TableColumn<OrderProposalItem>[] = [
        {
            key: 'item',
            header: t('kitchen:ops.supplyOrders.columnItem'),
            rowHeader: true,
            flex: 2,
            render: (row) => {
                const testID = supplyOrderRowTestId(String(row.stockItemId));
                return (
                    <Stack space="none">
                        <Text variant="bodyStrong" testID={`${testID}-name`}>
                            {row.itemNameEn}
                        </Text>
                        <Text variant="caption" tone="secondary" testID={`${testID}-code`}>
                            {row.itemCode}
                        </Text>
                    </Stack>
                );
            },
        },
        {
            key: 'onHand',
            header: t('kitchen:ops.supplyOrders.columnOnHand'),
            flex: 2,
            render: (row) => {
                const testID = supplyOrderRowTestId(String(row.stockItemId));
                return (
                    <Inline space="xs" align="center" wrap>
                        <Text testID={`${testID}-on-hand`}>
                            {`${formatter.formatNumber(Number(row.quantityOnHand))} ${row.unitCode}`}
                        </Text>
                        {/*
                         * A word and a tone, never colour alone — the platform's standing rule, and
                         * the reason the badge carries a label rather than a dot. Out of stock wins
                         * when a row is both, matching the label the server already chose.
                         */}
                        {row.isOutOfStock ? (
                            <Badge
                                testID={`${testID}-out`}
                                tone="danger"
                                label={t('kitchen:ops.supplyOrders.outBadge')}
                            />
                        ) : row.isLow ? (
                            <Badge
                                testID={`${testID}-low`}
                                tone="warning"
                                label={t('kitchen:ops.supplyOrders.lowBadge')}
                            />
                        ) : null}
                    </Inline>
                );
            },
        },
        {
            key: 'reorderAt',
            header: t('kitchen:ops.supplyOrders.columnReorderAt'),
            numeric: true,
            render: (row) => (
                <Text
                    tone="secondary"
                    testID={`${supplyOrderRowTestId(String(row.stockItemId))}-reorder-at`}
                >
                    {row.reorderThreshold === null
                        ? EM_DASH
                        : formatter.formatNumber(Number(row.reorderThreshold))}
                </Text>
            ),
        },
    ];

    return (
        <Stack space="lg" testID="kitchen-supply-orders-screen">
            <KitchenPageHeader
                testID="kitchen-supply-orders-header"
                title={t('kitchen:ops.supplyOrders.title')}
                subtitle={t('kitchen:ops.supplyOrders.subtitle')}
                titleTestID="kitchen-supply-orders-title"
                subtitleTestID="kitchen-supply-orders-subtitle"
            />

            {branchId === null ? (
                /*
                 * The screen does not fetch without a branch. A proposal is always for one site, an
                 * organisation-wide manager holds none, and asking anyway would spend a 422 to
                 * render "validation failed" at somebody who needs to pick a branch.
                 */
                <EmptyState
                    testID="kitchen-supply-orders-branch-required"
                    title={t('kitchen:ops.supplyOrders.branchRequiredTitle')}
                    body={t('kitchen:ops.supplyOrders.branchRequiredBody')}
                />
            ) : (
                <>
                    {createdIds.length === 0 ? null : (
                        <Callout
                            testID="kitchen-supply-orders-created"
                            tone="success"
                            // `status`, not `alert`: it reports something that has already gone
                            // well. An alert would interrupt a screen reader to say "done".
                            role="status"
                            title={t('kitchen:ops.supplyOrders.print.createdTitle', {
                                count: createdIds.length,
                            })}
                            body={t('kitchen:ops.supplyOrders.print.createdBody')}
                            actions={
                                <Button
                                    testID="kitchen-supply-orders-created-print"
                                    variant="secondary"
                                    label={t('kitchen:ops.supplyOrders.print.printThem', {
                                        count: createdIds.length,
                                    })}
                                    onPress={() => {
                                        router.push(
                                            `/kitchen/supply-orders/print?orders=${encodeURIComponent(createdIds.join(','))}` as never,
                                        );
                                    }}
                                />
                            }
                        />
                    )}

                    <OpsPanel
                        testID="kitchen-supply-orders-panel"
                        titleKey="kitchen:ops.supplyOrders.panelTitle"
                        subtitleKey="kitchen:ops.supplyOrders.panelSubtitle"
                        metrics={metrics}
                        emptyTitleKey="kitchen:ops.supplyOrders.emptyTitle"
                        emptyBodyKey="kitchen:ops.supplyOrders.emptyBody"
                    />

                    <Stack space="sm" testID="kitchen-supply-orders-book">
                        <Heading level={2} testID="kitchen-supply-orders-book-title">
                            {t('kitchen:ops.supplyOrders.ordersTitle')}
                        </Heading>

                        {orders.isPending ? (
                            <Card padding="md">
                                <Skeleton
                                    testID="kitchen-supply-orders-book-skeleton"
                                    heightClassName="h-5"
                                />
                            </Card>
                        ) : ordersFailure !== null ? (
                            <ErrorState
                                testID="kitchen-supply-orders-book-error"
                                failure={ordersFailure}
                                onRetry={() => {
                                    void orders.refetch();
                                }}
                                retrying={orders.isFetching}
                            />
                        ) : orderRows.length === 0 ? (
                            <EmptyState
                                testID="kitchen-supply-orders-book-empty"
                                title={t('kitchen:ops.supplyOrders.ordersEmptyTitle')}
                                body={t('kitchen:ops.supplyOrders.ordersEmptyBody')}
                            />
                        ) : (
                            <Table<PurchaseOrder>
                                testID="kitchen-supply-orders-book-table"
                                caption={t('kitchen:ops.supplyOrders.ordersCaption')}
                                captionHidden
                                columns={orderColumns}
                                rows={orderRows}
                                rowKey={(row) => String(row.id)}
                                rowAction={{
                                    header: t('kitchen:list.actionHeader'),
                                    render: (row) => (
                                        <Inline space="xs" wrap justify="end">
                                            <Button
                                                testID={`${purchaseOrderRowTestId(String(row.id))}-open`}
                                                size="sm"
                                                variant="secondary"
                                                label={t('kitchen:list.open')}
                                                onPress={() => {
                                                    router.push(
                                                        `/kitchen/supply-orders/${String(row.id)}` as never,
                                                    );
                                                }}
                                            />
                                        </Inline>
                                    ),
                                }}
                            />
                        )}
                    </Stack>

                    <Inline space="sm" align="center" justify="between" wrap>
                        <Heading level={2} testID="kitchen-supply-orders-preview-title">
                            {t('kitchen:ops.supplyOrders.previewTitle')}
                        </Heading>
                        {isEmpty ? null : (
                            <Button
                                testID="kitchen-supply-orders-prepare"
                                label={t('kitchen:ops.supplyOrders.prepare')}
                                onPress={() => {
                                    router.push('/kitchen/supply-orders/new' as never);
                                }}
                            />
                        )}
                    </Inline>

                    {isPending ? (
                        <Stack space="sm" testID="kitchen-supply-orders-loading">
                            {Array.from({ length: 3 }, (_, index) => (
                                <Card key={index} padding="md">
                                    <Stack space="xs">
                                        <Skeleton
                                            testID={`kitchen-supply-orders-skeleton-${String(index + 1)}`}
                                            heightClassName="h-5"
                                        />
                                        <Skeleton heightClassName="h-4" widthClassName="w-1/2" />
                                    </Stack>
                                </Card>
                            ))}
                        </Stack>
                    ) : failure !== null ? (
                        <ErrorState
                            testID="kitchen-supply-orders-error"
                            failure={failure}
                            onRetry={() => {
                                void needs.refetch();
                                void proposal.refetch();
                            }}
                            retrying={needs.isFetching || proposal.isFetching}
                        />
                    ) : isEmpty ? (
                        <EmptyState
                            testID="kitchen-supply-orders-empty"
                            icon="success"
                            title={t('kitchen:ops.supplyOrders.nothingNeededTitle')}
                            body={t('kitchen:ops.supplyOrders.nothingNeededBody')}
                            actions={
                                <Button
                                    testID="kitchen-supply-orders-order-anyway"
                                    variant="secondary"
                                    label={t('kitchen:ops.supplyOrders.orderAnyway')}
                                    onPress={() => {
                                        router.push('/kitchen/supply-orders/new' as never);
                                    }}
                                />
                            }
                        />
                    ) : (
                        <Stack space="sm">
                            <Table<OrderProposalItem>
                                testID="kitchen-supply-orders-preview"
                                caption={t('kitchen:ops.supplyOrders.previewCaption')}
                                captionHidden
                                columns={columns}
                                rows={preview}
                                rowKey={(row) => String(row.stockItemId)}
                            />
                            {remaining === 0 ? null : (
                                <Text
                                    tone="secondary"
                                    variant="caption"
                                    testID="kitchen-supply-orders-and-more"
                                >
                                    {t('kitchen:ops.supplyOrders.andMore', { count: remaining })}
                                </Text>
                            )}
                        </Stack>
                    )}
                </>
            )}
        </Stack>
    );
}
