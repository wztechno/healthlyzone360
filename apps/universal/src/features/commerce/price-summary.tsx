import { Inline, Stack, Text } from '@healthy360/design-system';
import type { Money } from '@healthy360/domain-types';
import { useFormatter } from '@healthy360/i18n';
import { useTranslation } from 'react-i18next';

import { formatMoney } from '../marketplace/format.ts';

/**
 * A priced breakdown, rendered as a definition list.
 *
 * ## Why every figure goes through the formatter
 *
 * `Money` is integer minor units, and three of the currencies this platform quotes in — KWD, BHD,
 * OMR — have **three** of them. Printing `amount` with a decimal point assumed at two digits is
 * wrong by a factor of ten for a third of the launch markets, so nothing here ever touches
 * `amount` directly: `formatMoney` divides by the currency's own exponent and hands the result to
 * `Intl`.
 *
 * ## Why there is no total row built here
 *
 * Adding lines together is the caller's business, and the caller does not do it either — every
 * total on these screens is the one the repository computed. A client that sums a list of
 * `PriceLine`s would eventually sum two currencies, and the answer would look perfectly plausible.
 */
export interface PriceRow {
    readonly key: string;
    readonly label: string;
    readonly amount: Money;
    /** Renders in the emphasised style used for the figure a person is deciding on. */
    readonly emphasis?: boolean | undefined;
    /** Extra explanation under the row — "12 deliveries", "10 % off a four-week commitment". */
    readonly note?: string | undefined;
}

export interface PriceSummaryProps {
    readonly rows: readonly PriceRow[];
    readonly testID: string;
    /** Caption under the list, e.g. that the figures come from a preview and reserve nothing. */
    readonly caption?: string | undefined;
}

export function PriceSummary({ rows, testID, caption }: PriceSummaryProps) {
    const { t } = useTranslation();
    const formatter = useFormatter();

    return (
        <Stack space="xs" testID={testID}>
            {rows.map((row) => (
                <Stack key={row.key} space="none" testID={`${testID}-${row.key}`}>
                    <Inline space="sm" align="center" justify="between">
                        <Text variant={row.emphasis === true ? 'bodyStrong' : 'body'}>
                            {row.label}
                        </Text>
                        <Text
                            testID={`${testID}-${row.key}-amount`}
                            variant={row.emphasis === true ? 'bodyStrong' : 'body'}
                        >
                            {formatMoney(formatter, row.amount)}
                        </Text>
                    </Inline>
                    {row.note === undefined ? null : (
                        <Text tone="secondary" variant="caption">
                            {row.note}
                        </Text>
                    )}
                </Stack>
            ))}
            {caption === undefined ? null : (
                <Text tone="secondary" variant="caption" testID={`${testID}-caption`}>
                    {caption}
                </Text>
            )}
            <Text tone="secondary" variant="caption" testID={`${testID}-no-payment`}>
                {t('commerce:common.noPayment')}
            </Text>
        </Stack>
    );
}
