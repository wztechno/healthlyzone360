import { cx, useBreakpoint } from '@healthy360/design-system';
import type { Subscription, SubscriptionPlan } from '@healthy360/api-client/contracts';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, Text as RNText, View } from 'react-native';

import { usePlansQuery } from '../../../data/catalogue-hooks.ts';
import { useKitchensQuery, useSubscriptionsQuery } from '../../../data/marketplace-hooks.ts';
import { withQuery } from '../../../navigation/return-to.ts';
import { useGoToAuth, useRememberQuery } from '../../../navigation/use-return-to.ts';
import { useSession } from '../../../session/session-provider.tsx';
import { PillChip } from '../../../ui/pill-chip.tsx';
import { useMarketplaceFilters } from '../../marketplace/filter-bar.tsx';
import { configuratorHref } from '../../commerce/configurator-draft.ts';
import { QueryStates } from '../../marketplace/query-states.tsx';
import { ShopStateButton } from '../../../ui/shop-state.tsx';
import { distinctKitchenIds, toPlanFilter } from '../plan-catalogue.ts';
import { PlanCard } from '../plan-card.tsx';
import { PlanComparisonTray } from '../plan-comparison-tray.tsx';
import { bestMatch, defaultAnswers, finderOptions, matchPlans } from '../plan-finder.ts';
import type { FinderAnswers } from '../plan-finder.ts';
import { PlanFinder } from '../plan-finder-panel.tsx';
import { PlanGrid, PlanGridItem } from '../plan-grid.tsx';
import { isLiveSubscription } from '../plan-subscription.ts';
import type { ShelfTint } from '../shelf-tints.ts';

/**
 * `/plans` — the subscription-plan catalogue, as the accepted shop board draws it: the title with a
 * count pill and "How plans work"; "Find your plan" — three questions and the best match
 * (`plan-finder.ts`); the plan cards three across, the match ringed, a held plan marked "Current"
 * with "Manage" to its subscription page; and — once a plan is ticked — the dark comparison bar
 * pinned to the foot. Meals are picked in setup, and a subscription is run from its own page: this
 * page only lists and compares.
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
 */

const FILTER_KEYS = ['kitchen'] as const;
export const MAX_COMPARED_PLANS = 3;

/** The cards' heads, in turn — the board's three. */
const PLAN_TINTS: readonly ShelfTint[] = ['orange', 'green', 'blue', 'violet'];

/** Reads a route parameter that expo-router may hand back as a string or a one-element array. */
function readParam(raw: string | string[] | undefined): string {
    if (Array.isArray(raw)) return raw[0] ?? '';
    return raw ?? '';
}

export function PlansScreen() {
    const { t } = useTranslation();
    // Shop · Weekly plans, phone board: the count beside the title, finder rows, a row of plans.
    const phone = !useBreakpoint().atLeast('md');
    const router = useRouter();
    const params = useLocalSearchParams();
    const { me } = useSession();
    const goToAuth = useGoToAuth();
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

    const items = useMemo(() => plans.data?.items ?? [], [plans.data]);

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

    // The finder: options from the whole catalogue on screen, answers held by the page.
    const options = useMemo(() => finderOptions(items), [items]);
    const [answered, setAnswered] = useState<FinderAnswers | null>(null);
    const answers = useMemo(() => answered ?? defaultAnswers(options), [answered, options]);
    const matches = useMemo(() => matchPlans(items, answers), [items, answers]);
    const best = bestMatch(matches);

    /** "Start this plan": setup for the configuration in front of the person, via sign-in if need be. */
    const startPlan = (plan: SubscriptionPlan, variantId: string | undefined) => {
        const setUp = configuratorHref({ plan: String(plan.id), variant: variantId });
        if (me !== null) {
            router.push(setUp as never);
            return;
        }
        goToAuth('/sign-in', setUp);
    };

    const singleKitchen = kitchenOptions.length === 1 ? (kitchenOptions[0]?.label ?? null) : null;

    return (
        <View testID="plans-screen" className="flex-col pb-24">
            <View
                testID="plans-header"
                className={cx(
                    'flex-row flex-wrap pt-1',
                    phone ? 'items-end gap-2' : 'items-center gap-3.5',
                )}
            >
                <RNText
                    testID="plans-header-title"
                    role="heading"
                    aria-level={1}
                    className={cx(
                        'font-display font-bold tracking-display text-content-primary text-start',
                        phone ? 'text-2xl' : 'text-3xl',
                    )}
                >
                    {t('marketplace:nav.weeklyPlans')}
                </RNText>
                {plans.data === undefined ? null : (
                    <View
                        className={
                            phone
                                ? 'self-end pb-1'
                                : 'h-[30px] justify-center rounded-full bg-surface-brand-subtle px-3'
                        }
                    >
                        <RNText
                            testID="plans-count"
                            className={cx(
                                'text-sm tabular-nums',
                                phone
                                    ? 'text-content-secondary'
                                    : 'font-medium text-content-on-brand-subtle',
                            )}
                        >
                            {t('catalogue:plans.count', { count: items.length })}
                        </RNText>
                    </View>
                )}
                <View className="ms-auto flex-row items-center gap-3">
                    {singleKitchen === null ? null : (
                        <RNText className="text-sm text-content-secondary">
                            {t('catalogue:plans.fromKitchen', { kitchen: singleKitchen })}
                        </RNText>
                    )}
                    <Pressable
                        testID="plans-how-link"
                        role="link"
                        accessibilityRole="link"
                        onPress={() => {
                            router.push('/plans/how-it-works' as never);
                        }}
                        className="min-h-touch flex-row items-center gap-1 rounded-full px-2 hover:bg-surface-brand-subtle"
                    >
                        <RNText className="text-sm font-semibold text-content-on-brand-subtle">
                            {t('catalogue:plans.howItWorksLink')}
                        </RNText>
                    </Pressable>
                </View>
            </View>

            {kitchenOptions.length > 1 ? (
                <View
                    testID="plans-kitchens"
                    role="group"
                    aria-label={t('catalogue:plans.kitchenFilterLabel')}
                    className="mt-4 flex-row flex-wrap gap-2"
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

            {items.length === 0 ? null : (
                <PlanFinder
                    options={options}
                    answers={answers}
                    onChange={setAnswered}
                    matchName={best?.plan.name ?? null}
                />
            )}

            <View className="mt-3.5">
                <QueryStates
                    query={plans}
                    isEmpty={items.length === 0}
                    emptyTitle={t('catalogue:plans.emptyTitle')}
                    emptyBody={t('catalogue:plans.emptyBody')}
                    emptyActions={
                        filters.isFiltered ? (
                            <ShopStateButton
                                testID="plans-empty-clear"
                                kind="secondary"
                                label={t('catalogue:plans.allKitchens')}
                                onPress={filters.clear}
                            />
                        ) : undefined
                    }
                    // Weekly plans, pin 2.
                    emptyIcon="calendarDays"
                    testID="plans"
                >
                    <PlanGrid testID="plans-grid">
                        {items.map((plan, index) => {
                            const isSelected = compared.includes(String(plan.id));
                            const held = liveSubscriptions.find(
                                (subscription) =>
                                    String(subscription.configuration.planId) === String(plan.id),
                            );
                            const found = matches.find((entry) => entry.plan.id === plan.id);
                            return (
                                <PlanGridItem key={plan.id}>
                                    <PlanCard
                                        plan={plan}
                                        tint={PLAN_TINTS[index % PLAN_TINTS.length] ?? 'green'}
                                        variant={found?.variant}
                                        match={best !== null && best.plan.id === plan.id}
                                        kitchenName={
                                            singleKitchen === null
                                                ? kitchenNameById.get(String(plan.kitchenId))
                                                : undefined
                                        }
                                        current={
                                            held === undefined
                                                ? undefined
                                                : {
                                                      onManage: () => {
                                                          openSubscription(held);
                                                      },
                                                  }
                                        }
                                        onView={() => {
                                            router.push(`/plans/${String(plan.id)}` as never);
                                        }}
                                        onOpen={() => {
                                            startPlan(plan, found?.variant.id);
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

            {/* Sticky on the web against the shell's scroll port, so the bar stays in reach while
                the cards scroll under it. The wrapper sticks, not the bar: a sticky box sticks
                within its parent, and the parent here is the whole screen. */}
            {compared.length === 0 ? null : (
                <View className="z-10 mt-6 web:sticky web:bottom-[22px]">
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
