import { CartId, KitchenId, MealId, isCurrencyCode } from '@healthy360/domain-types';
import type { Money } from '@healthy360/domain-types';

import type {
    AddCartItemRequest,
    Cart,
    CartItem,
    CheckoutPreview,
    CommerceRepository,
    GetCartOptions,
    PreviewCheckoutRequest,
    PriceLine,
} from '../contracts/commerce.ts';
import { ApiError, apiFailure, validationFailure } from '../contracts/failure.ts';
import type {
    Cart as WireCart,
    CartLine as WireCartLine,
    CheckoutPreview as WireCheckoutPreview,
    MarketplaceMeal as WireMeal,
} from '../generated/types.ts';
import { mapMarketplaceMeal, pathSegment } from './marketplace-mappers.ts';
import type { Transport } from './transport.ts';

/**
 * Cart + real server-side checkout preview, over HTTP.
 *
 * The wire cart carries **no prices** (repriced at placement). Domain `Cart` needs names, unit
 * prices and allergens for the UI, so every projection hydrates lines via
 * `GET /marketplace/meals/{id}` for consumer channels, or `GET /b2b/catalogue/items/{id}` for
 * wholesale channels — the same enrichment the mock world does from fixtures.
 *
 * `previewCheckout` calls `POST /checkouts/preview`, which runs the identical `LineProbe` and
 * `ZoneResolver` paths placement runs, so the number a person sees here and the number they are
 * charged at `POST /orders` are never two different answers for a basket nothing has changed
 * about. The endpoint returns totals only — no per-line breakdown — so `lines` is a simplified
 * two-entry summary (`subtotal`, and `delivery_fee` when one resolved) rather than the hydrated
 * per-meal lines `getCart` builds; a screen that needs the meals already holds the cart.
 */

/** Channel code the authenticated consumer storefront opens. Matches the Verdant demo `web-shop`. */
export const DEFAULT_CART_CHANNEL_CODE = 'web-shop';

/** Channel code corporate buyers open. Matches `B2bCheckoutWorld` and the demo wholesale channel. */
export const DEFAULT_B2B_CART_CHANNEL_CODE = 'wholesale';

export type ApiCartSurface = Pick<
    CommerceRepository,
    'getCart' | 'addCartItem' | 'removeCartItem' | 'previewCheckout'
>;

interface WireB2bCatalogueItem {
    readonly id: string;
    readonly name: string;
    readonly item_type: string;
    readonly seller_organisation_id: string;
    readonly sales_channel_id: string;
    readonly price: { readonly amount_minor: number; readonly currency_code: string } | null;
}

interface WireB2bCatalogueShow {
    readonly item: WireB2bCatalogueItem;
}

function isB2bChannel(channelCode: string): boolean {
    return channelCode !== DEFAULT_CART_CHANNEL_CODE;
}

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

async function fetchB2bCatalogueItem(transport: Transport, itemId: string) {
    const payload = await transport.request<WireB2bCatalogueShow>({
        method: 'GET',
        path: `/b2b/catalogue/items/${pathSegment(itemId)}`,
    });
    const wire = payload.item;
    if (wire.price === null || !isCurrencyCode(wire.price.currency_code)) {
        throw new ApiError(
            apiFailure('server', {
                message: `Catalogue item ${itemId} has no displayable contract price.`,
                retryable: false,
            }),
        );
    }

    return {
        name: wire.name,
        mealId: MealId.unsafe(wire.id),
        kitchenId: KitchenId.unsafe(wire.seller_organisation_id),
        unitPrice: money(wire.price.amount_minor, wire.price.currency_code),
        allergens: [] as CartItem['allergens'],
    };
}

async function mapCartLine(
    transport: Transport,
    line: WireCartLine,
    channelCode: string,
): Promise<CartItem> {
    const quantity = Number.parseFloat(line.quantity) || 0;

    if (isB2bChannel(channelCode)) {
        const item = await fetchB2bCatalogueItem(transport, line.catalogue_item_id);
        const lineTotal = money(item.unitPrice.amount * quantity, item.unitPrice.currency);

        return {
            id: line.id,
            mealId: item.mealId,
            kitchenId: item.kitchenId,
            name: item.name,
            quantity,
            unitPrice: item.unitPrice,
            lineTotal,
            allergens: item.allergens,
            deliveryDate: line.delivery_date,
        };
    }

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

async function mapCart(transport: Transport, wire: WireCart, channelCode: string): Promise<Cart> {
    const items: CartItem[] = [];
    for (const line of wire.lines) {
        items.push(await mapCartLine(transport, line, channelCode));
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

/**
 * The one warning code the wire and the UI vocabulary (`warnings.ts`) already agree on. Every
 * other server code is passed through under the same `checkout.` namespace the UI's
 * {@link warningMessageKey} expects — an unrecognised one still renders (as the generic key), it
 * simply has no written copy yet.
 */
const WIRE_CART_EMPTY = 'cart_empty';

function mapPreviewWarning(code: string): string {
    return code === WIRE_CART_EMPTY ? 'checkout.empty_cart' : `checkout.${code}`;
}

function mapCheckoutPreview(
    wire: WireCheckoutPreview,
    request: PreviewCheckoutRequest,
): CheckoutPreview {
    const currency = isCurrencyCode(wire.currency_code) ? wire.currency_code : 'USD';
    const subtotal = money(wire.subtotal_minor, currency);
    const deliveryFee =
        wire.delivery_fee_minor === null ? null : money(wire.delivery_fee_minor, currency);

    const lines: PriceLine[] = [{ code: 'subtotal', label: 'Subtotal', amount: subtotal }];
    if (deliveryFee !== null) {
        lines.push({ code: 'delivery_fee', label: 'Delivery fee', amount: deliveryFee });
    }

    return {
        cartId: CartId.unsafe(wire.cart_id),
        lines,
        subtotal,
        deliveryFee,
        discount: null,
        total: money(wire.total_minor, currency),
        earliestDeliveryDate: request.deliveryDate ?? null,
        warnings: wire.warnings.map(mapPreviewWarning),
        paymentDeferred: true,
    };
}

export function createApiCartSurface(transport: Transport): ApiCartSurface {
    let sessionChannelCode = DEFAULT_CART_CHANNEL_CODE;

    async function openCart(channelCode?: string): Promise<Cart> {
        const code = channelCode ?? sessionChannelCode;
        sessionChannelCode = code;

        const payload = await transport.request<{ cart: WireCart }>({
            method: 'POST',
            path: '/carts',
            body: { channel_code: code },
        });
        return mapCart(transport, payload.cart, code);
    }

    return {
        async getCart(options?: GetCartOptions): Promise<Cart> {
            return openCart(options?.channelCode);
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
            return mapCart(transport, payload.cart, sessionChannelCode);
        },

        async removeCartItem(cartId, itemId: string): Promise<Cart> {
            await transport.requestVoid({
                method: 'DELETE',
                path: `/carts/${pathSegment(cartId)}/items/${pathSegment(itemId)}`,
            });
            return openCart();
        },

        async previewCheckout(request: PreviewCheckoutRequest): Promise<CheckoutPreview> {
            const payload = await transport.request<{ preview: WireCheckoutPreview }>({
                method: 'POST',
                path: '/checkouts/preview',
                body: {
                    cart_id: String(request.cartId),
                    ...(request.addressId === undefined
                        ? {}
                        : { customer_address_id: request.addressId }),
                    ...(request.slotCode === undefined
                        ? {}
                        : { delivery_window_code: request.slotCode }),
                    ...(request.deliveryDate === undefined
                        ? {}
                        : { requested_delivery_date: request.deliveryDate }),
                },
            });
            return mapCheckoutPreview(payload.preview, request);
        },
    };
}
