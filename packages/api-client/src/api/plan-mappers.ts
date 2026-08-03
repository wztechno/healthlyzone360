import { KitchenId, MealId, PlanVariantId, SubscriptionPlanId } from '@healthy360/domain-types';
import type { DietClassification, Money, PlanDuration } from '@healthy360/domain-types';

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
 * Subscription plans — **written, tested and deliberately not switched on**.
 *
 * `GET /marketplace/meal-plans` exists and this file speaks it. `createApiMarketplaceRepository`
 * still answers `listPlans` and `getPlan` with `prototype.not_implemented`, and their entries are
 * still in `PROTOTYPE_ENDPOINTS`. That is not an oversight and it is not laziness — it is the
 * phase's own rule, *do not degrade the plan page*:
 *
 * The plan catalogue a person browses today is the fixture world's, and it is complete: variants
 * with energy bands, four durations with discounts, sample menus. The endpoint answers honestly
 * with whatever kitchens have actually published, and until a real kitchen publishes a real plan
 * that answer is short or empty. Flipping the switch before then would replace a working catalogue
 * with an empty state, which is a worse product and a worse demonstration.
 *
 * So the mapper lands now, with the switch left for the commit that can prove the catalogue is
 * populated — at which point {@link createApiPlanReads} is spread into the marketplace repository
 * and two ledger entries are deleted. Landing it now rather than later is the point: the shape
 * questions below were answered while the wire types were in front of me, and answering them under
 * time pressure on switch day is how a mapper acquires a silent wrong default.
 *
 * ## Three places the wire holds less than the contract
 *
 * 1. **`PlanVariant.energyRange` is required and the wire's is nullable.** A variant with no band
 *    is a variant a person cannot choose between — "1,600–1,800 kcal" *is* the choice — so a
 *    variant without one is **dropped**, exactly as a meal with an unformattable price is dropped.
 *    A zero-to-zero band would render as a plan offering no food.
 * 2. **`protein_range`, `carbohydrate_range` and `fat_range` are typed `null` on the wire.** Not
 *    "nullable": literally the null type, because the platform stores none. They map straight
 *    through as `null`, which the contract already allows.
 * 3. **Durations are codes, and the contract's are a closed vocabulary.** The wire sends
 *    `{ code, kind, days }`; `PlanDuration` is `1w | 2w | 4w | 12w`. {@link mapDuration} resolves by
 *    days rather than by code string, because the code is a kitchen-authored slug and the number of
 *    days is the fact. A duration that resolves to nothing this build knows is dropped rather than
 *    rounded to the nearest one — a person offered "4 weeks" who is charged for twelve is the worst
 *    outcome available here.
 */

/** Wire day counts → the closed duration vocabulary. Resolved by days, never by the code string. */
const DURATION_BY_DAYS: Readonly<Record<number, PlanDuration>> = {
    7: '1w',
    14: '2w',
    28: '4w',
    84: '12w',
};

export function mapDuration(wire: WireDuration): PlanDurationOption | null {
    const days = wire.days;
    const duration = days === null ? undefined : DURATION_BY_DAYS[days];
    if (duration === undefined) return null;

    const totalPrice = mapMoney(wire.total_price);
    // A duration with no price is a button with no number on it.
    if (totalPrice === null) return null;

    return {
        duration,
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
