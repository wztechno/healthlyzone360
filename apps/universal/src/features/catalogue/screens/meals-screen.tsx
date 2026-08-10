import {
    Button,
    Collapse,
    Icon,
    Select,
    Stack,
    Text,
    TextInputField,
} from '@healthy360/design-system';
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
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { mealsFromPages, totalFromPages, useMealsQuery } from '../../../data/catalogue-hooks.ts';
import { useKitchensQuery } from '../../../data/marketplace-hooks.ts';
import { MedicalDisclaimer } from '../../../safety/medical-disclaimer.tsx';
import { FilterBar, useMarketplaceFilters } from '../../marketplace/filter-bar.tsx';
import { ToolbarRow } from '../../marketplace/toolbar-row.tsx';
import { PageHero } from '../../../ui/page-hero.tsx';
import { MealCard } from '../../marketplace/meal-card.tsx';
import { QueryStates } from '../../marketplace/query-states.tsx';
import { CardGrid, CardGridItem } from '../../marketplace/section-header.tsx';
import {
    MEAL_RANGE_KEYS,
    MealRangeFilters,
    toMealFilter,
    useMealRanges,
} from '../meal-filters.tsx';

/**
 * `/meals` — the whole marketplace catalogue, filterable.
 *
 * Neither reference product filters its catalogue at all (doc 04, RBC-11; doc 17, IA-11). Fourteen
 * plans survive without a filter; forty meals across six kitchens and six numeric axes do not, so
 * this is a deliberate divergence and the single largest screen in the wave.
 *
 * ## The filters open on demand, not on arrival
 *
 * Six numeric ranges and four chip groups (thirty-odd chips) laid out above the grid pushed the
 * meals themselves below the fold — you scrolled past the whole apparatus before seeing a single
 * dish. So the search box, the sort and the result count stay visible, and everything else lives in
 * a **disclosure that is closed by default**: the grid sits right under the toolbar, and the filters
 * are one press away. The panel opens itself when you *arrive* with a filter already applied (a
 * shared link, a reload), because then the controls are the thing you came to see.
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

/** The chip-group parameters — everything the disclosure holds except the numeric ranges. */
const CHIP_GROUP_KEYS = ['kitchen', 'mealType', 'diet', 'exclude'] as const;
const GROUP_KEYS = [...CHIP_GROUP_KEYS, 'sort'] as const;

/** Meals fetched per page. Twenty fills two screens on a desktop grid and one on a phone. */
const PAGE_SIZE = 20;

/**
 * The currency the price filter is typed in.
 *
 * Every kitchen in the prototype world prices in USD, and `MealFilter.price` is in minor units of
 * "the caller's currency" without saying who decides that. A multi-currency marketplace needs the
 * display currency to come from the session or the delivery market; that is recorded as an open
 * question rather than guessed at here, and this constant is the single place it would change.
 */
const PRICE_CURRENCY: CurrencyCode = 'USD';

/**
 * The label a filter chip shows, resolved the same way the panel's own control resolves it.
 *
 * Kitchens are the awkward one: the URL carries an id, and only the fetched kitchen list knows the
 * name. Until it arrives the chip falls back to the id rather than rendering nothing — a chip that
 * appears late is worse than one that is briefly unlovely, because the person is looking at a
 * filtered grid either way.
 */
function chipLabel(
    groupKey: (typeof CHIP_GROUP_KEYS)[number],
    value: string,
    kitchens: readonly { readonly id: unknown; readonly name: string }[],
    t: (key: string) => string,
): string {
    switch (groupKey) {
        case 'kitchen':
            return kitchens.find((kitchen) => String(kitchen.id) === value)?.name ?? value;
        case 'mealType':
            return t(`marketplace:mealTypes.${value}`);
        case 'diet':
            return t(`marketplace:diets.${value}`);
        case 'exclude':
            return t(`marketplace:allergens.${value}`);
    }
}

export function MealsScreen() {
    const { t } = useTranslation();
    const router = useRouter();
    const filters = useMarketplaceFilters(GROUP_KEYS);
    const ranges = useMealRanges();

    const kitchens = useKitchensQuery({ channels: ['marketplace'], limit: 20 });
    // Memoised because the chip labels below depend on it: `?? []` allocates a fresh array on
    // every render, which would rebuild the chip list every time regardless of the data.
    const kitchenItems = useMemo(() => kitchens.data?.items ?? [], [kitchens.data]);

    const { query: searchTerm, selected } = filters;
    const { values: rangeValues } = ranges;

    const sort = (selected['sort']?.[0] ?? 'relevance') as MealSort;

    // How many *hidden* filters are active — chips and ranges, not the always-visible search or sort.
    const chipCount = CHIP_GROUP_KEYS.reduce(
        (total, key) => total + (selected[key]?.length ?? 0),
        0,
    );
    const rangeCount = MEAL_RANGE_KEYS.filter(
        (key) => rangeValues[key].min !== null || rangeValues[key].max !== null,
    ).length;
    const activeCount = chipCount + rangeCount;

    // Closed on a fresh visit so the grid is the first thing you see; open when a filter is already
    // applied on arrival, because then the controls are what you came for.
    const [showFilters, setShowFilters] = useState(activeCount > 0);

    const filter = useMemo(
        () => ({
            ...toMealFilter({
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
            // This is the customer-facing meals catalogue, not a kitchen's mixed menu. Keep
            // sauces and other sellable products out of its count and pagination so every card
            // here represents a prepared meal.
            itemTypes: ['meal'],
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

    /**
     * The chip groups currently in force, flattened into removable chips for the toolbar.
     *
     * This is what makes the closed-by-default panel honest. Arriving on a shared link with three
     * filters applied, the grid is short and — until now — nothing on screen said why; the filters
     * were real but invisible behind a disclosure that stays shut. Each chip names one and removes
     * exactly that one, so widening the search never requires opening the panel.
     *
     * Labels come from the same `groups` definitions the panel renders, so a chip can never
     * disagree with the control it mirrors. The numeric ranges are deliberately *not* here: a range
     * is two bounds and a unit, which does not survive being squeezed into a pill, and it is
     * already counted in the toggle's badge.
     */
    const activeChips = useMemo(
        () =>
            CHIP_GROUP_KEYS.flatMap((groupKey) =>
                (selected[groupKey] ?? []).map((value) => ({
                    key: `${groupKey}-${value}`,
                    label: chipLabel(groupKey, value, kitchenItems, t),
                    removeLabel: t('catalogue:filters.removeFilter', {
                        filter: chipLabel(groupKey, value, kitchenItems, t),
                    }),
                    onRemove: () => {
                        filters.toggle(groupKey, value, false);
                    },
                })),
            ),
        [selected, kitchenItems, filters, t],
    );

    return (
        <Stack space="lg" testID="meals-screen">
            {/*
             * Rule 3: the page opens with weight rather than with a breadcrumb, a heading and a
             * form field. The breadcrumbs move inside the band and the search moves into its
             * trailing panel, which is what frees the toolbar below to be a single row.
             */}
            <PageHero
                testID="meals"
                breadcrumbs={[
                    {
                        key: 'home',
                        label: t('catalogue:nav.home'),
                        onPress: () => {
                            router.push('/');
                        },
                    },
                    { key: 'meals', label: t('catalogue:nav.meals') },
                ]}
                title={t('catalogue:meals.title')}
                subtitle={t('catalogue:meals.subtitle')}
                trailing={
                    <TextInputField
                        testID="meals-filter-search"
                        id="meals-filter-search"
                        label={t('catalogue:meals.searchLabel')}
                        placeholder={t('catalogue:meals.searchPlaceholder')}
                        value={searchTerm}
                        onChangeText={filters.setQuery}
                        autoCapitalize="none"
                        autoCorrect={false}
                        returnKeyType="search"
                        trailing={<Icon name="search" />}
                        className="rounded-xl bg-surface-raised p-3 shadow-elevation-3"
                    />
                }
            />

            {/*
             * Rule 2: one row. The disclosure toggle, the filters currently in force, the count
             * and the sort share a baseline instead of stacking three deep.
             */}
            <ToolbarRow
                testID="meals-toolbar"
                filtersTestID="meals-filter-toggle"
                countTestID="meals-count"
                filtersLabel={
                    activeCount === 0
                        ? t('catalogue:meals.filters')
                        : t('catalogue:meals.filtersActive', { n: activeCount })
                }
                filtersActive={activeCount}
                filtersExpanded={showFilters}
                filtersPanelId="meals-filter-panel"
                onToggleFilters={() => {
                    setShowFilters((open) => !open);
                }}
                activeFilters={activeChips}
                onClearAll={clearEverything}
                clearAllLabel={t('catalogue:filters.clear')}
                resultSummary={
                    total === null
                        ? t('catalogue:meals.showingUnknownTotal', { shown: items.length })
                        : t('catalogue:meals.showing', { shown: items.length, total })
                }
                sort={
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
                        className="min-w-[200px]"
                    />
                }
            />

            <Collapse open={showFilters} nativeID="meals-filter-panel" testID="meals-filter-panel">
                <Stack space="md">
                    <FilterBar
                        testID="meals-filter"
                        state={filters}
                        showSearch={false}
                        searchLabel={t('catalogue:meals.searchLabel')}
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

                    <MealRangeFilters
                        testID="meals-ranges"
                        state={ranges}
                        currency={PRICE_CURRENCY}
                    />
                </Stack>
            </Collapse>

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
