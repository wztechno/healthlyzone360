import type { PurchaseOrder } from '@healthy360/api-client/contracts';
import type { BadgeTone, StatusStep } from '@healthy360/design-system';
import { StatusSteps } from '@healthy360/design-system';
import { useFormatter } from '@healthy360/i18n';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Text as RNText, View } from 'react-native';

import {
    RecordFigures,
    RecordSheetHead,
    SheetCard,
    SheetColumns,
    SheetFacts,
    SheetText,
} from './catalogue/record-sheet.tsx';
import { TileEmpty } from './catalogue/record-tiles.tsx';
import { unitCodeLabel } from './format.ts';
import { purchaseOrderStatusKey } from './ops-format.ts';

/**
 * A supply order that can no longer be edited, read as a record — the record sheet of `Record
 * pop-up — no canopy` (option A, 2026-11-17), which took the green band away. The draft stays the
 * builder it was; from `issued` on the lines are frozen and the page is a document.
 *
 * ```
 * Order PO-4F7K2Q                                                       [Back] [Print]
 * (Partly received)
 * Supplier · Branch · made …
 * ▬▬▬ Draft   ▬▬▬ Issued   ▬▬▬ Partly received   ─── Received
 * ┌ ITEMS ┬ IN FULL ┬ STILL TO COME ┬ DELIVERIES ┬ LEAD TIME ┐
 * ┌ Items on this order ─────────────────────────────────────┐
 * ┌ Still to come ──────────┐  ┌ Supplier ───────────────────┐
 * ┌ Deliveries ─────────────┐  ┌ Note for the supplier ──────┐
 * ```
 *
 * Only what a `PurchaseOrder` carries. It has no money at any depth, no "sent" (a person issues
 * and hands the sheet over) and no expected date, so none of those is drawn. "In full" and
 * "still to come" read the server's own `outstandingQuantity`, never ordered minus received.
 *
 * Deliveries are rows, not links: there is no receipt screen, and the money on a receipt is behind
 * a permission this page does not check.
 */

export interface SupplyOrderRecordLine {
    readonly stockItemId: string;
    readonly itemNameEn: string;
    readonly unitCode: string;
    readonly receivedQuantity: string;
    readonly outstandingQuantity: string;
}

export interface SupplyOrderRecordProps {
    readonly order: PurchaseOrder;
    readonly lines: readonly SupplyOrderRecordLine[];
    /** The order's lines table, built by the screen with its own columns. */
    readonly table: ReactNode;
    readonly title: string;
    /** "Supplier · Branch · made …". */
    readonly subtitle: string;
    readonly supplierName: string;
    readonly branchName: string;
    readonly statusTone: BadgeTone;
    readonly back: ReactNode;
    readonly actions: ReactNode;
}

export function SupplyOrderRecord({
    order,
    lines,
    table,
    title,
    subtitle,
    supplierName,
    branchName,
    statusTone,
    back,
    actions,
}: SupplyOrderRecordProps) {
    const { t } = useTranslation();
    const formatter = useFormatter();
    const dash = t('kitchen:list.noValue');
    const separator = t('kitchen:recordView.metaSeparator');

    const date = (value: string | null) =>
        value === null ? null : formatter.formatDate(value, { dateStyle: 'medium' });
    const quantity = (value: string) => formatter.formatNumber(Number(value));

    /* ── where it has got to ─────────────────────────────────────────────────────────────────── */

    const firstDelivery = order.receipts[0];
    const deliveriesAt =
        firstDelivery === undefined
            ? null
            : t('kitchen:ops.supplyOrders.view.stepDeliveries', {
                  date: date(firstDelivery.receivedOn) ?? dash,
                  count: order.receipts.length,
              });
    const receivedAt = date(order.receivedAt ?? order.closedAt);
    const closedShort = order.status === 'received' && order.closeShortReason !== null;
    const steps: StatusStep[] = [
        {
            key: 'draft',
            label: t(purchaseOrderStatusKey('draft')),
            at:
                order.createdAt === null
                    ? null
                    : t('kitchen:ops.supplyOrders.view.stepMade', { date: date(order.createdAt) }),
            state: 'done',
        },
        {
            key: 'issued',
            label: t(purchaseOrderStatusKey('issued')),
            at: date(order.issuedAt),
            state: order.issuedAt === null ? 'pending' : 'done',
        },
        ...(order.status === 'cancelled'
            ? [
                  {
                      key: 'cancelled',
                      label: t(purchaseOrderStatusKey('cancelled')),
                      at: date(order.cancelledAt),
                      state: 'done' as const,
                  },
              ]
            : [
                  {
                      key: 'partly',
                      label: t(purchaseOrderStatusKey('partially_received')),
                      at: deliveriesAt,
                      state:
                          order.receipts.length === 0
                              ? ('pending' as const)
                              : order.status === 'partially_received'
                                ? ('partial' as const)
                                : ('done' as const),
                  },
                  {
                      key: 'received',
                      label: t(purchaseOrderStatusKey('received')),
                      // Closed short reaches `received` with no `receivedAt`: the day it closed,
                      // and the step says it closed short in words as well as in amber.
                      at: closedShort
                          ? [
                                receivedAt ?? dash,
                                t('kitchen:ops.supplyOrders.view.stepClosedShort'),
                            ].join(separator)
                          : receivedAt,
                      state:
                          order.status !== 'received'
                              ? ('pending' as const)
                              : closedShort
                                ? ('partial' as const)
                                : ('done' as const),
                  },
              ]),
    ];

    /* ── received ────────────────────────────────────────────────────────────────────────────── */

    const inFull = lines.filter((line) => Number(line.outstandingQuantity) <= 0).length;
    const toCome = lines.filter((line) => Number(line.outstandingQuantity) > 0);
    const closed = order.closedAt !== null;

    /* ── supplier ────────────────────────────────────────────────────────────────────────────── */

    const snapshot = order.recipientSnapshot;
    const primary =
        snapshot?.contacts.find((contact) => contact.isPrimary) ?? snapshot?.contacts[0];
    const contactPhone =
        primary === undefined
            ? null
            : primary.whatsappPhone !== null
              ? t('kitchen:ops.supplyOrders.print.phoneWhatsapp', { phone: primary.whatsappPhone })
              : primary.phone;
    const office = [snapshot?.contactPhone ?? null, snapshot?.contactEmail ?? null].filter(
        (part): part is string => part !== null && part !== '',
    );
    const supplierLine = [snapshot?.code ?? null, snapshot?.address ?? null].filter(
        (part): part is string => part !== null && part !== '',
    );
    const leadTimeDays = snapshot?.leadTimeDays ?? null;
    const noteEmpty = order.notes === null || order.notes === '';

    /* ── the cards ───────────────────────────────────────────────────────────────────────────── */

    const toComeCard = (
        <SheetCard
            testID="kitchen-supply-order-detail-received"
            title={t('kitchen:ops.supplyOrders.columnOutstanding')}
        >
            {order.status === 'cancelled' ? (
                <SheetText text={t('kitchen:ops.supplyOrders.cancelledNoticeTitle')} empty />
            ) : closed && toCome.length > 0 ? (
                <RNText className="text-base font-semibold text-warning-strong text-start">
                    {t('kitchen:ops.supplyOrders.closedShortTitle')}
                </RNText>
            ) : toCome.length === 0 ? (
                <SheetText text={t('kitchen:ops.supplyOrders.view.nothingToCome')} empty />
            ) : (
                <SheetFacts
                    testID="kitchen-supply-order-detail-to-come"
                    facts={toCome.map((line) => ({
                        key: line.stockItemId,
                        label: line.itemNameEn,
                        value: `${quantity(line.outstandingQuantity)} ${unitCodeLabel(line.unitCode, t)}`,
                    }))}
                />
            )}
        </SheetCard>
    );

    const deliveriesCard = (
        <SheetCard
            testID="kitchen-supply-order-detail-deliveries"
            title={t('kitchen:ops.supplyOrders.receiptsTitle')}
        >
            {order.receipts.length === 0 ? (
                <TileEmpty
                    testID="kitchen-supply-order-detail-receipts-empty"
                    text={t('kitchen:ops.supplyOrders.receiptsEmpty')}
                />
            ) : (
                <SheetFacts
                    testID="kitchen-supply-order-detail-receipts"
                    facts={order.receipts.map((receipt) => ({
                        key: String(receipt.id),
                        label: date(receipt.receivedOn) ?? dash,
                        value: [
                            receipt.documentRef ??
                                t('kitchen:ops.supplyOrders.receiptNoDocumentRef'),
                            t('kitchen:ops.supplyOrders.receiptLineCount', {
                                count: receipt.lineCount,
                            }),
                        ].join(separator),
                    }))}
                />
            )}
        </SheetCard>
    );

    const supplierCard = (
        <SheetCard
            testID="kitchen-supply-order-detail-supplier"
            title={t('kitchen:ops.supplyOrders.columnSupplier')}
            trailing={
                snapshot === null ? undefined : (
                    <RNText className="text-xs text-content-secondary">
                        {t('kitchen:ops.supplyOrders.view.asIssued')}
                    </RNText>
                )
            }
        >
            <View className="flex-col">
                <RNText
                    testID="kitchen-supply-order-detail-summary-supplier"
                    className="text-base font-semibold text-content-primary text-start"
                >
                    {supplierName}
                </RNText>
                {supplierLine.length === 0 ? null : (
                    <RNText className="text-sm text-content-secondary text-start">
                        {supplierLine.join(separator)}
                    </RNText>
                )}
            </View>
            <SheetFacts
                testID="kitchen-supply-order-detail-supplier-facts"
                facts={[
                    {
                        key: 'branch',
                        label: t('kitchen:ops.supplyOrders.viewBranch'),
                        value: branchName,
                    },
                    ...(snapshot === null
                        ? []
                        : [
                              {
                                  key: 'terms',
                                  label: t('kitchen:ops.supplyOrders.print.paymentTerms'),
                                  value: snapshot.paymentTerms ?? dash,
                                  empty: snapshot.paymentTerms === null,
                              },
                              {
                                  key: 'office',
                                  label: t('kitchen:ops.supplyOrders.print.generalContact'),
                                  value: office.length === 0 ? dash : office.join(separator),
                                  empty: office.length === 0,
                              },
                              {
                                  key: 'contact',
                                  label: t('kitchen:ops.supplyOrders.view.contact'),
                                  value:
                                      primary === undefined
                                          ? dash
                                          : [primary.name, contactPhone]
                                                .filter(
                                                    (part): part is string =>
                                                        part !== null && part !== '',
                                                )
                                                .join(separator),
                                  empty: primary === undefined,
                              },
                          ]),
                ]}
            />
        </SheetCard>
    );

    return (
        <View className="z-auto flex-col gap-4">
            <RecordSheetHead
                testID="kitchen-supply-order-detail-head"
                title={title}
                chips={[
                    {
                        key: 'status',
                        label: t(purchaseOrderStatusKey(order.status)),
                        tone: statusTone,
                    },
                ]}
                lines={[{ text: subtitle, testID: 'kitchen-supply-order-detail-subtitle' }]}
                actions={
                    <>
                        {back}
                        {actions}
                    </>
                }
            />

            <StatusSteps
                testID="kitchen-supply-order-detail-history"
                label={t('kitchen:ops.supplyOrders.view.historyLabel')}
                noValue={dash}
                steps={steps.map((step) => ({
                    ...step,
                    testID: `kitchen-supply-order-detail-history-${step.key}`,
                }))}
            />

            <RecordFigures
                testID="kitchen-supply-order-detail-figures"
                figures={[
                    {
                        key: 'lines',
                        label: t('kitchen:ops.supplyOrders.linesTitle'),
                        value: formatter.formatNumber(lines.length),
                        valueTestID: 'kitchen-supply-order-detail-line-count',
                    },
                    {
                        key: 'in-full',
                        label: t('kitchen:ops.supplyOrders.view.ringLabel'),
                        value: formatter.formatNumber(inFull),
                        note: t('kitchen:recordSheet.ofTotal', {
                            total: formatter.formatNumber(lines.length),
                        }),
                        valueTestID: 'kitchen-supply-order-detail-received-ring',
                    },
                    {
                        key: 'to-come',
                        label: t('kitchen:ops.supplyOrders.columnOutstanding'),
                        value: formatter.formatNumber(toCome.length),
                        ...(toCome.length > 0 && !closed && order.status !== 'cancelled'
                            ? { tone: 'warning' as const }
                            : {}),
                    },
                    {
                        key: 'deliveries',
                        label: t('kitchen:ops.supplyOrders.receiptsTitle'),
                        value: formatter.formatNumber(order.receipts.length),
                    },
                    {
                        key: 'lead-time',
                        label: t('kitchen:ops.supplyOrders.view.leadTime'),
                        value:
                            leadTimeDays === null
                                ? dash
                                : t('kitchen:calendar.dayCount', { count: leadTimeDays }),
                        ...(leadTimeDays === null ? { tone: 'muted' as const } : {}),
                    },
                ]}
            />

            <SheetColumns
                testID="kitchen-supply-order-detail-tiles"
                top={
                    <SheetCard
                        testID="kitchen-supply-order-detail-lines"
                        title={t('kitchen:ops.supplyOrders.linesTitle')}
                    >
                        {table}
                    </SheetCard>
                }
                start={
                    <>
                        {toComeCard}
                        {deliveriesCard}
                    </>
                }
                end={
                    <>
                        {supplierCard}
                        <SheetCard
                            testID="kitchen-supply-order-detail-notes"
                            title={t('kitchen:ops.supplyOrders.notesTitle')}
                        >
                            <SheetText
                                testID="kitchen-supply-order-detail-notes-text"
                                text={
                                    noteEmpty
                                        ? t('kitchen:ops.supplyOrders.noNotes')
                                        : (order.notes ?? '')
                                }
                                empty={noteEmpty}
                            />
                        </SheetCard>
                    </>
                }
            />
        </View>
    );
}
