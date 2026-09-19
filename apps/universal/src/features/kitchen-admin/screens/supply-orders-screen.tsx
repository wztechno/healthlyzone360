import type {
    OrderProposalItem,
    PurchaseOrder,
    PurchaseOrderStatus,
} from '@healthy360/api-client/contracts';
import {
    Badge,
    Button,
    Callout,
    EmptyState,
    ErrorState,
    FormSection,
    Skeleton,
    Stack,
    Text,
} from '@healthy360/design-system';
import type { MenuItem } from '@healthy360/design-system';
import { SupplierId } from '@healthy360/domain-types';
import { useFormatter, useLocale } from '@healthy360/i18n';
import { useRouter } from 'expo-router';
import type { TFunction } from 'i18next';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { Gate } from '../../../access/gate.tsx';
import { toFailure } from '../../../data/hooks.ts';
import {
    useOrderProposalQuery,
    usePurchaseOrdersQuery,
    useSuppliersQuery,
    useSupplyNeedsCountQuery,
} from '../../../data/kitchen-ops-hooks.ts';
import { useAccessState } from '../../../session/session-provider.tsx';
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
import type { ControlledColumn, SortDirection } from '../catalogue/use-column-controls.tsx';
import { INVENTORY_ORDER_SUPPLIES_PERMISSION } from '../entity-registry.ts';
import { displayName } from '../format.ts';
import {
    purchaseOrderRowTestId,
    purchaseOrderStatusKey,
    purchaseOrderStatusTone,
    supplyOrderRowTestId,
} from '../ops-format.ts';
import { RecordViewPage } from '../catalogue/record-view-page.tsx';
import { ColumnPicker, WithColumnPicker } from '../catalogue/column-picker.tsx';

/**
 * `/kitchen/supply-orders` — the order book, and what the branch is short of (SUP3), on the
 * Catalogue list (Operations design, `supply`).
 *
 * ```
 * ┌ OUT OF STOCK ┐ ┌ RUNNING LOW ┐ ┌ DRAFT ┐ ┌ ISSUED ┐
 * [ ⌕ search ]  [ All | Draft | Issued | Partly received | Received | Cancelled ]  [ Prepare order ]
 * ORDER         SUPPLIER            MADE ON     ITEMS   STATUS                 ◉ ✎
 * ── Needs ordering ────────────────────────────────────────────────
 * ITEM          ON HAND             REORDER AT
 * ```
 *
 * ## The two shortage cards are exact; the two order cards are the page in hand
 *
 * Out of stock and running low come from the count endpoint and partition the queue, so the page
 * never adds a card claiming their total. Draft and Issued are counted over the orders on screen,
 * as every Catalogue list counts, and their captions say so: the book is a keyset page whose
 * `totalCount` is null by contract, so they are "on this page", never "in the kitchen".
 *
 * ## Status is a server filter; search is the page in hand
 *
 * `PurchaseOrderFilter` takes one status and no query, so the segments refetch and the search
 * narrows the rows already loaded (order number or the live supplier's name). The design's four
 * segments fold *partly received* into Issued; the filter takes one status, so each of the five is
 * its own segment rather than an "Issued" that quietly hides the half-delivered orders.
 *
 * The Status and Supplier headers filter through the same request — `PurchaseOrderFilter` carries a
 * status and a `supplierId` — so either narrows the whole book, not the page in hand. Order, Made on
 * and Items sort the loaded page only: the filter has no sort parameter, and the keyset answers
 * newest first.
 *
 * The design's "Their reference" column is omitted: an order carries no supplier reference.
 *
 * ## The preview is a preview, not the builder
 *
 * Eight rows of the proposal and a count of the rest, under the book — enough to tell *four things*
 * from *forty*. No quantity boxes and no supplier pickers: a half-usable builder here would be a
 * second place to do the same job. It opens in the server's order; Item and Reorder at sort and On
 * hand filters by its badge, over the whole proposal before it is cut to eight. An empty queue is good news and is dressed as one, with a way in
 * that stays so a manager can order ahead of a busy weekend.
 *
 * ## The batch that was just created gets a standing notice, not a toast action (SUP7)
 *
 * The builder replaces itself with this page and passes `?created=`. **Print them** lives in a
 * success callout, which survives a glance away and a refresh. It counts from the query string,
 * because a keyset page cannot tell you how many orders were made.
 */

/** How much of the queue the landing page shows before it starts counting instead. */
const PREVIEW_ROWS = 8;

const EM_DASH = '—';

/** A stable empty queue, so the preview's controls are not handed a fresh array per render. */
const NO_PROPOSAL_ITEMS: readonly OrderProposalItem[] = [];

type StatusSegmentValue = PurchaseOrderStatus | 'all';

const SEGMENT_STATUSES: readonly PurchaseOrderStatus[] = [
    'draft',
    'issued',
    'partially_received',
    'received',
    'cancelled',
];

/**
 * The whole supplier book, archived included, for the Supplier column's values: an order raised
 * against a supplier the kitchen has since retired is still in the book and still findable.
 */
const SUPPLIER_BOOK = { includeArchived: true } as const;

/** The two shortage states the On hand badge draws, in its own precedence — Out wins. */
type ShortageState = 'out' | 'low';

function shortageState(row: OrderProposalItem): ShortageState | null {
    if (row.isOutOfStock) return 'out';
    return row.isLow ? 'low' : null;
}

/** Decimal strings in `direction`, an unset figure last both ways. */
function compareDecimal(
    left: string | null,
    right: string | null,
    direction: SortDirection,
): number {
    if (left === null || right === null) return left === right ? 0 : left === null ? 1 : -1;
    return compareNumber(Number(left), Number(right), direction);
}

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

function supplierName(row: PurchaseOrder, locale: string): string {
    // The **live** supplier, even on an issued order: a person scanning the book is looking for the
    // supplier they know by name today. The frozen snapshot is what the sheet reads.
    return row.supplier === null
        ? EM_DASH
        : displayName({ en: row.supplier.nameEn, ar: row.supplier.nameAr ?? '' }, locale).value;
}

function SupplyOrders({ created }: SupplyOrdersScreenProps) {
    const { t } = useTranslation();
    const formatter = useFormatter();
    const { locale } = useLocale();
    const router = useRouter();
    const access = useAccessState();

    const branchId = access.branch?.id ?? null;

    const [query, setQuery] = useState('');
    const [status, setStatus] = useState<StatusSegmentValue>('all');
    /** The Supplier header's choice. Sent with the request — `PurchaseOrderFilter.supplierId`. */
    const [supplier, setSupplier] = useState<string | null>(null);
    const [viewing, setViewing] = useState<PurchaseOrder | null>(null);

    const needs = useSupplyNeedsCountQuery(branchId);
    const proposal = useOrderProposalQuery(branchId);
    /**
     * The order book, unfiltered by branch — "what have we ordered" has an organisation-wide
     * meaning. Held back until a branch is resolved only because the body is replaced by the
     * choose-a-branch state without one.
     */
    const bookFilter = useMemo(
        () => ({
            ...(status === 'all' ? {} : { status }),
            ...(supplier === null ? {} : { supplierId: SupplierId.unsafe(supplier) }),
        }),
        [status, supplier],
    );
    const orders = usePurchaseOrdersQuery(bookFilter, branchId !== null);
    const supplierBook = useSuppliersQuery(SUPPLIER_BOOK, branchId !== null);

    const trimmed = query.trim().toLocaleLowerCase(locale);
    const searched = useMemo(() => {
        const rows = orders.data?.items ?? [];
        if (trimmed === '') return rows;
        return rows.filter((row) =>
            [row.number, row.supplier?.nameEn ?? '', row.supplier?.nameAr ?? ''].some((field) =>
                field.toLocaleLowerCase(locale).includes(trimmed),
            ),
        );
    }, [orders.data, trimmed, locale]);

    const shortage = proposal.data?.items ?? NO_PROPOSAL_ITEMS;
    const shortageFailure = toFailure(needs.error ?? proposal.error);
    const shortagePending = needs.isPending || proposal.isPending;
    const queueEmpty = !shortagePending && shortageFailure === null && shortage.length === 0;

    const ordersFailure = toFailure(orders.error);

    const createdIds = (created ?? '')
        .split(',')
        .map((segment) => segment.trim())
        .filter((segment) => segment !== '');

    const openOrder = (row: PurchaseOrder) => {
        setViewing(null);
        router.push(`/kitchen/supply-orders/${String(row.id)}` as never);
    };

    const prepare = () => {
        router.push('/kitchen/supply-orders/new' as never);
    };

    const madeOn = (row: PurchaseOrder) =>
        row.createdAt === null
            ? EM_DASH
            : formatter.formatDate(row.createdAt, { dateStyle: 'medium' });

    const orderColumns: readonly ControlledColumn<PurchaseOrder, CatalogueColumn<PurchaseOrder>>[] =
        [
            {
                key: 'number',
                role: 'title',
                label: t('kitchen:ops.supplyOrders.columnNumber'),
                width: 180,
                priority: 100,
                value: (row) => row.number,
                sort: (left, right, direction) => compareText(left.number, right.number, direction),
                render: (row) => (
                    <Text
                        variant="mono"
                        numberOfLines={1}
                        testID={`${purchaseOrderRowTestId(String(row.id))}-number`}
                    >
                        {row.number}
                    </Text>
                ),
            },
            {
                key: 'supplier',
                label: t('kitchen:ops.supplyOrders.columnSupplier'),
                width: 210,
                priority: 90,
                value: (row) => supplierName(row, locale),
                // Sent with the request rather than matched against the page: the book is a keyset
                // page, and narrowing the rows in hand would hide every order past it. The values
                // are the supplier book, so a supplier with no order on this page is still offered,
                // plus any supplier an order names that the book did not answer.
                filter: {
                    values: (rows) => {
                        const seen = new Map<string, string>();
                        for (const entry of supplierBook.data ?? []) {
                            seen.set(String(entry.id), displayName(entry.name, locale).value);
                        }
                        for (const row of rows) {
                            if (row.supplier !== null && !seen.has(String(row.supplier.id))) {
                                seen.set(String(row.supplier.id), supplierName(row, locale));
                            }
                        }
                        return [...seen].map(([key, label]) => ({ key, label }));
                    },
                    external: {
                        value: supplier,
                        onChange: (next) => {
                            setSupplier(next);
                            setViewing(null);
                        },
                    },
                },
                render: (row) => (
                    <Text
                        numberOfLines={1}
                        testID={`${purchaseOrderRowTestId(String(row.id))}-supplier`}
                    >
                        {supplierName(row, locale)}
                    </Text>
                ),
            },
            {
                key: 'madeOn',
                role: 'meta',
                label: t('kitchen:ops.supplyOrders.columnMadeOn'),
                width: 120,
                priority: 60,
                value: madeOn,
                sort: (left, right, direction) =>
                    compareText(left.createdAt ?? '', right.createdAt ?? '', direction),
                render: (row) => (
                    <Text
                        tone="secondary"
                        numberOfLines={1}
                        testID={`${purchaseOrderRowTestId(String(row.id))}-made-on`}
                    >
                        {madeOn(row)}
                    </Text>
                ),
            },
            {
                key: 'lines',
                role: 'metric',
                label: t('kitchen:ops.supplyOrders.columnLines'),
                width: 70,
                priority: 85,
                align: 'end',
                value: (row) => formatter.formatNumber(row.lineCount),
                sort: (left, right, direction) =>
                    compareNumber(left.lineCount, right.lineCount, direction),
                render: (row) => (
                    <Text variant="mono" testID={`${purchaseOrderRowTestId(String(row.id))}-lines`}>
                        {formatter.formatNumber(row.lineCount)}
                    </Text>
                ),
            },
            {
                key: 'status',
                role: 'status',
                label: t('kitchen:ops.supplyOrders.columnStatus'),
                width: 140,
                priority: 88,
                value: (row) => t(purchaseOrderStatusKey(row.status)),
                // The segments' own state, so the header and the toolbar can never disagree — and
                // a server filter, because `PurchaseOrderFilter` takes one status.
                filter: {
                    values: () =>
                        SEGMENT_STATUSES.map((value) => ({
                            key: value,
                            label: t(purchaseOrderStatusKey(value)),
                        })),
                    external: {
                        value: status === 'all' ? null : status,
                        onChange: (next) => {
                            setStatus(SEGMENT_STATUSES.find((value) => value === next) ?? 'all');
                            setViewing(null);
                        },
                    },
                },
                render: (row) => (
                    <Badge
                        testID={`${purchaseOrderRowTestId(String(row.id))}-status`}
                        tone={purchaseOrderStatusTone(row.status)}
                        label={t(purchaseOrderStatusKey(row.status))}
                    />
                ),
            },
        ];

    const previewColumns: readonly ControlledColumn<
        OrderProposalItem,
        CatalogueColumn<OrderProposalItem>
    >[] = [
        {
            key: 'item',
            role: 'title',
            label: t('kitchen:ops.supplyOrders.columnItem'),
            width: 260,
            priority: 100,
            value: (row) => row.itemNameEn,
            sort: (left, right, direction) =>
                compareText(left.itemNameEn, right.itemNameEn, direction) ||
                compareText(left.itemCode, right.itemCode, direction),
            render: (row) => {
                const testID = supplyOrderRowTestId(String(row.stockItemId));
                return (
                    <View testID={testID} className="min-w-0 flex-row items-center gap-1.5">
                        <Text variant="strong" numberOfLines={1} testID={`${testID}-name`}>
                            {row.itemNameEn}
                        </Text>
                        <Text variant="mono" tone="secondary" testID={`${testID}-code`}>
                            {row.itemCode}
                        </Text>
                    </View>
                );
            },
        },
        {
            key: 'onHand',
            role: 'metric',
            label: t('kitchen:ops.supplyOrders.columnOnHand'),
            width: 180,
            priority: 90,
            value: (row) => `${formatter.formatNumber(Number(row.quantityOnHand))} ${row.unitCode}`,
            // Filters by the badge rather than sorting the figure: the quantities are in each
            // shelf's own unit, so 2 kg against 40 pieces orders nothing a reader could use. The
            // states offered are the ones the queue holds.
            filter: {
                values: (rows) => {
                    const present = new Set(rows.map(shortageState));
                    return (['out', 'low'] as const)
                        .filter((state) => present.has(state))
                        .map((state) => ({
                            key: state,
                            label: t(
                                state === 'out'
                                    ? 'kitchen:ops.supplyOrders.outBadge'
                                    : 'kitchen:ops.supplyOrders.lowBadge',
                            ),
                        }));
                },
                match: (row, value) => shortageState(row) === value,
            },
            render: (row) => {
                const testID = supplyOrderRowTestId(String(row.stockItemId));
                return (
                    <View className="flex-row items-center gap-1.5">
                        <Text variant="mono" testID={`${testID}-on-hand`}>
                            {`${formatter.formatNumber(Number(row.quantityOnHand))} ${row.unitCode}`}
                        </Text>
                        {/* A word and a tone, never colour alone. Out wins when a row is both. */}
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
                    </View>
                );
            },
        },
        {
            key: 'reorderAt',
            label: t('kitchen:ops.supplyOrders.columnReorderAt'),
            width: 120,
            priority: 88,
            align: 'end',
            value: (row) =>
                row.reorderThreshold === null
                    ? EM_DASH
                    : formatter.formatNumber(Number(row.reorderThreshold)),
            sort: (left, right, direction) =>
                compareDecimal(left.reorderThreshold, right.reorderThreshold, direction),
            render: (row) => (
                <Text
                    variant="mono"
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

    const controls = useColumnControls(searched, orderColumns, 'kitchen-supply-orders');
    const unfiltered = trimmed === '' && status === 'all' && supplier === null;

    // Over the whole proposal, then cut to the preview — so a sort or a filter chooses which eight
    // are shown and "and N more" counts what it left out, rather than reordering the first eight.
    const previewControls = useColumnControls(
        shortage,
        previewColumns,
        'kitchen-supply-orders-preview',
    );
    const preview = previewControls.rows.slice(0, PREVIEW_ROWS);
    const remaining = Math.max(previewControls.rows.length - preview.length, 0);

    const statusSegments: readonly CatalogueStatusSegment<StatusSegmentValue>[] = [
        { value: 'all', label: t('kitchen:toolbar.statusAll') },
        ...SEGMENT_STATUSES.map((value) => ({ value, label: t(purchaseOrderStatusKey(value)) })),
    ];

    if (branchId === null) {
        /*
         * The screen does not fetch without a branch. A proposal is always for one site, and asking
         * anyway would spend a 422 to render "validation failed" at somebody who needs to pick one.
         */
        return (
            <Stack space="md" testID="kitchen-supply-orders-screen">
                <EmptyState
                    testID="kitchen-supply-orders-branch-required"
                    title={t('kitchen:ops.supplyOrders.branchRequiredTitle')}
                    body={t('kitchen:ops.supplyOrders.branchRequiredBody')}
                />
            </Stack>
        );
    }

    if (viewing !== null) {
        return (
            <RecordViewPage
                testID="kitchen-supply-orders-view"
                onBack={() => {
                    setViewing(null);
                }}
                title={viewing.number}
                kind={t('kitchen:ops.supplyOrders.viewKind')}
                status={{
                    label: t(purchaseOrderStatusKey(viewing.status)),
                    tone: purchaseOrderStatusTone(viewing.status),
                }}
                fields={viewFields(viewing, t, locale, madeOn)}
                footNote={t('kitchen:ops.supplyOrders.ordersFoot')}
                primaryAction={{
                    label: t('kitchen:list.open'),
                    icon: null,
                    onPress: () => {
                        openOrder(viewing);
                    },
                }}
            />
        );
    }

    return (
        <Stack space="md" testID="kitchen-supply-orders-screen">
            {createdIds.length === 0 ? null : (
                <Callout
                    testID="kitchen-supply-orders-created"
                    tone="success"
                    // `status`, not `alert`: it reports something that has already gone well.
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

            <CatalogueStatCards
                testID="kitchen-supply-orders-stats"
                cards={statCards({
                    outOfStock: needs.data?.outOfStockCount ?? null,
                    low: needs.data?.lowStockCount ?? null,
                    orders: orders.isPending || ordersFailure !== null ? null : controls.rows,
                    t,
                    showDrafts: () => {
                        setStatus('draft');
                        setViewing(null);
                    },
                })}
            />

            <CatalogueToolbar<StatusSegmentValue>
                testID="kitchen-supply-orders-toolbar"
                search={query}
                onSearchChange={(next) => {
                    setQuery(next);
                    setViewing(null);
                }}
                searchLabel={t('kitchen:ops.supplyOrders.searchLabel')}
                searchPlaceholder={t('kitchen:ops.supplyOrders.searchPlaceholder')}
                statusLabel={t('kitchen:toolbar.statusLabel')}
                statusSegments={statusSegments}
                status={status}
                onStatusChange={(next) => {
                    setStatus(next);
                    setViewing(null);
                }}
            >
                <ColumnPicker {...controls.picker} />
                <Button
                    testID="kitchen-supply-orders-prepare"
                    label={t('kitchen:ops.supplyOrders.prepare')}
                    onPress={prepare}
                />
            </CatalogueToolbar>

            {orders.isPending ? (
                <Stack space="xs" testID="kitchen-supply-orders-book-loading">
                    {Array.from({ length: 5 }, (_, index) => (
                        <Skeleton
                            key={index}
                            testID={`kitchen-supply-orders-book-skeleton-${String(index + 1)}`}
                            heightClassName="h-row-sm"
                        />
                    ))}
                </Stack>
            ) : ordersFailure !== null ? (
                // Its own failure: the book failing to load is not a reason to hide the queue.
                <ErrorState
                    testID="kitchen-supply-orders-book-error"
                    failure={ordersFailure}
                    onRetry={() => {
                        void orders.refetch();
                    }}
                    retrying={orders.isFetching}
                />
            ) : controls.rows.length === 0 ? (
                <EmptyState
                    testID="kitchen-supply-orders-book-empty"
                    title={
                        unfiltered
                            ? t('kitchen:ops.supplyOrders.ordersEmptyTitle')
                            : t('kitchen:ops.supplyOrders.ordersFilteredEmptyTitle')
                    }
                    body={
                        unfiltered
                            ? t('kitchen:ops.supplyOrders.ordersEmptyBody')
                            : t('kitchen:ops.supplyOrders.ordersFilteredEmptyBody')
                    }
                    // The table — and the headers that narrowed it — is gone in this state, so the
                    // way back has to be here.
                    actions={
                        unfiltered ? undefined : (
                            <Button
                                testID="kitchen-supply-orders-book-clear"
                                variant="secondary"
                                size="sm"
                                label={t('kitchen:toolbar.clearFilters')}
                                onPress={() => {
                                    setQuery('');
                                    setStatus('all');
                                    setSupplier(null);
                                    setViewing(null);
                                }}
                            />
                        )
                    }
                />
            ) : (
                <Stack space="sm">
                    <CatalogueList<PurchaseOrder>
                        testID="kitchen-supply-orders-book-table"
                        label={t('kitchen:ops.supplyOrders.ordersCaption')}
                        columns={controls.columns}
                        rows={controls.rows}
                        rowKey={(row) => String(row.id)}
                        density="sm"
                        onRowPress={openOrder}
                        rowActionsLabel={t('kitchen:list.rowActions')}
                        rowActions={(row): readonly MenuItem[] => [
                            {
                                key: 'view',
                                label: t('kitchen:list.view'),
                                icon: CATALOGUE_ROW_ICONS.view,
                                testID: `${purchaseOrderRowTestId(String(row.id))}-view`,
                                onSelect: () => {
                                    setViewing(row);
                                },
                            },
                            {
                                key: 'open',
                                label: t('kitchen:catalogue.edit'),
                                icon: CATALOGUE_ROW_ICONS.edit,
                                testID: `${purchaseOrderRowTestId(String(row.id))}-open`,
                                onSelect: () => {
                                    openOrder(row);
                                },
                            },
                        ]}
                    />
                    <Text variant="caption" tone="secondary" testID="kitchen-supply-orders-foot">
                        {t('kitchen:ops.supplyOrders.ordersFoot')}
                    </Text>
                </Stack>
            )}

            <FormSection
                testID="kitchen-supply-orders-needs"
                title={t('kitchen:ops.supplyOrders.previewTitle')}
                {...(shortagePending || shortageFailure !== null
                    ? {}
                    : {
                          description: t('kitchen:ops.supplyOrders.needsCount', {
                              count: shortage.length,
                          }),
                      })}
            >
                {shortagePending ? (
                    <Stack space="xs" testID="kitchen-supply-orders-loading">
                        {Array.from({ length: 3 }, (_, index) => (
                            <Skeleton
                                key={index}
                                testID={`kitchen-supply-orders-skeleton-${String(index + 1)}`}
                                heightClassName="h-row-sm"
                            />
                        ))}
                    </Stack>
                ) : shortageFailure !== null ? (
                    <ErrorState
                        testID="kitchen-supply-orders-error"
                        failure={shortageFailure}
                        onRetry={() => {
                            void needs.refetch();
                            void proposal.refetch();
                        }}
                        retrying={needs.isFetching || proposal.isFetching}
                    />
                ) : queueEmpty ? (
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
                                onPress={prepare}
                            />
                        }
                    />
                ) : (
                    <Stack space="sm">
                        <WithColumnPicker picker={previewControls.picker}>
                            <CatalogueList<OrderProposalItem>
                                testID="kitchen-supply-orders-preview"
                                label={t('kitchen:ops.supplyOrders.previewCaption')}
                                columns={previewControls.columns}
                                rows={preview}
                                rowKey={(row) => String(row.stockItemId)}
                                density="sm"
                                rowActionsLabel={t('kitchen:list.rowActions')}
                            />
                        </WithColumnPicker>
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
            </FormSection>
        </Stack>
    );
}

function viewFields(
    row: PurchaseOrder,
    t: TFunction,
    locale: string,
    madeOn: (row: PurchaseOrder) => string,
) {
    return [
        {
            key: 'supplier',
            label: t('kitchen:ops.supplyOrders.columnSupplier'),
            value: supplierName(row, locale),
        },
        {
            key: 'branch',
            label: t('kitchen:ops.supplyOrders.viewBranch'),
            value: row.branch === null ? EM_DASH : row.branch.name,
        },
        { key: 'madeOn', label: t('kitchen:ops.supplyOrders.columnMadeOn'), value: madeOn(row) },
        {
            key: 'lines',
            label: t('kitchen:ops.supplyOrders.columnLines'),
            value: String(row.lineCount),
            mono: true,
        },
        {
            key: 'notes',
            label: t('kitchen:ops.supplyOrders.notesTitle'),
            value: row.notes ?? t('kitchen:ops.supplyOrders.noNotes'),
        },
    ];
}

interface StatInputs {
    readonly outOfStock: number | null;
    readonly low: number | null;
    /** `null` while the book is loading or failed — the cards then say nothing rather than zero. */
    readonly orders: readonly PurchaseOrder[] | null;
    readonly t: TFunction;
    readonly showDrafts: () => void;
}

function statCards({
    outOfStock,
    low,
    orders,
    t,
    showDrafts,
}: StatInputs): readonly CatalogueStatCard[] {
    const count = (statuses: readonly PurchaseOrderStatus[]) =>
        orders === null
            ? EM_DASH
            : String(orders.filter((row) => statuses.includes(row.status)).length);
    return [
        {
            // Exact, from the count endpoint. `—` while pending: a zero would claim the shelves are
            // fine before anybody has looked.
            key: 'outOfStock',
            label: t('kitchen:ops.supplyOrders.metrics.outOfStock'),
            value: outOfStock === null ? EM_DASH : String(outOfStock),
            unit: t('kitchen:ops.supplyOrders.statItemsUnit'),
            caption: t('kitchen:ops.supplyOrders.statOutCaption'),
            mark: 'warning',
            tone: outOfStock !== null && outOfStock > 0 ? 'danger' : 'default',
        },
        {
            key: 'low',
            label: t('kitchen:ops.supplyOrders.metrics.low'),
            value: low === null ? EM_DASH : String(low),
            unit: t('kitchen:ops.supplyOrders.statItemsUnit'),
            caption: t('kitchen:ops.supplyOrders.statLowCaption'),
            mark: 'warning',
            tone: low !== null && low > 0 ? 'warning' : 'default',
        },
        {
            key: 'draft',
            label: t(purchaseOrderStatusKey('draft')),
            value: count(['draft']),
            unit: t('kitchen:ops.supplyOrders.statOrdersUnit'),
            caption: t('kitchen:ops.supplyOrders.statDraftCaption'),
            mark: 'clock',
            onPress: showDrafts,
            accessibilityLabel: t('kitchen:ops.supplyOrders.statDraftAction'),
        },
        {
            key: 'issued',
            label: t(purchaseOrderStatusKey('issued')),
            value: count(['issued', 'partially_received']),
            unit: t('kitchen:ops.supplyOrders.statOrdersUnit'),
            caption: t('kitchen:ops.supplyOrders.statIssuedCaption'),
            mark: 'basket',
        },
    ];
}
