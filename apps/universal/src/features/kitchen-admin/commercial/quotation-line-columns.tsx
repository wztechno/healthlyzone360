import type { KitchenQuotationLine } from '@healthy360/api-client/contracts';
import { Text, TextInputField } from '@healthy360/design-system';
import type { CurrencyCode } from '@healthy360/domain-types';
import type { Formatter } from '@healthy360/i18n';
import type { TFunction } from 'i18next';
import { View } from 'react-native';

import { formatMoney } from '../../marketplace/format.ts';
import { compareNumber, compareText } from '../catalogue/use-column-controls.tsx';
import type { CatalogueColumn } from '../catalogue/catalogue-column-spec.ts';
import type { ControlledColumn, SortDirection } from '../catalogue/use-column-controls.tsx';
import { displayName, parseMinorAmount } from '../format.ts';

/**
 * One quotation line — line · quantity · corporate rate · unit price · derived total (Commercial
 * handoff §2.2 `QuotationLineRow`, plus the corporate rate the owner asked for on 2026-11-23).
 *
 * A column spec for `DataList` rather than a row component, because the list already owns the row
 * geometry and a second row shape would be a second table. The four cells are what the handoff's row
 * names, in its order.
 *
 * ## An unpriced line says so in danger ink, never as an empty cell
 *
 * While editing, a line with no parseable price carries the input's error state and its total reads
 * `Not priced`. The total is derived from what is typed — quantity × unit, in minor units — so the
 * reader sees the consequence of the figure before sending it. Zero is a price; empty is not.
 *
 * ## Every header sorts, and the money sorts by what is on record
 *
 * The lines are the whole quotation — the detail read answers every one — so sorting them in memory
 * is the complete answer. Line sorts by the article's name in the reader's language, the buyer's
 * note standing in when the article is gone; Quantity by its number.
 *
 * Unit price and Line total sort by the **recorded** figures, not by what is being typed. A sort that
 * followed the inputs would move a row out from under the cursor on every keystroke; while a
 * quotation is still being priced nothing is on record, so those two headers leave the buyer's order
 * alone until it is. An unpriced line sorts last either way — it is not a zero.
 */

/** Minor-unit amounts in `direction`, `null` (not priced) last both ways. */
function compareAmount(
    left: number | null,
    right: number | null,
    direction: SortDirection,
): number {
    if (left === null || right === null) return left === right ? 0 : left === null ? 1 : -1;
    return compareNumber(left, right, direction);
}
export interface QuotationLineColumnDeps {
    readonly t: TFunction;
    readonly formatter: Formatter;
    readonly locale: string;
    readonly currency: CurrencyCode;
    /** Draft prices by line id, as typed. `undefined` when the quotation is read-only. */
    readonly prices: Readonly<Record<string, string>> | undefined;
    readonly onPrice: (lineId: string, value: string) => void;
}

export function quotationLineColumns({
    t,
    formatter,
    locale,
    currency,
    prices,
    onPrice,
}: QuotationLineColumnDeps): readonly ControlledColumn<
    KitchenQuotationLine,
    CatalogueColumn<KitchenQuotationLine>
>[] {
    const editing = prices !== undefined;

    const lineName = (line: KitchenQuotationLine): string | null =>
        line.itemName === null ? line.note : displayName(line.itemName, locale).value;

    const typedMinor = (line: KitchenQuotationLine): number | null => {
        const raw = prices?.[line.id] ?? '';
        return raw === '' ? null : parseMinorAmount(raw, currency);
    };

    return [
        {
            key: 'line',
            role: 'title',
            label: t('kitchen:ops.quotations.lineColumn'),
            width: 220,
            priority: 100,
            sort: (left, right, direction) =>
                compareText(lineName(left), lineName(right), direction),
            render: (line) => (
                <View className="min-w-0 flex-col py-1">
                    <Text
                        variant="strong"
                        numberOfLines={1}
                        testID={`kitchen-quotation-line-${line.id}-name`}
                    >
                        {lineName(line) ?? t('kitchen:ops.quotations.lineUnnamed')}
                    </Text>
                    {line.itemName !== null && line.note !== null ? (
                        <Text tone="secondary" numberOfLines={1}>
                            {line.note}
                        </Text>
                    ) : null}
                </View>
            ),
        },
        {
            key: 'quantity',
            label: t('kitchen:ops.quotations.lineQuantity'),
            width: 110,
            priority: 80,
            sort: (left, right, direction) =>
                compareNumber(Number(left.quantity), Number(right.quantity), direction),
            render: (line) => (
                <Text variant="mono" testID={`kitchen-quotation-line-${line.id}-quantity`}>
                    {formatter.formatNumber(Number(line.quantity))}
                </Text>
            ),
        },
        {
            // Today's corporate rate — what the buyer's catalogue showed them — beside the price
            // being named, so the two can be compared. A reference, never the quote: the price
            // box beside it still starts empty.
            key: 'corporateRate',
            label: t('kitchen:ops.quotations.lineCorporateRate'),
            width: 140,
            priority: 85,
            sort: (left, right, direction) =>
                compareAmount(
                    left.corporateUnitAmountMinor,
                    right.corporateUnitAmountMinor,
                    direction,
                ),
            render: (line) => (
                <Text
                    variant="mono"
                    tone={line.corporateUnitAmountMinor === null ? 'secondary' : 'primary'}
                    testID={`kitchen-quotation-line-${line.id}-corporate-rate`}
                >
                    {line.corporateUnitAmountMinor === null
                        ? t('kitchen:ops.quotations.lineNoCorporateRate')
                        : formatMoney(formatter, {
                              amount: line.corporateUnitAmountMinor,
                              currency,
                          })}
                </Text>
            ),
        },
        {
            key: 'unitPrice',
            label: t('kitchen:ops.quotations.lineUnitPrice'),
            width: 150,
            priority: 95,
            sort: (left, right, direction) =>
                compareAmount(left.unitAmountMinor, right.unitAmountMinor, direction),
            render: (line) => {
                if (!editing) {
                    return (
                        <Text
                            variant="mono"
                            tone={line.unitAmountMinor === null ? 'danger' : 'primary'}
                            testID={`kitchen-quotation-line-${line.id}-unit-price`}
                        >
                            {line.unitAmountMinor === null
                                ? t('kitchen:ops.quotations.lineNotPriced')
                                : formatMoney(formatter, {
                                      amount: line.unitAmountMinor,
                                      currency,
                                  })}
                        </Text>
                    );
                }
                const raw = prices[line.id] ?? '';
                const invalid = raw !== '' && parseMinorAmount(raw, currency) === null;
                return (
                    <TextInputField
                        testID={`kitchen-quotation-line-${line.id}-price`}
                        id={`kitchen-quotation-line-${line.id}-price`}
                        label={t('kitchen:ops.quotations.linePriceLabel', {
                            line: line.lineNumber,
                        })}
                        labelHidden
                        // The cell is a column with `items-start`, and the field's control has no
                        // intrinsic width: unless it stretches across the cell it shrinks to its
                        // border (~18px) and can be neither read nor clicked. `flex-1` grew it
                        // down the column, not across it.
                        className="self-stretch"
                        size="sm"
                        placeholder={t('kitchen:fields.unitPricePlaceholder')}
                        value={raw}
                        onChangeText={(next) => {
                            onPrice(line.id, next);
                        }}
                        inputMode="decimal"
                        autoCapitalize="none"
                        autoCorrect={false}
                        // Only a malformed figure is an error. An empty one is announced by the total
                        // beside it, in words and danger ink — `FormField` draws an error row for any
                        // defined message, and an empty one would be an icon with nothing to say.
                        error={invalid ? t('kitchen:ops.quotations.linePriceInvalid') : undefined}
                    />
                );
            },
        },
        {
            key: 'lineTotal',
            role: 'metric',
            label: t('kitchen:ops.quotations.lineTotal'),
            width: 130,
            priority: 90,
            sort: (left, right, direction) =>
                compareAmount(left.lineTotalMinor, right.lineTotalMinor, direction),
            render: (line) => {
                const unit = editing ? typedMinor(line) : line.unitAmountMinor;
                const totalMinor =
                    unit === null
                        ? null
                        : editing
                          ? Math.round(Number(line.quantity) * unit)
                          : line.lineTotalMinor;
                return (
                    <Text
                        variant="mono"
                        tone={totalMinor === null ? 'danger' : 'primary'}
                        testID={`kitchen-quotation-line-${line.id}-total`}
                    >
                        {totalMinor === null
                            ? t('kitchen:ops.quotations.lineNotPriced')
                            : formatMoney(formatter, { amount: totalMinor, currency })}
                    </Text>
                );
            },
        },
    ];
}
