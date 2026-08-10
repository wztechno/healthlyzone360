import type {
    GoodsReceipt,
    MeasurementUnitOption,
    Supplier,
} from '@healthy360/api-client/contracts';
import {
    Button,
    Dialog,
    EmptyState,
    ErrorState,
    Heading,
    Inline,
    Select,
    Skeleton,
    Stack,
    Table,
    Text,
    TextInputField,
    useToast,
} from '@healthy360/design-system';
import type { SelectOption, TableColumn } from '@healthy360/design-system';
import { StockItemId, SupplierId } from '@healthy360/domain-types';
import { useFormatter } from '@healthy360/i18n';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { Gate, useCan } from '../../../access/gate.tsx';
import { toFailure } from '../../../data/hooks.ts';
import {
    useCreateSupplierMutation,
    useGoodsReceiptsQuery,
    usePostGoodsReceiptMutation,
    useProcurementReferenceQuery,
    useStockItemsQuery,
    useSuppliersQuery,
} from '../../../data/kitchen-ops-hooks.ts';
import { useAccessState } from '../../../session/session-provider.tsx';
import {
    INVENTORY_MANAGE_PERMISSION,
    INVENTORY_VIEW_COSTS_PERMISSION,
    INVENTORY_VIEW_PERMISSION,
} from '../entity-registry.ts';
import { goodsReceiptRowTestId, stockItemLabel, supplierRowTestId } from '../ops-format.ts';
import {
    StockItemLineEditor,
    stockItemLinesToReceiptInputs,
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
 * and the post form sends nothing for it.
 *
 * ## What the receipt form actually needs to be usable (INV1.1)
 *
 * Three gaps this screen closes. A supplier can be **created inline** — the contract now publishes a
 * writer — so a kitchen with an empty book is not stuck. The **price currency is chosen on the
 * receipt**, defaulting to the kitchen's own currency (`getProcurementReference`), so a price is no
 * longer silently dropped when a supplier happens to carry no currency; the price fields sit behind
 * `inventory.view_costs_organisation`, so a chef without that code posts quantities only. And each
 * line carries a **purchase unit**, defaulting to the stock item's own and offering only the units
 * in its dimension, so "25 kg of flour at 2.00/kg" records exactly that rather than a bare number.
 */

/**
 * The dimensions the server's `UnitConversionService` can convert *between different units* within
 * (INV1.0) — mass and volume carry real `base_ratio` factors; `count`, `serving`, `package`,
 * `energy` and `length` carry an identity 1 and only the same-unit identity converts. Offering a
 * second unit inside a non-convertible dimension would post a receipt the server must reject, so the
 * picker offers alternatives only inside these two and shows the item's own unit as a label
 * otherwise — the label is always present, whether or not there was ever a choice to make.
 */
const CONVERTIBLE_DIMENSIONS: ReadonlySet<string> = new Set(['mass', 'volume']);

/** The last-resort receipt currency when the organisation has none and the reference lists none. */
const FALLBACK_CURRENCY = 'USD';

export function ProcurementScreen() {
    return (
        <Gate
            area="kitchen"
            requirement={{ allOf: [INVENTORY_VIEW_PERMISSION] }}
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
    const canManage = useCan(INVENTORY_MANAGE_PERMISSION);
    const canViewCosts = useCan(INVENTORY_VIEW_COSTS_PERMISSION);
    const branchId = access.branch?.id ?? null;

    const suppliers = useSuppliersQuery();
    const receipts = useGoodsReceiptsQuery();
    const stockItems = useStockItemsQuery();
    const reference = useProcurementReferenceQuery();
    const postReceipt = usePostGoodsReceiptMutation();
    const createSupplier = useCreateSupplierMutation();

    const [posting, setPosting] = useState(false);
    const [lines, setLines] = useState<readonly StockItemLineDraft[]>([]);
    const [supplierId, setSupplierId] = useState<string | null>(null);
    const [documentRef, setDocumentRef] = useState('');
    const [receiptCurrency, setReceiptCurrency] = useState<string | null>(null);

    const [creatingSupplier, setCreatingSupplier] = useState(false);
    const [newSupplierName, setNewSupplierName] = useState('');
    const [newSupplierCode, setNewSupplierCode] = useState('');
    const [newSupplierCurrency, setNewSupplierCurrency] = useState<string | null>(null);
    const [newSupplierEmail, setNewSupplierEmail] = useState('');
    const [newSupplierPhone, setNewSupplierPhone] = useState('');

    const supplierRows = suppliers.data ?? [];
    const receiptRows = receipts.data ?? [];
    const totalLinesReceived = receiptRows.reduce((sum, receipt) => sum + receipt.lines.length, 0);

    const referenceData = reference.data ?? null;

    const supplierOptions = useMemo(
        () =>
            (suppliers.data ?? []).map((row) => ({
                value: String(row.id),
                label: `${row.code} — ${row.nameEn}`,
            })),
        [suppliers.data],
    );

    const currencyOptions: readonly SelectOption<string>[] = useMemo(
        () =>
            (referenceData?.currencies ?? []).map((currency) => ({
                value: currency.code,
                label: `${currency.code} — ${currency.nameEn}`,
            })),
        [referenceData],
    );

    /** The kitchen's own currency (organisation default), the honest default for a fresh receipt. */
    const kitchenCurrency =
        referenceData?.defaultCurrencyCode ??
        referenceData?.currencies[0]?.code ??
        FALLBACK_CURRENCY;

    // Prices are booked in the receipt-level currency, defaulting to the kitchen's own — never
    // silently dropped for want of a supplier currency (a selected supplier only pre-selects it).
    // A user without the cost permission never sets a currency and posts quantities only.
    const currencyCode = canViewCosts ? receiptCurrency : null;
    const formatMoney = (amount: number) =>
        `${formatter.formatNumber(amount, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}${currencyCode === null ? '' : ` ${currencyCode}`}`;

    // Unit reference, indexed so the line editor can resolve a stock item's own unit and offer only
    // the units in its dimension. A stock item names its unit by code (`unitCode`); the reference
    // gives that code an id and a dimension.
    const unitByCode = useMemo(() => {
        const map = new Map<string, MeasurementUnitOption>();
        for (const unit of referenceData?.measurementUnits ?? []) map.set(unit.code, unit);
        return map;
    }, [referenceData]);

    const unitById = useMemo(() => {
        const map = new Map<string, string>();
        for (const unit of referenceData?.measurementUnits ?? []) map.set(unit.id, unit.code);
        return map;
    }, [referenceData]);

    const stockItemByIdForUnits = useMemo(() => {
        const map = new Map<string, string>();
        for (const item of stockItems.data ?? []) map.set(String(item.id), item.unitCode);
        return map;
    }, [stockItems.data]);

    function itemOwnUnitCode(stockItemId: string | null): string | null {
        if (stockItemId === null) return null;
        return stockItemByIdForUnits.get(stockItemId) ?? null;
    }

    function defaultUnitIdForItem(stockItemId: string | null): string | null {
        const code = itemOwnUnitCode(stockItemId);
        if (code === null) return null;
        return unitByCode.get(code)?.id ?? null;
    }

    function unitOptionsForItem(stockItemId: string | null): readonly SelectOption<string>[] {
        const code = itemOwnUnitCode(stockItemId);
        const own = code === null ? undefined : unitByCode.get(code);
        if (own === undefined) return [];
        if (!CONVERTIBLE_DIMENSIONS.has(own.dimension)) {
            return [{ value: own.id, label: own.code }];
        }
        return (referenceData?.measurementUnits ?? [])
            .filter((unit) => unit.dimension === own.dimension)
            .map((unit) => ({ value: unit.id, label: unit.code }));
    }

    /** A human unit label beside the quantity — the resolved unit's code, or the item's own. */
    function unitLabelFor(stockItemId: string | null, unitId: string | null): string {
        if (unitId !== null) {
            const code = unitById.get(unitId);
            if (code !== undefined) return code;
        }
        return itemOwnUnitCode(stockItemId) ?? '';
    }

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

    function openPosting() {
        setReceiptCurrency(kitchenCurrency);
        setPosting(true);
    }

    function closePosting() {
        setPosting(false);
        setLines([]);
        setSupplierId(null);
        setDocumentRef('');
        setReceiptCurrency(null);
        postReceipt.reset();
    }

    /** Picking a supplier pre-selects its currency when it carries one — a hint, never a lock. */
    function selectSupplier(value: string | null) {
        setSupplierId(value);
        const supplier = supplierRows.find((row) => String(row.id) === value) ?? null;
        if (supplier?.currencyCode != null && supplier.currencyCode !== '') {
            setReceiptCurrency(supplier.currencyCode);
        }
    }

    const linesValid = lines.length > 0 && stockItemLinesWellFormed(lines);

    function submitReceipt() {
        if (branchId === null || !linesValid) return;
        postReceipt.mutate(
            {
                branchId,
                supplierId: supplierId === null ? null : SupplierId.unsafe(supplierId),
                documentRef: documentRef.trim() === '' ? null : documentRef.trim(),
                purchaseOrderId: null,
                lines: stockItemLinesToReceiptInputs(lines, currencyCode).map((line) => ({
                    stockItemId: StockItemId.unsafe(line.stockItemId),
                    quantity: line.quantity,
                    ...(line.unitId === undefined ? {} : { unitId: line.unitId }),
                    ...(line.unitPriceAmount === undefined
                        ? {}
                        : {
                              unitPriceAmount: line.unitPriceAmount,
                              costCurrencyCode: line.costCurrencyCode,
                          }),
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

    function closeCreateSupplier() {
        setCreatingSupplier(false);
        setNewSupplierName('');
        setNewSupplierCode('');
        setNewSupplierCurrency(null);
        setNewSupplierEmail('');
        setNewSupplierPhone('');
        createSupplier.reset();
    }

    const newSupplierValid = newSupplierName.trim() !== '';

    function submitNewSupplier() {
        if (!newSupplierValid) return;
        createSupplier.mutate(
            {
                nameEn: newSupplierName.trim(),
                code: newSupplierCode.trim() === '' ? null : newSupplierCode.trim(),
                currencyCode: newSupplierCurrency,
                contactEmail: newSupplierEmail.trim() === '' ? null : newSupplierEmail.trim(),
                contactPhone: newSupplierPhone.trim() === '' ? null : newSupplierPhone.trim(),
            },
            {
                onSuccess: (supplier) => {
                    // Select the freshly created supplier so a post in progress can use it at once.
                    selectSupplier(String(supplier.id));
                    closeCreateSupplier();
                    toast.show({
                        testID: 'kitchen-procurement-supplier-created-toast',
                        tone: 'success',
                        message: t('kitchen:ops.procurement.supplierCreatedToast'),
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
            key: 'supplier',
            header: t('kitchen:ops.procurement.columnSupplier'),
            render: (row) => (
                <Text
                    variant="caption"
                    tone="secondary"
                    testID={`${goodsReceiptRowTestId(String(row.id))}-supplier`}
                >
                    {row.supplier === null ? t('kitchen:ops.procurement.noSupplier') : row.supplier.nameEn}
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
        {
            key: 'total',
            header: t('kitchen:ops.procurement.columnTotal'),
            render: (row) => (
                <Text
                    variant="bodyStrong"
                    tone="secondary"
                    testID={`${goodsReceiptRowTestId(String(row.id))}-total`}
                >
                    {row.receiptTotalAmount === null || row.currencyCode === null
                        ? row.costsRedacted
                            ? t('kitchen:ops.procurement.costsRedacted')
                            : '—'
                        : `${formatter.formatNumber(Number(row.receiptTotalAmount), {
                              minimumFractionDigits: 2,
                              maximumFractionDigits: 2,
                          })} ${row.currencyCode}`}
                </Text>
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
                            <Inline space="sm" align="center" justify="between" wrap>
                                <Heading level={2} testID="kitchen-procurement-suppliers-title">
                                    {t('kitchen:ops.procurement.suppliersTitle')}
                                </Heading>
                                {canManage ? (
                                    <Button
                                        testID="kitchen-procurement-new-supplier"
                                        size="sm"
                                        variant="secondary"
                                        label={t('kitchen:ops.procurement.newSupplier')}
                                        onPress={() => {
                                            setCreatingSupplier(true);
                                        }}
                                    />
                                ) : null}
                            </Inline>
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
                                        onPress={openPosting}
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
                    <Inline space="sm" align="end" wrap>
                        <Select
                            testID="kitchen-procurement-post-supplier"
                            label={t('kitchen:ops.procurement.fieldSupplier')}
                            options={supplierOptions}
                            value={supplierId}
                            onChange={selectSupplier}
                            searchable
                            className="min-w-[220px] flex-1"
                        />
                        {canManage ? (
                            <Button
                                testID="kitchen-procurement-post-new-supplier"
                                size="sm"
                                variant="secondary"
                                label={t('kitchen:ops.procurement.newSupplier')}
                                onPress={() => {
                                    setCreatingSupplier(true);
                                }}
                            />
                        ) : null}
                        <TextInputField
                            testID="kitchen-procurement-post-document-ref"
                            label={t('kitchen:ops.procurement.fieldDocumentRef')}
                            value={documentRef}
                            onChangeText={setDocumentRef}
                            className="min-w-[160px] flex-1"
                        />
                    </Inline>
                    {canViewCosts ? (
                        <Select
                            testID="kitchen-procurement-post-currency"
                            label={t('kitchen:ops.procurement.fieldCurrency')}
                            options={currencyOptions}
                            value={receiptCurrency}
                            onChange={setReceiptCurrency}
                            searchable
                            className="min-w-[220px]"
                        />
                    ) : null}
                    <StockItemLineEditor
                        testID="kitchen-procurement-post-lines"
                        lines={lines}
                        onChange={setLines}
                        stockItemOptions={stockItemOptions}
                        itemLabel={t('kitchen:ops.procurement.fieldLineItem')}
                        quantityLabel={t('kitchen:ops.procurement.fieldLineQuantity')}
                        addLabel={t('kitchen:ops.procurement.addLine')}
                        removeLabel={t('kitchen:ops.procurement.removeLine')}
                        withUnit
                        unitLabel={t('kitchen:ops.procurement.fieldLineUnit')}
                        unitOptionsForItem={unitOptionsForItem}
                        defaultUnitIdForItem={defaultUnitIdForItem}
                        unitLabelFor={unitLabelFor}
                        withCost={canViewCosts}
                        unitPriceLabel={t('kitchen:ops.procurement.fieldLineUnitPrice')}
                        formatMoney={formatMoney}
                    />
                </Stack>
            </Dialog>

            <Dialog
                testID="kitchen-procurement-supplier-dialog"
                open={creatingSupplier}
                onClose={closeCreateSupplier}
                title={t('kitchen:ops.procurement.newSupplierTitle')}
                actions={
                    <>
                        <Button
                            testID="kitchen-procurement-supplier-cancel"
                            variant="quiet"
                            label={t('kitchen:common.cancel')}
                            onPress={closeCreateSupplier}
                        />
                        <Button
                            testID="kitchen-procurement-supplier-confirm"
                            label={t('kitchen:common.save')}
                            loading={createSupplier.isPending}
                            disabled={!newSupplierValid}
                            onPress={submitNewSupplier}
                        />
                    </>
                }
            >
                <Stack space="md">
                    {createSupplier.error === null ? null : (
                        <Text testID="kitchen-procurement-supplier-error" tone="danger">
                            {toFailure(createSupplier.error)?.message ??
                                t('kitchen:ops.procurement.newSupplierFailed')}
                        </Text>
                    )}
                    <TextInputField
                        testID="kitchen-procurement-supplier-name"
                        label={t('kitchen:ops.procurement.fieldSupplierName')}
                        value={newSupplierName}
                        onChangeText={setNewSupplierName}
                    />
                    <Inline space="sm" align="start" wrap>
                        <TextInputField
                            testID="kitchen-procurement-supplier-code"
                            label={t('kitchen:ops.procurement.fieldSupplierCode')}
                            value={newSupplierCode}
                            onChangeText={setNewSupplierCode}
                            className="min-w-[160px] flex-1"
                        />
                        <Select
                            testID="kitchen-procurement-supplier-currency"
                            label={t('kitchen:ops.procurement.fieldSupplierCurrency')}
                            options={currencyOptions}
                            value={newSupplierCurrency}
                            onChange={setNewSupplierCurrency}
                            searchable
                            className="min-w-[160px] flex-1"
                        />
                    </Inline>
                    <Inline space="sm" align="start" wrap>
                        <TextInputField
                            testID="kitchen-procurement-supplier-email"
                            label={t('kitchen:ops.procurement.fieldSupplierEmail')}
                            value={newSupplierEmail}
                            onChangeText={setNewSupplierEmail}
                            keyboardType="email-address"
                            className="min-w-[160px] flex-1"
                        />
                        <TextInputField
                            testID="kitchen-procurement-supplier-phone"
                            label={t('kitchen:ops.procurement.fieldSupplierPhone')}
                            value={newSupplierPhone}
                            onChangeText={setNewSupplierPhone}
                            keyboardType="phone-pad"
                            className="min-w-[160px] flex-1"
                        />
                    </Inline>
                </Stack>
            </Dialog>
        </Stack>
    );
}
