import type { MarketplaceMeal } from '@healthy360/api-client/contracts';
import { useFormatter } from '@healthy360/i18n';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { Eyebrow } from '../../../ui/eyebrow.tsx';
import { PillChip } from '../../../ui/pill-chip.tsx';

import { StorefrontMealRow } from './storefront-meal-row.tsx';
import { OTHER_SHELF, isOnShelf, menuShelves } from './storefront-menu.ts';

/** The "every shelf" chip. Not a category code the platform can mint — codes are lower-case words. */
const ALL = '*';

/**
 * The storefront's Menu tab — HealthZone `§isStorefront` `storeIsMenu`: a row of shelf chips with
 * their counts and the dish count opposite, then the dishes two across.
 *
 * ## The chips are the kitchen's own shelves
 *
 * The design's chips are the menu's categories, each with how many dishes it holds — "All · 12",
 * "Bowls · 5". Here they are the `publishedCategory` shelves this kitchen actually files listings
 * under, counted over the whole menu — the screen loads every page before this renders, so
 * "Bowls · 5" is five, not "five of the first twenty-five". A listing the kitchen never filed lands
 * on a trailing "Other" chip so the shelves always add up to "All".
 *
 * ## The count's second clause
 *
 * The design's eyebrow reads "12 DISHES · COOKED 11 AM". Nothing publishes when a menu was cooked,
 * so the clause is the kitchen's same-day cut-off where it publishes one — "12 DISHES · ORDER BY
 * 11:30" — and absent where it does not.
 *
 * ## Two across, one below
 *
 * `basis-[45%]` with a `min-w`: two cells and the gap fit a row and three cannot, and below about
 * 600 points the minimum width forces one column — the design's `auto-fill, minmax(320px, 1fr)`
 * without a breakpoint.
 */
export interface StorefrontMenuTabProps {
    /** The whole menu — every page. */
    readonly meals: readonly MarketplaceMeal[];
    /** Today's same-day cut-off, `HH:mm`, or `null` when the kitchen publishes none. */
    readonly cutOff: string | null;
    readonly onOpen: (meal: MarketplaceMeal) => void;
    readonly onAdd: (meal: MarketplaceMeal) => void;
}

export function StorefrontMenuTab({ meals, cutOff, onOpen, onAdd }: StorefrontMenuTabProps) {
    const { t } = useTranslation();
    const formatter = useFormatter();
    const [shelf, setShelf] = useState<string>(ALL);

    const shelves = useMemo(() => menuShelves(meals), [meals]);
    const visible = useMemo(
        () => (shelf === ALL ? meals : meals.filter((meal) => isOnShelf(meal, shelf))),
        [meals, shelf],
    );

    const chip = (key: string, label: string, count: number) => (
        <PillChip
            key={key}
            size="sm"
            floor="coarse"
            testID={`kitchen-shelf-${key === ALL ? 'all' : key}`}
            label={t('marketplace:storefront.menu.chip', {
                label,
                count: formatter.formatNumber(count),
            })}
            selected={shelf === key}
            onPress={() => {
                setShelf(key);
            }}
        />
    );

    const count = formatter.formatNumber(visible.length);

    return (
        <View className="flex-col gap-4" testID="kitchen-menu-tab">
            <View className="flex-row flex-wrap items-center justify-between gap-3">
                <View
                    testID="kitchen-shelves"
                    role="group"
                    aria-label={t('marketplace:storefront.menu.shelvesLabel')}
                    className="min-w-0 shrink flex-row flex-wrap gap-1.5"
                >
                    {chip(ALL, t('marketplace:storefront.menu.all'), meals.length)}
                    {shelves.map((entry) =>
                        chip(
                            entry.key,
                            entry.key === OTHER_SHELF || entry.name === null
                                ? t('marketplace:storefront.menu.other')
                                : entry.name,
                            entry.count,
                        ),
                    )}
                </View>

                <Eyebrow testID="kitchen-menu-count" className="tabular-nums">
                    {cutOff === null
                        ? t('marketplace:storefront.menu.count', {
                              count: visible.length,
                              formattedCount: count,
                          })
                        : t('marketplace:storefront.menu.countCutOff', {
                              count: visible.length,
                              formattedCount: count,
                              time: cutOff,
                          })}
                </Eyebrow>
            </View>

            <View testID="kitchen-menu-rows" className="flex-row flex-wrap gap-3">
                {visible.map((meal) => (
                    <View key={meal.id} className="min-w-[280px] flex-1 grow basis-[45%]">
                        <StorefrontMealRow
                            meal={meal}
                            onOpen={() => {
                                onOpen(meal);
                            }}
                            onAdd={() => {
                                onAdd(meal);
                            }}
                        />
                    </View>
                ))}
            </View>
        </View>
    );
}
