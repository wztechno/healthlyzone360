import {
    Button,
    Drawer,
    Icon,
    Popover,
    Select,
    cx,
    useBreakpoint,
} from '@healthy360/design-system';
import type { RangeValue } from '@healthy360/design-system';
import type { CurrencyCode, DietClassification } from '@healthy360/domain-types';
import { useFormatter } from '@healthy360/i18n';
import type { TFunction } from 'i18next';
import { useState } from 'react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, ScrollView, Text as RNText, View } from 'react-native';

import { PillChip } from '../../ui/pill-chip.tsx';
import type { MarketplaceFilterState } from '../marketplace/filter-bar.tsx';
import { FilterRows } from './filter-rows.tsx';
import { MealRangeFilters } from './meal-filters.tsx';
import type { MealRangeKey, MealRangeState } from './meal-filters.tsx';
import { MENU_SORTS } from './meal-readings.ts';
import type { MenuSort } from './meal-readings.ts';
import { isShownShelf } from './shown-shelves.ts';
import type { MealShelves } from './use-meal-shelves.ts';

/**
 * The meals catalogue's filters, without a panel: the shelves as a row of tabs, then one row of
 * menu buttons — Diet, Calories, Allergies, Kitchen, More — and the sort.
 *
 * ## Why buttons that open, rather than a rail
 *
 * The rail held one group of each kind and hid the rest in a drawer, so the filter somebody
 * actually arrived with ("nothing with sesame") was two presses deep and the grid lost a column to
 * controls nobody was touching. Here every group is one press away, the grid has the width, and a
 * button says how many of its filters are on ("Diet · 2"). What is applied is also listed under the
 * bar as removable chips by the screen, so nothing narrowing the grid is ever out of sight.
 *
 * Every choice writes the URL the moment it is made — no Apply — exactly as the rail did.
 *
 * ## One content, two containers
 *
 * From `lg` a menu is the design system's `Popover`, anchored to its button. Below `lg` the buttons
 * scroll sideways, where an anchored panel would be clipped by the scroller, so the same content
 * opens in a bottom `Drawer` instead. The content is written once and handed to either.
 */

/** Every diet a shopper filters by — `omnivore` filters nothing anybody wants. */
export const MENU_DIETS: readonly DietClassification[] = [
    'high_protein',
    'vegetarian',
    'vegan',
    'gluten_free',
    'pescatarian',
    'low_carb',
    'mediterranean',
    'dairy_free',
    'nut_free',
];

/**
 * The fourteen allergen groups food-labelling regimes in the EU, the UK and the GCC require to be
 * declared. Published regulatory vocabulary, not fixture data.
 */
export const ALLERGEN_CODES: readonly string[] = [
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

/** The ranges under "More" — calories have a button of their own. */
export const MORE_RANGE_KEYS: readonly MealRangeKey[] = [
    'protein',
    'carbohydrate',
    'fat',
    'price',
    'preparationMinutes',
];

/**
 * The "every shelf" tab. Not a category code — the platform's codes are lower-case words — so it
 * can never collide with one in the URL; pressing it clears the parameter rather than writing this.
 */
const ALL_SHELVES = 'all';

/** Whether a range says anything. */
function rangeSet(value: RangeValue): boolean {
    return value.min !== null || value.max !== null;
}

/* ── the shelves, as tabs ────────────────────────────────────────────────────────────────────── */

export function CategoryTabs({
    filters,
    shelves,
}: {
    readonly filters: MarketplaceFilterState;
    readonly shelves: MealShelves;
}) {
    const { t } = useTranslation();
    const formatter = useFormatter();
    // A hidden shelf (`shown-shelves.ts`) is not drawn even when a link selected it.
    const selected = (filters.selected['category'] ?? []).filter(isShownShelf)[0] ?? ALL_SHELVES;

    const tabs: readonly { value: string; label: string; count: number | null }[] = [
        { value: ALL_SHELVES, label: t('catalogue:filters.allMeals'), count: shelves.total },
        ...shelves.shelves.map((shelf) => ({
            value: shelf.code,
            label: shelf.name,
            count: shelf.count,
        })),
        // A shelf a shared link selected that the menu does not stock is still drawn, lit, so the
        // filter that emptied the grid is visible and can be undone.
        ...(selected !== ALL_SHELVES && !shelves.shelves.some((shelf) => shelf.code === selected)
            ? [{ value: selected, label: selected, count: null }]
            : []),
    ];

    return (
        <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            testID="meals-filter-category"
            contentContainerClassName="flex-row items-center gap-2"
        >
            <View
                role="radiogroup"
                aria-label={t('catalogue:filters.category')}
                className="flex-row items-center gap-2"
            >
                {tabs.map((tab) => {
                    const on = tab.value === selected;
                    const countText = tab.count === null ? null : formatter.formatNumber(tab.count);
                    return (
                        <Pressable
                            key={tab.value}
                            testID={`meals-filter-category-${tab.value}`}
                            role="radio"
                            accessibilityRole="radio"
                            aria-checked={on}
                            accessibilityState={{ checked: on, selected: on }}
                            accessibilityLabel={
                                countText === null
                                    ? tab.label
                                    : t('catalogue:filters.optionWithCount', {
                                          label: tab.label,
                                          count: countText,
                                      })
                            }
                            onPress={() => {
                                // One shelf at a time — the API takes one `category_slug`. "All" lifts it.
                                filters.select(
                                    'category',
                                    tab.value === ALL_SHELVES ? null : tab.value,
                                );
                            }}
                            className={cx(
                                'min-h-touch flex-row items-center gap-2 rounded-full border px-4',
                                on
                                    ? 'border-surface-brand bg-surface-brand-subtle'
                                    : 'border-stroke-strong bg-surface-raised hover:bg-surface-sunken',
                            )}
                        >
                            <RNText
                                numberOfLines={1}
                                className={cx(
                                    'text-sm font-medium',
                                    on ? 'text-content-on-brand-subtle' : 'text-content-primary',
                                )}
                            >
                                {tab.label}
                            </RNText>
                            {countText === null ? null : (
                                <RNText
                                    testID={`meals-filter-category-${tab.value}-count`}
                                    aria-hidden
                                    accessibilityElementsHidden
                                    importantForAccessibility="no"
                                    className={cx(
                                        'text-xs tabular-nums',
                                        on
                                            ? 'text-content-on-brand-subtle'
                                            : 'text-content-secondary',
                                    )}
                                >
                                    {countText}
                                </RNText>
                            )}
                        </Pressable>
                    );
                })}
            </View>
        </ScrollView>
    );
}

/* ── one menu button ─────────────────────────────────────────────────────────────────────────── */

interface FilterMenuProps {
    readonly label: string;
    /** How many of this menu's filters are on — shown on the button. */
    readonly count: number;
    /** Lifts this menu's filters; offered only while any is on. */
    readonly onClear: () => void;
    readonly wide: boolean;
    readonly align?: 'start' | 'end' | undefined;
    readonly testID: string;
    readonly children: ReactNode;
}

function FilterMenu({ label, count, onClear, wide, align, testID, children }: FilterMenuProps) {
    const { t } = useTranslation();
    const [open, setOpen] = useState(false);
    const text = count === 0 ? label : t('catalogue:filters.menuCount', { label, n: count });

    const body = (
        <View className="flex-col gap-3">
            {children}
            {count === 0 ? null : (
                <View className="self-start">
                    <Button
                        testID={`${testID}-clear`}
                        variant="quiet"
                        size="sm"
                        label={t('catalogue:filters.clearGroup')}
                        onPress={onClear}
                    />
                </View>
            )}
        </View>
    );

    if (wide) {
        return (
            <Popover
                testID={testID}
                triggerVariant="button"
                triggerIcon="chevronDown"
                triggerIconPosition="end"
                triggerLabel={text}
                triggerText={text}
                title={label}
                align={align}
                className="z-auto"
            >
                {body}
            </Popover>
        );
    }

    return (
        <>
            <Pressable
                testID={`${testID}-trigger`}
                role="button"
                accessibilityRole="button"
                accessibilityLabel={text}
                aria-haspopup="dialog"
                onPress={() => {
                    setOpen(true);
                }}
                className="min-h-touch flex-row items-center gap-1.5 rounded-lg border border-stroke bg-surface-raised px-3.5"
            >
                <RNText numberOfLines={1} className="text-sm font-medium text-content-primary">
                    {text}
                </RNText>
                <Icon name="chevronDown" size="sm" className="text-content-secondary" />
            </Pressable>
            <Drawer
                testID={`${testID}-panel`}
                open={open}
                onClose={() => {
                    setOpen(false);
                }}
                placement="bottom"
                title={label}
                footer={
                    <Button
                        testID={`${testID}-done`}
                        block
                        label={t('catalogue:meals.moreFiltersDone')}
                        onPress={() => {
                            setOpen(false);
                        }}
                    />
                }
            >
                {body}
            </Drawer>
        </>
    );
}

/* ── the bar ─────────────────────────────────────────────────────────────────────────────────── */

export interface MealFilterBarProps {
    readonly filters: MarketplaceFilterState;
    readonly ranges: MealRangeState;
    /** Fetched marketplace kitchens, which is the only thing that knows a kitchen id's name. */
    readonly kitchens: readonly { readonly id: unknown; readonly name: string }[];
    readonly currency: CurrencyCode;
    readonly sort: MenuSort;
    readonly onSort: (sort: MenuSort) => void;
}

export function MealFilterBar({
    filters,
    ranges,
    kitchens,
    currency,
    sort,
    onSort,
}: MealFilterBarProps) {
    const { t } = useTranslation();
    const wide = useBreakpoint().atLeast('lg');
    const selectedDiets = filters.selected['diet'] ?? [];
    const selectedExclusions = filters.selected['exclude'] ?? [];
    const selectedKitchens = filters.selected['kitchen'] ?? [];
    const moreCount = MORE_RANGE_KEYS.filter((key) => rangeSet(ranges.values[key])).length;

    const clearList = (group: 'diet' | 'exclude' | 'kitchen') => {
        filters.select(group, null);
    };
    const clearRanges = (keys: readonly MealRangeKey[]) => {
        for (const key of keys) ranges.set(key, { min: null, max: null });
    };

    const pills = (
        group: 'diet' | 'exclude',
        values: readonly string[],
        selected: readonly string[],
        labelOf: (value: string) => string,
    ) => (
        <View className="flex-row flex-wrap gap-2">
            {values.map((value) => {
                const on = selected.includes(value);
                return (
                    <PillChip
                        key={value}
                        size="sm"
                        floor="coarse"
                        testID={`meals-filter-${group}-${value}`}
                        label={labelOf(value)}
                        selected={on}
                        onPress={() => {
                            filters.toggle(group, value, !on);
                        }}
                    />
                );
            })}
        </View>
    );

    const menus = (
        <>
            <FilterMenu
                testID="meals-menu-diet"
                label={t('catalogue:filters.menu.diet')}
                count={selectedDiets.length}
                onClear={() => {
                    clearList('diet');
                }}
                wide={wide}
            >
                {pills('diet', MENU_DIETS, selectedDiets, (diet) => t(`marketplace:diets.${diet}`))}
            </FilterMenu>
            <FilterMenu
                testID="meals-menu-calories"
                label={t('catalogue:filters.menu.calories')}
                count={rangeSet(ranges.values.energy) ? 1 : 0}
                onClear={() => {
                    clearRanges(['energy']);
                }}
                wide={wide}
            >
                <MealRangeFilters
                    testID="meals-calories"
                    rowTestID="meals-ranges"
                    keys={['energy']}
                    showHint={false}
                    state={ranges}
                    currency={currency}
                />
            </FilterMenu>
            <FilterMenu
                testID="meals-menu-allergies"
                label={t('catalogue:filters.menu.allergies')}
                count={selectedExclusions.length}
                onClear={() => {
                    clearList('exclude');
                }}
                wide={wide}
            >
                {pills('exclude', ALLERGEN_CODES, selectedExclusions, (code) =>
                    t(`marketplace:allergens.${code}`),
                )}
            </FilterMenu>
            {kitchens.length === 0 ? null : (
                <FilterMenu
                    testID="meals-menu-kitchen"
                    label={t('catalogue:filters.menu.kitchen')}
                    count={selectedKitchens.length}
                    onClear={() => {
                        clearList('kitchen');
                    }}
                    wide={wide}
                >
                    <FilterRows
                        testID="meals-filter"
                        groupKey="kitchen"
                        options={kitchens.map((kitchen) => ({
                            value: String(kitchen.id),
                            label: kitchen.name,
                        }))}
                        selected={selectedKitchens}
                        onToggle={(value, next) => {
                            filters.toggle('kitchen', value, next);
                        }}
                    />
                </FilterMenu>
            )}
            <FilterMenu
                testID="meals-menu-more"
                label={t('catalogue:filters.menu.more')}
                count={moreCount}
                onClear={() => {
                    clearRanges(MORE_RANGE_KEYS);
                }}
                wide={wide}
                align={wide ? 'end' : undefined}
            >
                <MealRangeFilters
                    testID="meals-ranges-more"
                    rowTestID="meals-ranges"
                    keys={MORE_RANGE_KEYS}
                    showHint={false}
                    state={ranges}
                    currency={currency}
                />
            </FilterMenu>
        </>
    );

    const sortSelect = (
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
                onSort(next);
            }}
            className="min-w-[180px]"
        />
    );

    return (
        <View
            testID="meals-filter-bar"
            role="toolbar"
            aria-label={t('catalogue:filters.barLabel')}
            className="z-auto flex-row flex-wrap items-center gap-2"
        >
            {wide ? (
                <View className="z-auto min-w-0 flex-1 flex-row flex-wrap items-center gap-2">
                    {menus}
                </View>
            ) : (
                <ScrollView
                    horizontal
                    showsHorizontalScrollIndicator={false}
                    className="w-full"
                    contentContainerClassName="flex-row items-center gap-2"
                >
                    {menus}
                </ScrollView>
            )}
            <View className={cx('z-auto', wide ? 'ms-auto' : 'w-full')}>{sortSelect}</View>
        </View>
    );
}

/* ── what is applied, as removable chips ─────────────────────────────────────────────────────── */

/** The short name each range wears on its chip — "Calories: Under 500 kcal". */
const RANGE_CHIP_LABELS: Readonly<Record<MealRangeKey, string>> = {
    energy: 'catalogue:filters.menu.calories',
    protein: 'catalogue:filters.short.protein',
    carbohydrate: 'catalogue:filters.short.carbohydrate',
    fat: 'catalogue:filters.short.fat',
    price: 'catalogue:filters.short.price',
    preparationMinutes: 'catalogue:filters.short.preparationMinutes',
};

/** One chip per range that says something, worded the way its slider reads out. */
export function rangeChips(
    ranges: MealRangeState,
    currency: CurrencyCode,
    t: TFunction,
    formatNumber: (value: number) => string,
): readonly {
    readonly key: string;
    readonly label: string;
    readonly removeLabel: string;
    readonly onRemove: () => void;
}[] {
    const unitOf = (key: MealRangeKey): string =>
        key === 'energy'
            ? t('catalogue:filters.unitKcal')
            : key === 'price'
              ? currency
              : key === 'preparationMinutes'
                ? t('catalogue:filters.unitMinutes')
                : t('catalogue:filters.unitGrams');

    return (Object.keys(RANGE_CHIP_LABELS) as MealRangeKey[])
        .filter((key) => rangeSet(ranges.values[key]))
        .map((key) => {
            const { min, max } = ranges.values[key];
            const readout =
                min !== null
                    ? t('catalogue:filters.atLeast', {
                          value: formatNumber(min),
                          unit: unitOf(key),
                      })
                    : t('catalogue:filters.atMost', {
                          value: formatNumber(max ?? 0),
                          unit: unitOf(key),
                      });
            const label = t('catalogue:filters.rangeChip', {
                label: t(RANGE_CHIP_LABELS[key]),
                readout,
            });
            return {
                key: `range-${key}`,
                label,
                removeLabel: t('catalogue:filters.removeFilter', { filter: label }),
                onRemove: () => {
                    ranges.set(key, { min: null, max: null });
                },
            };
        });
}
