import { Breadcrumbs, Button, Inline, Select, Stack, Tabs, Text } from '@healthy360/design-system';
import type { SelectOption } from '@healthy360/design-system';
import type { SubscriptionPlan } from '@healthy360/api-client/contracts';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { useDietCategoriesQuery, usePlansQuery } from '../../../data/catalogue-hooks.ts';
import { useKitchensQuery } from '../../../data/marketplace-hooks.ts';
import { isFeatureAvailable } from '../../availability.ts';
import { FilterBar, useMarketplaceFilters } from '../../marketplace/filter-bar.tsx';
import type { FilterGroup } from '../../marketplace/filter-bar.tsx';
import { QueryStates } from '../../marketplace/query-states.tsx';
import { CardGrid, CardGridItem } from '../../marketplace/section-header.tsx';
import {
    CALORIE_PRESETS,
    PLAN_SORTS,
    distinctKitchenIds,
    isPlanSort,
    sortPlans,
    toPlanFilter,
} from '../plan-catalogue.ts';
import type { PlanSort } from '../plan-catalogue.ts';
import { NutritionMethodologyNotice } from '../nutrition-methodology-notice.tsx';
import { PlanCard } from '../plan-card.tsx';
import { PlanComparisonTray } from '../plan-comparison-tray.tsx';
import { PlanRecommendationCta } from '../plan-recommendation-cta.tsx';
import { PlansHero } from '../plans-hero.tsx';

/**
 * `/plans` — the subscription-plan catalogue.
 *
 * ## Two kinds of state in the URL, kept apart on purpose
 *
 * The *filters* — search, category, kitchen, calorie band — go through `useMarketplaceFilters`, so
 * "Clear" resets exactly them. The *comparison selection* and the *sort* are their own parameters,
 * read and written directly, because neither is a filter: clearing the filters must not empty the
 * tray a person has been filling, and re-sorting must not be undone by it. All of it still lives in
 * the address bar, so the whole state — what you searched, what you are comparing, how it is ordered
 * — is one shareable, reloadable, back-button-safe place.
 *
 * ## Why the comparison is three
 *
 * Neither reference product offers comparison at all (doc 17, IA-10 / MKT-07), so the limit is ours.
 * Three is what fits as equal-width columns at 1024 px without shrinking the figures below legibility
 * or introducing the horizontal scroll the responsive rules forbid (doc 08, RSP-01). A fourth column
 * would come at the cost of one of those.
 *
 * ## Honest filters only
 *
 * Search, category, kitchen and calorie band each map to a real `PlanFilter` field, and their
 * options are built from the plans that exist — the kitchen facet lists only the four kitchens that
 * actually publish a plan, not all six on the marketplace, so no chip can select an empty result on
 * purpose. There is deliberately no duration filter: every plan offers every duration, so it would
 * narrow nothing. Sort is done on the client because the contract has none, and the plan listing is
 * small and unpaged, so ordering the whole answer is correct rather than a per-page illusion.
 */

const FILTER_KEYS = ['category', 'kitchen', 'calorie'] as const;
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
    const filters = useMarketplaceFilters(FILTER_KEYS);
    const { selected, query } = filters;

    const category = selected['category']?.[0] ?? 'all';
    const kitchenIds = useMemo(() => selected['kitchen'] ?? [], [selected]);
    const calorie = selected['calorie']?.[0];

    const sortParam = readParam(params['sort'] as string | string[] | undefined);
    const sort: PlanSort = isPlanSort(sortParam) ? sortParam : 'recommended';

    // The comparison selection is its own parameter, so clearing the filters never empties it.
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
        () => toPlanFilter({ query, category, kitchenIds, calorie }),
        [query, category, kitchenIds, calorie],
    );

    const plans = usePlansQuery(filter);
    // The unfiltered set backs two things the filtered list cannot: the kitchen facet (its options
    // must survive a filter that hides some kitchens) and the tray (you compare across the whole
    // catalogue, including plans the current filters have hidden).
    const allPlans = usePlansQuery({});
    // The diet-category tabs are the diet-category feature wearing a different shape: without those
    // endpoints there are no categories to tab through, so the request is not made at all.
    const categories = useDietCategoriesQuery(isFeatureAvailable('dietCategories'));
    const kitchens = useKitchensQuery({ channels: ['marketplace'], limit: 20 });

    const items = useMemo(() => sortPlans(plans.data?.items ?? [], sort), [plans.data, sort]);

    const kitchenNameById = useMemo(() => {
        const map = new Map<string, string>();
        for (const kitchen of kitchens.data?.items ?? []) map.set(String(kitchen.id), kitchen.name);
        return map;
    }, [kitchens.data]);

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

    // Only categories that actually hold a plan become tabs: an empty tab is a control whose only
    // possible outcome is the empty state.
    const categoryTabs = (categories.data ?? []).filter((entry) => entry.planCount > 0);

    const groups = useMemo<FilterGroup[]>(() => {
        const result: FilterGroup[] = [];
        if (kitchenOptions.length > 1) {
            result.push({
                key: 'kitchen',
                label: t('catalogue:plans.kitchenFilter'),
                options: kitchenOptions,
                mode: 'multiple',
            });
        }
        result.push({
            key: 'calorie',
            label: t('catalogue:plans.calorieFilter'),
            mode: 'single',
            options: CALORIE_PRESETS.map((preset) => ({
                value: preset.value,
                label: t(`catalogue:plans.calorie.${preset.value}`),
            })),
        });
        return result;
    }, [kitchenOptions, t]);

    const sortOptions: readonly SelectOption<PlanSort>[] = PLAN_SORTS.map((value) => ({
        value,
        label: t(`catalogue:plans.sort.${value}`),
    }));

    const resultSummary = t('catalogue:plans.resultSummary', {
        count: items.length,
        kitchens: t('catalogue:plans.kitchenCount', {
            count: distinctKitchenIds(items).length,
        }),
    });

    return (
        <Stack space="xl" testID="plans-screen">
            <Breadcrumbs
                testID="plans-breadcrumbs"
                items={[
                    {
                        key: 'home',
                        label: t('catalogue:nav.home'),
                        onPress: () => {
                            router.push('/');
                        },
                    },
                    { key: 'plans', label: t('catalogue:nav.plans') },
                ]}
            />

            <PlansHero
                onHowItWorks={() => {
                    router.push('/how-it-works');
                }}
                {...(isFeatureAvailable('dietitianDirectory')
                    ? {
                          onSpeakToDietitian: () => {
                              router.push('/dietitians');
                          },
                      }
                    : {})}
            />

            <Stack space="md" testID="plans-toolbar">
                {/*
                 * "All" plus nothing is not a choice. The strip renders only when a real category
                 * exists to switch to; without the diet-category endpoints there are none, and a
                 * one-tab tab bar is a control whose only state is the one it is already in.
                 */}
                {categoryTabs.length === 0 ? null : (
                    <Tabs
                        testID="plans-categories"
                        label={t('catalogue:plans.categoryLabel')}
                        value={category}
                        onChange={(next) => {
                            filters.select('category', next === 'all' ? null : next);
                        }}
                        items={[
                            {
                                value: 'all',
                                label: t('catalogue:plans.categoryAll'),
                                testID: 'plans-category-all',
                            },
                            ...categoryTabs.map((entry) => ({
                                value: entry.slug,
                                label: entry.name,
                                testID: `plans-category-${entry.slug}`,
                            })),
                        ]}
                    />
                )}

                <FilterBar
                    testID="plans-filter"
                    state={filters}
                    searchLabel={t('catalogue:plans.searchLabel')}
                    searchPlaceholder={t('catalogue:plans.searchPlaceholder')}
                    groups={groups}
                />

                <Inline space="sm" align="center" justify="between" wrap testID="plans-result-bar">
                    <Text
                        testID="plans-result-summary"
                        role="status"
                        aria-live="polite"
                        tone="secondary"
                        variant="caption"
                    >
                        {resultSummary}
                    </Text>
                    <Select<PlanSort>
                        testID="plans-sort"
                        label={t('catalogue:plans.sortLabel')}
                        options={sortOptions}
                        value={sort}
                        onChange={(next) => {
                            router.setParams({ sort: next });
                        }}
                        className="min-w-[220px]"
                    />
                </Inline>
            </Stack>

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
                            label={t('catalogue:filters.clear')}
                            onPress={filters.clear}
                        />
                    ) : undefined
                }
                testID="plans"
            >
                <CardGrid testID="plans-grid">
                    {items.map((plan) => {
                        const isSelected = compared.includes(String(plan.id));
                        return (
                            <CardGridItem key={plan.id}>
                                <PlanCard
                                    plan={plan}
                                    kitchenName={kitchenNameById.get(String(plan.kitchenId))}
                                    onOpen={() => {
                                        router.push(`/plans/${String(plan.id)}` as never);
                                    }}
                                    comparison={{
                                        selected: isSelected,
                                        disabled:
                                            !isSelected && compared.length >= MAX_COMPARED_PLANS,
                                        onChange: (next) => {
                                            toggleCompare(String(plan.id), next);
                                        },
                                    }}
                                />
                            </CardGridItem>
                        );
                    })}
                </CardGrid>
            </QueryStates>

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

            <NutritionMethodologyNotice />

            <PlanRecommendationCta
                {...(isFeatureAvailable('dietitianDirectory')
                    ? {
                          onSpeakToDietitian: () => {
                              router.push('/dietitians');
                          },
                      }
                    : {})}
                onHowItWorks={() => {
                    router.push('/how-it-works');
                }}
            />
        </Stack>
    );
}
