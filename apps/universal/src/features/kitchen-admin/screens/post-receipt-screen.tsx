import type {
    ItemLatestPurchase,
    MeasurementUnitOption,
    ReceivableOrder,
} from '@healthy360/api-client/contracts';
import {
    Badge,
    Button,
    Callout,
    Checkbox,
    Dialog,
    FormGrid,
    FormIssueScope,
    FormSection,
    FormSkeleton,
    Icon,
    PickerField,
    Select,
    Stack,
    Text,
    TextInputField,
    useToast,
} from '@healthy360/design-system';
import type { FormIssueItem, SelectOption } from '@healthy360/design-system';
import { StockItemId, SupplierId } from '@healthy360/domain-types';
import { useFormatter, useLocale } from '@healthy360/i18n';
import { useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';
import type { LayoutChangeEvent } from 'react-native';

import { Gate, useCan } from '../../../access/gate.tsx';
import { toFailure } from '../../../data/hooks.ts';
import {
    useCreateSupplierMutation,
    useItemLatestPurchasesQuery,
    usePostGoodsReceiptMutation,
    useProcurementReferenceQuery,
    useReceivableOrdersQuery,
    useStockItemsQuery,
    useSuppliersQuery,
} from '../../../data/kitchen-ops-hooks.ts';
import { useAccessState, useSession } from '../../../session/session-provider.tsx';
import { INVENTORY_MANAGE_PERMISSION, INVENTORY_VIEW_COSTS_PERMISSION } from '../entity-registry.ts';
import { focusField } from '../field-focus.ts';
import { displayName } from '../format.ts';
import { ChoiceTiles } from '../choice-tiles.tsx';
import { useKitchenTrailLeaf } from '../kitchen-ops-shell.tsx';
import { purchaseOrderStatusKey, stockItemLabel } from '../ops-format.ts';
import {
    StockItemLineEditor,
    emptyStockItemLine,
    stockItemLineFieldId,
    stockItemLineWellFormed,
    stockItemLinesToReceiptInputs,
    stockItemLinesTotal,
} from '../ops-line-editor.tsx';
import type {
    StockItemLineDraft,
    StockItemLineField,
    StockItemLinePriceNote,
} from '../ops-line-editor.tsx';
import { readAmount, readQuantity, todayIsoDate } from '../receive-delivery-model.ts';
import { RecordFormOpening } from '../record-form-opening.tsx';
import { useUnsavedGuard } from '../use-unsaved-guard.ts';

/**
 * `/kitchen/procurement/new` — post a goods receipt (O2, SUP5, INV1.1), from the Post Receipt design.
 *
 * ```
 * Post a goods receipt  ⚠ Unsaved                                     [ Cancel ] [ Post receipt ]
 * ✖ 2 things to fix before this can post  [ Line 2 — quantity ] [ Date received — after today ]
 * ┌ WHAT ARRIVED ──────────────────────────────────────┐  ┌ THIS RECEIPT ────────────┐
 * │ (•) A market purchase    ( ) A delivery against an order │ Kind      Market purchase │
 * └────────────────────────────────────────────────────┘  │ Supplier  Beqaa Fresh     │
 * ┌ RECEIPT ───────────────────────────────────────────┐  │ Total        318.30 USD   │
 * │ Supplier [ BEQAA — Beqaa Fresh ▾ ]  Delivery note [ ] │ ─────────────────────────  │
 * │ + New supplier                                      │  │ Stock at Beirut rises by │
 * │ Invoice number [ Not arrived yet ]  Date received [ ] │ Chicken breast   +24 kg  │
 * └────────────────────────────────────────────────────┘  │ ⚠ 1 line has no price…   │
 * ┌ LINES  3 lines · 1 without a price ─────────────────┐  │ ─────────────────────────  │
 * │ Stock item   Quantity  Unit  Unit price  Line total │  │ [      Post receipt     ] │
 * └────────────────────────────────────────────────────┘  └──────────────────────────┘
 * ```
 *
 * ## One page for both ways goods arrive
 *
 * The first question is **what arrived**, because it decides what the rest of the form asks. A
 * *market purchase* was bought without an order: choose the supplier — or none — and type what
 * came. A *delivery against an order* picks the supply order; its supplier comes with it and is
 * shown locked, and every ordered line with something still to come is filled in with that
 * outstanding quantity (§4) and matched to its order line, item and unit fixed. A line can still be
 * removed (it was not on the van) or added (something nobody ordered), and the quantity can go
 * above what is outstanding — the server allows both, but only once somebody says so and says why
 * (§3.5), so either one opens the confirmation and the variance note under the lines.
 *
 * `/kitchen/procurement/receive` stays the delivery page an order's own detail links to, with the
 * invoice charges and the close-short decision a partial delivery can take. This page asks for
 * neither: a delivery posted here leaves the rest of the order open, which is the safe default.
 *
 * ## Summary beside the form, and what posting will do
 *
 * The aside restates the receipt in five facts and, under them, what the shelves will read after —
 * "Stock at Beirut Central rises by" — because posting is the one irreversible act here and the
 * person pressing the button should see its effect beside it. The quantities are in the unit each
 * line was entered in; a conversion here would be a second answer to the server's.
 *
 * ## Refused on press, not before
 *
 * Post is never disabled for an incomplete form. Pressing it names what stops it in the banner
 * under the title — each chip takes the reader to its field — and marks the fields, which a greyed
 * button could not: it only says *no*, never *why*. A price is not one of those things. A line with
 * no price posts and waits in Prices to finish, and the aside says so while there is one.
 *
 * ## Costs
 *
 * Prices are booked in {@link RECEIPT_CURRENCY} and the form offers no way to change that; the price
 * column sits behind `inventory.view_costs_organisation`, so a chef without that code posts
 * quantities only and is told who will add the prices. With it, each price carries what the item
 * last cost, and turns amber when the typed figure is ten per cent or more away from it — the
 * mistake a receiving clerk makes is a decimal point, and that is what the flag is for.
 */

/**
 * The dimensions the server's `UnitConversionService` can convert *between different units* within
 * (INV1.0) — mass and volume carry real `base_ratio` factors; `count`, `serving`, `package`,
 * `energy` and `length` carry an identity 1 and only the same-unit identity converts. Offering a
 * second unit inside a non-convertible dimension would post a receipt the server must reject, so the
 * picker offers alternatives only inside these two.
 */
const CONVERTIBLE_DIMENSIONS: ReadonlySet<string> = new Set(['mass', 'volume']);

/**
 * The one currency a goods receipt's prices are booked in.
 *
 * Fixed, and deliberately not a control: a receipt currency the receiver could change is a currency
 * they can get wrong, and the server refuses a purchase that would blend a second currency into an
 * ingredient's moving average anyway (`MixedIngredientCostCurrency` — there is no exchange rate in
 * this system). It reaches the reader through the unit-price header rather than a disabled picker.
 */
const RECEIPT_CURRENCY = 'USD';

/** A price this far from the last one paid is flagged — the size of a slipped decimal, and less. */
const PRICE_CHANGE_FLAG = 0.1;

/** The aside's fixed track, and the least the form beside it is allowed before the aside drops under. */
const ASIDE_WIDTH = 300;
const FORM_MIN_WIDTH = 620;
const COLUMN_GAP = 16;

const BOOK_ROUTE = '/kitchen/procurement';
const LINES_ID = 'kitchen-procurement-post-lines';

type ArrivalMode = 'market' | 'order';

export function PostReceiptScreen() {
    return (
        <Gate
            area="kitchen"
            requirement={{ allOf: [INVENTORY_MANAGE_PERMISSION] }}
            testID="kitchen-post-receipt"
        >
            <FormIssueScope>
                <PostReceipt />
            </FormIssueScope>
        </Gate>
    );
}

/** One thing that stops the post, with the field it sits on. */
interface ReceiptIssue {
    readonly key: string;
    readonly label: string;
    readonly fieldId?: string | undefined;
}

function PostReceipt() {
    const { t } = useTranslation();
    const formatter = useFormatter();
    const { locale } = useLocale();
    const router = useRouter();
    const toast = useToast();
    const access = useAccessState();
    const { me } = useSession();
    const canManage = useCan(INVENTORY_MANAGE_PERMISSION);
    const canViewCosts = useCan(INVENTORY_VIEW_COSTS_PERMISSION);
    const branchId = access.branch?.id ?? null;

    const title = t('kitchen:ops.procurement.postTitle');
    useKitchenTrailLeaf(title);

    const [mode, setMode] = useState<ArrivalMode>('market');
    const orderMode = mode === 'order';

    const suppliers = useSuppliersQuery();
    const stockItems = useStockItemsQuery();
    const reference = useProcurementReferenceQuery();
    const orders = useReceivableOrdersQuery(branchId, null, orderMode);
    const postReceipt = usePostGoodsReceiptMutation();
    const createSupplier = useCreateSupplierMutation();
    const guard = useUnsavedGuard({ message: t('kitchen:unsaved.browserPrompt') });

    // Each way of arriving keeps its own lines, so looking at the other one and coming back loses
    // nothing. A market purchase opens on one empty line — the first thing anybody does is choose
    // what arrived; a delivery opens on its order's.
    const [marketLines, setMarketLines] = useState<readonly StockItemLineDraft[]>(() => [
        emptyStockItemLine('line-first'),
    ]);
    const [orderLines, setOrderLines] = useState<readonly StockItemLineDraft[]>([]);
    const [orderId, setOrderId] = useState<string | null>(null);
    const [supplierId, setSupplierId] = useState<string | null>(null);
    const [documentRef, setDocumentRef] = useState('');
    const [receivedOn, setReceivedOn] = useState(() => todayIsoDate());
    const [invoiceRef, setInvoiceRef] = useState('');
    const [overConfirmed, setOverConfirmed] = useState(false);
    const [varianceNote, setVarianceNote] = useState('');
    // Problems are shown once Post has been pressed, and follow the form live from then on.
    const [submitted, setSubmitted] = useState(false);
    const [bodyWidth, setBodyWidth] = useState(0);

    const [creatingSupplier, setCreatingSupplier] = useState(false);
    const [newSupplierTried, setNewSupplierTried] = useState(false);
    const [newSupplierName, setNewSupplierName] = useState('');
    const [newSupplierCode, setNewSupplierCode] = useState('');
    const [newSupplierEmail, setNewSupplierEmail] = useState('');
    const [newSupplierPhone, setNewSupplierPhone] = useState('');

    const lines = orderMode ? orderLines : marketLines;
    const setLines = orderMode ? setOrderLines : setMarketLines;
    const referenceData = reference.data ?? null;

    /** Every edit marks the page dirty, so Cancel and a navigation away both ask first. */
    const edited =
        <Value,>(set: (value: Value) => void) =>
        (value: Value) => {
            set(value);
            guard.markDirty();
        };

    // Suppliers are bilingual since SUP1, so the picker labels them in the reader's own language
    // and falls back to the other side rather than showing an empty option.
    const supplierNameById = useMemo(() => {
        const map = new Map<string, string>();
        for (const row of suppliers.data ?? []) {
            map.set(String(row.id), displayName(row.name, locale).value);
        }
        return map;
    }, [suppliers.data, locale]);

    const orderRows = useMemo(() => orders.data ?? [], [orders.data]);
    const order = useMemo<ReceivableOrder | null>(
        () => orderRows.find((row) => String(row.id) === orderId) ?? null,
        [orderRows, orderId],
    );
    const orderSupplierId = order?.supplier == null ? null : String(order.supplier.id);

    const supplierOptions = useMemo(() => {
        const options: SelectOption<string>[] = (suppliers.data ?? []).map((row) => ({
            value: String(row.id),
            label: `${row.code} — ${displayName(row.name, locale).value}`,
        }));
        // An order's supplier is shown even when the book has since archived it.
        if (
            order?.supplier != null &&
            !options.some((option) => option.value === String(order.supplier?.id))
        ) {
            options.push({
                value: String(order.supplier.id),
                label: `${order.supplier.code} — ${order.supplier.nameEn}`,
            });
        }
        return options;
    }, [suppliers.data, locale, order]);

    const orderOptions = useMemo(
        () =>
            orderRows.map((row) => ({
                value: String(row.id),
                label: t('kitchen:ops.procurement.orderOption', {
                    number: row.number,
                    supplier:
                        row.supplier === null
                            ? t('kitchen:ops.procurement.noSupplier')
                            : (supplierNameById.get(String(row.supplier.id)) ??
                              row.supplier.nameEn),
                    status: t(purchaseOrderStatusKey(row.status)),
                    outstanding: t('kitchen:ops.procurement.orderOutstanding', {
                        count: row.outstandingLineCount,
                    }),
                }),
            })),
        [orderRows, supplierNameById, t],
    );

    // A user without the cost permission carries no currency and posts quantities only.
    const currencyCode = canViewCosts ? RECEIPT_CURRENCY : null;
    const formatAmount = (amount: number) =>
        formatter.formatNumber(amount, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

    // Unit reference, indexed so the line editor can resolve a stock item's own unit and offer only
    // the units in its dimension. A stock item names its unit by code; the reference gives that
    // code an id and a dimension.
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

    const itemById = useMemo(() => {
        const map = new Map<string, { readonly unitCode: string; readonly name: string }>();
        for (const item of stockItems.data ?? []) {
            map.set(String(item.id), { unitCode: item.unitCode, name: item.nameEn });
        }
        return map;
    }, [stockItems.data]);

    function itemOwnUnitCode(stockItemId: string | null): string | null {
        if (stockItemId === null) return null;
        return itemById.get(stockItemId)?.unitCode ?? null;
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

    /** A human unit label — the resolved unit's code, or the item's own. */
    function unitLabelFor(stockItemId: string | null, unitId: string | null): string {
        if (unitId !== null) {
            const code = unitById.get(unitId);
            if (code !== undefined) return code;
        }
        return itemOwnUnitCode(stockItemId) ?? '';
    }

    /*
     * Mapped in the order the server gave them and **never re-sorted** (INV2.0). Every ingredient in
     * the library has a shelf, so this picker is hundreds of rows long, and the server ranks the
     * ones this kitchen actually holds or has ever moved to the top. The type-ahead handles the tail.
     */
    const stockItemOptions = useMemo(
        () =>
            (stockItems.data ?? []).map((item) => ({
                value: String(item.id),
                label: stockItemLabel(item),
            })),
        [stockItems.data],
    );

    /*
     * What each chosen item last cost, for the note under its price. Asked for the picked items
     * only — the picker holds every shelf in the library — and only for somebody who can read
     * money: without the cost code the answer would be all redactions.
     */
    const pickedItemIds = useMemo(
        () =>
            [
                ...new Set(
                    lines
                        .map((line) => line.stockItemId)
                        .filter((id): id is string => id !== null),
                ),
            ]
                .sort()
                .map((id) => StockItemId.unsafe(id)),
        [lines],
    );
    const latestPurchases = useItemLatestPurchasesQuery(pickedItemIds, canViewCosts);
    const latestByItem = useMemo(() => {
        const map = new Map<string, ItemLatestPurchase>();
        for (const row of latestPurchases.data ?? []) map.set(String(row.stockItemId), row);
        return map;
    }, [latestPurchases.data]);

    function priceNoteFor(line: StockItemLineDraft): StockItemLinePriceNote | null {
        if (line.stockItemId === null || !latestPurchases.isSuccess) return null;
        const last = latestByItem.get(line.stockItemId);
        // Absent is *never bought here*; present with a null amount is a redaction, shown as nothing.
        if (last === undefined) {
            return { text: t('kitchen:ops.procurement.neverBought'), tone: 'secondary' };
        }
        if (last.unitPriceAmount === null) return null;

        const lastPrice = Number(last.unitPriceAmount);
        const foreign = last.costCurrencyCode !== null && last.costCurrencyCode !== RECEIPT_CURRENCY;
        const lastText = `${formatAmount(lastPrice)}${foreign ? ` ${String(last.costCurrencyCode)}` : ''}`;
        const lastUnit = last.unitCode ?? itemOwnUnitCode(line.stockItemId) ?? '';
        const typed = readAmount(line.unitPrice ?? '');

        // Compared only like with like: the same currency, quoted per the same unit.
        const comparable =
            typed !== null &&
            !foreign &&
            lastPrice > 0 &&
            lastUnit === unitLabelFor(line.stockItemId, line.unitId ?? null);
        if (comparable) {
            const change = (typed - lastPrice) / lastPrice;
            if (Math.abs(change) >= PRICE_CHANGE_FLAG) {
                return {
                    text: t('kitchen:ops.procurement.priceChange', {
                        change: formatter.formatNumber(change, {
                            style: 'percent',
                            maximumFractionDigits: 0,
                            signDisplay: 'exceptZero',
                        }),
                        price: lastText,
                    }),
                    tone: 'warning',
                };
            }
        }
        return {
            text: t('kitchen:ops.procurement.lastPaid', { price: lastText, unit: lastUnit }),
            tone: 'secondary',
        };
    }

    /** The order's still-to-come lines as rows, each tied to its order line. */
    function linesFromOrder(next: ReceivableOrder): readonly StockItemLineDraft[] {
        return next.lines
            .filter((line) => Number(line.outstandingQuantity) > 0)
            .map((line) => ({
                key: `order-line-${line.purchaseOrderLineId}`,
                stockItemId: String(line.stockItemId),
                quantity: line.outstandingQuantity,
                unitId: line.unitId ?? defaultUnitIdForItem(String(line.stockItemId)),
                unitPrice: '',
                purchaseOrderLineId: line.purchaseOrderLineId,
                outstandingQuantity: line.outstandingQuantity,
            }));
    }

    function chooseOrder(next: string | null) {
        setOrderId(next);
        const chosen = orderRows.find((row) => String(row.id) === next) ?? null;
        // A different order is a different delivery: carrying quantities or a confirmation across
        // would attach one supplier's pallet to another's paperwork.
        setOrderLines(chosen === null ? [] : linesFromOrder(chosen));
        setOverConfirmed(false);
        setVarianceNote('');
        guard.markDirty();
    }

    // What an order delivery has to say out loud (§3.5): more than was outstanding, or an item that
    // was never on the order.
    const overLines = orderMode
        ? lines.filter(
              (line) =>
                  line.purchaseOrderLineId != null &&
                  (readQuantity(line.quantity) ?? 0) > Number(line.outstandingQuantity ?? '0'),
          )
        : [];
    const hasOverReceipt = overLines.length > 0;
    const hasUnplannedLine =
        orderMode &&
        lines.some((line) => line.purchaseOrderLineId == null && line.stockItemId !== null);
    const needsVarianceNote = hasOverReceipt || hasUnplannedLine;

    // ISO dates compare as strings. The goods cannot have arrived tomorrow.
    const receivedInFuture = receivedOn.trim() !== '' && receivedOn > todayIsoDate();

    const lineIssues = new Map<string, Partial<Record<StockItemLineField, string>>>();
    const issues: ReceiptIssue[] = [];
    if (orderMode && order === null) {
        issues.push({
            key: 'order',
            label: t('kitchen:ops.procurement.issueNoOrder'),
            fieldId: 'kitchen-procurement-post-order',
        });
    }
    if (lines.length === 0 && !(orderMode && order === null)) {
        issues.push({ key: 'lines', label: t('kitchen:ops.procurement.issueNoLines') });
    }
    lines.forEach((line, index) => {
        if (stockItemLineWellFormed(line)) return;
        const missing: StockItemLineField[] = [];
        if (line.stockItemId === null) missing.push('item');
        if (!((readQuantity(line.quantity) ?? 0) > 0)) missing.push('quantity');
        lineIssues.set(line.key, {
            ...(missing.includes('item')
                ? { item: t('kitchen:ops.procurement.lineItemMissing') }
                : {}),
            ...(missing.includes('quantity')
                ? { quantity: t('kitchen:ops.procurement.lineQuantityMissing') }
                : {}),
        });
        // A chip per field rather than per line: a chip stands for one field, takes the reader to
        // it, and is what lets that field drop its own message while the banner says it.
        for (const field of missing) {
            issues.push({
                key: `line-${line.key}-${field}`,
                label: t('kitchen:ops.procurement.issueLine', {
                    line: index + 1,
                    fields: t(
                        field === 'item'
                            ? 'kitchen:ops.procurement.issueFieldItem'
                            : 'kitchen:ops.procurement.issueFieldQuantity',
                    ),
                }),
                fieldId: stockItemLineFieldId(LINES_ID, line.key, field),
            });
        }
    });
    if (receivedInFuture) {
        issues.push({ key: 'date', label: t('kitchen:ops.procurement.issueDateFuture') });
    }
    if (hasOverReceipt && !overConfirmed) {
        issues.push({
            key: 'over',
            label: t('kitchen:ops.procurement.issueOverReceipt'),
            fieldId: 'kitchen-procurement-post-over-confirm',
        });
    }
    if (needsVarianceNote && varianceNote.trim() === '') {
        issues.push({
            key: 'note',
            label: t('kitchen:ops.procurement.issueVarianceNote'),
            fieldId: 'kitchen-procurement-post-variance-note',
        });
    }

    const shownIssues = submitted ? issues : [];
    const shownLineIssues = submitted ? lineIssues : undefined;
    const postFailure = toFailure(postReceipt.error);

    // The aside's figures.
    const risingLines = lines.filter(stockItemLineWellFormed);
    const unpricedCount = canViewCosts
        ? risingLines.filter((line) => readAmount(line.unitPrice ?? '') === null).length
        : 0;
    const receiptTotal = stockItemLinesTotal(lines);
    const branchName = useMemo(() => {
        if (access.branch === undefined) return null;
        for (const membership of me?.memberships ?? []) {
            const found = membership.branches.find(
                (candidate) => String(candidate.id) === String(access.branch?.id),
            );
            if (found !== undefined) return found.name;
        }
        return null;
    }, [me, access.branch]);

    const shownSupplierId = orderMode ? orderSupplierId : supplierId;
    const supplierName =
        shownSupplierId === null
            ? t('kitchen:ops.procurement.summaryNoSupplier')
            : (supplierNameById.get(shownSupplierId) ??
              order?.supplier?.nameEn ??
              t('kitchen:ops.procurement.summaryNoSupplier'));

    const postLabel = orderMode
        ? t('kitchen:ops.procurement.postDelivery')
        : t('kitchen:ops.procurement.postReceipt');

    const backToBook = () => {
        router.push(BOOK_ROUTE as never);
    };

    function attemptPost() {
        setSubmitted(true);
        if (branchId === null || issues.length > 0) return;

        const trimmedOrNull = (value: string) => (value.trim() === '' ? null : value.trim());
        const orderSupplier = order?.supplier == null ? null : String(order.supplier.id);
        const postedSupplier = orderMode ? orderSupplier : supplierId;
        const risen = risingLines.length;

        postReceipt.mutate(
            {
                branchId,
                supplierId: postedSupplier === null ? null : SupplierId.unsafe(postedSupplier),
                documentRef: trimmedOrNull(documentRef),
                supplierInvoiceRef: trimmedOrNull(invoiceRef),
                receivedOn: trimmedOrNull(receivedOn),
                purchaseOrderId: orderMode && order !== null ? order.id : null,
                ...(orderMode
                    ? {
                          overReceiptConfirmed: hasOverReceipt && overConfirmed,
                          varianceNote: needsVarianceNote ? trimmedOrNull(varianceNote) : null,
                      }
                    : {}),
                lines: stockItemLinesToReceiptInputs(lines, currencyCode).map((line) => ({
                    stockItemId: StockItemId.unsafe(line.stockItemId),
                    quantity: line.quantity,
                    ...(line.unitId === undefined ? {} : { unitId: line.unitId }),
                    ...(line.purchaseOrderLineId === undefined
                        ? {}
                        : { purchaseOrderLineId: line.purchaseOrderLineId }),
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
                    guard.markClean();
                    toast.show({
                        testID: 'kitchen-procurement-posted-toast',
                        tone: 'success',
                        message: t('kitchen:ops.procurement.postedToast', { count: risen }),
                    });
                    // Back to the book, where the receipt now is. `replace`, so Back does not
                    // return to a form whose receipt has already been posted.
                    router.replace(BOOK_ROUTE as never);
                },
            },
        );
    }

    function closeCreateSupplier() {
        setCreatingSupplier(false);
        setNewSupplierTried(false);
        setNewSupplierName('');
        setNewSupplierCode('');
        setNewSupplierEmail('');
        setNewSupplierPhone('');
        createSupplier.reset();
    }

    function submitNewSupplier() {
        setNewSupplierTried(true);
        if (newSupplierName.trim() === '') return;
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
                    // Chosen on the receipt in progress — the reason it was created here.
                    setSupplierId(String(supplier.id));
                    guard.markDirty();
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

    /*
     * Beside or under. The summary sits beside the form wherever the form keeps its 620px, and
     * under it on anything narrower, where a fixed column would squeeze the lines table.
     */
    const sideBySide = bodyWidth >= ASIDE_WIDTH + FORM_MIN_WIDTH + COLUMN_GAP;
    const loading = stockItems.isPending || reference.isPending;

    const issueItems: FormIssueItem[] = shownIssues.map((issue) => ({
        key: issue.key,
        label: issue.label,
        fieldId: issue.fieldId,
        onPress: () => {
            if (issue.fieldId !== undefined) focusField(issue.fieldId);
        },
    }));

    return (
        <Stack space="md" testID="kitchen-post-receipt-screen">
            <RecordFormOpening
                testID="kitchen-post-receipt-screen"
                title={title}
                dirty={guard.isDirty}
                errors={{
                    summary: t('kitchen:ops.procurement.issuesSummary', {
                        count: shownIssues.length,
                    }),
                    items: issueItems,
                }}
                actions={
                    <>
                        <Button
                            testID="kitchen-procurement-post-cancel"
                            variant="secondary"
                            label={t('kitchen:editor.cancel')}
                            onPress={() => {
                                guard.intercept(backToBook);
                            }}
                        />
                        <Button
                            testID="kitchen-procurement-post-confirm"
                            label={postLabel}
                            loading={postReceipt.isPending}
                            disabled={loading || postReceipt.isPending}
                            onPress={attemptPost}
                        />
                    </>
                }
            />

            {loading ? (
                <FormSkeleton
                    testID="kitchen-post-receipt-loading"
                    heading={false}
                    sections={3}
                    fields={2}
                />
            ) : (
                <View
                    onLayout={(event: LayoutChangeEvent) => {
                        setBodyWidth(event.nativeEvent.layout.width);
                    }}
                    className={
                        sideBySide ? 'z-auto flex-row items-start gap-base' : 'z-auto flex-col gap-base'
                    }
                >
                    {/* The form is the row's filler beside the fixed summary. */}
                    <View className="z-auto min-w-0 flex-1 flex-col gap-base">
                        {postFailure === null ? null : (
                            <Callout
                                testID="kitchen-procurement-post-error"
                                tone="danger"
                                role="alert"
                                title={t('kitchen:ops.procurement.postFailed')}
                                body={postFailure.message}
                            />
                        )}

                        <FormSection
                            first
                            variant="card"
                            testID="kitchen-post-receipt-arrival-section"
                            title={t('kitchen:ops.procurement.arrivalSection')}
                            aside={
                                <Text variant="caption" tone="secondary">
                                    {t('kitchen:ops.procurement.arrivalAside')}
                                </Text>
                            }
                        >
                            <ChoiceTiles<ArrivalMode>
                                testID="kitchen-post-receipt-arrival"
                                label={t('kitchen:ops.procurement.arrivalSection')}
                                tiles={[
                                    {
                                        value: 'market',
                                        title: t('kitchen:ops.procurement.modeMarketTitle'),
                                        body: t('kitchen:ops.procurement.modeMarketBody'),
                                    },
                                    {
                                        value: 'order',
                                        title: t('kitchen:ops.procurement.modeOrderTitle'),
                                        body: t('kitchen:ops.procurement.modeOrderBody'),
                                    },
                                ]}
                                value={mode}
                                onChange={(next) => {
                                    setMode(next);
                                    guard.markDirty();
                                }}
                            />
                        </FormSection>

                        <FormSection
                            first
                            variant="card"
                            testID="kitchen-post-receipt-details"
                            title={t('kitchen:ops.procurement.receiptSection')}
                        >
                            {/* The design's two 280px tracks, the order spanning both above them. */}
                            <Stack space="md">
                                {orderMode ? (
                                    orders.isPending ? (
                                        <Text variant="caption" tone="secondary">
                                            {t('kitchen:ops.procurement.ordersLoading')}
                                        </Text>
                                    ) : orderRows.length === 0 ? (
                                        <Callout
                                            testID="kitchen-procurement-post-orders-empty"
                                            tone="info"
                                            title={t('kitchen:ops.receiving.emptyTitle')}
                                            body={t('kitchen:ops.receiving.emptyBody')}
                                        />
                                    ) : (
                                        <View className="max-w-[580px]">
                                            <Select
                                                testID="kitchen-procurement-post-order"
                                                id="kitchen-procurement-post-order"
                                                label={t('kitchen:ops.procurement.fieldOrder')}
                                                size="sm"
                                                options={orderOptions}
                                                value={orderId}
                                                onChange={chooseOrder}
                                                fullWidth
                                                {...(submitted && order === null
                                                    ? { error: t('kitchen:ops.procurement.issueNoOrder') }
                                                    : {})}
                                                searchable
                                            />
                                        </View>
                                    )
                                ) : null}
                                <FormGrid maxColumns={2} testID="kitchen-post-receipt-details-grid">
                                    <Stack space="xs">
                                        <Select
                                            testID="kitchen-procurement-post-supplier"
                                            label={t('kitchen:ops.procurement.fieldSupplier')}
                                            size="sm"
                                            placeholder={t(
                                                'kitchen:ops.procurement.supplierPlaceholder',
                                            )}
                                            options={supplierOptions}
                                            value={shownSupplierId}
                                            onChange={edited(setSupplierId)}
                                            // An order brings its supplier; the paperwork is this
                                            // delivery's.
                                            disabled={orderMode}
                                            searchable
                                        />
                                        {/*
                                         * "New supplier" belongs to the picker above it: a ghost
                                         * button under the control it feeds is the shape of an
                                         * action *about* that field.
                                         */}
                                        {canManage && !orderMode ? (
                                            <View className="flex-row">
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
                                            </View>
                                        ) : null}
                                    </Stack>
                                    <TextInputField
                                        testID="kitchen-procurement-post-document-ref"
                                        label={t('kitchen:ops.procurement.fieldDeliveryNote')}
                                        size="sm"
                                        value={documentRef}
                                        onChangeText={edited(setDocumentRef)}
                                    />
                                    <TextInputField
                                        testID="kitchen-procurement-post-invoice-ref"
                                        label={t('kitchen:ops.procurement.fieldInvoiceRef')}
                                        placeholder={t(
                                            'kitchen:ops.procurement.invoicePlaceholder',
                                        )}
                                        size="sm"
                                        value={invoiceRef}
                                        onChangeText={edited(setInvoiceRef)}
                                    />
                                    {/*
                                     * The compact date control — a 28px box with the browser's own
                                     * calendar behind its glyph. It takes no `max`, so a date after
                                     * today is refused here, where it was typed.
                                     */}
                                    <PickerField
                                        kind="date"
                                        testID="kitchen-procurement-post-received-on"
                                        label={t('kitchen:ops.procurement.fieldReceivedOn')}
                                        value={receivedOn}
                                        error={
                                            receivedInFuture
                                                ? t('kitchen:ops.procurement.receivedOnFuture')
                                                : undefined
                                        }
                                        onChange={(next) => {
                                            setReceivedOn(next);
                                            guard.markDirty();
                                        }}
                                    />
                                </FormGrid>
                            </Stack>
                        </FormSection>

                        <FormSection
                            first
                            variant="card"
                            testID="kitchen-post-receipt-lines"
                            title={t('kitchen:ops.procurement.linesSection')}
                            aside={
                                <View className="min-w-0 flex-1 flex-row items-center justify-between gap-tight">
                                    <Text
                                        variant="caption"
                                        tone="secondary"
                                        testID="kitchen-post-receipt-line-count"
                                    >
                                        {unpricedCount > 0
                                            ? t('kitchen:ops.procurement.lineCountUnpriced', {
                                                  lines: t('kitchen:ops.procurement.lineCount', {
                                                      count: lines.length,
                                                  }),
                                                  count: unpricedCount,
                                              })
                                            : t('kitchen:ops.procurement.lineCount', {
                                                  count: lines.length,
                                              })}
                                    </Text>
                                    {canViewCosts ? null : (
                                        <Badge
                                            variant="label"
                                            tone="neutral"
                                            icon={null}
                                            testID="kitchen-post-receipt-quantities-only"
                                            label={t('kitchen:ops.procurement.quantitiesOnly')}
                                        />
                                    )}
                                </View>
                            }
                        >
                            <Stack space="md">
                                <StockItemLineEditor
                                    testID={LINES_ID}
                                    lines={lines}
                                    onChange={edited(setLines)}
                                    stockItemOptions={stockItemOptions}
                                    itemLabel={t('kitchen:ops.procurement.fieldLineItem')}
                                    quantityLabel={t('kitchen:ops.procurement.fieldLineQuantity')}
                                    addLabel={t('kitchen:ops.procurement.addLine')}
                                    removeLabel={t('kitchen:ops.procurement.removeLine')}
                                    rowFieldLabel={(field, line) =>
                                        t('kitchen:ops.procurement.lineFieldLabel', { field, line })
                                    }
                                    withUnit
                                    unitLabel={t('kitchen:ops.procurement.fieldLineUnit')}
                                    unitPlaceholder={t('kitchen:list.noValue')}
                                    unitOptionsForItem={unitOptionsForItem}
                                    defaultUnitIdForItem={defaultUnitIdForItem}
                                    unitLabelFor={unitLabelFor}
                                    withCost={canViewCosts}
                                    unitPriceLabel={t('kitchen:ops.procurement.fieldLineUnitPrice', {
                                        currency: RECEIPT_CURRENCY,
                                    })}
                                    unitPricePlaceholder={t(
                                        'kitchen:ops.procurement.pricePlaceholder',
                                    )}
                                    lineTotalLabel={t('kitchen:ops.procurement.lineTotal')}
                                    receiptTotalLabel={t('kitchen:ops.procurement.receiptTotal')}
                                    formatMoney={formatAmount}
                                    priceNoteFor={priceNoteFor}
                                    issues={shownLineIssues}
                                />

                                {/*
                                 * §3.5: an over-receipt takes a confirmation *and* a note — one
                                 * records that somebody said so, the other what they knew. An item
                                 * that was never on the order takes the note.
                                 */}
                                {needsVarianceNote ? (
                                    <Callout
                                        tone="warning"
                                        testID="kitchen-procurement-post-variance"
                                        title={t(
                                            hasOverReceipt
                                                ? 'kitchen:ops.receiving.overReceiptTitle'
                                                : 'kitchen:ops.procurement.unplannedTitle',
                                        )}
                                    >
                                        <Stack space="sm">
                                            <Text>
                                                {t('kitchen:ops.receiving.overReceiptBody')}
                                            </Text>
                                            {hasOverReceipt ? (
                                                <Checkbox
                                                    testID="kitchen-procurement-post-over-confirm"
                                                    id="kitchen-procurement-post-over-confirm"
                                                    checked={overConfirmed}
                                                    label={t(
                                                        'kitchen:ops.receiving.overReceiptConfirm',
                                                    )}
                                                    onChange={edited(setOverConfirmed)}
                                                />
                                            ) : null}
                                            <TextInputField
                                                testID="kitchen-procurement-post-variance-note"
                                                id="kitchen-procurement-post-variance-note"
                                                label={t('kitchen:ops.receiving.fieldVarianceNote')}
                                                hint={t(
                                                    'kitchen:ops.receiving.fieldVarianceNoteHint',
                                                )}
                                                size="sm"
                                                required
                                                value={varianceNote}
                                                onChangeText={edited(setVarianceNote)}
                                            />
                                        </Stack>
                                    </Callout>
                                ) : null}
                            </Stack>
                        </FormSection>
                    </View>

                    <ReceiptSummary
                        width={sideBySide ? ASIDE_WIDTH : null}
                        rows={[
                            {
                                key: 'kind',
                                label: t('kitchen:ops.procurement.summaryKind'),
                                value:
                                    orderMode && order !== null
                                        ? t('kitchen:ops.procurement.kindOrder', {
                                              number: order.number,
                                          })
                                        : orderMode
                                          ? t('kitchen:ops.procurement.kindOrderUnpicked')
                                          : t('kitchen:ops.procurement.kindMarket'),
                            },
                            {
                                key: 'supplier',
                                label: t('kitchen:ops.procurement.fieldSupplier'),
                                value: supplierName,
                            },
                            {
                                key: 'received',
                                label: t('kitchen:ops.procurement.columnReceivedAt'),
                                value:
                                    receivedOn.trim() === ''
                                        ? '—'
                                        : formatter.formatDate(receivedOn, { dateStyle: 'medium' }),
                            },
                            {
                                key: 'lines',
                                label: t('kitchen:ops.procurement.columnLines'),
                                value: formatter.formatNumber(lines.length),
                            },
                        ]}
                        total={
                            canViewCosts
                                ? `${formatAmount(receiptTotal)} ${RECEIPT_CURRENCY}`
                                : null
                        }
                        risesTitle={
                            branchName === null
                                ? t('kitchen:ops.procurement.risesTitleNoBranch')
                                : t('kitchen:ops.procurement.risesTitle', { branch: branchName })
                        }
                        rises={risingLines.map((line) => ({
                            key: line.key,
                            name: itemById.get(line.stockItemId ?? '')?.name ?? '',
                            quantity: t('kitchen:ops.procurement.risesQuantity', {
                                quantity: formatter.formatNumber(readQuantity(line.quantity) ?? 0, {
                                    maximumFractionDigits: 3,
                                }),
                                unit: unitLabelFor(line.stockItemId, line.unitId ?? null),
                            }),
                        }))}
                        note={
                            canViewCosts ? (
                                unpricedCount > 0 ? (
                                    <Callout
                                        testID="kitchen-post-receipt-unpriced-note"
                                        tone="warning"
                                        icon="coins"
                                        title={t('kitchen:ops.procurement.unpricedNote', {
                                            count: unpricedCount,
                                        })}
                                    />
                                ) : null
                            ) : (
                                <Callout
                                    testID="kitchen-post-receipt-quantities-note"
                                    tone="info"
                                    title={t('kitchen:ops.procurement.quantitiesOnlyNote')}
                                />
                            )
                        }
                        action={
                            <Button
                                testID="kitchen-procurement-post-submit"
                                label={postLabel}
                                block
                                loading={postReceipt.isPending}
                                disabled={postReceipt.isPending}
                                onPress={attemptPost}
                            />
                        }
                    />
                </View>
            )}

            <Dialog
                testID="kitchen-procurement-supplier-dialog"
                open={creatingSupplier}
                onClose={closeCreateSupplier}
                title={t('kitchen:ops.procurement.newSupplierTitle')}
                description={t('kitchen:ops.procurement.newSupplierBody')}
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
                            label={t('kitchen:ops.procurement.newSupplierSave')}
                            loading={createSupplier.isPending}
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
                     * No currency picker: the receipt books in RECEIPT_CURRENCY regardless, and a
                     * picker whose answer changes nothing is a question that should not be asked.
                     * The line under the fields says so instead.
                     */}
                    <FormGrid maxColumns={2} testID="kitchen-procurement-supplier-grid">
                        <TextInputField
                            testID="kitchen-procurement-supplier-name"
                            label={t('kitchen:ops.procurement.fieldSupplierName')}
                            placeholder={t('kitchen:ops.procurement.supplierNamePlaceholder')}
                            size="sm"
                            value={newSupplierName}
                            onChangeText={setNewSupplierName}
                            {...(newSupplierTried && newSupplierName.trim() === ''
                                ? { error: t('kitchen:ops.procurement.supplierNameRequired') }
                                : {})}
                        />
                        <TextInputField
                            testID="kitchen-procurement-supplier-code"
                            label={t('kitchen:ops.procurement.fieldSupplierCode')}
                            placeholder={t('kitchen:ops.procurement.supplierCodePlaceholder')}
                            size="sm"
                            value={newSupplierCode}
                            onChangeText={setNewSupplierCode}
                        />
                        <TextInputField
                            testID="kitchen-procurement-supplier-email"
                            label={t('kitchen:ops.procurement.fieldSupplierEmail')}
                            size="sm"
                            value={newSupplierEmail}
                            onChangeText={setNewSupplierEmail}
                            keyboardType="email-address"
                        />
                        <TextInputField
                            testID="kitchen-procurement-supplier-phone"
                            label={t('kitchen:ops.procurement.fieldSupplierPhone')}
                            size="sm"
                            value={newSupplierPhone}
                            onChangeText={setNewSupplierPhone}
                            keyboardType="phone-pad"
                        />
                    </FormGrid>
                    <Text variant="caption" tone="secondary">
                        {t('kitchen:ops.procurement.supplierCurrencyNote', {
                            currency: RECEIPT_CURRENCY,
                        })}
                    </Text>
                </Stack>
            </Dialog>

            <Dialog
                testID="kitchen-post-receipt-screen-unsaved-dialog"
                open={guard.isPrompting}
                onClose={guard.cancelDiscard}
                title={t('kitchen:ops.procurement.discardTitle')}
                description={t('kitchen:ops.procurement.discardBody', { count: lines.length })}
                actions={
                    <>
                        <Button
                            testID="kitchen-post-receipt-screen-unsaved-keep"
                            variant="quiet"
                            label={t('kitchen:unsaved.keepEditing')}
                            onPress={guard.cancelDiscard}
                        />
                        <Button
                            testID="kitchen-post-receipt-screen-unsaved-discard"
                            variant="danger"
                            label={t('kitchen:common.discard')}
                            onPress={guard.confirmDiscard}
                        />
                    </>
                }
            />
        </Stack>
    );
}

/* ------------------------------------------------------------------------------------------------
 * The summary
 * ---------------------------------------------------------------------------------------------- */

/**
 * The aside: this receipt in a few facts, what the shelves will read after it, and the post.
 *
 * One card rather than three, its parts divided by hairlines, because it is read top to bottom as
 * one statement — this is what you are posting, this is what it does, post it.
 */
function ReceiptSummary({
    width,
    rows,
    total,
    risesTitle,
    rises,
    note,
    action,
}: {
    /** A fixed column beside the form, or `null` to run the full width under it. */
    readonly width: number | null;
    readonly rows: readonly { readonly key: string; readonly label: string; readonly value: string }[];
    /** The receipt's total with its currency, or `null` for a reader who cannot see money. */
    readonly total: string | null;
    readonly risesTitle: string;
    readonly rises: readonly { readonly key: string; readonly name: string; readonly quantity: string }[];
    readonly note: ReactNode;
    readonly action: ReactNode;
}) {
    const { t } = useTranslation();

    return (
        <View
            testID="kitchen-post-receipt-summary"
            role="complementary"
            aria-label={t('kitchen:ops.procurement.summaryTitle')}
            style={width === null ? undefined : { width }}
            className="z-auto self-start web:sticky web:top-0"
        >
            <FormSection
                first
                variant="card"
                testID="kitchen-post-receipt-summary-card"
                title={t('kitchen:ops.procurement.summaryTitle')}
            >
                <View className="flex-col gap-base">
                    <View className="flex-col gap-snug">
                        {rows.map((row) => (
                            <View
                                key={row.key}
                                testID={`kitchen-post-receipt-summary-${row.key}`}
                                className="flex-row items-baseline justify-between gap-tight"
                            >
                                <Text variant="caption" tone="secondary" numberOfLines={1}>
                                    {row.label}
                                </Text>
                                <Text
                                    variant="caption"
                                    align="end"
                                    numberOfLines={1}
                                    className="min-w-0 shrink font-medium tabular-nums"
                                >
                                    {row.value}
                                </Text>
                            </View>
                        ))}
                        {total === null ? null : (
                            <View className="mt-hair flex-row items-baseline justify-between gap-tight border-t border-stroke-subtle pt-tight">
                                <Text variant="label">{t('kitchen:ops.procurement.receiptTotal')}</Text>
                                <Text
                                    testID="kitchen-post-receipt-summary-total"
                                    variant="title"
                                    className="tabular-nums"
                                >
                                    {total}
                                </Text>
                            </View>
                        )}
                    </View>

                    <View className="flex-col gap-snug border-t border-stroke-subtle pt-base">
                        <Text variant="strong">{risesTitle}</Text>
                        {rises.length === 0 ? (
                            <Text
                                variant="caption"
                                tone="secondary"
                                testID="kitchen-post-receipt-rises-empty"
                            >
                                {t('kitchen:ops.procurement.risesEmpty')}
                            </Text>
                        ) : (
                            <View testID="kitchen-post-receipt-rises" className="flex-col gap-hair">
                                {rises.map((rise) => (
                                    <View
                                        key={rise.key}
                                        className="flex-row items-baseline justify-between gap-tight"
                                    >
                                        <Text
                                            variant="caption"
                                            numberOfLines={1}
                                            className="min-w-0 shrink"
                                        >
                                            {rise.name}
                                        </Text>
                                        <Text
                                            variant="caption"
                                            tone="success"
                                            className="font-semibold tabular-nums"
                                        >
                                            {rise.quantity}
                                        </Text>
                                    </View>
                                ))}
                            </View>
                        )}
                    </View>

                    {note}

                    <View className="flex-col gap-tight border-t border-stroke-subtle pt-base">
                        {action}
                        <Text variant="micro" tone="secondary">
                            {t('kitchen:ops.procurement.postFoot')}
                        </Text>
                    </View>
                </View>
            </FormSection>
        </View>
    );
}
