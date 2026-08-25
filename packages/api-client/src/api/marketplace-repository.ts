import type { DietitianId, KitchenId, MealId } from '@healthy360/domain-types';

import type {
    DietCategory,
    Dietitian,
    DietitianFilter,
    Kitchen,
    KitchenFilter,
    MarketplaceMeal,
    MarketplaceRepository,
    MealFilter,
} from '../contracts/marketplace.ts';
import { ApiError, apiFailure } from '../contracts/failure.ts';
import type { CursorPage } from '../contracts/pagination.ts';
import type {
    MarketplaceKitchen as WireKitchen,
    MarketplaceKitchensEnvelope,
    MarketplaceMeal as WireMeal,
    MarketplaceMealsEnvelope,
} from '../generated/types.ts';
import {
    listParameter,
    mapCursorPage,
    mapKitchen,
    mapMarketplaceMeal,
    pathSegment,
} from './marketplace-mappers.ts';
import { PROTOTYPE_ENDPOINTS, notImplemented } from './prototype-repositories.ts';
import { createApiPlanReads } from './plan-mappers.ts';
import type { Transport } from './transport.ts';

/**
 * The marketplace repository, half real (M1).
 *
 * **Kitchens and meals are served by the API.** Their endpoints exist, are anonymous, are described
 * in the OpenAPI document and are swept for leaks on every run. **Plans, dietitians and diet
 * categories are not**, and each one rejects with `prototype.not_implemented` naming the endpoint it
 * would call — the same behaviour, and the same honesty, they had before this file existed.
 *
 * The split is not arbitrary and it is not temporary laziness:
 *
 * - **Plans** have a backend (`GET /marketplace/meal-plans`), and it correctly returns nothing. No
 *   kitchen has a publishable subscription plan: the imported real-kitchen world is entirely draft
 *   by design, and the demonstration plan is deliberately left unpublishable. Switching the plan
 *   pages to an endpoint that honestly answers "none" would replace a working catalogue with an
 *   empty state, which the phase's own rule forbids — *do not degrade the plan page*. The moment a
 *   kitchen publishes a plan, this is a four-line change and a deleted ledger entry.
 * - **Dietitians** have no backend at all, and none is planned near-term. There is no module, no
 *   table and no endpoint; a stub that rejects is the truthful implementation.
 * - **Diet categories** are the same: nothing groups plans or meals into marketing categories
 *   server-side, so there is nothing to read.
 *
 * ## Anonymous by construction
 *
 * Every request here passes `anonymous: true`, which suppresses the `Authorization` header even
 * when a token exists. That is deliberate rather than incidental: these endpoints are identical for
 * everybody, and a response that varied with a bearer token would be a response that must not be
 * cached across a sign-out — which is exactly the property the marketplace contract relies on.
 * Sending the token would also make a signed-in person's browsing linkable to their account in the
 * access log for no benefit at all.
 */
export function createApiMarketplaceRepository(transport: Transport): MarketplaceRepository {
    /**
     * A query string from defined values only.
     *
     * `undefined` entries are dropped rather than sent empty: the endpoints treat an empty string
     * as absent anyway, but a URL carrying `?query=&area=` in the access log is a filter somebody
     * will eventually try to debug.
     */
    function query(parameters: Record<string, string | number | undefined>): string {
        const search = new URLSearchParams();
        for (const [key, value] of Object.entries(parameters)) {
            if (value === undefined) continue;
            search.set(key, String(value));
        }
        const rendered = search.toString();
        return rendered === '' ? '' : `?${rendered}`;
    }

    return {
        async listKitchens(filter?: KitchenFilter): Promise<CursorPage<Kitchen>> {
            const envelope = await transport.requestEnvelope<WireKitchen[]>({
                method: 'GET',
                anonymous: true,
                path: `/marketplace/kitchens${query({
                    query: filter?.query,
                    country_code: filter?.countryCode,
                    area: filter?.area,
                    channels: listParameter(filter?.channels),
                    cursor: filter?.cursor,
                    limit: filter?.limit,
                })}`,
            });

            return mapCursorPage(
                envelope.data,
                envelope.meta as MarketplaceKitchensEnvelope['meta'],
                mapKitchen,
            );
        },

        async getKitchen(kitchenId: KitchenId): Promise<Kitchen> {
            const wire = await transport.request<WireKitchen>({
                method: 'GET',
                anonymous: true,
                path: `/marketplace/kitchens/${pathSegment(kitchenId)}`,
            });

            return mapKitchen(wire);
        },

        async listMeals(filter?: MealFilter): Promise<CursorPage<MarketplaceMeal>> {
            const envelope = await transport.requestEnvelope<WireMeal[]>({
                method: 'GET',
                anonymous: true,
                path: `/marketplace/meals${query({
                    query: filter?.query,
                    kitchen_ids: listParameter(filter?.kitchenIds),
                    item_types: listParameter(filter?.itemTypes),
                    category_slug: filter?.categorySlug,
                    diet_classifications: listParameter(filter?.dietClassifications),
                    exclude_allergens: listParameter(filter?.excludeAllergens),

                    // The server filters on the price it resolved, so only the maximum crosses the
                    // wire; a minimum is not offered because nobody has asked to be shown only the
                    // expensive half of a menu.
                    price_max: filter?.price?.max,
                    available_on: filter?.availableOn,
                    cursor: filter?.cursor,
                    limit: filter?.limit,
                })}`,
            });

            return mapCursorPage(
                envelope.data,
                envelope.meta as MarketplaceMealsEnvelope['meta'],
                mapMarketplaceMeal,
            );
        },

        async getMeal(mealId: MealId): Promise<MarketplaceMeal> {
            const wire = await transport.request<WireMeal>({
                method: 'GET',
                anonymous: true,
                path: `/marketplace/meals/${pathSegment(mealId)}`,
            });

            const meal = mapMarketplaceMeal(wire);

            if (meal === null) {
                // Only reachable when the price carries a currency code this build's `Money` union
                // does not know — a kitchen opening in a new market before a client release. The
                // meal is genuinely on sale; this client cannot render what it costs, and a buy
                // button beside an unformattable price is the one outcome worth refusing. `server`
                // rather than a retry: repeating the request cannot change the answer.
                throw new ApiError(
                    apiFailure('server', {
                        message:
                            'This meal is priced in a currency this version of the app cannot ' +
                            'display. Updating the app will fix it.',
                        retryable: false,
                    }),
                );
            }

            return meal;
        },

        // Real published plans exist (DEC1: seven Healthy360 plans priced under the
        // owner-approved rule and published through readiness), so the prepared plan
        // reads are spread in and their ledger rows are gone.
        ...createApiPlanReads(transport),
        listDietitians(_filter?: DietitianFilter): Promise<CursorPage<Dietitian>> {
            return notImplemented(PROTOTYPE_ENDPOINTS.listDietitians);
        },
        getDietitian(_dietitianId: DietitianId): Promise<Dietitian> {
            return notImplemented(PROTOTYPE_ENDPOINTS.getDietitian);
        },
        listDietCategories(): Promise<readonly DietCategory[]> {
            return notImplemented(PROTOTYPE_ENDPOINTS.listDietCategories);
        },
    };
}
