import { Icon, cx, useBreakpoint } from '@healthy360/design-system';
import type { MarketplaceMeal } from '@healthy360/api-client/contracts';
import { neutral } from '@healthy360/design-tokens';
import type {
    AllergenCode,
    CurrencyCode,
    DietClassification,
    KitchenId,
} from '@healthy360/domain-types';
import { useRouter } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { useFormatter } from '@healthy360/i18n';
import { useTranslation } from 'react-i18next';
import { Platform, Pressable, Text as RNText, TextInput, View } from 'react-native';

import { useBasketAdd } from '../../commerce/use-basket-add.tsx';
import { mealsFromPages, totalFromPages, useMealsQuery } from '../../../data/catalogue-hooks.ts';
import { useKitchensQuery } from '../../../data/marketplace-hooks.ts';
import { useRememberQuery } from '../../../navigation/use-return-to.ts';
import {
    QUERY_PARAM,
    useMarketplaceFilters,
    useSearchDraft,
} from '../../marketplace/filter-bar.tsx';
import { DeliverToMenu } from '../../marketplace/discover/deliver-to-menu.tsx';
import { QueryStates } from '../../marketplace/query-states.tsx';
import { ShopStateButton } from '../../../ui/shop-state.tsx';
import { CategoryTabs, FILTER_LOOKS, MealFilterBar, rangeChips } from '../meal-filter-bar.tsx';
import type { FilterLook } from '../meal-filter-bar.tsx';
import { MEAL_RANGE_KEYS, toMealFilter, useMealRanges } from '../meal-filters.tsx';
import { isMenuSort, refineMeals } from '../meal-readings.ts';
import { MenuGrid } from '../menu-grid.tsx';
import { MenuMealCard } from '../menu-meal-card.tsx';
import { TINT_FILL, TINT_INK } from '../shelf-tints.ts';
import { useMenuSearchFocus } from '../menu-search-focus.ts';
import { shownCategory, shownItemTypes } from '../shown-shelves.ts';
import { useMealShelves } from '../use-meal-shelves.ts';

/**
 * `/meals` — the Menu, as the accepted shop board draws it.
 *
 * ## The page, top to bottom
 *
 * The title and the count, with Deliver to at the end of the row (`deliver-to-menu.tsx`). Then the
 * shelves as colour tiles with a photograph and their counts, and under them one white bar holding
 * the search, the filter buttons — Diet, Calories, Allergies, Kitchen, More — and the sort, pinned
 * on the web while the grid scrolls (`meal-filter-bar.tsx`). Whatever is applied is listed under the
 * bar as removable chips in their menu's colour, with "Clear all". The grid has the full width:
 * there is no filter rail and no disclosure, at any width.
 *
 * ## Every control writes to the URL
 *
 * Text, chips and ranges all land in the address bar, which is what makes a filtered catalogue a
 * *place*: linkable, reloadable and reachable with the back button. The page's query is also
 * remembered for this visit (`useRememberQuery`), so a meal's "Today's menu" crumb comes back to the
 * menu as it was left even when it cannot simply go Back.
 *
 * ## The search field is the page's own
 *
 * It used to be the chrome's alone, drawn only from `xl`: a tablet's search button opened this
 * page with nothing to type in, a phone had no search at all, and an applied `?q=` showed no chip
 * and no way to lift it (browse-06). Now the field opens the filter bar at every width, settles for
 * a moment before it becomes `?q=` (`useSearchDraft`), and the term is a removable chip like every
 * other filter. The header's field (from `xl`) writes the same `?q=` in place, so the two never
 * disagree and a search from the header narrows the filters already applied.
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

/** The page's search field; its input is `${SEARCH_TEST_ID}-input`. */
const SEARCH_TEST_ID = 'meals-search';

/** Each chip group's menu, which gives its chip the menu's colour, glyph and name. */
const CHIP_LOOKS: Readonly<Record<(typeof CHIP_GROUP_KEYS)[number], FilterLook>> = {
    kitchen: 'kitchen',
    category: 'more',
    diet: 'diet',
    exclude: 'allergies',
};
const CHIP_GROUPS: Readonly<Record<(typeof CHIP_GROUP_KEYS)[number], string>> = {
    kitchen: 'catalogue:filters.menu.kitchen',
    category: 'catalogue:filters.category',
    diet: 'catalogue:filters.menu.diet',
    exclude: 'catalogue:filters.menu.allergies',
};

/**
 * The whole shown menu, best rated first — Discover's listing, so it is usually cached — read only
 * for a photograph to put on each shelf's tile.
 */
const SHELF_PHOTO_FILTER = (() => {
    const shelf = shownCategory();
    return {
        itemTypes: shownItemTypes(['meal']),
        ...(shelf === undefined ? {} : { categorySlug: shelf }),
        sort: 'rating' as const,
        limit: 100,
    };
})();

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
    const search = useSearchDraft(filters);
    const [searchFocused, setSearchFocused] = useState(false);
    // Shop · Menu, phone board: the count beside the title, the search on its own row, two cards
    // to a row.
    const phone = !useBreakpoint().atLeast('md');
    useRememberQuery();

    // The header's search button asks for the cursor here. The field is a DOM input on the web;
    // on a phone the field is the first thing on the page, so there is nothing to find.
    const focusSearch = useCallback(() => {
        if (Platform.OS !== 'web') return;
        const field = globalThis.document.querySelector(`[data-testid="${SEARCH_TEST_ID}-input"]`);
        if (field instanceof globalThis.HTMLElement) field.focus();
    }, []);
    useMenuSearchFocus(focusSearch);

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
    const shelfPhotos = useMealsQuery(SHELF_PHOTO_FILTER);
    const photoOf = useCallback(
        (code: string): MarketplaceMeal | undefined =>
            mealsFromPages(shelfPhotos.data?.pages).find(
                (meal) => meal.publishedCategory?.code === code,
            ),
        [shelfPhotos.data],
    );
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
    // The phone board's short form: "99 items" beside the title, from the same best number.
    const countNumber = !meals.hasNextPage
        ? items.length
        : total !== null && rangeCount === 0
          ? total
          : activeCount === 0 && searchTerm === '' && shelves.total !== null
            ? shelves.total
            : items.length;
    const countShort = t('catalogue:filters.shelfCount', {
        count: countNumber,
        n: formatter.formatNumber(countNumber),
    });

    /** Everything applied, as removable chips — the term first, then the chip groups, then ranges. */
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
                // The shelf is a tile, and its ringed tile already says so.
                .filter(() => groupKey !== 'category')
                .map((value) => ({
                    key: `${groupKey}-${value}`,
                    look: CHIP_LOOKS[groupKey],
                    group: t(CHIP_GROUPS[groupKey]),
                    value: labelOf(groupKey, value),
                    removeLabel: t('catalogue:filters.removeFilter', {
                        filter: labelOf(groupKey, value),
                    }),
                    onRemove: () => {
                        filters.toggle(groupKey, value, false);
                    },
                })),
        );
        // The term leads: it is what the person typed, and the narrowing they are most likely to
        // want to take back first.
        const searchLabel = t('catalogue:filters.searchChip', { term: searchTerm });
        const term =
            searchTerm === ''
                ? []
                : [
                      {
                          key: QUERY_PARAM,
                          look: 'search' as const,
                          group: t('catalogue:filters.searchGroup'),
                          value: searchTerm,
                          removeLabel: t('catalogue:filters.removeFilter', { filter: searchLabel }),
                          onRemove: () => {
                              filters.setQuery('');
                          },
                      },
                  ];
        return [
            ...term,
            ...groups,
            ...rangeChips(ranges, PRICE_CURRENCY, t, formatter.formatNumber),
        ];
    }, [searchTerm, selected, kitchenItems, shelves.shelves, filters, ranges, formatter, t]);

    const searchField = (
        <View
            className={cx(
                'flex-row items-center gap-2 px-4',
                phone
                    ? cx(
                          'h-12 rounded-full border bg-surface-raised',
                          searchFocused
                              ? 'border-surface-brand shadow-elevation-focus-ring'
                              : 'border-stroke-strong',
                      )
                    : cx(
                          'h-[52px] rounded-2xl border-2 bg-surface-base',
                          searchFocused
                              ? 'border-surface-brand shadow-elevation-focus-ring'
                              : 'border-transparent',
                      ),
            )}
        >
            <Icon name="search" size="sm" className="text-content-secondary" />
            <TextInput
                testID={`${SEARCH_TEST_ID}-input`}
                accessibilityLabel={t('marketplace:nav.searchLabel')}
                placeholder={t('catalogue:meals.searchPlaceholder')}
                value={search.draft}
                onChangeText={search.setDraft}
                onSubmitEditing={search.submit}
                onFocus={() => {
                    setSearchFocused(true);
                }}
                onBlur={() => {
                    setSearchFocused(false);
                }}
                returnKeyType="search"
                autoCapitalize="none"
                autoCorrect={false}
                placeholderTextColor={neutral[600]}
                className="h-full min-w-0 flex-1 text-sm text-content-primary text-start web:outline-none"
            />
        </View>
    );

    return (
        <View
            testID="meals-screen"
            className={cx('relative flex-col pb-11', phone ? 'gap-3' : 'gap-6')}
        >
            {/* The design's soft shapes behind the page. */}
            <View
                aria-hidden
                pointerEvents="none"
                className="absolute -start-44 -top-32 h-[440px] w-[440px] rounded-full bg-surface-brand-subtle opacity-60"
            />
            <View
                aria-hidden
                pointerEvents="none"
                className="absolute -end-52 top-[520px] h-[420px] w-[420px] rounded-full bg-tint-yellow opacity-50"
            />

            {/* The title and its count, with where the food goes at the end of the row. `z-20`
                lifts its address dropdown over the pinned filter bar (`z-10`) that follows it. */}
            <View className="z-20 flex-row flex-wrap items-end gap-4 pt-1">
                <View
                    className={cx(
                        'me-auto min-w-0',
                        phone ? 'flex-row items-baseline gap-2' : 'flex-col',
                    )}
                >
                    <RNText
                        role="heading"
                        aria-level={1}
                        className={cx(
                            'font-display font-bold tracking-display text-content-primary text-start',
                            phone ? 'text-2xl' : 'text-3xl',
                        )}
                    >
                        {t('marketplace:nav.meals')}
                    </RNText>
                    <RNText
                        testID="meals-count"
                        className={cx(
                            'text-content-secondary text-start',
                            phone ? 'text-sm' : 'mt-0.5 text-sm',
                        )}
                    >
                        {phone ? countShort : countLine}
                    </RNText>
                </View>
                {/* On a phone the bar carries it (the accepted phone boards). */}
                <View className="hidden md:flex">
                    <DeliverToMenu
                        testID="meals"
                        framed
                        kitchenId={fetched[0]?.kitchenId ?? null}
                    />
                </View>
            </View>

            {phone ? searchField : null}

            <CategoryTabs filters={filters} shelves={shelves} photoOf={photoOf} />

            {/*
             * Pinned on the web against the shell's scroll port — `top-0` sits just under the bar —
             * so the filters stay in reach while the grid scrolls. `z-10` lifts the open menus over
             * the cards; the wrapper is `z-auto` inside so the menus are not trapped beneath it.
             */}
            <View className="z-10 flex-col gap-4 bg-surface-base pb-2 pt-1 web:sticky web:top-0">
                <MealFilterBar
                    filters={filters}
                    ranges={ranges}
                    kitchens={kitchenItems}
                    currency={PRICE_CURRENCY}
                    sort={sort}
                    summary={t(
                        meals.hasNextPage
                            ? 'catalogue:filters.dishCountSoFar'
                            : 'catalogue:filters.dishCount',
                        { count: items.length },
                    )}
                    hasRatings={fetched.some((meal) => meal.rating !== null)}
                    onSort={(next) => {
                        filters.select('sort', next === 'relevance' ? null : next);
                    }}
                    search={phone ? undefined : searchField}
                />
                {activeChips.length === 0 ? null : (
                    <View
                        testID="meals-toolbar"
                        role="status"
                        className="min-h-touch flex-row flex-wrap items-center gap-2.5"
                    >
                        {activeChips.map((chip) => {
                            const { tint, icon } = FILTER_LOOKS[chip.look];
                            return (
                                <Pressable
                                    key={chip.key}
                                    testID={`meals-toolbar-chip-${chip.key}`}
                                    role="button"
                                    accessibilityRole="button"
                                    accessibilityLabel={chip.removeLabel}
                                    onPress={chip.onRemove}
                                    className={cx(
                                        'h-10 flex-row items-center gap-2 rounded-2xl px-1.5 transition duration-normal ease-standard hover:-translate-y-px',
                                        TINT_FILL[tint],
                                    )}
                                >
                                    <View className="h-7 w-7 items-center justify-center rounded-lg bg-surface-raised">
                                        <Icon name={icon} size="sm" className={TINT_INK[tint]} />
                                    </View>
                                    <View className="flex-col items-start">
                                        <RNText
                                            className={cx(
                                                'text-xs font-semibold uppercase tracking-wide opacity-75',
                                                TINT_INK[tint],
                                            )}
                                        >
                                            {chip.group}
                                        </RNText>
                                        <RNText
                                            numberOfLines={1}
                                            className={cx('text-sm font-semibold', TINT_INK[tint])}
                                        >
                                            {chip.value}
                                        </RNText>
                                    </View>
                                    <View className="h-[26px] w-[26px] items-center justify-center rounded-full">
                                        <Icon name="close" size="sm" className={TINT_INK[tint]} />
                                    </View>
                                </Pressable>
                            );
                        })}
                        <Pressable
                            testID="meals-toolbar-clear"
                            role="button"
                            accessibilityRole="button"
                            onPress={clearEverything}
                            className="h-10 flex-row items-center gap-1.5 rounded-2xl border border-dashed border-stroke-strong px-3 hover:border-solid hover:border-surface-brand"
                        >
                            <Icon name="refresh" size="sm" className="text-content-primary" />
                            <RNText className="text-sm font-semibold text-content-primary">
                                {t('catalogue:filters.clearAll')}
                            </RNText>
                        </Pressable>
                    </View>
                )}
            </View>

            {/* `min-w-0` is load-bearing: without it React Native Web gives the column its
                max-content width and the page scrolls sideways at 1024. */}
            <View className="min-w-0 flex-col gap-8">
                <QueryStates
                    query={meals}
                    isEmpty={items.length === 0 && !meals.hasNextPage}
                    emptyTitle={t('catalogue:meals.emptyTitle')}
                    emptyBody={t('catalogue:meals.emptyBody')}
                    emptyActions={
                        isFiltered ? (
                            <ShopStateButton
                                testID="meals-empty-clear"
                                kind="secondary"
                                label={t('catalogue:filters.clear')}
                                onPress={clearEverything}
                            />
                        ) : undefined
                    }
                    // Shop · Menu, pin 9: a funnel when filters left nothing, a lens otherwise.
                    emptyIcon={isFiltered ? 'funnel' : 'searchLens'}
                    skeletonCount={8}
                    testID="meals"
                >
                    <View className="flex-col gap-8">
                        <MenuGrid
                            testID="meals-grid"
                            gap={phone ? 10 : 20}
                            minCell={phone ? 140 : undefined}
                            entranceKey={JSON.stringify(filter)}
                        >
                            {items.map((meal) => (
                                <MenuMealCard
                                    key={meal.id}
                                    meal={meal}
                                    phone={phone}
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
                                <Pressable
                                    testID="meals-load-more"
                                    role="button"
                                    accessibilityRole="button"
                                    disabled={meals.isFetchingNextPage}
                                    accessibilityState={{ disabled: meals.isFetchingNextPage }}
                                    onPress={() => {
                                        void meals.fetchNextPage();
                                    }}
                                    className="h-12 items-center justify-center rounded-full border border-stroke bg-surface-raised px-7 transition duration-normal ease-standard hover:border-surface-brand"
                                >
                                    <RNText className="text-base font-semibold text-content-primary">
                                        {meals.isFetchingNextPage
                                            ? t('catalogue:meals.loadingMore')
                                            : t('catalogue:meals.loadMore')}
                                    </RNText>
                                </Pressable>
                            </View>
                        ) : null}
                    </View>
                </QueryStates>
            </View>

            {basket.dialog}
        </View>
    );
}
