import type { GoodsReceipt, MeasurementUnitOption } from '@healthy360/api-client/contracts';
import {
    Button,
    Dialog,
    EmptyState,
    ErrorState,
    Heading,
    Icon,
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
import { useFormatter, useLocale } from '@healthy360/i18n';
import { useRouter } from 'expo-router';
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
import { displayName } from '../format.ts';
import { goodsReceiptRowTestId, stockItemLabel } from '../ops-format.ts';
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
 * writer — so a kitchen with an empty book is not stuck; the action sits directly under the supplier
 * picker it feeds rather than between two unrelated fields. Prices are booked in
 * {@link RECEIPT_CURRENCY} and the form offers no way to change that, so a price is never silently
 * dropped for want of a currency; the price fields sit behind `inventory.view_costs_organisation`,
 * so a chef without that code posts quantities only. And each line carries a **purchase unit**,
 * defaulting to the stock item's own and offering only the units in its dimension, so "25 kg of
 * flour at 2.00/kg" records exactly that rather than a bare number.
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

/**
 * The one currency a goods receipt's prices are booked in.
 *
 * Fixed, and deliberately not a control: a receipt currency the receiver could change is a currency
 * they can get wrong, and the server refuses a purchase that would blend a second currency into an
 * ingredient's moving average anyway (`MixedIngredientCostCurrency` — there is no exchange rate in
 * this system). One currency on the form is the same rule stated where it can still be obeyed. It
 * reaches the reader through the unit-price label rather than a disabled picker, so it is announced
 * with the field it constrains instead of sitting beside it as dead furniture.
 */
const RECEIPT_CURRENCY = 'USD';

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
    const { locale } = useLocale();
    const router = useRouter();
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

    const [creatingSupplier, setCreatingSupplier] = useState(false);
    const [newSupplierName, setNewSupplierName] = useState('');
    const [newSupplierCode, setNewSupplierCode] = useState('');
    const [newSupplierEmail, setNewSupplierEmail] = useState('');
    const [newSupplierPhone, setNewSupplierPhone] = useState('');

    const supplierRows = suppliers.data ?? [];
    const receiptRows = receipts.data ?? [];
    const totalLinesReceived = receiptRows.reduce((sum, receipt) => sum + receipt.lines.length, 0);

    const referenceData = reference.data ?? null;

    // Suppliers are bilingual since SUP1, so the picker labels them in the reader's own language
    // and falls back to the other side rather than showing an empty option.
    const supplierOptions = useMemo(
        () =>
            (suppliers.data ?? []).map((row) => ({
                value: String(row.id),
                label: `${row.code} — ${displayName(row.name, locale).value}`,
            })),
        [suppliers.data, locale],
    );

    // Prices are booked in RECEIPT_CURRENCY, never silently dropped for want of a supplier
    // currency. A user without the cost permission carries no currency and posts quantities only.
    const currencyCode = canViewCosts ? RECEIPT_CURRENCY : null;
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

    /*
     * Mapped in the order the server gave them and **never re-sorted** (INV2.0). Stock items are
     * derived now — every ingredient in the library has a shelf — so this picker is hundreds of rows
     * long, and the server ranks the ones this kitchen actually holds or has ever moved to the top.
     * Sorting alphabetically here would bury them under two hundred it has never touched; the
     * `searchable` type-ahead handles the tail.
     */
    const stockItemOptions = useMemo(
        () =>
            (stockItems.data ?? []).map((item) => ({
                value: String(item.id),
                label: stockItemLabel(item),
            })),
        [stockItems.data],
    );

    const stockItemLabelById = useMemo(() => {
        const map = new Map<string, string>();
        for (const item of stockItems.data ?? []) map.set(String(item.id), stockItemLabel(item));
        return map;
    }, [stockItems.data]);

    function openPosting() {
        setPosting(true);
    }

    function closePosting() {
        setPosting(false);
        setLines([]);
        setSupplierId(null);
        setDocumentRef('');
        postReceipt.reset();
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
                // The only currency this system prices in, so it is the only honest answer.
                currencyCode: RECEIPT_CURRENCY,
                contactEmail: newSupplierEmail.trim() === '' ? null : newSupplierEmail.trim(),
                contactPhone: newSupplierPhone.trim() === '' ? null : newSupplierPhone.trim(),
            },
            {
                onSuccess: (supplier) => {
                    // Select the freshly created supplier so a post in progress can use it at once.
                    setSupplierId(String(supplier.id));
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
                    {row.supplier === null
                        ? t('kitchen:ops.procurement.noSupplier')
                        : row.supplier.nameEn}
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
                        {/*
                         * A count and a way through, not a second supplier table (SUP1). Suppliers
                         * have their own screen now — with contacts, an archive and a search — and
                         * a read-only copy of their names here would be a list that could not do
                         * any of it. The inline create inside the receipt dialog stays exactly
                         * where it was: a kitchen with an empty book still must not be stuck at the
                         * loading bay.
                         */}
                        <Stack space="sm" testID="kitchen-procurement-suppliers">
                            <Inline space="sm" align="center" justify="between" wrap>
                                <Stack space="none">
                                    <Heading level={2} testID="kitchen-procurement-suppliers-title">
                                        {t('kitchen:ops.procurement.suppliersTitle')}
                                    </Heading>
                                    <Text
                                        tone="secondary"
                                        variant="caption"
                                        testID="kitchen-procurement-supplier-count"
                                    >
                                        {supplierRows.length === 0
                                            ? t('kitchen:ops.procurement.noSuppliers')
                                            : t('kitchen:ops.suppliers.supplierCount', {
                                                  count: supplierRows.length,
                                              })}
                                    </Text>
                                </Stack>
                                <Button
                                    testID="kitchen-procurement-manage-suppliers"
                                    size="sm"
                                    variant="ghost"
                                    label={t('kitchen:ops.procurement.manageSuppliers')}
                                    onPress={() => {
                                        router.push('/kitchen/suppliers' as never);
                                    }}
                                />
                            </Inline>
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
                    <Inline space="sm" align="start" wrap>
                        {/*
                         * "New supplier" belongs to the picker above it, not between the two fields
                         * of a wrapping row — there it read as a third field with no label, and it
                         * pushed the document reference onto a line of its own. A ghost button
                         * under the control it feeds is the shape of an action *about* that field.
                         */}
                        <Stack space="xs" className="min-w-[220px] flex-1">
                            <Select
                                testID="kitchen-procurement-post-supplier"
                                label={t('kitchen:ops.procurement.fieldSupplier')}
                                options={supplierOptions}
                                value={supplierId}
                                onChange={setSupplierId}
                                searchable
                            />
                            {canManage ? (
                                <Button
                                    testID="kitchen-procurement-post-new-supplier"
                                    size="sm"
                                    variant="ghost"
                                    iconStart={<Icon name="plus" size="sm" />}
                                    label={t('kitchen:ops.procurement.newSupplier')}
                                    onPress={() => {
                                        setCreatingSupplier(true);
                                    }}
                                />
                            ) : null}
                        </Stack>
                        <TextInputField
                            testID="kitchen-procurement-post-document-ref"
                            label={t('kitchen:ops.procurement.fieldDocumentRef')}
                            value={documentRef}
                            onChangeText={setDocumentRef}
                            className="min-w-[180px] flex-1"
                        />
                    </Inline>
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
                        unitPriceLabel={t('kitchen:ops.procurement.fieldLineUnitPrice', {
                            currency: RECEIPT_CURRENCY,
                        })}
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
                    {/*
                     * No currency picker. It was only ever a hint the receipt form pre-selected,
                     * and the receipt now books in RECEIPT_CURRENCY regardless — a picker whose
                     * answer changes nothing is a question that should not be asked.
                     */}
                    <Inline space="sm" align="start" wrap>
                        <TextInputField
                            testID="kitchen-procurement-supplier-name"
                            label={t('kitchen:ops.procurement.fieldSupplierName')}
                            value={newSupplierName}
                            onChangeText={setNewSupplierName}
                            className="min-w-[200px] flex-1"
                        />
                        <TextInputField
                            testID="kitchen-procurement-supplier-code"
                            label={t('kitchen:ops.procurement.fieldSupplierCode')}
                            value={newSupplierCode}
                            onChangeText={setNewSupplierCode}
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
