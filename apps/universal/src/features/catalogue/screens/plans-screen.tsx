import {
    Breadcrumbs,
    Button,
    Callout,
    Heading,
    Stack,
    Tabs,
    Text,
} from '@healthy360/design-system';
import type { PlanFilter } from '@healthy360/api-client/contracts';
import { useRouter } from 'expo-router';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { useDietCategoriesQuery, usePlansQuery } from '../../../data/catalogue-hooks.ts';
import { useMarketplaceFilters } from '../../marketplace/filter-bar.tsx';
import { QueryStates } from '../../marketplace/query-states.tsx';
import { CardGrid, CardGridItem } from '../../marketplace/section-header.tsx';
import { PlanCard } from '../plan-card.tsx';

/**
 * `/plans` — the subscription-plan catalogue.
 *
 * ## The comparison selection lives in the URL too
 *
 * "The three plans I am weighing up" is a thought a person will want to send to somebody else, and
 * a selection held in `useState` cannot be sent anywhere. It is a `compare` parameter, which also
 * means the comparison screen can be reached directly and the browser's back button returns to the
 * catalogue with the ticks still in place.
 *
 * ## Why three
 *
 * Neither reference product offers comparison at all (doc 17, IA-10 / MKT-07), so the limit is ours
 * to choose. Three is what fits as equal-width columns at 1024 px without either shrinking the
 * figures below legibility or introducing the horizontal page scroll the responsive research rules
 * out (doc 08, RSP-01). A fourth column would have to come at the cost of one of those.
 */

const GROUP_KEYS = ['category', 'compare'] as const;
export const MAX_COMPARED_PLANS = 3;

export function PlansScreen() {
    const { t } = useTranslation();
    const router = useRouter();
    const filters = useMarketplaceFilters(GROUP_KEYS);

    const categories = useDietCategoriesQuery();
    const { selected } = filters;

    const category = selected['category']?.[0] ?? 'all';
    const compared = useMemo(
        () => (selected['compare'] ?? []).filter((value) => value !== ''),
        [selected],
    );

    const filter = useMemo<PlanFilter>(
        () => (category === 'all' ? {} : { categorySlug: category }),
        [category],
    );

    const plans = usePlansQuery(filter);
    const items = plans.data?.items ?? [];

    // Only categories that actually hold a plan become tabs: an empty tab is a control whose only
    // possible outcome is the empty state.
    const categoryTabs = (categories.data ?? []).filter((entry) => entry.planCount > 0);

    return (
        <Stack space="lg" testID="plans-screen">
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

            <Stack space="xs">
                <Heading level={1} testID="plans-title">
                    {t('catalogue:plans.title')}
                </Heading>
                <Text tone="secondary">{t('catalogue:plans.subtitle')}</Text>
            </Stack>

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

            <Stack space="xs" testID="plans-compare-bar">
                <Text tone="secondary" variant="caption">
                    {t('catalogue:plans.compareHint')}
                </Text>
                <Text testID="plans-compare-count" role="status" aria-live="polite">
                    {t('catalogue:plans.compareSelected', { selected: compared.length })}
                </Text>
                {compared.length >= MAX_COMPARED_PLANS ? (
                    <Text testID="plans-compare-full" tone="secondary" variant="caption">
                        {t('catalogue:plans.compareFull')}
                    </Text>
                ) : null}
                <Button
                    testID="plans-compare-open"
                    variant="secondary"
                    label={t('catalogue:plans.compareOpen')}
                    disabled={compared.length < 2}
                    onPress={() => {
                        router.push(`/plans/compare?plans=${compared.join(',')}` as never);
                    }}
                />
            </Stack>

            <QueryStates
                query={plans}
                isEmpty={items.length === 0}
                emptyTitle={t('catalogue:plans.emptyTitle')}
                emptyBody={t('catalogue:plans.emptyBody')}
                emptyActions={
                    category === 'all' ? undefined : (
                        <Button
                            testID="plans-empty-clear"
                            variant="secondary"
                            label={t('catalogue:filters.clear')}
                            onPress={filters.clear}
                        />
                    )
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
                                    onOpen={() => {
                                        router.push(`/plans/${String(plan.id)}` as never);
                                    }}
                                    comparison={{
                                        selected: isSelected,
                                        disabled:
                                            !isSelected && compared.length >= MAX_COMPARED_PLANS,
                                        onChange: (next) => {
                                            filters.toggle('compare', String(plan.id), next);
                                        },
                                    }}
                                />
                            </CardGridItem>
                        );
                    })}
                </CardGrid>
            </QueryStates>

            <Callout
                testID="plans-macro-caveat"
                role="note"
                tone="info"
                icon="info"
                title={t('catalogue:plan.macrosTitle')}
                body={t('catalogue:compare.macroCaveat')}
            />
        </Stack>
    );
}
