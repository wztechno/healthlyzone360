import {
    KitchenId,
    MealId,
    PlanVariantId,
    SubscriptionPlanId,
    planDuration,
} from '@healthy360/domain-types';
import type { DietClassification, Money } from '@healthy360/domain-types';

import { ApiError, apiFailure } from '../contracts/failure.ts';
import type {
    PlanDurationOption,
    PlanFilter,
    PlanVariant,
    SubscriptionPlan,
} from '../contracts/marketplace.ts';
import type { CursorPage } from '../contracts/pagination.ts';
import type {
    MarketplaceListMeta as WireListMeta,
    MarketplacePlan as WirePlan,
    MarketplacePlanDuration as WireDuration,
    MarketplacePlanVariant as WireVariant,
} from '../generated/types.ts';
import { listParameter, mapCursorPage, mapMoney } from './marketplace-mappers.ts';
import type { Transport } from './transport.ts';

/**
 * Subscription plans — marketplace reads over HTTP.
 *
 * A duration is named by its day count ({@link mapDuration}): the storefront quote and the
 * purchase both resolve a run by `plan_duration_days`, which is the one identity the public plan
 * read publishes. Any whole number of days a kitchen configures reaches the chooser.
 */

/**
 * A fixed-days duration as the storefront can sell it; `null` for a one-off.
 *
 * A one-off is a single delivery with no day count, and the subscription quote refuses it
 * (`duration_not_fixed`): there is nothing a balance of delivery days can be built from. It is
 * dropped here rather than shown as a length nobody can buy.
 */
export function mapDuration(wire: WireDuration): PlanDurationOption | null {
    const days = wire.days;
    if (wire.kind !== 'fixed_days' || days === null || days < 1) return null;

    // `null` is a real answer, not a hole: a multi-configuration plan has no single plan-level
    // total (the variants price differently), and the server refuses to invent one. The screens
    // derive the figure for the variant in front of the person instead. Dropping the duration
    // here would empty the configurator's commitment step for every such plan.
    const totalPrice = mapMoney(wire.total_price);

    return {
        duration: planDuration(days),
        days,
        // The wire sends a decimal string so a fractional percent survives the database. The
        // contract wants whole percent, and `0` is the honest reading of "no discount offered".
        discountPercent: Math.round(Number.parseFloat(wire.discount_percent ?? '0')) || 0,
        totalPrice,
    };
}

export function mapPlanVariant(wire: WireVariant): PlanVariant | null {
    const energyRange = wire.energy_range;
    if (energyRange === null) return null;

    const pricePerWeek: Money | null = mapMoney(wire.price_per_week);
    if (pricePerWeek === null) return null;

    return {
        id: PlanVariantId.unsafe(wire.id),
        planId: SubscriptionPlanId.unsafe(wire.plan_id),
        name: wire.name,
        energyRange: { min: energyRange.min, max: energyRange.max },
        proteinRange: wire.protein_range,
        carbohydrateRange: wire.carbohydrate_range,
        fatRange: wire.fat_range,
        mealsPerDay: wire.meals_per_day,
        snacksPerDay: wire.snacks_per_day,
        pricePerWeek,
    };
}

/**
 * Wire plan → `SubscriptionPlan`, or `null` when nothing on it can be bought.
 *
 * A plan whose every variant was dropped is a plan with no purchasable configuration. It is
 * returned as `null` and the list skips it, which is the same rule the server applies to a meal it
 * cannot price — the alternative is a catalogue card that opens onto an empty chooser.
 */
export function mapSubscriptionPlan(wire: WirePlan): SubscriptionPlan | null {
    const variants = wire.variants
        .map(mapPlanVariant)
        .filter((variant): variant is PlanVariant => variant !== null);
    if (variants.length === 0) return null;

    const durations = wire.durations
        .map(mapDuration)
        .filter((duration): duration is PlanDurationOption => duration !== null);

    return {
        id: SubscriptionPlanId.unsafe(wire.id),
        kitchenId: KitchenId.unsafe(wire.kitchen_id),
        name: wire.name,
        slug: wire.slug,
        summary: wire.summary,
        description: wire.description,
        categorySlugs: wire.category_slugs,
        dietClassifications: wire.diet_classifications as readonly DietClassification[],
        variants,
        durations,
        sampleMealIds: wire.sample_meal_ids.map((id) => MealId.unsafe(id)),
        imagePlaceholderId: wire.image_placeholder_id,
        rating: wire.rating,
        ratingCount: wire.rating_count,
    };
}

/** The two plan reads, ready to be spread into the marketplace repository on switch day. */
export interface ApiPlanReads {
    listPlans(filter?: PlanFilter): Promise<CursorPage<SubscriptionPlan>>;
    getPlan(planId: SubscriptionPlanId | string): Promise<SubscriptionPlan>;
}

export function createApiPlanReads(transport: Transport): ApiPlanReads {
    function query(filter?: PlanFilter): string {
        const search = new URLSearchParams();
        const parameters: Record<string, string | number | undefined> = {
            query: filter?.query,
            kitchen_ids: listParameter(filter?.kitchenIds),
            category: filter?.categorySlug,
            diet_classifications: listParameter(filter?.dietClassifications),
            // The server filters on the energy band it resolved, so only the bounds cross the wire.
            energy_min: filter?.energy?.min,
            energy_max: filter?.energy?.max,
            duration: filter?.duration,
            meals_per_day: filter?.mealsPerDay,
            cursor: filter?.cursor,
            limit: filter?.limit,
        };

        for (const [key, value] of Object.entries(parameters)) {
            if (value === undefined) continue;
            search.set(key, String(value));
        }

        const rendered = search.toString();
        return rendered === '' ? '' : `?${rendered}`;
    }

    return {
        async listPlans(filter?: PlanFilter): Promise<CursorPage<SubscriptionPlan>> {
            const envelope = await transport.requestEnvelope<WirePlan[]>({
                method: 'GET',
                anonymous: true,
                path: `/marketplace/meal-plans${query(filter)}`,
            });

            return mapCursorPage(envelope.data, envelope.meta as WireListMeta, mapSubscriptionPlan);
        },

        async getPlan(planId: SubscriptionPlanId | string): Promise<SubscriptionPlan> {
            const wire = await transport.request<WirePlan>({
                method: 'GET',
                anonymous: true,
                path: `/marketplace/meal-plans/${encodeURIComponent(String(planId))}`,
            });

            const plan = mapSubscriptionPlan(wire);
            if (plan === null) {
                // The plan exists and nothing on it can be bought — every variant lacked an energy
                // band or a price this build can format. `resource.not_found` rather than `server`:
                // from the person's point of view there is no plan here to choose from, and a
                // retry cannot change that.
                throw new ApiError(
                    apiFailure('resource.not_found', {
                        message: 'This plan has no purchasable option at the moment.',
                    }),
                );
            }

            return plan;
        },
    };
}
