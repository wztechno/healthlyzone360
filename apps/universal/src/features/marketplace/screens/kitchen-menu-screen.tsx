import { Icon, cx } from '@healthy360/design-system';
import type { MealFilter } from '@healthy360/api-client/contracts';
import { neutral } from '@healthy360/design-tokens';
import { KitchenId } from '@healthy360/domain-types';
import type { MealType } from '@healthy360/domain-types';
import { useFormatter } from '@healthy360/i18n';
import { useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, Text as RNText, TextInput, View } from 'react-native';

import { useBasketAdd } from '../../commerce/use-basket-add.tsx';
import { mealsFromPages, useMealsQuery } from '../../../data/catalogue-hooks.ts';
import { useKitchenQuery } from '../../../data/marketplace-hooks.ts';
import { EntityImage } from '../../../media/entity-image.tsx';
import { useNavigateUp, useRememberQuery } from '../../../navigation/use-return-to.ts';
import { BackPill } from '../../../ui/back-pill.tsx';
import { MenuGrid } from '../../catalogue/menu-grid.tsx';
import { MenuMealCard } from '../../catalogue/menu-meal-card.tsx';
import { useMarketplaceFilters, useSearchDraft } from '../filter-bar.tsx';
import { kitchenWhere } from '../kitchen-card-facts.ts';
import { QueryStates } from '../query-states.tsx';
import { hoursToday } from '../storefront-facts.ts';
import { OTHER_SHELF, menuShelves } from '../storefront/storefront-menu.ts';

const GROUP_KEYS = ['itemType', 'category', 'mealType'] as const;

/** The largest page the marketplace serves — the shelf chips count the whole menu. */
const SHELF_PAGE = 100;

export interface KitchenMenuScreenProps {
    readonly kitchenId: string | undefined;
}

/**
 * A kitchen's searchable menu, as the accepted shop board draws it: the way back to the kitchen,
 * its photograph with "Menu" and where it cooks, today's hours, then one bar — a round search field
 * and the kitchen's shelves as chips with their counts — and the dishes four across on the menu's
 * own card (`MenuMealCard`), with "Load more" under them.
 *
 * The storefront's Menu tab lists the same dishes by shelf and links here as "Search this menu".
 * The way back goes *up*, not forward (browse-05, browse-12): Back when the storefront is the entry
 * below — its tab and shelf as they were — and otherwise the storefront with the query it was last
 * shown with.
 *
 * Every filter is in the URL. `?itemType=` and `?mealType=` are still honoured for a shared link,
 * though no control draws them: the board's bar is the search and the shelves.
 */
export function KitchenMenuScreen({ kitchenId }: KitchenMenuScreenProps) {
    const { t } = useTranslation();
    const formatter = useFormatter();
    const basket = useBasketAdd({ labelKey: 'marketplace:nav.kitchens', testID: 'kitchen-menu' });
    const router = useRouter();
    const navigateUp = useNavigateUp();
    const filters = useMarketplaceFilters(GROUP_KEYS);
    const search = useSearchDraft(filters);
    const [searchFocused, setSearchFocused] = useState(false);
    useRememberQuery();

    // An id or a slug: the server takes either. The menu filter needs the id the kitchen answers with.
    const requested =
        kitchenId === undefined || kitchenId === '' ? null : KitchenId.unsafe(kitchenId);
    const kitchen = useKitchenQuery(requested);
    const parsed =
        kitchen.data?.id ?? (kitchenId === undefined ? null : KitchenId.safeParse(kitchenId));

    const { query: searchTerm, selected: selectedFilters } = filters;
    const category = selectedFilters['category']?.[0];
    const filter = useMemo<MealFilter | undefined>(() => {
        if (parsed === null) return undefined;
        const mealTypes = (selectedFilters['mealType'] ?? []) as readonly MealType[];
        const itemTypes = (selectedFilters['itemType'] ?? []) as MealFilter['itemTypes'];
        return {
            kitchenIds: [parsed],
            ...(searchTerm === '' ? {} : { query: searchTerm }),
            ...(itemTypes === undefined || itemTypes.length === 0 ? {} : { itemTypes }),
            ...(category === undefined ? {} : { categorySlug: category }),
            ...(mealTypes.length === 0 ? {} : { mealTypes }),
        };
    }, [parsed, searchTerm, selectedFilters, category]);

    const menu = useMealsQuery(filter, parsed !== null);
    const meals = mealsFromPages(menu.data?.pages);

    // The whole menu, once, for the shelf chips and their counts.
    const whole = useMealsQuery(
        parsed === null ? undefined : { kitchenIds: [parsed], limit: SHELF_PAGE },
        parsed !== null,
    );
    const everything = mealsFromPages(whole.data?.pages);
    const shelves = useMemo(
        () => menuShelves(everything).filter((shelf) => shelf.key !== OTHER_SHELF),
        [everything],
    );

    const today = kitchen.data === undefined ? null : hoursToday(kitchen.data);
    const where = kitchen.data === undefined ? '' : kitchenWhere(kitchen.data, t);

    const chip = (key: string | null, label: string, count: number) => {
        const on = (category ?? null) === key;
        const photo =
            key === null
                ? undefined
                : everything.find((meal) => meal.publishedCategory?.code === key);
        return (
            <Pressable
                key={key ?? 'all'}
                testID={`kitchen-menu-shelf-${key ?? 'all'}`}
                role="radio"
                accessibilityRole="radio"
                aria-checked={on}
                accessibilityState={{ checked: on, selected: on }}
                onPress={() => {
                    filters.select('category', key);
                }}
                className={cx(
                    'h-11 flex-row items-center gap-2 rounded-full border-[1.5px] pe-3.5 ps-1.5 transition duration-normal ease-standard',
                    on
                        ? 'border-content-primary bg-content-primary'
                        : 'border-stroke bg-surface-raised hover:border-surface-brand',
                )}
            >
                <View className="h-8 w-8 items-center justify-center overflow-hidden rounded-full bg-surface-brand-subtle">
                    {photo === undefined ? (
                        <Icon
                            name="layoutGrid"
                            size="sm"
                            className="text-content-on-brand-subtle"
                        />
                    ) : (
                        <EntityImage
                            assetId={photo.imagePlaceholderId}
                            photoUrl={photo.photoUrl}
                            seed={photo.slug}
                            label={label}
                            decorative
                            flush
                            className="h-8 w-8"
                        />
                    )}
                </View>
                <RNText
                    className={cx(
                        'text-sm font-semibold',
                        on ? 'text-surface-base' : 'text-content-primary',
                    )}
                >
                    {label}
                </RNText>
                <RNText
                    className={cx(
                        'text-xs font-bold tabular-nums',
                        on ? 'text-surface-base opacity-70' : 'text-content-secondary',
                    )}
                >
                    {formatter.formatNumber(count)}
                </RNText>
            </Pressable>
        );
    };

    return (
        <View testID="kitchen-menu-screen" className="flex-col pb-10 pt-1">
            <BackPill
                testID="kitchen-menu-crumb-kitchen"
                label={kitchen.data?.name ?? t('marketplace:kitchen.loading')}
                onPress={() => {
                    if (parsed !== null) navigateUp(`/kitchens/${String(parsed)}`);
                }}
            />

            <View className="mt-4 flex-row flex-wrap items-center gap-3.5">
                <View className="h-14 w-14 overflow-hidden rounded-2xl">
                    <EntityImage
                        assetId={kitchen.data?.imagePlaceholderId}
                        seed={kitchen.data?.slug ?? 'kitchen'}
                        label={kitchen.data?.name ?? ''}
                        decorative
                        flush
                        className="h-full w-full"
                    />
                </View>
                <View className="min-w-0 flex-1 flex-col">
                    <RNText
                        testID="kitchen-menu-title"
                        role="heading"
                        aria-level={1}
                        className="font-display text-3xl font-bold tracking-display text-content-primary text-start"
                    >
                        {t('marketplace:menu.title')}
                    </RNText>
                    <RNText className="text-sm font-semibold text-content-secondary text-start">
                        {[kitchen.data?.name ?? '', where]
                            .filter((part) => part !== '')
                            .join(t('marketplace:kitchens.areaSeparator'))}
                    </RNText>
                </View>
                {kitchen.data === undefined ? null : (
                    <View className="h-8 flex-row items-center gap-1.5 rounded-full bg-surface-brand-subtle px-3">
                        <View
                            className={cx(
                                'h-2 w-2 rounded-full',
                                today === null ? 'bg-stroke' : 'bg-surface-brand',
                            )}
                        />
                        <RNText className="text-sm font-bold tabular-nums text-content-on-brand-subtle">
                            {today === null
                                ? t('marketplace:storefront.closedToday')
                                : t('marketplace:storefront.openToday', {
                                      opensAt: today.opensAt,
                                      closesAt: today.closesAt,
                                  })}
                        </RNText>
                    </View>
                )}
            </View>

            <View
                testID="kitchen-menu-filter"
                className="mt-[18px] flex-row flex-wrap items-center gap-2.5"
            >
                <View
                    className={cx(
                        'h-[52px] min-w-[240px] flex-1 basis-[360px] flex-row items-center gap-2.5 rounded-full border-[1.5px] bg-surface-raised pe-2 ps-4',
                        searchFocused ? 'border-surface-brand' : 'border-stroke',
                    )}
                >
                    <Icon
                        name="search"
                        size="sm"
                        className={
                            searchFocused
                                ? 'text-content-on-brand-subtle'
                                : 'text-content-secondary'
                        }
                    />
                    <TextInput
                        testID="kitchen-menu-search-input"
                        accessibilityLabel={t('marketplace:menu.searchLabel')}
                        placeholder={t('marketplace:menu.searchLabel')}
                        placeholderTextColor={neutral[600]}
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
                        className="h-full min-w-0 flex-1 text-base text-content-primary text-start web:outline-none"
                    />
                    {search.draft === '' ? null : (
                        <Pressable
                            testID="kitchen-menu-search-clear"
                            role="button"
                            accessibilityRole="button"
                            accessibilityLabel={t('marketplace:menu.clearSearch')}
                            onPress={() => {
                                search.setDraft('');
                                filters.setQuery('');
                            }}
                            className="h-9 w-9 items-center justify-center rounded-full bg-surface-base"
                        >
                            <Icon name="close" size="sm" className="text-content-secondary" />
                        </Pressable>
                    )}
                </View>
                <View
                    role="radiogroup"
                    aria-label={t('marketplace:filters.category')}
                    className="flex-row flex-wrap gap-2"
                >
                    {chip(null, t('marketplace:storefront.menu.all'), everything.length)}
                    {shelves.map((shelf) =>
                        chip(
                            shelf.key,
                            shelf.name ?? t('marketplace:storefront.menu.other'),
                            shelf.count,
                        ),
                    )}
                </View>
            </View>

            <View className="mt-[18px]">
                <QueryStates
                    query={menu}
                    isEmpty={meals.length === 0}
                    emptyTitle={t('marketplace:menu.emptyTitle')}
                    emptyBody={t('marketplace:menu.emptyBody')}
                    emptyActions={
                        filters.isFiltered ? (
                            <Pressable
                                testID="kitchen-menu-empty-clear"
                                role="button"
                                accessibilityRole="button"
                                onPress={() => {
                                    search.setDraft('');
                                    filters.clear();
                                }}
                                className="h-11 items-center justify-center rounded-full border border-stroke bg-surface-raised px-[18px]"
                            >
                                <RNText className="text-sm font-semibold text-content-primary">
                                    {t('marketplace:menu.clearSearch')}
                                </RNText>
                            </Pressable>
                        ) : undefined
                    }
                    testID="kitchen-menu"
                >
                    <View className="flex-col gap-7">
                        <MenuGrid
                            testID="kitchen-menu-grid"
                            gap={20}
                            entranceKey={JSON.stringify(filter ?? null)}
                        >
                            {meals.map((meal) => (
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

                        <View className="items-center gap-2.5">
                            <RNText
                                testID={menu.hasNextPage ? undefined : 'kitchen-menu-all-loaded'}
                                className="text-sm font-semibold tabular-nums text-content-secondary"
                            >
                                {menu.hasNextPage
                                    ? t('marketplace:menu.showing', {
                                          count: meals.length,
                                          formattedCount: formatter.formatNumber(meals.length),
                                      })
                                    : t('marketplace:menu.allLoaded')}
                            </RNText>
                            {menu.hasNextPage ? (
                                <Pressable
                                    testID="kitchen-menu-load-more"
                                    role="button"
                                    accessibilityRole="button"
                                    disabled={menu.isFetchingNextPage}
                                    accessibilityState={{ disabled: menu.isFetchingNextPage }}
                                    onPress={() => {
                                        void menu.fetchNextPage();
                                    }}
                                    className="h-12 items-center justify-center rounded-full border border-stroke bg-surface-raised px-7 hover:border-surface-brand"
                                >
                                    <RNText className="text-base font-semibold text-content-primary">
                                        {menu.isFetchingNextPage
                                            ? t('marketplace:menu.loadingMore')
                                            : t('marketplace:menu.loadMore')}
                                    </RNText>
                                </Pressable>
                            ) : null}
                        </View>
                    </View>
                </QueryStates>
            </View>

            {basket.dialog}
        </View>
    );
}
