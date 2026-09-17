import type {
    OrderDeskQuote,
    OrderDeskQuoteLine,
    OrderDeskRefusal,
} from '@healthy360/api-client/contracts';
import { Callout, Icon, IconButton, Text } from '@healthy360/design-system';
import { useFormatter, useLocale } from '@healthy360/i18n';
import type { ReactNode } from 'react';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { formatMoney } from '../../marketplace/format.ts';
import { displayName } from '../format.ts';
import type { BasketLine } from './basket.ts';
import {
    MAX_LINE_QUANTITY,
    basketKey,
    lineKey,
    quantityAsNumber,
    quantityFromNumber,
    removeLine,
    setQuantity,
} from './basket.ts';
import { DeskAmount, DeskSectionHeading } from './desk-parts.tsx';

/**
 * The sale's basket, beside every step rather than inside one of them.
 *
 * ## Why a rail
 *
 * The wizard used to show the basket on its own step, so an agent choosing a payment method or
 * reading back an address could not see the total they were about to quote. The rail keeps the
 * basket, its price and the way forward in one place for the whole sale: the steps change on the
 * left, and the thing the customer is actually buying stays put on the right.
 *
 * ## It never prices anything itself
 *
 * Every figure is the quote's — line totals, fee, total. Until a quote lands a line reads an em
 * dash, and a line the desk channel refuses reads its refusal while the rest still totals. The
 * rail multiplies nothing: the server rounds once, at the line total, and a client that re-derived
 * it would eventually disagree with the sale it had just quoted.
 *
 * ## The a11y rule it is built around
 *
 * A line holds a quantity stepper and a remove button, so the line itself takes no press — nested
 * interactive content is a serious axe violation.
 */

/** The rail's width, the design's. A style: there is no 264px width token. */
const RAIL_WIDTH = 264;

const EM_DASH = '—';

export interface BasketRailProps {
    readonly lines: readonly BasketLine[];
    /** Non-null once the server has priced the current basket (or a recent one). */
    readonly quote: OrderDeskQuote | null;
    /** The basket has moved on from the quote on screen. */
    readonly quoteStale: boolean;
    readonly quoteFailed: boolean;
    /** The server's own sentence for a failed quote — it usually says exactly what to fix. */
    readonly quoteFailureMessage?: string | undefined;
    readonly onLines: (lines: readonly BasketLine[]) => void;
    /** Back and forward, drawn at the foot of the rail so the way on is beside the total. */
    readonly navigation: ReactNode;
    readonly testID: string;
}

export function BasketRail({
    lines,
    quote,
    quoteStale,
    quoteFailed,
    quoteFailureMessage,
    onLines,
    navigation,
    testID,
}: BasketRailProps) {
    const { t } = useTranslation();
    const { locale } = useLocale();
    const formatter = useFormatter();

    /** The quote's own line for a basket row, once one exists. Keyed on the pair, like the basket. */
    const quotedByKey = useMemo(() => {
        const map = new Map<string, OrderDeskQuoteLine>();
        for (const line of quote?.lines ?? []) {
            map.set(basketKey(line.catalogueItemId, line.catalogueItemVariantId), line);
        }
        return map;
    }, [quote]);

    const itemCount = lines.reduce((sum, line) => sum + (quantityAsNumber(line.quantity) ?? 0), 0);

    return (
        <View
            testID={testID}
            role="complementary"
            aria-label={t('kitchen:desk.sale.basketTitle')}
            style={{ width: RAIL_WIDTH }}
            className="flex-col rounded border border-stroke bg-surface-raised shadow-elevation-card"
        >
            <View className="flex-col gap-hair px-snug pb-tight pt-tight">
                <DeskSectionHeading
                    title={t('kitchen:desk.sale.basketTitle')}
                    strong
                    action={
                        <Text variant="mono" tone="secondary" testID={`${testID}-count`}>
                            {t('kitchen:desk.sale.itemCount', { count: itemCount })}
                        </Text>
                    }
                />

                {lines.length === 0 ? (
                    <Text
                        variant="caption"
                        tone="secondary"
                        testID="kitchen-order-desk-sale-basket-empty"
                    >
                        {t('kitchen:desk.sale.basketEmptyBody')}
                    </Text>
                ) : (
                    <View testID="kitchen-order-desk-sale-lines" className="flex-col">
                        {lines.map((line) => {
                            const key = lineKey(line);
                            const quoted = quotedByKey.get(key) ?? null;
                            const name = displayName(line.name, locale).value;
                            const refusals = quoted?.refusals ?? [];
                            return (
                                <View
                                    key={key}
                                    testID={`kitchen-order-desk-sale-line-${line.catalogueItemId}`}
                                    className="flex-col gap-hair border-b border-stroke-subtle py-tight"
                                >
                                    <View className="flex-row items-baseline justify-between gap-tight">
                                        {/* eslint-disable-next-line no-restricted-syntax -- the name is the line's filler. */}
                                        <View className="min-w-0 flex-1">
                                            <Text variant="label">{name}</Text>
                                        </View>
                                        <Text
                                            variant="mono"
                                            tone={refusals.length > 0 ? 'warning' : 'primary'}
                                            testID={`kitchen-order-desk-sale-line-${line.catalogueItemId}-total`}
                                        >
                                            {quoted === null ||
                                            quote === null ||
                                            quoted.lineTotalMinor === null
                                                ? EM_DASH
                                                : formatMoney(formatter, {
                                                      amount: quoted.lineTotalMinor,
                                                      currency: quoted.currencyCode,
                                                  })}
                                        </Text>
                                    </View>

                                    <View className="flex-row items-center justify-between gap-hair">
                                        <CompactQuantity
                                            testID={`kitchen-order-desk-sale-line-${line.catalogueItemId}-quantity`}
                                            label={t('kitchen:desk.sale.quantityLabel', {
                                                item: name,
                                            })}
                                            value={quantityAsNumber(line.quantity) ?? 1}
                                            onChange={(next) => {
                                                onLines(
                                                    setQuantity(
                                                        lines,
                                                        key,
                                                        quantityFromNumber(next),
                                                    ),
                                                );
                                            }}
                                        />
                                        <IconButton
                                            testID={`kitchen-order-desk-sale-line-${line.catalogueItemId}-remove`}
                                            icon={<Icon name="close" size="sm" />}
                                            variant="ghost"
                                            size="sm"
                                            label={t('kitchen:desk.sale.removeLine', {
                                                item: name,
                                            })}
                                            onPress={() => {
                                                onLines(removeLine(lines, key));
                                            }}
                                        />
                                    </View>

                                    {refusals.length === 0 ? null : (
                                        <View
                                            testID={`kitchen-order-desk-sale-line-${line.catalogueItemId}-refusals`}
                                            className="flex-col rounded-sm bg-warning-subtle px-control-sm py-hair"
                                        >
                                            {refusals.map((refusal) => (
                                                <Text
                                                    key={refusal.reason}
                                                    variant="caption"
                                                    tone="warning"
                                                >
                                                    {t(`kitchen:desk.refusal.${refusal.reason}`, {
                                                        defaultValue: refusal.reason,
                                                    })}
                                                </Text>
                                            ))}
                                        </View>
                                    )}
                                </View>
                            );
                        })}
                    </View>
                )}

                {/* An empty basket has no total to state — the line above already says why. */}
                {lines.length === 0 ? null : (
                    <QuoteTotals
                        quote={quote}
                        stale={quoteStale}
                        failed={quoteFailed}
                        failureMessage={quoteFailureMessage}
                        testID="kitchen-order-desk-sale-basket-totals"
                    />
                )}
            </View>

            <View className="flex-row items-center justify-between gap-tight border-t border-stroke-subtle px-snug py-tight">
                {navigation}
            </View>
        </View>
    );
}

/**
 * A desk-sized quantity: − n +, one row, no label above it.
 *
 * The form-sized `NumberStepper` puts a labelled full-width input between two 44px buttons, which in
 * a 264px rail is most of a line per article. The desk is driven with a mouse, so small buttons and
 * the count between them are enough; the label stays as the buttons' and the group's accessible name.
 */
function CompactQuantity({
    label,
    value,
    onChange,
    testID,
}: {
    readonly label: string;
    readonly value: number;
    readonly onChange: (next: number) => void;
    readonly testID: string;
}) {
    const { t } = useTranslation();
    const formatter = useFormatter();

    return (
        <View
            testID={testID}
            role="group"
            aria-label={label}
            className="flex-row items-center gap-hair rounded-sm border border-stroke-subtle"
        >
            <IconButton
                testID={`${testID}-decrement`}
                icon={<Icon name="minus" size="sm" />}
                variant="ghost"
                size="sm"
                label={t('designSystem:numberStepper.decrease', { label })}
                disabled={value <= 1}
                onPress={() => {
                    onChange(value - 1);
                }}
            />
            <Text variant="mono" testID={`${testID}-value`} aria-live="polite">
                {formatter.formatNumber(value)}
            </Text>
            <IconButton
                testID={`${testID}-increment`}
                icon={<Icon name="plus" size="sm" />}
                variant="ghost"
                size="sm"
                label={t('designSystem:numberStepper.increase', { label })}
                disabled={value >= MAX_LINE_QUANTITY}
                onPress={() => {
                    onChange(value + 1);
                }}
            />
        </View>
    );
}

/**
 * The quote's totals.
 *
 * Null and zero are different facts: zero is a fee somebody decided on — a free-delivery zone — and
 * a counter sale has no fee at all. Printing "Delivery: 0.00" on a walk-in would be inventing a line
 * the order does not have.
 */
function QuoteTotals({
    quote,
    stale,
    failed,
    failureMessage,
    testID,
}: {
    readonly quote: OrderDeskQuote | null;
    readonly stale: boolean;
    readonly failed: boolean;
    readonly failureMessage?: string | undefined;
    readonly testID: string;
}) {
    const { t } = useTranslation();
    const formatter = useFormatter();

    if (failed) {
        return (
            <Callout
                testID={`${testID}-error`}
                tone="danger"
                role="alert"
                title={t('kitchen:desk.sale.quoteErrorTitle')}
                body={failureMessage ?? t('kitchen:desk.sale.quoteErrorBody')}
            />
        );
    }

    if (quote === null) {
        return (
            <View className="flex-col gap-hair pt-tight" testID={`${testID}-none`}>
                <DeskAmount emphasis label={t('kitchen:desk.sale.total')} value={EM_DASH} />
            </View>
        );
    }

    const money = (amount: number) =>
        formatMoney(formatter, { amount, currency: quote.currencyCode });

    return (
        <View testID={testID} className="flex-col gap-hair pt-tight">
            <DeskAmount
                label={t('kitchen:desk.sale.subtotal')}
                value={money(quote.subtotalMinor)}
                testID={`${testID}-subtotal`}
            />
            {quote.deliveryFeeMinor === null ? null : (
                <DeskAmount
                    label={t('kitchen:desk.sale.deliveryFee')}
                    value={money(quote.deliveryFeeMinor)}
                    testID={`${testID}-fee`}
                />
            )}
            <DeskAmount
                emphasis
                label={t('kitchen:desk.sale.total')}
                value={money(quote.totalMinor)}
                testID={`${testID}-total`}
            />

            {/* Only while it is changing: a steady "priced by the kitchen" line is furniture. */}
            {stale ? (
                <Text variant="caption" tone="secondary" role="status" testID={`${testID}-note`}>
                    {t('kitchen:desk.sale.quoteUpdating')}
                </Text>
            ) : null}

            {quote.refusals.length === 0 ? null : (
                <Callout
                    testID={`${testID}-refusals`}
                    tone="warning"
                    role="alert"
                    title={t('kitchen:desk.sale.orderRefusalsTitle')}
                >
                    <View className="flex-col">
                        {quote.refusals.map((refusal: OrderDeskRefusal) => (
                            <Text
                                key={refusal.reason}
                                variant="caption"
                                testID={`${testID}-refusal-${refusal.reason}`}
                            >
                                {t(`kitchen:desk.refusal.${refusal.reason}`, {
                                    defaultValue: refusal.reason,
                                })}
                            </Text>
                        ))}
                    </View>
                </Callout>
            )}
        </View>
    );
}
