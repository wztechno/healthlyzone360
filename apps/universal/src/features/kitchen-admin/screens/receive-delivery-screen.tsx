import type { ReceivableOrder } from '@healthy360/api-client/contracts';
import {
    Badge,
    Button,
    Callout,
    Checkbox,
    DateField,
    Dialog,
    EmptyState,
    ErrorState,
    FormSection,
    Inline,
    Select,
    Skeleton,
    Stack,
    Text,
    TextInputField,
    useToast,
} from '@healthy360/design-system';
import { PurchaseOrderId } from '@healthy360/domain-types';
import { useFormatter } from '@healthy360/i18n';
import { useRouter } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { Gate } from '../../../access/gate.tsx';
import { toFailure } from '../../../data/hooks.ts';
import { useReturnTo } from '../../../navigation/use-return-to.ts';
import {
    usePostGoodsReceiptMutation,
    useReceivableOrdersQuery,
    useStockItemsQuery,
} from '../../../data/kitchen-ops-hooks.ts';
import { useAccessState } from '../../../session/session-provider.tsx';
import { INVENTORY_MANAGE_PERMISSION } from '../entity-registry.ts';
import { EditorFrame } from '../editor-frame.tsx';
import { focusField } from '../field-focus.ts';
import {
    applyScan,
    exceedsOutstanding,
    initialLines,
    lotCheckPending,
    lotIsReadable,
    readAmount,
    readQuantity,
    readiness,
    toReceiptPayload,
    todayIsoDate,
} from '../receive-delivery-model.ts';
import type {
    ReceiveConfirmations,
    ReceiveHeaderDraft,
    ReceiveLineDraft,
    ScannedPack,
} from '../receive-delivery-model.ts';
import { ReceiveLineTrace } from '../receive-line-trace.tsx';
import { ReceiveScanBar } from '../receive-scan-bar.tsx';
import { focusFirstRefusal } from '../record-form-opening.tsx';
import { serverFieldErrors } from '../server-field-errors.ts';
import type { ServerFieldTarget } from '../server-field-errors.ts';
import { readQuantity as readOrderQuantity } from '../supply-order-model.ts';
import { useOptimisticConcurrency } from '../use-optimistic-concurrency.ts';
import { useUnsavedGuard } from '../use-unsaved-guard.ts';

/**
 * `/kitchen/procurement/receive` — booking in a delivery against an issued order (SUP5, §7).
 *
 * Drawn in the editor frame since the Operations handoff: title, the "Posts into stock" chip, Back
 * and the one primary (Post receipt, which opens the confirmation) on the header row, and the form
 * as section rules — the delivery, its lines, the invoice charges. A delivery has no record meta
 * until it is posted, so the order's own facts fill the header's summary slot instead.
 *
 * ## The prices are visible to everyone who may post
 *
 * §5's blind-write model, finally usable. The API has always accepted prices under
 * `inventory.manage_organisation` and redacted them from the same person's *reads*, but the receipt
 * dialog hid the price inputs without `inventory.view_costs_organisation` — so the model existed and
 * nobody could use it. §5 is explicit: "a receiver may enter prices printed on the supplier document
 * even if historical costs remain redacted after submission". This screen shows the price column to
 * every manage holder, because the person standing at the loading bay is the person holding the
 * delivery note, and asking them to leave the figures for somebody who never saw the paper is how a
 * kitchen ends up with a week of unpriced receipts.
 *
 * The currency is fixed and is announced on the price label rather than offered as a control, the
 * same idiom the procurement dialog uses and for the same reason: a receipt currency the receiver
 * could change is a currency they can get wrong, and the server refuses a second one anyway.
 *
 * ## Outstanding, not ordered
 *
 * §4: "ordered lines are prefilled with their outstanding quantity, not their original quantity". A
 * second delivery against a half-received order opens with what is left, and the unit is fixed from
 * the order line so a delivery cannot be silently counted in something else. Zero means the item was
 * not on the van; those rows are simply left out of the post.
 *
 * ## The two things a person has to say out loud
 *
 * An **over-receipt** raises an inline warning, a confirmation box and a variance note, because §3.5
 * asks for a confirmation *and* a note — one records that somebody clicked, the other records what
 * they knew. A **short delivery** offers to close the rest of the order, which needs its own reason.
 * Neither is inferred: the server refuses both without the explicit answer, and a screen that
 * guessed would be putting words in somebody's mouth about a write-off.
 *
 * ## The confirmation separates stock from money
 *
 * §7: "the confirmation distinguishes stock quantity from financial values and states that posting
 * raises stock immediately." So the dialog says the shelves move now, names how many lines are being
 * delivered and how many are being left, and says separately whether the money on this receipt is
 * complete — because those are two different promises and only the first is irreversible.
 */
export interface ReceiveDeliveryScreenProps {
    /** The order to receive against, from `?order=`. Absent means "pick one". */
    readonly order?: string | undefined;
}

export function ReceiveDeliveryScreen({ order }: ReceiveDeliveryScreenProps) {
    return (
        <Gate
            area="kitchen"
            requirement={{ allOf: [INVENTORY_MANAGE_PERMISSION] }}
            testID="kitchen-receive-delivery"
        >
            <ReceiveDelivery order={order} />
        </Gate>
    );
}

/** The one currency a delivery's prices are booked in — see the procurement screen for why. */
const RECEIPT_CURRENCY = 'USD';

/** The ids Post and a server refusal take the reader to. */
const DOCUMENT_REF_ID = 'kitchen-receive-document-ref';
const INVOICE_REF_ID = 'kitchen-receive-invoice-ref';
const OVER_CONFIRM_ID = 'kitchen-receive-over-confirm';
const VARIANCE_NOTE_ID = 'kitchen-receive-variance-note';
const CLOSE_SHORT_REASON_ID = 'kitchen-receive-close-short-reason';

function lineFieldId(index: number, field: 'quantity' | 'price' | 'trace'): string {
    return `kitchen-receive-line-${String(index)}-${field}`;
}

function ReceiveDelivery({ order }: ReceiveDeliveryScreenProps) {
    const { t } = useTranslation();
    const formatter = useFormatter();
    const router = useRouter();
    // Back steps to wherever the delivery was opened from — the order, or procurement.
    const back = useReturnTo(undefined, '/kitchen/procurement');
    const toast = useToast();
    const access = useAccessState();
    const branchId = access.branch?.id ?? null;

    const orders = useReceivableOrdersQuery(branchId);
    const guard = useUnsavedGuard({ message: t('kitchen:unsaved.browserPrompt') });
    // Nothing here is lock-versioned — a receipt is created, never updated — so a conflict cannot
    // arise; the frame still takes the handle, and a reload is a refetch of the open orders.
    const concurrency = useOptimisticConcurrency({
        onReload: () => {
            void orders.refetch();
        },
    });
    const postReceipt = usePostGoodsReceiptMutation();
    const stockItems = useStockItemsQuery();
    /** What the last scan's placement has to say — a lot kept apart, a pack left to type. */
    const [scanNotice, setScanNotice] = useState<string | null>(null);

    const [selectedOrderId, setSelectedOrderId] = useState<string | null>(order ?? null);
    const [lines, setLines] = useState<readonly ReceiveLineDraft[]>([]);
    /** The rows a scan builds on — ahead of the render when two scans answer in one tick. */
    const latestLines = useRef(lines);
    useEffect(() => {
        latestLines.current = lines;
    }, [lines]);
    const [chargesOpen, setChargesOpen] = useState(false);
    const [confirming, setConfirming] = useState(false);
    // Blanks that have to be filled are marked once Post has been pressed, and live from then on.
    const [attempted, setAttempted] = useState(false);
    // The rows the last post sent, by their place on screen: the server names a line by its
    // place in what was posted, and rows at nothing are left out of that.
    const [postedIndexes, setPostedIndexes] = useState<readonly number[]>([]);

    const [header, setHeader] = useState<ReceiveHeaderDraft>(() => ({
        receivedOn: todayIsoDate(),
        documentRef: '',
        supplierInvoiceRef: '',
        invoiceDate: '',
        discountAmount: '',
        taxAmount: '',
        deliveryAmount: '',
        otherChargesAmount: '',
        invoiceTotalAmount: '',
    }));

    const [confirmations, setConfirmations] = useState<ReceiveConfirmations>({
        overReceiptConfirmed: false,
        varianceNote: '',
        closeShort: false,
        closeShortReason: '',
    });

    // Memoised rather than re-derived each render: two `useMemo`s below depend on it, and a fresh
    // empty array every render would rebuild the picker options and the selected order on every
    // keystroke in the form.
    const orderRows = useMemo(() => orders.data ?? [], [orders.data]);

    const selectedOrder = useMemo<ReceivableOrder | null>(
        () => orderRows.find((row) => String(row.id) === selectedOrderId) ?? null,
        [orderRows, selectedOrderId],
    );

    /*
     * Rows follow the chosen order, and choosing a different one starts a clean delivery: carrying
     * quantities across two orders would attach one supplier's pallet to another's paperwork.
     *
     * Adjusted **during render** rather than in an effect, which is React's own answer for state
     * that derives from a prop: an effect would paint the previous order's rows once before
     * replacing them, and on this screen that single frame is somebody's outstanding quantities
     * showing under another supplier's name.
     */
    const [loadedOrderId, setLoadedOrderId] = useState<string | null>(null);
    const currentOrderId = selectedOrder === null ? null : String(selectedOrder.id);

    if (loadedOrderId !== currentOrderId) {
        setLoadedOrderId(currentOrderId);
        setLines(selectedOrder === null ? [] : initialLines(selectedOrder));
        setConfirmations({
            overReceiptConfirmed: false,
            varianceNote: '',
            closeShort: false,
            closeShortReason: '',
        });
    }

    const state = readiness(lines, confirmations, selectedOrder !== null);

    const orderOptions = useMemo(
        () =>
            orderRows.map((row) => ({
                value: String(row.id),
                label: `${row.number} — ${row.supplier?.nameEn ?? t('kitchen:ops.procurement.noSupplier')}`,
            })),
        [orderRows, t],
    );

    function patchLine(index: number, patch: Partial<ReceiveLineDraft>) {
        setLines((current) =>
            current.map((line, position) => (position === index ? { ...line, ...patch } : line)),
        );
    }

    /** A scan lands on a row by the shared rules (`applyScan`); an item nobody ordered is unplanned. */
    function placeScan(pack: ScannedPack) {
        const current = latestLines.current;
        const placed = applyScan(current, pack, {
            orderMode: true,
            unitOf: (line) => line.unitCode,
            create: (template) => {
                const key = `scan-${String(current.length)}-${String(Date.now())}`;
                if (template !== null) return { ...template, key };
                const item = (stockItems.data ?? []).find(
                    (candidate) => String(candidate.id) === pack.stockItemId,
                );
                return {
                    key,
                    purchaseOrderLineId: null,
                    stockItemId: pack.stockItemId,
                    itemLabel:
                        item === undefined ? pack.stockItemId : `${item.code} — ${item.nameEn}`,
                    unitCode: item?.unitCode ?? '',
                    unitId: null,
                    orderedQuantity: '0',
                    outstandingQuantity: '0',
                    quantity: '',
                    unitPrice: '',
                };
            },
        });
        latestLines.current = placed.drafts;
        setLines(placed.drafts);
        setScanNotice(
            placed.keptApart
                ? t('kitchen:barcodes.keptApart')
                : placed.needsQuantity
                  ? t('kitchen:barcodes.typeQuantity')
                  : null,
        );
        if (placed.needsQuantity) {
            const index = placed.drafts.findIndex((line) => line.key === placed.key);
            focusField(`kitchen-receive-line-${String(index)}-quantity`);
        }
    }

    /*
     * What stops the post, field by field, in the order the form reads. A value typed wrong is
     * marked as it is typed; a blank that has to be filled waits for Post. Every gate `readiness`
     * holds the post on is one entry here, so Post never refuses without taking you somewhere.
     */
    const quantityErrors = new Map<number, string>();
    const priceErrors = new Map<number, string>();
    const problems: { readonly key: string; readonly fieldId?: string | undefined }[] = [];
    lines.forEach((line, index) => {
        if (line.quantity.trim() !== '' && readQuantity(line.quantity) === null) {
            const issue = readOrderQuantity(line.quantity).issue;
            quantityErrors.set(
                index,
                t(
                    `kitchen:ops.supplyOrders.quantityIssue.${
                        issue === null || issue === 'blank' || issue === 'zero'
                            ? 'notANumber'
                            : issue
                    }`,
                ),
            );
            problems.push({
                key: `quantity-${String(index)}`,
                fieldId: lineFieldId(index, 'quantity'),
            });
        }
        if (line.unitPrice.trim() !== '' && readAmount(line.unitPrice) === null) {
            priceErrors.set(index, t('kitchen:ops.procurement.lineUnitPriceInvalid'));
            problems.push({ key: `price-${String(index)}`, fieldId: lineFieldId(index, 'price') });
        }
        // Lots matter only on a row that posts. The lot field says what is wrong with it; it has
        // no id of its own to be taken to.
        if ((readQuantity(line.quantity) ?? 0) <= 0) return;
        if (!lotIsReadable(line.supplierLot)) problems.push({ key: `lot-${String(index)}` });
        if (lotCheckPending(line)) {
            problems.push({
                key: `lot-check-${String(index)}`,
                fieldId: `${lineFieldId(index, 'trace')}-lot-checked`,
            });
        }
    });
    const nothingDelivered = lines.length > 0 && state.deliveredLineCount === 0;
    if (nothingDelivered && quantityErrors.size === 0) {
        problems.push({ key: 'nothing', fieldId: lineFieldId(0, 'quantity') });
        if (attempted) quantityErrors.set(0, t('kitchen:forms.lineQuantityMissing'));
    }
    const overUnconfirmed = state.hasOverReceipt && !confirmations.overReceiptConfirmed;
    if (overUnconfirmed) problems.push({ key: 'over', fieldId: OVER_CONFIRM_ID });
    if (state.needsVarianceNote) problems.push({ key: 'note', fieldId: VARIANCE_NOTE_ID });
    if (state.needsCloseShortReason) {
        problems.push({ key: 'close-short', fieldId: CLOSE_SHORT_REASON_ID });
    }

    /*
     * What the server refused, put on the fields it named (BUG-06): a line by its place in what
     * was posted, the paperwork and the confirmations by name — in the order the form draws them.
     */
    const serverTargets = (indexes: readonly number[]): Record<string, ServerFieldTarget> => {
        const targets: Record<string, ServerFieldTarget> = {
            document_ref: {
                label: t('kitchen:ops.receiving.fieldDocumentRef'),
                fieldId: DOCUMENT_REF_ID,
            },
            supplier_invoice_ref: {
                label: t('kitchen:ops.receiving.fieldInvoiceRef'),
                fieldId: INVOICE_REF_ID,
            },
        };
        indexes.forEach((index, posted) => {
            const unit = lines[index]?.unitCode ?? '';
            targets[`lines.${String(posted)}.quantity`] = {
                label: t('kitchen:ops.receiving.fieldLineQuantity', { unit }),
                fieldId: lineFieldId(index, 'quantity'),
            };
            targets[`lines.${String(posted)}.unit_price_amount`] = {
                label: t('kitchen:ops.receiving.fieldLineUnitPrice', {
                    currency: RECEIPT_CURRENCY,
                }),
                fieldId: lineFieldId(index, 'price'),
            };
        });
        return {
            ...targets,
            over_receipt_confirmed: {
                label: t('kitchen:ops.receiving.overReceiptConfirm'),
                fieldId: OVER_CONFIRM_ID,
            },
            variance_note: {
                label: t('kitchen:ops.receiving.fieldVarianceNote'),
                fieldId: VARIANCE_NOTE_ID,
            },
            close_short_reason: {
                label: t('kitchen:ops.receiving.fieldCloseShortReason'),
                fieldId: CLOSE_SHORT_REASON_ID,
            },
        };
    };
    const postFailure = toFailure(postReceipt.error);
    const server = serverFieldErrors(postFailure, serverTargets(postedIndexes));
    const serverLineError = (
        index: number,
        field: 'quantity' | 'unit_price_amount',
    ): string | undefined => {
        const posted = postedIndexes.indexOf(index);
        return posted === -1 ? undefined : server.errorFor(`lines.${String(posted)}.${field}`);
    };

    function attemptPost() {
        setAttempted(true);
        if (problems.length > 0 || !state.canSubmit) {
            // Each field says what is wrong with it; Post takes the reader to the first.
            const first = problems.find((problem) => problem.fieldId !== undefined);
            if (first?.fieldId !== undefined) focusField(first.fieldId);
            return;
        }
        setConfirming(true);
    }

    function submit() {
        if (branchId === null || selectedOrder === null || !state.canSubmit) return;

        const posted = lines.flatMap((line, index) =>
            (readQuantity(line.quantity) ?? 0) > 0 ? [index] : [],
        );
        setPostedIndexes(posted);
        postReceipt.mutate(
            toReceiptPayload(lines, {
                branchId,
                supplierId:
                    selectedOrder.supplier === null ? null : String(selectedOrder.supplier.id),
                purchaseOrderId: String(selectedOrder.id),
                currencyCode: RECEIPT_CURRENCY,
                header,
                confirmations,
            }),
            {
                onSuccess: (result) => {
                    setConfirming(false);
                    toast.show({
                        testID: 'kitchen-receive-posted-toast',
                        tone: 'success',
                        message: t('kitchen:ops.receiving.postedToast'),
                    });
                    router.push(
                        `/kitchen/supply-orders/${String(PurchaseOrderId.unsafe(String(selectedOrder.id)))}` as never,
                    );
                    // The cost status is the second half of what just happened, and it is not
                    // irreversible — a receipt posted without prices is a job, not a mistake.
                    if (result.costStatus !== 'complete') {
                        toast.show({
                            testID: 'kitchen-receive-unpriced-toast',
                            tone: 'info',
                            message: t('kitchen:ops.receiving.unpricedToast'),
                        });
                    }
                },
                // A refusal that names a field closes the confirmation and takes the reader there.
                onError: (error) => {
                    if (focusFirstRefusal(error, serverTargets(posted))) setConfirming(false);
                },
            },
        );
    }

    const failure = toFailure(orders.error);

    return (
        <>
            <EditorFrame
                testID="kitchen-receive-screen"
                title={t('kitchen:ops.receiving.title')}
                titleChip={{ label: t('kitchen:ops.receiving.chipPostsStock'), tone: 'warning' }}
                meta={null}
                summary={
                    selectedOrder === null ? (
                        <Text variant="caption" tone="secondary">
                            {t('kitchen:ops.receiving.subtitle')}
                        </Text>
                    ) : (
                        <Inline
                            space="sm"
                            align="center"
                            wrap
                            testID="kitchen-receive-order-header"
                        >
                            <Text variant="mono">{selectedOrder.number}</Text>
                            <Text variant="caption" tone="secondary">
                                {selectedOrder.supplier?.nameEn ??
                                    t('kitchen:ops.procurement.noSupplier')}
                            </Text>
                            <Text variant="caption" tone="secondary">
                                {t('kitchen:ops.receiving.outstandingLineCount', {
                                    count: selectedOrder.outstandingLineCount,
                                })}
                            </Text>
                        </Inline>
                    )
                }
                guard={guard}
                concurrency={concurrency}
                onSaveDraft={attemptPost}
                saveLabel={t('kitchen:ops.receiving.post')}
                // A problem on the form does not disable Post: pressing it takes you there.
                saveDisabled={branchId === null || selectedOrder === null}
                hideSave={selectedOrder === null}
                onBack={back.leave}
                backLabel={t('kitchen:ops.receiving.backToProcurement')}
            >
                {orders.isPending ? (
                    <Stack space="sm" testID="kitchen-receive-loading">
                        {Array.from({ length: 3 }, (_, index) => (
                            <Skeleton key={index} heightClassName="h-10" />
                        ))}
                    </Stack>
                ) : failure !== null ? (
                    <ErrorState
                        testID="kitchen-receive-error"
                        failure={failure}
                        onRetry={() => {
                            void orders.refetch();
                        }}
                        retrying={orders.isFetching}
                    />
                ) : orderRows.length === 0 ? (
                    <EmptyState
                        testID="kitchen-receive-empty"
                        title={t('kitchen:ops.receiving.emptyTitle')}
                        body={t('kitchen:ops.receiving.emptyBody')}
                    />
                ) : (
                    <Stack space="none" testID="kitchen-receive-content">
                        {/*
                         * With `?order=` the supplier and branch are fixed from the order (§7) and
                         * the header states them rather than offering them; without it, this is the
                         * picker. Either way there is exactly one order on screen.
                         */}
                        {order === undefined ? (
                            <FormSection
                                first
                                testID="kitchen-receive-order-section"
                                title={t('kitchen:ops.receiving.sectionOrder')}
                            >
                                <Select
                                    testID="kitchen-receive-order-picker"
                                    label={t('kitchen:ops.receiving.fieldOrder')}
                                    options={orderOptions}
                                    value={selectedOrderId}
                                    onChange={setSelectedOrderId}
                                    searchable
                                />
                            </FormSection>
                        ) : selectedOrder === null ? (
                            <EmptyState
                                testID="kitchen-receive-order-missing"
                                title={t('kitchen:ops.receiving.orderMissingTitle')}
                                body={t('kitchen:ops.receiving.orderMissingBody')}
                            />
                        ) : null}

                        {selectedOrder === null ? null : (
                            <Stack space="none" testID="kitchen-receive-form">
                                <FormSection
                                    first={order !== undefined}
                                    testID="kitchen-receive-delivery-section"
                                    title={t('kitchen:ops.receiving.sectionDelivery')}
                                >
                                    <Inline space="sm" align="start" wrap>
                                        <DateField
                                            testID="kitchen-receive-received-on"
                                            label={t('kitchen:ops.receiving.fieldReceivedOn')}
                                            hint={t('kitchen:ops.receiving.fieldReceivedOnHint')}
                                            value={header.receivedOn}
                                            max={todayIsoDate()}
                                            onChange={(next) => {
                                                setHeader((current) => ({
                                                    ...current,
                                                    receivedOn: next ?? '',
                                                }));
                                            }}
                                        />
                                        <TextInputField
                                            testID="kitchen-receive-document-ref"
                                            id={DOCUMENT_REF_ID}
                                            {...server.flag('document_ref')}
                                            label={t('kitchen:ops.receiving.fieldDocumentRef')}
                                            placeholder={t(
                                                'kitchen:ops.receiving.documentRefPlaceholder',
                                            )}
                                            value={header.documentRef}
                                            onChangeText={(next) => {
                                                setHeader((current) => ({
                                                    ...current,
                                                    documentRef: next,
                                                }));
                                            }}
                                            className="min-w-[180px] flex-1"
                                        />
                                        <TextInputField
                                            testID="kitchen-receive-invoice-ref"
                                            id={INVOICE_REF_ID}
                                            {...server.flag('supplier_invoice_ref')}
                                            label={t('kitchen:ops.receiving.fieldInvoiceRef')}
                                            hint={t('kitchen:ops.receiving.fieldInvoiceRefHint')}
                                            placeholder={t(
                                                'kitchen:ops.receiving.invoiceRefPlaceholder',
                                            )}
                                            value={header.supplierInvoiceRef}
                                            onChangeText={(next) => {
                                                setHeader((current) => ({
                                                    ...current,
                                                    supplierInvoiceRef: next,
                                                }));
                                            }}
                                            className="min-w-[180px] flex-1"
                                        />
                                        <DateField
                                            testID="kitchen-receive-invoice-date"
                                            label={t('kitchen:ops.receiving.fieldInvoiceDate')}
                                            value={header.invoiceDate}
                                            onChange={(next) => {
                                                setHeader((current) => ({
                                                    ...current,
                                                    invoiceDate: next ?? '',
                                                }));
                                            }}
                                        />
                                    </Inline>
                                </FormSection>

                                <FormSection
                                    testID="kitchen-receive-lines-section"
                                    title={t('kitchen:ops.receiving.linesTitle')}
                                >
                                    <ReceiveScanBar
                                        testID="kitchen-receive-scan"
                                        stockItems={stockItems.data ?? []}
                                        onScanned={placeScan}
                                        notice={scanNotice}
                                    />
                                    <Stack space="sm" testID="kitchen-receive-lines">
                                        {lines.map((line, index) => (
                                            <Stack
                                                key={line.key}
                                                space="xs"
                                                testID={`kitchen-receive-line-${String(index)}`}
                                            >
                                                <Inline space="sm" align="center" wrap>
                                                    <Text
                                                        variant="bodyStrong"
                                                        className="min-w-[200px] flex-1"
                                                    >
                                                        {line.itemLabel}
                                                    </Text>
                                                    <Text variant="caption" tone="secondary">
                                                        {t(
                                                            'kitchen:ops.receiving.outstandingLabel',
                                                            {
                                                                quantity: line.outstandingQuantity,
                                                                unit: line.unitCode,
                                                            },
                                                        )}
                                                    </Text>
                                                </Inline>
                                                <Inline space="sm" align="start" wrap>
                                                    <TextInputField
                                                        testID={`kitchen-receive-line-${String(index)}-quantity`}
                                                        id={lineFieldId(index, 'quantity')}
                                                        error={
                                                            quantityErrors.get(index) ??
                                                            serverLineError(index, 'quantity')
                                                        }
                                                        label={t(
                                                            'kitchen:ops.receiving.fieldLineQuantity',
                                                            { unit: line.unitCode },
                                                        )}
                                                        placeholder={t(
                                                            'kitchen:fields.quantityPlaceholder',
                                                        )}
                                                        value={line.quantity}
                                                        keyboardType="decimal-pad"
                                                        onChangeText={(next) => {
                                                            // A typed quantity is a person's, and no
                                                            // scan edits it from here on.
                                                            patchLine(index, {
                                                                quantity: next,
                                                                quantitySource: 'typed',
                                                            });
                                                        }}
                                                        className="min-w-[140px]"
                                                    />
                                                    {/*
                                                     * Visible to every manage holder — §5's blind-write
                                                     * model, and the reversal of the old dialog's
                                                     * `canViewCosts` gate on the inputs. Reads stay
                                                     * redacted; writing what the paper says does not.
                                                     */}
                                                    <TextInputField
                                                        testID={`kitchen-receive-line-${String(index)}-price`}
                                                        id={lineFieldId(index, 'price')}
                                                        error={
                                                            priceErrors.get(index) ??
                                                            serverLineError(
                                                                index,
                                                                'unit_price_amount',
                                                            )
                                                        }
                                                        label={t(
                                                            'kitchen:ops.receiving.fieldLineUnitPrice',
                                                            { currency: RECEIPT_CURRENCY },
                                                        )}
                                                        hint={t(
                                                            'kitchen:ops.receiving.fieldLineUnitPriceHint',
                                                        )}
                                                        placeholder={t(
                                                            'kitchen:fields.unitPricePlaceholder',
                                                        )}
                                                        value={line.unitPrice}
                                                        keyboardType="decimal-pad"
                                                        onChangeText={(next) => {
                                                            patchLine(index, { unitPrice: next });
                                                        }}
                                                        className="min-w-[140px]"
                                                    />
                                                </Inline>
                                                <ReceiveLineTrace
                                                    testID={`kitchen-receive-line-${String(index)}-trace`}
                                                    trace={line}
                                                    onChange={(patch) => {
                                                        patchLine(index, patch);
                                                    }}
                                                />
                                                {exceedsOutstanding(line, lines) ? (
                                                    <Text
                                                        tone="danger"
                                                        variant="caption"
                                                        testID={`kitchen-receive-line-${String(index)}-over`}
                                                    >
                                                        {t(
                                                            'kitchen:ops.receiving.lineOverReceipt',
                                                            {
                                                                quantity: line.outstandingQuantity,
                                                                unit: line.unitCode,
                                                            },
                                                        )}
                                                    </Text>
                                                ) : null}
                                            </Stack>
                                        ))}
                                    </Stack>

                                    {state.needsLotCheck ? (
                                        <Callout
                                            tone="warning"
                                            testID="kitchen-receive-lot-check"
                                            title={t('kitchen:barcodes.lotCheckNeeded')}
                                        />
                                    ) : null}

                                    {state.hasOverReceipt ? (
                                        <Callout
                                            tone="warning"
                                            testID="kitchen-receive-over-receipt"
                                            title={t('kitchen:ops.receiving.overReceiptTitle')}
                                        >
                                            <Stack space="sm">
                                                <Checkbox
                                                    testID="kitchen-receive-over-confirm"
                                                    id={OVER_CONFIRM_ID}
                                                    {...(attempted && overUnconfirmed
                                                        ? {
                                                              error: t(
                                                                  'kitchen:ops.procurement.issueOverReceipt',
                                                              ),
                                                          }
                                                        : server.flag('over_receipt_confirmed'))}
                                                    checked={confirmations.overReceiptConfirmed}
                                                    label={t(
                                                        'kitchen:ops.receiving.overReceiptConfirm',
                                                    )}
                                                    onChange={(checked) => {
                                                        setConfirmations((current) => ({
                                                            ...current,
                                                            overReceiptConfirmed: checked,
                                                        }));
                                                    }}
                                                />
                                            </Stack>
                                        </Callout>
                                    ) : null}

                                    {state.hasOverReceipt || state.hasUnplannedLine ? (
                                        <TextInputField
                                            testID="kitchen-receive-variance-note"
                                            id={VARIANCE_NOTE_ID}
                                            {...(attempted && state.needsVarianceNote
                                                ? { error: t('kitchen:forms.required') }
                                                : server.flag('variance_note'))}
                                            label={t('kitchen:ops.receiving.fieldVarianceNote')}
                                            placeholder={t(
                                                'kitchen:ops.receiving.varianceNotePlaceholder',
                                            )}
                                            required
                                            value={confirmations.varianceNote}
                                            onChangeText={(next) => {
                                                setConfirmations((current) => ({
                                                    ...current,
                                                    varianceNote: next,
                                                }));
                                            }}
                                        />
                                    ) : null}

                                    {state.hasShortfall ? (
                                        <Stack space="sm" testID="kitchen-receive-close-short">
                                            <Checkbox
                                                testID="kitchen-receive-close-short-toggle"
                                                checked={confirmations.closeShort}
                                                label={t('kitchen:ops.receiving.closeShortLabel')}
                                                description={t(
                                                    'kitchen:ops.receiving.closeShortHint',
                                                )}
                                                onChange={(checked) => {
                                                    setConfirmations((current) => ({
                                                        ...current,
                                                        closeShort: checked,
                                                    }));
                                                }}
                                            />
                                            {confirmations.closeShort ? (
                                                <TextInputField
                                                    testID="kitchen-receive-close-short-reason"
                                                    id={CLOSE_SHORT_REASON_ID}
                                                    {...(attempted && state.needsCloseShortReason
                                                        ? { error: t('kitchen:forms.required') }
                                                        : server.flag('close_short_reason'))}
                                                    label={t(
                                                        'kitchen:ops.receiving.fieldCloseShortReason',
                                                    )}
                                                    placeholder={t(
                                                        'kitchen:ops.receiving.closeShortReasonPlaceholder',
                                                    )}
                                                    required
                                                    value={confirmations.closeShortReason}
                                                    onChangeText={(next) => {
                                                        setConfirmations((current) => ({
                                                            ...current,
                                                            closeShortReason: next,
                                                        }));
                                                    }}
                                                />
                                            ) : null}
                                        </Stack>
                                    ) : null}
                                </FormSection>

                                <FormSection
                                    testID="kitchen-receive-charges-section"
                                    title={t('kitchen:ops.receiving.sectionCharges')}
                                >
                                    <Stack space="sm" testID="kitchen-receive-charges">
                                        <Button
                                            testID="kitchen-receive-charges-toggle"
                                            size="sm"
                                            variant="ghost"
                                            label={
                                                chargesOpen
                                                    ? t('kitchen:ops.receiving.hideCharges')
                                                    : t('kitchen:ops.receiving.showCharges')
                                            }
                                            onPress={() => {
                                                setChargesOpen((open) => !open);
                                            }}
                                        />
                                        {chargesOpen ? (
                                            <Stack
                                                space="sm"
                                                testID="kitchen-receive-charges-fields"
                                            >
                                                <Inline space="sm" align="start" wrap>
                                                    {(
                                                        [
                                                            ['discountAmount', 'fieldDiscount'],
                                                            ['taxAmount', 'fieldTax'],
                                                            ['deliveryAmount', 'fieldDelivery'],
                                                            [
                                                                'otherChargesAmount',
                                                                'fieldOtherCharges',
                                                            ],
                                                            [
                                                                'invoiceTotalAmount',
                                                                'fieldInvoiceTotal',
                                                            ],
                                                        ] as const
                                                    ).map(([field, labelKey]) => (
                                                        <TextInputField
                                                            key={field}
                                                            testID={`kitchen-receive-${field}`}
                                                            label={t(
                                                                `kitchen:ops.receiving.${labelKey}`,
                                                                { currency: RECEIPT_CURRENCY },
                                                            )}
                                                            placeholder={t(
                                                                'kitchen:fields.amountPlaceholder',
                                                            )}
                                                            value={header[field]}
                                                            keyboardType="decimal-pad"
                                                            onChangeText={(next) => {
                                                                setHeader((current) => ({
                                                                    ...current,
                                                                    [field]: next,
                                                                }));
                                                            }}
                                                            className="min-w-[140px]"
                                                        />
                                                    ))}
                                                </Inline>
                                            </Stack>
                                        ) : null}
                                    </Stack>

                                    {/* Gone once every refused field carries its own message. */}
                                    {postFailure === null ||
                                    (server.unplaced === null && server.items.length > 0) ? null : (
                                        <Text testID="kitchen-receive-error-message" tone="danger">
                                            {server.unplaced ?? postFailure.message}
                                        </Text>
                                    )}
                                </FormSection>

                                <Inline space="sm" align="center" wrap>
                                    <Text
                                        variant="caption"
                                        tone="secondary"
                                        testID="kitchen-receive-summary"
                                    >
                                        {t('kitchen:ops.receiving.summary', {
                                            delivered: state.deliveredLineCount,
                                            skipped: state.skippedLineCount,
                                        })}
                                    </Text>
                                </Inline>
                            </Stack>
                        )}
                    </Stack>
                )}
            </EditorFrame>

            {/*
             * §7: the confirmation distinguishes stock quantity from financial values and states
             * that posting raises stock immediately. Two separate sentences, because only the first
             * is irreversible — an unpriced receipt is a job for later, not a mistake.
             */}
            <Dialog
                testID="kitchen-receive-confirm-dialog"
                open={confirming}
                onClose={() => {
                    setConfirming(false);
                }}
                title={t('kitchen:ops.receiving.confirmTitle')}
                actions={
                    <>
                        <Button
                            testID="kitchen-receive-confirm-cancel"
                            variant="quiet"
                            label={t('kitchen:common.cancel')}
                            onPress={() => {
                                setConfirming(false);
                            }}
                        />
                        <Button
                            testID="kitchen-receive-confirm-post"
                            label={t('kitchen:ops.receiving.post')}
                            loading={postReceipt.isPending}
                            onPress={submit}
                        />
                    </>
                }
            >
                <Stack space="sm">
                    <Text testID="kitchen-receive-confirm-stock">
                        {t('kitchen:ops.receiving.confirmStock', {
                            count: state.deliveredLineCount,
                        })}
                    </Text>
                    <Text testID="kitchen-receive-confirm-money" tone="secondary">
                        {lines.some((line) => line.unitPrice.trim() !== '')
                            ? t('kitchen:ops.receiving.confirmMoneySome')
                            : t('kitchen:ops.receiving.confirmMoneyNone')}
                    </Text>
                    {state.skippedLineCount > 0 ? (
                        <Text tone="secondary" testID="kitchen-receive-confirm-skipped">
                            {t('kitchen:ops.receiving.confirmSkipped', {
                                count: state.skippedLineCount,
                            })}
                        </Text>
                    ) : null}
                    {state.hasOverReceipt ? (
                        <Badge
                            tone="warning"
                            testID="kitchen-receive-confirm-over"
                            label={t('kitchen:ops.receiving.confirmOver')}
                        />
                    ) : confirmations.closeShort ? (
                        <Badge
                            tone="warning"
                            testID="kitchen-receive-confirm-close-short"
                            label={t('kitchen:ops.receiving.confirmCloseShort')}
                        />
                    ) : state.hasShortfall ? (
                        <Badge
                            tone="info"
                            testID="kitchen-receive-confirm-partial"
                            label={t('kitchen:ops.receiving.confirmPartial')}
                        />
                    ) : (
                        <Badge
                            tone="success"
                            testID="kitchen-receive-confirm-complete"
                            label={t('kitchen:ops.receiving.confirmComplete')}
                        />
                    )}
                    <Text variant="caption" tone="secondary">
                        {t('kitchen:ops.receiving.confirmDate', {
                            date:
                                header.receivedOn === ''
                                    ? todayIsoDate()
                                    : formatter.formatDate(header.receivedOn, {
                                          dateStyle: 'medium',
                                      }),
                        })}
                    </Text>
                </Stack>
            </Dialog>
        </>
    );
}
