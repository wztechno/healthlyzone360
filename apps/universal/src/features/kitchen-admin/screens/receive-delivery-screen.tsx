import { formatGtin } from '@healthy360/api-client/contracts';
import type { ReceivableOrder } from '@healthy360/api-client/contracts';
import {
    Badge,
    Button,
    Checkbox,
    cx,
    DataList,
    EmptyState,
    ErrorState,
    Icon,
    IssueTrayFrame,
    SearchInput,
    Skeleton,
    Stack,
    Text,
    TextInputField,
    useIssueTrayController,
    useToast,
} from '@healthy360/design-system';
import type { DataListColumn, IssueCardItem, IssueTrayContent } from '@healthy360/design-system';
import { PurchaseOrderId } from '@healthy360/domain-types';
import { useFormatter } from '@healthy360/i18n';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

/** An order with no issue date yet, in the pick list. */
const EM_DASH_PICK = '—';

import { Gate, useCan } from '../../../access/gate.tsx';
import { toFailure } from '../../../data/hooks.ts';
import { pathnameOf } from '../../../navigation/return-to.ts';
import { useReturnTo } from '../../../navigation/use-return-to.ts';
import { STOCK_GAPS_PATH } from '../consumption-exceptions/stock-gap-fix.ts';
import {
    usePostGoodsReceiptMutation,
    useReceivableOrdersQuery,
    useStockItemsQuery,
} from '../../../data/kitchen-ops-hooks.ts';
import { useAccessState, useSession } from '../../../session/session-provider.tsx';
import {
    INVENTORY_MANAGE_PERMISSION,
    INVENTORY_ORDER_SUPPLIES_PERMISSION,
} from '../entity-registry.ts';
import { EditorFrame } from '../editor-frame.tsx';
import { focusField } from '../field-focus.ts';
import { unitCodeLabel } from '../format.ts';
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
import { ReceiveScanBar, placedScanNotice } from '../receive-scan-bar.tsx';
import type { PlacedScan } from '../receive-scan-bar.tsx';
import { focusFirstRefusal } from '../record-form-opening.tsx';
import { serverFieldErrors } from '../server-field-errors.ts';
import type { ServerFieldTarget } from '../server-field-errors.ts';
import { readQuantity as readOrderQuantity } from '../supply-order-model.ts';
import { useNudgeOnRefusal } from '../tray-nudge.ts';
import { useOptimisticConcurrency } from '../use-optimistic-concurrency.ts';
import { useUnsavedGuard } from '../use-unsaved-guard.ts';

import { DeskDateField } from '../desk-kit/desk-date-field.tsx';
import { ReviewBox, StepCard } from '../process-parts.tsx';
import { ProcessSteps } from '../process-steps.tsx';
import type { ProcessStep } from '../process-steps.tsx';
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
 * An **over-receipt** raises a card in the page's issue tray, a confirmation box and a variance note
 * — the card stays until both are given — because §3.5
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
const RECEIVED_ON_ID = 'kitchen-receive-received-on-field';
const INVOICE_DATE_ID = 'kitchen-receive-invoice-date-field';
const DOCUMENT_REF_ID = 'kitchen-receive-document-ref';
const INVOICE_REF_ID = 'kitchen-receive-invoice-ref';
const OVER_CONFIRM_ID = 'kitchen-receive-over-confirm';
const VARIANCE_NOTE_ID = 'kitchen-receive-variance-note';
const CLOSE_SHORT_REASON_ID = 'kitchen-receive-close-short-reason';

function lineFieldId(index: number, field: 'quantity' | 'price' | 'trace'): string {
    return `kitchen-receive-line-${String(index)}-${field}`;
}

/** The server fields that sit on the Delivery step; every other refusal is a line's. */
const DELIVERY_FIELDS: ReadonlySet<string> = new Set([
    'received_on',
    'invoice_date',
    'document_ref',
    'supplier_invoice_ref',
]);

/** The four steps the form is walked in (Procurement boards, 2026-11-24). */
type ReceiveStep = 'order' | 'delivery' | 'lines' | 'check';

/** One thing that stops the post: where it is, and what the To fix list calls it. */
interface ReceiveProblem {
    readonly key: string;
    readonly step: ReceiveStep;
    readonly label: string;
    readonly fieldId?: string | undefined;
}

function ReceiveDelivery({ order }: ReceiveDeliveryScreenProps) {
    const { t } = useTranslation();
    const formatter = useFormatter();
    const router = useRouter();
    // Back steps to wherever the delivery was opened from — the order, or procurement.
    const rawReturn = useLocalSearchParams().returnTo;
    const back = useReturnTo(
        Array.isArray(rawReturn) ? rawReturn[0] : rawReturn,
        '/kitchen/procurement',
    );
    const toast = useToast();
    const access = useAccessState();
    const { me } = useSession();
    const branchId = access.branch?.id ?? null;
    const canOpenOrder = useCan(INVENTORY_ORDER_SUPPLIES_PERMISSION);

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
    // The page's issue tray; a refused post opens it.
    const issueTray = useIssueTrayController();
    const { nudge: nudgeTray } = issueTray;
    useNudgeOnRefusal(postReceipt.error, nudgeTray);
    /**
     * What the last scan's placement has to say — a lot kept apart, a pack left to type — with the
     * row it landed on and that row's quantity then, so the notice goes once the quantity is typed.
     */
    const [scanPlaced, setScanPlaced] = useState<PlacedScan | null>(null);

    const [selectedOrderId, setSelectedOrderId] = useState<string | null>(order ?? null);
    const [lines, setLines] = useState<readonly ReceiveLineDraft[]>([]);
    /** The rows a scan builds on — ahead of the render when two scans answer in one tick. */
    const latestLines = useRef(lines);
    useEffect(() => {
        latestLines.current = lines;
    }, [lines]);
    const [chargesOpen, setChargesOpen] = useState(false);
    // Opened from an order, the order is fixed and the form opens on the paperwork.
    const [step, setStep] = useState<ReceiveStep>(order === undefined ? 'order' : 'delivery');
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

    /** The pick list's rows: the open orders, narrowed by number or supplier. */
    const [orderQuery, setOrderQuery] = useState('');
    const pickRows = useMemo(() => {
        const needle = orderQuery.trim().toLocaleLowerCase();
        return needle === ''
            ? orderRows
            : orderRows.filter((row) =>
                  `${row.number} ${row.supplier?.nameEn ?? ''}`
                      .toLocaleLowerCase()
                      .includes(needle),
              );
    }, [orderRows, orderQuery]);
    const pickColumns: readonly DataListColumn<ReceivableOrder>[] = [
        {
            key: 'pick',
            label: '',
            width: 40,
            priority: 100,
            grow: false,
            render: (row) => {
                const picked = String(row.id) === selectedOrderId;
                return (
                    <View
                        role="radio"
                        aria-checked={picked}
                        aria-label={row.number}
                        testID={`kitchen-receive-order-picker-${String(row.id)}`}
                        className={cx(
                            'h-5 w-5 rounded-full bg-surface-raised',
                            picked
                                ? 'border-[6px] border-surface-brand'
                                : 'border-2 border-stroke-strong',
                        )}
                    />
                );
            },
        },
        {
            key: 'number',
            label: t('kitchen:ops.supplyOrders.columnNumber'),
            width: 150,
            priority: 99,
            grow: false,
            render: (row) => (
                <Text className="text-[13px] font-bold tabular-nums text-content-primary">
                    {row.number}
                </Text>
            ),
        },
        {
            key: 'supplier',
            label: t('kitchen:ops.supplyOrders.columnSupplier'),
            width: 200,
            priority: 90,
            render: (row) => (
                <Text numberOfLines={1} className="text-[13px] font-semibold text-content-primary">
                    {row.supplier?.nameEn ?? t('kitchen:ops.procurement.noSupplier')}
                </Text>
            ),
        },
        {
            key: 'issued',
            label: t('kitchen:ops.receiving.columnIssued'),
            width: 160,
            grow: false,
            priority: 60,
            render: (row) => (
                <Text tone="secondary" numberOfLines={1}>
                    {row.issuedAt === null
                        ? EM_DASH_PICK
                        : t('kitchen:ops.procurement.awaitingIssued', {
                              date: formatter.formatDate(row.issuedAt, { dateStyle: 'medium' }),
                          })}
                </Text>
            ),
        },
        {
            key: 'toCome',
            label: t('kitchen:ops.supplyOrders.columnOutstanding'),
            width: 150,
            priority: 80,
            grow: false,
            align: 'end',
            render: (row) => (
                <Text className="text-[13px] font-bold tabular-nums text-content-primary">
                    {t('kitchen:ops.procurement.awaitingLines', {
                        count: row.outstandingLineCount,
                    })}
                </Text>
            ),
        },
    ];

    /** Every edit goes through these, so the page knows it holds unsaved work. */
    function editHeader(update: (current: ReceiveHeaderDraft) => ReceiveHeaderDraft) {
        guard.markDirty();
        setHeader(update);
    }
    function editConfirmations(update: (current: ReceiveConfirmations) => ReceiveConfirmations) {
        guard.markDirty();
        setConfirmations(update);
    }

    function patchLine(index: number, patch: Partial<ReceiveLineDraft>) {
        guard.markDirty();
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
        guard.markDirty();
        setLines(placed.drafts);
        setScanPlaced(
            placed.keptApart || placed.needsQuantity
                ? {
                      kind: placed.keptApart ? 'keptApart' : 'typeQuantity',
                      key: placed.key,
                      quantity:
                          placed.drafts.find((line) => line.key === placed.key)?.quantity ?? '',
                  }
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
    const problems: ReceiveProblem[] = [];
    const lineIssue = (index: number, field: 'issueFieldQuantity' | 'issueFieldUnitPrice') =>
        t('kitchen:ops.procurement.issueLine', {
            line: index + 1,
            fields: t(`kitchen:ops.procurement.${field}`),
        });
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
                step: 'lines',
                label: lineIssue(index, 'issueFieldQuantity'),
                fieldId: lineFieldId(index, 'quantity'),
            });
        }
        if (line.unitPrice.trim() !== '' && readAmount(line.unitPrice) === null) {
            priceErrors.set(index, t('kitchen:ops.procurement.lineUnitPriceInvalid'));
            problems.push({
                key: `price-${String(index)}`,
                step: 'lines',
                label: lineIssue(index, 'issueFieldUnitPrice'),
                fieldId: lineFieldId(index, 'price'),
            });
        }
        // Lots matter only on a row that posts. The lot field says what is wrong with it; it has
        // no id of its own to be taken to.
        if ((readQuantity(line.quantity) ?? 0) <= 0) return;
        if (!lotIsReadable(line.supplierLot)) {
            problems.push({
                key: `lot-${String(index)}`,
                step: 'lines',
                label: t('kitchen:barcodes.issueLotUnreadable', { line: index + 1 }),
                fieldId: `${lineFieldId(index, 'trace')}-lot`,
            });
        }
        if (lotCheckPending(line)) {
            problems.push({
                key: `lot-check-${String(index)}`,
                step: 'lines',
                label: t('kitchen:barcodes.issueLotCheck', { line: index + 1 }),
                fieldId: `${lineFieldId(index, 'trace')}-lot-checked`,
            });
        }
    });
    const nothingDelivered = lines.length > 0 && state.deliveredLineCount === 0;
    if (nothingDelivered && quantityErrors.size === 0) {
        problems.push({
            key: 'nothing',
            step: 'lines',
            label: t('kitchen:ops.receiving.issueNothing'),
            fieldId: lineFieldId(0, 'quantity'),
        });
        if (attempted) quantityErrors.set(0, t('kitchen:forms.lineQuantityMissing'));
    }
    const overUnconfirmed = state.hasOverReceipt && !confirmations.overReceiptConfirmed;
    if (overUnconfirmed) {
        problems.push({
            key: 'over',
            step: 'lines',
            label: t('kitchen:ops.procurement.issueOverReceipt'),
            fieldId: OVER_CONFIRM_ID,
        });
    }
    if (state.needsVarianceNote) {
        problems.push({
            key: 'note',
            step: 'lines',
            label: t('kitchen:ops.procurement.issueVarianceNote'),
            fieldId: VARIANCE_NOTE_ID,
        });
    }
    if (state.needsCloseShortReason) {
        problems.push({
            key: 'close-short',
            step: 'lines',
            label: t('kitchen:ops.receiving.issueCloseShortReason'),
            fieldId: CLOSE_SHORT_REASON_ID,
        });
    }

    /*
     * What the server refused, put on the fields it named (BUG-06): a line by its place in what
     * was posted, the paperwork and the confirmations by name — in the order the form draws them.
     */
    const serverTargets = (indexes: readonly number[]): Record<string, ServerFieldTarget> => {
        const targets: Record<string, ServerFieldTarget> = {
            received_on: {
                label: t('kitchen:ops.receiving.fieldReceivedOn'),
                fieldId: RECEIVED_ON_ID,
            },
            invoice_date: {
                label: t('kitchen:ops.receiving.fieldInvoiceDate'),
                fieldId: INVOICE_DATE_ID,
            },
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
            const code = lines[index]?.unitCode;
            const unit = code === undefined ? '' : unitCodeLabel(code, t);
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

    /** Opens a step, then — once it is drawn — takes the reader to a field on it. */
    function goTo(next: ReceiveStep, fieldId?: string) {
        setStep(next);
        // focusField waits a frame, by which time the step is drawn.
        if (fieldId !== undefined) focusField(fieldId);
    }

    /** Post posts at once: what the old confirmation said is drawn on Check and post. */
    function attemptPost() {
        setAttempted(true);
        if (problems.length > 0 || !state.canSubmit) {
            // Each field says what is wrong with it; Post takes the reader to the first.
            const first = problems[0];
            if (first !== undefined) goTo(first.step, first.fieldId);
            nudgeTray();
            return;
        }
        submit();
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
                    // Posted: nothing is left unsaved, so leaving must not ask.
                    guard.markClean();
                    toast.show({
                        testID: 'kitchen-receive-posted-toast',
                        tone: 'success',
                        message: t('kitchen:ops.receiving.postedToast'),
                    });
                    // Back to the order for whoever can read it; a receiver without the ordering
                    // code came in through the book, and the order page would only refuse them.
                    // Opened from a page with something waiting on this delivery — Stock gaps through
                    // Post receipt — it goes back there, and to Stock gaps says the gap is fixed.
                    if (back.returnTo !== null) {
                        guard.markClean();
                        back.finish(
                            pathnameOf(back.returnTo) === STOCK_GAPS_PATH
                                ? { fixed: '1' }
                                : undefined,
                        );
                    } else {
                        router.replace(
                            (canOpenOrder
                                ? `/kitchen/supply-orders/${String(PurchaseOrderId.unsafe(String(selectedOrder.id)))}`
                                : '/kitchen/procurement') as never,
                        );
                    }
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
                // A refusal that names a field opens that field's step and takes the reader
                // there; one that names nothing stays on Check and post, with the tray's card.
                onError: (error) => {
                    const targets = serverTargets(posted);
                    const refused = serverFieldErrors(toFailure(error), targets);
                    const named = Object.keys(targets).find(
                        (field) => refused.errorFor(field) !== undefined,
                    );
                    if (named === undefined) return;
                    setStep(DELIVERY_FIELDS.has(named) ? 'delivery' : 'lines');
                    focusFirstRefusal(error, targets);
                },
            },
        );
    }

    const failure = toFailure(orders.error);

    const scanNotice = placedScanNotice(scanPlaced, lines, t, (key) =>
        lineFieldId(
            lines.findIndex((line) => line.key === key),
            'quantity',
        ),
    );

    /*
     * The page's issue tray. What holds the post back as a whole — an over-receipt not yet
     * declared, a lot not yet checked against its pack — and a refused post; a blank or a typo is
     * its own field's to say. The last scan's word is the scan bar's.
     */
    const saveCards: IssueCardItem[] = [
        ...(state.hasOverReceipt && (overUnconfirmed || state.needsVarianceNote)
            ? [
                  {
                      key: 'over-receipt',
                      tone: 'warning' as const,
                      label: t('kitchen:ops.receiving.overReceiptTitle'),
                      action: {
                          onPress: () => {
                              goTo('lines', overUnconfirmed ? OVER_CONFIRM_ID : VARIANCE_NOTE_ID);
                          },
                      },
                      testID: 'kitchen-receive-over-receipt',
                  },
              ]
            : []),
        // One per line, each taking the reader to the tick that line is waiting for.
        ...lines.flatMap((line, index) =>
            (readQuantity(line.quantity) ?? 0) > 0 && lotCheckPending(line)
                ? [
                      {
                          key: `lot-check-${line.key}`,
                          tone: 'warning' as const,
                          label: t('kitchen:barcodes.issueLotCheck', { line: index + 1 }),
                          action: {
                              onPress: () => {
                                  goTo('lines', `${lineFieldId(index, 'trace')}-lot-checked`);
                              },
                          },
                          testID: `kitchen-receive-lot-check-${String(index)}`,
                      },
                  ]
                : [],
        ),
    ];
    // Gone once every refused field carries its own message (BUG-06).
    const failedCards: IssueCardItem[] =
        postFailure === null || (server.unplaced === null && server.items.length > 0)
            ? []
            : [
                  {
                      key: 'post-error',
                      tone: 'danger',
                      label: t('kitchen:ops.receiving.postFailed'),
                      detail: server.unplaced ?? postFailure.message,
                      testID: 'kitchen-receive-error-message',
                  },
              ];
    const trayContent: IssueTrayContent = {
        title: t('kitchen:tray.title'),
        testID: 'kitchen-receive-tray',
        placement: 'inline',
        groups: [
            { key: 'save', title: t('kitchen:tray.groupSave'), items: saveCards },
            { key: 'failed', title: t('kitchen:tray.groupFailed'), items: failedCards },
        ],
    };

    /* ── the steps ──────────────────────────────────────────────────────────────────────────── */

    // The branch the stock lands in, by name, for "Stock at Main Kitchen rises by".
    const branchName = (() => {
        if (access.branch === undefined) return null;
        for (const membership of me?.memberships ?? []) {
            const found = membership.branches.find(
                (candidate) => String(candidate.id) === String(access.branch?.id),
            );
            if (found !== undefined) return found.name;
        }
        return null;
    })();

    const fixes: ReceiveProblem[] =
        selectedOrder === null
            ? [
                  {
                      key: 'order',
                      step: 'order',
                      label: t('kitchen:ops.procurement.issueNoOrder'),
                  },
                  ...problems,
              ]
            : problems;
    // A step's count shows once Post has been pressed, or while Check and post is open.
    const showCounts = attempted || step === 'check';
    const issuesOn = (key: ReceiveStep) =>
        showCounts ? fixes.filter((fix) => fix.step === key).length : 0;

    const outcome: {
        readonly label: string;
        readonly tone: 'warning' | 'info' | 'success';
        readonly testID: string;
    } = state.hasOverReceipt
        ? {
              label: t('kitchen:ops.receiving.confirmOver'),
              tone: 'warning',
              testID: 'kitchen-receive-confirm-over',
          }
        : confirmations.closeShort
          ? {
                label: t('kitchen:ops.receiving.confirmCloseShort'),
                tone: 'warning',
                testID: 'kitchen-receive-confirm-close-short',
            }
          : state.hasShortfall
            ? {
                  label: t('kitchen:ops.receiving.confirmPartial'),
                  tone: 'info',
                  testID: 'kitchen-receive-confirm-partial',
              }
            : {
                  label: t('kitchen:ops.receiving.confirmComplete'),
                  tone: 'success',
                  testID: 'kitchen-receive-confirm-complete',
              };

    const summary = t('kitchen:ops.receiving.summary', {
        delivered: state.deliveredLineCount,
        skipped: state.skippedLineCount,
    });
    const steps: readonly ProcessStep<ReceiveStep>[] = [
        {
            key: 'order',
            label: t('kitchen:ops.receiving.sectionOrder'),
            caption:
                selectedOrder === null
                    ? t('kitchen:ops.receiving.captionChooseOrder')
                    : selectedOrder.number,
            done: order !== undefined || (selectedOrder !== null && step !== 'order'),
            issues: issuesOn('order'),
            issuesLabel: t('kitchen:ops.receiving.stepIssues', { count: issuesOn('order') }),
        },
        {
            key: 'delivery',
            label: t('kitchen:ops.receiving.sectionDelivery'),
            caption: t('kitchen:ops.receiving.captionDelivery'),
            done: (step === 'lines' || step === 'check') && issuesOn('delivery') === 0,
            issues: issuesOn('delivery'),
            issuesLabel: t('kitchen:ops.receiving.stepIssues', { count: issuesOn('delivery') }),
        },
        {
            key: 'lines',
            label: t('kitchen:ops.receiving.linesTitle'),
            caption: summary,
            done: step === 'check' && issuesOn('lines') === 0,
            issues: issuesOn('lines'),
            issuesLabel: t('kitchen:ops.receiving.stepIssues', { count: issuesOn('lines') }),
        },
        {
            key: 'check',
            label: t('kitchen:ops.receiving.stepCheck'),
            caption: outcome.label,
            captionTone: outcome.tone === 'warning' ? 'warning' : undefined,
        },
    ];

    const filedOn =
        header.receivedOn === ''
            ? todayIsoDate()
            : formatter.formatDate(header.receivedOn, { dateStyle: 'medium' });
    const rising = lines.filter((line) => (readQuantity(line.quantity) ?? 0) > 0);

    const unitOf = (line: ReceiveLineDraft) => unitCodeLabel(line.unitCode, t);
    const lineColumns: DataListColumn<ReceiveLineDraft>[] = [
        {
            key: 'item',
            label: t('kitchen:ops.receiving.columnItem'),
            width: 220,
            priority: 100,
            render: (line) => (
                <Text className="py-2 !text-sm !font-bold leading-[18px] text-content-primary">
                    {line.itemLabel}
                </Text>
            ),
        },
        {
            key: 'toCome',
            label: t('kitchen:ops.supplyOrders.columnOutstanding'),
            width: 112,
            priority: 98,
            grow: false,
            render: (line) => (
                <View className="h-9 flex-row items-center gap-1">
                    <Text className="text-[15px] font-bold tabular-nums text-content-primary">
                        {line.outstandingQuantity}
                    </Text>
                    <Text className="text-[13px] font-medium text-content-secondary">
                        {unitOf(line)}
                    </Text>
                </View>
            ),
        },
        {
            key: 'received',
            label: t('kitchen:ops.receiving.columnReceived'),
            width: 104,
            priority: 99,
            grow: false,
            render: (line) => {
                const index = lines.indexOf(line);
                return (
                    <TextInputField
                        testID={`kitchen-receive-line-${String(index)}-quantity`}
                        id={lineFieldId(index, 'quantity')}
                        label={t('kitchen:ops.receiving.fieldLineQuantity', {
                            unit: unitOf(line),
                        })}
                        labelHidden
                        size="sm"
                        value={line.quantity}
                        placeholder={t('kitchen:fields.quantityPlaceholder')}
                        keyboardType="decimal-pad"
                        className="w-full"
                        caution={exceedsOutstanding(line, lines)}
                        trailing={
                            <Text className="text-xs font-medium text-content-secondary">
                                {unitOf(line)}
                            </Text>
                        }
                        {...((quantityErrors.get(index) ?? serverLineError(index, 'quantity')) ===
                        undefined
                            ? {}
                            : {
                                  error:
                                      quantityErrors.get(index) ??
                                      serverLineError(index, 'quantity'),
                              })}
                        onChangeText={(next) => {
                            // A typed quantity is a person's, and no scan edits it from here on.
                            patchLine(index, { quantity: next, quantitySource: 'typed' });
                        }}
                    />
                );
            },
        },
        {
            key: 'price',
            label: t('kitchen:ops.receiving.fieldLineUnitPrice', { currency: RECEIPT_CURRENCY }),
            width: 128,
            priority: 90,
            grow: false,
            render: (line) => {
                const index = lines.indexOf(line);
                // Visible to every manage holder — §5's blind-write model. Reads stay redacted;
                // writing what the paper says does not.
                return (
                    <TextInputField
                        testID={`kitchen-receive-line-${String(index)}-price`}
                        id={lineFieldId(index, 'price')}
                        label={t('kitchen:ops.receiving.fieldLineUnitPrice', {
                            currency: RECEIPT_CURRENCY,
                        })}
                        labelHidden
                        size="sm"
                        value={line.unitPrice}
                        placeholder={t('kitchen:fields.unitPricePlaceholder')}
                        keyboardType="decimal-pad"
                        className="w-full"
                        {...((priceErrors.get(index) ??
                            serverLineError(index, 'unit_price_amount')) === undefined
                            ? {}
                            : {
                                  error:
                                      priceErrors.get(index) ??
                                      serverLineError(index, 'unit_price_amount'),
                              })}
                        onChangeText={(next) => {
                            patchLine(index, { unitPrice: next });
                        }}
                    />
                );
            },
        },
        {
            key: 'lot',
            label: t('kitchen:barcodes.lotLabel'),
            width: 150,
            priority: 80,
            render: (line) => {
                const index = lines.indexOf(line);
                const traceId = lineFieldId(index, 'trace');
                return (
                    <TextInputField
                        testID={`${traceId}-lot`}
                        id={`${traceId}-lot`}
                        size="sm"
                        label={t('kitchen:barcodes.lotLabel')}
                        labelHidden
                        placeholder={t('kitchen:barcodes.lotPlaceholder')}
                        className="w-full"
                        value={line.supplierLot ?? ''}
                        maxLength={20}
                        autoCorrect={false}
                        autoCapitalize="none"
                        {...(lotIsReadable(line.supplierLot)
                            ? {}
                            : { error: t('kitchen:barcodes.lotUnreadable') })}
                        onChangeText={(next) => {
                            patchLine(index, { supplierLot: next, lotUnverified: false });
                        }}
                    />
                );
            },
        },
        {
            key: 'expires',
            label: t('kitchen:barcodes.expiresLabel'),
            width: 132,
            priority: 70,
            grow: false,
            render: (line) => {
                const index = lines.indexOf(line);
                return (
                    <DeskDateField
                        testID={`${lineFieldId(index, 'trace')}-expires`}
                        label={t('kitchen:barcodes.expiresLabel')}
                        labelHidden
                        clearable
                        className="w-full"
                        value={line.expiresOn ?? ''}
                        onChange={(next) => {
                            patchLine(index, { expiresOn: next ?? '' });
                        }}
                    />
                );
            },
        },
        {
            key: 'bestBefore',
            label: t('kitchen:barcodes.bestBeforeLabel'),
            width: 132,
            priority: 60,
            grow: false,
            render: (line) => {
                const index = lines.indexOf(line);
                return (
                    <DeskDateField
                        testID={`${lineFieldId(index, 'trace')}-best-before`}
                        label={t('kitchen:barcodes.bestBeforeLabel')}
                        labelHidden
                        clearable
                        align="end"
                        className="w-full"
                        value={line.bestBeforeOn ?? ''}
                        onChange={(next) => {
                            patchLine(index, { bestBeforeOn: next ?? '' });
                        }}
                    />
                );
            },
        },
    ];

    /** What a row says under its fields: more than was ordered, the scanned product, the lot tick. */
    const lineNote = (line: ReceiveLineDraft) => {
        const index = lines.indexOf(line);
        const traceId = lineFieldId(index, 'trace');
        const over = exceedsOutstanding(line, lines);
        const gtin = line.gtin ?? null;
        const unplanned = line.purchaseOrderLineId === null;
        if (!over && gtin === null && line.lotUnverified !== true && !unplanned) return null;
        return (
            <View className="gap-1 px-3.5 pb-3">
                {over ? (
                    <RowMessage
                        testID={`kitchen-receive-line-${String(index)}-over`}
                        text={t('kitchen:ops.receiving.lineOverReceipt', {
                            quantity: line.outstandingQuantity,
                            unit: unitOf(line),
                        })}
                    />
                ) : null}
                {unplanned ? (
                    <RowMessage
                        testID={`kitchen-receive-line-${String(index)}-unplanned`}
                        text={t('kitchen:ops.procurement.unplannedTitle')}
                    />
                ) : null}
                {gtin === null ? null : (
                    <Text
                        testID={`${traceId}-gtin`}
                        className="text-xs font-medium text-content-secondary"
                    >
                        {t('kitchen:barcodes.scannedProduct', {
                            gtin: `⁦${formatGtin(gtin)}⁩`,
                        })}
                    </Text>
                )}
                {line.lotUnverified === true ? (
                    <View className="flex-row flex-wrap items-center gap-2">
                        {lotCheckPending(line) ? (
                            <RowMessage text={t('kitchen:barcodes.lotUnverified')} />
                        ) : null}
                        <Checkbox
                            testID={`${traceId}-lot-checked`}
                            id={`${traceId}-lot-checked`}
                            checked={line.lotConfirmed === true}
                            label={t('kitchen:barcodes.lotChecked')}
                            onChange={(checked) => {
                                patchLine(index, { lotConfirmed: checked });
                            }}
                        />
                    </View>
                ) : null}
            </View>
        );
    };

    const field = 'min-w-[160px] flex-1';

    return (
        <IssueTrayFrame tray={selectedOrder === null ? null : trayContent} controller={issueTray}>
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
                        <Text
                            testID="kitchen-receive-order-header"
                            className="text-[13px] font-medium tabular-nums text-content-secondary"
                        >
                            <Text className="font-bold text-content-primary">
                                {selectedOrder.number}
                            </Text>
                            {` · ${
                                selectedOrder.supplier?.nameEn ??
                                t('kitchen:ops.procurement.noSupplier')
                            } · ${t('kitchen:ops.receiving.outstandingLineCount', {
                                count: selectedOrder.outstandingLineCount,
                            })}`}
                        </Text>
                    )
                }
                guard={guard}
                concurrency={concurrency}
                onSaveDraft={attemptPost}
                saveLabel={t('kitchen:ops.receiving.post')}
                // Post sits in the header on every step, beside Back. Pressed before the
                // delivery is ready it posts nothing and opens the first thing to fix.
                hideSave
                primaryAction={
                    selectedOrder === null ? undefined : (
                        <Button
                            testID="kitchen-receive-post"
                            label={t('kitchen:ops.receiving.post')}
                            iconStart={<Icon name="check" size="sm" />}
                            loading={postReceipt.isPending}
                            disabled={branchId === null}
                            onPress={attemptPost}
                        />
                    )
                }
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
                ) : order !== undefined && selectedOrder === null ? (
                    <EmptyState
                        testID="kitchen-receive-order-missing"
                        title={t('kitchen:ops.receiving.orderMissingTitle')}
                        body={t('kitchen:ops.receiving.orderMissingBody')}
                    />
                ) : (
                    <View testID="kitchen-receive-content" className="pb-2">
                        <ProcessSteps<ReceiveStep>
                            testID="kitchen-receive-steps"
                            label={t('kitchen:ops.receiving.stepsLabel')}
                            steps={steps}
                            value={step}
                            onChange={setStep}
                        />

                        {step === 'order' ? (
                            <StepCard
                                testID="kitchen-receive-order-section"
                                title={t('kitchen:ops.receiving.sectionOrder')}
                                actions={
                                    order === undefined ? (
                                        <SearchInput
                                            testID="kitchen-receive-order-find"
                                            size="sm"
                                            lens
                                            className="w-[340px]"
                                            label={t('kitchen:ops.receiving.findOrderLabel')}
                                            placeholder={t(
                                                'kitchen:ops.receiving.findOrderPlaceholder',
                                            )}
                                            value={orderQuery}
                                            onChangeText={setOrderQuery}
                                        />
                                    ) : undefined
                                }
                            >
                                {order === undefined ? (
                                    <DataList<ReceivableOrder>
                                        testID="kitchen-receive-order-picker"
                                        label={t('kitchen:ops.receiving.fieldOrder')}
                                        columns={pickColumns}
                                        rows={pickRows}
                                        rowKey={(row) => String(row.id)}
                                        density="sm"
                                        onRowPress={(row) => {
                                            setSelectedOrderId(String(row.id));
                                            setStep('delivery');
                                        }}
                                        isRowSelected={(row) => String(row.id) === selectedOrderId}
                                        emptyState={
                                            <Text tone="secondary" className="p-4">
                                                {t('kitchen:ops.receiving.noOrderMatch')}
                                            </Text>
                                        }
                                    />
                                ) : selectedOrder === null ? null : (
                                    <View
                                        testID="kitchen-receive-order-fixed"
                                        className="flex-row flex-wrap items-center gap-3.5 rounded-2xl bg-surface-sunken px-4 py-3.5"
                                    >
                                        <Text className="font-display text-base font-bold tabular-nums text-content-primary">
                                            {selectedOrder.number}
                                        </Text>
                                        <Text className="text-sm font-semibold text-content-primary">
                                            {selectedOrder.supplier?.nameEn ??
                                                t('kitchen:ops.procurement.noSupplier')}
                                        </Text>
                                        <Text className="text-[13px] font-medium text-content-secondary">
                                            {[
                                                selectedOrder.issuedAt === null
                                                    ? null
                                                    : t('kitchen:ops.procurement.awaitingIssued', {
                                                          date: formatter.formatDate(
                                                              selectedOrder.issuedAt,
                                                              { dateStyle: 'medium' },
                                                          ),
                                                      }),
                                                t('kitchen:ops.receiving.outstandingLineCount', {
                                                    count: selectedOrder.outstandingLineCount,
                                                }),
                                            ]
                                                .filter((part) => part !== null)
                                                .join(' · ')}
                                        </Text>
                                        <View className="ms-auto">
                                            <Badge
                                                tone="neutral"
                                                label={t('kitchen:ops.receiving.orderFixed')}
                                            />
                                        </View>
                                    </View>
                                )}
                            </StepCard>
                        ) : null}

                        {step === 'delivery' && selectedOrder !== null ? (
                            <StepCard
                                testID="kitchen-receive-delivery-section"
                                title={t('kitchen:ops.receiving.sectionDelivery')}
                            >
                                <View className="flex-row flex-wrap items-start gap-3">
                                    <DeskDateField
                                        testID="kitchen-receive-received-on"
                                        id={RECEIVED_ON_ID}
                                        {...server.flag('received_on')}
                                        label={t('kitchen:ops.receiving.fieldReceivedOn')}
                                        hint={t('kitchen:ops.receiving.fieldReceivedOnHint')}
                                        value={header.receivedOn}
                                        max={todayIsoDate()}
                                        className={field}
                                        onChange={(next) => {
                                            editHeader((current) => ({
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
                                            editHeader((current) => ({
                                                ...current,
                                                documentRef: next,
                                            }));
                                        }}
                                        className={field}
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
                                            editHeader((current) => ({
                                                ...current,
                                                supplierInvoiceRef: next,
                                            }));
                                        }}
                                        className={field}
                                    />
                                    <DeskDateField
                                        testID="kitchen-receive-invoice-date"
                                        id={INVOICE_DATE_ID}
                                        {...server.flag('invoice_date')}
                                        clearable
                                        align="end"
                                        label={t('kitchen:ops.receiving.fieldInvoiceDate')}
                                        value={header.invoiceDate}
                                        className={field}
                                        onChange={(next) => {
                                            editHeader((current) => ({
                                                ...current,
                                                invoiceDate: next ?? '',
                                            }));
                                        }}
                                    />
                                </View>

                                <View
                                    testID="kitchen-receive-charges"
                                    className="mt-[18px] border-t border-stroke-subtle pt-4"
                                >
                                    <View className="flex-row flex-wrap items-center gap-2.5">
                                        <Text
                                            role="heading"
                                            aria-level={3}
                                            className="text-sm font-bold text-content-primary"
                                        >
                                            {t('kitchen:ops.receiving.sectionCharges')}
                                        </Text>
                                        <View className="ms-auto">
                                            <Button
                                                testID="kitchen-receive-charges-toggle"
                                                size="sm"
                                                variant="secondary"
                                                aria-expanded={chargesOpen}
                                                label={
                                                    chargesOpen
                                                        ? t('kitchen:ops.receiving.hideCharges')
                                                        : t('kitchen:ops.receiving.showCharges')
                                                }
                                                iconEnd={
                                                    <Icon
                                                        name={
                                                            chargesOpen
                                                                ? 'chevronUp'
                                                                : 'chevronDown'
                                                        }
                                                        size="sm"
                                                    />
                                                }
                                                onPress={() => {
                                                    setChargesOpen((open) => !open);
                                                }}
                                            />
                                        </View>
                                    </View>
                                    {chargesOpen ? (
                                        <View
                                            testID="kitchen-receive-charges-fields"
                                            className="mt-3.5 flex-row flex-wrap items-start gap-3"
                                        >
                                            {(
                                                [
                                                    ['discountAmount', 'fieldDiscount'],
                                                    ['taxAmount', 'fieldTax'],
                                                    ['deliveryAmount', 'fieldDelivery'],
                                                    ['otherChargesAmount', 'fieldOtherCharges'],
                                                    ['invoiceTotalAmount', 'fieldInvoiceTotal'],
                                                ] as const
                                            ).map(([key, labelKey]) => (
                                                <TextInputField
                                                    key={key}
                                                    testID={`kitchen-receive-${key}`}
                                                    label={t(`kitchen:ops.receiving.${labelKey}`, {
                                                        currency: RECEIPT_CURRENCY,
                                                    })}
                                                    placeholder={t(
                                                        'kitchen:fields.amountPlaceholder',
                                                    )}
                                                    value={header[key]}
                                                    keyboardType="decimal-pad"
                                                    onChangeText={(next) => {
                                                        editHeader((current) => ({
                                                            ...current,
                                                            [key]: next,
                                                        }));
                                                    }}
                                                    className="min-w-[140px] flex-1"
                                                />
                                            ))}
                                        </View>
                                    ) : null}
                                </View>
                            </StepCard>
                        ) : null}

                        {step === 'lines' && selectedOrder !== null ? (
                            <StepCard
                                testID="kitchen-receive-lines-section"
                                title={t('kitchen:ops.receiving.linesTitle')}
                                count={summary}
                                actions={
                                    <ReceiveScanBar
                                        testID="kitchen-receive-scan"
                                        stockItems={stockItems.data ?? []}
                                        onScanned={placeScan}
                                        notice={scanNotice}
                                        inHeader
                                    />
                                }
                            >
                                <DataList<ReceiveLineDraft>
                                    testID="kitchen-receive-lines"
                                    label={t('kitchen:ops.receiving.linesTitle')}
                                    columns={lineColumns}
                                    rows={lines}
                                    rowKey={(line) => line.key}
                                    density="sm"
                                    rowNote={lineNote}
                                />

                                {state.hasOverReceipt ||
                                state.hasUnplannedLine ||
                                state.hasShortfall ? (
                                    <View
                                        testID="kitchen-receive-differs"
                                        className="mt-3 rounded-2xl bg-surface-sunken"
                                    >
                                        {state.hasOverReceipt || state.hasUnplannedLine ? (
                                            <View className="flex-row flex-wrap items-start gap-4 px-4 py-3.5">
                                                {/* Said in the tray; the answer is given here. */}
                                                <View className="min-w-[240px] flex-1 pt-6">
                                                    {state.hasOverReceipt ? (
                                                        <Checkbox
                                                            testID="kitchen-receive-over-confirm"
                                                            id={OVER_CONFIRM_ID}
                                                            {...(attempted && overUnconfirmed
                                                                ? {
                                                                      error: t(
                                                                          'kitchen:ops.procurement.issueOverReceipt',
                                                                      ),
                                                                  }
                                                                : server.flag(
                                                                      'over_receipt_confirmed',
                                                                  ))}
                                                            checked={
                                                                confirmations.overReceiptConfirmed
                                                            }
                                                            label={t(
                                                                'kitchen:ops.receiving.overReceiptConfirm',
                                                            )}
                                                            onChange={(checked) => {
                                                                editConfirmations((current) => ({
                                                                    ...current,
                                                                    overReceiptConfirmed: checked,
                                                                }));
                                                            }}
                                                        />
                                                    ) : null}
                                                </View>
                                                <TextInputField
                                                    className="min-w-[240px] flex-1"
                                                    testID="kitchen-receive-variance-note"
                                                    id={VARIANCE_NOTE_ID}
                                                    {...(attempted && state.needsVarianceNote
                                                        ? { error: t('kitchen:forms.required') }
                                                        : server.flag('variance_note'))}
                                                    label={t(
                                                        'kitchen:ops.receiving.fieldVarianceNote',
                                                    )}
                                                    placeholder={t(
                                                        'kitchen:ops.receiving.varianceNotePlaceholder',
                                                    )}
                                                    required
                                                    value={confirmations.varianceNote}
                                                    onChangeText={(next) => {
                                                        editConfirmations((current) => ({
                                                            ...current,
                                                            varianceNote: next,
                                                        }));
                                                    }}
                                                />
                                            </View>
                                        ) : null}
                                        {state.hasShortfall ? (
                                            <View
                                                testID="kitchen-receive-close-short"
                                                className={cx(
                                                    'flex-row flex-wrap items-start gap-4 px-4 py-3.5',
                                                    state.hasOverReceipt || state.hasUnplannedLine
                                                        ? 'border-t border-stroke-subtle'
                                                        : null,
                                                )}
                                            >
                                                <View className="min-w-[240px] flex-1">
                                                    <Checkbox
                                                        testID="kitchen-receive-close-short-toggle"
                                                        checked={confirmations.closeShort}
                                                        label={t(
                                                            'kitchen:ops.receiving.closeShortLabel',
                                                        )}
                                                        description={t(
                                                            'kitchen:ops.receiving.closeShortHint',
                                                        )}
                                                        onChange={(checked) => {
                                                            editConfirmations((current) => ({
                                                                ...current,
                                                                closeShort: checked,
                                                            }));
                                                        }}
                                                    />
                                                </View>
                                                {confirmations.closeShort ? (
                                                    <TextInputField
                                                        className="min-w-[240px] flex-1"
                                                        testID="kitchen-receive-close-short-reason"
                                                        id={CLOSE_SHORT_REASON_ID}
                                                        {...(attempted &&
                                                        state.needsCloseShortReason
                                                            ? {
                                                                  error: t(
                                                                      'kitchen:forms.required',
                                                                  ),
                                                              }
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
                                                            editConfirmations((current) => ({
                                                                ...current,
                                                                closeShortReason: next,
                                                            }));
                                                        }}
                                                    />
                                                ) : null}
                                            </View>
                                        ) : null}
                                    </View>
                                ) : null}
                            </StepCard>
                        ) : null}

                        {step === 'check' && selectedOrder !== null ? (
                            <StepCard
                                testID="kitchen-receive-check-section"
                                title={t('kitchen:ops.receiving.stepCheck')}
                            >
                                <View className="flex-row flex-wrap items-start gap-3">
                                    <View className="min-w-[320px] flex-[1.25] gap-3">
                                        <ReviewBox
                                            testID="kitchen-receive-confirm"
                                            title={t('kitchen:ops.receiving.thisDelivery')}
                                            trailing={
                                                <Badge
                                                    tone={outcome.tone}
                                                    testID={outcome.testID}
                                                    label={outcome.label}
                                                />
                                            }
                                        >
                                            <View className="mt-1 gap-1.5">
                                                <ConfirmRow
                                                    icon="package"
                                                    testID="kitchen-receive-confirm-stock"
                                                    text={t('kitchen:ops.receiving.confirmStock', {
                                                        count: state.deliveredLineCount,
                                                    })}
                                                    strong
                                                />
                                                <ConfirmRow
                                                    icon="banknote"
                                                    testID="kitchen-receive-confirm-money"
                                                    text={
                                                        lines.some(
                                                            (line) => line.unitPrice.trim() !== '',
                                                        )
                                                            ? t(
                                                                  'kitchen:ops.receiving.confirmMoneySome',
                                                              )
                                                            : t(
                                                                  'kitchen:ops.receiving.confirmMoneyNone',
                                                              )
                                                    }
                                                />
                                                {state.skippedLineCount > 0 ? (
                                                    <ConfirmRow
                                                        icon="minus"
                                                        testID="kitchen-receive-confirm-skipped"
                                                        text={t(
                                                            'kitchen:ops.receiving.confirmSkipped',
                                                            { count: state.skippedLineCount },
                                                        )}
                                                    />
                                                ) : null}
                                            </View>
                                            <Text className="mt-2.5 text-[13px] font-medium text-content-secondary">
                                                {t('kitchen:ops.receiving.confirmDate', {
                                                    date: filedOn,
                                                })}
                                            </Text>
                                        </ReviewBox>
                                        <ReviewBox
                                            testID="kitchen-receive-rises"
                                            title={
                                                branchName === null
                                                    ? t(
                                                          'kitchen:ops.procurement.risesTitleNoBranch',
                                                      )
                                                    : t('kitchen:ops.procurement.risesTitle', {
                                                          branch: branchName,
                                                      })
                                            }
                                        >
                                            <View className="flex-row flex-wrap gap-1.5">
                                                {rising.map((line) => (
                                                    <View
                                                        key={line.key}
                                                        className="h-7 flex-row items-center gap-1.5 rounded-full bg-surface-brand-subtle px-2.5"
                                                    >
                                                        <Icon
                                                            name="plus"
                                                            size="sm"
                                                            className="text-content-on-brand-subtle"
                                                        />
                                                        <Text className="text-xs font-semibold text-content-on-brand-subtle">
                                                            {line.itemLabel.split(' — ').at(-1)}
                                                        </Text>
                                                        <Text className="text-xs font-bold tabular-nums text-content-on-brand-subtle">
                                                            {t(
                                                                'kitchen:ops.procurement.risesQuantity',
                                                                {
                                                                    quantity: line.quantity.trim(),
                                                                    unit: unitOf(line),
                                                                },
                                                            )}
                                                        </Text>
                                                    </View>
                                                ))}
                                            </View>
                                        </ReviewBox>
                                    </View>
                                    {fixes.length === 0 ? null : (
                                        <View className="min-w-[260px] flex-1">
                                            <ReviewBox
                                                testID="kitchen-receive-fixes"
                                                title={t('kitchen:ops.receiving.toFix')}
                                            >
                                                <View className="gap-1.5">
                                                    {fixes.map((fix) => (
                                                        <View
                                                            key={fix.key}
                                                            testID={`kitchen-receive-fix-${fix.key}`}
                                                            className="min-h-11 flex-row items-center gap-2.5 rounded-xl bg-danger-subtle py-1.5 pe-1.5 ps-3"
                                                        >
                                                            <View className="h-2 w-2 rounded-full bg-danger-strong" />
                                                            <Text className="min-w-0 flex-1 text-[13px] font-semibold text-danger-on-subtle">
                                                                {fix.label}
                                                            </Text>
                                                            <Button
                                                                testID={`kitchen-receive-fix-${fix.key}-go`}
                                                                size="sm"
                                                                variant="secondary"
                                                                label={t(
                                                                    'kitchen:ops.receiving.fix',
                                                                )}
                                                                onPress={() => {
                                                                    goTo(fix.step, fix.fieldId);
                                                                }}
                                                            />
                                                        </View>
                                                    ))}
                                                </View>
                                            </ReviewBox>
                                        </View>
                                    )}
                                </View>
                            </StepCard>
                        ) : null}
                    </View>
                )}
            </EditorFrame>
        </IssueTrayFrame>
    );
}

/** One line of the review: what posting does, with its icon in a round well. */
function ConfirmRow({
    icon,
    text,
    strong = false,
    testID,
}: {
    readonly icon: 'package' | 'banknote' | 'minus';
    readonly text: string;
    readonly strong?: boolean | undefined;
    readonly testID: string;
}) {
    return (
        <View className="min-h-[46px] flex-row items-center gap-3 rounded-[14px] bg-surface-sunken px-3 py-1.5">
            <View className="h-[30px] w-[30px] items-center justify-center rounded-full bg-surface-raised">
                <Icon
                    name={icon}
                    size="sm"
                    className={strong ? 'text-content-on-brand-subtle' : 'text-content-secondary'}
                />
            </View>
            <Text
                testID={testID}
                className={cx(
                    'min-w-0 flex-1 text-sm',
                    strong
                        ? 'font-bold text-content-primary'
                        : 'font-medium text-content-secondary',
                )}
            >
                {text}
            </Text>
        </View>
    );
}

/** A row's own warning, under its fields: an amber dot and the sentence. */
function RowMessage({ text, testID }: { readonly text: string; readonly testID?: string }) {
    return (
        <View className="flex-row items-center gap-2">
            <View className="h-2 w-2 rounded-full bg-warning-strong" />
            <Text testID={testID} className="text-xs font-semibold text-warning-on-subtle">
                {text}
            </Text>
        </View>
    );
}
