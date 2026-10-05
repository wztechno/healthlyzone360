import { Button, Collapse, Drawer, Select, Stack, useBreakpoint } from '@healthy360/design-system';
import type {
    AllergenCode,
    CurrencyCode,
    DietClassification,
    KitchenId,
} from '@healthy360/domain-types';
import { useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { useBasketAdd } from '../../commerce/use-basket-add.tsx';
import { mealsFromPages, totalFromPages, useMealsQuery } from '../../../data/catalogue-hooks.ts';
import { useKitchensQuery } from '../../../data/marketplace-hooks.ts';
import { MedicalDisclaimer } from '../../../safety/medical-disclaimer.tsx';
import { Eyebrow } from '../../../ui/eyebrow.tsx';
import { ListingHeader } from '../../../ui/listing-header.tsx';
import { useMarketplaceFilters } from '../../marketplace/filter-bar.tsx';
import { QueryStates } from '../../marketplace/query-states.tsx';
import { ToolbarRow } from '../../marketplace/toolbar-row.tsx';
import { MealFilterPanel, MoreMealFilters, moreFiltersCount } from '../meal-filter-panel.tsx';
import { MEAL_RANGE_KEYS, toMealFilter, useMealRanges } from '../meal-filters.tsx';
import { MENU_SORTS, isMenuSort, refineMeals } from '../meal-readings.ts';
import { MenuGrid } from '../menu-grid.tsx';
import { MenuMealCard } from '../menu-meal-card.tsx';
import { isShownShelf, shownCategory, shownItemTypes } from '../shown-shelves.ts';
import { useMealShelves } from '../use-meal-shelves.ts';

/**
 * `/meals` — "Today's menu", HealthZone's `§isCatalog`.
 *
 * ## The page, top to bottom
 *
 * A trail, the title, the count where a listing usually writes a description, and `SORT` with its
 * select on the title's baseline — `ListingHeader`. Then a 236px rail beside the grid: `CATEGORY`,
 * `DIETARY`, `CALORIES PER SERVING`, "Clear all filters" (see `meal-filter-panel.tsx`). The grid is
 * the design's card at `auto-fill, minmax(238px, 1fr)`, which is three across at 1280.
 *
 * ## The filters take the form the width affords
 *
 * Above `lg` they are the rail, pinned the way the design pins its aside. Below `lg` there is no
 * room for a column beside a column, so the same panel sits in a **disclosure that is closed by
 * default** — a category list, the diet pills and a slider stacked above the grid would push the
 * meals off a phone screen. It opens itself when you *arrive* with a filter applied, because then
 * the controls are what you came to see. The panel is rendered once, in whichever container.
 *
 * The filters the rail does not draw — kitchen, more diets, allergen exclusions, five more ranges —
 * open in a drawer from "More filters" beside the sort, at every width. See the panel's notes for
 * why there and not on the rail.
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
    /*
     * A structural choice, so it is made in JavaScript rather than with a class variant: the rail
     * and the disclosure are different trees, not one tree at two widths, and only one of them may
     * exist at a time.
     */
    const { atLeast } = useBreakpoint();
    const showRail = atLeast('lg');

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
    const moreCount = moreFiltersCount(filters, ranges);

    // Closed on a fresh visit so the grid is the first thing you see; open when a filter is already
    // applied on arrival. Only consulted below `lg`.
    const [showFilters, setShowFilters] = useState(activeCount > 0);
    const [showMore, setShowMore] = useState(false);

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
            // The customer menu is prepared meals, not a kitchen's mixed shelf of sauces and
            // resold products, so every card here is a dish — except while the menu is narrowed
            // to the frozen shelf, whose items are products.
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

    /** The removable chips the narrow toolbar shows, since the panel there is shut. */
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
        return CHIP_GROUP_KEYS.flatMap((groupKey) =>
            (selected[groupKey] ?? [])
                .filter((value) => groupKey !== 'category' || isShownShelf(value))
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
    }, [selected, kitchenItems, shelves.shelves, filters, t]);

    const filterPanel = (
        <MealFilterPanel
            filters={filters}
            ranges={ranges}
            shelves={shelves}
            currency={PRICE_CURRENCY}
            onClearAll={clearEverything}
        />
    );

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
                trailing={
                    <View className="flex-row flex-wrap items-center gap-2">
                        <Button
                            testID="meals-more-filters"
                            variant="ghost"
                            size="sm"
                            label={
                                moreCount === 0
                                    ? t('catalogue:meals.moreFilters')
                                    : t('catalogue:meals.moreFiltersActive', { n: moreCount })
                            }
                            onPress={() => {
                                setShowMore(true);
                            }}
                        />
                        <Eyebrow>{t('catalogue:meals.sortLabel')}</Eyebrow>
                        <Select
                            testID="meals-sort"
                            id="meals-sort"
                            label={t('catalogue:meals.sortLabel')}
                            labelHidden
                            value={sort}
                            options={MENU_SORTS.map((option) => ({
                                value: option,
                                label: t(`catalogue:meals.sort.${option}`),
                            }))}
                            onChange={(next) => {
                                filters.select('sort', next === 'relevance' ? null : next);
                            }}
                            className="min-w-[180px]"
                        />
                    </View>
                }
            />

            {showRail ? null : (
                <ToolbarRow
                    testID="meals-toolbar"
                    filtersTestID="meals-filter-toggle"
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
                />
            )}

            <View className="flex-col gap-6 lg:flex-row lg:gap-[26px]">
                {showRail ? (
                    /*
                     * Pinned, as the design pins its aside. The web scroll port is the shell's
                     * ScrollView, not the document, so the design's `top:130px` is `top-0` here —
                     * the port's top edge already sits under the bar. `web:` keeps native in the
                     * ordinary flow; `self-start` gives sticky room to travel.
                     */
                    <View
                        testID="meals-filter-rail"
                        className="w-full self-start lg:w-[236px] lg:shrink-0 web:sticky web:top-0"
                    >
                        {filterPanel}
                    </View>
                ) : null}

                {/* `min-w-0` is load-bearing: without it React Native Web gives the column its
                    max-content width and the page scrolls sideways at 1024. */}
                <Stack space="md" className="min-w-0 flex-1">
                    {showRail ? null : (
                        <Collapse
                            open={showFilters}
                            nativeID="meals-filter-panel"
                            testID="meals-filter-panel"
                        >
                            {filterPanel}
                        </Collapse>
                    )}

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
            </View>

            <MedicalDisclaimer />

            <Drawer
                testID="meals-more-filters-drawer"
                open={showMore}
                onClose={() => {
                    setShowMore(false);
                }}
                placement={showRail ? 'end' : 'bottom'}
                title={t('catalogue:meals.moreFilters')}
                className={showRail ? 'w-[400px] max-w-[95vw]' : undefined}
                footer={
                    <Button
                        testID="meals-more-filters-done"
                        block
                        label={t('catalogue:meals.moreFiltersDone')}
                        onPress={() => {
                            setShowMore(false);
                        }}
                    />
                }
            >
                <MoreMealFilters
                    filters={filters}
                    ranges={ranges}
                    kitchens={kitchenItems}
                    currency={PRICE_CURRENCY}
                />
            </Drawer>

            {basket.dialog}
        </Stack>
    );
}
