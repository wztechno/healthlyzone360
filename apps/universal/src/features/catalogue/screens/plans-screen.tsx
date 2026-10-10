import { Button } from '@healthy360/design-system';
import type { Subscription, SubscriptionPlan } from '@healthy360/api-client/contracts';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { usePlansQuery } from '../../../data/catalogue-hooks.ts';
import { useKitchensQuery, useSubscriptionsQuery } from '../../../data/marketplace-hooks.ts';
import { useSession } from '../../../session/session-provider.tsx';
import { PillChip } from '../../../ui/pill-chip.tsx';
import { useMarketplaceFilters } from '../../marketplace/filter-bar.tsx';
import { QueryStates } from '../../marketplace/query-states.tsx';
import { distinctKitchenIds, toPlanFilter } from '../plan-catalogue.ts';
import { PlanCard } from '../plan-card.tsx';
import { PlanComparisonTray } from '../plan-comparison-tray.tsx';
import { PlanGrid, PlanGridItem, PlansIntro } from '../plans-intro.tsx';
import { PlanSubscriberPanel } from '../plan-subscriber-panel.tsx';

/**
 * `/plans` — the subscription-plan catalogue, laid out as HealthZone's `plans` screen: the intro
 * (eyebrow, two-line title, lede, "How plans work →"), the plan cards three across, and for a
 * subscriber the "Your week" card beside the "Active subscription" card.
 *
 * ## The design's structure over a many-kitchen catalogue
 *
 * The design draws one kitchen's three plans. The catalogue here is every kitchen's, so the card row
 * simply continues into further rows of three, and two things the drawing has no slot for were
 * folded into the vocabulary it already uses rather than kept as a toolbar of their own:
 *
 * - **Choosing a kitchen** is one row of the design's `chip()` pills between the intro and the
 *   cards — "All kitchens" and one per kitchen that publishes a plan — shown only when there are at
 *   least two to choose between. It is URL-backed (`?kitchen=`), which is how the kitchen finder and
 *   the kitchen spotlight link into this page. The old filter panel's search, calorie band, sort
 *   and "Showing N of M" line are gone: none is in the design, and over a catalogue of a handful of
 *   plans each narrowed nothing a glance at the cards does not.
 * - **Comparing** is a "Compare" chip in each card's header — the slot the design gives its
 *   "Current" mark — and the tray that opens the comparison appears under the cards only once a
 *   plan is selected. The selection is its own URL parameter, so a shared link still opens it.
 *
 * The "How to read the nutrition figures" notice is gone from this page: a plan card states calorie
 * bands, not nutrition figures, and the plan page that does show them keeps it.
 *
 * ## The subscriber band is real data
 *
 * It renders only for a signed-in person who holds a live subscription — for anybody else it would
 * be sample data — and its actions are the subscription's own transitions
 * (`plan-subscriber-panel.tsx`).
 */

const FILTER_KEYS = ['kitchen'] as const;
export const MAX_COMPARED_PLANS = 3;

/** States in which a subscription still delivers, or will again — the plan a person is "on". */
const LIVE_STATES: ReadonlySet<Subscription['state']> = new Set([
    'active',
    'paused',
    'skipped_today',
]);

/** Reads a route parameter that expo-router may hand back as a string or a one-element array. */
function readParam(raw: string | string[] | undefined): string {
    if (Array.isArray(raw)) return raw[0] ?? '';
    return raw ?? '';
}

export function PlansScreen() {
    const { t } = useTranslation();
    const router = useRouter();
    const params = useLocalSearchParams();
    const { me } = useSession();
    const filters = useMarketplaceFilters(FILTER_KEYS);
    const kitchenIds = useMemo(() => filters.selected['kitchen'] ?? [], [filters.selected]);

    // The comparison selection is its own parameter, so choosing a kitchen never empties it.
    const compared = useMemo(() => {
        const raw = readParam(params['compare'] as string | string[] | undefined);
        return raw === '' ? [] : raw.split(',').filter((value) => value !== '');
    }, [params]);

    const setCompared = useCallback(
        (next: readonly string[]) => {
            router.setParams({ compare: next.join(',') });
        },
        [router],
    );
    const toggleCompare = useCallback(
        (id: string, on: boolean) => {
            setCompared(on ? [...compared, id] : compared.filter((value) => value !== id));
        },
        [compared, setCompared],
    );

    const filter = useMemo(
        () => toPlanFilter({ query: '', category: 'all', kitchenIds, calorie: undefined }),
        [kitchenIds],
    );

    const plans = usePlansQuery(filter);
    // The unfiltered set backs two things the filtered list cannot: the kitchen chips (they must
    // survive a choice that hides some kitchens) and the tray (you compare across the whole
    // catalogue, including plans the kitchen choice has hidden).
    const allPlans = usePlansQuery({});
    const kitchens = useKitchensQuery({ channels: ['marketplace'], limit: 20 });

    const items = plans.data?.items ?? [];

    // Only asked for a signed-in person: the list is theirs, and an anonymous request is a 401.
    const subscriptions = useSubscriptionsQuery(me !== null);
    const liveSubscription = useMemo<Subscription | undefined>(
        () =>
            (subscriptions.data?.items ?? []).find((subscription) =>
                LIVE_STATES.has(subscription.state),
            ),
        [subscriptions.data],
    );
    const openSubscription = useCallback(
        (subscription: Subscription) => {
            router.push(`/customer/subscriptions/${String(subscription.id)}` as never);
        },
        [router],
    );

    const kitchenNameById = useMemo(() => {
        const map = new Map<string, string>();
        for (const kitchen of kitchens.data?.items ?? []) map.set(String(kitchen.id), kitchen.name);
        return map;
    }, [kitchens.data]);

    // Only kitchens that actually publish a plan become chips: a chip whose only outcome is the
    // empty state is a control that exists to disappoint.
    const kitchenOptions = useMemo(
        () =>
            distinctKitchenIds(allPlans.data?.items ?? [])
                .map((id) => ({ value: String(id), label: kitchenNameById.get(String(id)) ?? '' }))
                .filter((option) => option.label !== ''),
        [allPlans.data, kitchenNameById],
    );

    const fullById = useMemo(() => {
        const map = new Map<string, SubscriptionPlan>();
        for (const plan of allPlans.data?.items ?? []) map.set(String(plan.id), plan);
        return map;
    }, [allPlans.data]);

    const comparedPlans = useMemo(
        () =>
            compared
                .map((id) => fullById.get(id))
                .filter((plan): plan is SubscriptionPlan => plan !== undefined),
        [compared, fullById],
    );

    return (
        <View testID="plans-screen" className="flex-col">
            <PlansIntro
                onHowItWorks={() => {
                    router.push('/plans/how-it-works' as never);
                }}
            />

            {kitchenOptions.length > 1 ? (
                <View
                    testID="plans-kitchens"
                    role="group"
                    aria-label={t('catalogue:plans.kitchenFilterLabel')}
                    className="mt-6 flex-row flex-wrap gap-1.5"
                >
                    <PillChip
                        size="sm"
                        floor="coarse"
                        testID="plans-kitchen-all"
                        label={t('catalogue:plans.allKitchens')}
                        selected={kitchenIds.length === 0}
                        onPress={() => {
                            filters.select('kitchen', null);
                        }}
                    />
                    {kitchenOptions.map((option) => {
                        const on = kitchenIds.includes(option.value);
                        return (
                            <PillChip
                                key={option.value}
                                size="sm"
                                floor="coarse"
                                testID={`plans-kitchen-${option.value}`}
                                label={option.label}
                                selected={on}
                                onPress={() => {
                                    filters.toggle('kitchen', option.value, !on);
                                }}
                            />
                        );
                    })}
                </View>
            ) : null}

            <View className="mt-6">
                <QueryStates
                    query={plans}
                    isEmpty={items.length === 0}
                    emptyTitle={t('catalogue:plans.emptyTitle')}
                    emptyBody={t('catalogue:plans.emptyBody')}
                    emptyActions={
                        filters.isFiltered ? (
                            <Button
                                testID="plans-empty-clear"
                                variant="secondary"
                                label={t('catalogue:plans.allKitchens')}
                                onPress={filters.clear}
                            />
                        ) : undefined
                    }
                    testID="plans"
                >
                    <PlanGrid testID="plans-grid">
                        {items.map((plan) => {
                            const isSelected = compared.includes(String(plan.id));
                            const isCurrent =
                                liveSubscription !== undefined &&
                                String(liveSubscription.configuration.planId) === String(plan.id);
                            return (
                                <PlanGridItem key={plan.id}>
                                    <PlanCard
                                        plan={plan}
                                        kitchenName={kitchenNameById.get(String(plan.kitchenId))}
                                        current={
                                            isCurrent
                                                ? {
                                                      onManage: () => {
                                                          openSubscription(liveSubscription);
                                                      },
                                                  }
                                                : undefined
                                        }
                                        onOpen={() => {
                                            router.push(`/plans/${String(plan.id)}` as never);
                                        }}
                                        comparison={{
                                            selected: isSelected,
                                            disabled:
                                                !isSelected &&
                                                compared.length >= MAX_COMPARED_PLANS,
                                            onChange: (next) => {
                                                toggleCompare(String(plan.id), next);
                                            },
                                        }}
                                    />
                                </PlanGridItem>
                            );
                        })}
                    </PlanGrid>
                </QueryStates>
            </View>

            {compared.length === 0 ? null : (
                <View className="mt-4">
                    <PlanComparisonTray
                        plans={comparedPlans}
                        selectedCount={compared.length}
                        max={MAX_COMPARED_PLANS}
                        onRemove={(id) => {
                            toggleCompare(id, false);
                        }}
                        onClear={() => {
                            setCompared([]);
                        }}
                        onCompare={() => {
                            router.push(`/plans/compare?plans=${compared.join(',')}` as never);
                        }}
                    />
                </View>
            )}

            {liveSubscription === undefined ? null : (
                <View className="mt-6">
                    <PlanSubscriberPanel subscription={liveSubscription} />
                </View>
            )}
        </View>
    );
}
