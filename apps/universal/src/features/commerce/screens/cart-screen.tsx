import { Button, Callout, TextInputField } from '@healthy360/design-system';
import type { Cart, CustomerAddress } from '@healthy360/api-client/contracts';
import { useFormatter } from '@healthy360/i18n';
import { useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Text as RNText, View } from 'react-native';

import { useAddressesQuery } from '../../../data/account-hooks.ts';
import {
    toFailure,
    useCartQuery,
    useCheckoutPreviewQuery,
    useRemoveCartItemMutation,
    useSetCartItemQuantityMutation,
} from '../../../data/commerce-hooks.ts';
import { usePrototypeAction } from '../../../prototype/index.ts';
import { Eyebrow } from '../../../ui/eyebrow.tsx';
import { formatMoney } from '../../marketplace/format.ts';
import { QueryStates } from '../../marketplace/query-states.tsx';
import { CartLine } from '../cart-line.tsx';
import {
    CheckoutCard,
    CheckoutColumns,
    CheckoutPage,
    CheckoutTitle,
    SummaryRow,
    SummaryTotal,
} from '../checkout-frame.tsx';
import { earliestStartDate } from '../dates.ts';
import { ALLERGEN_CONFLICT_WARNING } from '../warnings.ts';

/**
 * `/customer/cart` — the basket, in HealthZone's `cart` composition: "Your cart" over a line saying
 * where and from when it would be delivered, the lines card with its "add another?" band, and the
 * order summary as a sticky rail beside it from `lg` and after it below.
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
 * - the fine print under the button states how payment works instead of a cancellation promise
 *   nothing enforces.
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

export function CartScreen() {
    const { t } = useTranslation();
    const router = useRouter();
    const formatter = useFormatter();
    const runPrototype = usePrototypeAction();

    const cart = useCartQuery();
    const basket: Cart | undefined = cart.data;
    const addresses = useAddressesQuery();
    const homeAddress = defaultAddressOf(addresses.data);

    const setQuantity = useSetCartItemQuantityMutation();
    const removeItem = useRemoveCartItemMutation();
    const [promoCode, setPromoCode] = useState('');

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

    const mutationFailure = toFailure(setQuantity.error) ?? toFailure(removeItem.error);
    const busy = setQuantity.isPending || removeItem.isPending;
    const isEmpty = basket !== undefined && basket.items.length === 0;

    const goBrowse = () => {
        router.push('/meals');
    };

    const earliest = formatter.formatDate(earliestStartDate(), { dateStyle: 'medium' });
    const subtitle =
        homeAddress === null
            ? t('commerce:cart.subtitleNoAddress', { date: earliest })
            : t('commerce:cart.subtitle', { address: homeAddress.line1, date: earliest });

    /* ── the lines card ─────────────────────────────────────────────────────────────────────── */

    const lines =
        basket === undefined ? null : (
            <View className="flex-col gap-4">
                <CheckoutCard padding="none" testID="cart-lines-card">
                    <View testID="cart-lines" className="flex-col">
                        {basket.items.map((item) => (
                            <CartLine
                                key={item.id}
                                item={item}
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

                    {/* The design's "Add a side or drink?" band, without the claim about sides. */}
                    <View className="flex-row flex-wrap items-center justify-between gap-3 bg-surface-sunken px-4 py-4 sm:px-5">
                        <RNText className="shrink text-sm text-content-secondary text-start">
                            {t('commerce:cart.addMoreBody')}
                        </RNText>
                        <Button
                            testID="cart-add-more"
                            size="sm"
                            variant="secondary"
                            label={t('commerce:cart.browse')}
                            onPress={goBrowse}
                        />
                    </View>
                </CheckoutCard>

                {mutationFailure === null ? null : (
                    <Callout
                        testID="cart-mutation-error"
                        role="alert"
                        tone="danger"
                        title={t('commerce:cart.updateFailedTitle')}
                        body={mutationFailure.message}
                    />
                )}
            </View>
        );

    /* ── the order summary ──────────────────────────────────────────────────────────────────── */

    const summary = (
        <CheckoutCard testID="cart-summary">
            <View className="flex-col">
                <Eyebrow>{t('commerce:cart.summaryTitle')}</Eyebrow>
                <QueryStates
                    query={preview}
                    isEmpty={false}
                    emptyTitle={t('commerce:cart.summaryEmpty')}
                    skeletonCount={1}
                    testID="cart-preview"
                >
                    {quotation === undefined ? null : (
                        <View className="flex-col">
                            <View testID="cart-price" className="mt-4 flex-col gap-3">
                                <SummaryRow
                                    testID="cart-price-subtotal"
                                    label={t('commerce:cart.subtotal')}
                                    value={formatMoney(formatter, quotation.subtotal)}
                                />
                                <SummaryRow
                                    testID="cart-price-delivery"
                                    label={t('commerce:cart.delivery')}
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

                            <View className="mt-4 flex-row items-start gap-2">
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
                                <Button
                                    testID="cart-promo-apply"
                                    variant="quiet"
                                    label={t('commerce:cart.promoApply')}
                                    accessibilityHint={t('marketplace:prototype.notBuilt')}
                                    onPress={() => {
                                        runPrototype({
                                            contract: 'POST /api/v1/carts/{cart}/promotions',
                                        });
                                    }}
                                />
                            </View>

                            <View className="mt-5">
                                <SummaryTotal
                                    testID="cart-price-total"
                                    label={t('commerce:cart.total')}
                                    total={quotation.total}
                                    rule
                                />
                            </View>

                            {quotation.warnings.includes(ALLERGEN_CONFLICT_WARNING) ? (
                                <View className="mt-4">
                                    <Callout
                                        testID="cart-allergen-warning"
                                        role="alert"
                                        tone="danger"
                                        icon="warning"
                                        title={t('commerce:cart.allergenTitle')}
                                        body={t('commerce:cart.allergenBody')}
                                    />
                                </View>
                            ) : null}

                            <View className="mt-4">
                                <Button
                                    testID="cart-checkout"
                                    block
                                    size="lg"
                                    label={t('commerce:cart.checkout')}
                                    onPress={() => {
                                        router.push('/customer/checkout' as never);
                                    }}
                                />
                            </View>
                            <RNText
                                testID="cart-fine-print"
                                className="mt-3 text-xs text-content-secondary text-start"
                            >
                                {t('commerce:cart.finePrint')}
                            </RNText>
                        </View>
                    )}
                </QueryStates>
            </View>
        </CheckoutCard>
    );

    return (
        <CheckoutPage testID="cart-screen">
            <View className="flex-col gap-1">
                <CheckoutTitle testID="cart-title">{t('commerce:cart.title')}</CheckoutTitle>
                <RNText
                    testID="cart-subtitle"
                    className="text-base text-content-secondary text-start"
                >
                    {subtitle}
                </RNText>
            </View>

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
                        className="items-center rounded-xl border border-dashed border-stroke-strong bg-surface-sunken px-6 py-16"
                    >
                        <RNText
                            accessibilityRole="header"
                            aria-level={2}
                            className="font-display text-2xl font-bold tracking-display text-content-primary text-center"
                        >
                            {t('commerce:cart.emptyTitle')}
                        </RNText>
                        <RNText className="mb-5 mt-2 text-base text-content-secondary text-center">
                            {t('commerce:cart.emptyBody')}
                        </RNText>
                        <Button
                            testID="cart-browse"
                            label={t('commerce:cart.browseMenu')}
                            onPress={goBrowse}
                        />
                    </View>
                ) : (
                    <CheckoutColumns testID="cart-layout" main={lines} aside={summary} />
                )}
            </QueryStates>
        </CheckoutPage>
    );
}
