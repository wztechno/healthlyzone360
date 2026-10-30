import type { GoodsReceipt, ReceiptCostStatus } from '@healthy360/api-client/contracts';
import {
    Badge,
    Button,
    Cascade,
    EmptyState,
    ErrorState,
    Inline,
    Stack,
    TableSkeleton,
    Text,
    TextInputField,
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
import { LensBar } from '../catalogue/lens-bar.tsx';
import type { LensFigure, LensMixPart, LensToken } from '../catalogue/lens-bar.tsx';
import {
    compareAmount,
    compareNumber,
    compareText,
    useColumnControls,
} from '../catalogue/use-column-controls.tsx';
import type { ControlledColumn } from '../catalogue/use-column-controls.tsx';
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
import { useViewedRecord } from '../use-viewed-record.ts';

/**
 * `/kitchen/procurement` — the receipts book, and the direct-purchase path (O2, SUP5).
 *
 * ```
 * (All receipts 50) │ ● No prices 4  ● Some prices 2  ● Priced 44              [Post receipt]
 * [ lot ]  [ ⌕ supplier or reference ]  [Prices: No prices ×]                    4 of 50  Clear
 * RECEIVED      SUPPLIER      LINES  REFERENCES        TOTAL   PRICES      ⋯
 * ```
 *
 * The Operations handoff's list on the Catalogue parts: the Lens bar, whose price-completeness
 * figures are counted over the receipts in hand and filter them, `CatalogueList`, and the
 * `RecordWindow` behind View. `listGoodsReceipts` takes no filter and publishes no page, so search and
 * the figures narrow the rows already loaded and there is no pager. A posted receipt is immutable,
 * so View is the only row action.
 *
 * **Post receipt** opens `/kitchen/procurement/new` — the market purchase, on a page of its own
 * (`post-receipt-screen.tsx`) rather than the dialog it used to be. A delivery against an issued
 * order goes to `/kitchen/procurement/receive` instead.
 */

export function ProcurementScreen({ view }: { readonly view?: string | undefined }) {
    return (
        <Gate
            area="kitchen"
            requirement={{ allOf: [INVENTORY_VIEW_PERMISSION] }}
            testID="kitchen-procurement"
        >
            <Procurement view={view} />
        </Gate>
    );
}

/** The design's "Prices" segments — the receipt's cost status, a closed set of three. */
const PRICE_SEGMENTS: readonly ReceiptCostStatus[] = ['unpriced', 'partial', 'complete'];
type PriceSegmentValue = ReceiptCostStatus | 'all';

function Procurement({ view }: { readonly view?: string | undefined }) {
    const { t } = useTranslation();
    const formatter = useFormatter();
    const router = useRouter();
    const canManage = useCan(INVENTORY_MANAGE_PERMISSION);
    const canViewCosts = useCan(INVENTORY_VIEW_COSTS_PERMISSION);

    /**
     * The recall question (ingredient barcodes): which deliveries brought a lot. Asked of the server,
     * on Enter — the list in hand is only the latest fifty, and a recall is exactly the case where
     * the delivery is older than that.
     */
    const [lot, setLot] = useState('');
    const [appliedLot, setAppliedLot] = useState('');
    const receipts = useGoodsReceiptsQuery(
        true,
        appliedLot === '' ? {} : { supplierLot: appliedLot },
    );
    const stockItems = useStockItemsQuery();

    // The list's own state: search and the price segment filter the receipts in hand (the endpoint
    // takes no filter and publishes no page), and View opens the record window over a row.
    const [query, setQuery] = useState('');
    const [priceStatus, setPriceStatus] = useState<PriceSegmentValue>('all');

    const receiptRows = useMemo(() => receipts.data ?? [], [receipts.data]);
    // The open receipt is an address, `?view=`, so Back and a refresh keep it open.
    const { viewing, setViewing } = useViewedRecord(
        view,
        receiptRows,
        (row) => String(row.id),
        receipts.isSuccess && !receipts.isFetching,
    );

    // By name alone, as the receipt form's picker labels them: the code is the name's slug.
    const stockItemLabelById = useMemo(() => {
        const map = new Map<string, string>();
        for (const item of stockItems.data ?? []) map.set(String(item.id), item.nameEn);
        return map;
    }, [stockItems.data]);

    const trimmed = query.trim().toLocaleLowerCase();
    // The receipts under the search, every price state in them — what the Lens bar's figures count.
    const searchedReceipts = useMemo(
        () =>
            trimmed === ''
                ? receiptRows
                : receiptRows.filter((row) =>
                      [
                          row.supplier?.nameEn,
                          row.supplier?.code,
                          row.documentRef,
                          row.supplierInvoiceRef,
                      ]
                          .filter((value): value is string => value !== null && value !== undefined)
                          .some((value) => value.toLocaleLowerCase().includes(trimmed)),
                  ),
        [receiptRows, trimmed],
    );
    const filteredReceipts = useMemo(
        () =>
            priceStatus === 'all'
                ? searchedReceipts
                : searchedReceipts.filter((row) => row.costStatus === priceStatus),
        [searchedReceipts, priceStatus],
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

    const lens = receiptLens(
        receipts.isPending || failure !== null ? null : searchedReceipts,
        priceStatus,
        t,
        (next) => {
            setPriceStatus(next);
            setViewing(null);
        },
    );
    const clearLot = () => {
        setLot('');
        setAppliedLot('');
        setViewing(null);
    };
    // The lot asked of the server, removable like any filter in force.
    const lotLabel = t('kitchen:lens.token', {
        label: t('kitchen:barcodes.lotFilterLabel'),
        value: appliedLot,
    });
    const lotTokens: readonly LensToken[] =
        appliedLot === ''
            ? []
            : [
                  {
                      key: 'lot',
                      label: lotLabel,
                      removeLabel: t('kitchen:toolbar.removeFilter', { filter: lotLabel }),
                      onRemove: clearLot,
                  },
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
                                {line.supplierLot === null
                                    ? ''
                                    : ` · ${t('kitchen:barcodes.lotShort', { lot: line.supplierLot })}`}
                                {line.expiresOn === null
                                    ? ''
                                    : ` · ${t('kitchen:barcodes.expiresShort', {
                                          date: formatter.formatDate(line.expiresOn, {
                                              dateStyle: 'medium',
                                              timeZone: 'UTC',
                                          }),
                                      })}`}
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
            {/*
             * The Lens bar — the price states as figures over the mix, the lot and the search on the
             * query row, the way to suppliers and the unpriced queue beside Post receipt.
             */}
            <LensBar
                testID="kitchen-procurement-toolbar"
                label={t('kitchen:lens.label')}
                figures={lens.figures}
                mix={lens.mix}
                mixLabel={lens.mixLabel}
                scope={
                    <TextInputField
                        testID="kitchen-procurement-lot-filter"
                        id="kitchen-procurement-lot-filter"
                        size="sm"
                        label={t('kitchen:barcodes.lotFilterLabel')}
                        labelHidden
                        placeholder={t('kitchen:barcodes.lotFilterPlaceholder')}
                        value={lot}
                        maxLength={20}
                        autoCorrect={false}
                        autoCapitalize="none"
                        onChangeText={(next) => {
                            setLot(next);
                            // Emptied, the list goes back to the latest fifty at once.
                            if (next.trim() === '') setAppliedLot('');
                        }}
                        onSubmitEditing={() => {
                            setAppliedLot(lot.trim());
                            setViewing(null);
                        }}
                    />
                }
                search={query}
                onSearchChange={(next) => {
                    setQuery(next);
                    setViewing(null);
                }}
                searchLabel={t('kitchen:toolbar.searchLabel')}
                searchPlaceholder={t('kitchen:ops.procurement.searchPlaceholder')}
                tokens={[...lens.tokens, ...lotTokens]}
                result={
                    receipts.isPending || failure !== null
                        ? null
                        : t('kitchen:lens.result', {
                              shown: controls.rows.length,
                              total: receiptRows.length,
                          })
                }
                clearLabel={t('kitchen:lens.clear')}
                {...(unfiltered && appliedLot === '' && !controls.filtered
                    ? {}
                    : {
                          onClear: () => {
                              setQuery('');
                              setPriceStatus('all');
                              controls.clearFilters();
                              clearLot();
                          },
                      })}
                trailing={(narrow) => <ColumnPicker {...controls.picker} compact={narrow} />}
                actions={
                    <Inline space="xs" align="center">
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
                    </Inline>
                }
            />

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

/** "DN-4471 · INV-8820" — the delivery note and the invoice number, or the words for none. */
function refsText(row: GoodsReceipt, t: TFunction): string {
    return `${row.documentRef ?? '—'} · ${
        row.supplierInvoiceRef ?? t('kitchen:ops.unpricedReceipts.noInvoiceRef')
    }`;
}

/** The price figures, in the order a receipt is finished, and the dot each one carries. */
const PRICE_TONES: Readonly<Record<ReceiptCostStatus, LensMixPart['tone']>> = {
    unpriced: 'warning',
    partial: 'info',
    complete: 'success',
};

const PRICE_ACTIONS: Readonly<Record<ReceiptCostStatus, string>> = {
    unpriced: 'kitchen:lens.receiptsUnpricedAction',
    partial: 'kitchen:lens.receiptsPartialAction',
    complete: 'kitchen:lens.receiptsCompleteAction',
};

/**
 * The Lens bar's figures, mix and token: All, then one figure per price state, each a filter.
 * Counted over the receipts in hand under the search, every state in them, so they add up to All.
 * `rows` is `null` while the book is in flight or failed — the figures then hold their line.
 */
function receiptLens(
    rows: readonly GoodsReceipt[] | null,
    priceStatus: PriceSegmentValue,
    t: TFunction,
    pick: (next: PriceSegmentValue) => void,
): {
    readonly figures: readonly LensFigure[];
    readonly mix: readonly LensMixPart[];
    readonly mixLabel: string;
    readonly tokens: readonly LensToken[];
} {
    const count = (status: ReceiptCostStatus) =>
        rows === null ? null : rows.filter((row) => row.costStatus === status).length;
    const tokenLabel =
        priceStatus === 'all'
            ? null
            : t('kitchen:lens.token', {
                  label: t('kitchen:ops.procurement.columnCostStatus'),
                  value: t(receiptCostStatusKey(priceStatus)),
              });

    return {
        figures: [
            {
                key: 'all',
                label: t('kitchen:lens.allReceipts'),
                value: rows?.length ?? null,
                active: priceStatus === 'all',
                onPress: () => {
                    pick('all');
                },
                accessibilityLabel: t('kitchen:lens.allAction'),
            },
            ...PRICE_SEGMENTS.map((status, index): LensFigure => ({
                key: status,
                label: t(receiptCostStatusKey(status)),
                value: count(status),
                tone: PRICE_TONES[status],
                separated: index === 0,
                active: priceStatus === status,
                onPress: () => {
                    pick(status);
                },
                accessibilityLabel: t(PRICE_ACTIONS[status]),
            })),
        ],
        mix: PRICE_SEGMENTS.map((status) => ({
            key: status,
            value: count(status) ?? 0,
            tone: PRICE_TONES[status],
            dimmed: priceStatus !== 'all' && priceStatus !== status,
        })),
        mixLabel: t('kitchen:lens.receiptsMix', {
            unpriced: count('unpriced') ?? 0,
            partial: count('partial') ?? 0,
            complete: count('complete') ?? 0,
        }),
        tokens:
            tokenLabel === null
                ? []
                : [
                      {
                          key: 'prices',
                          label: tokenLabel,
                          removeLabel: t('kitchen:toolbar.removeFilter', { filter: tokenLabel }),
                          onRemove: () => {
                              pick('all');
                          },
                      },
                  ],
    };
}
