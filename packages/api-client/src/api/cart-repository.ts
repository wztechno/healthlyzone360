import { CartId, KitchenId, MealId, isCurrencyCode } from '@healthy360/domain-types';
import type { Money } from '@healthy360/domain-types';

import type {
    AddCartItemRequest,
    AllergenConflict,
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
    AllergenConflict as WireAllergenConflict,
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
 * prices and allergens for the UI, so every projection hydrates lines — for consumer channels from
 * one `GET /marketplace/meals?ids=` per basket (kept a minute, see `MEAL_LOOKUP_TTL_MS`), for
 * wholesale channels from `GET /b2b/catalogue/items/{id}` per line, the buyer's contract price.
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
    return toMeal(wire, mealId);
}

function toMeal(wire: WireMeal, mealId: string) {
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

type MealLookup = (mealId: string) => ReturnType<typeof fetchMeal>;

async function mapCartLine(
    transport: Transport,
    lookupMeal: MealLookup,
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

    const meal = await lookupMeal(line.catalogue_item_id);
    const unitPrice = meal.price;
    const lineTotal = money(unitPrice.amount * quantity, unitPrice.currency);

    return {
        id: line.id,
        mealId: MealId.unsafe(line.catalogue_item_id),
        kitchenId: meal.kitchenId,
        kitchenName: meal.kitchenName,
        name: meal.name,
        quantity,
        unitPrice,
        lineTotal,
        allergens: meal.allergens,
        deliveryDate: line.delivery_date,
    };
}

/**
 * A wire cart, hydrated into one the UI can render.
 *
 * ## The lines are fetched together, not one after another
 *
 * `CartPresenter::line` publishes `catalogue_item_id` and `quantity` and nothing else — no name, no
 * price — so every line has to be looked up before a basket can be drawn. That is a server-side gap
 * and it is recorded as one; what is fixed here is the shape of the asking. This loop used to be a
 * `for … await`, which made a five-line basket five *sequential* round trips, and every call that
 * returns a cart pays it: opening one, adding to one, removing from one. Adding a single item to a
 * four-line basket cost seventeen requests in series and took seconds.
 *
 * `Promise.all` issues them in one wave. Order is preserved — `Promise.all` resolves positionally,
 * not by completion — so `items` still matches `wire.lines`, which the repository tests assert.
 *
 * It is one wave rather than one request, and how much that buys depends on what is serving the
 * API: php-fpm behind nginx overlaps them, PHP's built-in `artisan serve` does not. The requests
 * that this change *removes* (see `useAddCartItemMutation`) are the ones that help either way.
 */
async function mapCart(
    transport: Transport,
    lookupMeal: MealLookup,
    wire: WireCart,
    channelCode: string,
): Promise<Cart> {
    const items: CartItem[] = await Promise.all(
        wire.lines.map((line) => mapCartLine(transport, lookupMeal, line, channelCode)),
    );

    const currency =
        items[0]?.unitPrice.currency ??
        (isCurrencyCode(wire.currency_code) ? wire.currency_code : 'USD');
    const subtotalAmount = items.reduce((sum, item) => sum + item.lineTotal.amount, 0);
    const itemCount = items.reduce((sum, item) => sum + item.quantity, 0);

    return {
        id: CartId.unsafe(wire.id),
        // The seller: a marketplace kitchen is its organisation (`kitchen_id` on a meal is the
        // same value), so this is the basket's kitchen even before it holds a line.
        kitchenId: KitchenId.unsafe(wire.organisation_id),
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

/** One meal the server's allergen rule flagged for this customer — checkout and subscriptions alike. */
export function mapAllergenConflict(wire: WireAllergenConflict): AllergenConflict {
    return {
        mealId: MealId.unsafe(wire.catalogue_item_id),
        reason: wire.reason,
        allergenCodes: wire.allergen_codes,
    };
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
        offeredWindowCodes: wire.offered_window_codes ?? null,
        allergenConflicts: (wire.allergen_conflicts ?? []).map(mapAllergenConflict),
        paymentDeferred: true,
    };
}

/**
 * How long a looked-up meal is reused for basket lines.
 *
 * Every add, remove and open used to look up every line again — a five-line basket paid five
 * `GET /marketplace/meals/{id}` per press, each one rebuilding the kitchen's whole marketplace
 * context on the server (~400ms cold on the dev droplet). The meal endpoint is anonymous, so its
 * answer is the same for every account and safe to keep across a sign-in change. A minute bounds how
 * stale a basket's displayed price can be; the number charged comes from `previewCheckout` and
 * placement, never from here. Wholesale lines are not kept: their price is the buyer's contract.
 */
const MEAL_LOOKUP_TTL_MS = 60_000;

export function createApiCartSurface(transport: Transport): ApiCartSurface {
    let sessionChannelCode = DEFAULT_CART_CHANNEL_CODE;
    const meals = new Map<
        string,
        { readonly at: number; readonly meal: ReturnType<typeof fetchMeal> }
    >();

    const fresh = (mealId: string) => {
        const known = meals.get(mealId);
        return known !== undefined && Date.now() - known.at < MEAL_LOOKUP_TTL_MS
            ? known.meal
            : undefined;
    };

    // The promise is kept, not the result, so lines that share a meal ask once.
    const remember = (mealId: string, meal: ReturnType<typeof fetchMeal>) => {
        meals.set(mealId, { at: Date.now(), meal });
        meal.catch(() => {
            meals.delete(mealId);
        });
        return meal;
    };

    const lookupMeal: MealLookup = (mealId) =>
        fresh(mealId) ?? remember(mealId, fetchMeal(transport, mealId));

    /**
     * Every line the cache cannot answer, in one `GET /marketplace/meals?ids=`. A line the list
     * leaves out — no longer on sale — and every line of a batch that failed (or a server that does
     * not know `ids` yet) fall back to their own lookup, which answers exactly as it always did.
     */
    const prefetchMeals = (lines: readonly WireCartLine[]) => {
        const missing = [...new Set(lines.map((line) => line.catalogue_item_id))]
            .filter((mealId) => fresh(mealId) === undefined)
            .slice(0, 100);
        if (missing.length < 2) return;

        const batch = transport.request<WireMeal[]>({
            method: 'GET',
            anonymous: true,
            path: `/marketplace/meals?ids=${missing.map(pathSegment).join(',')}&limit=${String(missing.length)}`,
        });
        for (const mealId of missing) {
            remember(
                mealId,
                batch.then(
                    (wires) => {
                        const wire = wires.find((candidate) => candidate.id === mealId);
                        return wire === undefined
                            ? fetchMeal(transport, mealId)
                            : toMeal(wire, mealId);
                    },
                    () => fetchMeal(transport, mealId),
                ),
            );
        }
    };

    const hydrate = (wire: WireCart, channelCode: string) => {
        if (!isB2bChannel(channelCode)) prefetchMeals(wire.lines);
        return mapCart(transport, lookupMeal, wire, channelCode);
    };

    /*
     * The kitchen is sent when the caller names one and is *not* remembered like the code is. Naming
     * it is a decision about one add ("put this meal in its kitchen's basket"); every later read —
     * the count after a removal, the basket page — means "the basket I have", which the server
     * answers from the person's own open basket when no kitchen is named.
     */
    async function openCart(channelCode?: string, kitchenId?: string): Promise<Cart> {
        const code = channelCode ?? sessionChannelCode;
        sessionChannelCode = code;

        const payload = await transport.request<{ cart: WireCart }>({
            method: 'POST',
            path: '/carts',
            body: {
                channel_code: code,
                ...(kitchenId === undefined ? {} : { kitchen_id: kitchenId }),
            },
        });
        return hydrate(payload.cart, code);
    }

    return {
        async getCart(options?: GetCartOptions): Promise<Cart> {
            return openCart(
                options?.channelCode,
                options?.kitchenId === undefined ? undefined : String(options.kitchenId),
            );
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
            return hydrate(payload.cart, sessionChannelCode);
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
