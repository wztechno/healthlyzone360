import {
    Button,
    Callout,
    Card,
    Heading,
    Inline,
    NumberStepper,
    Stack,
    Text,
} from '@healthy360/design-system';
import type { Cart, CartItem } from '@healthy360/api-client/contracts';
import { useFormatter } from '@healthy360/i18n';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';

import {
    toFailure,
    useCartQuery,
    useCheckoutPreviewQuery,
    useRemoveCartItemMutation,
    useSetCartItemQuantityMutation,
} from '../../../data/commerce-hooks.ts';
import { formatMoney } from '../../marketplace/format.ts';
import { QueryStates } from '../../marketplace/query-states.tsx';
import { PriceSummary } from '../price-summary.tsx';
import type { PriceRow } from '../price-summary.tsx';
import { ALLERGEN_CONFLICT_WARNING } from '../warnings.ts';

/**
 * `/customer/cart` — the basket.
 *
 * ## Everything on this screen is real
 *
 * The quantity stepper, the remove control and the totals all move the world. `addCartItem` and
 * `removeCartItem` exist, the prototype store holds a real basket, and `previewCheckout` prices it.
 * Nothing here is a prototype notice, because nothing here needs to be — `usePrototypeAction()` is
 * for capabilities that genuinely do not exist, and a basket is not one of them.
 *
 * ## Why the totals come from a preview and are not added up here
 *
 * The subtotal on `Cart` is the repository's; the delivery fee and the total are `previewCheckout`'s.
 * The screen could add them — one line of arithmetic — and that is exactly why it does not. A basket
 * may one day hold two kitchens quoting two currencies, and a client-side sum of `Money.amount`
 * would produce a confident, wrong number. Pricing is a server concern and stays one.
 *
 * ## Doc 11, `SUB-05`
 *
 * The reference product has no basket at all: its subscription flow goes from configuration
 * straight to purchase. Ours has one because we sell individual meals as well as plans, and a
 * marketplace of forty meals across six kitchens without a basket forces one checkout per dish.
 * The subscription flow still bypasses it entirely, which is the part of `SUB-05` worth keeping.
 */

/** Bounds for one line. Above ten, a household is ordering for an event and should talk to us. */
const MIN_QUANTITY = 1;
const MAX_QUANTITY = 10;

export function CartScreen() {
    const { t } = useTranslation();
    const router = useRouter();
    const formatter = useFormatter();

    const cart = useCartQuery();
    const basket: Cart | undefined = cart.data;

    const setQuantity = useSetCartItemQuantityMutation();
    const removeItem = useRemoveCartItemMutation();

    // Priced only when there is something to price. An empty basket has a preview — the repository
    // answers with a `checkout.empty_cart` warning — but showing a delivery fee for nothing is
    // noise, and the empty state is a better answer than a total of zero.
    const preview = useCheckoutPreviewQuery(
        basket === undefined || basket.items.length === 0 ? null : { cartId: basket.id },
    );

    const mutationFailure = toFailure(setQuantity.error) ?? toFailure(removeItem.error);

    const browseAction = (
        <Button
            testID="cart-browse"
            label={t('commerce:cart.browse')}
            onPress={() => {
                router.push('/meals');
            }}
        />
    );

    const rows: readonly PriceRow[] =
        preview.data === undefined
            ? []
            : [
                  {
                      key: 'subtotal',
                      label: t('commerce:cart.subtotal'),
                      amount: preview.data.subtotal,
                  },
                  ...(preview.data.deliveryFee === null
                      ? [
                            {
                                key: 'delivery-free',
                                label: t('commerce:cart.delivery'),
                                amount: { amount: 0, currency: preview.data.total.currency },
                                note: t('commerce:cart.deliveryFree'),
                            },
                        ]
                      : [
                            {
                                key: 'delivery',
                                label: t('commerce:cart.delivery'),
                                amount: preview.data.deliveryFee,
                            },
                        ]),
                  {
                      key: 'total',
                      label: t('commerce:cart.total'),
                      amount: preview.data.total,
                      emphasis: true,
                  },
              ];

    return (
        <Stack space="lg" testID="cart-screen">
            <Stack space="xs">
                <Heading level={1} testID="cart-title">
                    {t('commerce:cart.title')}
                </Heading>
                <Text tone="secondary">{t('commerce:cart.body')}</Text>
            </Stack>

            <QueryStates
                query={cart}
                isEmpty={basket !== undefined && basket.items.length === 0}
                emptyTitle={t('commerce:cart.emptyTitle')}
                emptyBody={t('commerce:cart.emptyBody')}
                emptyActions={browseAction}
                skeletonCount={2}
                testID="cart"
            >
                {basket === undefined ? null : (
                    <Stack space="md">
                        <Text testID="cart-count">
                            {t('commerce:cart.count', {
                                count: basket.itemCount,
                                items: formatter.formatNumber(basket.itemCount),
                            })}
                        </Text>

                        <Stack space="sm" testID="cart-lines">
                            {basket.items.map((item) => (
                                <CartLine
                                    key={item.id}
                                    item={item}
                                    priceText={formatMoney(formatter, item.lineTotal)}
                                    unitPriceText={formatMoney(formatter, item.unitPrice)}
                                    busy={setQuantity.isPending || removeItem.isPending}
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
                        </Stack>

                        {mutationFailure === null ? null : (
                            <Callout
                                testID="cart-mutation-error"
                                role="alert"
                                tone="danger"
                                title={t('commerce:cart.updateFailedTitle')}
                                body={mutationFailure.message}
                            />
                        )}

                        <Card testID="cart-summary" padding="md" tone="sunken">
                            <Stack space="md">
                                <Text variant="label">{t('commerce:cart.summaryTitle')}</Text>
                                <QueryStates
                                    query={preview}
                                    isEmpty={preview.data === undefined}
                                    emptyTitle={t('commerce:cart.summaryEmpty')}
                                    skeletonCount={1}
                                    testID="cart-preview"
                                >
                                    <Stack space="md">
                                        <PriceSummary
                                            rows={rows}
                                            testID="cart-price"
                                            caption={t('commerce:cart.priceCaption')}
                                        />
                                        {preview.data?.warnings.includes(
                                            ALLERGEN_CONFLICT_WARNING,
                                        ) === true ? (
                                            <Callout
                                                testID="cart-allergen-warning"
                                                role="alert"
                                                tone="danger"
                                                icon="warning"
                                                title={t('commerce:cart.allergenTitle')}
                                                body={t('commerce:cart.allergenBody')}
                                            />
                                        ) : null}
                                        <Button
                                            testID="cart-checkout"
                                            block
                                            label={t('commerce:cart.checkout')}
                                            onPress={() => {
                                                router.push('/customer/checkout' as never);
                                            }}
                                        />
                                    </Stack>
                                </QueryStates>
                            </Stack>
                        </Card>
                    </Stack>
                )}
            </QueryStates>
        </Stack>
    );
}

interface CartLineProps {
    readonly item: CartItem;
    readonly priceText: string;
    readonly unitPriceText: string;
    readonly busy: boolean;
    readonly onQuantity: (quantity: number) => void;
    readonly onRemove: () => void;
    readonly onOpen: () => void;
}

function CartLine({
    item,
    priceText,
    unitPriceText,
    busy,
    onQuantity,
    onRemove,
    onOpen,
}: CartLineProps) {
    const { t } = useTranslation();

    return (
        <Card testID={`cart-line-${item.id}`} padding="md">
            <Stack space="sm">
                <Inline space="sm" align="center" justify="between">
                    <Stack space="none">
                        <Text variant="bodyStrong" testID={`cart-line-${item.id}-name`}>
                            {item.name}
                        </Text>
                        <Text tone="secondary" variant="caption">
                            {t('commerce:cart.unitPrice', { price: unitPriceText })}
                        </Text>
                    </Stack>
                    <Text variant="bodyStrong" testID={`cart-line-${item.id}-total`}>
                        {priceText}
                    </Text>
                </Inline>

                <NumberStepper
                    testID={`cart-line-${item.id}-quantity`}
                    label={t('commerce:cart.quantityLabel', { meal: item.name })}
                    value={item.quantity}
                    min={MIN_QUANTITY}
                    max={MAX_QUANTITY}
                    step={1}
                    disabled={busy}
                    onChange={(next) => {
                        if (next === null) return;
                        onQuantity(next);
                    }}
                />

                <Inline space="sm" wrap>
                    <Button
                        testID={`cart-line-${item.id}-open`}
                        size="sm"
                        variant="ghost"
                        label={t('commerce:cart.viewMeal')}
                        onPress={onOpen}
                    />
                    <Button
                        testID={`cart-line-${item.id}-remove`}
                        size="sm"
                        variant="secondary"
                        label={t('commerce:cart.remove')}
                        accessibilityHint={t('commerce:cart.removeHint', { meal: item.name })}
                        disabled={busy}
                        onPress={onRemove}
                    />
                </Inline>
            </Stack>
        </Card>
    );
}
