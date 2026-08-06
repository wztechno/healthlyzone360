import { Button, Inline, Select, Stack, TextInputField } from '@healthy360/design-system';
import type { SelectOption } from '@healthy360/design-system';

/**
 * One draft row in a repeatable stock-item-and-quantity list — a goods receipt line, a production
 * order's consumed or yielded quantities. `key` is a client-only identity for React's list
 * reconciliation; it never reaches the wire (`GoodsReceiptLineInput` / `ProductionMovementInput`
 * carry only `stockItemId` and `quantity`).
 */
export interface StockItemLineDraft {
    readonly key: string;
    readonly stockItemId: string | null;
    readonly quantity: string;
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
}: StockItemLineEditorProps) {
    function updateLine(key: string, patch: Partial<StockItemLineDraft>) {
        onChange(lines.map((line) => (line.key === key ? { ...line, ...patch } : line)));
    }

    function removeLine(key: string) {
        onChange(lines.filter((line) => line.key !== key));
    }

    function addLine() {
        onChange([...lines, emptyStockItemLine(`${testID}-line-${String(lines.length + 1)}-${String(Date.now())}`)]);
    }

    return (
        <Stack space="sm" testID={testID}>
            {lines.map((line, index) => (
                <Inline key={line.key} space="sm" align="start" wrap testID={`${testID}-row-${String(index)}`}>
                    <Select
                        testID={`${testID}-row-${String(index)}-item`}
                        label={itemLabel}
                        options={stockItemOptions}
                        value={line.stockItemId}
                        onChange={(value) => {
                            updateLine(line.key, { stockItemId: value });
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
            <Button testID={`${testID}-add`} variant="secondary" size="sm" label={addLabel} onPress={addLine} />
        </Stack>
    );
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
        .map((line) => ({ stockItemId: line.stockItemId as string, quantity: Number(line.quantity) }));
}
