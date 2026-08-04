import { CartId, MealId, isCurrencyCode } from '@healthy360/domain-types';
import type { Money } from '@healthy360/domain-types';

import type {
    AddCartItemRequest,
    Cart,
    CartItem,
    CheckoutPreview,
    CommerceRepository,
    PreviewCheckoutRequest,
    PriceLine,
} from '../contracts/commerce.ts';
import { ApiError, apiFailure, validationFailure } from '../contracts/failure.ts';
import type {
    Cart as WireCart,
    CartLine as WireCartLine,
    MarketplaceMeal as WireMeal,
} from '../generated/types.ts';
import { mapMarketplaceMeal, pathSegment } from './marketplace-mappers.ts';
import type { Transport } from './transport.ts';

/**
 * Cart + interim checkout preview, over HTTP.
 *
 * The wire cart carries **no prices** (repriced at placement). Domain `Cart` needs names, unit
 * prices and allergens for the UI, so every projection hydrates lines via
 * `GET /marketplace/meals/{id}` — the same enrichment the mock world does from fixtures.
 *
 * `previewCheckout` has no Laravel route. The interim builds a quotation from the hydrated cart
 * subtotal with `deliveryFee: null` and a warning that delivery is priced at placement.
 */

/** Channel code the authenticated storefront opens. Matches the Verdant demo `web-shop`. */
export const DEFAULT_CART_CHANNEL_CODE = 'web-shop';

export type ApiCartSurface = Pick<
    CommerceRepository,
    'getCart' | 'addCartItem' | 'removeCartItem' | 'previewCheckout'
>;

function money(amountMinor: number, currency: string): Money {
    if (!isCurrencyCode(currency)) {
        throw new ApiError(
            apiFailure('server', {
                message:
                    'This basket is priced in a currency this version of the app cannot display.',
                retryable: false,
            }),
        );
    }
    return { amount: amountMinor, currency };
}

function zeroMoney(currency: string): Money {
    return money(0, isCurrencyCode(currency) ? currency : 'USD');
}

async function fetchMeal(transport: Transport, mealId: string) {
    const wire = await transport.request<WireMeal>({
        method: 'GET',
        anonymous: true,
        path: `/marketplace/meals/${pathSegment(mealId)}`,
    });
    const meal = mapMarketplaceMeal(wire);
    if (meal === null) {
        throw new ApiError(
            apiFailure('server', {
                message: `Meal ${mealId} cannot be displayed (unknown currency).`,
                retryable: false,
            }),
        );
    }
    return meal;
}

async function mapCartLine(transport: Transport, line: WireCartLine): Promise<CartItem> {
    const quantity = Number.parseFloat(line.quantity) || 0;
    const meal = await fetchMeal(transport, line.catalogue_item_id);
    const unitPrice = meal.price;
    const lineTotal = money(unitPrice.amount * quantity, unitPrice.currency);

    return {
        id: line.id,
        mealId: MealId.unsafe(line.catalogue_item_id),
        kitchenId: meal.kitchenId,
        name: meal.name,
        quantity,
        unitPrice,
        lineTotal,
        allergens: meal.allergens,
        deliveryDate: line.delivery_date,
    };
}

async function mapCart(transport: Transport, wire: WireCart): Promise<Cart> {
    const items: CartItem[] = [];
    for (const line of wire.lines) {
        items.push(await mapCartLine(transport, line));
    }

    const currency =
        items[0]?.unitPrice.currency ??
        (isCurrencyCode(wire.currency_code) ? wire.currency_code : 'USD');
    const subtotalAmount = items.reduce((sum, item) => sum + item.lineTotal.amount, 0);
    const itemCount = items.reduce((sum, item) => sum + item.quantity, 0);

    return {
        id: CartId.unsafe(wire.id),
        items,
        subtotal: money(subtotalAmount, currency),
        itemCount,
        updatedAt: wire.updated_at ?? wire.created_at ?? new Date(0).toISOString(),
    };
}

function previewFromCart(cart: Cart, request: PreviewCheckoutRequest): CheckoutPreview {
    const warnings: string[] = ['checkout.delivery_priced_at_placement'];
    if (cart.items.length === 0) warnings.unshift('checkout.empty_cart');

    const lines: PriceLine[] = [{ code: 'subtotal', label: 'Subtotal', amount: cart.subtotal }];

    return {
        cartId: cart.id,
        lines,
        subtotal: cart.subtotal,
        deliveryFee: null,
        discount: null,
        total: cart.subtotal,
        earliestDeliveryDate:
            request.deliveryDate ??
            cart.items.find((item) => item.deliveryDate)?.deliveryDate ??
            null,
        warnings,
        paymentDeferred: true,
    };
}

export function createApiCartSurface(transport: Transport): ApiCartSurface {
    async function openCart(): Promise<Cart> {
        const payload = await transport.request<{ cart: WireCart }>({
            method: 'POST',
            path: '/carts',
            body: { channel_code: DEFAULT_CART_CHANNEL_CODE },
        });
        return mapCart(transport, payload.cart);
    }

    return {
        async getCart(): Promise<Cart> {
            return openCart();
        },

        async addCartItem(cartId, request: AddCartItemRequest): Promise<Cart> {
            if (!Number.isFinite(request.quantity) || request.quantity <= 0) {
                throw new ApiError(validationFailure({ quantity: ['Order at least one.'] }));
            }

            const payload = await transport.request<{ cart: WireCart }>({
                method: 'POST',
                path: `/carts/${pathSegment(cartId)}/items`,
                body: {
                    catalogue_item_id: String(request.mealId),
                    quantity: request.quantity,
                    ...(request.deliveryDate === undefined
                        ? {}
                        : { delivery_date: request.deliveryDate }),
                },
            });
            return mapCart(transport, payload.cart);
        },

        async removeCartItem(cartId, itemId: string): Promise<Cart> {
            await transport.requestVoid({
                method: 'DELETE',
                path: `/carts/${pathSegment(cartId)}/items/${pathSegment(itemId)}`,
            });
            return openCart();
        },

        async previewCheckout(request: PreviewCheckoutRequest): Promise<CheckoutPreview> {
            const cart = await openCart();
            if (cart.items.length === 0) {
                return {
                    cartId: CartId.unsafe(String(request.cartId)),
                    lines: [],
                    subtotal: zeroMoney('USD'),
                    deliveryFee: null,
                    discount: null,
                    total: zeroMoney('USD'),
                    earliestDeliveryDate: null,
                    warnings: ['checkout.empty_cart'],
                    paymentDeferred: true,
                };
            }
            return previewFromCart(cart, request);
        },
    };
}
