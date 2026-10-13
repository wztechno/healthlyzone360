import { Button, Stack } from '@healthy360/design-system';
import type {
    AllergenCode,
    CurrencyCode,
    DietClassification,
    KitchenId,
} from '@healthy360/domain-types';
import { useRouter } from 'expo-router';
import { useMemo } from 'react';
import { useFormatter } from '@healthy360/i18n';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { useBasketAdd } from '../../commerce/use-basket-add.tsx';
import { mealsFromPages, totalFromPages, useMealsQuery } from '../../../data/catalogue-hooks.ts';
import { useKitchensQuery } from '../../../data/marketplace-hooks.ts';
import { MedicalDisclaimer } from '../../../safety/medical-disclaimer.tsx';
import { ListingHeader } from '../../../ui/listing-header.tsx';
import { useMarketplaceFilters } from '../../marketplace/filter-bar.tsx';
import { QueryStates } from '../../marketplace/query-states.tsx';
import { ToolbarRow } from '../../marketplace/toolbar-row.tsx';
import { CategoryTabs, MealFilterBar, rangeChips } from '../meal-filter-bar.tsx';
import { MEAL_RANGE_KEYS, toMealFilter, useMealRanges } from '../meal-filters.tsx';
import { isMenuSort, refineMeals } from '../meal-readings.ts';
import { MenuGrid } from '../menu-grid.tsx';
import { MenuMealCard } from '../menu-meal-card.tsx';
import { shownCategory, shownItemTypes } from '../shown-shelves.ts';
import { useMealShelves } from '../use-meal-shelves.ts';

/**
 * `/meals` — "Today's menu", HealthZone's `§isCatalog`.
 *
 * ## The page, top to bottom
 *
 * A trail, the title and the count — `ListingHeader`. Then the shelves as a row of tabs with their
 * counts, and under them one bar of filter buttons — Diet, Calories, Allergies, Kitchen, More — with
 * the sort at its end, pinned on the web while the grid scrolls (`meal-filter-bar.tsx`). Whatever is
 * applied is listed under the bar as removable chips with "Clear all". The grid has the full width:
 * there is no filter rail and no disclosure, at any width.
 *
 * ## Every control writes to the URL
 *
 * Text, chips and ranges all land in the address bar, which is what makes a filtered catalogue a
 * *place*: linkable, reloadable and reachable with the back button. The search field is the
 * chrome's (`shell/marketplace-shell.tsx`), and writes the same `?q=`.
 *
 * ## What the server filters, and what the page does
 *
 * `GET /marketplace/meals` applies the text, kitchen, shelf, diets, allergen exclusions and a price
 * ceiling. It does not apply the energy and macro ranges, the preparation time or the order, so
 * those are applied to the meals already fetched (`refineMeals`) — and still sent, so a server that
 * learns them needs no client change. The count line says "so far" until every page is in, because
 * the API returns no total.
 *
 * ## Pagination is a button, not a scroll listener
 *
 * An auto-loading list makes the footer unreachable, fights scroll restoration on the way back from
 * a meal, and gives a keyboard user no way to stop. When the cursor runs out the button goes, and
 * the grid simply ends, as the design's does.
 */

/** The chip-group parameters — everything the filters hold except the numeric ranges. */
const CHIP_GROUP_KEYS = ['kitchen', 'category', 'diet', 'exclude'] as const;
const GROUP_KEYS = [...CHIP_GROUP_KEYS, 'sort'] as const;

/** Meals fetched per page. Twenty fills two screens on a desktop grid and one on a phone. */
const PAGE_SIZE = 20;

/**
 * The currency the price filter is typed in.
 *
 * `MealFilter.price` is in minor units of "the caller's currency" without saying who decides that.
 * A multi-currency marketplace needs the display currency to come from the session or the delivery
 * market; this constant is the single place it would change.
 */
const PRICE_CURRENCY: CurrencyCode = 'USD';

export function MealsScreen() {
    const { t } = useTranslation();
    const basket = useBasketAdd({ labelKey: 'catalogue:nav.meals', testID: 'meals' });
    const router = useRouter();
    const filters = useMarketplaceFilters(GROUP_KEYS);
    const ranges = useMealRanges();
    const shelves = useMealShelves();
    const formatter = useFormatter();

    const kitchens = useKitchensQuery({ channels: ['marketplace'], limit: 20 });
    const kitchenItems = useMemo(() => kitchens.data?.items ?? [], [kitchens.data]);

    const { query: searchTerm, selected } = filters;
    const { values: rangeValues } = ranges;

    const rawSort = selected['sort']?.[0];
    const sort = isMenuSort(rawSort) ? rawSort : 'relevance';
    // Only the shown shelves are reachable for now (`shown-shelves.ts`): a picked shelf that is
    // hidden falls back to the shown one rather than listing what the rail no longer offers.
    const category = shownCategory(selected['category']?.[0]);

    const chipCount = CHIP_GROUP_KEYS.reduce(
        (total, key) => total + (selected[key]?.length ?? 0),
        0,
    );
    const rangeCount = MEAL_RANGE_KEYS.filter(
        (key) => rangeValues[key].min !== null || rangeValues[key].max !== null,
    ).length;
    const activeCount = chipCount + rangeCount;

    const filter = useMemo(
        () => ({
            ...toMealFilter({
                query: searchTerm,
                kitchenIds: (selected['kitchen'] ?? []) as readonly KitchenId[],
                mealTypes: [],
                dietClassifications: (selected['diet'] ?? []) as readonly DietClassification[],
                excludeAllergens: (selected['exclude'] ?? []) as readonly AllergenCode[],
                ranges: rangeValues,
                sort: sort === 'relevance' ? undefined : sort,
                currency: PRICE_CURRENCY,
                limit: PAGE_SIZE,
            }),
            ...(category === undefined ? {} : { categorySlug: category }),
            // Un-narrowed, the customer menu is prepared meals only. While the menu is narrowed
            // to its shown shelves it asks for every type they hold: meals, sauces, dressings and
            // the frozen shelf's products.
            itemTypes: shownItemTypes(['meal']),
        }),
        [searchTerm, selected, rangeValues, sort, category],
    );

    const meals = useMealsQuery(filter);
    const fetched = useMemo(() => mealsFromPages(meals.data?.pages), [meals.data]);
    const items = useMemo(
        () => refineMeals(fetched, rangeValues, sort),
        [fetched, rangeValues, sort],
    );
    const total = totalFromPages(meals.data?.pages);

    const isFiltered = filters.isFiltered || ranges.isFiltered;
    const clearEverything = () => {
        filters.clear();
        ranges.clear();
    };

    /*
     * The count line, as true as the API lets it be. Every page in: the number on screen is the
     * number. Otherwise a server total when it sent one and nothing was narrowed on this side of
     * the wire; the shelf walk's total for the unfiltered menu; and failing both, "so far".
     */
    const countLine = (() => {
        if (!meals.hasNextPage) {
            return t('catalogue:meals.countAvailable', { count: items.length });
        }
        if (total !== null && rangeCount === 0) {
            return t('catalogue:meals.countAvailable', { count: total });
        }
        if (activeCount === 0 && searchTerm === '' && shelves.total !== null) {
            return t('catalogue:meals.countAvailable', { count: shelves.total });
        }
        return t('catalogue:meals.countSoFar', { count: items.length });
    })();

    /** Everything applied, as removable chips — the chip groups first, then the ranges. */
    const activeChips = useMemo(() => {
        const labelOf = (groupKey: (typeof CHIP_GROUP_KEYS)[number], value: string): string => {
            switch (groupKey) {
                case 'kitchen':
                    return (
                        kitchenItems.find((kitchen) => String(kitchen.id) === value)?.name ?? value
                    );
                case 'category':
                    return shelves.shelves.find((shelf) => shelf.code === value)?.name ?? value;
                case 'diet':
                    return t(`marketplace:diets.${value}`);
                case 'exclude':
                    return t(`marketplace:allergens.${value}`);
            }
        };
        const groups = CHIP_GROUP_KEYS.flatMap((groupKey) =>
            (selected[groupKey] ?? [])
                // The shelf is a tab, and its lit tab already says so.
                .filter(() => groupKey !== 'category')
                .map((value) => ({
                    key: `${groupKey}-${value}`,
                    label: labelOf(groupKey, value),
                    removeLabel: t('catalogue:filters.removeFilter', {
                        filter: labelOf(groupKey, value),
                    }),
                    onRemove: () => {
                        filters.toggle(groupKey, value, false);
                    },
                })),
        );
        return [...groups, ...rangeChips(ranges, PRICE_CURRENCY, t, formatter.formatNumber)];
    }, [selected, kitchenItems, shelves.shelves, filters, ranges, formatter, t]);

    return (
        <Stack space="lg" testID="meals-screen">
            <ListingHeader
                testID="meals"
                breadcrumbs={[
                    {
                        key: 'home',
                        label: t('catalogue:nav.home'),
                        onPress: () => {
                            router.push('/');
                        },
                    },
                    { key: 'meals', label: t('catalogue:meals.title') },
                ]}
                title={t('catalogue:meals.title')}
                metaTestID="meals-count"
                meta={countLine}
            />

            <CategoryTabs filters={filters} shelves={shelves} />

            {/*
             * Pinned on the web against the shell's scroll port — `top-0` sits just under the bar —
             * so the filters stay in reach while the grid scrolls. `z-10` lifts the open menus over
             * the cards; the wrapper is `z-auto` inside so the popovers are not trapped beneath it.
             */}
            <View className="z-10 flex-col gap-3 border-b border-stroke bg-surface-base pb-3 pt-1 web:sticky web:top-0">
                <MealFilterBar
                    filters={filters}
                    ranges={ranges}
                    kitchens={kitchenItems}
                    currency={PRICE_CURRENCY}
                    sort={sort}
                    onSort={(next) => {
                        filters.select('sort', next === 'relevance' ? null : next);
                    }}
                />
                {activeChips.length === 0 ? null : (
                    <ToolbarRow
                        testID="meals-toolbar"
                        filtersLabel=""
                        filtersActive={activeCount}
                        filtersExpanded={false}
                        filtersPanelId=""
                        onToggleFilters={() => undefined}
                        showFiltersToggle={false}
                        activeFilters={activeChips}
                        onClearAll={clearEverything}
                        clearAllLabel={t('catalogue:filters.clear')}
                    />
                )}
            </View>

            {/* `min-w-0` is load-bearing: without it React Native Web gives the column its
                max-content width and the page scrolls sideways at 1024. */}
            <Stack space="md" className="min-w-0">
                <QueryStates
                    query={meals}
                    isEmpty={items.length === 0 && !meals.hasNextPage}
                    emptyTitle={t('catalogue:meals.emptyTitle')}
                    emptyBody={t('catalogue:meals.emptyBody')}
                    emptyActions={
                        isFiltered ? (
                            <Button
                                testID="meals-empty-clear"
                                label={t('catalogue:filters.clear')}
                                onPress={clearEverything}
                            />
                        ) : undefined
                    }
                    testID="meals"
                >
                    <Stack space="md">
                        <MenuGrid testID="meals-grid">
                            {items.map((meal) => (
                                <MenuMealCard
                                    key={meal.id}
                                    meal={meal}
                                    onOpen={() => {
                                        router.push(`/meals/${String(meal.id)}` as never);
                                    }}
                                    onAdd={() => {
                                        basket.add(meal);
                                    }}
                                />
                            ))}
                        </MenuGrid>

                        {meals.hasNextPage ? (
                            <View className="items-center">
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
                            </View>
                        ) : null}
                    </Stack>
                </QueryStates>
            </Stack>

            <MedicalDisclaimer />

            {basket.dialog}
        </Stack>
    );
}
