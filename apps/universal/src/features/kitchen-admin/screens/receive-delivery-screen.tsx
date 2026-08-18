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
    Heading,
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
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { Gate } from '../../../access/gate.tsx';
import { toFailure } from '../../../data/hooks.ts';
import {
    usePostGoodsReceiptMutation,
    useReceivableOrdersQuery,
} from '../../../data/kitchen-ops-hooks.ts';
import { useAccessState } from '../../../session/session-provider.tsx';
import { INVENTORY_MANAGE_PERMISSION } from '../entity-registry.ts';
import { OpsPanel } from '../ops-panel.tsx';
import {
    exceedsOutstanding,
    initialLines,
    readiness,
    toReceiptPayload,
    todayIsoDate,
} from '../receive-delivery-model.ts';
import type {
    ReceiveConfirmations,
    ReceiveHeaderDraft,
    ReceiveLineDraft,
} from '../receive-delivery-model.ts';

/**
 * `/kitchen/procurement/receive` — booking in a delivery against an issued order (SUP5, §7).
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

function ReceiveDelivery({ order }: ReceiveDeliveryScreenProps) {
    const { t } = useTranslation();
    const formatter = useFormatter();
    const router = useRouter();
    const toast = useToast();
    const access = useAccessState();
    const branchId = access.branch?.id ?? null;

    const orders = useReceivableOrdersQuery(branchId);
    const postReceipt = usePostGoodsReceiptMutation();

    const [selectedOrderId, setSelectedOrderId] = useState<string | null>(order ?? null);
    const [lines, setLines] = useState<readonly ReceiveLineDraft[]>([]);
    const [chargesOpen, setChargesOpen] = useState(false);
    const [confirming, setConfirming] = useState(false);

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

    function submit() {
        if (branchId === null || selectedOrder === null || !state.canSubmit) return;

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
            },
        );
    }

    const failure = toFailure(orders.error);

    return (
        <Stack space="lg" testID="kitchen-receive-screen">
            <OpsPanel
                testID="kitchen-receive-panel"
                titleKey="kitchen:ops.receiving.title"
                subtitleKey="kitchen:ops.receiving.subtitle"
                metrics={[]}
                emptyTitleKey="kitchen:ops.receiving.emptyTitle"
                emptyBodyKey="kitchen:ops.receiving.emptyBody"
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
                    <Stack space="lg" testID="kitchen-receive-content">
                        {/*
                         * With `?order=` the supplier and branch are fixed from the order (§7) and
                         * the header states them rather than offering them; without it, this is the
                         * picker. Either way there is exactly one order on screen.
                         */}
                        {order === undefined ? (
                            <Select
                                testID="kitchen-receive-order-picker"
                                label={t('kitchen:ops.receiving.fieldOrder')}
                                options={orderOptions}
                                value={selectedOrderId}
                                onChange={setSelectedOrderId}
                                searchable
                            />
                        ) : selectedOrder === null ? (
                            <EmptyState
                                testID="kitchen-receive-order-missing"
                                title={t('kitchen:ops.receiving.orderMissingTitle')}
                                body={t('kitchen:ops.receiving.orderMissingBody')}
                            />
                        ) : null}

                        {selectedOrder === null ? null : (
                            <Stack space="lg" testID="kitchen-receive-form">
                                <Stack space="xs" testID="kitchen-receive-order-header">
                                    <Heading level={2}>{selectedOrder.number}</Heading>
                                    <Text variant="caption" tone="secondary">
                                        {selectedOrder.supplier?.nameEn ??
                                            t('kitchen:ops.procurement.noSupplier')}
                                    </Text>
                                    <Text variant="caption" tone="secondary">
                                        {t('kitchen:ops.receiving.outstandingLineCount', {
                                            count: selectedOrder.outstandingLineCount,
                                        })}
                                    </Text>
                                </Stack>

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
                                        label={t('kitchen:ops.receiving.fieldDocumentRef')}
                                        hint={t('kitchen:ops.receiving.fieldDocumentRefHint')}
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
                                        label={t('kitchen:ops.receiving.fieldInvoiceRef')}
                                        hint={t('kitchen:ops.receiving.fieldInvoiceRefHint')}
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

                                <Stack space="sm" testID="kitchen-receive-lines">
                                    <Heading level={3}>
                                        {t('kitchen:ops.receiving.linesTitle')}
                                    </Heading>
                                    {lines.map((line, index) => (
                                        <Stack
                                            key={line.purchaseOrderLineId ?? line.stockItemId}
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
                                                    {t('kitchen:ops.receiving.outstandingLabel', {
                                                        quantity: line.outstandingQuantity,
                                                        unit: line.unitCode,
                                                    })}
                                                </Text>
                                            </Inline>
                                            <Inline space="sm" align="start" wrap>
                                                <TextInputField
                                                    testID={`kitchen-receive-line-${String(index)}-quantity`}
                                                    label={t(
                                                        'kitchen:ops.receiving.fieldLineQuantity',
                                                        { unit: line.unitCode },
                                                    )}
                                                    value={line.quantity}
                                                    keyboardType="decimal-pad"
                                                    onChangeText={(next) => {
                                                        patchLine(index, { quantity: next });
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
                                                    label={t(
                                                        'kitchen:ops.receiving.fieldLineUnitPrice',
                                                        { currency: RECEIPT_CURRENCY },
                                                    )}
                                                    hint={t(
                                                        'kitchen:ops.receiving.fieldLineUnitPriceHint',
                                                    )}
                                                    value={line.unitPrice}
                                                    keyboardType="decimal-pad"
                                                    onChangeText={(next) => {
                                                        patchLine(index, { unitPrice: next });
                                                    }}
                                                    className="min-w-[140px]"
                                                />
                                            </Inline>
                                            {exceedsOutstanding(line) ? (
                                                <Text
                                                    tone="danger"
                                                    variant="caption"
                                                    testID={`kitchen-receive-line-${String(index)}-over`}
                                                >
                                                    {t('kitchen:ops.receiving.lineOverReceipt', {
                                                        quantity: line.outstandingQuantity,
                                                        unit: line.unitCode,
                                                    })}
                                                </Text>
                                            ) : null}
                                        </Stack>
                                    ))}
                                </Stack>

                                {state.hasOverReceipt ? (
                                    <Callout
                                        tone="warning"
                                        testID="kitchen-receive-over-receipt"
                                        title={t('kitchen:ops.receiving.overReceiptTitle')}
                                    >
                                        <Stack space="sm">
                                            <Text>
                                                {t('kitchen:ops.receiving.overReceiptBody')}
                                            </Text>
                                            <Checkbox
                                                testID="kitchen-receive-over-confirm"
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
                                        label={t('kitchen:ops.receiving.fieldVarianceNote')}
                                        hint={t('kitchen:ops.receiving.fieldVarianceNoteHint')}
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
                                            description={t('kitchen:ops.receiving.closeShortHint')}
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
                                                label={t(
                                                    'kitchen:ops.receiving.fieldCloseShortReason',
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
                                        <Stack space="sm" testID="kitchen-receive-charges-fields">
                                            <Text variant="caption" tone="secondary">
                                                {t('kitchen:ops.receiving.chargesHint')}
                                            </Text>
                                            <Inline space="sm" align="start" wrap>
                                                {(
                                                    [
                                                        ['discountAmount', 'fieldDiscount'],
                                                        ['taxAmount', 'fieldTax'],
                                                        ['deliveryAmount', 'fieldDelivery'],
                                                        ['otherChargesAmount', 'fieldOtherCharges'],
                                                        ['invoiceTotalAmount', 'fieldInvoiceTotal'],
                                                    ] as const
                                                ).map(([field, labelKey]) => (
                                                    <TextInputField
                                                        key={field}
                                                        testID={`kitchen-receive-${field}`}
                                                        label={t(
                                                            `kitchen:ops.receiving.${labelKey}`,
                                                            { currency: RECEIPT_CURRENCY },
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

                                {postReceipt.error === null ? null : (
                                    <Text testID="kitchen-receive-error-message" tone="danger">
                                        {toFailure(postReceipt.error)?.message ??
                                            t('kitchen:ops.receiving.postFailed')}
                                    </Text>
                                )}

                                <Inline space="sm" align="center" justify="between" wrap>
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
                                    <Button
                                        testID="kitchen-receive-submit"
                                        label={t('kitchen:ops.receiving.post')}
                                        disabled={branchId === null || !state.canSubmit}
                                        onPress={() => {
                                            setConfirming(true);
                                        }}
                                    />
                                </Inline>
                            </Stack>
                        )}
                    </Stack>
                )}
            </OpsPanel>

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
        </Stack>
    );
}
