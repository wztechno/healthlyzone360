import { Icon, ShellDock, cx } from '@healthy360/design-system';
import type { CartItem, Kitchen, MarketplaceMeal } from '@healthy360/api-client/contracts';
import type { Money } from '@healthy360/domain-types';
import { useFormatter } from '@healthy360/i18n';
import type { Formatter } from '@healthy360/i18n';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, Text as RNText, View } from 'react-native';

import {
    useCartQuery,
    useRemoveCartItemMutation,
    useSetCartItemQuantityMutation,
} from '../../../data/commerce-hooks.ts';
import { EntityImage } from '../../../media/entity-image.tsx';
import { useSession } from '../../../session/session-provider.tsx';
import { DeliverToMenu } from '../discover/deliver-to-menu.tsx';
import { formatMoney } from '../format.ts';
import { useShopViewOnly } from '../shop-view-only.tsx';
import { deliveryTerms, pickupBranches } from '../storefront-facts.ts';

import type { KitchenClock } from './storefront-today.ts';
import { deliveryMinutesRange, minutesUntil } from './storefront-today.ts';

/** Which way an order leaves the kitchen. Drives the terms the panel states. */
type StorefrontMode = 'delivery' | 'pickup';
const MODES: readonly StorefrontMode[] = ['delivery', 'pickup'];

/**
 * The storefront's "Your order" panel, as the accepted shop board draws it: where and when the food
 * goes (`deliver-to-menu.tsx`), this kitchen's lines in the basket — each with its photograph, a
 * stepper and Remove — or "Tap + on a dish to start", and Checkout carrying the total.
 *
 * Under Checkout, the kitchen's terms — the one thing the board's panel leaves out and a shopper
 * needs before the first add: for delivery the estimate, the minimum order and the fee, for pickup
 * where to collect, and today's cut-off. A figure the contract has no value for reads "—".
 *
 * Staff view the storefront and order nothing (`shop-view-only.tsx`): they see the terms only.
 */
export interface StorefrontOrderPanelProps {
    readonly kitchen: Kitchen;
    /** The kitchen's whole menu, for each basket line's photograph. */
    readonly meals: readonly MarketplaceMeal[];
    /** Today's same-day cut-off, `HH:mm`. */
    readonly cutOff: string | null;
    readonly clock: KitchenClock | null;
    /** The phone board's docked "View order" bar in place of the panel. */
    readonly phone?: boolean | undefined;
}

export function StorefrontOrderPanel({
    kitchen,
    meals,
    cutOff,
    clock,
    phone = false,
}: StorefrontOrderPanelProps) {
    const viewOnly = useShopViewOnly();
    const { t } = useTranslation();
    const formatter: Formatter = useFormatter();
    const router = useRouter();
    const { me } = useSession();
    const cart = useCartQuery(me !== null && !viewOnly);
    const setQuantity = useSetCartItemQuantityMutation();
    const removeItem = useRemoveCartItemMutation();
    const paused = kitchen.pausedUntil !== null && kitchen.pausedUntil !== undefined;

    const basket = cart.data;
    const lines = (basket?.items ?? []).filter((item) => item.kitchenId === kitchen.id);
    const count = lines.reduce((sum, item) => sum + item.quantity, 0);
    const first = lines[0];
    const total =
        first === undefined
            ? null
            : formatMoney(formatter, {
                  amount: lines.reduce((sum, item) => sum + item.lineTotal.amount, 0),
                  currency: first.lineTotal.currency,
              });

    /*
     * Shop · Kitchens, phone board: no panel beside the menu — once this kitchen's dishes are in
     * the basket, a green bar docked to the screen's foot: how many, "View order", and the total.
     */
    if (phone) {
        if (viewOnly || count === 0 || total === null) return null;
        return (
            <ShellDock>
                <View className="bg-surface-base px-3 pb-3.5 pt-1">
                    <Pressable
                        testID="kitchen-view-order"
                        role="link"
                        accessibilityRole="link"
                        onPress={() => {
                            router.push('/customer/cart' as never);
                        }}
                        className="h-[60px] flex-row items-center gap-3 rounded-[20px] bg-surface-brand pe-2.5 ps-4 shadow-elevation-3"
                    >
                        <View className="h-7 min-w-[28px] items-center justify-center rounded-[9px] bg-content-on-brand/20 px-1">
                            <RNText className="text-sm font-bold tabular-nums text-content-on-brand">
                                {formatter.formatNumber(count)}
                            </RNText>
                        </View>
                        <RNText className="text-base font-bold text-content-on-brand">
                            {t('marketplace:storefront.viewOrder')}
                        </RNText>
                        <View className="ms-auto h-10 justify-center rounded-xl bg-content-on-brand/15 px-3">
                            <RNText className="font-display text-base font-bold tabular-nums text-content-on-brand">
                                {total}
                            </RNText>
                        </View>
                    </Pressable>
                </View>
            </ShellDock>
        );
    }
    return (
        <View
            testID="kitchen-order-panel"
            className="flex-col rounded-3xl border border-stroke-subtle bg-surface-raised p-[18px] shadow-elevation-3"
        >
            <View className="flex-row items-center justify-between gap-3">
                <RNText
                    role="heading"
                    aria-level={2}
                    className="font-display text-lg font-bold text-content-primary"
                >
                    {t('marketplace:storefront.order.title')}
                </RNText>
                {viewOnly ? null : (
                    <RNText
                        testID="kitchen-basket-count"
                        className="text-sm tabular-nums text-content-secondary"
                    >
                        {t('marketplace:storefront.order.itemCount', {
                            count,
                            formattedCount: formatter.formatNumber(count),
                        })}
                    </RNText>
                )}
            </View>

            {viewOnly ? null : (
                <>
                    <View className="z-auto mt-3">
                        <DeliverToMenu testID="kitchen-deliver" bar kitchenId={kitchen.id} />
                    </View>

                    {lines.length === 0 ? (
                        <View
                            testID="kitchen-basket-empty"
                            className="flex-col items-center gap-2 px-2 py-[22px]"
                        >
                            <View className="h-16 w-16 items-center justify-center rounded-full bg-surface-brand-subtle">
                                <Icon
                                    name="shoppingBasket"
                                    className="text-content-on-brand-subtle"
                                />
                            </View>
                            <RNText className="text-center text-sm text-content-secondary">
                                {t('marketplace:storefront.order.emptyHint')}
                            </RNText>
                        </View>
                    ) : (
                        <View testID="kitchen-basket" className="mt-3.5 flex-col gap-2.5">
                            {lines.map((item) => (
                                <BasketLine
                                    key={item.id}
                                    item={item}
                                    meal={meals.find((meal) => meal.id === item.mealId)}
                                    onQuantity={(quantity) => {
                                        if (basket === undefined) return;
                                        setQuantity.mutate({ cartId: basket.id, item, quantity });
                                    }}
                                    onRemove={() => {
                                        if (basket === undefined) return;
                                        removeItem.mutate({ cartId: basket.id, itemId: item.id });
                                    }}
                                />
                            ))}
                        </View>
                    )}

                    {/* Shop · Kitchens + storefront, pin 5: the panel says why it cannot check out. */}
                    {paused ? (
                        <View
                            testID="kitchen-paused"
                            role="status"
                            className="mt-3 flex-row items-start gap-2.5 rounded-2xl bg-warning-subtle p-3"
                        >
                            <Icon
                                name="pause"
                                size="md"
                                className="mt-0.5 text-warning-on-subtle"
                            />
                            <View className="min-w-0 flex-1">
                                <RNText className="text-sm font-bold leading-[18px] text-warning-on-subtle text-start">
                                    {t('marketplace:storefront.pausedTitle')}
                                </RNText>
                                <RNText className="text-sm leading-[18px] text-warning-on-subtle text-start">
                                    {t('marketplace:storefront.pausedBody', {
                                        time: formatter.formatDate(kitchen.pausedUntil ?? '', {
                                            timeStyle: 'short',
                                        }),
                                    })}
                                </RNText>
                            </View>
                        </View>
                    ) : null}

                    <Pressable
                        testID="kitchen-checkout"
                        role="button"
                        accessibilityRole="button"
                        disabled={lines.length === 0 || paused}
                        accessibilityState={{ disabled: lines.length === 0 || paused }}
                        onPress={() => {
                            router.push('/customer/checkout' as never);
                        }}
                        className={cx(
                            'mt-3.5 h-[52px] flex-row items-center justify-between rounded-2xl px-[18px]',
                            lines.length === 0 || paused
                                ? 'bg-surface-base'
                                : 'bg-surface-brand hover:bg-surface-canopy',
                        )}
                    >
                        <RNText
                            className={cx(
                                'text-base font-bold',
                                lines.length === 0 || paused
                                    ? 'text-content-secondary'
                                    : 'text-content-on-brand',
                            )}
                        >
                            {t('marketplace:storefront.order.checkout')}
                        </RNText>
                        {total === null ? null : (
                            <RNText
                                testID="kitchen-basket-total"
                                className="font-display text-base font-bold tabular-nums text-content-on-brand"
                            >
                                {total}
                            </RNText>
                        )}
                    </Pressable>
                </>
            )}

            <KitchenTerms kitchen={kitchen} cutOff={cutOff} clock={clock} />
        </View>
    );
}

/** One basket line: photograph, name and line total, then the stepper and Remove. */
function BasketLine({
    item,
    meal,
    onQuantity,
    onRemove,
}: {
    readonly item: CartItem;
    readonly meal: MarketplaceMeal | undefined;
    readonly onQuantity: (quantity: number) => void;
    readonly onRemove: () => void;
}) {
    const { t } = useTranslation();
    const formatter = useFormatter();
    const id = `kitchen-basket-${item.id}`;

    return (
        <View testID={id} className="flex-row gap-2.5 rounded-2xl bg-surface-base p-2">
            <View className="h-11 w-11 overflow-hidden rounded-xl">
                <EntityImage
                    assetId={meal?.imagePlaceholderId}
                    photoUrl={meal?.photoUrl}
                    seed={meal?.slug ?? item.id}
                    label={item.name}
                    decorative
                    flush
                    className="h-full w-full"
                />
            </View>
            <View className="min-w-0 flex-1 flex-col gap-1.5">
                <View className="flex-row items-center gap-2">
                    <RNText
                        numberOfLines={1}
                        className="min-w-0 flex-1 text-sm font-semibold text-content-primary text-start"
                    >
                        {item.name}
                    </RNText>
                    <RNText className="font-display text-sm font-bold tabular-nums text-content-primary">
                        {formatMoney(formatter, item.lineTotal)}
                    </RNText>
                </View>
                <View className="flex-row items-center gap-1.5">
                    <View
                        role="group"
                        aria-label={t('marketplace:storefront.order.quantityLabel', {
                            item: item.name,
                        })}
                        className="h-9 flex-row items-center rounded-xl border border-stroke-subtle bg-surface-raised p-0.5"
                    >
                        <Pressable
                            testID={`${id}-decrement`}
                            role="button"
                            accessibilityRole="button"
                            accessibilityLabel={
                                item.quantity <= 1
                                    ? t('marketplace:storefront.order.removeLabel', {
                                          item: item.name,
                                      })
                                    : t('marketplace:storefront.order.fewerLabel', {
                                          item: item.name,
                                      })
                            }
                            onPress={() => {
                                if (item.quantity <= 1) onRemove();
                                else onQuantity(item.quantity - 1);
                            }}
                            className="h-8 w-8 items-center justify-center rounded-[9px] hover:bg-surface-brand-subtle active:scale-90"
                        >
                            <Icon
                                name={item.quantity <= 1 ? 'archive' : 'minus'}
                                size="sm"
                                className="text-content-primary"
                            />
                        </Pressable>
                        <RNText
                            testID={`${id}-quantity`}
                            aria-live="polite"
                            className="min-w-[26px] text-center font-display text-sm font-bold tabular-nums text-content-primary"
                        >
                            {formatter.formatNumber(item.quantity)}
                        </RNText>
                        <Pressable
                            testID={`${id}-increment`}
                            role="button"
                            accessibilityRole="button"
                            accessibilityLabel={t('marketplace:storefront.order.moreLabel', {
                                item: item.name,
                            })}
                            onPress={() => {
                                onQuantity(item.quantity + 1);
                            }}
                            className="h-8 w-8 items-center justify-center rounded-[9px] hover:bg-surface-brand-subtle active:scale-90"
                        >
                            <Icon name="plus" size="sm" className="text-content-primary" />
                        </Pressable>
                    </View>
                    <Pressable
                        testID={`${id}-remove`}
                        role="button"
                        accessibilityRole="button"
                        accessibilityLabel={t('marketplace:storefront.order.removeLabel', {
                            item: item.name,
                        })}
                        onPress={onRemove}
                        className="ms-auto h-8 flex-row items-center gap-1 rounded-[9px] px-2 hover:bg-danger-subtle"
                    >
                        <Icon name="close" size="sm" className="text-content-secondary" />
                        <RNText className="text-xs font-semibold text-content-secondary">
                            {t('marketplace:storefront.order.remove')}
                        </RNText>
                    </Pressable>
                </View>
            </View>
        </View>
    );
}

/**
 * The kitchen's terms under Checkout: the Delivery / Pickup switch, three figures for that mode, and
 * today's cut-off. The switch shows both modes; one the kitchen does not offer is disabled rather
 * than removed, so the panel says "no pickup here" instead of hiding the question.
 */
function KitchenTerms({
    kitchen,
    cutOff,
    clock,
}: {
    readonly kitchen: Kitchen;
    readonly cutOff: string | null;
    readonly clock: KitchenClock | null;
}) {
    const { t } = useTranslation();
    const formatter = useFormatter();
    const pickup = pickupBranches(kitchen);
    const terms = deliveryTerms(kitchen);
    const range = deliveryMinutesRange(kitchen);
    const none = t('marketplace:storefront.facts.none');

    const offered: Readonly<Record<StorefrontMode, boolean>> = {
        delivery: kitchen.channels.delivery,
        pickup: pickup.length > 0,
    };
    const [mode, setMode] = useState<StorefrontMode>(() =>
        !offered.delivery && offered.pickup ? 'pickup' : 'delivery',
    );

    const term = (key: string, label: string, value: string) => (
        <View
            key={key}
            testID={`kitchen-order-${key}`}
            className="flex-row items-baseline justify-between gap-3"
        >
            <RNText className="text-sm text-content-secondary text-start">{label}</RNText>
            <RNText className="shrink text-sm font-semibold tabular-nums text-content-primary text-end">
                {value}
            </RNText>
        </View>
    );

    const amount = (value: Money | null) =>
        value === null
            ? none
            : terms.varies
              ? t('marketplace:storefront.order.fromAmount', {
                    amount: formatMoney(formatter, value),
                })
              : formatMoney(formatter, value);

    const eta =
        range === null
            ? none
            : range.min === range.max
              ? t('marketplace:storefront.facts.minutes', {
                    minutes: formatter.formatNumber(range.min),
                })
              : t('marketplace:storefront.facts.minutesRange', {
                    min: formatter.formatNumber(range.min),
                    max: formatter.formatNumber(range.max),
                });

    const left = cutOff === null || clock === null ? null : minutesUntil(cutOff, clock);
    const pill =
        cutOff === null
            ? none
            : left === null
              ? cutOff
              : left <= 0
                ? t('marketplace:storefront.order.passed', { time: cutOff })
                : left < 60
                  ? t('marketplace:storefront.order.minutesLeft', {
                        minutes: formatter.formatNumber(left),
                    })
                  : t('marketplace:storefront.order.hoursLeft', {
                        hours: formatter.formatNumber(Math.floor(left / 60)),
                        minutes: formatter.formatNumber(left % 60),
                    });

    return (
        <View className="mt-4 flex-col gap-2.5 border-t border-stroke-subtle pt-3.5">
            <View
                testID="kitchen-order-modes"
                role="radiogroup"
                aria-label={t('marketplace:storefront.order.modesLabel')}
                className="flex-row gap-1 self-start rounded-xl bg-surface-base p-1"
            >
                {MODES.map((option) => {
                    const on = option === mode;
                    const disabled = !offered[option];
                    return (
                        <Pressable
                            key={option}
                            testID={`kitchen-order-mode-${option}`}
                            role="radio"
                            aria-checked={on}
                            accessibilityState={{ checked: on, disabled }}
                            disabled={disabled}
                            onPress={() => {
                                setMode(option);
                            }}
                            className={cx(
                                'rounded-lg px-3 py-1',
                                on ? 'bg-surface-raised shadow-elevation-1' : '',
                                disabled ? 'opacity-40' : '',
                            )}
                        >
                            <RNText
                                className={cx(
                                    'text-xs font-semibold',
                                    on ? 'text-content-primary' : 'text-content-secondary',
                                )}
                            >
                                {t(`marketplace:storefront.order.${option}`)}
                            </RNText>
                        </Pressable>
                    );
                })}
            </View>

            {mode === 'pickup'
                ? [
                      term(
                          'collect',
                          t('marketplace:storefront.order.collectFrom'),
                          pickup.length === 0
                              ? none
                              : [...new Set(pickup.map((branch) => branch.area))].join(
                                    t('marketplace:common.listSeparator'),
                                ),
                      ),
                      term('ready', t('marketplace:storefront.order.readyIn'), none),
                      term('pickup-fee', t('marketplace:storefront.order.fee'), none),
                  ]
                : [
                      term('eta', t('marketplace:storefront.order.delivery'), eta),
                      term(
                          'minimum',
                          t('marketplace:storefront.order.minimum'),
                          amount(terms.minimumOrder),
                      ),
                      term('fee', t('marketplace:storefront.order.fee'), amount(terms.deliveryFee)),
                  ]}

            <View
                testID="kitchen-order-cutoff"
                className="flex-row items-center justify-between gap-2.5"
            >
                <RNText className="text-sm text-content-secondary text-start">
                    {t('marketplace:storefront.order.cutOff')}
                </RNText>
                <View className="rounded-full bg-warning-subtle px-2.5 py-0.5">
                    <RNText
                        testID="kitchen-order-cutoff-pill"
                        numberOfLines={1}
                        className="text-xs font-semibold uppercase tabular-nums text-warning-on-subtle text-end"
                    >
                        {pill}
                    </RNText>
                </View>
            </View>
        </View>
    );
}
