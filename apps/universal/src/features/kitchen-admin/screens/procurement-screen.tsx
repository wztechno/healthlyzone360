import type { GoodsReceipt, ReceiptCostStatus } from '@healthy360/api-client/contracts';
import {
    Badge,
    Button,
    Cascade,
    EmptyState,
    ErrorState,
    Stack,
    TableSkeleton,
    Text,
} from '@healthy360/design-system';
import type { MenuItem } from '@healthy360/design-system';
import { useFormatter } from '@healthy360/i18n';
import { useRouter } from 'expo-router';
import type { TFunction } from 'i18next';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { Gate, useCan } from '../../../access/gate.tsx';
import { toFailure } from '../../../data/hooks.ts';
import { useGoodsReceiptsQuery, useStockItemsQuery } from '../../../data/kitchen-ops-hooks.ts';
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
import {
    INVENTORY_MANAGE_PERMISSION,
    INVENTORY_VIEW_COSTS_PERMISSION,
    INVENTORY_VIEW_PERMISSION,
} from '../entity-registry.ts';
import {
    goodsReceiptRowTestId,
    receiptCostStatusKey,
    receiptCostStatusTone,
} from '../ops-format.ts';
import { RecordViewPage } from '../catalogue/record-view-page.tsx';
import { ColumnPicker } from '../catalogue/column-picker.tsx';

/**
 * `/kitchen/procurement` — the receipts book, and the direct-purchase path (O2, SUP5).
 *
 * ```
 * ┌ NO PRICES ┐ ┌ SOME PRICES ┐ ┌ PRICED ┐
 * [ ⌕ supplier or reference ]  Prices [ All | No prices | Some prices | Priced ]  [Post receipt]
 * RECEIVED      SUPPLIER      LINES  REFERENCES        TOTAL   PRICES      ⋯
 * ```
 *
 * The Operations handoff's list on the Catalogue parts: stat cards counted over the receipts in
 * hand, the toolbar with the price-completeness segments, `CatalogueList`, and the `RecordWindow`
 * behind View. `listGoodsReceipts` takes no filter and publishes no page, so search and the
 * segments narrow the rows already loaded and there is no pager. A posted receipt is immutable, so
 * View is the only row action.
 *
 * **Post receipt** opens `/kitchen/procurement/new` — the market purchase, on a page of its own
 * (`post-receipt-screen.tsx`) rather than the dialog it used to be. A delivery against an issued
 * order goes to `/kitchen/procurement/receive` instead.
 */

export function ProcurementScreen() {
    return (
        <Gate
            area="kitchen"
            requirement={{ allOf: [INVENTORY_VIEW_PERMISSION] }}
            testID="kitchen-procurement"
        >
            <Procurement />
        </Gate>
    );
}

/** The design's "Prices" segments — the receipt's cost status, a closed set of three. */
const PRICE_SEGMENTS: readonly ReceiptCostStatus[] = ['unpriced', 'partial', 'complete'];
type PriceSegmentValue = ReceiptCostStatus | 'all';

function Procurement() {
    const { t } = useTranslation();
    const formatter = useFormatter();
    const router = useRouter();
    const canManage = useCan(INVENTORY_MANAGE_PERMISSION);
    const canViewCosts = useCan(INVENTORY_VIEW_COSTS_PERMISSION);

    const receipts = useGoodsReceiptsQuery();
    const stockItems = useStockItemsQuery();

    // The list's own state: search and the price segment filter the receipts in hand (the endpoint
    // takes no filter and publishes no page), and View opens the record window over a row.
    const [query, setQuery] = useState('');
    const [priceStatus, setPriceStatus] = useState<PriceSegmentValue>('all');
    const [viewing, setViewing] = useState<GoodsReceipt | null>(null);

    const receiptRows = useMemo(() => receipts.data ?? [], [receipts.data]);

    // By name alone, as the receipt form's picker labels them: the code is the name's slug.
    const stockItemLabelById = useMemo(() => {
        const map = new Map<string, string>();
        for (const item of stockItems.data ?? []) map.set(String(item.id), item.nameEn);
        return map;
    }, [stockItems.data]);

    const trimmed = query.trim().toLocaleLowerCase();
    const filteredReceipts = useMemo(
        () =>
            receiptRows.filter((row) => {
                if (priceStatus !== 'all' && row.costStatus !== priceStatus) return false;
                if (trimmed === '') return true;
                return [
                    row.supplier?.nameEn,
                    row.supplier?.code,
                    row.documentRef,
                    row.supplierInvoiceRef,
                ]
                    .filter((value): value is string => value !== null && value !== undefined)
                    .some((value) => value.toLocaleLowerCase().includes(trimmed));
            }),
        [receiptRows, priceStatus, trimmed],
    );

    const receivedText = (row: GoodsReceipt): string =>
        row.receivedOn !== null
            ? formatter.formatDate(row.receivedOn, { dateStyle: 'medium' })
            : row.receivedAt !== null
              ? formatter.formatDate(row.receivedAt, { dateStyle: 'medium', timeStyle: 'short' })
              : t('kitchen:ops.procurement.notYetReceived');

    const totalText = (row: GoodsReceipt): string =>
        row.receiptTotalAmount === null || row.currencyCode === null
            ? row.costsRedacted
                ? t('kitchen:ops.procurement.costsRedacted')
                : '—'
            : `${formatter.formatNumber(Number(row.receiptTotalAmount), {
                  minimumFractionDigits: 2,
                  maximumFractionDigits: 2,
              })} ${row.currencyCode}`;

    const columns: readonly ControlledColumn<GoodsReceipt, CatalogueColumn<GoodsReceipt>>[] = [
        {
            key: 'receivedAt',
            role: 'title',
            label: t('kitchen:ops.procurement.columnReceivedAt'),
            width: 190,
            priority: 100,
            value: receivedText,
            sort: (left, right, direction) =>
                compareText(
                    left.receivedOn ?? left.receivedAt ?? '',
                    right.receivedOn ?? right.receivedAt ?? '',
                    direction,
                ),
            render: (row) => (
                <Text
                    variant="strong"
                    numberOfLines={1}
                    testID={`${goodsReceiptRowTestId(String(row.id))}-received-at`}
                >
                    {receivedText(row)}
                </Text>
            ),
        },
        {
            key: 'supplier',
            label: t('kitchen:ops.procurement.columnSupplier'),
            width: 200,
            priority: 90,
            value: (row) => row.supplier?.nameEn ?? t('kitchen:ops.procurement.noSupplier'),
            sort: (left, right, direction) =>
                compareText(left.supplier?.nameEn ?? '', right.supplier?.nameEn ?? '', direction),
            render: (row) => (
                <Text
                    tone="secondary"
                    numberOfLines={1}
                    testID={`${goodsReceiptRowTestId(String(row.id))}-supplier`}
                >
                    {row.supplier === null
                        ? t('kitchen:ops.procurement.noSupplier')
                        : row.supplier.nameEn}
                </Text>
            ),
        },
        {
            key: 'lines',
            role: 'metric',
            label: t('kitchen:ops.procurement.columnLines'),
            width: 70,
            priority: 70,
            value: (row) => String(row.lines.length),
            sort: (left, right, direction) =>
                compareNumber(left.lines.length, right.lines.length, direction),
            render: (row) => (
                <Text variant="mono" testID={`${goodsReceiptRowTestId(String(row.id))}-lines`}>
                    {formatter.formatNumber(row.lines.length)}
                </Text>
            ),
        },
        {
            key: 'refs',
            role: 'meta',
            label: t('kitchen:ops.procurement.columnRefs'),
            width: 190,
            priority: 60,
            value: (row) => refsText(row, t),
            // The delivery note first, then the invoice number — the order the cell reads in.
            sort: (left, right, direction) => {
                const byNote = compareText(left.documentRef, right.documentRef, direction);
                return byNote !== 0
                    ? byNote
                    : compareText(left.supplierInvoiceRef, right.supplierInvoiceRef, direction);
            },
            render: (row) => (
                <Text variant="mono" tone="secondary" numberOfLines={1}>
                    {refsText(row, t)}
                </Text>
            ),
        },
        {
            key: 'total',
            role: 'metric',
            label: t('kitchen:ops.procurement.columnTotal'),
            width: 120,
            priority: 50,
            value: totalText,
            sort: (left, right, direction) =>
                compareAmount(left.receiptTotalAmount, right.receiptTotalAmount, direction),
            render: (row) => (
                <Text variant="mono" testID={`${goodsReceiptRowTestId(String(row.id))}-total`}>
                    {totalText(row)}
                </Text>
            ),
        },
        {
            key: 'costStatus',
            role: 'status',
            label: t('kitchen:ops.procurement.columnCostStatus'),
            width: 120,
            priority: 80,
            value: (row) => t(receiptCostStatusKey(row.costStatus)),
            // The same state the toolbar's Prices segments hold, so the header and the segments
            // can never disagree about which receipts are showing.
            filter: {
                values: () =>
                    PRICE_SEGMENTS.map((value) => ({
                        key: value,
                        label: t(receiptCostStatusKey(value)),
                    })),
                external: {
                    value: priceStatus === 'all' ? null : priceStatus,
                    onChange: (next) => {
                        setPriceStatus(PRICE_SEGMENTS.find((value) => value === next) ?? 'all');
                        setViewing(null);
                    },
                },
            },
            render: (row) => (
                <View className="min-w-0 flex-row flex-wrap items-center gap-1.5">
                    <Badge
                        tone={receiptCostStatusTone(row.costStatus)}
                        testID={`${goodsReceiptRowTestId(String(row.id))}-cost-status`}
                        label={t(receiptCostStatusKey(row.costStatus))}
                    />
                    {row.valuationPendingCount > 0 ? (
                        <Text variant="caption" tone="secondary">
                            {t('kitchen:ops.procurement.pendingFxCount', {
                                count: row.valuationPendingCount,
                            })}
                        </Text>
                    ) : null}
                </View>
            ),
        },
    ];

    const controls = useColumnControls(filteredReceipts, columns, 'kitchen-procurement');
    const failure = toFailure(receipts.error);
    const unfiltered = trimmed === '' && priceStatus === 'all';

    const priceSegments: readonly CatalogueStatusSegment<PriceSegmentValue>[] = [
        { value: 'all', label: t('kitchen:toolbar.statusAll') },
        ...PRICE_SEGMENTS.map((value) => ({ value, label: t(receiptCostStatusKey(value)) })),
    ];

    if (viewing !== null) {
        return (
            <RecordViewPage
                testID="kitchen-procurement-view"
                onBack={() => {
                    setViewing(null);
                }}
                title={receivedText(viewing)}
                kind={t('kitchen:ops.procurement.viewKind')}
                status={{
                    label: t(receiptCostStatusKey(viewing.costStatus)),
                    tone: receiptCostStatusTone(viewing.costStatus),
                }}
                {...(viewing.costStatus === 'complete'
                    ? {}
                    : { note: t('kitchen:ops.procurement.viewUnpricedNote') })}
                fields={[
                    {
                        key: 'supplier',
                        label: t('kitchen:ops.procurement.columnSupplier'),
                        value: viewing.supplier?.nameEn ?? t('kitchen:ops.procurement.noSupplier'),
                    },
                    {
                        key: 'documentRef',
                        label: t('kitchen:ops.procurement.fieldDocumentRef'),
                        value: viewing.documentRef ?? '—',
                        mono: true,
                    },
                    {
                        key: 'invoiceRef',
                        label: t('kitchen:ops.procurement.fieldInvoiceRef'),
                        value: viewing.supplierInvoiceRef ?? '—',
                        mono: true,
                    },
                    {
                        key: 'total',
                        label: t('kitchen:ops.procurement.columnTotal'),
                        value: totalText(viewing),
                        mono: true,
                    },
                ]}
                lines={
                    <Stack space="none" testID="kitchen-procurement-view-lines">
                        {viewing.lines.map((line) => (
                            <Text key={line.id} variant="caption" tone="secondary">
                                {formatter.formatNumber(Number(line.quantity))} ×{' '}
                                {stockItemLabelById.get(String(line.stockItemId)) ??
                                    line.stockItemId}
                            </Text>
                        ))}
                    </Stack>
                }
                footNote={t('kitchen:ops.procurement.listFoot')}
                {...(canViewCosts && viewing.costStatus !== 'complete'
                    ? {
                          primaryAction: {
                              label: t('kitchen:ops.procurement.unpricedReceipts'),
                              icon: null,
                              onPress: () => {
                                  setViewing(null);
                                  router.push('/kitchen/procurement/unpriced-receipts' as never);
                              },
                          },
                      }
                    : {})}
            />
        );
    }

    return (
        <Cascade space="md" testID="kitchen-procurement-screen">
            {failure !== null ? null : (
                <CatalogueStatCards
                    testID="kitchen-procurement-stats"
                    cards={receiptStatCards(controls.rows, t)}
                    pending={receipts.isPending}
                />
            )}

            <CatalogueToolbar<PriceSegmentValue>
                testID="kitchen-procurement-toolbar"
                search={query}
                onSearchChange={(next) => {
                    setQuery(next);
                    setViewing(null);
                }}
                searchLabel={t('kitchen:toolbar.searchLabel')}
                searchPlaceholder={t('kitchen:ops.procurement.searchPlaceholder')}
                statusLabel={t('kitchen:ops.procurement.columnCostStatus')}
                statusSegments={priceSegments}
                status={priceStatus}
                onStatusChange={(next) => {
                    setPriceStatus(next);
                    setViewing(null);
                }}
            >
                <ColumnPicker {...controls.picker} />
                {/*
                 * Suppliers have their own screen (SUP1) and the unpriced queue is the cost
                 * holder's; both stay one press from the receipts book, beside the one primary.
                 */}
                <Button
                    testID="kitchen-procurement-manage-suppliers"
                    size="sm"
                    variant="ghost"
                    label={t('kitchen:ops.procurement.manageSuppliers')}
                    onPress={() => {
                        router.push('/kitchen/suppliers' as never);
                    }}
                />
                {canViewCosts ? (
                    <Button
                        testID="kitchen-procurement-unpriced-link"
                        size="sm"
                        variant="ghost"
                        label={t('kitchen:ops.procurement.unpricedReceipts')}
                        onPress={() => {
                            router.push('/kitchen/procurement/unpriced-receipts' as never);
                        }}
                    />
                ) : null}
                {canManage ? (
                    <Button
                        testID="kitchen-procurement-post-receipt"
                        label={t('kitchen:ops.procurement.postReceipt')}
                        onPress={() => {
                            router.push('/kitchen/procurement/new' as never);
                        }}
                    />
                ) : null}
            </CatalogueToolbar>

            {receipts.isPending ? (
                <TableSkeleton
                    testID="kitchen-procurement-loading"
                    partTestID="kitchen-procurement"
                />
            ) : failure !== null ? (
                <ErrorState
                    testID="kitchen-procurement-error"
                    failure={failure}
                    onRetry={() => {
                        void receipts.refetch();
                    }}
                    retrying={receipts.isFetching}
                />
            ) : controls.rows.length === 0 ? (
                <EmptyState
                    testID="kitchen-procurement-receipts-empty"
                    title={
                        unfiltered
                            ? t('kitchen:ops.procurement.emptyTitle')
                            : t('kitchen:list.filteredEmptyTitle')
                    }
                    body={
                        unfiltered
                            ? t('kitchen:ops.procurement.emptyBody')
                            : t('kitchen:ops.procurement.filteredEmptyBody')
                    }
                />
            ) : (
                <Stack space="sm">
                    <CatalogueList<GoodsReceipt>
                        testID="kitchen-procurement-receipts-table"
                        label={t('kitchen:ops.procurement.receiptsTitle')}
                        columns={controls.columns}
                        rows={controls.rows}
                        rowKey={(row) => String(row.id)}
                        density="sm"
                        onRowPress={setViewing}
                        rowActionsLabel={t('kitchen:list.rowActions')}
                        // View only: a posted receipt is immutable (§3.6). Its missing prices are
                        // finished in the unpriced queue, which the View window links to.
                        rowActions={(row): readonly MenuItem[] => [
                            {
                                key: 'view',
                                label: t('kitchen:list.view'),
                                icon: CATALOGUE_ROW_ICONS.view,
                                testID: `${goodsReceiptRowTestId(String(row.id))}-view`,
                                onSelect: () => {
                                    setViewing(row);
                                },
                            },
                        ]}
                    />
                </Stack>
            )}
        </Cascade>
    );
}

/** A money amount as the wire sends it, in `direction`, with no amount (redacted, unpriced) last. */
function compareAmount(
    left: string | null,
    right: string | null,
    direction: SortDirection,
): number {
    if (left === null || right === null) return left === right ? 0 : left === null ? 1 : -1;
    return compareNumber(Number(left), Number(right), direction);
}

/** "DN-4471 · INV-8820" — the delivery note and the invoice number, or the words for none. */
function refsText(row: GoodsReceipt, t: TFunction): string {
    return `${row.documentRef ?? '—'} · ${
        row.supplierInvoiceRef ?? t('kitchen:ops.unpricedReceipts.noInvoiceRef')
    }`;
}

/** Counted over the receipts in hand, like the design's CARDS: one card per price state. */
function receiptStatCards(
    rows: readonly GoodsReceipt[],
    t: TFunction,
): readonly CatalogueStatCard[] {
    const count = (status: ReceiptCostStatus) =>
        rows.filter((row) => row.costStatus === status).length;
    const unpriced = count('unpriced');
    const partial = count('partial');
    return [
        {
            key: 'unpriced',
            label: t(receiptCostStatusKey('unpriced')),
            value: String(unpriced),
            unit: t('kitchen:ops.procurement.statReceiptsUnit'),
            caption: t('kitchen:ops.procurement.statUnpricedCaption'),
            mark: 'coins',
            tone: unpriced === 0 ? 'default' : 'warning',
        },
        {
            key: 'partial',
            label: t(receiptCostStatusKey('partial')),
            value: String(partial),
            unit: t('kitchen:ops.procurement.statReceiptsUnit'),
            caption: t('kitchen:ops.procurement.statPartialCaption'),
            mark: 'alert',
            tone: partial === 0 ? 'default' : 'warning',
        },
        {
            key: 'complete',
            label: t(receiptCostStatusKey('complete')),
            value: String(count('complete')),
            unit: t('kitchen:ops.procurement.statReceiptsUnit'),
            caption: t('kitchen:ops.procurement.statCompleteCaption'),
            mark: 'circleCheck',
        },
    ];
}
