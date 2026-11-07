import { Button, Drawer, Icon, cx, useBreakpoint } from '@healthy360/design-system';
import type { IconName, RangeValue } from '@healthy360/design-system';
import type { MarketplaceMeal } from '@healthy360/api-client/contracts';
import type { CurrencyCode, DietClassification } from '@healthy360/domain-types';
import { useFormatter } from '@healthy360/i18n';
import type { TFunction } from 'i18next';
import { useCallback, useState } from 'react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, ScrollView, Text as RNText, View } from 'react-native';

import { EntityImage } from '../../media/entity-image.tsx';
import { InkSortMenu } from '../../ui/ink-sort-menu.tsx';
import { useOutsideDismiss } from '../../ui/use-outside-dismiss.ts';
import type { MarketplaceFilterState } from '../marketplace/filter-bar.tsx';
import { MealRangeFilters } from './meal-filters.tsx';
import type { MealRangeKey, MealRangeState } from './meal-filters.tsx';
import { MENU_SORTS } from './meal-readings.ts';
import type { MenuSort } from './meal-readings.ts';
import { TINT_BORDER, TINT_FILL, TINT_INK, TINT_INK_FILL, shelfTint } from './shelf-tints.ts';
import type { ShelfTint } from './shelf-tints.ts';
import { isShownShelf } from './shown-shelves.ts';
import type { MealShelves } from './use-meal-shelves.ts';

/**
 * The meals catalogue's filters, without a panel, as the accepted Menu board draws them: the shelves
 * as a row of colour tiles, then one white bar holding the search, the menu buttons — Diet,
 * Calories, Allergies, Kitchen, More — and the sort.
 *
 * ## Why buttons that open, rather than a rail
 *
 * The rail held one group of each kind and hid the rest in a drawer, so the filter somebody
 * actually arrived with ("nothing with sesame") was two presses deep and the grid lost a column to
 * controls nobody was touching. Here every group is one press away, the grid has the width, and a
 * button says how many of its filters are on. What is applied is also listed under the bar as
 * removable chips by the screen, so nothing narrowing the grid is ever out of sight.
 *
 * Every choice writes the URL the moment it is made — no Apply — exactly as the rail did. "Show
 * dishes" only closes the menu.
 *
 * ## One content, two containers
 *
 * From `lg` a menu is a panel hung from its button. Below `lg` the buttons scroll sideways, where
 * a hung panel would be clipped by the scroller, so the same content opens in a bottom `Drawer`
 * instead. The content is written once and handed to either.
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

/** Each menu's colour and glyph, as the design gives them; the chips under the bar wear the same. */
export const FILTER_LOOKS = {
    search: { tint: 'neutral', icon: 'search' },
    diet: { tint: 'green', icon: 'leaf' },
    calories: { tint: 'orange', icon: 'heartPulse' },
    allergies: { tint: 'pink', icon: 'shield' },
    kitchen: { tint: 'blue', icon: 'chefHat' },
    more: { tint: 'violet', icon: 'funnel' },
} as const satisfies Readonly<Record<string, { tint: ShelfTint; icon: IconName }>>;

export type FilterLook = keyof typeof FILTER_LOOKS;

/** The Calories menu's quick picks, as the board offers them — "Any" lifts the range. */
const CALORIE_PRESETS: readonly { readonly min: number | null; readonly max: number | null }[] = [
    { min: null, max: 400 },
    { min: 400, max: 600 },
    { min: 600, max: 800 },
    { min: null, max: null },
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

/* ── the shelves, as tiles ───────────────────────────────────────────────────────────────────── */

export function CategoryTabs({
    filters,
    shelves,
    photoOf,
}: {
    readonly filters: MarketplaceFilterState;
    readonly shelves: MealShelves;
    /** A dish on the shelf, for the tile's photograph. */
    readonly photoOf?: ((code: string) => MarketplaceMeal | undefined) | undefined;
}) {
    const { t } = useTranslation();
    const formatter = useFormatter();
    // Shop · Menu, phone: 60px chips with a 46px face that scroll from the edge.
    const phone = !useBreakpoint().atLeast('md');
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
            contentContainerClassName={phone ? 'pb-1 pt-1' : 'grow pb-1 pt-1'}
        >
            <View
                role="radiogroup"
                aria-label={t('catalogue:filters.category')}
                className={cx('flex-row items-stretch', phone ? 'gap-2' : 'grow gap-3.5')}
            >
                {tabs.map((tab) => {
                    const on = tab.value === selected;
                    const tint = tab.value === ALL_SHELVES ? 'neutral' : shelfTint(tab.value);
                    const countText = tab.count === null ? null : formatter.formatNumber(tab.count);
                    const meal = tab.value === ALL_SHELVES ? undefined : photoOf?.(tab.value);
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
                                'flex-row items-center border-2 transition duration-normal ease-standard hover:-translate-y-0.5',
                                phone
                                    ? 'h-[60px] gap-2 rounded-[18px] pe-3.5 ps-1.5'
                                    : 'h-[84px] min-w-[180px] flex-1 gap-3 rounded-[20px] pe-3.5 ps-2.5',
                                TINT_FILL[tint],
                                on ? TINT_BORDER[tint] : 'border-transparent',
                            )}
                        >
                            <View
                                className={cx(
                                    'items-center justify-center overflow-hidden',
                                    phone
                                        ? 'h-[46px] w-[46px] rounded-xl'
                                        : 'h-[60px] w-[60px] rounded-2xl',
                                )}
                            >
                                {meal === undefined ? (
                                    <Icon name="layoutGrid" className={TINT_INK[tint]} />
                                ) : (
                                    <EntityImage
                                        assetId={meal.imagePlaceholderId}
                                        photoUrl={meal.photoUrl}
                                        seed={meal.slug}
                                        label={tab.label}
                                        decorative
                                        flush
                                        className={
                                            phone ? 'h-[46px] w-[46px]' : 'h-[60px] w-[60px]'
                                        }
                                    />
                                )}
                            </View>
                            <View className={cx('min-w-0 flex-col', phone ? null : 'flex-1')}>
                                <RNText
                                    numberOfLines={1}
                                    className={cx(
                                        'font-display font-bold text-start',
                                        phone ? 'text-base' : 'text-lg',
                                        TINT_INK[tint],
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
                                            'font-medium tabular-nums opacity-85 text-start',
                                            phone ? 'text-xs' : 'text-sm',
                                            TINT_INK[tint],
                                        )}
                                    >
                                        {phone
                                            ? countText
                                            : t('catalogue:filters.shelfCount', {
                                                  count: tab.count ?? 0,
                                                  n: countText,
                                              })}
                                    </RNText>
                                )}
                            </View>
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
    readonly look: FilterLook;
    /** How many of this menu's filters are on — shown on the button. */
    readonly count: number;
    /** Lifts this menu's filters. */
    readonly onClear: () => void;
    readonly wide: boolean;
    /** A roomier panel, for the menus that hold a page of pills. */
    readonly roomy?: boolean | undefined;
    readonly align?: 'start' | 'end' | undefined;
    /** What the filters leave, said in the panel's footer. */
    readonly summary: string;
    readonly testID: string;
    readonly children: ReactNode;
}

function FilterMenu({
    label,
    look,
    count,
    onClear,
    wide,
    roomy = false,
    align = 'start',
    summary,
    testID,
    children,
}: FilterMenuProps) {
    const { t } = useTranslation();
    const [open, setOpen] = useState(false);
    const close = useCallback(() => {
        setOpen(false);
    }, []);
    const root = useOutsideDismiss(open && wide, close);
    const text = count === 0 ? label : t('catalogue:filters.menuCount', { label, n: count });
    const { tint, icon } = FILTER_LOOKS[look];

    const trigger = (
        <Pressable
            testID={`${testID}-trigger`}
            role="button"
            accessibilityRole="button"
            accessibilityLabel={text}
            aria-haspopup="dialog"
            aria-expanded={open}
            accessibilityState={{ expanded: open }}
            onPress={() => {
                setOpen((current) => !current);
            }}
            className={cx(
                'h-[52px] flex-row items-center gap-2 rounded-2xl pe-2.5 ps-2 transition duration-normal ease-standard hover:bg-surface-base',
                count > 0 || open ? 'bg-surface-base' : '',
            )}
        >
            <View className={cx('h-8 w-8 items-center justify-center rounded-xl', TINT_FILL[tint])}>
                <Icon name={icon} size="sm" className={TINT_INK[tint]} />
            </View>
            <RNText numberOfLines={1} className="text-sm font-semibold text-content-primary">
                {label}
            </RNText>
            {count === 0 ? null : (
                <View className="h-5 min-w-[20px] items-center justify-center rounded-full bg-surface-brand px-1.5">
                    <RNText className="text-xs font-bold tabular-nums text-content-on-brand">
                        {count}
                    </RNText>
                </View>
            )}
            <Icon name="chevronDown" size="sm" className="text-content-secondary" />
        </Pressable>
    );

    const heading = (
        <View className="flex-row items-center gap-2 border-b border-stroke-subtle pb-2.5">
            <View className={cx('h-6 w-6 items-center justify-center rounded-lg', TINT_FILL[tint])}>
                <Icon name={icon} size="sm" className={TINT_INK[tint]} />
            </View>
            <RNText
                role="heading"
                aria-level={2}
                className="me-auto font-display text-base font-bold text-content-primary"
            >
                {label}
            </RNText>
            <Pressable
                testID={`${testID}-clear`}
                role="button"
                accessibilityRole="button"
                disabled={count === 0}
                onPress={onClear}
                className="h-8 justify-center rounded-lg px-2 hover:bg-surface-base"
            >
                <RNText
                    className={cx(
                        'text-xs font-semibold',
                        count === 0 ? 'text-content-disabled' : 'text-content-secondary',
                    )}
                >
                    {t('catalogue:filters.clearGroup')}
                </RNText>
            </Pressable>
        </View>
    );

    if (wide) {
        return (
            <View ref={root} className="relative z-auto">
                {trigger}
                {open ? (
                    <View
                        testID={`${testID}-panel`}
                        role="dialog"
                        aria-label={label}
                        className={cx(
                            'absolute top-full z-tooltip mt-2 rounded-2xl border border-stroke-subtle bg-surface-raised px-3.5 py-3 shadow-elevation-3',
                            align === 'end' ? 'end-0' : 'start-0',
                            roomy ? 'w-[380px]' : 'w-[320px]',
                        )}
                    >
                        {heading}
                        <View className="mt-3 flex-col">{children}</View>
                        <View className="mt-3 flex-row items-center gap-3 border-t border-stroke-subtle pt-2.5">
                            <RNText
                                numberOfLines={2}
                                className="me-auto min-w-0 shrink text-sm text-content-secondary text-start"
                            >
                                {summary}
                            </RNText>
                            <Button
                                testID={`${testID}-done`}
                                size="sm"
                                label={t('catalogue:filters.showDishes')}
                                onPress={close}
                            />
                        </View>
                    </View>
                ) : null}
            </View>
        );
    }

    return (
        <>
            {trigger}
            <Drawer
                testID={`${testID}-panel`}
                open={open}
                onClose={close}
                placement="bottom"
                title={label}
                footer={
                    <Button
                        testID={`${testID}-done`}
                        block
                        label={t('catalogue:filters.showDishes')}
                        onPress={close}
                    />
                }
            >
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
            </Drawer>
        </>
    );
}

/* ── a pill inside a menu ────────────────────────────────────────────────────────────────────── */

function FilterPill({
    testID,
    label,
    selected,
    tint,
    onPress,
}: {
    readonly testID: string;
    readonly label: string;
    readonly selected: boolean;
    readonly tint: ShelfTint;
    readonly onPress: () => void;
}) {
    return (
        <Pressable
            testID={testID}
            role="button"
            accessibilityRole="button"
            aria-pressed={selected}
            accessibilityState={{ selected }}
            onPress={onPress}
            className={cx(
                'h-[34px] flex-row items-center gap-1.5 rounded-full border-2 pe-3 ps-1 transition duration-normal ease-standard hover:-translate-y-px active:scale-95',
                selected
                    ? cx(TINT_FILL[tint], TINT_BORDER[tint])
                    : 'border-transparent bg-surface-base hover:border-stroke',
            )}
        >
            <View
                className={cx(
                    'h-[26px] w-[26px] items-center justify-center rounded-full transition duration-normal ease-emphasized',
                    selected ? cx(TINT_INK_FILL[tint], 'rotate-[360deg]') : 'bg-surface-raised',
                )}
            >
                <Icon
                    name={selected ? 'check' : 'plus'}
                    size="sm"
                    className={selected ? 'text-surface-raised' : 'text-content-secondary'}
                />
            </View>
            <RNText
                numberOfLines={1}
                className={cx(
                    'text-sm',
                    selected
                        ? cx('font-semibold', TINT_INK[tint])
                        : 'font-medium text-content-primary',
                )}
            >
                {label}
            </RNText>
        </Pressable>
    );
}

/* ── the bar ─────────────────────────────────────────────────────────────────────────────────── */

export interface MealFilterBarProps {
    readonly filters: MarketplaceFilterState;
    readonly ranges: MealRangeState;
    /** Fetched marketplace kitchens, which is the only thing that knows a kitchen id's name. */
    readonly kitchens: readonly {
        readonly id: unknown;
        readonly name: string;
        readonly tagline?: string | undefined;
        readonly imagePlaceholderId?: string | undefined;
    }[];
    readonly currency: CurrencyCode;
    readonly sort: MenuSort;
    readonly onSort: (sort: MenuSort) => void;
    /** Whether any meal shown has a rating. Without one, "Top rated" sorts nothing. */
    readonly hasRatings?: boolean | undefined;
    /** What the filters leave — the page's count line — said at the foot of every menu. */
    readonly summary?: string | undefined;
    /**
     * The catalogue's search field, drawn first on the bar (browse-06). The screen owns it — it
     * holds the draft and the debounce — and the bar only gives it its place: the start of the row
     * from `lg`, a full-width line above the scrolling menus below it, where a field squeezed
     * between buttons would be too narrow to read what was typed.
     */
    readonly search?: ReactNode | undefined;
}

export function MealFilterBar({
    filters,
    ranges,
    kitchens,
    currency,
    sort,
    onSort,
    hasRatings = true,
    summary = '',
    search,
}: MealFilterBarProps) {
    const { t } = useTranslation();
    const { formatNumber } = useFormatter();
    const wide = useBreakpoint().atLeast('lg');
    // Shop · Menu, phone: the search sits on its own row above, so the bar is one row of menus.
    const phone = !useBreakpoint().atLeast('md');
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
        tint: ShelfTint,
        values: readonly string[],
        selected: readonly string[],
        labelOf: (value: string) => string,
    ) => (
        <View className="flex-row flex-wrap gap-1.5">
            {values.map((value) => {
                const on = selected.includes(value);
                return (
                    <FilterPill
                        key={value}
                        testID={`meals-filter-${group}-${value}`}
                        label={labelOf(value)}
                        selected={on}
                        tint={tint}
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
                look="diet"
                count={selectedDiets.length}
                onClear={() => {
                    clearList('diet');
                }}
                wide={wide}
                roomy
                summary={summary}
            >
                {pills('diet', FILTER_LOOKS.diet.tint, MENU_DIETS, selectedDiets, (diet) =>
                    t(`marketplace:diets.${diet}`),
                )}
            </FilterMenu>
            <FilterMenu
                testID="meals-menu-calories"
                label={t('catalogue:filters.menu.calories')}
                look="calories"
                count={rangeSet(ranges.values.energy) ? 1 : 0}
                onClear={() => {
                    clearRanges(['energy']);
                }}
                wide={wide}
                summary={summary}
            >
                <View className="mb-1 flex-row flex-wrap gap-1.5">
                    {CALORIE_PRESETS.map((preset, index) => {
                        const on =
                            ranges.values.energy.min === preset.min &&
                            ranges.values.energy.max === preset.max;
                        const kcal = t('catalogue:filters.unitKcal');
                        const label =
                            preset.min === null && preset.max === null
                                ? t('catalogue:filters.anyValue')
                                : preset.min === null
                                  ? t('catalogue:filters.atMost', {
                                        value: formatNumber(preset.max ?? 0),
                                        unit: kcal,
                                    })
                                  : t('catalogue:filters.between', {
                                        min: formatNumber(preset.min),
                                        max: formatNumber(preset.max ?? 0),
                                        unit: kcal,
                                    });
                        const tint = FILTER_LOOKS.calories.tint;
                        return (
                            <Pressable
                                key={label}
                                testID={`meals-calories-preset-${String(index)}`}
                                role="button"
                                accessibilityRole="button"
                                aria-pressed={on}
                                accessibilityState={{ selected: on }}
                                onPress={() => {
                                    ranges.set('energy', { min: preset.min, max: preset.max });
                                }}
                                className={cx(
                                    'h-[34px] justify-center rounded-full border-2 px-3 transition duration-normal ease-standard hover:-translate-y-px',
                                    on
                                        ? cx(TINT_FILL[tint], TINT_BORDER[tint])
                                        : 'border-transparent bg-surface-base hover:border-stroke',
                                )}
                            >
                                <RNText
                                    className={cx(
                                        'text-sm tabular-nums',
                                        on
                                            ? cx('font-semibold', TINT_INK[tint])
                                            : 'font-medium text-content-primary',
                                    )}
                                >
                                    {label}
                                </RNText>
                            </Pressable>
                        );
                    })}
                </View>
                <MealRangeFilters
                    testID="meals-calories"
                    rowTestID="meals-ranges"
                    keys={['energy']}
                    showHint={false}
                    state={ranges}
                    currency={currency}
                    tint={FILTER_LOOKS.calories.tint}
                />
            </FilterMenu>
            <FilterMenu
                testID="meals-menu-allergies"
                label={t('catalogue:filters.menu.allergies')}
                look="allergies"
                count={selectedExclusions.length}
                onClear={() => {
                    clearList('exclude');
                }}
                wide={wide}
                roomy
                summary={summary}
            >
                {pills(
                    'exclude',
                    FILTER_LOOKS.allergies.tint,
                    ALLERGEN_CODES,
                    selectedExclusions,
                    (code) => t(`marketplace:allergens.${code}`),
                )}
            </FilterMenu>
            {kitchens.length === 0 ? null : (
                <FilterMenu
                    testID="meals-menu-kitchen"
                    label={t('catalogue:filters.menu.kitchen')}
                    look="kitchen"
                    count={selectedKitchens.length}
                    onClear={() => {
                        clearList('kitchen');
                    }}
                    wide={wide}
                    summary={summary}
                >
                    {/* Shop · Menu, pin 3: the board's kitchen rows — photo, name, its line, a tick box. */}
                    <View className="flex-col gap-2.5">
                        {kitchens.map((kitchen) => {
                            const value = String(kitchen.id);
                            const on = selectedKitchens.includes(value);
                            const tint = FILTER_LOOKS.kitchen.tint;
                            return (
                                <Pressable
                                    key={value}
                                    testID={`meals-filter-kitchen-${value}`}
                                    role="button"
                                    accessibilityRole="button"
                                    accessibilityLabel={kitchen.name}
                                    aria-pressed={on}
                                    accessibilityState={{ selected: on }}
                                    onPress={() => {
                                        filters.toggle('kitchen', value, !on);
                                    }}
                                    className={cx(
                                        'min-w-[260px] flex-row items-center gap-3 rounded-[14px] border bg-surface-raised py-2 pe-2.5 ps-2 transition duration-normal ease-standard',
                                        on
                                            ? TINT_BORDER[tint]
                                            : 'border-stroke-subtle hover:border-stroke',
                                    )}
                                >
                                    <View className="h-11 w-11 overflow-hidden rounded-xl">
                                        <EntityImage
                                            assetId={kitchen.imagePlaceholderId}
                                            variant="card"
                                            seed={value}
                                            label={kitchen.name}
                                            decorative
                                            flush
                                            className="h-full w-full"
                                        />
                                    </View>
                                    <View className="min-w-0 flex-1">
                                        <RNText className="text-sm font-semibold text-content-primary text-start">
                                            {kitchen.name}
                                        </RNText>
                                        {kitchen.tagline === undefined ||
                                        kitchen.tagline.trim() === '' ? null : (
                                            <RNText
                                                numberOfLines={1}
                                                className="text-xs text-content-secondary text-start"
                                            >
                                                {kitchen.tagline}
                                            </RNText>
                                        )}
                                    </View>
                                    <View
                                        aria-hidden
                                        className={cx(
                                            'h-6 w-6 items-center justify-center rounded-[7px] border-2',
                                            on
                                                ? cx(TINT_INK_FILL[tint], 'border-transparent')
                                                : 'border-stroke',
                                        )}
                                    >
                                        {on ? (
                                            <Icon
                                                name="check"
                                                size="sm"
                                                className="text-surface-raised"
                                            />
                                        ) : null}
                                    </View>
                                </Pressable>
                            );
                        })}
                    </View>
                </FilterMenu>
            )}
            <FilterMenu
                testID="meals-menu-more"
                label={t('catalogue:filters.menu.more')}
                look="more"
                count={moreCount}
                onClear={() => {
                    clearRanges(MORE_RANGE_KEYS);
                }}
                wide={wide}
                align={wide ? 'end' : undefined}
                summary={summary}
            >
                <MealRangeFilters
                    testID="meals-ranges-more"
                    rowTestID="meals-ranges"
                    keys={MORE_RANGE_KEYS}
                    showHint={false}
                    state={ranges}
                    currency={currency}
                    tint={FILTER_LOOKS.more.tint}
                />
            </FilterMenu>
        </>
    );

    const sortMenu = (
        <InkSortMenu<MenuSort>
            testID="meals-sort"
            label={t('catalogue:meals.sortLabel')}
            accessibilityLabel={t('catalogue:filters.sortCurrent', {
                label: t('catalogue:meals.sortLabel'),
                value: t(`catalogue:meals.sort.${sort}`),
            })}
            value={sort}
            options={MENU_SORTS.filter(
                (option) => option !== 'rating' || hasRatings || sort === 'rating',
            ).map((option) => ({ value: option, label: t(`catalogue:meals.sort.${option}`) }))}
            onChange={onSort}
            compact={phone}
        />
    );

    return (
        <View
            testID="meals-filter-bar"
            role="toolbar"
            aria-label={t('catalogue:filters.barLabel')}
            className={cx(
                'z-auto border border-stroke-subtle bg-surface-raised shadow-elevation-2',
                wide
                    ? 'flex-row items-center gap-1 rounded-3xl p-2'
                    : phone
                      ? 'flex-row items-center gap-1 rounded-[20px] p-1.5'
                      : 'flex-col gap-2 rounded-3xl p-2',
            )}
        >
            {search === undefined ? null : (
                <View
                    testID="meals-filter-search"
                    className={wide ? 'min-w-[160px] flex-1 basis-[200px]' : 'w-full'}
                >
                    {search}
                </View>
            )}
            {wide ? (
                <>
                    <View aria-hidden className="mx-1.5 h-[30px] w-px bg-stroke" />
                    <View className="z-auto flex-row items-center gap-1">{menus}</View>
                    <View className="z-auto ms-1">{sortMenu}</View>
                </>
            ) : (
                <>
                    <ScrollView
                        horizontal
                        showsHorizontalScrollIndicator={false}
                        className={phone ? 'min-w-0 flex-1' : 'w-full'}
                        contentContainerClassName="flex-row items-center gap-1"
                    >
                        {menus}
                    </ScrollView>
                    <View className={cx('z-auto', phone ? 'ms-1' : 'self-start')}>{sortMenu}</View>
                </>
            )}
        </View>
    );
}

/* ── what is applied, as removable chips ─────────────────────────────────────────────────────── */

/** The short name each range wears on its chip — "Calories · Under 500 kcal". */
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
    /** The menu it belongs to, which gives the chip its colour and glyph. */
    readonly look: FilterLook;
    /** The range's own name — the chip's small upper line. */
    readonly group: string;
    /** The readout — the chip's main line. */
    readonly value: string;
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
                min !== null && max !== null
                    ? t('catalogue:filters.between', {
                          min: formatNumber(min),
                          max: formatNumber(max),
                          unit: unitOf(key),
                      })
                    : min !== null
                      ? t('catalogue:filters.atLeast', {
                            value: formatNumber(min),
                            unit: unitOf(key),
                        })
                      : t('catalogue:filters.atMost', {
                            value: formatNumber(max ?? 0),
                            unit: unitOf(key),
                        });
            const group = t(RANGE_CHIP_LABELS[key]);
            const label = t('catalogue:filters.rangeChip', { label: group, readout });
            return {
                key: `range-${key}`,
                look: key === 'energy' ? ('calories' as const) : ('more' as const),
                group,
                value: readout,
                label,
                removeLabel: t('catalogue:filters.removeFilter', { filter: label }),
                onRemove: () => {
                    ranges.set(key, { min: null, max: null });
                },
            };
        });
}
