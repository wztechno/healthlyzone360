import type { GoodsReceipt, Supplier } from '@healthy360/api-client/contracts';
import {
    Button,
    Dialog,
    EmptyState,
    ErrorState,
    Heading,
    Inline,
    Skeleton,
    Stack,
    Table,
    Text,
    useToast,
} from '@healthy360/design-system';
import type { TableColumn } from '@healthy360/design-system';
import { StockItemId } from '@healthy360/domain-types';
import { useFormatter } from '@healthy360/i18n';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { Gate, useCan } from '../../../access/gate.tsx';
import { toFailure } from '../../../data/hooks.ts';
import {
    useGoodsReceiptsQuery,
    usePostGoodsReceiptMutation,
    useStockItemsQuery,
    useSuppliersQuery,
} from '../../../data/kitchen-ops-hooks.ts';
import { useAccessState } from '../../../session/session-provider.tsx';
import { CATALOGUE_MANAGE_PERMISSION, CATALOGUE_VIEW_PERMISSION } from '../entity-registry.ts';
import { goodsReceiptRowTestId, stockItemLabel, supplierRowTestId } from '../ops-format.ts';
import {
    StockItemLineEditor,
    stockItemLinesToInputs,
    stockItemLinesWellFormed,
} from '../ops-line-editor.tsx';
import type { StockItemLineDraft } from '../ops-line-editor.tsx';
import { OpsPanel } from '../ops-panel.tsx';
import type { OpsMetric } from '../ops-panel.tsx';

/**
 * `/kitchen/procurement` — receipts-only procurement (O2).
 *
 * There is no purchase-order surface in v1: `GoodsReceipt.purchaseOrderId` is always `null` until
 * one exists to point at (`contracts/kitchen-ops.ts`), so this screen never offers a picker for one
 * and the post form sends nothing for it. The supplier book is read-only here too — the contract
 * publishes `listSuppliers` and no writer, so there is nothing this screen could submit.
 */

export function ProcurementScreen() {
    return (
        <Gate
            area="kitchen"
            requirement={{ allOf: [CATALOGUE_VIEW_PERMISSION] }}
            testID="kitchen-procurement"
        >
            <Procurement />
        </Gate>
    );
}

function Procurement() {
    const { t } = useTranslation();
    const formatter = useFormatter();
    const toast = useToast();
    const access = useAccessState();
    const canManage = useCan(CATALOGUE_MANAGE_PERMISSION);
    const branchId = access.branch?.id ?? null;

    const suppliers = useSuppliersQuery();
    const receipts = useGoodsReceiptsQuery();
    const stockItems = useStockItemsQuery();
    const postReceipt = usePostGoodsReceiptMutation();

    const [posting, setPosting] = useState(false);
    const [lines, setLines] = useState<readonly StockItemLineDraft[]>([]);

    const supplierRows = suppliers.data ?? [];
    const receiptRows = receipts.data ?? [];
    const totalLinesReceived = receiptRows.reduce((sum, receipt) => sum + receipt.lines.length, 0);

    const metrics: readonly OpsMetric[] = [
        {
            key: 'suppliers',
            labelKey: 'kitchen:ops.procurement.metrics.suppliers',
            value: suppliers.isPending ? null : supplierRows.length,
        },
        {
            key: 'receipts',
            labelKey: 'kitchen:ops.procurement.metrics.receipts',
            value: receipts.isPending ? null : receiptRows.length,
        },
        {
            key: 'lines',
            labelKey: 'kitchen:ops.procurement.metrics.lines',
            value: receipts.isPending ? null : totalLinesReceived,
        },
    ];

    const stockItemOptions = useMemo(
        () => (stockItems.data ?? []).map((item) => ({ value: String(item.id), label: stockItemLabel(item) })),
        [stockItems.data],
    );

    const stockItemLabelById = useMemo(() => {
        const map = new Map<string, string>();
        for (const item of stockItems.data ?? []) map.set(String(item.id), stockItemLabel(item));
        return map;
    }, [stockItems.data]);

    function closePosting() {
        setPosting(false);
        setLines([]);
        postReceipt.reset();
    }

    const linesValid = lines.length > 0 && stockItemLinesWellFormed(lines);

    function submitReceipt() {
        if (branchId === null || !linesValid) return;
        postReceipt.mutate(
            {
                branchId,
                purchaseOrderId: null,
                lines: stockItemLinesToInputs(lines).map((line) => ({
                    stockItemId: StockItemId.unsafe(line.stockItemId),
                    quantity: line.quantity,
                })),
            },
            {
                onSuccess: () => {
                    closePosting();
                    toast.show({
                        testID: 'kitchen-procurement-posted-toast',
                        tone: 'success',
                        message: t('kitchen:ops.procurement.postedToast'),
                    });
                },
            },
        );
    }

    const supplierColumns: readonly TableColumn<Supplier>[] = [
        {
            key: 'name',
            header: t('kitchen:ops.procurement.columnSupplier'),
            rowHeader: true,
            flex: 2,
            render: (row) => (
                <Stack space="none">
                    <Text
                        variant="bodyStrong"
                        testID={`${supplierRowTestId(String(row.id))}-name`}
                    >
                        {row.nameEn}
                    </Text>
                    <Text variant="caption" tone="secondary">
                        {row.code}
                    </Text>
                </Stack>
            ),
        },
    ];

    const receiptColumns: readonly TableColumn<GoodsReceipt>[] = [
        {
            key: 'receivedAt',
            header: t('kitchen:ops.procurement.columnReceivedAt'),
            rowHeader: true,
            render: (row) => (
                <Text testID={`${goodsReceiptRowTestId(String(row.id))}-received-at`}>
                    {row.receivedAt === null
                        ? t('kitchen:ops.procurement.notYetReceived')
                        : formatter.formatDate(row.receivedAt, {
                              dateStyle: 'medium',
                              timeStyle: 'short',
                          })}
                </Text>
            ),
        },
        {
            key: 'lines',
            header: t('kitchen:ops.procurement.columnLines'),
            flex: 2,
            render: (row) => (
                <Stack space="none" testID={`${goodsReceiptRowTestId(String(row.id))}-lines`}>
                    {row.lines.map((line) => (
                        <Text key={line.stockItemId} variant="caption" tone="secondary">
                            {formatter.formatNumber(Number(line.quantity))} ×{' '}
                            {stockItemLabelById.get(String(line.stockItemId)) ?? line.stockItemId}
                        </Text>
                    ))}
                </Stack>
            ),
        },
    ];

    const failure = toFailure(suppliers.error) ?? toFailure(receipts.error);

    return (
        <Stack space="lg" testID="kitchen-procurement-screen">
            <OpsPanel
                testID="kitchen-procurement-panel"
                titleKey="kitchen:ops.procurement.title"
                subtitleKey="kitchen:ops.procurement.subtitle"
                metrics={metrics}
                emptyTitleKey="kitchen:ops.procurement.emptyTitle"
                emptyBodyKey="kitchen:ops.procurement.emptyBody"
            >
                {suppliers.isPending || receipts.isPending ? (
                    <Stack space="sm" testID="kitchen-procurement-loading">
                        {Array.from({ length: 3 }, (_, index) => (
                            <Skeleton key={index} heightClassName="h-10" />
                        ))}
                    </Stack>
                ) : failure !== null ? (
                    <ErrorState
                        testID="kitchen-procurement-error"
                        failure={failure}
                        onRetry={() => {
                            void suppliers.refetch();
                            void receipts.refetch();
                        }}
                        retrying={suppliers.isFetching || receipts.isFetching}
                    />
                ) : (
                    <Stack space="lg" testID="kitchen-procurement-content">
                        <Stack space="sm">
                            <Heading level={2} testID="kitchen-procurement-suppliers-title">
                                {t('kitchen:ops.procurement.suppliersTitle')}
                            </Heading>
                            {supplierRows.length === 0 ? (
                                <Text tone="secondary" testID="kitchen-procurement-suppliers-empty">
                                    {t('kitchen:ops.procurement.noSuppliers')}
                                </Text>
                            ) : (
                                <Table<Supplier>
                                    testID="kitchen-procurement-suppliers-table"
                                    caption={t('kitchen:ops.procurement.suppliersTitle')}
                                    captionHidden
                                    columns={supplierColumns}
                                    rows={supplierRows}
                                    rowKey={(row) => String(row.id)}
                                />
                            )}
                        </Stack>

                        <Stack space="sm">
                            <Inline space="sm" align="center" justify="between" wrap>
                                <Heading level={2} testID="kitchen-procurement-receipts-title">
                                    {t('kitchen:ops.procurement.receiptsTitle')}
                                </Heading>
                                {canManage ? (
                                    <Button
                                        testID="kitchen-procurement-post-receipt"
                                        size="sm"
                                        label={t('kitchen:ops.procurement.postReceipt')}
                                        onPress={() => {
                                            setPosting(true);
                                        }}
                                    />
                                ) : null}
                            </Inline>

                            {receiptRows.length === 0 ? (
                                <EmptyState
                                    testID="kitchen-procurement-receipts-empty"
                                    title={t('kitchen:ops.procurement.emptyTitle')}
                                    body={t('kitchen:ops.procurement.emptyBody')}
                                />
                            ) : (
                                <Table<GoodsReceipt>
                                    testID="kitchen-procurement-receipts-table"
                                    caption={t('kitchen:ops.procurement.receiptsTitle')}
                                    captionHidden
                                    columns={receiptColumns}
                                    rows={receiptRows}
                                    rowKey={(row) => String(row.id)}
                                />
                            )}
                        </Stack>
                    </Stack>
                )}
            </OpsPanel>

            <Dialog
                testID="kitchen-procurement-post-dialog"
                open={posting}
                onClose={closePosting}
                title={t('kitchen:ops.procurement.postTitle')}
                actions={
                    <>
                        <Button
                            testID="kitchen-procurement-post-cancel"
                            variant="quiet"
                            label={t('kitchen:common.cancel')}
                            onPress={closePosting}
                        />
                        <Button
                            testID="kitchen-procurement-post-confirm"
                            label={t('kitchen:common.save')}
                            loading={postReceipt.isPending}
                            disabled={branchId === null || !linesValid}
                            onPress={submitReceipt}
                        />
                    </>
                }
            >
                <Stack space="md">
                    {postReceipt.error === null ? null : (
                        <Text testID="kitchen-procurement-post-error" tone="danger">
                            {toFailure(postReceipt.error)?.message ??
                                t('kitchen:ops.procurement.postFailed')}
                        </Text>
                    )}
                    <StockItemLineEditor
                        testID="kitchen-procurement-post-lines"
                        lines={lines}
                        onChange={setLines}
                        stockItemOptions={stockItemOptions}
                        itemLabel={t('kitchen:ops.procurement.fieldLineItem')}
                        quantityLabel={t('kitchen:ops.procurement.fieldLineQuantity')}
                        addLabel={t('kitchen:ops.procurement.addLine')}
                        removeLabel={t('kitchen:ops.procurement.removeLine')}
                    />
                </Stack>
            </Dialog>
        </Stack>
    );
}
