import { Breadcrumbs, Button, Heading, Select, Stack, Text } from '@healthy360/design-system';
import { MEAL_SORTS } from '@healthy360/api-client/contracts';
import type { MealSort } from '@healthy360/api-client/contracts';
import type {
    AllergenCode,
    CurrencyCode,
    DietClassification,
    KitchenId,
    MealType,
} from '@healthy360/domain-types';
import { useRouter } from 'expo-router';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { mealsFromPages, totalFromPages, useMealsQuery } from '../../../data/catalogue-hooks.ts';
import { useKitchensQuery } from '../../../data/marketplace-hooks.ts';
import { MedicalDisclaimer } from '../../../safety/medical-disclaimer.tsx';
import { FilterBar, useMarketplaceFilters } from '../../marketplace/filter-bar.tsx';
import { MealCard } from '../../marketplace/meal-card.tsx';
import { QueryStates } from '../../marketplace/query-states.tsx';
import { CardGrid, CardGridItem } from '../../marketplace/section-header.tsx';
import { MealRangeFilters, toMealFilter, useMealRanges } from '../meal-filters.tsx';

/**
 * `/meals` — the whole marketplace catalogue, filterable.
 *
 * Neither reference product filters its catalogue at all (doc 04, RBC-11; doc 17, IA-11). Fourteen
 * plans survive without a filter; forty meals across six kitchens and six numeric axes do not, so
 * this is a deliberate divergence and the single largest screen in the wave.
 *
 * ## Every control writes to the URL
 *
 * Text, chips and ranges all land in the address bar, which is what makes a filtered catalogue a
 * *place*: linkable, reloadable and reachable with the back button. It also means the TanStack key
 * and the address bar cannot disagree, because both are derived from the same parameters.
 *
 * ## Pagination is a button, not a scroll listener
 *
 * "Load more" rather than infinite scroll: an auto-loading list makes the page footer unreachable,
 * fights the browser's scroll restoration on the way back from a meal, and gives a keyboard user no
 * way to stop. The button says how many have arrived and when there are no more.
 */

/**
 * The fourteen allergen groups food-labelling regimes in the EU, the UK and the GCC require to be
 * declared.
 *
 * Declared here rather than imported: the only other list in the repository lives in the mock
 * fixture package, and a production screen importing a fixture is exactly what the prompt's
 * validation step forbids. This is published regulatory vocabulary, not data.
 */
const ALLERGEN_CODES: readonly string[] = [
    'gluten',
    'crustaceans',
    'egg',
    'fish',
    'peanut',
    'soy',
    'milk',
    'tree_nut',
    'celery',
    'mustard',
    'sesame',
    'sulphites',
    'lupin',
    'mollusc',
];

const MEAL_TYPES: readonly MealType[] = ['breakfast', 'lunch', 'dinner', 'snack'];

/** The diet classifications worth offering as a catalogue filter — the ones meals are tagged with. */
const DIET_FILTERS: readonly DietClassification[] = [
    'omnivore',
    'vegetarian',
    'vegan',
    'pescatarian',
    'high_protein',
    'low_carb',
    'mediterranean',
    'gluten_free',
    'dairy_free',
    'nut_free',
];

const GROUP_KEYS = ['kitchen', 'mealType', 'diet', 'exclude', 'sort'] as const;

/** Meals fetched per page. Twenty fills two screens on a desktop grid and one on a phone. */
const PAGE_SIZE = 20;

/**
 * The currency the price filter is typed in.
 *
 * Every kitchen in the prototype world prices in AED, and `MealFilter.price` is in minor units of
 * "the caller's currency" without saying who decides that. A multi-currency marketplace needs the
 * display currency to come from the session or the delivery market; that is recorded as an open
 * question rather than guessed at here, and this constant is the single place it would change.
 */
const PRICE_CURRENCY: CurrencyCode = 'AED';

export function MealsScreen() {
    const { t } = useTranslation();
    const router = useRouter();
    const filters = useMarketplaceFilters(GROUP_KEYS);
    const ranges = useMealRanges();

    const kitchens = useKitchensQuery({ channels: ['marketplace'], limit: 20 });
    const kitchenItems = kitchens.data?.items ?? [];

    const { query: searchTerm, selected } = filters;
    const { values: rangeValues } = ranges;

    const sort = (selected['sort']?.[0] ?? 'relevance') as MealSort;

    const filter = useMemo(
        () =>
            toMealFilter({
                query: searchTerm,
                kitchenIds: (selected['kitchen'] ?? []) as readonly KitchenId[],
                mealTypes: (selected['mealType'] ?? []) as readonly MealType[],
                dietClassifications: (selected['diet'] ?? []) as readonly DietClassification[],
                excludeAllergens: (selected['exclude'] ?? []) as readonly AllergenCode[],
                ranges: rangeValues,
                sort: sort === 'relevance' ? undefined : sort,
                currency: PRICE_CURRENCY,
                limit: PAGE_SIZE,
            }),
        [searchTerm, selected, rangeValues, sort],
    );

    const meals = useMealsQuery(filter);
    const items = mealsFromPages(meals.data?.pages);
    const total = totalFromPages(meals.data?.pages);

    const isFiltered = filters.isFiltered || ranges.isFiltered;
    const clearEverything = () => {
        filters.clear();
        ranges.clear();
    };

    return (
        <Stack space="lg" testID="meals-screen">
            <Breadcrumbs
                testID="meals-breadcrumbs"
                items={[
                    {
                        key: 'home',
                        label: t('catalogue:nav.home'),
                        onPress: () => {
                            router.push('/');
                        },
                    },
                    { key: 'meals', label: t('catalogue:nav.meals') },
                ]}
            />

            <Stack space="xs">
                <Heading level={1} testID="meals-title">
                    {t('catalogue:meals.title')}
                </Heading>
                <Text tone="secondary">{t('catalogue:meals.subtitle')}</Text>
            </Stack>

            <FilterBar
                testID="meals-filter"
                state={filters}
                searchLabel={t('catalogue:meals.searchLabel')}
                searchPlaceholder={t('catalogue:meals.searchPlaceholder')}
                resultCount={meals.data === undefined ? undefined : items.length}
                groups={[
                    {
                        key: 'kitchen',
                        label: t('catalogue:filters.kitchen'),
                        options: kitchenItems.map((kitchen) => ({
                            value: String(kitchen.id),
                            label: kitchen.name,
                        })),
                    },
                    {
                        key: 'mealType',
                        label: t('catalogue:filters.mealType'),
                        options: MEAL_TYPES.map((mealType) => ({
                            value: mealType,
                            label: t(`marketplace:mealTypes.${mealType}`),
                        })),
                    },
                    {
                        key: 'diet',
                        label: t('catalogue:filters.diet'),
                        options: DIET_FILTERS.map((diet) => ({
                            value: diet,
                            label: t(`marketplace:diets.${diet}`),
                        })),
                    },
                    {
                        key: 'exclude',
                        label: t('catalogue:filters.excludeAllergens'),
                        options: ALLERGEN_CODES.map((code) => ({
                            value: code,
                            label: t(`marketplace:allergens.${code}`),
                        })),
                    },
                ]}
            />

            <Text testID="meals-exclude-hint" tone="secondary" variant="caption">
                {t('catalogue:filters.excludeAllergensHint')}
            </Text>

            <Select
                testID="meals-sort"
                id="meals-sort"
                label={t('catalogue:meals.sortLabel')}
                value={sort}
                options={MEAL_SORTS.map((option) => ({
                    value: option,
                    label: t(`catalogue:meals.sort.${option}`),
                }))}
                onChange={(next) => {
                    filters.select('sort', next === 'relevance' ? null : next);
                }}
            />

            <MealRangeFilters testID="meals-ranges" state={ranges} currency={PRICE_CURRENCY} />

            <QueryStates
                query={meals}
                isEmpty={items.length === 0}
                emptyTitle={t('catalogue:meals.emptyTitle')}
                emptyBody={t('catalogue:meals.emptyBody')}
                emptyActions={
                    isFiltered ? (
                        <Button
                            testID="meals-empty-clear"
                            variant="secondary"
                            label={t('catalogue:filters.clear')}
                            onPress={clearEverything}
                        />
                    ) : undefined
                }
                testID="meals"
            >
                <Stack space="md">
                    <Text testID="meals-count" tone="secondary" variant="caption">
                        {total === null
                            ? t('catalogue:meals.showingUnknownTotal', { shown: items.length })
                            : t('catalogue:meals.showing', { shown: items.length, total })}
                    </Text>

                    <CardGrid testID="meals-grid">
                        {items.map((meal) => (
                            <CardGridItem key={meal.id}>
                                <MealCard
                                    meal={meal}
                                    onPress={() => {
                                        router.push(`/meals/${String(meal.id)}` as never);
                                    }}
                                />
                            </CardGridItem>
                        ))}
                    </CardGrid>

                    {meals.hasNextPage ? (
                        <Button
                            testID="meals-load-more"
                            variant="secondary"
                            label={
                                meals.isFetchingNextPage
                                    ? t('catalogue:meals.loadingMore')
                                    : t('catalogue:meals.loadMore')
                            }
                            disabled={meals.isFetchingNextPage}
                            onPress={() => {
                                void meals.fetchNextPage();
                            }}
                        />
                    ) : (
                        <Text testID="meals-all-loaded" tone="secondary" variant="caption">
                            {t('catalogue:meals.allLoaded')}
                        </Text>
                    )}
                </Stack>
            </QueryStates>

            <MedicalDisclaimer />
        </Stack>
    );
}
