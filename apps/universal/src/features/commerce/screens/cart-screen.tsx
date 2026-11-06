import { Callout, Icon, TextInputField, cx, useBreakpoint } from '@healthy360/design-system';
import type { Cart, CustomerAddress, MarketplaceMeal } from '@healthy360/api-client/contracts';
import { useFormatter } from '@healthy360/i18n';
import { useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, Text as RNText, View } from 'react-native';

import { useAddressesQuery } from '../../../data/account-hooks.ts';
import { mealsFromPages, useMealsQuery } from '../../../data/catalogue-hooks.ts';
import { useKitchenQuery } from '../../../data/marketplace-hooks.ts';
import { EntityImage } from '../../../media/entity-image.tsx';
import {
    toFailure,
    useCartQuery,
    useCheckoutPreviewQuery,
    useRemoveCartItemMutation,
    useSetCartItemQuantityMutation,
} from '../../../data/commerce-hooks.ts';
import { usePrototypeAction } from '../../../prototype/index.ts';
import { BackPill } from '../../../ui/back-pill.tsx';
import { shownItemTypes } from '../../catalogue/shown-shelves.ts';
import { DeliverToMenu } from '../../marketplace/discover/deliver-to-menu.tsx';
import { formatMoney } from '../../marketplace/format.ts';
import { QueryStates } from '../../marketplace/query-states.tsx';
import { CartLine } from '../cart-line.tsx';
import { SummaryRow } from '../checkout-frame.tsx';
import { basketKitchenOf, useBasketAdd } from '../use-basket-add.tsx';
import { ALLERGEN_CONFLICT_WARNING } from '../warnings.ts';
import { clashingAllergens, useMyAllergenCodes } from '../my-allergens.tsx';

/**
 * `/customer/cart` — the basket, as the accepted Basket board draws it: "Keep shopping", "Your basket"
 * and its count, the shop's **Deliver to** menu (where and when, as everywhere else in the shop), the
 * lines card under its kitchen with "Goes well with it" (the kitchen's sauces and dressings), "Empty
 * basket", and the order summary on the canopy beside it from `lg` and after it below. An empty
 * basket says so, with the menu one press away and the shop's best-rated meals under it.
 *
 * ## Everything on this screen is real, or says it is not
 *
 * The quantity stepper, the remove control and the totals all move the world: `addCartItem` and
 * `removeCartItem` exist, the store holds a real basket, and `previewCheckout` prices it. The line
 * under the title names the person's default saved address and the earliest date the checkout
 * will offer (tomorrow — today's cooking has started). The delivery figure is the preview's for
 * that address, and reads "At checkout" when there is no address to price it from.
 *
 * What the design draws and the contract cannot back is either drawn honestly or left out:
 *
 * - the promo-code field and **Apply** are drawn and wired to the prototype notice — there is no
 *   promotion operation, and the press says "nothing was changed";
 * - the **discount** row appears only when the preview carries one (the API never does yet);
 * - there is **no tax row** — the contract has no tax figure, and a "Tax —" line would suggest a
 *   charge still to come;
 * - the line above the button states how payment works — cash on delivery — instead of a
 *   cancellation promise nothing enforces.
 *
 * ## Why the totals come from a preview and are not added up here
 *
 * The delivery fee and the total are `previewCheckout`'s. The screen could add them — one line of
 * arithmetic — and that is exactly why it does not. A basket may one day hold two kitchens quoting
 * two currencies, and a client-side sum of `Money.amount` would produce a confident, wrong number.
 * Pricing is a server concern and stays one.
 *
 * ## Doc 11, `SUB-05`
 *
 * The reference product has no basket at all: its subscription flow goes from configuration
 * straight to purchase. Ours has one because we sell individual meals as well as plans, and a
 * marketplace of forty meals across six kitchens without a basket forces one checkout per dish.
 * The subscription flow still bypasses it entirely, which is the part of `SUB-05` worth keeping.
 */

/** The address a basket would go to before checkout asks: the default, else the first saved. */
function defaultAddressOf(
    addresses: readonly CustomerAddress[] | undefined,
): CustomerAddress | null {
    if (addresses === undefined) return null;
    return addresses.find((entry) => entry.isDefault) ?? addresses[0] ?? null;
}

/** How many dishes a shelf of suggestions shows. */
const SUGGESTIONS = 4;

export function CartScreen() {
    const { t } = useTranslation();
    const router = useRouter();
    const formatter = useFormatter();
    const runPrototype = usePrototypeAction();
    const { atLeast } = useBreakpoint();

    const cart = useCartQuery();
    const basket: Cart | undefined = cart.data;
    const addresses = useAddressesQuery();
    const homeAddress = defaultAddressOf(addresses.data);
    const kitchenId =
        basket === undefined || basket.items.length === 0 ? null : basketKitchenOf(basket);
    const kitchen = useKitchenQuery(kitchenId);

    const setQuantity = useSetCartItemQuantityMutation();
    const removeItem = useRemoveCartItemMutation();
    const basketAdd = useBasketAdd({ labelKey: 'commerce:cart.title', testID: 'cart' });
    const [promoCode, setPromoCode] = useState('');
    const [clearing, setClearing] = useState(false);

    // Priced only when there is something to price, and only once the address book has answered —
    // a preview sent before it would price delivery as unknown and then jump when the address
    // arrived. A failed address read prices the basket without one rather than not at all.
    const previewRequest = useMemo(() => {
        if (basket === undefined || basket.items.length === 0) return null;
        if (addresses.isPending) return null;
        return {
            cartId: basket.id,
            ...(homeAddress === null ? {} : { addressId: homeAddress.id }),
        };
    }, [addresses.isPending, basket, homeAddress]);
    const preview = useCheckoutPreviewQuery(previewRequest);
    const quotation = preview.data;
    const myAllergens = useMyAllergenCodes();
    const [allergenAck, setAllergenAck] = useState(false);
    /*
     * The Allergen board's gate: while the basket holds something on the person's allergy list,
     * Checkout waits for "I know, add them anyway". The server's own warning decides whether the
     * gate shows; the lines decide how many it names.
     */
    const allergenConflict = quotation?.warnings.includes(ALLERGEN_CONFLICT_WARNING) ?? false;
    const clashingLines = (cart.data?.items ?? []).filter(
        (line) => clashingAllergens(line.allergens, myAllergens).length > 0,
    ).length;
    const gated = allergenConflict && !allergenAck;
    const checkoutOff = preview.isPending || preview.error !== null || gated;

    const mutationFailure = toFailure(setQuantity.error) ?? toFailure(removeItem.error);
    const busy = setQuantity.isPending || removeItem.isPending || clearing;
    const isEmpty = basket !== undefined && basket.items.length === 0;
    const count = basket?.items.reduce((sum, item) => sum + item.quantity, 0) ?? 0;

    // "Goes well with it": the basket kitchen's sauces and dressings. An empty basket shows the
    // shop's best-rated meals instead.
    const extras = useMealsQuery(
        kitchenId === null
            ? undefined
            : {
                  kitchenIds: [kitchenId],
                  itemTypes: shownItemTypes(['sauce', 'dressing']),
                  limit: 8,
              },
        kitchenId !== null,
    );
    const popular = useMealsQuery(
        isEmpty
            ? { itemTypes: shownItemTypes(['meal']), sort: 'rating', limit: SUGGESTIONS }
            : undefined,
        isEmpty,
    );
    const suggestions = mealsFromPages(extras.data?.pages).slice(0, SUGGESTIONS);
    const popularMeals = mealsFromPages(popular.data?.pages).slice(0, SUGGESTIONS);
    const inBasket = new Set((basket?.items ?? []).map((item) => String(item.mealId)));

    /*
     * "Keep shopping" from a basket that holds something goes to that basket's kitchen: a basket
     * holds one kitchen's meals, and the all-kitchens menu invited adds that would only ask to start
     * a new basket (browse-03). An empty basket has no kitchen yet, so it browses the whole menu.
     */
    const goBrowse = () => {
        router.push((kitchenId === null ? '/meals' : `/kitchens/${String(kitchenId)}`) as never);
    };

    const emptyBasket = async () => {
        if (basket === undefined) return;
        setClearing(true);
        try {
            for (const item of basket.items) {
                await removeItem.mutateAsync({ cartId: basket.id, itemId: item.id });
            }
        } catch {
            // The failure is reported by the mutation's own error, under the lines.
        } finally {
            setClearing(false);
        }
    };

    const countLabel = t('commerce:cart.itemCount', {
        count,
        formattedCount: formatter.formatNumber(count),
    });
    const branch = kitchen.data?.branches[0];

    /* ── the lines card ─────────────────────────────────────────────────────────────────────── */

    const lines =
        basket === undefined ? null : (
            <View className="flex-col">
                <View
                    testID="cart-lines-card"
                    className="overflow-hidden rounded-[26px] border border-stroke-subtle bg-surface-raised shadow-elevation-2"
                >
                    {kitchen.data === undefined ? null : (
                        <View
                            testID="cart-kitchen"
                            className="flex-row items-center gap-3 border-b border-stroke-subtle px-5 py-4"
                        >
                            <View className="h-11 w-11 overflow-hidden rounded-[14px]">
                                <EntityImage
                                    assetId={kitchen.data.imagePlaceholderId}
                                    seed={`kitchen-${String(kitchen.data.id)}`}
                                    label={kitchen.data.name}
                                    decorative
                                    flush
                                    className="h-full w-full"
                                />
                            </View>
                            <View className="min-w-0 flex-1">
                                <RNText className="text-base font-bold text-content-primary text-start">
                                    {kitchen.data.name}
                                </RNText>
                                {branch === undefined ? null : (
                                    <RNText className="text-sm text-content-secondary text-start">
                                        {[branch.name, branch.area]
                                            .filter((part) => part.trim() !== '')
                                            .join(t('commerce:common.listSeparator'))}
                                    </RNText>
                                )}
                            </View>
                        </View>
                    )}

                    <View testID="cart-lines" className="flex-col">
                        {basket.items.map((item, index) => (
                            <CartLine
                                key={item.id}
                                item={item}
                                first={index === 0}
                                priceText={formatMoney(formatter, item.lineTotal)}
                                busy={busy}
                                onQuantity={(quantity) => {
                                    setQuantity.mutate({ cartId: basket.id, item, quantity });
                                }}
                                onRemove={() => {
                                    removeItem.mutate({ cartId: basket.id, itemId: item.id });
                                }}
                                onOpen={() => {
                                    router.push(`/meals/${String(item.mealId)}` as never);
                                }}
                            />
                        ))}
                    </View>

                    {suggestions.length === 0 ? null : (
                        <View
                            testID="cart-suggestions"
                            className="border-t border-stroke-subtle bg-surface-base px-5 pb-5 pt-[18px]"
                        >
                            <RNText className="mb-3 text-xs font-bold uppercase tracking-wider text-content-secondary text-start">
                                {t('commerce:cart.goesWell')}
                            </RNText>
                            <SuggestionRow
                                meals={suggestions}
                                inBasket={inBasket}
                                columns={atLeast('md') ? 4 : 2}
                                onAdd={(meal) => {
                                    basketAdd.add(meal);
                                }}
                            />
                        </View>
                    )}
                </View>

                <View className="mt-3 flex-row flex-wrap items-center gap-2">
                    <Pressable
                        testID="cart-add-more"
                        role="button"
                        accessibilityRole="button"
                        onPress={goBrowse}
                        className="h-10 flex-row items-center gap-1.5 rounded-xl px-3 hover:bg-surface-brand-subtle"
                    >
                        <Icon name="plus" size="sm" className="text-content-on-brand-subtle" />
                        <RNText className="text-sm font-semibold text-content-on-brand-subtle">
                            {t('commerce:cart.addMore')}
                        </RNText>
                    </Pressable>
                    <Pressable
                        testID="cart-empty-basket"
                        role="button"
                        accessibilityRole="button"
                        accessibilityState={{ disabled: busy }}
                        disabled={busy}
                        onPress={() => {
                            void emptyBasket();
                        }}
                        className="group h-10 flex-row items-center gap-1.5 rounded-xl px-3"
                    >
                        <Icon
                            name="close"
                            size="sm"
                            className="text-content-secondary group-hover:text-danger-on-subtle"
                        />
                        <RNText className="text-sm font-semibold text-content-secondary group-hover:text-danger-on-subtle">
                            {t('commerce:cart.emptyBasket')}
                        </RNText>
                    </Pressable>
                </View>

                {mutationFailure === null ? null : (
                    <View className="mt-3">
                        <Callout
                            testID="cart-mutation-error"
                            role="alert"
                            tone="danger"
                            title={t('commerce:cart.updateFailedTitle')}
                            body={mutationFailure.message}
                        />
                    </View>
                )}
            </View>
        );

    /* ── the order summary ──────────────────────────────────────────────────────────────────── */

    const summary = (
        <View
            testID="cart-summary"
            className="overflow-hidden rounded-[26px] border border-stroke-subtle bg-surface-raised shadow-elevation-2"
        >
            <View className="relative overflow-hidden bg-surface-canopy px-5 py-[18px]">
                <View
                    aria-hidden
                    pointerEvents="none"
                    className="absolute -end-16 -top-20 h-48 w-48 rounded-full bg-stage-green opacity-15"
                />
                <RNText className="text-xs font-semibold uppercase tracking-wider text-content-on-canopy-muted">
                    {t('commerce:cart.summaryTitle')}
                </RNText>
                <View className="mt-1.5 flex-row items-baseline justify-between gap-3">
                    <RNText
                        testID="cart-summary-total"
                        className="font-display text-4xl font-bold tabular-nums tracking-display text-content-on-canopy"
                    >
                        {quotation === undefined ? '—' : formatMoney(formatter, quotation.total)}
                    </RNText>
                    <RNText className="text-sm text-content-on-canopy-muted">{countLabel}</RNText>
                </View>
            </View>

            <View className="px-5 pb-5 pt-4">
                <QueryStates
                    query={preview}
                    isEmpty={false}
                    emptyTitle={t('commerce:cart.summaryEmpty')}
                    skeletonCount={1}
                    testID="cart-preview"
                >
                    {quotation === undefined ? null : (
                        <View className="flex-col">
                            <View testID="cart-price" className="flex-col gap-3.5 py-1">
                                <SummaryRow
                                    testID="cart-price-subtotal"
                                    label={t('commerce:cart.subtotal')}
                                    value={formatMoney(formatter, quotation.subtotal)}
                                />
                                <SummaryRow
                                    testID="cart-price-delivery"
                                    label={
                                        homeAddress === null || homeAddress.areaName.trim() === ''
                                            ? t('commerce:cart.delivery')
                                            : t('commerce:cart.deliveryTo', {
                                                  area: homeAddress.areaName,
                                              })
                                    }
                                    value={
                                        quotation.deliveryFee === null
                                            ? t('commerce:cart.deliveryAtCheckout')
                                            : formatMoney(formatter, quotation.deliveryFee)
                                    }
                                />
                                {quotation.discount === null ? null : (
                                    <SummaryRow
                                        testID="cart-price-discount"
                                        tone="credit"
                                        label={t('commerce:cart.discount')}
                                        value={t('commerce:cart.discountValue', {
                                            amount: formatMoney(formatter, quotation.discount),
                                        })}
                                    />
                                )}
                            </View>

                            <View
                                testID="cart-price-total"
                                className="mt-3 flex-row items-baseline justify-between border-t border-dashed border-stroke pt-3"
                            >
                                <RNText className="text-sm text-content-secondary">
                                    {t('commerce:cart.total')}
                                </RNText>
                                <RNText
                                    testID="cart-price-total-amount"
                                    className="font-display text-2xl font-bold tabular-nums tracking-display text-content-primary"
                                >
                                    {formatMoney(formatter, quotation.total)}
                                </RNText>
                            </View>

                            <View className="mt-4 flex-row items-start gap-1.5">
                                <View className="min-w-0 flex-1">
                                    <TextInputField
                                        testID="cart-promo"
                                        label={t('commerce:cart.promoLabel')}
                                        labelHidden
                                        placeholder={t('commerce:cart.promoLabel')}
                                        value={promoCode}
                                        onChangeText={setPromoCode}
                                        autoCapitalize="characters"
                                    />
                                </View>
                                <Pressable
                                    testID="cart-promo-apply"
                                    role="button"
                                    accessibilityRole="button"
                                    accessibilityHint={t('marketplace:prototype.notBuilt')}
                                    onPress={() => {
                                        runPrototype({
                                            contract: 'POST /api/v1/carts/{cart}/promotions',
                                        });
                                    }}
                                    className="h-[46px] justify-center rounded-[14px] border border-stroke bg-surface-raised px-4 hover:bg-surface-brand-subtle"
                                >
                                    <RNText className="text-sm font-semibold text-content-primary">
                                        {t('commerce:cart.promoApply')}
                                    </RNText>
                                </Pressable>
                            </View>

                            {allergenConflict ? (
                                <View
                                    testID="cart-allergen-warning"
                                    role="alert"
                                    className="mt-4 rounded-2xl border border-warning-border bg-warning-subtle p-3"
                                >
                                    <View className="flex-row items-center gap-2">
                                        <Icon
                                            name="alert"
                                            size="md"
                                            className="text-warning-on-subtle"
                                        />
                                        <RNText className="flex-1 text-sm font-bold text-warning-on-subtle text-start">
                                            {clashingLines > 0
                                                ? t('commerce:cart.allergenGate', {
                                                      count: clashingLines,
                                                  })
                                                : t('commerce:cart.allergenTitle')}
                                        </RNText>
                                    </View>
                                    <Pressable
                                        testID="cart-allergen-ack"
                                        role="checkbox"
                                        accessibilityRole="checkbox"
                                        aria-checked={allergenAck}
                                        accessibilityState={{ checked: allergenAck }}
                                        onPress={() => {
                                            setAllergenAck((on) => !on);
                                        }}
                                        className="mt-2.5 flex-row items-center gap-2.5 rounded-xl bg-surface-raised p-2.5"
                                    >
                                        <View
                                            className={cx(
                                                'h-[22px] w-[22px] items-center justify-center rounded-[7px] border-2 border-warning-strong transition-colors duration-200',
                                                allergenAck ? 'bg-warning-strong' : '',
                                            )}
                                        >
                                            {allergenAck ? (
                                                <Icon
                                                    name="check"
                                                    size="sm"
                                                    className="text-warning-on-strong"
                                                />
                                            ) : null}
                                        </View>
                                        <RNText className="flex-1 text-sm font-semibold text-content-primary text-start">
                                            {t('commerce:cart.allergenAck')}
                                        </RNText>
                                    </Pressable>
                                </View>
                            ) : null}
                        </View>
                    )}
                </QueryStates>

                {/* How payment works: the kitchen is paid in cash on delivery. */}
                <View className="mt-3 flex-row items-center gap-2.5 rounded-[14px] bg-surface-brand-subtle p-3">
                    <Icon name="banknote" size="md" className="text-content-on-brand-subtle" />
                    <RNText
                        testID="cart-fine-print"
                        className="min-w-0 flex-1 text-sm font-semibold text-content-on-brand-subtle text-start"
                    >
                        {t('commerce:cart.cashOnDelivery')}
                    </RNText>
                </View>

                {/*
                 * Outside the price's `QueryStates`, so it never disappears (browse-13). Inside, a
                 * failed or refused preview left only the error and Retry — no way onward, and
                 * nothing to show the basket was still there to be ordered. It waits, disabled,
                 * while the price is being worked out or could not be, because checkout would only
                 * meet the same refusal; the error above it says why and offers Retry.
                 */}
                <Pressable
                    testID="cart-checkout"
                    role="button"
                    accessibilityRole="button"
                    accessibilityState={{ disabled: checkoutOff }}
                    disabled={checkoutOff}
                    onPress={() => {
                        router.push('/customer/checkout' as never);
                    }}
                    className={cx(
                        'group mt-3.5 h-14 flex-row items-center justify-between rounded-2xl px-5',
                        checkoutOff
                            ? 'bg-stroke-subtle'
                            : 'bg-surface-brand hover:bg-surface-canopy',
                    )}
                >
                    <RNText
                        className={cx(
                            'text-base font-bold',
                            checkoutOff ? 'text-content-secondary' : 'text-content-on-brand',
                        )}
                    >
                        {t('commerce:cart.checkout')}
                    </RNText>
                    <View
                        className={cx(
                            'h-9 w-9 items-center justify-center rounded-full transition duration-normal ease-standard',
                            checkoutOff ? 'bg-surface-raised/60' : 'bg-content-on-brand/20',
                        )}
                    >
                        <Icon
                            name="arrowForward"
                            size="md"
                            className={
                                checkoutOff ? 'text-content-secondary' : 'text-content-on-brand'
                            }
                        />
                    </View>
                </Pressable>
            </View>
        </View>
    );

    const wide = atLeast('lg');

    return (
        <View testID="cart-screen" className="flex-col pb-12">
            <View className="flex-row flex-wrap items-center gap-3.5 pt-1">
                <BackPill
                    testID="cart-keep-shopping"
                    label={t('commerce:cart.keepShopping')}
                    onPress={goBrowse}
                    className="me-1.5"
                />
                <RNText
                    testID="cart-title"
                    role="heading"
                    aria-level={1}
                    className="font-display text-4xl font-bold tracking-display text-content-primary text-start"
                >
                    {t('commerce:cart.title')}
                </RNText>
                {basket === undefined || isEmpty ? null : (
                    <View className="h-[30px] justify-center rounded-full bg-surface-brand-subtle px-3">
                        <RNText className="text-sm font-semibold text-content-on-brand-subtle">
                            {countLabel}
                        </RNText>
                    </View>
                )}
            </View>
            {isEmpty ? null : (
                <View testID="cart-deliver" className="z-20 mt-3.5 items-start">
                    <DeliverToMenu testID="cart" framed kitchenId={kitchenId} />
                </View>
            )}

            <View className="mt-[22px]">
                <QueryStates
                    query={cart}
                    isEmpty={false}
                    emptyTitle={t('commerce:cart.emptyTitle')}
                    skeletonCount={2}
                    testID="cart"
                >
                    {isEmpty ? (
                        <View
                            testID="cart-empty"
                            className="items-center gap-3 rounded-[28px] border border-stroke-subtle bg-surface-raised px-6 py-14"
                        >
                            <View className="h-[104px] w-[104px] items-center justify-center rounded-full bg-surface-brand-subtle">
                                <Icon
                                    name="shoppingBasket"
                                    size="lg"
                                    className="text-content-on-brand-subtle"
                                />
                            </View>
                            <RNText
                                accessibilityRole="header"
                                aria-level={2}
                                className="mt-1.5 font-display text-2xl font-bold tracking-display text-content-primary text-center"
                            >
                                {t('commerce:cart.emptyTitle')}
                            </RNText>
                            <Pressable
                                testID="cart-browse"
                                role="button"
                                accessibilityRole="button"
                                onPress={goBrowse}
                                className="h-[50px] flex-row items-center gap-2 rounded-[15px] bg-surface-brand px-[22px] hover:bg-surface-canopy"
                            >
                                <RNText className="text-base font-bold text-content-on-brand">
                                    {t('commerce:cart.browseMenu')}
                                </RNText>
                                <Icon
                                    name="chevronForward"
                                    size="sm"
                                    className="text-content-on-brand"
                                />
                            </Pressable>
                            {popularMeals.length === 0 ? null : (
                                <View
                                    testID="cart-popular"
                                    className="mt-[22px] w-full max-w-[900px]"
                                >
                                    <RNText className="mb-3 text-xs font-bold uppercase tracking-wider text-content-secondary text-start">
                                        {t('commerce:cart.popularNow')}
                                    </RNText>
                                    <SuggestionRow
                                        meals={popularMeals}
                                        inBasket={inBasket}
                                        columns={atLeast('md') ? 4 : 2}
                                        onAdd={(meal) => {
                                            basketAdd.add(meal);
                                        }}
                                    />
                                </View>
                            )}
                        </View>
                    ) : wide ? (
                        <View testID="cart-layout" className="flex-row items-start gap-6">
                            <View testID="cart-layout-main" className="min-w-0 flex-1">
                                {lines}
                            </View>
                            <View
                                testID="cart-layout-aside"
                                className="z-auto w-[384px] shrink-0 self-start web:sticky web:top-0"
                            >
                                {summary}
                            </View>
                        </View>
                    ) : (
                        <View testID="cart-layout" className="flex-col gap-6">
                            <View testID="cart-layout-main">{lines}</View>
                            <View testID="cart-layout-aside">{summary}</View>
                        </View>
                    )}
                </QueryStates>
            </View>
            {basketAdd.dialog}
        </View>
    );
}

/** A row of small dish cards, each with its own Add — "Goes well with it" and "Popular right now". */
function SuggestionRow({
    meals,
    inBasket,
    columns,
    onAdd,
}: {
    readonly meals: readonly MarketplaceMeal[];
    readonly inBasket: ReadonlySet<string>;
    readonly columns: number;
    readonly onAdd: (meal: MarketplaceMeal) => void;
}) {
    const { t } = useTranslation();
    const formatter = useFormatter();
    const rows: MarketplaceMeal[][] = [];
    meals.forEach((meal, index) => {
        (rows[Math.floor(index / columns)] ??= []).push(meal);
    });

    return (
        <View className="flex-col gap-2.5">
            {rows.map((row, rowIndex) => (
                <View key={row[0]?.id ?? String(rowIndex)} className="flex-row gap-2.5">
                    {Array.from({ length: columns }, (_, column) => {
                        const meal = row[column];
                        if (meal === undefined)
                            return <View key={column} className="min-w-0 flex-1" />;
                        const added = inBasket.has(String(meal.id));
                        return (
                            <View
                                key={meal.id}
                                testID={`cart-suggestion-${meal.slug}`}
                                className="relative min-w-0 flex-1 overflow-hidden rounded-[18px] border border-stroke-subtle bg-surface-raised transition duration-normal ease-standard hover:-translate-y-1 hover:shadow-elevation-2"
                            >
                                <View className="h-[92px]">
                                    <EntityImage
                                        assetId={meal.imagePlaceholderId}
                                        photoUrl={meal.photoUrl}
                                        variant="card"
                                        seed={meal.slug}
                                        label={meal.name}
                                        decorative
                                        flush
                                        className="h-full w-full"
                                    />
                                </View>
                                <View className="pb-3 pe-[52px] ps-3 pt-2.5">
                                    <RNText
                                        numberOfLines={2}
                                        className="text-sm font-bold leading-[17px] text-content-primary text-start"
                                    >
                                        {meal.name}
                                    </RNText>
                                    <RNText className="text-xs tabular-nums text-content-secondary text-start">
                                        {formatMoney(formatter, meal.price)}
                                    </RNText>
                                </View>
                                <Pressable
                                    testID={`cart-suggestion-${meal.slug}-add`}
                                    role="button"
                                    accessibilityRole="button"
                                    accessibilityLabel={t(
                                        added
                                            ? 'commerce:cart.addAnother'
                                            : 'commerce:cart.addNamed',
                                        { meal: meal.name },
                                    )}
                                    onPress={() => {
                                        onAdd(meal);
                                    }}
                                    className={cx(
                                        'absolute bottom-2.5 end-2.5 h-9 w-9 items-center justify-center rounded-xl',
                                        added
                                            ? 'bg-surface-brand'
                                            : 'bg-surface-brand-subtle hover:bg-surface-brand',
                                    )}
                                >
                                    <Icon
                                        name={added ? 'check' : 'plus'}
                                        size="sm"
                                        className={
                                            added
                                                ? 'text-content-on-brand'
                                                : 'text-content-on-brand-subtle'
                                        }
                                    />
                                </Pressable>
                            </View>
                        );
                    })}
                </View>
            ))}
        </View>
    );
}
