import { Button } from '@healthy360/design-system';
import type { Subscription, SubscriptionPlan } from '@healthy360/api-client/contracts';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { usePlansQuery } from '../../../data/catalogue-hooks.ts';
import { useKitchensQuery, useSubscriptionsQuery } from '../../../data/marketplace-hooks.ts';
import { withQuery } from '../../../navigation/return-to.ts';
import { useRememberQuery } from '../../../navigation/use-return-to.ts';
import { useSession } from '../../../session/session-provider.tsx';
import { ListingHeader } from '../../../ui/listing-header.tsx';
import { PillChip } from '../../../ui/pill-chip.tsx';
import { useMarketplaceFilters } from '../../marketplace/filter-bar.tsx';
import { QueryStates } from '../../marketplace/query-states.tsx';
import { distinctKitchenIds, toPlanFilter } from '../plan-catalogue.ts';
import { PlanCard } from '../plan-card.tsx';
import { PlanComparisonTray } from '../plan-comparison-tray.tsx';
import { TextLink } from '../plan-controls.tsx';
import { PlanGrid, PlanGridItem } from '../plan-grid.tsx';
import { PlanSubscriberPanel, isLiveSubscription } from '../plan-subscriber-panel.tsx';

/**
 * `/plans` — the subscription-plan catalogue: the listing title with its count and "How plans work
 * →" on its baseline, the plan cards three across, for a subscriber the "Your week" card beside the
 * "Active subscription" card, and — once a plan is ticked — the comparison bar pinned to the foot.
 *
 * ## The design's structure over a many-kitchen catalogue
 *
 * The design draws one kitchen's three plans. The catalogue here is every kitchen's, so the card row
 * simply continues into further rows of three, and two things the drawing has no slot for were
 * folded into the vocabulary it already uses rather than kept as a toolbar of their own:
 *
 * - **Choosing a kitchen** is one row of the design's `chip()` pills between the intro and the
 *   cards — "All kitchens" and one per kitchen that publishes a plan — shown only when there are at
 *   least two to choose between. It is URL-backed (`?kitchen=`), which is how a storefront links
 *   into this page. The old filter panel's search, calorie band, sort
 *   and "Showing N of M" line are gone: none is in the design, and over a catalogue of a handful of
 *   plans each narrowed nothing a glance at the cards does not.
 * - **Comparing** is a "Compare" chip in each card's header — the slot the design gives its
 *   "Current" mark — and the bar that opens the comparison appears only once a plan is selected.
 *   The selection is its own URL parameter, so a shared link still opens it. The comparison is
 *   opened with the kitchen choice as well, and its "Back to the plans" returns both, so the tray
 *   and the chip are still there when the person comes back (browse-05). The page records the
 *   query it was last shown with for the same reason: a crumb up from a plan finds it as it was.
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
    useRememberQuery();

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
    // Every live one, not the newest: a person holding two plans sees both marked and both
    // summarised, rather than the older one vanishing from a page that lists it (plans-21).
    const subscriptions = useSubscriptionsQuery(me !== null);
    const liveSubscriptions = useMemo<readonly Subscription[]>(
        () => (subscriptions.data?.items ?? []).filter(isLiveSubscription),
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
            <ListingHeader
                testID="plans-header"
                title={t('catalogue:nav.plans')}
                metaTestID="plans-count"
                {...(plans.data === undefined
                    ? {}
                    : { meta: t('catalogue:plans.count', { count: items.length }) })}
                trailing={
                    <TextLink
                        testID="plans-how-link"
                        align="end"
                        label={t('catalogue:plans.howItWorksLink')}
                        onPress={() => {
                            router.push('/plans/how-it-works' as never);
                        }}
                    />
                }
            />

            {kitchenOptions.length > 1 ? (
                <View
                    testID="plans-kitchens"
                    role="group"
                    aria-label={t('catalogue:plans.kitchenFilterLabel')}
                    className="mt-6 flex-row flex-wrap gap-2"
                >
                    <PillChip
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
                            const held = liveSubscriptions.find(
                                (subscription) =>
                                    String(subscription.configuration.planId) === String(plan.id),
                            );
                            return (
                                <PlanGridItem key={plan.id}>
                                    <PlanCard
                                        plan={plan}
                                        kitchenName={kitchenNameById.get(String(plan.kitchenId))}
                                        current={
                                            held === undefined
                                                ? undefined
                                                : {
                                                      onManage: () => {
                                                          openSubscription(held);
                                                      },
                                                  }
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

            {liveSubscriptions.map((subscription) => (
                <View key={subscription.id} className="mt-6">
                    <PlanSubscriberPanel subscription={subscription} />
                </View>
            ))}

            {/* Sticky on the web against the shell's scroll port, so the bar stays in reach while
                the cards scroll under it. The wrapper sticks, not the bar: a sticky box sticks
                within its parent, and the parent here is the whole screen. */}
            {compared.length === 0 ? null : (
                <View className="z-10 mt-6 web:sticky web:bottom-4">
                    <PlanComparisonTray
                        plans={comparedPlans}
                        selectedCount={compared.length}
                        onRemove={(id) => {
                            toggleCompare(id, false);
                        }}
                        onClear={() => {
                            setCompared([]);
                        }}
                        onCompare={() => {
                            router.push(
                                withQuery('/plans/compare', {
                                    plans: compared.join(','),
                                    kitchen: kitchenIds.join(','),
                                }) as never,
                            );
                        }}
                    />
                </View>
            )}
        </View>
    );
}
