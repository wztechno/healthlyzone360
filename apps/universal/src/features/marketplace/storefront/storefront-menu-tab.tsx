import { Icon, cx, useBreakpoint } from '@healthy360/design-system';
import type { MarketplaceMeal } from '@healthy360/api-client/contracts';
import { useFormatter } from '@healthy360/i18n';
import { useMemo } from 'react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, Text as RNText, ScrollView, View } from 'react-native';

import { EntityImage } from '../../../media/entity-image.tsx';
import { MenuMealCard } from '../../catalogue/menu-meal-card.tsx';
import { TINT_BORDER, TINT_FILL, TINT_INK, shelfTint } from '../../catalogue/shelf-tints.ts';

import { OTHER_SHELF, isOnShelf, menuShelves } from './storefront-menu.ts';

/** The "every shelf" tile. Not a category code the platform can mint — codes are lower-case words. */
const ALL = '*';

/**
 * The storefront's Menu tab, as the accepted shop board draws it: the kitchen's shelves as colour
 * tiles with a photograph and a count, "Search this menu", then the dishes three across on the
 * menu's own card (`MenuMealCard`, compact).
 *
 * ## The tiles are the kitchen's own shelves
 *
 * The `publishedCategory` shelves this kitchen files listings under, counted over the whole menu —
 * the screen loads every page before this renders, so "Bowls · 5" is five, not "five of the first
 * twenty-five". A listing the kitchen never filed lands on a trailing "Other" tile so the shelves
 * always add up to "All".
 *
 * ## The count's second clause
 *
 * The kitchen's same-day cut-off where it publishes one — "12 DISHES · ORDER BY 11:30" — and absent
 * where it does not.
 */
export interface StorefrontMenuTabProps {
    /** The whole menu — every page. */
    readonly meals: readonly MarketplaceMeal[];
    /** Today's same-day cut-off, `HH:mm`, or `null` when the kitchen publishes none. */
    readonly cutOff: string | null;
    /**
     * The chosen shelf — `null` for all of them. The screen holds it in `?shelf=` (browse-07): this
     * panel unmounts on every tab switch and with the page on the way to a dish, so a shelf held
     * here was forgotten each time. A shelf this menu does not stock reads as "All".
     */
    readonly shelf: string | null;
    readonly onShelfChange: (shelf: string | null) => void;
    readonly onOpen: (meal: MarketplaceMeal) => void;
    readonly onAdd: (meal: MarketplaceMeal) => void;
    /** Opens the kitchen's searchable menu, which carries the search box this tab does not. */
    readonly onSearch: () => void;
}

export function StorefrontMenuTab({
    meals,
    cutOff,
    shelf: requestedShelf,
    onShelfChange,
    onOpen,
    onAdd,
    onSearch,
}: StorefrontMenuTabProps) {
    const { t } = useTranslation();
    const formatter = useFormatter();
    // Shop · Kitchens, phone board: one-line shelf chips that scroll, two cards to a row.
    const phone = !useBreakpoint().atLeast('md');

    const shelves = useMemo(() => menuShelves(meals), [meals]);
    const shelf =
        requestedShelf !== null && shelves.some((entry) => entry.key === requestedShelf)
            ? requestedShelf
            : ALL;
    const visible = useMemo(
        () => (shelf === ALL ? meals : meals.filter((meal) => isOnShelf(meal, shelf))),
        [meals, shelf],
    );

    const tile = (key: string, label: string, count: number) => {
        const on = shelf === key;
        const tint = key === ALL || key === OTHER_SHELF ? 'neutral' : shelfTint(key);
        const photo = key === ALL ? undefined : meals.find((meal) => isOnShelf(meal, key));
        const countText = formatter.formatNumber(count);
        return (
            <Pressable
                key={key}
                testID={`kitchen-shelf-${key === ALL ? 'all' : key}`}
                role="radio"
                accessibilityRole="radio"
                aria-checked={on}
                accessibilityState={{ checked: on, selected: on }}
                accessibilityLabel={t('marketplace:storefront.menu.chip', {
                    label,
                    count: countText,
                })}
                onPress={() => {
                    onShelfChange(key === ALL ? null : key);
                }}
                className={cx(
                    'flex-row items-center border-2 transition duration-normal ease-standard hover:-translate-y-0.5',
                    phone
                        ? 'h-[52px] gap-2 rounded-2xl pe-3 ps-[5px]'
                        : 'h-[68px] min-w-[150px] flex-1 basis-[22%] gap-2.5 rounded-[18px] pe-3 ps-2',
                    TINT_FILL[tint],
                    on ? TINT_BORDER[tint] : 'border-transparent',
                )}
            >
                <View
                    className={cx(
                        'items-center justify-center overflow-hidden',
                        phone ? 'h-10 w-10 rounded-[11px]' : 'h-[50px] w-[50px] rounded-xl',
                    )}
                >
                    {photo === undefined ? (
                        <Icon name="layoutGrid" className={TINT_INK[tint]} />
                    ) : (
                        <EntityImage
                            assetId={photo.imagePlaceholderId}
                            photoUrl={photo.photoUrl}
                            seed={photo.slug}
                            label={label}
                            decorative
                            flush
                            className={phone ? 'h-10 w-10' : 'h-[50px] w-[50px]'}
                        />
                    )}
                </View>
                {phone ? (
                    <RNText
                        numberOfLines={1}
                        className={cx('font-display text-sm font-bold text-start', TINT_INK[tint])}
                    >
                        {t('marketplace:storefront.menu.chipShort', { label, count: countText })}
                    </RNText>
                ) : (
                    <View className="min-w-0 flex-1 flex-col">
                        <RNText
                            numberOfLines={1}
                            className={cx(
                                'font-display text-base font-bold text-start',
                                TINT_INK[tint],
                            )}
                        >
                            {label}
                        </RNText>
                        <RNText
                            className={cx(
                                'text-xs font-medium tabular-nums opacity-85 text-start',
                                TINT_INK[tint],
                            )}
                        >
                            {t('catalogue:filters.shelfCount', { count, n: countText })}
                        </RNText>
                    </View>
                )}
            </Pressable>
        );
    };

    const count = formatter.formatNumber(visible.length);

    return (
        <View className="flex-col gap-4" testID="kitchen-menu-tab">
            <ShelvesFrame phone={phone}>
                <View
                    testID="kitchen-shelves"
                    role="radiogroup"
                    aria-label={t('marketplace:storefront.menu.shelvesLabel')}
                    className={cx('flex-row gap-2.5', phone ? null : 'grow flex-wrap')}
                >
                    {tile(ALL, t('marketplace:storefront.menu.all'), meals.length)}
                    {shelves.map((entry) =>
                        tile(
                            entry.key,
                            entry.key === OTHER_SHELF || entry.name === null
                                ? t('marketplace:storefront.menu.other')
                                : entry.name,
                            entry.count,
                        ),
                    )}
                </View>
            </ShelvesFrame>

            <View className="flex-row flex-wrap items-center justify-between gap-3">
                <RNText
                    testID="kitchen-menu-count"
                    className="text-xs font-semibold uppercase tracking-wider tabular-nums text-content-secondary"
                >
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
                </RNText>
                {/*
                 * The way into the searchable menu, named for what it is (browse-12). "Start an
                 * order" used to open it, and found a second copy of these same dishes.
                 */}
                <Pressable
                    testID="kitchen-menu-search"
                    role="link"
                    accessibilityRole="link"
                    onPress={onSearch}
                    className="min-h-touch flex-row items-center gap-2 rounded-full px-3 hover:bg-surface-brand-subtle"
                >
                    <Icon name="search" size="sm" className="text-content-on-brand-subtle" />
                    <RNText className="text-sm font-semibold text-content-on-brand-subtle">
                        {t('marketplace:menu.searchLabel')}
                    </RNText>
                </Pressable>
            </View>

            <View
                testID="kitchen-menu-rows"
                className={cx('flex-row flex-wrap', phone ? 'gap-2.5' : 'gap-4')}
            >
                {visible.map((meal) => (
                    <View
                        key={meal.id}
                        className={
                            phone
                                ? 'w-[48%] grow flex-col'
                                : 'min-w-[220px] flex-1 grow basis-[30%] flex-col'
                        }
                    >
                        <MenuMealCard
                            compact
                            phone={phone}
                            testID={`storefront-menu-${meal.slug}`}
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

/** A phone's shelves scroll sideways from the screen's edge; a desk's wrap into rows. */
function ShelvesFrame({
    phone,
    children,
}: {
    readonly phone: boolean;
    readonly children: ReactNode;
}) {
    return phone ? (
        <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            className="-mx-4"
            contentContainerClassName="px-4"
        >
            {children}
        </ScrollView>
    ) : (
        <>{children}</>
    );
}
