import type { KitchenQuotationLine } from '@healthy360/api-client/contracts';
import { Text, TextInputField } from '@healthy360/design-system';
import type { DataListColumn } from '@healthy360/design-system';
import type { CurrencyCode } from '@healthy360/domain-types';
import type { Formatter } from '@healthy360/i18n';
import type { TFunction } from 'i18next';
import { View } from 'react-native';

import { formatMoney } from '../../marketplace/format.ts';
import { parseMinorAmount } from '../format.ts';

/**
 * One quotation line — line · quantity · unit price · derived total (Commercial handoff §2.2
 * `QuotationLineRow`).
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
 */
export interface QuotationLineColumnDeps {
    readonly t: TFunction;
    readonly formatter: Formatter;
    readonly currency: CurrencyCode;
    /** Draft prices by line id, as typed. `undefined` when the quotation is read-only. */
    readonly prices: Readonly<Record<string, string>> | undefined;
    readonly onPrice: (lineId: string, value: string) => void;
}

export function quotationLineColumns({
    t,
    formatter,
    currency,
    prices,
    onPrice,
}: QuotationLineColumnDeps): readonly DataListColumn<KitchenQuotationLine>[] {
    const editing = prices !== undefined;

    const typedMinor = (line: KitchenQuotationLine): number | null => {
        const raw = prices?.[line.id] ?? '';
        return raw === '' ? null : parseMinorAmount(raw, currency);
    };

    return [
        {
            key: 'line',
            label: t('kitchen:ops.quotations.lineColumn'),
            width: 220,
            priority: 100,
            render: (line) => (
                <View className="min-w-0 flex-col py-1">
                    <Text
                        variant="strong"
                        numberOfLines={1}
                        testID={`kitchen-quotation-line-${line.id}-name`}
                    >
                        {line.note ?? t('kitchen:ops.quotations.lineUnnamed')}
                    </Text>
                    <Text variant="mono" tone="secondary" numberOfLines={1}>
                        {line.catalogueItemId}
                    </Text>
                </View>
            ),
        },
        {
            key: 'quantity',
            label: t('kitchen:ops.quotations.lineQuantity'),
            width: 80,
            priority: 80,
            align: 'end',
            grow: false,
            render: (line) => (
                <Text variant="mono" testID={`kitchen-quotation-line-${line.id}-quantity`}>
                    {formatter.formatNumber(Number(line.quantity))}
                </Text>
            ),
        },
        {
            key: 'unitPrice',
            label: t('kitchen:ops.quotations.lineUnitPrice'),
            width: 150,
            priority: 95,
            align: 'end',
            grow: false,
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
                        size="sm"
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
            label: t('kitchen:ops.quotations.lineTotal'),
            width: 130,
            priority: 90,
            align: 'end',
            grow: false,
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
