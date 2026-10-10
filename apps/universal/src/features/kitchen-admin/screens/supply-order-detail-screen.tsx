import type { PurchaseOrderLine, StockItem } from '@healthy360/api-client/contracts';
import {
    Badge,
    Button,
    Callout,
    Cascade,
    DataList,
    Dialog,
    EmptyState,
    ErrorState,
    FormSection,
    FormSkeleton,
    QuantityInput,
    Select,
    Stack,
    Text,
    TextInputField,
    useToast,
} from '@healthy360/design-system';
import type { DataListColumn, SelectOption } from '@healthy360/design-system';
import { PurchaseOrderId, StockItemId } from '@healthy360/domain-types';
import { useFormatter } from '@healthy360/i18n';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { Gate } from '../../../access/gate.tsx';
import { toFailure } from '../../../data/hooks.ts';
import {
    useCancelPurchaseOrderMutation,
    useIssuePurchaseOrderMutation,
    usePurchaseOrderQuery,
    useStockItemsQuery,
    useUpdatePurchaseOrderMutation,
} from '../../../data/kitchen-ops-hooks.ts';
import { INVENTORY_ORDER_SUPPLIES_PERMISSION } from '../entity-registry.ts';
import { useKitchenTrailLeaf } from '../kitchen-ops-shell.tsx';
import {
    canCancelPurchaseOrder,
    canPrintPurchaseOrder,
    canReceivePurchaseOrder,
    canEditPurchaseOrderLines,
    canIssuePurchaseOrder,
    purchaseOrderLineTestId,
    purchaseOrderStatusKey,
    purchaseOrderStatusTone,
} from '../ops-format.ts';
import { EditorGuardDialogs, RecordFormOpening } from '../record-form-opening.tsx';
import { RecordSummaryAside } from '../record-summary-aside.tsx';
import { SideRailLayout } from '../side-rail-layout.tsx';
import { readQuantity } from '../supply-order-model.ts';
import { useUnsavedGuard } from '../use-unsaved-guard.ts';

/**
 * `/kitchen/supply-orders/{order}` — one purchase order (SUP4).
 *
 * Laid out as the builder it is opened from: the record-form opening with every action in it, the
 * cards down the page, and beside them a sticky summary that states the order and repeats none of
 * the opening's buttons.
 *
 * ```
 * PO-0012  DRAFT  ⚠ Unsaved      [ Back to orders ] [ Preview ] [ Cancel order ] [ Save ] [ Issue ]
 * Beqaa Fresh · Beirut · made 3 Oct 2026
 * ┌ LINES  3 lines ───────────────────────────────┐  ┌ THIS ORDER ──────────────┐
 * │ Item           Their reference  Quantity   ⋯   │  │ Supplier     Beqaa Fresh │
 * │ Tahini         TH-20           [ 20 ] kg Remove│  │ Branch            Beirut │
 * │ [ Add an item… ]                               │  │ Made on       3 Oct 2026 │
 * └───────────────────────────────────────────────┘  │ Lines                  3 │
 * ┌ NOTES ────────────────────────────────────────┐  │ ──────────────────────── │
 * └───────────────────────────────────────────────┘  │ Deliveries               │
 *                                                     │ Nothing received yet     │
 *                                                     └──────────────────────────┘
 * ```
 *
 * ## Three screens wearing one layout
 *
 * A draft is a form: quantities are editable, lines come and go, the note is typed, and Issue sits
 * in the opening. An issued order is a document: the same table, read-only, under
 * a notice explaining that it is frozen and that cancelling is still possible. A cancelled order is
 * a record: read-only, under a quieter notice, with nothing left to press.
 *
 * Which of the three is decided by the closed capability records in `ops-format.ts` rather than by
 * `status === 'draft'` tests scattered through the JSX. That matters for more than tidiness: those
 * records are closed over **all five** statuses including the two the receiving slice will start
 * producing, so this screen already knows that a partially-received order may not be edited, may not
 * be issued and may not be cancelled — §3.5's rule that an order with deliveries against it is never
 * cancelled as though nothing happened.
 *
 * ## The supplier's name reads two different sources, and the switch is the point
 *
 * A **draft** names the live supplier record, because the order is still being addressed and the
 * person may still change their mind. An **issued** order names `recipientSnapshot` — the supplier
 * exactly as it stood when the document was frozen. §3.5: draft previews use current supplier data,
 * issued reprints use the snapshot. A supplier renamed in March must not silently rewrite the
 * February order they are holding a copy of. The snapshot's address and contacts are the print
 * sheet's to show; this screen names the supplier in the opening and the summary, once each.
 *
 * The live reference stays available on an issued order for one thing only: its archive flag, which
 * is why a screen can explain that the supplier has since left the book.
 *
 * ## Issue and print is one action, and the order of the two halves matters
 *
 * §7's final shape is **Issue and print**, and SUP7 completes it: the confirmation freezes the
 * order and *then* opens the print route. That sequence is the whole point — the sheet a supplier
 * receives must be the one built from `recipientSnapshot`, which does not exist until the moment
 * the order is issued. Printing first and issuing after would put a Draft-marked preview in
 * somebody's hand and leave the real document unprinted.
 *
 * A draft also gets a quiet **Preview** beside it, and a non-draft order gets **Print**. They are
 * one control with two labels rather than two controls: the destination is identical, and the only
 * thing that differs is what the sheet will say about itself. A cancelled order gets neither —
 * `canPrintPurchaseOrder` refuses it, because the sheet's purpose is to be handed over and handing
 * over an order that was called off is how an unordered delivery arrives.
 *
 * ## Quantities are text fields, and lines are replaced whole
 *
 * `QuantityInput` — a decimal text box — rather than `NumberStepper`, for the reason the
 * builder gives: the stepper's clamp-to-step destroys 0.125. Save sends the **whole** line set,
 * because the endpoint is a replace — the body states what the order should be, and the server
 * re-snapshots every line from the database on the way in.
 */

export interface SupplyOrderDetailScreenProps {
    /** The route parameter. Anything that is not an identifier lands on the not-found state. */
    readonly order?: string | undefined;
}

export function SupplyOrderDetailScreen({ order }: SupplyOrderDetailScreenProps) {
    return (
        <Gate
            area="kitchen"
            requirement={{ allOf: [INVENTORY_ORDER_SUPPLIES_PERMISSION] }}
            testID="kitchen-supply-order-detail"
        >
            <SupplyOrderDetail order={order} />
        </Gate>
    );
}

const EM_DASH = '—';

/** One editable line in the draft form. `quantity` is the person's text, never a number. */
interface LineDraft {
    readonly stockItemId: string;
    readonly quantity: string;
    readonly itemCode: string;
    readonly itemNameEn: string;
    readonly unitCode: string;
    readonly supplierItemRef: string | null;
    /**
     * What has arrived and what is still to come (SUP5), both read from the server and never
     * recomputed here. A screen that worked out "ordered minus received" for itself would be a
     * second answer to a question the receiving guard has already answered, and the two would
     * disagree the first time a delivery was quoted per kilogram against a shelf counted in grams.
     */
    readonly receivedQuantity: string;
    readonly outstandingQuantity: string;
}

function lineDraft(line: PurchaseOrderLine): LineDraft {
    return {
        stockItemId: String(line.stockItemId),
        quantity: line.quantity,
        itemCode: line.itemCode,
        itemNameEn: line.itemNameEn,
        unitCode: line.unitCode,
        supplierItemRef: line.supplierItemRef,
        receivedQuantity: line.receivedQuantity,
        outstandingQuantity: line.outstandingQuantity,
    };
}

function SupplyOrderDetail({ order }: SupplyOrderDetailScreenProps) {
    const { t } = useTranslation();
    const formatter = useFormatter();
    const router = useRouter();
    const toast = useToast();

    const parsed = order === undefined ? null : PurchaseOrderId.safeParse(order);

    const record = usePurchaseOrderQuery(parsed);
    const update = useUpdatePurchaseOrderMutation();
    const issue = useIssuePurchaseOrderMutation();
    const cancel = useCancelPurchaseOrderMutation();

    const guard = useUnsavedGuard({ message: t('kitchen:unsaved.browserPrompt') });

    const [lines, setLines] = useState<readonly LineDraft[]>([]);
    const [notes, setNotes] = useState('');
    const [seededKey, setSeededKey] = useState<string | null>(null);
    const [dirty, setDirty] = useState(false);
    const [confirmingIssue, setConfirmingIssue] = useState(false);
    const [confirmingCancel, setConfirmingCancel] = useState(false);

    const data = record.data;

    useKitchenTrailLeaf(
        data === undefined
            ? null
            : t('kitchen:ops.supplyOrders.detailTitle', { number: data.number }),
    );

    /**
     * Reseed when the server hands back a different version of the order.
     *
     * No lock version to key on, so the identifier plus the two stamps is what changes when the
     * order moves — enough to reseed after an issue or a cancel without stamping over an edit in
     * progress. Adjusted during render rather than in an effect, which is React's own answer to
     * "derive from new props": an effect would paint one frame with the previous values in the form.
     */
    const serverKey =
        data === undefined
            ? null
            : `${String(data.id)}:${data.status}:${data.issuedAt ?? ''}:${data.cancelledAt ?? ''}`;

    if (data !== undefined && serverKey !== seededKey && !dirty) {
        setSeededKey(serverKey);
        setLines(data.lines.map(lineDraft));
        setNotes(data.notes ?? '');
    }

    const status = data?.status ?? 'draft';
    const editable = data !== undefined && canEditPurchaseOrderLines(status);
    const issuable = data !== undefined && canIssuePurchaseOrder(status);
    const cancellable = data !== undefined && canCancelPurchaseOrder(status);
    // SUP7: four of the five statuses have a document worth printing; a draft's is a preview.
    const printable = data !== undefined && canPrintPurchaseOrder(status);
    // SUP5: the two states a van can arrive against, read from the same closed record the server's
    // own machine is mirrored by, so the action never appears on a row the service would refuse.
    const receivable = data !== undefined && canReceivePurchaseOrder(status);

    // Only a draft can gain a line, so the shelf list is only fetched for one.
    const stockItems = useStockItemsQuery(editable);

    const present = new Set(lines.map((line) => line.stockItemId));
    const addOptions: readonly SelectOption[] = (stockItems.data ?? [])
        // Server ranking preserved — stocked first, then ever-moved, then by name (INV2.0). Nothing
        // re-sorts it: the ranking is what makes a two-hundred-row list usable.
        .filter((item: StockItem) => !present.has(String(item.id)))
        .map((item: StockItem) => ({
            value: String(item.id),
            // Named without the catalogue code, as the rows are; the type-ahead matches on the name.
            label: item.nameEn,
            description: item.unitCode,
        }));

    function edit(next: readonly LineDraft[], nextNotes = notes): void {
        setLines(next);
        setNotes(nextNotes);
        setDirty(true);
        guard.markDirty();
    }

    /**
     * A blank box is an **error** here, unlike in the builder.
     *
     * There, an empty quantity means "leave this shelf out" and the row is excluded quietly — the
     * screen opens with forty of them and painting them all red would make it unusable. Here every
     * row is already on an order somebody chose to put it on, so a blank is a line with no quantity
     * rather than a row nobody wants: the answer is to remove it, and the box says so.
     */
    const readings = lines.map((line) => readQuantity(line.quantity));
    const invalid = readings.some((reading) => reading.value === null);
    const empty = lines.length === 0;

    function save(): void {
        if (parsed === null || !editable || invalid || empty) return;

        update.mutate(
            {
                purchaseOrderId: parsed,
                request: {
                    notes: notes.trim() === '' ? null : notes.trim(),
                    // The whole set, because the endpoint is a replace: the body states what the
                    // order should be rather than how it differs from what is stored.
                    lines: lines.map((line, index) => ({
                        stockItemId: StockItemId.unsafe(line.stockItemId),
                        quantity: readings[index]?.value ?? line.quantity,
                    })),
                },
            },
            {
                onSuccess: () => {
                    setDirty(false);
                    guard.markClean();
                    toast.show({
                        testID: 'kitchen-supply-order-detail-saved-toast',
                        tone: 'success',
                        message: t('kitchen:ops.supplyOrders.savedToast'),
                    });
                },
            },
        );
    }

    /** `/kitchen/supply-orders/print?orders=…` for this one order. */
    function openPrint(): void {
        if (parsed === null) return;
        router.push(
            `/kitchen/supply-orders/print?orders=${encodeURIComponent(String(parsed))}` as never,
        );
    }

    function confirmIssue(): void {
        if (parsed === null) return;

        issue.mutate(parsed, {
            onSuccess: () => {
                setConfirmingIssue(false);
                setDirty(false);
                guard.markClean();
                toast.show({
                    testID: 'kitchen-supply-order-issued-toast',
                    tone: 'success',
                    message: t('kitchen:ops.supplyOrders.issuedToast'),
                });
                /*
                 * §7's **Issue and print**, in that order. The navigation happens inside
                 * `onSuccess` so the sheet is only ever reached once the server has frozen the
                 * document — the print route re-reads the order, and reading it a moment early
                 * would render the draft preview of an order that is no longer a draft.
                 *
                 * The unsaved guard is cleared first: leaving a screen that still believes it is
                 * dirty is how a browser prompt lands on top of a successful action.
                 */
                openPrint();
            },
        });
    }

    function confirmCancel(): void {
        if (parsed === null) return;

        cancel.mutate(parsed, {
            onSuccess: () => {
                setConfirmingCancel(false);
                setDirty(false);
                guard.markClean();
                toast.show({
                    testID: 'kitchen-supply-order-cancelled-toast',
                    tone: 'success',
                    message: t('kitchen:ops.supplyOrders.cancelledToast'),
                });
            },
        });
    }

    function back(): void {
        router.push('/kitchen/supply-orders' as never);
    }

    /* ── the three states that are not the record ────────────────────────────────────────────── */

    const notFound = (
        <EmptyState
            testID="kitchen-supply-order-detail-not-found"
            title={t('kitchen:ops.supplyOrders.notFoundTitle')}
            body={t('kitchen:ops.supplyOrders.notFoundBody')}
            actions={
                <Button
                    testID="kitchen-supply-order-detail-not-found-back"
                    variant="secondary"
                    label={t('kitchen:ops.supplyOrders.backToOrders')}
                    onPress={back}
                />
            }
        />
    );

    if (parsed === null) {
        return (
            <Cascade space="md" testID="kitchen-supply-order-detail-screen">
                {notFound}
            </Cascade>
        );
    }

    if (record.isPending) {
        return (
            <FormSkeleton
                testID="kitchen-supply-order-detail-loading"
                heading={false}
                sections={3}
                fields={2}
            />
        );
    }

    const failure = toFailure(record.error);

    if (failure !== null || data === undefined) {
        return (
            <Cascade space="md" testID="kitchen-supply-order-detail-screen">
                {failure === null ? (
                    notFound
                ) : (
                    <ErrorState
                        testID="kitchen-supply-order-detail-error"
                        failure={failure}
                        onRetry={() => {
                            void record.refetch();
                        }}
                        retrying={record.isFetching}
                    />
                )}
            </Cascade>
        );
    }

    /* ── the record ──────────────────────────────────────────────────────────────────────────── */

    function removeLine(line: LineDraft): void {
        edit(lines.filter((row) => row.stockItemId !== line.stockItemId));
    }

    function goReceive(): void {
        if (data === undefined) return;
        router.push(
            `/kitchen/procurement/receive?order=${encodeURIComponent(String(data.id))}` as never,
        );
    }

    /*
     * Ordered / Received / Outstanding (§3.5), and only from `issued` onward. On a draft every
     * received figure is zero and every outstanding figure repeats the ordered one, so two columns
     * of noise would push the quantity box off a narrow screen to say nothing at all.
     */
    const receivingColumns: readonly DataListColumn<LineDraft>[] = editable
        ? []
        : [
              {
                  key: 'received',
                  label: t('kitchen:ops.supplyOrders.columnReceived'),
                  width: 104,
                  priority: 60,
                  render: (line) => (
                      <Text
                          variant="mono"
                          testID={`${purchaseOrderLineTestId(line.stockItemId)}-received`}
                          tone={Number(line.receivedQuantity) > 0 ? 'primary' : 'secondary'}
                      >
                          {`${formatter.formatNumber(Number(line.receivedQuantity))} ${line.unitCode}`}
                      </Text>
                  ),
              },
              {
                  key: 'outstanding',
                  label: t('kitchen:ops.supplyOrders.columnOutstanding'),
                  width: 104,
                  priority: 60,
                  render: (line) => (
                      <Text
                          variant="mono"
                          testID={`${purchaseOrderLineTestId(line.stockItemId)}-outstanding`}
                          tone={Number(line.outstandingQuantity) > 0 ? 'warning' : 'secondary'}
                      >
                          {`${formatter.formatNumber(Number(line.outstandingQuantity))} ${line.unitCode}`}
                      </Text>
                  ),
              },
          ];

    /*
     * Named, never coded — the builder's rule. The catalogue code is a slug of the name beside it,
     * so the row gives that track to the supplier's own reference, which is what the sheet prints.
     */
    const columns: readonly DataListColumn<LineDraft>[] = [
        {
            key: 'item',
            label: t('kitchen:ops.supplyOrders.columnItem'),
            width: 200,
            priority: 100,
            fill: true,
            render: (line) => (
                <Text
                    variant="strong"
                    numberOfLines={1}
                    testID={`${purchaseOrderLineTestId(line.stockItemId)}-name`}
                >
                    {line.itemNameEn}
                </Text>
            ),
        },
        {
            key: 'ref',
            label: t('kitchen:ops.supplyOrders.columnRef'),
            width: 120,
            priority: 50,
            render: (line) => (
                <Text
                    variant="mono"
                    numberOfLines={1}
                    tone={line.supplierItemRef === null ? 'secondary' : 'primary'}
                    testID={`${purchaseOrderLineTestId(line.stockItemId)}-ref`}
                >
                    {line.supplierItemRef ?? EM_DASH}
                </Text>
            ),
        },
        {
            key: 'quantity',
            label: t('kitchen:ops.supplyOrders.columnQuantity'),
            width: 140,
            priority: 95,
            render: (line) => {
                const testID = purchaseOrderLineTestId(line.stockItemId);

                if (!editable) {
                    return (
                        <Text variant="mono" testID={`${testID}-quantity`}>
                            {`${formatter.formatNumber(Number(line.quantity))} ${line.unitCode}`}
                        </Text>
                    );
                }

                const reading = readQuantity(line.quantity);

                return (
                    /*
                     * Padded off the row's edges. A DataList cell has no vertical padding — the
                     * density is a floor — so a 28px box in a 28px row sat on both hairlines and
                     * met the next row's box.
                     */
                    <View className="min-w-0 flex-1 py-tight">
                        <QuantityInput
                            testID={`${testID}-quantity`}
                            // The item's own name, never a shared "Order quantity": forty inputs
                            // with one accessible name is a form a screen-reader user cannot use,
                            // and the duplication is invisible by eye.
                            label={t('kitchen:ops.supplyOrders.quantityLabel', {
                                item: line.itemNameEn,
                            })}
                            labelHidden
                            size="sm"
                            unit={line.unitCode}
                            placeholder={t('kitchen:ops.supplyOrders.quantityPlaceholder')}
                            value={line.quantity}
                            error={
                                reading.value === null && reading.issue !== null
                                    ? t(`kitchen:ops.supplyOrders.quantityIssue.${reading.issue}`)
                                    : undefined
                            }
                            onChangeText={(next) => {
                                edit(
                                    lines.map((row) =>
                                        row.stockItemId === line.stockItemId
                                            ? { ...row, quantity: next }
                                            : row,
                                    ),
                                );
                            }}
                        />
                    </View>
                );
            },
        },
        ...receivingColumns,
        ...(editable
            ? [
                  {
                      key: 'remove',
                      label: t('kitchen:list.actionHeader'),
                      width: 96,
                      priority: 90,
                      grow: false,
                      align: 'end',
                      sortable: false,
                      filterable: false,
                      render: (line) => (
                          <Button
                              testID={`${purchaseOrderLineTestId(line.stockItemId)}-remove`}
                              size="sm"
                              variant="ghost"
                              label={t('kitchen:ops.supplyOrders.removeLine')}
                              onPress={() => {
                                  removeLine(line);
                              }}
                          />
                      ),
                  } satisfies DataListColumn<LineDraft>,
              ]
            : []),
    ];

    const title = t('kitchen:ops.supplyOrders.detailTitle', { number: data.number });
    /*
     * A draft names the live supplier — it is still being addressed. An issued order names the
     * snapshot (§3.5): a supplier renamed since must not rewrite the document they hold. The address
     * and contacts frozen with it are the print sheet's to show.
     */
    const supplierName = data.recipientSnapshot?.nameEn ?? data.supplier?.nameEn ?? EM_DASH;
    const branchName = data.branch?.name ?? EM_DASH;
    const madeOn =
        data.createdAt === null
            ? EM_DASH
            : formatter.formatDate(data.createdAt, { dateStyle: 'medium' });
    const lineCount = t('kitchen:ops.supplyOrders.receiptLineCount', { count: lines.length });
    const issueBlocked = dirty || invalid || empty;

    return (
        <Cascade space="md" testID="kitchen-supply-order-detail-screen">
            {/*
             * The opening the record forms share, as the builder draws it: the order and its status,
             * the way back first and the commit last. The commit lives here only — the summary
             * beside the cards states the order and does not repeat its buttons.
             */}
            <RecordFormOpening
                testID="kitchen-supply-order-detail-screen"
                title={title}
                dirty={guard.isDirty}
                badges={
                    <Badge
                        variant="label"
                        testID="kitchen-supply-order-detail-status"
                        tone={purchaseOrderStatusTone(data.status)}
                        label={t(purchaseOrderStatusKey(data.status))}
                    />
                }
                details={
                    <Text
                        variant="caption"
                        tone="secondary"
                        testID="kitchen-supply-order-detail-subtitle"
                    >
                        {t('kitchen:ops.supplyOrders.detailSubtitle', {
                            supplier: supplierName,
                            branch: branchName,
                            date: madeOn,
                        })}
                    </Text>
                }
                actions={
                    <>
                        <Button
                            testID="kitchen-supply-order-detail-screen-back"
                            variant="secondary"
                            label={t('kitchen:ops.supplyOrders.backToOrders')}
                            onPress={() => {
                                guard.intercept(back);
                            }}
                        />
                        {printable ? (
                            /*
                             * One control, two labels. A draft says **Preview** because what comes
                             * back is marked Draft and is not the document anybody hands over; an
                             * issued order says **Print** because it is.
                             */
                            <Button
                                testID="kitchen-supply-order-detail-print"
                                variant={issuable ? 'ghost' : 'secondary'}
                                label={
                                    issuable
                                        ? t('kitchen:ops.supplyOrders.print.preview')
                                        : t('kitchen:ops.supplyOrders.print.printOrder')
                                }
                                onPress={openPrint}
                            />
                        ) : null}
                        {cancellable ? (
                            <Button
                                testID="kitchen-supply-order-detail-cancel"
                                variant="danger"
                                label={t('kitchen:ops.supplyOrders.cancelOrder')}
                                onPress={() => {
                                    setConfirmingCancel(true);
                                }}
                            />
                        ) : null}
                        {receivable ? (
                            <Button
                                testID="kitchen-supply-order-detail-receive"
                                label={t('kitchen:ops.supplyOrders.receiveDelivery')}
                                onPress={goReceive}
                            />
                        ) : null}
                        {/*
                         * No save control at all on a frozen order — an editing affordance that
                         * always refuses is worse than none.
                         */}
                        {editable ? (
                            <Button
                                testID="kitchen-supply-order-detail-screen-save"
                                variant={issuable ? 'secondary' : 'primary'}
                                label={t('kitchen:ops.supplyOrders.saveLines')}
                                loading={update.isPending}
                                disabled={!dirty || invalid || empty || update.isPending}
                                onPress={save}
                            />
                        ) : null}
                        {issuable ? (
                            <Button
                                testID="kitchen-supply-order-detail-issue"
                                label={t('kitchen:ops.supplyOrders.issue')}
                                disabled={issueBlocked}
                                onPress={() => {
                                    setConfirmingIssue(true);
                                }}
                            />
                        ) : null}
                    </>
                }
            />

            {status === 'cancelled' ? (
                <Callout
                    testID="kitchen-supply-order-detail-cancelled-notice"
                    tone="info"
                    title={t('kitchen:ops.supplyOrders.cancelledNoticeTitle')}
                    body={t('kitchen:ops.supplyOrders.cancelledNoticeBody')}
                />
            ) : data.issuedAt !== null ? (
                /*
                 * "Issued", never "sent" (§2). Nothing left this system through any channel — the
                 * person printed the sheet and handed it over.
                 */
                <Callout
                    testID="kitchen-supply-order-detail-issued-notice"
                    tone="info"
                    title={t('kitchen:ops.supplyOrders.issuedNoticeTitle', {
                        date: formatter.formatDate(data.issuedAt, { dateStyle: 'medium' }),
                    })}
                    body={t('kitchen:ops.supplyOrders.issuedNoticeBody')}
                />
            ) : null}

            {data.closeShortReason === null ? null : (
                /*
                 * §3.5 allows a short delivery to be closed "with an explicit reason", and the
                 * reason is shown here rather than left in the audit log: seeing *that* it closed
                 * short but not *why* would be the worse half of the two.
                 */
                <Callout
                    testID="kitchen-supply-order-detail-close-short-notice"
                    tone="warning"
                    title={t('kitchen:ops.supplyOrders.closedShortTitle')}
                    body={data.closeShortReason}
                />
            )}

            {data.supplier?.archivedAt == null ? null : (
                <Callout
                    testID="kitchen-supply-order-detail-archived-notice"
                    tone="warning"
                    title={t('kitchen:ops.supplyOrders.supplierArchivedTitle')}
                    body={t('kitchen:ops.supplyOrders.supplierArchivedBody')}
                />
            )}

            {/* The form is the row's filler beside the fixed summary. */}
            <SideRailLayout
                bounded
                sticky
                testID="kitchen-supply-order-detail-editor"
                main={
                    <>
                        <FormSection
                            first
                            variant="card"
                            testID="kitchen-supply-order-detail-lines"
                            title={t('kitchen:ops.supplyOrders.linesTitle')}
                            aside={
                                <Text
                                    variant="caption"
                                    tone="secondary"
                                    testID="kitchen-supply-order-detail-line-count"
                                >
                                    {lineCount}
                                </Text>
                            }
                        >
                            <Stack space="sm">
                                <DataList<LineDraft>
                                    testID="kitchen-supply-order-detail-lines-table"
                                    label={t('kitchen:ops.supplyOrders.linesCaption')}
                                    columns={columns}
                                    rows={lines}
                                    rowKey={(line) => line.stockItemId}
                                    density="sm"
                                />

                                {empty && editable ? (
                                    <Text
                                        variant="caption"
                                        tone="warning"
                                        testID="kitchen-supply-order-detail-no-lines"
                                    >
                                        {t('kitchen:ops.supplyOrders.noLines')}
                                    </Text>
                                ) : null}

                                {/* Under the rows it joins, as the builder's "Add something else". */}
                                {editable ? (
                                    <View className="z-tooltip w-full max-w-field">
                                        <Select
                                            testID="kitchen-supply-order-detail-add-line"
                                            label={t('kitchen:ops.supplyOrders.addLineLabel')}
                                            labelHidden
                                            size="sm"
                                            options={addOptions}
                                            searchable
                                            value={null}
                                            placeholder={t(
                                                'kitchen:ops.supplyOrders.addLinePlaceholder',
                                            )}
                                            onChange={(value) => {
                                                const item = (stockItems.data ?? []).find(
                                                    (candidate: StockItem) =>
                                                        String(candidate.id) === value,
                                                );

                                                if (item === undefined) return;

                                                edit([
                                                    ...lines,
                                                    {
                                                        stockItemId: String(item.id),
                                                        // Blank, never zero. The person types what they
                                                        // want; a prefilled zero would read as a
                                                        // decision.
                                                        quantity: '',
                                                        itemCode: item.code,
                                                        itemNameEn: item.nameEn,
                                                        unitCode: item.unitCode,
                                                        // Resolved server-side from the saved supplier
                                                        // link on save — the client never invents one.
                                                        supplierItemRef: null,
                                                        // A line nobody has ordered yet has nothing
                                                        // against it, and the whole of it is to come.
                                                        receivedQuantity: '0',
                                                        outstandingQuantity: '',
                                                    },
                                                ]);
                                            }}
                                        />
                                    </View>
                                ) : null}
                            </Stack>
                        </FormSection>

                        <FormSection
                            first
                            variant="card"
                            testID="kitchen-supply-order-detail-notes"
                            title={t('kitchen:ops.supplyOrders.notesTitle')}
                        >
                            {editable ? (
                                <TextInputField
                                    testID="kitchen-supply-order-detail-notes-input"
                                    label={t('kitchen:ops.supplyOrders.notesLabel')}
                                    hint={t('kitchen:ops.supplyOrders.notesHint')}
                                    placeholder={t('kitchen:ops.supplyOrders.notesPlaceholder')}
                                    size="sm"
                                    multiline
                                    value={notes}
                                    onChangeText={(next) => {
                                        edit(lines, next);
                                    }}
                                />
                            ) : (
                                <Text
                                    tone={notes === '' ? 'secondary' : 'primary'}
                                    testID="kitchen-supply-order-detail-notes-text"
                                >
                                    {notes === '' ? t('kitchen:ops.supplyOrders.noNotes') : notes}
                                </Text>
                            )}
                        </FormSection>
                    </>
                }
                /*
                 * The order in a few facts, what has arrived against it, and the next thing to do
                 * with it. Deliveries are a list, not links: there is no receipt screen, and the
                 * money on them is behind a permission this screen does not check — the purchases
                 * ledger is where a cost holder reads it.
                 */
                rail={
                    <RecordSummaryAside
                        testID="kitchen-supply-order-detail-summary"
                        title={t('kitchen:ops.supplyOrders.detailSummaryTitle')}
                        rows={[
                            {
                                key: 'supplier',
                                label: t('kitchen:ops.supplyOrders.columnSupplier'),
                                value: supplierName,
                            },
                            {
                                key: 'branch',
                                label: t('kitchen:ops.supplyOrders.viewBranch'),
                                value: branchName,
                            },
                            {
                                key: 'made-on',
                                label: t('kitchen:ops.supplyOrders.columnMadeOn'),
                                value: madeOn,
                            },
                            ...(data.issuedAt === null
                                ? []
                                : [
                                      {
                                          key: 'issued-on',
                                          label: t('kitchen:ops.supplyOrders.summaryIssuedOn'),
                                          value: formatter.formatDate(data.issuedAt, {
                                              dateStyle: 'medium',
                                          }),
                                      },
                                  ]),
                        ]}
                        total={{
                            label: t('kitchen:ops.supplyOrders.summaryLineTotal'),
                            value: formatter.formatNumber(lines.length),
                        }}
                        list={{
                            title: t('kitchen:ops.supplyOrders.receiptsTitle'),
                            empty: t('kitchen:ops.supplyOrders.receiptsEmpty'),
                            testID: 'kitchen-supply-order-detail-receipts',
                            emptyTestID: 'kitchen-supply-order-detail-receipts-empty',
                            items: data.receipts.map((receipt) => ({
                                key: String(receipt.id),
                                testID: `kitchen-supply-order-detail-receipt-${String(receipt.id)}`,
                                name: `${
                                    receipt.receivedOn === null
                                        ? EM_DASH
                                        : formatter.formatDate(receipt.receivedOn, {
                                              dateStyle: 'medium',
                                          })
                                } · ${
                                    receipt.documentRef ??
                                    t('kitchen:ops.supplyOrders.receiptNoDocumentRef')
                                }`,
                                value: t('kitchen:ops.supplyOrders.receiptLineCount', {
                                    count: receipt.lineCount,
                                }),
                            })),
                        }}
                        note={
                            data.receipts.length === 0 ? null : (
                                <Text
                                    variant="caption"
                                    tone="secondary"
                                    testID="kitchen-supply-order-detail-receipts-note"
                                >
                                    {t('kitchen:ops.supplyOrders.receiptsNote')}
                                </Text>
                            )
                        }
                    />
                }
            />

            <EditorGuardDialogs guard={guard} testID="kitchen-supply-order-detail-screen" />

            <Dialog
                open={confirmingIssue}
                onClose={() => {
                    setConfirmingIssue(false);
                }}
                title={t('kitchen:ops.supplyOrders.issueConfirmTitle')}
                description={t('kitchen:ops.supplyOrders.issueConfirmBody')}
                testID="kitchen-supply-order-detail-issue-confirm"
                actions={
                    <>
                        <Button
                            testID="kitchen-supply-order-detail-issue-cancel"
                            variant="secondary"
                            label={t('kitchen:ops.supplyOrders.issueKeepEditing')}
                            onPress={() => {
                                setConfirmingIssue(false);
                            }}
                        />
                        <Button
                            testID="kitchen-supply-order-detail-issue-confirm-action"
                            label={t('kitchen:ops.supplyOrders.issueConfirm')}
                            loading={issue.isPending}
                            onPress={confirmIssue}
                        />
                    </>
                }
            />

            <Dialog
                open={confirmingCancel}
                onClose={() => {
                    setConfirmingCancel(false);
                }}
                title={t('kitchen:ops.supplyOrders.cancelConfirmTitle')}
                description={t('kitchen:ops.supplyOrders.cancelConfirmBody')}
                testID="kitchen-supply-order-detail-cancel-confirm"
                actions={
                    <>
                        <Button
                            testID="kitchen-supply-order-detail-cancel-keep"
                            variant="quiet"
                            label={t('kitchen:ops.supplyOrders.cancelKeep')}
                            onPress={() => {
                                setConfirmingCancel(false);
                            }}
                        />
                        <Button
                            testID="kitchen-supply-order-detail-cancel-confirm-action"
                            variant="danger"
                            label={t('kitchen:ops.supplyOrders.cancelConfirm')}
                            loading={cancel.isPending}
                            onPress={confirmCancel}
                        />
                    </>
                }
            />
        </Cascade>
    );
}
