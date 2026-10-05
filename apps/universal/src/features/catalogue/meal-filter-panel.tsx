import { Inline, Stack, Text, cx } from '@healthy360/design-system';
import type { CurrencyCode, DietClassification } from '@healthy360/domain-types';
import { useFormatter } from '@healthy360/i18n';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, Text as RNText, View } from 'react-native';

import { Eyebrow } from '../../ui/eyebrow.tsx';
import { PillChip } from '../../ui/pill-chip.tsx';
import type { MarketplaceFilterState } from '../marketplace/filter-bar.tsx';
import { FilterRows } from './filter-rows.tsx';
import type { FilterRowOption } from './filter-rows.tsx';
import { MealRangeFilters } from './meal-filters.tsx';
import type { MealRangeKey, MealRangeState } from './meal-filters.tsx';
import { isShownShelf } from './shown-shelves.ts';
import type { MealShelves } from './use-meal-shelves.ts';

/**
 * The meals catalogue's filters, in the two places they live.
 *
 * ## The rail is the design's rail, and nothing else
 *
 * HealthZone's rail is four things, top to bottom: a `CATEGORY` list with a count on every row,
 * `DIETARY` pills, one `CALORIES PER SERVING` slider and "Clear all filters". {@link MealFilterPanel}
 * draws exactly those — on the rail above `lg`, inside the closed-by-default disclosure below it.
 * The screen renders it **once**, choosing the container: drawing both and hiding one would put a
 * second `meals-filter-diet-vegan` in the tree and an off-screen control in the accessibility tree.
 *
 * ## The rest is one press away, not on the rail
 *
 * The catalogue filters on more than the design shows — the kitchen, allergen exclusions, five more
 * diets and five more ranges — and none of those is dropped, because each is a question somebody
 * actually arrives with ("nothing with sesame"). They used to fold under an accordion at the foot of
 * the rail, which made the rail a different object from the design's. They now live in
 * {@link MoreMealFilters}, which the screen opens in a drawer from a "More filters" control beside
 * the sort: the header already holds the controls that reshape the grid without being one of the
 * rail's groups, and that control carries a count, so a filter applied in the drawer is never
 * silently in force.
 */

/** The design's four dietary pills, in its order. Each is a real classification. */
const RAIL_DIETS: readonly DietClassification[] = [
    'high_protein',
    'vegetarian',
    'vegan',
    'gluten_free',
];

/** The classifications the drawer offers beside them — `omnivore` filters nothing anybody wants. */
export const MORE_DIETS: readonly DietClassification[] = [
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
const ALLERGEN_CODES: readonly string[] = [
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

/** The one range the design draws on the rail. */
const RAIL_RANGE_KEYS: readonly MealRangeKey[] = ['energy'];

/** The ranges the drawer carries. */
export const MORE_RANGE_KEYS: readonly MealRangeKey[] = [
    'protein',
    'carbohydrate',
    'fat',
    'price',
    'preparationMinutes',
];

/**
 * The "every shelf" row. Not a category code — the platform's codes are lower-case words — so it
 * can never collide with one in the URL; pressing it clears the parameter rather than writing this.
 */
const ALL_SHELVES = 'all';

/** How many filters the drawer is holding, for the control that opens it. */
export function moreFiltersCount(filters: MarketplaceFilterState, ranges: MealRangeState): number {
    const diets = (filters.selected['diet'] ?? []).filter((diet) =>
        (MORE_DIETS as readonly string[]).includes(diet),
    ).length;
    const rangeCount = MORE_RANGE_KEYS.filter(
        (key) => ranges.values[key].min !== null || ranges.values[key].max !== null,
    ).length;
    return (
        (filters.selected['kitchen'] ?? []).length +
        (filters.selected['exclude'] ?? []).length +
        diets +
        rangeCount
    );
}

/** One of the rail's groups: a hairline above (except the first), an eyebrow, the controls. */
function RailGroup({
    label,
    first = false,
    testID,
    children,
}: {
    readonly label?: string | undefined;
    readonly first?: boolean | undefined;
    readonly testID: string;
    readonly children: ReactNode;
}) {
    return (
        <View
            testID={testID}
            className={cx('flex-col gap-2.5', first ? null : 'border-t border-stroke pt-5')}
        >
            {label === undefined ? null : <Eyebrow>{label}</Eyebrow>}
            {children}
        </View>
    );
}

export interface MealFilterPanelProps {
    readonly filters: MarketplaceFilterState;
    readonly ranges: MealRangeState;
    readonly shelves: MealShelves;
    /** The currency the price range is typed in. */
    readonly currency: CurrencyCode;
    /** Clears the chip groups, the ranges and the search together — the design's `clearFilters`. */
    readonly onClearAll: () => void;
    readonly testID?: string | undefined;
}

export function MealFilterPanel({
    filters,
    ranges,
    shelves,
    currency,
    onClearAll,
    testID = 'meal-filter-panel',
}: MealFilterPanelProps) {
    const { t } = useTranslation();
    const formatter = useFormatter();

    // A hidden shelf (`shown-shelves.ts`) is not drawn even when a link selected it.
    const selectedShelves = (filters.selected['category'] ?? []).filter(isShownShelf);
    const selectedDiets = filters.selected['diet'] ?? [];

    /** A category row, with its count when the whole menu was read. */
    const shelfRow = (value: string, label: string, count: number | null): FilterRowOption => {
        if (count === null) return { value, label };
        const countText = formatter.formatNumber(count);
        return {
            value,
            label,
            countText,
            accessibilityLabel: t('catalogue:filters.optionWithCount', {
                label,
                count: countText,
            }),
        };
    };

    const categoryOptions: readonly FilterRowOption[] = [
        shelfRow(ALL_SHELVES, t('catalogue:filters.allMeals'), shelves.total),
        ...shelves.shelves.map((shelf) => shelfRow(shelf.code, shelf.name, shelf.count)),
        // A shelf a shared link selected that the menu does not stock is still drawn, lit, so the
        // filter that emptied the grid is visible and can be undone.
        ...selectedShelves
            .filter((code) => !shelves.shelves.some((shelf) => shelf.code === code))
            .map((code) => shelfRow(code, code, null)),
    ];

    return (
        <View testID={testID} className="flex-col gap-[22px]">
            <RailGroup first label={t('catalogue:filters.category')} testID="meals-filter-category">
                <FilterRows
                    testID="meals-filter"
                    groupKey="category"
                    options={categoryOptions}
                    selected={selectedShelves.length === 0 ? [ALL_SHELVES] : selectedShelves}
                    onToggle={(value) => {
                        // One shelf at a time, as the design's list behaves — and the API takes one
                        // `category_slug`. "All" lifts it.
                        filters.select('category', value === ALL_SHELVES ? null : value);
                    }}
                />
            </RailGroup>

            <RailGroup label={t('catalogue:filters.dietary')} testID="meals-filter-dietary">
                <Inline space="xs" wrap>
                    {RAIL_DIETS.map((diet) => (
                        <PillChip
                            key={diet}
                            size="sm"
                            floor="coarse"
                            testID={`meals-filter-diet-${diet}`}
                            label={t(`marketplace:diets.${diet}`)}
                            selected={selectedDiets.includes(diet)}
                            onPress={() => {
                                filters.toggle('diet', diet, !selectedDiets.includes(diet));
                            }}
                        />
                    ))}
                </Inline>
            </RailGroup>

            {/* No eyebrow: the slider's own label is the group's name, "Calories per serving",
                and a second one above it would be the first of two identical labels. */}
            <RailGroup testID="meals-filter-calories">
                <MealRangeFilters
                    testID="meals-calories"
                    rowTestID="meals-ranges"
                    keys={RAIL_RANGE_KEYS}
                    showHint={false}
                    state={ranges}
                    currency={currency}
                />
            </RailGroup>

            {/* The design's outlined button: no fill, a strong hairline, quiet text. Always live,
                as the design's is — with nothing applied it simply has nothing to clear. */}
            <Pressable
                testID="meals-filter-clear-all"
                role="button"
                accessibilityRole="button"
                accessibilityLabel={t('catalogue:filters.clearAll')}
                onPress={onClearAll}
                className="min-h-touch items-center justify-center rounded border border-stroke-strong bg-transparent px-3 py-2.5 hover:bg-surface-sunken"
            >
                <RNText className="text-sm font-medium text-content-secondary">
                    {t('catalogue:filters.clearAll')}
                </RNText>
            </Pressable>
        </View>
    );
}

export interface MoreMealFiltersProps {
    readonly filters: MarketplaceFilterState;
    readonly ranges: MealRangeState;
    /** Fetched marketplace kitchens, which is the only thing that knows a kitchen id's name. */
    readonly kitchens: readonly { readonly id: unknown; readonly name: string }[];
    readonly currency: CurrencyCode;
    readonly testID?: string | undefined;
}

/**
 * Everything the catalogue filters on that the design's rail does not draw: kitchen, the other
 * diets, allergen exclusions and the other five ranges. The same groups, eyebrows, hairlines and
 * pills as the rail, so the drawer reads as more of the rail rather than as a second design.
 */
export function MoreMealFilters({
    filters,
    ranges,
    kitchens,
    currency,
    testID = 'meals-more-filters-panel',
}: MoreMealFiltersProps) {
    const { t } = useTranslation();
    const selectedDiets = filters.selected['diet'] ?? [];
    const selectedExclusions = filters.selected['exclude'] ?? [];

    return (
        <View testID={testID} className="flex-col gap-[22px]">
            <RailGroup
                first
                label={t('catalogue:filters.kitchen')}
                testID="meals-filter-group-kitchen"
            >
                <FilterRows
                    testID="meals-filter"
                    groupKey="kitchen"
                    options={kitchens.map((kitchen) => ({
                        value: String(kitchen.id),
                        label: kitchen.name,
                    }))}
                    selected={filters.selected['kitchen'] ?? []}
                    onToggle={(value, next) => {
                        filters.toggle('kitchen', value, next);
                    }}
                />
            </RailGroup>

            <RailGroup label={t('catalogue:filters.moreDiets')} testID="meals-filter-group-diet">
                <Inline space="xs" wrap>
                    {MORE_DIETS.map((diet) => (
                        <PillChip
                            key={diet}
                            size="sm"
                            floor="coarse"
                            testID={`meals-filter-diet-${diet}`}
                            label={t(`marketplace:diets.${diet}`)}
                            selected={selectedDiets.includes(diet)}
                            onPress={() => {
                                filters.toggle('diet', diet, !selectedDiets.includes(diet));
                            }}
                        />
                    ))}
                </Inline>
            </RailGroup>

            <RailGroup
                label={t('catalogue:filters.excludeAllergens')}
                testID="meals-filter-group-exclude"
            >
                <Stack space="sm">
                    <Text tone="secondary" variant="caption">
                        {t('catalogue:filters.excludeAllergensHint')}
                    </Text>
                    <Inline space="xs" wrap>
                        {ALLERGEN_CODES.map((code) => (
                            <PillChip
                                key={code}
                                size="sm"
                                floor="coarse"
                                testID={`meals-filter-exclude-${code}`}
                                label={t(`marketplace:allergens.${code}`)}
                                selected={selectedExclusions.includes(code)}
                                onPress={() => {
                                    filters.toggle(
                                        'exclude',
                                        code,
                                        !selectedExclusions.includes(code),
                                    );
                                }}
                            />
                        ))}
                    </Inline>
                </Stack>
            </RailGroup>

            <RailGroup
                label={t('catalogue:filters.rangesTitle')}
                testID="meals-filter-group-ranges"
            >
                <MealRangeFilters
                    testID="meals-ranges-more"
                    rowTestID="meals-ranges"
                    keys={MORE_RANGE_KEYS}
                    state={ranges}
                    currency={currency}
                />
            </RailGroup>
        </View>
    );
}
