import type { PurchaseOrder } from '@healthy360/api-client/contracts';
import { Badge, Text } from '@healthy360/design-system';
import type { BadgeTone } from '@healthy360/design-system';
import { useFormatter } from '@healthy360/i18n';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { RecordCanopyHero } from './catalogue/record-canopy.tsx';
import type { RecordCanopyStep, RecordCanopyTone } from './catalogue/record-canopy.tsx';
import { useRecordSplit } from './catalogue/record-popup.tsx';
import { RecordTile, TileEmpty } from './catalogue/record-tiles.tsx';
import { BoardFieldRows } from './catalogue/record-view-page.tsx';
import { RECORD_RAIL_MIN } from './desk-layout.ts';
import { unitCodeLabel } from './format.ts';
import { purchaseOrderStatusKey } from './ops-format.ts';

/**
 * A supply order that can no longer be edited, read as a record (the `Kitchen-ops-po-record`
 * board). The draft stays the builder it was; from `issued` on the lines are frozen and the page is
 * a document, so it opens on the canopy instead of a form's opening.
 *
 * ```
 * ┌ canopy: Supplier · Branch · made … / Order PO-4F7K2Q / (Partly received)  [Back] [Print] ┐
 * ┌ Where the order has got to ────────────┐  ┌ Received ───────────┐
 * ┌ Items on this order ───────────────────┐  ┌ Deliveries ─────────┐
 *                                             ┌ Supplier ───────────┐
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

function canopyTone(tone: BadgeTone): RecordCanopyTone {
    if (tone === 'success' || tone === 'brand') return 'success';
    if (tone === 'warning' || tone === 'danger') return tone;
    return 'neutral';
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
    const split = useRecordSplit();

    /* ── where it has got to ─────────────────────────────────────────────────────────────────── */

    const firstDelivery = order.receipts[0];
    const deliveriesAt =
        firstDelivery === undefined
            ? null
            : t('kitchen:ops.supplyOrders.view.stepDeliveries', {
                  date: date(firstDelivery.receivedOn) ?? dash,
                  count: order.receipts.length,
              });
    const steps: RecordCanopyStep[] = [
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
                      // Closed short reaches `received` with no `receivedAt`: the day it closed.
                      at: date(order.receivedAt ?? order.closedAt),
                      state:
                          order.status !== 'received'
                              ? ('pending' as const)
                              : order.closeShortReason === null
                                ? ('done' as const)
                                : ('partial' as const),
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

    return (
        <View className="z-auto flex-col gap-base">
            <RecordCanopyHero
                testID="kitchen-supply-order-detail-canopy"
                kind={subtitle}
                kindTestID="kitchen-supply-order-detail-subtitle"
                title={title}
                statusChip={{
                    label: t(purchaseOrderStatusKey(order.status)),
                    tone: canopyTone(statusTone),
                }}
                actions={
                    <>
                        {back}
                        {actions}
                    </>
                }
            />

            <View
                testID="kitchen-supply-order-detail-tiles"
                className={
                    split ? 'z-auto flex-row items-start gap-base' : 'z-auto flex-col gap-base'
                }
            >
                <View
                    className="z-auto min-w-0 flex-col gap-base"
                    style={split ? { flex: 21 } : undefined}
                >
                    <RecordTile
                        testID="kitchen-supply-order-detail-history"
                        title={t('kitchen:ops.supplyOrders.view.historyLabel')}
                    >
                        <View className="flex-col">
                            {steps.map((step) => (
                                <View
                                    key={step.key}
                                    testID={`kitchen-supply-order-detail-history-${step.key}`}
                                    className="min-h-8 flex-row items-center justify-between gap-snug"
                                >
                                    <Text tone="secondary">{step.label}</Text>
                                    <View className="min-w-0 shrink flex-row items-center gap-tight">
                                        <Text
                                            variant={step.at === null ? 'body' : 'strong'}
                                            tone={step.at === null ? 'secondary' : 'primary'}
                                            className="tabular-nums"
                                        >
                                            {step.at ?? dash}
                                        </Text>
                                        {step.state === 'pending' ? null : (
                                            <Badge
                                                icon={null}
                                                tone={
                                                    step.key === 'cancelled'
                                                        ? 'neutral'
                                                        : step.state === 'done'
                                                          ? 'success'
                                                          : 'warning'
                                                }
                                                label={t(
                                                    step.state === 'done'
                                                        ? 'kitchen:ops.supplyOrders.view.stepDone'
                                                        : step.key === 'received'
                                                          ? 'kitchen:ops.supplyOrders.view.stepClosedShort'
                                                          : 'kitchen:ops.supplyOrders.view.stepPartial',
                                                )}
                                            />
                                        )}
                                    </View>
                                </View>
                            ))}
                        </View>
                    </RecordTile>

                    <RecordTile
                        testID="kitchen-supply-order-detail-lines"
                        title={t('kitchen:ops.supplyOrders.linesTitle')}
                        aside={
                            <Text tone="secondary" testID="kitchen-supply-order-detail-line-count">
                                {t('kitchen:ops.supplyOrders.receiptLineCount', {
                                    count: lines.length,
                                })}
                            </Text>
                        }
                    >
                        {table}
                    </RecordTile>
                </View>

                <View
                    className="z-auto min-w-0 flex-col gap-base"
                    style={split ? { flex: 10, minWidth: RECORD_RAIL_MIN } : undefined}
                >
                    <RecordTile
                        testID="kitchen-supply-order-detail-received"
                        title={t('kitchen:ops.supplyOrders.columnReceived')}
                    >
                        <View className="min-h-8 flex-row items-center justify-between gap-snug">
                            <Text tone="secondary">
                                {t('kitchen:ops.supplyOrders.view.ringLabel')}
                            </Text>
                            <Text
                                variant="strong"
                                className="tabular-nums"
                                testID="kitchen-supply-order-detail-received-ring"
                            >
                                {t('kitchen:ops.supplyOrders.view.inFull', {
                                    count: inFull,
                                    total: lines.length,
                                })}
                            </Text>
                        </View>
                        {order.status === 'cancelled' ? (
                            <Text variant="caption" tone="secondary">
                                {t('kitchen:ops.supplyOrders.cancelledNoticeTitle')}
                            </Text>
                        ) : closed && toCome.length > 0 ? (
                            <Text variant="caption" tone="warning">
                                {t('kitchen:ops.supplyOrders.closedShortTitle')}
                            </Text>
                        ) : (
                            <View className="flex-col">
                                <Text variant="caption" tone="secondary">
                                    {t('kitchen:ops.supplyOrders.columnOutstanding')}
                                </Text>
                                {toCome.length === 0 ? (
                                    <Text variant="caption" tone="secondary">
                                        {t('kitchen:ops.supplyOrders.view.nothingToCome')}
                                    </Text>
                                ) : (
                                    toCome.map((line) => (
                                        <Text
                                            key={line.stockItemId}
                                            testID={`kitchen-supply-order-detail-to-come-${line.stockItemId}`}
                                            variant="caption"
                                            tone={
                                                Number(line.receivedQuantity) > 0
                                                    ? 'warning'
                                                    : 'primary'
                                            }
                                            numberOfLines={1}
                                        >
                                            {t('kitchen:ops.supplyOrders.view.toComeLine', {
                                                quantity: quantity(line.outstandingQuantity),
                                                unit: unitCodeLabel(line.unitCode, t),
                                                item: line.itemNameEn,
                                            })}
                                        </Text>
                                    ))
                                )}
                            </View>
                        )}
                    </RecordTile>

                    <RecordTile
                        testID="kitchen-supply-order-detail-deliveries"
                        title={t('kitchen:ops.supplyOrders.receiptsTitle')}
                        aside={
                            <Text tone="secondary">
                                {formatter.formatNumber(order.receipts.length)}
                            </Text>
                        }
                    >
                        {order.receipts.length === 0 ? (
                            <TileEmpty
                                testID="kitchen-supply-order-detail-receipts-empty"
                                text={t('kitchen:ops.supplyOrders.receiptsEmpty')}
                            />
                        ) : (
                            <View
                                testID="kitchen-supply-order-detail-receipts"
                                role="list"
                                className="flex-col"
                            >
                                {order.receipts.map((receipt) => (
                                    <View
                                        key={String(receipt.id)}
                                        testID={`kitchen-supply-order-detail-receipt-${String(receipt.id)}`}
                                        role="listitem"
                                        className="min-h-8 flex-row items-center justify-between gap-snug"
                                    >
                                        <Text tone="secondary" className="tabular-nums">
                                            {date(receipt.receivedOn) ?? dash}
                                        </Text>
                                        <Text
                                            variant="strong"
                                            numberOfLines={1}
                                            className="min-w-0 shrink tabular-nums"
                                        >
                                            {[
                                                receipt.documentRef ??
                                                    t(
                                                        'kitchen:ops.supplyOrders.receiptNoDocumentRef',
                                                    ),
                                                t('kitchen:ops.supplyOrders.receiptLineCount', {
                                                    count: receipt.lineCount,
                                                }),
                                            ].join(separator)}
                                        </Text>
                                    </View>
                                ))}
                            </View>
                        )}
                    </RecordTile>

                    <RecordTile
                        testID="kitchen-supply-order-detail-supplier"
                        title={t('kitchen:ops.supplyOrders.columnSupplier')}
                    >
                        <Text variant="caption" tone="secondary">
                            {snapshot === null
                                ? null
                                : `${t('kitchen:ops.supplyOrders.view.asIssued')}${separator}`}
                            <Text
                                variant="caption"
                                tone="secondary"
                                testID="kitchen-supply-order-detail-summary-supplier"
                            >
                                {supplierName}
                            </Text>
                            {[snapshot?.code ?? null, snapshot?.address ?? null]
                                .filter((part): part is string => part !== null && part !== '')
                                .map((part) => `${separator}${part}`)
                                .join('')}
                        </Text>
                        <BoardFieldRows
                            stacked
                            testID="kitchen-supply-order-detail-supplier-facts"
                            fields={[
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
                                              label: t(
                                                  'kitchen:ops.supplyOrders.print.paymentTerms',
                                              ),
                                              value: snapshot.paymentTerms ?? dash,
                                          },
                                          {
                                              key: 'lead-time',
                                              label: t('kitchen:ops.supplyOrders.view.leadTime'),
                                              value:
                                                  snapshot.leadTimeDays === null
                                                      ? dash
                                                      : t('kitchen:calendar.dayCount', {
                                                            count: snapshot.leadTimeDays,
                                                        }),
                                          },
                                          {
                                              key: 'office',
                                              label: t(
                                                  'kitchen:ops.supplyOrders.print.generalContact',
                                              ),
                                              value:
                                                  office.length === 0
                                                      ? dash
                                                      : office.join(separator),
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
                                          },
                                      ]),
                            ]}
                        />
                        <Text
                            variant="caption"
                            tone="secondary"
                            testID="kitchen-supply-order-detail-notes-text"
                        >
                            {`${t('kitchen:ops.supplyOrders.notesTitle')}: ${
                                order.notes === null || order.notes === ''
                                    ? t('kitchen:ops.supplyOrders.noNotes')
                                    : order.notes
                            }`}
                        </Text>
                    </RecordTile>
                </View>
            </View>
        </View>
    );
}
