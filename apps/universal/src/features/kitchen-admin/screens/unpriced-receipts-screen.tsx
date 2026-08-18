import type { UnpricedReceipt } from '@healthy360/api-client/contracts';
import {
    Badge,
    Button,
    Callout,
    Dialog,
    EmptyState,
    ErrorState,
    Inline,
    Skeleton,
    Stack,
    Table,
    Text,
    TextInputField,
    useToast,
} from '@healthy360/design-system';
import type { TableColumn } from '@healthy360/design-system';
import type { GoodsReceiptId } from '@healthy360/domain-types';
import { useFormatter } from '@healthy360/i18n';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { Gate } from '../../../access/gate.tsx';
import { toFailure } from '../../../data/hooks.ts';
import {
    useCompleteReceiptPricesMutation,
    useGoodsReceiptQuery,
    useUnpricedReceiptsQuery,
} from '../../../data/kitchen-ops-hooks.ts';
import { INVENTORY_VIEW_COSTS_PERMISSION } from '../entity-registry.ts';
import { OpsPanel } from '../ops-panel.tsx';
import { receiptCostStatusKey, receiptCostStatusTone } from '../ops-format.ts';
import { readAmount } from '../receive-delivery-model.ts';

/**
 * `/kitchen/procurement/unpriced-receipts` — the work queue (SUP5, §3.6, §7).
 *
 * A delivery may be posted with no prices at all: the goods are on the shelf and the paperwork is in
 * the post. This is the list of receipts still waiting on that paperwork, and it exists because the
 * alternative §3.6 refuses is quietly leaving them out of a financial total that then looks
 * complete.
 *
 * ## Two counts, because they are two different jobs
 *
 * `unpricedLineCount` is "type these prices in". `valuationPendingCount` is "the prices are already
 * here and an exchange-rate decision is not this screen's to make" — a row a person **cannot**
 * action, and one they need to tell apart at a glance rather than by opening it. A queue showing one
 * number for both would send people to rows they cannot finish, and the honest explanation is worth
 * a sentence rather than a badge nobody can decode.
 *
 * ## Completing shows the quantities and will not let anyone touch them
 *
 * §7: "Completing a receipt shows its immutable received quantities and accepts only the missing
 * financial fields." So the dialog renders quantity and unit as text, and only the price is a
 * control. §3.6 is explicit that posted quantities are never edited in place — a correction is a
 * reasoned, audited adjustment, which is a different object this screen deliberately does not offer.
 *
 * Only lines with nothing costed yet get an input. A line already priced is shown as settled, and a
 * line waiting on an exchange rate is shown with the reason it cannot be finished here. Behind
 * `inventory.view_costs_organisation` (§5): the receiver enters prices at the door, the cost holder
 * goes back over the money afterwards.
 */
export function UnpricedReceiptsScreen() {
    return (
        <Gate
            area="kitchen"
            requirement={{ allOf: [INVENTORY_VIEW_COSTS_PERMISSION] }}
            testID="kitchen-unpriced-receipts"
        >
            <UnpricedReceipts />
        </Gate>
    );
}

const RECEIPT_CURRENCY = 'USD';

function UnpricedReceipts() {
    const { t } = useTranslation();
    const formatter = useFormatter();
    const toast = useToast();

    const queue = useUnpricedReceiptsQuery();
    const [openReceiptId, setOpenReceiptId] = useState<GoodsReceiptId | null>(null);
    const [prices, setPrices] = useState<Readonly<Record<string, string>>>({});

    const receipt = useGoodsReceiptQuery(openReceiptId);
    const complete = useCompleteReceiptPricesMutation();

    const rows = queue.data?.items ?? [];

    const pendingLines = useMemo(
        () => (receipt.data?.lines ?? []).filter((line) => line.costedAt === null),
        [receipt.data],
    );

    /** Lines a person may actually price here — pending-FX rows are the accounting phase's. */
    const priceableLines = useMemo(
        () => pendingLines.filter((line) => !line.valuationPendingFx),
        [pendingLines],
    );

    function closeDialog() {
        setOpenReceiptId(null);
        setPrices({});
        complete.reset();
    }

    const everyPriceReadable = priceableLines.every((line) => {
        const raw = prices[line.id] ?? '';
        return raw.trim() === '' || readAmount(raw) !== null;
    });

    const filledCount = priceableLines.filter(
        (line) => readAmount(prices[line.id] ?? '') !== null,
    ).length;

    function submit() {
        if (openReceiptId === null || filledCount === 0 || !everyPriceReadable) return;

        complete.mutate(
            {
                goodsReceiptId: openReceiptId,
                request: {
                    lines: priceableLines
                        .map((line) => ({ line, amount: readAmount(prices[line.id] ?? '') }))
                        .filter(
                            (
                                entry,
                            ): entry is { line: (typeof priceableLines)[number]; amount: number } =>
                                entry.amount !== null,
                        )
                        .map((entry) => ({
                            goodsReceiptLineId: entry.line.id,
                            unitPriceAmount: entry.amount,
                            costCurrencyCode: RECEIPT_CURRENCY,
                        })),
                },
            },
            {
                onSuccess: () => {
                    closeDialog();
                    toast.show({
                        testID: 'kitchen-unpriced-completed-toast',
                        tone: 'success',
                        message: t('kitchen:ops.unpricedReceipts.completedToast'),
                    });
                },
            },
        );
    }

    const columns: readonly TableColumn<UnpricedReceipt>[] = [
        {
            key: 'receivedOn',
            header: t('kitchen:ops.unpricedReceipts.columnReceivedOn'),
            rowHeader: true,
            render: (row) => (
                <Text testID={`kitchen-unpriced-${String(row.id)}-received-on`}>
                    {row.receivedOn === null
                        ? '—'
                        : formatter.formatDate(row.receivedOn, { dateStyle: 'medium' })}
                </Text>
            ),
        },
        {
            key: 'supplier',
            header: t('kitchen:ops.unpricedReceipts.columnSupplier'),
            render: (row) => (
                <Text variant="caption" tone="secondary">
                    {row.supplier?.nameEn ?? t('kitchen:ops.procurement.noSupplier')}
                </Text>
            ),
        },
        {
            key: 'refs',
            header: t('kitchen:ops.unpricedReceipts.columnRefs'),
            render: (row) => (
                <Stack space="none">
                    <Text variant="caption" tone="secondary">
                        {row.documentRef ?? '—'}
                    </Text>
                    <Text variant="caption" tone="secondary">
                        {row.supplierInvoiceRef ?? t('kitchen:ops.unpricedReceipts.noInvoiceRef')}
                    </Text>
                </Stack>
            ),
        },
        {
            key: 'state',
            header: t('kitchen:ops.unpricedReceipts.columnState'),
            render: (row) => (
                <Inline space="xs" align="center" wrap>
                    <Badge
                        tone={receiptCostStatusTone(row.costStatus)}
                        testID={`kitchen-unpriced-${String(row.id)}-status`}
                        label={t(receiptCostStatusKey(row.costStatus))}
                    />
                    <Text variant="caption" tone="secondary">
                        {t('kitchen:ops.unpricedReceipts.linesToPrice', {
                            count: row.unpricedLineCount,
                        })}
                    </Text>
                    {row.valuationPendingCount > 0 ? (
                        <Badge
                            tone="warning"
                            testID={`kitchen-unpriced-${String(row.id)}-pending-fx`}
                            label={t('kitchen:ops.unpricedReceipts.pendingFxBadge', {
                                count: row.valuationPendingCount,
                            })}
                        />
                    ) : null}
                </Inline>
            ),
        },
        {
            key: 'open',
            header: t('kitchen:ops.unpricedReceipts.columnAction'),
            render: (row) => (
                <Button
                    testID={`kitchen-unpriced-${String(row.id)}-open`}
                    size="sm"
                    variant="ghost"
                    label={t('kitchen:ops.unpricedReceipts.openLabel')}
                    onPress={() => {
                        setPrices({});
                        setOpenReceiptId(row.id);
                    }}
                />
            ),
        },
    ];

    const failure = toFailure(queue.error);

    return (
        <Stack space="lg" testID="kitchen-unpriced-screen">
            <OpsPanel
                testID="kitchen-unpriced-panel"
                titleKey="kitchen:ops.unpricedReceipts.title"
                subtitleKey="kitchen:ops.unpricedReceipts.subtitle"
                metrics={[
                    {
                        key: 'receipts',
                        labelKey: 'kitchen:ops.unpricedReceipts.metrics.receipts',
                        value: queue.isPending ? null : rows.length,
                    },
                ]}
                emptyTitleKey="kitchen:ops.unpricedReceipts.emptyTitle"
                emptyBodyKey="kitchen:ops.unpricedReceipts.emptyBody"
            >
                {queue.isPending ? (
                    <Stack space="sm" testID="kitchen-unpriced-loading">
                        {Array.from({ length: 3 }, (_, index) => (
                            <Skeleton key={index} heightClassName="h-10" />
                        ))}
                    </Stack>
                ) : failure !== null ? (
                    <ErrorState
                        testID="kitchen-unpriced-error"
                        failure={failure}
                        onRetry={() => {
                            void queue.refetch();
                        }}
                        retrying={queue.isFetching}
                    />
                ) : rows.length === 0 ? (
                    <EmptyState
                        testID="kitchen-unpriced-empty"
                        title={t('kitchen:ops.unpricedReceipts.emptyTitle')}
                        body={t('kitchen:ops.unpricedReceipts.emptyBody')}
                    />
                ) : (
                    <Table<UnpricedReceipt>
                        testID="kitchen-unpriced-table"
                        caption={t('kitchen:ops.unpricedReceipts.title')}
                        captionHidden
                        columns={columns}
                        rows={rows}
                        rowKey={(row) => String(row.id)}
                    />
                )}
            </OpsPanel>

            <Dialog
                testID="kitchen-unpriced-complete-dialog"
                open={openReceiptId !== null}
                onClose={closeDialog}
                title={t('kitchen:ops.unpricedReceipts.completeTitle')}
                actions={
                    <>
                        <Button
                            testID="kitchen-unpriced-complete-cancel"
                            variant="quiet"
                            label={t('kitchen:common.cancel')}
                            onPress={closeDialog}
                        />
                        <Button
                            testID="kitchen-unpriced-complete-save"
                            label={t('kitchen:common.save')}
                            loading={complete.isPending}
                            disabled={filledCount === 0 || !everyPriceReadable}
                            onPress={submit}
                        />
                    </>
                }
            >
                <Stack space="md">
                    {complete.error === null ? null : (
                        <Text testID="kitchen-unpriced-complete-error" tone="danger">
                            {toFailure(complete.error)?.message ??
                                t('kitchen:ops.unpricedReceipts.completeFailed')}
                        </Text>
                    )}

                    {receipt.isPending ? (
                        <Skeleton
                            heightClassName="h-24"
                            testID="kitchen-unpriced-complete-loading"
                        />
                    ) : (
                        <Stack space="sm">
                            <Text variant="caption" tone="secondary">
                                {t('kitchen:ops.unpricedReceipts.quantitiesImmutable')}
                            </Text>
                            {pendingLines.map((line) => (
                                <Stack
                                    key={line.id}
                                    space="xs"
                                    testID={`kitchen-unpriced-line-${line.id}`}
                                >
                                    <Text variant="bodyStrong">{String(line.stockItemId)}</Text>
                                    <Text variant="caption" tone="secondary">
                                        {t('kitchen:ops.unpricedReceipts.receivedQuantity', {
                                            quantity: line.quantity,
                                        })}
                                    </Text>
                                    {line.valuationPendingFx ? (
                                        <Callout
                                            tone="warning"
                                            testID={`kitchen-unpriced-line-${line.id}-pending-fx`}
                                            title={t('kitchen:ops.unpricedReceipts.pendingFxTitle')}
                                        >
                                            <Text>
                                                {t('kitchen:ops.unpricedReceipts.pendingFxBody')}
                                            </Text>
                                        </Callout>
                                    ) : (
                                        <TextInputField
                                            testID={`kitchen-unpriced-line-${line.id}-price`}
                                            label={t(
                                                'kitchen:ops.unpricedReceipts.fieldUnitPrice',
                                                {
                                                    currency: RECEIPT_CURRENCY,
                                                },
                                            )}
                                            value={prices[line.id] ?? ''}
                                            keyboardType="decimal-pad"
                                            onChangeText={(next) => {
                                                setPrices((current) => ({
                                                    ...current,
                                                    [line.id]: next,
                                                }));
                                            }}
                                        />
                                    )}
                                </Stack>
                            ))}
                        </Stack>
                    )}
                </Stack>
            </Dialog>
        </Stack>
    );
}
