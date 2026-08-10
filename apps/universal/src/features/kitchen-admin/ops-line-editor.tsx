import { Button, Inline, Select, Stack, Text, TextInputField } from '@healthy360/design-system';
import type { SelectOption } from '@healthy360/design-system';

/**
 * One draft row in a repeatable stock-item-and-quantity list — a goods receipt line, a production
 * order's consumed or yielded quantities. `key` is a client-only identity for React's list
 * reconciliation; it never reaches the wire (`GoodsReceiptLineInput` / `ProductionMovementInput`
 * carry only `stockItemId`, `quantity` and, for a receipt, an optional `unitPriceAmount`).
 *
 * `unitPrice` is captured only by the goods-receipt form (INV1.1), where `withCost` is set; the
 * production-order form leaves it untouched and never renders the column.
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
}

export function emptyStockItemLine(key: string): StockItemLineDraft {
    return { key, stockItemId: null, quantity: '' };
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
     * When set, each row captures a purchase unit (INV1.1). The picker offers only the units in the
     * stock item's own dimension, defaulting to its own unit; when a single unit is available the
     * label is still shown beside the quantity, so a quantity is never a bare number.
     */
    readonly withUnit?: boolean;
    readonly unitLabel?: string;
    /** The units offered for a given stock item — same dimension only. Required when `withUnit`. */
    readonly unitOptionsForItem?: (stockItemId: string | null) => readonly SelectOption<string>[];
    /** The stock item's own unit id, the default a fresh line takes. Required when `withUnit`. */
    readonly defaultUnitIdForItem?: (stockItemId: string | null) => string | null;
    /** A human label for the resolved unit, shown when there is no picker (single/zero options). */
    readonly unitLabelFor?: (stockItemId: string | null, unitId: string | null) => string;
    /** When set, each row also captures a unit price and shows a running line total (INV1.1). */
    readonly withCost?: boolean;
    readonly unitPriceLabel?: string;
    /** Renders a per-row line total and the receipt total: `(quantity, unitPrice) => formatted`. */
    readonly formatMoney?: (amount: number) => string;
}

/**
 * A repeatable stock-item + quantity list, shared between the goods-receipt form (O2) and the
 * production-order completion form (O5) — both send exactly this shape
 * (`GoodsReceiptLineInput[]` / `ProductionMovementInput[]`), so one editor covers both rather than
 * two screens each growing their own add/remove bookkeeping.
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
    withUnit = false,
    unitLabel,
    unitOptionsForItem,
    defaultUnitIdForItem,
    unitLabelFor,
    withCost = false,
    unitPriceLabel,
    formatMoney,
}: StockItemLineEditorProps) {
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
    const receiptTotal = withCost ? lines.reduce((sum, line) => sum + lineTotal(line), 0) : 0;

    return (
        <Stack space="sm" testID={testID}>
            {lines.map((line, index) => (
                <Inline
                    key={line.key}
                    space="sm"
                    align="start"
                    wrap
                    testID={`${testID}-row-${String(index)}`}
                >
                    <Select
                        testID={`${testID}-row-${String(index)}-item`}
                        label={itemLabel}
                        options={stockItemOptions}
                        value={line.stockItemId}
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
                        className="min-w-[220px] flex-1"
                    />
                    <TextInputField
                        testID={`${testID}-row-${String(index)}-quantity`}
                        label={quantityLabel}
                        value={line.quantity}
                        onChangeText={(value) => {
                            updateLine(line.key, { quantity: value });
                        }}
                        keyboardType="decimal-pad"
                        className="w-28"
                    />
                    {withUnit
                        ? renderUnit({
                              testID: `${testID}-row-${String(index)}-unit`,
                              label: unitLabel ?? '',
                              stockItemId: line.stockItemId,
                              unitId:
                                  line.unitId ?? defaultUnitIdForItem?.(line.stockItemId) ?? null,
                              options: unitOptionsForItem?.(line.stockItemId) ?? [],
                              onChange: (value) => {
                                  updateLine(line.key, { unitId: value });
                              },
                              labelFor: unitLabelFor,
                          })
                        : null}
                    {withCost ? (
                        <TextInputField
                            testID={`${testID}-row-${String(index)}-unit-price`}
                            label={unitPriceLabel ?? ''}
                            value={line.unitPrice ?? ''}
                            onChangeText={(value) => {
                                updateLine(line.key, { unitPrice: value });
                            }}
                            keyboardType="decimal-pad"
                            className="w-28"
                        />
                    ) : null}
                    {withCost ? (
                        <Text
                            testID={`${testID}-row-${String(index)}-line-total`}
                            variant="bodyStrong"
                            tone="secondary"
                        >
                            {lineTotal(line) === 0 ? '—' : money(lineTotal(line))}
                        </Text>
                    ) : null}
                    <Button
                        testID={`${testID}-row-${String(index)}-remove`}
                        variant="ghost"
                        size="sm"
                        label={removeLabel}
                        onPress={() => {
                            removeLine(line.key);
                        }}
                    />
                </Inline>
            ))}
            {withCost ? (
                <Inline space="sm" align="center" justify="end">
                    <Text testID={`${testID}-receipt-total`} variant="bodyStrong">
                        {receiptTotal === 0 ? '—' : money(receiptTotal)}
                    </Text>
                </Inline>
            ) : null}
            <Button
                testID={`${testID}-add`}
                variant="secondary"
                size="sm"
                label={addLabel}
                onPress={addLine}
            />
        </Stack>
    );
}

interface RenderUnitArgs {
    readonly testID: string;
    readonly label: string;
    readonly stockItemId: string | null;
    readonly unitId: string | null;
    readonly options: readonly SelectOption<string>[];
    readonly onChange: (value: string | null) => void;
    readonly labelFor?: ((stockItemId: string | null, unitId: string | null) => string) | undefined;
}

/**
 * The per-line unit control. When the stock item's dimension offers more than one unit it is a
 * picker; when it offers one (or none, e.g. a `count` item that cannot cross-convert), the unit is
 * shown as a static label beside the quantity — so a quantity is never a bare number, exactly as the
 * receipt form promises, whether or not there was ever a choice to make.
 */
function renderUnit({
    testID,
    label,
    stockItemId,
    unitId,
    options,
    onChange,
    labelFor,
}: RenderUnitArgs) {
    if (options.length > 1) {
        return (
            <Select
                testID={testID}
                label={label}
                options={options}
                value={unitId}
                onChange={onChange}
                className="w-28"
            />
        );
    }

    const text = labelFor?.(stockItemId, unitId) ?? '';

    return (
        <Text testID={`${testID}-label`} variant="body" tone="secondary">
            {text === '' ? '—' : text}
        </Text>
    );
}

/** quantity × unit price for one row, or `0` when either is missing or non-positive. */
function lineTotal(line: StockItemLineDraft): number {
    const quantity = Number(line.quantity);
    const price = Number(line.unitPrice ?? '');
    if (!Number.isFinite(quantity) || !Number.isFinite(price) || quantity <= 0 || price < 0) {
        return 0;
    }
    return quantity * price;
}

/**
 * `true` once every line names an item and carries a strictly positive quantity. An empty list is
 * well-formed by this measure — callers that require at least one line (a goods receipt) check
 * `lines.length > 0` themselves; callers where an empty section is meaningful (a production order
 * that only consumed, or only yielded) do not.
 */
export function stockItemLinesWellFormed(lines: readonly StockItemLineDraft[]): boolean {
    return lines.every((line) => {
        if (line.stockItemId === null) return false;
        const parsed = Number(line.quantity);
        return line.quantity.trim() !== '' && Number.isFinite(parsed) && parsed > 0;
    });
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
 * purchase `unitId` whenever the line resolved one, plus an optional `unitPriceAmount` and its
 * `costCurrencyCode`.
 *
 * The `unitId` is sent whenever it is known — the picker's value or the item's own default — so a
 * quantity is booked against the unit it was entered in rather than silently assumed to be the
 * stock unit. The price is sent whenever the line carries a positive one **and** a currency is
 * available; with a receipt-level currency that is now always resolvable for a cost-permitted user,
 * so a typed price is no longer silently dropped. A blank price is still omitted rather than sent as
 * zero — an unpriced line is a legal receipt line that moves stock without touching cost.
 */
export function stockItemLinesToReceiptInputs(
    lines: readonly StockItemLineDraft[],
    currencyCode: string | null,
): readonly {
    stockItemId: string;
    quantity: number;
    unitId?: string;
    unitPriceAmount?: number;
    costCurrencyCode?: string;
}[] {
    return lines
        .filter((line) => line.stockItemId !== null && line.quantity.trim() !== '')
        .map((line) => {
            const price = Number(line.unitPrice ?? '');
            const priced =
                line.unitPrice !== undefined &&
                line.unitPrice.trim() !== '' &&
                Number.isFinite(price) &&
                price >= 0 &&
                currencyCode !== null;

            const unitId = line.unitId ?? null;

            return {
                stockItemId: line.stockItemId as string,
                quantity: Number(line.quantity),
                ...(unitId === null ? {} : { unitId }),
                ...(priced ? { unitPriceAmount: price, costCurrencyCode: currencyCode } : {}),
            };
        });
}
