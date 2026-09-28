import type { GoodsReceiptDetail, GoodsReceiptLine, StockItem } from '@healthy360/api-client/contracts';
import {
    Badge,
    Button,
    Callout,
    Card,
    DataList,
    Dialog,
    EmptyState,
    ErrorState,
    RecordSkeleton,
    RecordWindowFieldGrid,
    Stack,
    QuantityInput,
    Text,
    useToast,
} from '@healthy360/design-system';
import type { DataListColumn, RecordWindowField } from '@healthy360/design-system';
import { GoodsReceiptId } from '@healthy360/domain-types';
import { useFormatter } from '@healthy360/i18n';
import type { Formatter } from '@healthy360/i18n';
import { useRouter } from 'expo-router';
import type { TFunction } from 'i18next';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { Gate } from '../../../access/gate.tsx';
import { toFailure } from '../../../data/hooks.ts';
import {
    useCompleteReceiptPricesMutation,
    useGoodsReceiptQuery,
    useStockItemsQuery,
} from '../../../data/kitchen-ops-hooks.ts';
import { CataloguePageHeader } from '../catalogue/catalogue-page-header.tsx';
import { CatalogueStatCards } from '../catalogue/catalogue-stat-cards.tsx';
import type { CatalogueStatCard } from '../catalogue/catalogue-stat-cards.tsx';
import { INVENTORY_VIEW_COSTS_PERMISSION } from '../entity-registry.ts';
import { useKitchenTrailLeaf } from '../kitchen-ops-shell.tsx';
import { receiptCostStatusKey, receiptCostStatusTone } from '../ops-format.ts';
import { readAmount } from '../receive-delivery-model.ts';
import { useUnsavedGuard } from '../use-unsaved-guard.ts';

/**
 * `/kitchen/procurement/unpriced-receipts/{receipt}` — one receipt's missing prices (SUP5, §7).
 *
 * ```
 * Kitchen workspace › Prices to finish › Receipt DN-0412      ← the queue crumb is the way back
 * Receipt DN-0412 [UNPRICED]                                        [Cancel] [Save prices]
 * ┌ TO PRICE ┐ ┌ TYPED ┐ ┌ WAITING ON A RATE ┐ ┌ RECEIVED ┐
 * ┌ LINES ─────────────────────────────────┐   ┌ RECEIPT ── supplier · delivery note · … ┐
 * │ Item · Received · Unit price · Total · │   └─────────────────────────────────────────┘
 * └────────────────────────────────────────┘   beside from xl, under below it
 * ```
 *
 * It used to be a dialog over the queue. A receipt is a record — a delivery note, an invoice and a
 * dozen lines — and pricing one is reading the invoice down the lines, which wants the whole page
 * and an address a person can come back to rather than a window that loses everything on a stray
 * click. So it is the record page's shape (`production-batch-screen.tsx`): figures above, the lines
 * in the wide column, the paperwork in a rail.
 *
 * ## The quantities are shown and cannot be touched
 *
 * §7: "Completing a receipt shows its immutable received quantities and accepts only the missing
 * financial fields." Quantity is text; only the price is a control. §3.6 is explicit that posted
 * quantities are never edited in place — a correction is a reasoned, audited adjustment, which is a
 * different object this page deliberately does not offer.
 *
 * Only lines with nothing costed yet take a price. A line already priced is shown settled, and a
 * line waiting on an exchange rate says so — a person can see it but not finish it here.
 *
 * ## Save sends what is typed, and a partial save is a real save
 *
 * A receipt may be finished a few lines at a time: the invoice for the dairy came, the one for the
 * dry goods did not. So Save needs one readable price, not all of them, and waits only while a typed
 * figure does not read as a price — a blank is "not yet", a typo is an error.
 */

/** The dialog this page replaces priced in USD; the contract has no per-receipt default to read. */
const RECEIPT_CURRENCY = 'USD';

const QUEUE_ROUTE = '/kitchen/procurement/unpriced-receipts';

export interface UnpricedReceiptScreenProps {
    /** The route parameter. Anything that is not an identifier lands on the not-found state. */
    readonly receipt?: string | undefined;
}

export function UnpricedReceiptScreen({ receipt }: UnpricedReceiptScreenProps) {
    return (
        <Gate
            area="kitchen"
            requirement={{ allOf: [INVENTORY_VIEW_COSTS_PERMISSION] }}
            testID="kitchen-unpriced-receipt"
        >
            <UnpricedReceipt receipt={receipt} />
        </Gate>
    );
}

function UnpricedReceipt({ receipt }: UnpricedReceiptScreenProps) {
    const { t } = useTranslation();
    const formatter = useFormatter();
    const router = useRouter();
    const toast = useToast();

    const parsed = receipt === undefined ? null : GoodsReceiptId.safeParse(receipt);
    const record = useGoodsReceiptQuery(parsed);
    const stockItems = useStockItemsQuery();
    const complete = useCompleteReceiptPricesMutation();
    const guard = useUnsavedGuard({ message: t('kitchen:unsaved.browserPrompt') });

    const [prices, setPrices] = useState<Readonly<Record<string, string>>>({});

    const detail = record.data;
    const failure = toFailure(record.error);

    const title =
        detail === undefined
            ? null
            : detail.documentRef === null
              ? t('kitchen:ops.unpricedReceipts.receiptFallbackTitle')
              : t('kitchen:ops.unpricedReceipts.receiptTitle', {
                    reference: detail.documentRef,
                });
    const backToQueue = () => {
        router.push(QUEUE_ROUTE as never);
    };
    // The trail names the receipt, and its queue crumb is the way back.
    useKitchenTrailLeaf(title, () => {
        guard.intercept(backToQueue);
    });

    const itemsById = useMemo(
        () => new Map((stockItems.data ?? []).map((item) => [String(item.id), item])),
        [stockItems.data],
    );

    const lines = useMemo(() => detail?.lines ?? [], [detail]);
    /** Lines a person may price here — pending-FX rows are the accounting phase's. */
    const priceable = useMemo(
        () => lines.filter((line) => line.costedAt === null && !line.valuationPendingFx),
        [lines],
    );

    if (parsed === null || (detail === undefined && !record.isPending && failure === null)) {
        return (
            <EmptyState
                testID="kitchen-unpriced-receipt-not-found"
                title={t('kitchen:ops.unpricedReceipts.notFoundTitle')}
                body={t('kitchen:ops.unpricedReceipts.notFoundBody')}
                actions={
                    <Button
                        testID="kitchen-unpriced-receipt-not-found-back"
                        variant="secondary"
                        size="sm"
                        label={t('kitchen:ops.unpricedReceipts.backToQueue')}
                        onPress={backToQueue}
                    />
                }
            />
        );
    }

    if (record.isPending) {
        return <RecordSkeleton testID="kitchen-unpriced-receipt-loading" />;
    }

    if (failure !== null) {
        return (
            <ErrorState
                testID="kitchen-unpriced-receipt-error"
                title={t('kitchen:ops.unpricedReceipts.loadErrorTitle')}
                failure={failure}
                onRetry={() => {
                    void record.refetch();
                }}
                retrying={record.isFetching}
            />
        );
    }

    if (detail === undefined) return null;

    const typed = priceable.filter((line) => readAmount(prices[line.id] ?? '') !== null);
    const everyPriceReadable = priceable.every((line) => {
        const raw = prices[line.id] ?? '';
        return raw.trim() === '' || readAmount(raw) !== null;
    });
    const saveFailure = toFailure(complete.error);

    const setPrice = (lineId: string, next: string) => {
        setPrices((current) => ({ ...current, [lineId]: next }));
        guard.markDirty();
    };

    const save = () => {
        if (typed.length === 0 || !everyPriceReadable) return;

        complete.mutate(
            {
                goodsReceiptId: detail.id,
                request: {
                    lines: typed.map((line) => ({
                        goodsReceiptLineId: line.id,
                        unitPriceAmount: readAmount(prices[line.id] ?? '') ?? 0,
                        costCurrencyCode: RECEIPT_CURRENCY,
                    })),
                },
            },
            {
                onSuccess: () => {
                    guard.markClean();
                    toast.show({
                        testID: 'kitchen-unpriced-completed-toast',
                        tone: 'success',
                        message: t('kitchen:ops.unpricedReceipts.completedToast'),
                    });
                    // Back to the queue: this receipt has either left it or moved down it, and the
                    // next one is the job.
                    router.replace(QUEUE_ROUTE as never);
                },
            },
        );
    };

    const columns = lineColumns({
        t,
        formatter,
        itemsById,
        prices,
        onPrice: setPrice,
    });

    return (
        <Stack space="md" testID="kitchen-unpriced-receipt-screen">
            <CataloguePageHeader
                testID="kitchen-unpriced-receipt-header"
                title={title ?? undefined}
                titleAside={
                    <Badge
                        testID="kitchen-unpriced-receipt-status"
                        tone={receiptCostStatusTone(detail.costStatus)}
                        label={t(receiptCostStatusKey(detail.costStatus))}
                    />
                }
                primaryAction={
                    <View className="flex-row flex-wrap items-center gap-tight">
                        <Button
                            testID="kitchen-unpriced-receipt-cancel"
                            variant="secondary"
                            label={t('kitchen:editor.cancel')}
                            onPress={() => {
                                guard.intercept(backToQueue);
                            }}
                        />
                        {priceable.length === 0 ? null : (
                            <Button
                                testID="kitchen-unpriced-receipt-save"
                                label={t('kitchen:ops.unpricedReceipts.savePrices', {
                                    count: typed.length,
                                })}
                                loading={complete.isPending}
                                disabled={typed.length === 0 || !everyPriceReadable}
                                onPress={save}
                            />
                        )}
                    </View>
                }
            />

            {saveFailure === null ? null : (
                <Callout
                    testID="kitchen-unpriced-receipt-save-error"
                    tone="danger"
                    role="alert"
                    title={t('kitchen:ops.unpricedReceipts.completeFailed')}
                    body={saveFailure.message}
                />
            )}

            <CatalogueStatCards
                testID="kitchen-unpriced-receipt-facts"
                cards={receiptFacts(detail, priceable.length, typed.length, formatter, t)}
            />

            {/*
             * The lines beside the paperwork. Below `xl` the rail drops under the lines: with the
             * admin rail open, `lg` leaves it narrower than a field.
             */}
            <View
                testID="kitchen-unpriced-receipt-body"
                className="flex-col gap-base xl:flex-row xl:items-start"
            >
                <View className="min-w-0 flex-col gap-base xl:flex-[21]">
                    <Card
                        testID="kitchen-unpriced-receipt-lines"
                        tone="raised"
                        padding="md"
                        title={t('kitchen:ops.unpricedReceipts.linesHeading')}
                    >
                        <Stack space="sm">
                            <Text variant="caption" tone="secondary">
                                {priceable.length === 0
                                    ? t('kitchen:ops.unpricedReceipts.nothingToPrice')
                                    : t('kitchen:ops.unpricedReceipts.quantitiesImmutable')}
                            </Text>
                            <DataList<GoodsReceiptLine>
                                testID="kitchen-unpriced-receipt-lines-table"
                                label={t('kitchen:ops.unpricedReceipts.linesHeading')}
                                columns={columns}
                                rows={lines}
                                rowKey={(line) => line.id}
                                density="sm"
                            />
                            {/*
                             * Said once, under the lines, rather than on each: the reason is the
                             * same for every line waiting on a rate, and it is not a job for here.
                             */}
                            {detail.valuationPendingCount === 0 ? null : (
                                <Callout
                                    testID="kitchen-unpriced-receipt-pending-fx"
                                    tone="warning"
                                    title={t('kitchen:ops.unpricedReceipts.pendingFxTitle')}
                                    body={t('kitchen:ops.unpricedReceipts.pendingFxBody')}
                                />
                            )}
                        </Stack>
                    </Card>
                </View>

                <View className="min-w-0 flex-col gap-base xl:flex-[10]">
                    <Card
                        testID="kitchen-unpriced-receipt-record"
                        tone="raised"
                        padding="md"
                        title={t('kitchen:ops.unpricedReceipts.recordHeading')}
                    >
                        <RecordWindowFieldGrid
                            testID="kitchen-unpriced-receipt-field"
                            fields={receiptFields(detail, formatter, t)}
                        />
                    </Card>
                </View>
            </View>

            <Dialog
                testID="kitchen-unpriced-receipt-unsaved-dialog"
                open={guard.isPrompting}
                onClose={guard.cancelDiscard}
                title={t('kitchen:unsaved.title')}
                description={t('kitchen:unsaved.body')}
                actions={
                    <>
                        <Button
                            testID="kitchen-unpriced-receipt-unsaved-keep"
                            variant="quiet"
                            label={t('kitchen:unsaved.keepEditing')}
                            onPress={guard.cancelDiscard}
                        />
                        <Button
                            testID="kitchen-unpriced-receipt-unsaved-discard"
                            variant="danger"
                            label={t('kitchen:unsaved.discard')}
                            onPress={guard.confirmDiscard}
                        />
                    </>
                }
            />
        </Stack>
    );
}

/** A line's state, as the State column states it. */
function lineState(line: GoodsReceiptLine): 'priced' | 'pendingFx' | 'toPrice' {
    if (line.valuationPendingFx) return 'pendingFx';
    return line.costedAt === null ? 'toPrice' : 'priced';
}

function lineColumns({
    t,
    formatter,
    itemsById,
    prices,
    onPrice,
}: {
    readonly t: TFunction;
    readonly formatter: Formatter;
    readonly itemsById: ReadonlyMap<string, StockItem>;
    readonly prices: Readonly<Record<string, string>>;
    readonly onPrice: (lineId: string, next: string) => void;
}): readonly DataListColumn<GoodsReceiptLine>[] {
    const noValue = t('kitchen:list.noValue');
    const money = (amount: number) => formatter.formatCurrency(amount, RECEIPT_CURRENCY);

    return [
        {
            key: 'item',
            label: t('kitchen:ops.unpricedReceipts.columnItem'),
            width: 220,
            priority: 100,
            render: (line) => {
                const item = itemsById.get(String(line.stockItemId));
                return (
                    <View className="min-w-0 flex-col py-1">
                        <Text
                            variant="strong"
                            numberOfLines={1}
                            testID={`kitchen-unpriced-line-${line.id}-name`}
                        >
                            {item?.nameEn ?? String(line.stockItemId)}
                        </Text>
                        {item === undefined ? null : (
                            <Text variant="mono" tone="secondary" numberOfLines={1}>
                                {item.code}
                            </Text>
                        )}
                    </View>
                );
            },
        },
        {
            key: 'received',
            label: t('kitchen:ops.unpricedReceipts.columnReceived'),
            width: 110,
            priority: 90,
            align: 'center',
            grow: false,
            render: (line) => (
                <Text variant="mono" testID={`kitchen-unpriced-line-${line.id}-quantity`}>
                    {`${formatter.formatNumber(Number(line.quantity))} ${
                        itemsById.get(String(line.stockItemId))?.unitCode ?? ''
                    }`.trim()}
                </Text>
            ),
        },
        {
            key: 'unitPrice',
            label: t('kitchen:ops.unpricedReceipts.fieldUnitPrice', {
                currency: RECEIPT_CURRENCY,
            }),
            width: 150,
            priority: 95,
            align: 'center',
            grow: false,
            render: (line) => {
                const state = lineState(line);
                if (state !== 'toPrice') {
                    return (
                        <Text variant="mono" testID={`kitchen-unpriced-line-${line.id}-unit-price`}>
                            {line.unitPriceAmount === null
                                ? noValue
                                : money(Number(line.unitPriceAmount))}
                        </Text>
                    );
                }
                const raw = prices[line.id] ?? '';
                const invalid = raw.trim() !== '' && readAmount(raw) === null;
                return (
                    <QuantityInput
                        testID={`kitchen-unpriced-line-${line.id}-price`}
                        id={`kitchen-unpriced-line-${line.id}-price`}
                        label={t('kitchen:ops.unpricedReceipts.linePriceLabel', {
                            item:
                                itemsById.get(String(line.stockItemId))?.nameEn ??
                                String(line.stockItemId),
                        })}
                        labelHidden
                        size="sm"
                        value={raw}
                        error={invalid ? t('kitchen:ops.unpricedReceipts.priceInvalid') : undefined}
                        onChangeText={(next) => {
                            onPrice(line.id, next);
                        }}
                    />
                );
            },
        },
        {
            key: 'lineTotal',
            label: t('kitchen:ops.unpricedReceipts.columnLineTotal'),
            width: 120,
            priority: 80,
            align: 'center',
            grow: false,
            render: (line) => {
                // Typed lines show the consequence of the figure before it is saved; settled ones
                // show what is on record. An unpriced line has no total — not a zero.
                const typedPrice =
                    lineState(line) === 'toPrice' ? readAmount(prices[line.id] ?? '') : null;
                const total =
                    typedPrice !== null
                        ? money(Number(line.quantity) * typedPrice)
                        : line.lineTotalAmount === null
                          ? noValue
                          : money(Number(line.lineTotalAmount));
                return (
                    <Text
                        variant="mono"
                        tone="secondary"
                        testID={`kitchen-unpriced-line-${line.id}-total`}
                    >
                        {total}
                    </Text>
                );
            },
        },
        {
            key: 'state',
            label: t('kitchen:ops.unpricedReceipts.columnState'),
            width: 150,
            priority: 85,
            render: (line) => {
                const state = lineState(line);
                return (
                    <Badge
                        testID={`kitchen-unpriced-line-${line.id}-state`}
                        tone={state === 'priced' ? 'success' : 'warning'}
                        label={t(
                            state === 'priced'
                                ? 'kitchen:ops.unpricedReceipts.linePriced'
                                : state === 'pendingFx'
                                  ? 'kitchen:ops.unpricedReceipts.linePendingFx'
                                  : 'kitchen:ops.unpricedReceipts.lineToPrice',
                        )}
                    />
                );
            },
        },
    ];
}

/** The receipt in four figures: what is left to price, what is typed, what waits, and when. */
function receiptFacts(
    receipt: GoodsReceiptDetail,
    toPrice: number,
    typed: number,
    formatter: Formatter,
    t: TFunction,
): readonly CatalogueStatCard[] {
    return [
        {
            key: 'toPrice',
            label: t('kitchen:ops.unpricedReceipts.columnToPrice'),
            value: String(toPrice),
            unit: t('kitchen:ops.ledger.statLinesUnit'),
            caption: t('kitchen:ops.unpricedReceipts.statToPriceCaption'),
            mark: 'coins',
            tone: toPrice === 0 ? 'default' : 'warning',
        },
        {
            key: 'typed',
            label: t('kitchen:ops.unpricedReceipts.statTypedLabel'),
            value: String(typed),
            unit: t('kitchen:ops.ledger.statLinesUnit'),
            caption: t('kitchen:ops.unpricedReceipts.statTypedCaption'),
            mark: 'receipt',
            tone: 'brand',
        },
        {
            key: 'pendingFx',
            label: t('kitchen:ops.ledger.statePendingFx'),
            value: String(receipt.valuationPendingCount),
            unit: t('kitchen:ops.ledger.statLinesUnit'),
            caption: t('kitchen:ops.unpricedReceipts.statPendingFxCaption'),
            mark: 'clock',
        },
        {
            key: 'receivedOn',
            label: t('kitchen:ops.unpricedReceipts.columnReceivedOn'),
            value:
                receipt.receivedOn === null
                    ? t('kitchen:list.noValue')
                    : formatter.formatDate(receipt.receivedOn, { dateStyle: 'medium' }),
            caption: t('kitchen:ops.unpricedReceipts.statReceivedCaption'),
            mark: 'calendar',
        },
    ];
}

/** The paperwork, as the rail states it. */
function receiptFields(
    receipt: GoodsReceiptDetail,
    formatter: Formatter,
    t: TFunction,
): readonly RecordWindowField[] {
    const noValue = t('kitchen:list.noValue');
    return [
        {
            key: 'supplier',
            label: t('kitchen:ops.unpricedReceipts.columnSupplier'),
            value: receipt.supplier?.nameEn ?? t('kitchen:ops.procurement.noSupplier'),
        },
        {
            key: 'delivery-note',
            label: t('kitchen:ops.unpricedReceipts.fieldDeliveryNote'),
            value: receipt.documentRef ?? noValue,
            mono: receipt.documentRef !== null,
        },
        {
            key: 'invoice',
            label: t('kitchen:ops.unpricedReceipts.fieldInvoice'),
            value: receipt.supplierInvoiceRef ?? t('kitchen:ops.unpricedReceipts.noInvoiceRef'),
            mono: receipt.supplierInvoiceRef !== null,
        },
        {
            key: 'invoice-date',
            label: t('kitchen:ops.unpricedReceipts.fieldInvoiceDate'),
            value:
                receipt.invoiceDate === null
                    ? noValue
                    : formatter.formatDate(receipt.invoiceDate, { dateStyle: 'medium' }),
        },
        {
            key: 'order',
            label: t('kitchen:ops.unpricedReceipts.fieldOrder'),
            value: receipt.purchaseOrder?.number ?? t('kitchen:ops.unpricedReceipts.noOrder'),
            mono: receipt.purchaseOrder !== null,
        },
        ...(receipt.varianceNote === null
            ? []
            : [
                  {
                      key: 'variance',
                      label: t('kitchen:ops.unpricedReceipts.fieldVarianceNote'),
                      value: receipt.varianceNote,
                  },
              ]),
    ];
}
