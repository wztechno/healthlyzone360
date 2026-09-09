import { Accordion, Button, Stack } from '@healthy360/design-system';
import type { CurrencyCode, DietClassification, MealType } from '@healthy360/domain-types';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import type { MarketplaceFilterState } from '../marketplace/filter-bar.tsx';
import { FilterRows } from './filter-rows.tsx';
import { MealRangeFilters } from './meal-filters.tsx';
import type { MealRangeState } from './meal-filters.tsx';

/**
 * Every control the meals catalogue filters on, as a stack of disclosures.
 *
 * ## Why it is a component and not two copies of the same JSX
 *
 * `/meals` shows these controls in two places — a rail beside the grid on a wide viewport, a
 * disclosure above it on a narrow one — and they have to be the same controls. Composed inline at
 * the screen it was one arrangement; composed inline twice it would be two that drift, and the
 * first thing to drift would be a testID, which is what every filter spec reaches through.
 *
 * The screen renders it **once**, choosing the container. Rendering both and hiding one with a
 * class would put a second `meals-filter-exclude-milk` in the tree — a Playwright strict-mode
 * failure, and an off-screen control in the accessibility tree.
 *
 * ## Every group is a section, and only the ones you are using are open
 *
 * Laid out flat, these controls are about 1,700px of rail — four meal types, ten diets, six
 * kitchens, fourteen allergens and six sliders, all competing for attention at once, none of them
 * summarised. Collapsed to five headers the rail is a *contents page*: you can see every axis the
 * catalogue filters on without scrolling, and open the one you want.
 *
 * A section opens itself when it already holds a filter, because a control that is silently in
 * force is the worst kind — the grid is short and the reason is folded away with no prompt to look
 * for it. On a clean visit only Meal is open, so the rail is not five closed bars with nothing
 * visible to press. Each header carries its own active count for the same reason.
 *
 * ## Why the allergens came back out of a popover
 *
 * They were briefly a `Popover`, which put a floating panel over the sliders below it — and lost,
 * because react-native-web paints later siblings on top and the panel had no stacking context of
 * its own to win with. A section in the same column has no overlay to mis-stack, and it is the same
 * gesture as every other group rather than a second, different one.
 *
 * ## Two treatments inside the sections
 *
 * HealthZone draws its rail two ways and the difference is load-bearing: a **short list of long
 * labels** (Meal, Kitchen) wraps badly as pills — each takes a line anyway, so a pill spends a
 * border and some padding to reach the same one-per-line result with a raggeder edge. A **long list
 * of short labels** (Diet, allergens) packs three to a line and reads as a set. So rows for the
 * first, chips for the second.
 */

/** The diet classifications worth offering as a catalogue filter — the ones meals are tagged with. */
const DIET_FILTERS: readonly DietClassification[] = [
    'omnivore',
    'vegetarian',
    'vegan',
    'pescatarian',
    'high_protein',
    'low_carb',
    'mediterranean',
    'gluten_free',
    'dairy_free',
    'nut_free',
];

const MEAL_TYPES: readonly MealType[] = ['breakfast', 'lunch', 'dinner', 'snack'];

/**
 * The fourteen allergen groups food-labelling regimes in the EU, the UK and the GCC require to be
 * declared.
 *
 * Declared here rather than imported: the only other list in the repository lives in the mock
 * fixture package, and a production screen importing a fixture is exactly what the prompt's
 * validation step forbids. This is published regulatory vocabulary, not data.
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

/** The section that is open on a visit with nothing filtered — the coarsest question first. */
const DEFAULT_SECTION = 'mealType';

export interface MealFilterPanelProps {
    readonly filters: MarketplaceFilterState;
    readonly ranges: MealRangeState;
    /** Fetched marketplace kitchens, which is the only thing that knows a kitchen id's name. */
    readonly kitchens: readonly { readonly id: unknown; readonly name: string }[];
    /** The currency the price range is typed in. */
    readonly currency: CurrencyCode;
    /** Clears the chip groups and the ranges together — either alone leaves a filtered grid. */
    readonly onClearAll: () => void;
    /** Whether anything is in force, which is what makes the clear control worth offering. */
    readonly isFiltered: boolean;
    readonly testID?: string | undefined;
}

export function MealFilterPanel({
    filters,
    ranges,
    kitchens,
    currency,
    onClearAll,
    isFiltered,
    testID = 'meal-filter-panel',
}: MealFilterPanelProps) {
    const { t } = useTranslation();

    const counts = {
        mealType: (filters.selected['mealType'] ?? []).length,
        diet: (filters.selected['diet'] ?? []).length,
        kitchen: (filters.selected['kitchen'] ?? []).length,
        exclude: (filters.selected['exclude'] ?? []).length,
        ranges: ranges.isFiltered ? 1 : 0,
    };

    /*
     * Read once, on the first render, exactly as the narrow-viewport disclosure reads its own
     * initial state: the URL decides what is worth opening on arrival, and after that the person
     * decides. Recomputing it on every render would slam a section shut the moment its last chip
     * was unpicked, while the pointer was still inside it.
     */
    const [expanded, setExpanded] = useState<readonly string[]>(() => {
        const active = Object.entries(counts)
            .filter(([, count]) => count > 0)
            .map(([key]) => key);
        return active.length === 0 ? [DEFAULT_SECTION] : active;
    });

    /** A section title carries its own count, so a folded-away filter still announces itself. */
    const title = (label: string, count: number): string =>
        count === 0 ? label : t('catalogue:filters.groupWithCount', { label, n: count });

    return (
        <Stack space="md" testID={testID}>
            <Accordion
                testID="meals-filter-groups"
                multiple
                expandedKeys={expanded}
                onChange={setExpanded}
                items={[
                    {
                        key: 'mealType',
                        testID: 'meals-filter-group-mealType',
                        title: title(t('catalogue:filters.mealType'), counts.mealType),
                        children: (
                            <FilterRows
                                testID="meals-filter"
                                groupKey="mealType"
                                options={MEAL_TYPES.map((mealType) => ({
                                    value: mealType,
                                    label: t(`marketplace:mealTypes.${mealType}`),
                                }))}
                                selected={filters.selected['mealType'] ?? []}
                                onToggle={(value, next) => {
                                    filters.toggle('mealType', value, next);
                                }}
                            />
                        ),
                    },
                    {
                        key: 'diet',
                        testID: 'meals-filter-group-diet',
                        title: title(t('catalogue:filters.diet'), counts.diet),
                        children: (
                            <FilterRows
                                testID="meals-filter"
                                groupKey="diet"
                                options={DIET_FILTERS.map((diet) => ({
                                    value: diet,
                                    label: t(`marketplace:diets.${diet}`),
                                }))}
                                selected={filters.selected['diet'] ?? []}
                                onToggle={(value, next) => {
                                    filters.toggle('diet', value, next);
                                }}
                            />
                        ),
                    },
                    {
                        key: 'kitchen',
                        testID: 'meals-filter-group-kitchen',
                        title: title(t('catalogue:filters.kitchen'), counts.kitchen),
                        children: (
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
                        ),
                    },
                    {
                        key: 'exclude',
                        testID: 'meals-filter-group-exclude',
                        title: title(t('catalogue:filters.excludeAllergens'), counts.exclude),
                        children: (
                            <FilterRows
                                testID="meals-filter"
                                groupKey="exclude"
                                options={ALLERGEN_CODES.map((code) => ({
                                    value: code,
                                    label: t(`marketplace:allergens.${code}`),
                                }))}
                                selected={filters.selected['exclude'] ?? []}
                                onToggle={(value, next) => {
                                    filters.toggle('exclude', value, next);
                                }}
                            />
                        ),
                    },
                    {
                        key: 'ranges',
                        testID: 'meals-filter-group-ranges',
                        title: t('catalogue:filters.rangesTitle'),
                        children: (
                            <MealRangeFilters
                                testID="meals-ranges"
                                state={ranges}
                                currency={currency}
                            />
                        ),
                    },
                ]}
            />

            {/* HealthZone's rail ends with the way out, and it belongs here rather than only in the
                toolbar: the toolbar's clear is gone above `lg`, and a rail whose sliders are set but
                whose chips have all been unpicked one at a time would otherwise offer nothing that
                resets them. */}
            {isFiltered ? (
                <Button
                    testID="meals-filter-clear-all"
                    variant="secondary"
                    block
                    label={t('catalogue:filters.clear')}
                    onPress={onClearAll}
                />
            ) : null}
        </Stack>
    );
}
