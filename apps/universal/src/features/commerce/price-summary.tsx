import { Icon, Inline, Stack, Text } from '@healthy360/design-system';
import type { Money } from '@healthy360/domain-types';
import { useFormatter } from '@healthy360/i18n';
import { useTranslation } from 'react-i18next';
import { Text as RNText, View } from 'react-native';

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

export interface PlanReceiptProps {
    /** The run's own figures, as the server priced them. Nothing here is summed on the client. */
    readonly perDayList: Money;
    readonly deliveryCount: number;
    readonly gross: Money;
    /** The duration discount, when the run earns one. */
    readonly discount?: { readonly percent: number; readonly amount: Money } | undefined;
    readonly total: Money;
    readonly perDelivery?: Money | undefined;
    readonly testID: string;
}

/**
 * The plan's price as a receipt (Shop · Plan setup, pin 3): the day price times the delivery days,
 * the duration discount with its percent, then one big total with what it comes to per delivery
 * day, and "Nothing is charged online" as the receipt's foot. The total is said once here; the
 * summary beside the step carries the other.
 *
 * The testIDs are `PriceSummary`'s row keys (`-gross-amount`, `-discount-amount`, `-total-amount`,
 * `-per-delivery-amount`, `-no-payment`), so what the tests read did not move.
 */
export function PlanReceipt({
    perDayList,
    deliveryCount,
    gross,
    discount,
    total,
    perDelivery,
    testID,
}: PlanReceiptProps) {
    const { t } = useTranslation();
    const formatter = useFormatter();

    return (
        <View
            testID={testID}
            className="rounded-[20px] border border-stroke-subtle bg-surface-base px-[18px] pt-1.5"
        >
            <View
                testID={`${testID}-gross`}
                className="flex-row items-baseline justify-between gap-3 py-2.5"
            >
                <RNText className="shrink text-sm text-content-secondary text-start">
                    <RNText
                        testID={`${testID}-per-day-list-amount`}
                        className="font-semibold text-content-primary"
                    >
                        {formatMoney(formatter, perDayList)}
                    </RNText>
                    {` ${t('commerce:configurator.receipt.times', { count: deliveryCount })}`}
                </RNText>
                <RNText
                    testID={`${testID}-gross-amount`}
                    className="text-base font-semibold tabular-nums text-content-primary"
                >
                    {formatMoney(formatter, gross)}
                </RNText>
            </View>
            {discount === undefined ? null : (
                <View
                    testID={`${testID}-discount`}
                    className="flex-row items-center justify-between gap-3 py-2.5"
                >
                    <View className="shrink flex-row items-center gap-1.5">
                        <RNText className="text-sm text-content-secondary text-start">
                            {t('commerce:configurator.receipt.discount')}
                        </RNText>
                        <View className="h-[22px] justify-center rounded-full bg-surface-brand-subtle px-2">
                            <RNText className="text-xs font-bold text-content-on-brand-subtle">
                                {t('commerce:configurator.receipt.percent', {
                                    percent: formatter.formatNumber(discount.percent),
                                })}
                            </RNText>
                        </View>
                    </View>
                    <RNText
                        testID={`${testID}-discount-amount`}
                        className="text-base font-semibold tabular-nums text-content-on-brand-subtle"
                    >
                        {formatMoney(formatter, discount.amount)}
                    </RNText>
                </View>
            )}
            <View
                testID={`${testID}-total`}
                className="mt-1 flex-row items-end justify-between gap-3 border-t border-dashed border-stroke pb-4 pt-3.5"
            >
                <View className="shrink">
                    <RNText className="text-sm font-semibold text-content-primary text-start">
                        {t('commerce:configurator.summary.total')}
                    </RNText>
                    {perDelivery === undefined ? null : (
                        <RNText
                            testID={`${testID}-per-delivery`}
                            className="mt-0.5 text-xs text-content-secondary text-start"
                        >
                            <RNText testID={`${testID}-per-delivery-amount`}>
                                {formatMoney(formatter, perDelivery)}
                            </RNText>
                            {` ${t(
                                discount === undefined
                                    ? 'commerce:configurator.receipt.perDay'
                                    : 'commerce:configurator.receipt.perDayAfter',
                            )}`}
                        </RNText>
                    )}
                </View>
                <RNText
                    testID={`${testID}-total-amount`}
                    className="font-display text-3xl font-bold tabular-nums tracking-display text-content-primary"
                >
                    {formatMoney(formatter, total)}
                </RNText>
            </View>
            <View className="-mx-[18px] flex-row items-center gap-2 rounded-b-[20px] border-t border-stroke-subtle bg-surface-raised px-[18px] py-[11px]">
                <Icon name="banknote" size="md" className="text-content-on-brand-subtle" />
                <RNText
                    testID={`${testID}-no-payment`}
                    className="shrink text-sm text-content-secondary text-start"
                >
                    {t('commerce:common.noPayment')}
                </RNText>
            </View>
        </View>
    );
}
