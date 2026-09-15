import { Button, Collapse, Select, Stack, Text, useBreakpoint } from '@healthy360/design-system';
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
import { View } from 'react-native';

import { useBasketAdd } from '../../commerce/use-basket-add.tsx';
import { mealsFromPages, totalFromPages, useMealsQuery } from '../../../data/catalogue-hooks.ts';
import { useKitchensQuery } from '../../../data/marketplace-hooks.ts';
import { MedicalDisclaimer } from '../../../safety/medical-disclaimer.tsx';
import { useMarketplaceFilters } from '../../marketplace/filter-bar.tsx';
import { ToolbarRow } from '../../marketplace/toolbar-row.tsx';
import { ListingHeader } from '../../../ui/listing-header.tsx';
import { MealCard } from '../../marketplace/meal-card.tsx';
import { QueryStates } from '../../marketplace/query-states.tsx';
import { CardGrid, CardGridItem } from '../../marketplace/section-header.tsx';
import { MealFilterPanel } from '../meal-filter-panel.tsx';
import { MEAL_RANGE_KEYS, toMealFilter, useMealRanges } from '../meal-filters.tsx';

/**
 * `/meals` — the whole marketplace catalogue, filterable.
 *
 * Neither reference product filters its catalogue at all (doc 04, RBC-11; doc 17, IA-11). Fourteen
 * plans survive without a filter; forty meals across six kitchens and six numeric axes do not, so
 * this is a deliberate divergence and the single largest screen in the wave.
 *
 * ## The page opens flat, and the count is the subtitle
 *
 * HealthZone's catalogue has no hero band: a trail, a large title, the live result count where a
 * listing usually writes a description, and the sort control on the title's baseline. That is what
 * `ListingHeader` draws. The canopy band is still right for `/kitchens` and `/dietitians`, which
 * open on a claim rather than on a number — this screen's most useful first sentence is how many
 * meals survived the filters, and that sentence changes as they do.
 *
 * ## The search field moved into the chrome, not out of the product
 *
 * It used to sit in the hero's trailing panel. The marketplace bar now carries one
 * (`shell/marketplace-shell.tsx`), reachable from every surface rather than the four that opened
 * with a hero, and it writes the same `?q=` this screen reads. Two inputs on one parameter is two
 * things to keep in step, and the moment they disagree one of them is a bug.
 *
 * ## The filters take the form the width affords
 *
 * Above `lg` they are a rail beside the grid — the design's arrangement, and the one that lets you
 * see a control and its effect at once. Below `lg` there is no room for a column beside a column,
 * so they stay in the **disclosure that is closed by default**: thirty-odd chips and six ranges
 * stacked above the grid would push the meals themselves off a phone screen entirely. The panel
 * still opens itself when you *arrive* with a filter already applied, because then the controls are
 * the thing you came to see.
 *
 * The two arrangements render the same {@link MealFilterPanel}, once. Drawing both and hiding one
 * would duplicate every filter's testID and leave an off-screen control in the accessibility tree.
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

/** The chip-group parameters — everything the panel holds except the numeric ranges. */
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
    const basket = useBasketAdd({ labelKey: 'catalogue:nav.meals', testID: 'meals' });
    const router = useRouter();
    const filters = useMarketplaceFilters(GROUP_KEYS);
    const ranges = useMealRanges();
    /*
     * A structural choice, so it is made in JavaScript rather than with a class variant: the rail
     * and the disclosure are different trees, not one tree at two widths, and only one of them may
     * exist at a time. `use-breakpoint.ts` documents exactly this case.
     */
    const { atLeast } = useBreakpoint();
    const showRail = atLeast('lg');

    const kitchens = useKitchensQuery({ channels: ['marketplace'], limit: 20 });
    // Memoised because the chip labels below depend on it: `?? []` allocates a fresh array on
    // every render, which would rebuild the chip list every time regardless of the data.
    const kitchenItems = useMemo(() => kitchens.data?.items ?? [], [kitchens.data]);

    const { query: searchTerm, selected } = filters;
    const { values: rangeValues } = ranges;

    const sort = (selected['sort']?.[0] ?? 'relevance') as MealSort;

    // How many filters are active — chips and ranges, not the sort, which is always visible, or the
    // search term, which the chrome owns.
    const chipCount = CHIP_GROUP_KEYS.reduce(
        (total, key) => total + (selected[key]?.length ?? 0),
        0,
    );
    const rangeCount = MEAL_RANGE_KEYS.filter(
        (key) => rangeValues[key].min !== null || rangeValues[key].max !== null,
    ).length;
    const activeCount = chipCount + rangeCount;

    // Closed on a fresh visit so the grid is the first thing you see; open when a filter is already
    // applied on arrival, because then the controls are what you came for. Only consulted below
    // `lg` — above it the rail shows the same controls outright and there is nothing to disclose.
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
            itemTypes: ['meal'] as const,
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
     * Each chip names one filter and removes exactly that one, so widening a search is a single
     * press wherever the controls themselves happen to be. Below `lg` this is also the only visible
     * account of what is applied, because the panel holding those controls is shut.
     *
     * Labels come from the same vocabulary the panel's own controls resolve, so a chip can never
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

    const filterPanel = (
        <MealFilterPanel
            filters={filters}
            ranges={ranges}
            kitchens={kitchenItems}
            currency={PRICE_CURRENCY}
            onClearAll={clearEverything}
            isFiltered={isFiltered}
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
                    { key: 'meals', label: t('catalogue:nav.meals') },
                ]}
                title={t('catalogue:meals.title')}
                metaTestID="meals-count"
                meta={
                    total === null
                        ? t('catalogue:meals.showingUnknownTotal', { shown: items.length })
                        : t('catalogue:meals.showing', { shown: items.length, total })
                }
                trailing={
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

            {/*
             * The chip row exists only where the rail does not.
             *
             * Above `lg` the rail *is* the state — a lit "Breakfast" row says exactly what a
             * "Breakfast ×" chip says, one line above it — and the row was worse than redundant: it
             * only appeared once something was filtered, so picking a filter inserted a band
             * between the title and the body and pushed the rail and every card down the page. The
             * fastest way to remove a filter above `lg` is the lit control itself; below `lg`, where
             * the panel is shut, these chips are the only visible account of what is applied.
             */}
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

            <View className="flex-col gap-6 lg:flex-row">
                {showRail ? (
                    /*
                     * The rail is pinned, the way HealthZone pins its aside.
                     *
                     * An earlier note here said React Native has no `position: sticky` and left it
                     * at `self-start`. The first half is true and the conclusion was wrong: on the
                     * web the scroll port is not the document — `body` is `overflow: hidden` (see
                     * `app/+html.tsx`'s `ScrollViewStyleReset`) and the thing that actually scrolls
                     * is the `AppShell` ScrollView, `div[data-testid="marketplace-shell-content"]`.
                     * Sticky resolves against *that* box, whose top edge sits just under the top
                     * bar, so the design's `top:130px` is `top-0` here rather than a magic number.
                     *
                     * `web:` is what keeps native honest: NativeWind registers the variant on the
                     * web preset and not on the native one, so these classes are simply never
                     * generated for iOS or Android, which fall back to the ordinary flow. That is
                     * the mechanism, rather than the `Platform.OS` branch used elsewhere, because
                     * there is no structural difference to branch on — only a CSS behaviour one
                     * platform can honour.
                     *
                     * `self-start` stays: a stretched flex item fills the row and has no room to
                     * travel, so sticky would never fire without it.
                     *
                     * There is deliberately **no** `max-h` / `overflow-y-auto` pair here. It was
                     * added when the rail was a flat 1,700px wall that could not fit the port, and
                     * it bought a scrollbar inside a scrollbar — a second, nested track beside the
                     * page's own, which is not what the design does and not what anybody wants to
                     * aim at. Collapsing the groups into sections is what actually fixed the
                     * height; a rail that is five headers tall needs no scroller of its own.
                     */
                    <View
                        testID="meals-filter-rail"
                        className="w-full self-start lg:w-[264px] lg:shrink-0 web:sticky web:top-0"
                    >
                        {filterPanel}
                    </View>
                ) : null}

                {/*
                 * `min-w-0` is load-bearing. React Native Web gives a flex child its max-content
                 * width unless told otherwise, so without it the grid pushes the row wider than the
                 * viewport and the whole page scrolls sideways at 1024 — which `responsive.ltr`
                 * asserts against.
                 */}
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
                                            onAdd={() => {
                                                basket.add(meal);
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
                </Stack>
            </View>

            <MedicalDisclaimer />

            {basket.dialog}
        </Stack>
    );
}
