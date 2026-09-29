import {
    Button,
    DataList,
    Icon,
    IconButton,
    QuantityInput,
    Select,
    Stack,
    TableCellTextContext,
    Text,
} from '@healthy360/design-system';
import type { DataListColumn, SelectOption } from '@healthy360/design-system';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

/**
 * One draft row in a repeatable stock-item-and-quantity list — a goods receipt line. `key` is a
 * client-only identity for React's list reconciliation; it never reaches the wire
 * (`GoodsReceiptLineInput` carries only `stockItemId`, `quantity` and an optional `unitPriceAmount`).
 *
 * `unitPrice` is captured only where `withCost` is set (INV1.1).
 */
export interface StockItemLineDraft {
    readonly key: string;
    readonly stockItemId: string | null;
    readonly quantity: string;
    /**
     * The measurement unit the quantity (and price) is quoted in (INV1.1); only the receipt form
     * sets it, defaulting to the stock item's own unit. `null` until an item is picked.
     */
    readonly unitId?: string | null;
    /** Major-unit price per {@link unitId}; only the receipt form fills it (INV1.1). */
    readonly unitPrice?: string;
    /**
     * The supply-order line this row delivers against (SUP5). Set only on the rows a delivery
     * prefills from its order, and it **locks** the row's item and unit: the order fixed both, and a
     * delivery that could quietly swap either would be matched against the wrong line.
     */
    readonly purchaseOrderLineId?: string | null;
    /** What that order line still had to come, as the server said it — read, never recomputed. */
    readonly outstandingQuantity?: string;
}

export function emptyStockItemLine(key: string): StockItemLineDraft {
    return { key, stockItemId: null, quantity: '' };
}

/** Which of a row's fields a problem sits on — the two a line cannot post without. */
export type StockItemLineField = 'item' | 'quantity';

/** The element id a row's field carries, so an issue chip can take the reader straight to it. */
export function stockItemLineFieldId(
    testID: string,
    key: string,
    field: StockItemLineField,
): string {
    return `${testID}-${key}-${field}`;
}

/** The line under a row's price — what the item last cost, and whether this price is far from it. */
export interface StockItemLinePriceNote {
    readonly text: string;
    readonly tone: 'secondary' | 'warning';
}

export interface StockItemLineEditorProps {
    readonly testID: string;
    readonly lines: readonly StockItemLineDraft[];
    readonly onChange: (lines: readonly StockItemLineDraft[]) => void;
    readonly stockItemOptions: readonly SelectOption<string>[];
    readonly itemLabel: string;
    readonly quantityLabel: string;
    readonly addLabel: string;
    readonly removeLabel: string;
    /**
     * A row's hidden field label — the column's words and which line. The column headers are the
     * visible labels, so each control names itself for a screen reader: forty "Quantity" fields are
     * a form nobody can navigate.
     */
    readonly rowFieldLabel: (field: string, line: number) => string;
    /**
     * When set, each row captures a purchase unit (INV1.1) in a column of its own. The picker
     * offers only the units in the stock item's own dimension, defaulting to its own unit, and is
     * disabled — still showing the unit — when there is only the one to quote in.
     */
    readonly withUnit?: boolean;
    readonly unitLabel?: string;
    /** What the unit box reads before an item is chosen — a dash, not "Choose an option". */
    readonly unitPlaceholder?: string;
    /** The units offered for a given stock item — same dimension only. Required when `withUnit`. */
    readonly unitOptionsForItem?: (stockItemId: string | null) => readonly SelectOption<string>[];
    /** The stock item's own unit id, the default a fresh line takes. Required when `withUnit`. */
    readonly defaultUnitIdForItem?: (stockItemId: string | null) => string | null;
    /** A human label for the resolved unit — what a locked row's unit box shows. */
    readonly unitLabelFor?: (stockItemId: string | null, unitId: string | null) => string;
    /** When set, each row also captures a unit price and shows its line total (INV1.1). */
    readonly withCost?: boolean;
    /** Names the currency the price is booked in — the receipt form has no picker for it. */
    readonly unitPriceLabel?: string;
    /** What an empty price box says — that a price can come later. */
    readonly unitPricePlaceholder?: string;
    /** The line-total column's header. Required when `withCost`. */
    readonly lineTotalLabel?: string;
    /** The words before the receipt's total, under the rows. Required when `withCost`. */
    readonly receiptTotalLabel?: string;
    /** Formats a line total and the receipt total. */
    readonly formatMoney?: (amount: number) => string;
    /** The small line under a row's price, or `null` for none. Only read when `withCost`. */
    readonly priceNoteFor?:
        ((line: StockItemLineDraft) => StockItemLinePriceNote | null) | undefined;
    /**
     * The problems to mark on each row, keyed by line key. The page's issue banner names them, so a
     * field here draws only its invalid border; the message stays for a screen reader.
     */
    readonly issues?: ReadonlyMap<string, Partial<Record<StockItemLineField, string>>> | undefined;
}

/**
 * A repeatable stock-item + quantity list for the goods-receipt page (O2). A production order used
 * to be completed with one of these too; it no longer takes lines at all, because the server
 * derives what a batch consumed and yielded from its recipe.
 *
 * ```
 * Stock item                  Quantity  Unit    Unit price (USD)  Line total
 * [ FLR-01 — Flour     ▾ ]   [   25 ]  [kg ▾]  [        2.00 ]        50.00   ✕
 *                                               Last paid 1.90 / kg
 * [ EGG-01 — Eggs      ▾ ]   [   30 ]  [pcs ]  [       Later ]            —   ✕
 *                                               Never bought
 * [ + Add line ]                                              Total   50.00
 * ```
 *
 * A `DataList` at the Catalogue's small density, one row of `xs` controls per line, rather than a
 * wrapping row of full-height labelled fields: the column headers are the labels, so a receipt of
 * twelve lines reads as a table of twelve lines instead of twelve small forms. Rows are
 * `${testID}-row-${key}`.
 *
 * The Post Receipt design gives the unit and the line total a column each. The unit is a picker in
 * every row — disabled, and still reading "pcs", where there is only the one unit — so the column
 * reads down as a column; the line total is the figure somebody checks against the invoice.
 *
 * With costs on, every cell keeps a caption-high slot under its control, filled only under the
 * price. The row centres its cells, so a slot in one column alone would drop that column's box
 * half a line below the others.
 */
export function StockItemLineEditor({
    testID,
    lines,
    onChange,
    stockItemOptions,
    itemLabel,
    quantityLabel,
    addLabel,
    removeLabel,
    rowFieldLabel,
    withUnit = false,
    unitLabel,
    unitPlaceholder,
    unitOptionsForItem,
    defaultUnitIdForItem,
    unitLabelFor,
    withCost = false,
    unitPriceLabel,
    unitPricePlaceholder,
    lineTotalLabel,
    receiptTotalLabel,
    formatMoney,
    priceNoteFor,
    issues,
}: StockItemLineEditorProps) {
    const { t } = useTranslation();

    function updateLine(key: string, patch: Partial<StockItemLineDraft>) {
        onChange(lines.map((line) => (line.key === key ? { ...line, ...patch } : line)));
    }

    function removeLine(key: string) {
        onChange(lines.filter((line) => line.key !== key));
    }

    function addLine() {
        onChange([
            ...lines,
            emptyStockItemLine(`${testID}-line-${String(lines.length + 1)}-${String(Date.now())}`),
        ]);
    }

    const money = formatMoney ?? ((amount: number) => amount.toFixed(2));
    const receiptTotal = withCost ? stockItemLinesTotal(lines) : 0;
    const position = (line: StockItemLineDraft) =>
        lines.findIndex((entry) => entry.key === line.key) + 1;
    const rowTestId = (line: StockItemLineDraft) => `${testID}-row-${line.key}`;
    const locked = (line: StockItemLineDraft) =>
        line.purchaseOrderLineId !== undefined && line.purchaseOrderLineId !== null;

    /*
     * A control with the row's caption slot under it, when the table has one. `py-hair` in both:
     * the row is only as tall as its box, so without it the first row's fields sit on the header
     * band and each row's on the one above.
     */
    const cell = (control: ReactNode, note: StockItemLinePriceNote | null = null) =>
        withCost ? (
            <View className="min-w-0 flex-1 flex-col gap-hair py-hair">
                {control}
                {/* Out of the cell's text voice: the note is a caption, not the cell's value. */}
                <TableCellTextContext.Provider value={null}>
                    <Text
                        variant="micro"
                        tone={note?.tone ?? 'secondary'}
                        align="end"
                        numberOfLines={1}
                        aria-hidden={note === null}
                    >
                        {note?.text ?? ' '}
                    </Text>
                </TableCellTextContext.Provider>
            </View>
        ) : (
            <View className="min-w-0 flex-1 py-hair">{control}</View>
        );

    const columns: DataListColumn<StockItemLineDraft>[] = [
        {
            key: 'item',
            label: itemLabel,
            width: 240,
            priority: 100,
            render: (line) =>
                cell(
                    <Select
                        testID={`${rowTestId(line)}-item`}
                        id={stockItemLineFieldId(testID, line.key, 'item')}
                        label={rowFieldLabel(itemLabel, position(line))}
                        labelHidden
                        size="xs"
                        options={stockItemOptions}
                        value={line.stockItemId}
                        disabled={locked(line)}
                        {...(issues?.get(line.key)?.item === undefined
                            ? {}
                            : { error: issues.get(line.key)?.item })}
                        onChange={(value) => {
                            updateLine(line.key, {
                                stockItemId: value,
                                // Default the purchase unit to the newly chosen item's own unit; the
                                // picker (when there are alternatives) can still change it.
                                ...(withUnit
                                    ? { unitId: defaultUnitIdForItem?.(value) ?? null }
                                    : {}),
                            });
                        }}
                        searchable
                    />,
                ),
        },
        {
            key: 'quantity',
            label: quantityLabel,
            width: 100,
            priority: 95,
            grow: false,
            align: 'end',
            render: (line) =>
                cell(
                    <QuantityInput
                        testID={`${rowTestId(line)}-quantity`}
                        id={stockItemLineFieldId(testID, line.key, 'quantity')}
                        label={rowFieldLabel(quantityLabel, position(line))}
                        labelHidden
                        size="xs"
                        value={line.quantity}
                        placeholder={t('kitchen:fields.quantityPlaceholder')}
                        {...(issues?.get(line.key)?.quantity === undefined
                            ? {}
                            : { error: issues.get(line.key)?.quantity })}
                        onChangeText={(value) => {
                            updateLine(line.key, { quantity: value });
                        }}
                    />,
                ),
        },
    ];

    if (withUnit) {
        columns.push({
            key: 'unit',
            label: unitLabel ?? '',
            width: 80,
            priority: 92,
            grow: false,
            render: (line) => {
                const unitId = line.unitId ?? defaultUnitIdForItem?.(line.stockItemId) ?? null;
                // A delivery's row quotes in the order line's unit and nothing else.
                const options: readonly SelectOption<string>[] = locked(line)
                    ? unitId === null
                        ? []
                        : [{ value: unitId, label: unitLabelFor?.(line.stockItemId, unitId) ?? '' }]
                    : (unitOptionsForItem?.(line.stockItemId) ?? []);
                return cell(
                    <Select
                        testID={`${rowTestId(line)}-unit`}
                        label={rowFieldLabel(unitLabel ?? '', position(line))}
                        labelHidden
                        size="xs"
                        options={options}
                        value={unitId}
                        {...(unitPlaceholder === undefined ? {} : { placeholder: unitPlaceholder })}
                        disabled={locked(line) || options.length <= 1}
                        onChange={(value) => {
                            updateLine(line.key, { unitId: value });
                        }}
                    />,
                );
            },
        });
    }

    if (withCost) {
        columns.push(
            {
                key: 'unitPrice',
                label: unitPriceLabel ?? '',
                width: 130,
                priority: 90,
                grow: false,
                align: 'end',
                render: (line) =>
                    cell(
                        <QuantityInput
                            testID={`${rowTestId(line)}-unit-price`}
                            label={rowFieldLabel(unitPriceLabel ?? '', position(line))}
                            labelHidden
                            size="xs"
                            value={line.unitPrice ?? ''}
                            {...(unitPricePlaceholder === undefined
                                ? {}
                                : { placeholder: unitPricePlaceholder })}
                            onChangeText={(value) => {
                                updateLine(line.key, { unitPrice: value });
                            }}
                        />,
                        priceNoteFor?.(line) ?? null,
                    ),
            },
            {
                key: 'lineTotal',
                label: lineTotalLabel ?? '',
                width: 100,
                priority: 80,
                grow: false,
                align: 'end',
                render: (line) => {
                    const total = stockItemLineTotal(line);
                    return cell(
                        <Text
                            testID={`${rowTestId(line)}-total`}
                            variant={total === null ? 'mono' : 'strong'}
                            tone={total === null ? 'secondary' : 'primary'}
                            align="end"
                            className="tabular-nums"
                        >
                            {total === null ? '—' : money(total)}
                        </Text>,
                    );
                },
            },
        );
    }

    columns.push({
        key: 'remove',
        label: removeLabel,
        width: 40,
        priority: 85,
        grow: false,
        align: 'center',
        // No visible header: the ✕ says what it does, and "Remove" in a 40px track wrapped a
        // letter pair to a line. The column is still named for a screen reader.
        renderHeader: () => <View accessibilityLabel={removeLabel} />,
        render: (line) =>
            cell(
                <IconButton
                    testID={`${rowTestId(line)}-remove`}
                    label={rowFieldLabel(removeLabel, position(line))}
                    variant="ghost"
                    tone="danger"
                    size="sm"
                    icon={<Icon name="close" size="sm" />}
                    onPress={() => {
                        removeLine(line.key);
                    }}
                />,
            ),
    });

    return (
        <Stack space="sm">
            {lines.length === 0 ? null : (
                <DataList<StockItemLineDraft>
                    testID={testID}
                    label={itemLabel}
                    columns={columns}
                    rows={lines}
                    rowKey={(line) => line.key}
                    density="sm"
                />
            )}
            {/* Add under the rows it adds to, and the receipt's total at the end of the same line. */}
            <View className="flex-row flex-wrap items-center justify-between gap-tight">
                <Button
                    testID={`${testID}-add`}
                    variant="secondary"
                    size="sm"
                    iconStart={<Icon name="plus" size="sm" />}
                    label={addLabel}
                    onPress={addLine}
                />
                {withCost ? (
                    <View className="flex-row items-baseline gap-snug">
                        <Text variant="caption" tone="secondary">
                            {receiptTotalLabel ?? ''}
                        </Text>
                        <Text
                            testID={`${testID}-receipt-total`}
                            variant="section"
                            className="tabular-nums"
                        >
                            {lines.length === 0 ? '—' : money(receiptTotal)}
                        </Text>
                    </View>
                ) : null}
            </View>
        </Stack>
    );
}

/** A quantity or price as typed, or `null` when blank, unreadable or negative. */
function readFigure(raw: string | undefined): number | null {
    if (raw === undefined || raw.trim() === '') return null;
    const parsed = Number(raw.trim());
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

/** quantity × unit price for one row, or `null` while either is missing. */
export function stockItemLineTotal(line: StockItemLineDraft): number | null {
    const quantity = readFigure(line.quantity);
    const price = readFigure(line.unitPrice);
    if (quantity === null || quantity <= 0 || price === null) return null;
    return quantity * price;
}

/** The priced rows summed — an unpriced row adds nothing rather than making the total unknown. */
export function stockItemLinesTotal(lines: readonly StockItemLineDraft[]): number {
    return lines.reduce((sum, line) => sum + (stockItemLineTotal(line) ?? 0), 0);
}

/** `true` when the row names an item and carries a strictly positive quantity. */
export function stockItemLineWellFormed(line: StockItemLineDraft): boolean {
    if (line.stockItemId === null) return false;
    const quantity = readFigure(line.quantity);
    return quantity !== null && quantity > 0;
}

/**
 * `true` once every line names an item and carries a strictly positive quantity. An empty list is
 * well-formed by this measure — callers that require at least one line (a goods receipt) check
 * `lines.length > 0` themselves.
 */
export function stockItemLinesWellFormed(lines: readonly StockItemLineDraft[]): boolean {
    return lines.every(stockItemLineWellFormed);
}

/** Maps well-formed drafts to the wire shape both `GoodsReceiptLineInput` and
 * `ProductionMovementInput` share: a `stockItemId` and a positive numeric `quantity`. */
export function stockItemLinesToInputs(
    lines: readonly StockItemLineDraft[],
): readonly { stockItemId: string; quantity: number }[] {
    return lines
        .filter((line) => line.stockItemId !== null && line.quantity.trim() !== '')
        .map((line) => ({
            stockItemId: line.stockItemId as string,
            quantity: Number(line.quantity),
        }));
}

/**
 * Maps drafts to `GoodsReceiptLineInput`s (INV1.1): the shared `stockItemId`/`quantity`, the
 * purchase `unitId` whenever the line resolved one, the order line it delivers against when it has
 * one, plus an optional `unitPriceAmount` and its `costCurrencyCode`.
 *
 * The `unitId` is sent whenever it is known — the picker's value or the item's own default — so a
 * quantity is booked against the unit it was entered in rather than silently assumed to be the
 * stock unit. The price is sent whenever the line carries one **and** a currency is available. A
 * blank price is omitted rather than sent as zero — an unpriced line is a legal receipt line that
 * moves stock without touching cost.
 */
export function stockItemLinesToReceiptInputs(
    lines: readonly StockItemLineDraft[],
    currencyCode: string | null,
): readonly {
    stockItemId: string;
    quantity: number;
    unitId?: string;
    purchaseOrderLineId?: string;
    unitPriceAmount?: number;
    costCurrencyCode?: string;
}[] {
    return lines
        .filter((line) => line.stockItemId !== null && line.quantity.trim() !== '')
        .map((line) => {
            const price = readFigure(line.unitPrice);
            const priced = price !== null && currencyCode !== null;
            const unitId = line.unitId ?? null;
            const orderLineId = line.purchaseOrderLineId ?? null;

            return {
                stockItemId: line.stockItemId as string,
                quantity: Number(line.quantity),
                ...(unitId === null ? {} : { unitId }),
                ...(orderLineId === null ? {} : { purchaseOrderLineId: orderLineId }),
                ...(priced ? { unitPriceAmount: price, costCurrencyCode: currencyCode } : {}),
            };
        });
}
