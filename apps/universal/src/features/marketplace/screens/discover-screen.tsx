import { Cascade } from '@healthy360/design-system';
import type { MarketplaceMeal } from '@healthy360/api-client/contracts';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Text as RNText, View } from 'react-native';

import { mealsFromPages, useMealsQuery } from '../../../data/catalogue-hooks.ts';
import {
    SHOWN_SHELVES,
    isShownShelf,
    shownCategory,
    shownItemTypes,
} from '../../catalogue/shown-shelves.ts';
import { useMealShelves } from '../../catalogue/use-meal-shelves.ts';
import { useBasketAdd } from '../../commerce/use-basket-add.tsx';
import { DiscoverSearchBar } from '../discover/discover-search-bar.tsx';
import { PickedForToday } from '../discover/picked-for-today.tsx';
import type { PickedCard, PickTint } from '../discover/picked-for-today.tsx';
import { PopularCarousel } from '../discover/popular-carousel.tsx';
import { ShopByTabs } from '../discover/shop-by-tabs.tsx';
import type { ShopByTab } from '../discover/shop-by-tabs.tsx';

/** How many dishes the carousel carries. */
const POPULAR_COUNT = 12;

/** Everything on the menu's shown shelves, best rated first — the carousel and the tiles read it. */
const POPULAR_FILTER = (() => {
    const shelf = shownCategory();
    return {
        itemTypes: shownItemTypes(['meal']),
        ...(shelf === undefined ? {} : { categorySlug: shelf }),
        sort: 'rating' as const,
        limit: 100,
    };
})();

/** "Picked for today": a shortcut to each shelf, in the design's order and colours. */
const SHELF_PICKS: readonly {
    readonly code: string;
    readonly headlineKey: string;
    readonly tint: PickTint;
}[] = [
    { code: 'meal', headlineKey: 'marketplace:discover.pickMeals', tint: 'orange' },
    { code: 'frozen', headlineKey: 'marketplace:discover.pickFrozen', tint: 'blue' },
    { code: 'sauce', headlineKey: 'marketplace:discover.pickSauces', tint: 'yellow' },
    { code: 'dressing', headlineKey: 'marketplace:discover.pickDressings', tint: 'green' },
    { code: 'beverage', headlineKey: 'marketplace:discover.pickBeverages', tint: 'pink' },
];

const shelfOf = (meal: MarketplaceMeal) => meal.publishedCategory?.code ?? null;

/**
 * Discover — the marketplace home, as the accepted shop design draws it, top to bottom:
 *
 * 1. **The search bar** — where the food goes, a search with a rolling hint, and go.
 * 2. **Shop by** — the menu's shelves as photo tiles; choosing one narrows the carousel.
 * 3. **Picked for today** — colour-coded shortcuts to the plans, each shelf and the kitchens.
 * 4. **Popular right now** — the best-rated dishes as a carousel that moves on by itself.
 *
 * It is the only home: `/` sends an anonymous visitor here and the landing kernel sends a signed-in
 * customer here. Add is on every card, for everybody — `use-basket-add.tsx` asks a visitor to sign
 * in first, and the add is made once they have.
 */
export function DiscoverScreen() {
    const { t } = useTranslation();
    const basket = useBasketAdd({ labelKey: 'marketplace:nav.discover', testID: 'discover' });
    const shelves = useMealShelves();
    const query = useMealsQuery(POPULAR_FILTER);
    const ranked = useMemo(() => mealsFromPages(query.data?.pages), [query.data]);
    const [shelf, setShelf] = useState<string | null>(null);

    // The shown shelves that hold something, in the menu's own order.
    const stocked = useMemo(
        () =>
            shelves.shelves
                .filter((item) => isShownShelf(item.code))
                .sort((a, b) => SHOWN_SHELVES.indexOf(a.code) - SHOWN_SHELVES.indexOf(b.code)),
        [shelves.shelves],
    );
    const firstOn = (code: string) => ranked.find((meal) => shelfOf(meal) === code);

    const tabs: readonly ShopByTab[] = [
        { code: null, label: t('marketplace:discover.allShelves'), meal: undefined },
        ...stocked.map((item) => ({ code: item.code, label: item.name, meal: firstOn(item.code) })),
    ];

    const cards: readonly PickedCard[] = [
        {
            key: 'plans',
            headlineKey: 'marketplace:discover.pickPlans',
            href: '/plans',
            tint: 'violet',
            meal: ranked[0],
        },
        ...SHELF_PICKS.filter((pick) => stocked.some((item) => item.code === pick.code)).map(
            (pick) => ({
                key: pick.code,
                headlineKey: pick.headlineKey,
                href: `/meals?category=${pick.code}`,
                tint: pick.tint,
                meal: firstOn(pick.code),
            }),
        ),
        {
            key: 'kitchens',
            headlineKey: 'marketplace:discover.pickKitchens',
            href: '/kitchens',
            tint: 'teal',
            meal: ranked[1],
        },
    ];

    const popular = (
        shelf === null ? ranked : ranked.filter((meal) => shelfOf(meal) === shelf)
    ).slice(0, POPULAR_COUNT);

    return (
        <View testID="discover-screen" className="relative flex-col pb-11">
            {/* The design's soft shapes behind the page. */}
            <View
                aria-hidden
                pointerEvents="none"
                className="absolute -start-40 -top-28 h-[520px] w-[520px] rounded-full bg-surface-brand-subtle opacity-60"
            />
            <View
                aria-hidden
                pointerEvents="none"
                className="absolute -end-44 top-[300px] h-[460px] w-[460px] rounded-full bg-tint-yellow opacity-50"
            />

            {/* The page's name, for a screen reader; the design shows the search bar instead. */}
            <RNText role="heading" aria-level={1} className="absolute h-px w-px overflow-hidden">
                {t('marketplace:discover.pageTitle')}
            </RNText>

            <Cascade space="none">
                <DiscoverSearchBar testID="discover-search" />
                <ShopByTabs
                    testID="discover-shelves"
                    tabs={tabs}
                    selected={shelf}
                    onSelect={setShelf}
                />
                <PickedForToday testID="discover-picks" cards={cards} />
                <PopularCarousel
                    testID="discover-popular"
                    meals={popular}
                    onAdd={(meal) => {
                        basket.add(meal);
                    }}
                />
            </Cascade>

            {basket.dialog}
        </View>
    );
}
