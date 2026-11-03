import type { PurchaseOrder } from '@healthy360/api-client/contracts';
import { Icon, ProgressRing, Text } from '@healthy360/design-system';
import type { BadgeTone } from '@healthy360/design-system';
import { useFormatter } from '@healthy360/i18n';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { RecordCanopy, RecordCanopyGlyph } from './catalogue/record-canopy.tsx';
import type { RecordCanopyStep, RecordCanopyTone } from './catalogue/record-canopy.tsx';
import { RecordTile, RecordTileRow, TileEmpty, TileFacts } from './catalogue/record-tiles.tsx';
import { purchaseOrderStatusKey } from './ops-format.ts';

/**
 * A supply order that can no longer be edited, read as a record — option C of the
 * `Minimal view page` canvas. The draft stays the builder it was; from `issued` on the lines are
 * frozen and the page is a document, so it opens on the canopy instead of a form's opening.
 *
 * ```
 * ┌ canopy: Order PO-4F7K2Q ◐ Partly received        [Back] [Print] [Receive delivery] ┐
 * │ ● Draft ─── ● Issued ─── ◐ Partly received ─── ○ Received                           │
 * └──────────────────────────────────────────────────────────────────────────────────────┘
 * ┌ Received ────────┐ ┌ Deliveries ──────┐ ┌ Supplier ───────────────────────────────┐
 * ┌ Items on this order ─────────────────────────────────────────────────────────────────┐
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
        <>
            <RecordCanopy
                testID="kitchen-supply-order-detail-canopy"
                title={title}
                status={{
                    label: t(purchaseOrderStatusKey(order.status)),
                    tone: canopyTone(statusTone),
                }}
                captions={[{ text: subtitle, testID: 'kitchen-supply-order-detail-subtitle' }]}
                media={
                    <RecordCanopyGlyph>
                        <Icon name="clipboardList" className="text-content-on-canopy" />
                    </RecordCanopyGlyph>
                }
                back={back}
                actions={actions}
                steps={steps}
                stepsLabel={t('kitchen:ops.supplyOrders.view.historyLabel')}
                noValue={dash}
            />

            <RecordTileRow testID="kitchen-supply-order-detail-tiles">
                <RecordTile
                    testID="kitchen-supply-order-detail-received"
                    icon="packageCheck"
                    title={t('kitchen:ops.supplyOrders.columnReceived')}
                >
                    <View className="flex-row items-center gap-base">
                        <ProgressRing
                            testID="kitchen-supply-order-detail-received-ring"
                            size="sm"
                            label={t('kitchen:ops.supplyOrders.view.ringLabel')}
                            value={inFull}
                            target={Math.max(lines.length, 1)}
                            valueText={t('kitchen:ops.supplyOrders.view.inFull', {
                                count: inFull,
                                total: lines.length,
                            })}
                        />
                        <View className="min-w-0 flex-1 flex-col gap-hair">
                            <Text variant="label" tone="secondary">
                                {t('kitchen:ops.supplyOrders.view.inFull', {
                                    count: inFull,
                                    total: lines.length,
                                })}
                            </Text>
                            {order.status === 'cancelled' ? (
                                <Text variant="body" tone="secondary">
                                    {t('kitchen:ops.supplyOrders.cancelledNoticeTitle')}
                                </Text>
                            ) : closed && toCome.length > 0 ? (
                                <Text variant="body" tone="warning">
                                    {t('kitchen:ops.supplyOrders.closedShortTitle')}
                                </Text>
                            ) : (
                                <>
                                    <Text variant="label" tone="secondary">
                                        {t('kitchen:ops.supplyOrders.columnOutstanding')}
                                    </Text>
                                    {toCome.length === 0 ? (
                                        <Text variant="body" tone="secondary">
                                            {t('kitchen:ops.supplyOrders.view.nothingToCome')}
                                        </Text>
                                    ) : (
                                        toCome.map((line) => (
                                            <Text
                                                key={line.stockItemId}
                                                testID={`kitchen-supply-order-detail-to-come-${line.stockItemId}`}
                                                variant="strong"
                                                tone={
                                                    Number(line.receivedQuantity) > 0
                                                        ? 'warning'
                                                        : 'primary'
                                                }
                                                numberOfLines={1}
                                            >
                                                {t('kitchen:ops.supplyOrders.view.toComeLine', {
                                                    quantity: quantity(line.outstandingQuantity),
                                                    unit: line.unitCode,
                                                    item: line.itemNameEn,
                                                })}
                                            </Text>
                                        ))
                                    )}
                                </>
                            )}
                        </View>
                    </View>
                </RecordTile>

                <RecordTile
                    testID="kitchen-supply-order-detail-deliveries"
                    icon="truck"
                    title={t('kitchen:ops.supplyOrders.receiptsTitle')}
                    aside={
                        <Text variant="label" tone="secondary">
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
                            className="flex-col gap-1.5"
                        >
                            {order.receipts.map((receipt) => (
                                <View
                                    key={String(receipt.id)}
                                    testID={`kitchen-supply-order-detail-receipt-${String(receipt.id)}`}
                                    role="listitem"
                                    className="flex-row items-center gap-snug rounded-lg border border-stroke-subtle px-snug py-tight"
                                >
                                    <View
                                        aria-hidden
                                        className="h-7 w-7 items-center justify-center rounded bg-surface-brand-subtle"
                                    >
                                        <Icon
                                            name="check"
                                            size="sm"
                                            className="text-content-on-brand-subtle"
                                        />
                                    </View>
                                    <View className="min-w-0 flex-1 flex-col">
                                        <Text variant="strong">
                                            {date(receipt.receivedOn) ?? dash}
                                        </Text>
                                        <Text variant="label" tone="secondary" numberOfLines={1}>
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
                                </View>
                            ))}
                        </View>
                    )}
                </RecordTile>

                <RecordTile
                    testID="kitchen-supply-order-detail-supplier"
                    icon="store"
                    title={t('kitchen:ops.supplyOrders.columnSupplier')}
                    trailing={
                        snapshot === null ? undefined : (
                            <Text variant="label" tone="secondary">
                                {t('kitchen:ops.supplyOrders.view.asIssued')}
                            </Text>
                        )
                    }
                >
                    <View className="flex-col">
                        <Text
                            variant="strong"
                            testID="kitchen-supply-order-detail-summary-supplier"
                        >
                            {supplierName}
                        </Text>
                        {snapshot === null ? null : (
                            <Text variant="label" tone="secondary">
                                {[snapshot.code, snapshot.address]
                                    .filter((part): part is string => part !== null && part !== '')
                                    .join(separator)}
                            </Text>
                        )}
                    </View>
                    <TileFacts
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
                                          key: 'lead-time',
                                          label: t('kitchen:ops.supplyOrders.view.leadTime'),
                                          value:
                                              snapshot.leadTimeDays === null
                                                  ? dash
                                                  : t('kitchen:calendar.dayCount', {
                                                        count: snapshot.leadTimeDays,
                                                    }),
                                          empty: snapshot.leadTimeDays === null,
                                      },
                                      {
                                          key: 'office',
                                          label: t('kitchen:ops.supplyOrders.print.generalContact'),
                                          value:
                                              office.length === 0 ? dash : office.join(separator),
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
                    <View className="mt-auto flex-col gap-hair border-t border-stroke-subtle pt-snug">
                        <Text variant="label" tone="secondary">
                            {t('kitchen:ops.supplyOrders.notesTitle')}
                        </Text>
                        <Text
                            variant="body"
                            tone={
                                order.notes === null || order.notes === '' ? 'secondary' : 'primary'
                            }
                            testID="kitchen-supply-order-detail-notes-text"
                        >
                            {order.notes === null || order.notes === ''
                                ? t('kitchen:ops.supplyOrders.noNotes')
                                : order.notes}
                        </Text>
                    </View>
                </RecordTile>
            </RecordTileRow>

            <RecordTile
                testID="kitchen-supply-order-detail-lines"
                icon="list"
                title={t('kitchen:ops.supplyOrders.linesTitle')}
                aside={
                    <Text
                        variant="label"
                        tone="secondary"
                        testID="kitchen-supply-order-detail-line-count"
                    >
                        {t('kitchen:ops.supplyOrders.receiptLineCount', { count: lines.length })}
                    </Text>
                }
            >
                {table}
            </RecordTile>
        </>
    );
}
