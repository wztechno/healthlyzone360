import { SliderField, Stack, Text } from '@healthy360/design-system';
import type { RangeValue, SliderDirection } from '@healthy360/design-system';
import { useFormatter } from '@healthy360/i18n';
import type { MealFilter } from '@healthy360/api-client/contracts';
import { minorUnitExponent } from '@healthy360/domain-types';
import type {
    AllergenCode,
    CurrencyCode,
    DietClassification,
    KitchenId,
    MealType,
} from '@healthy360/domain-types';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

/**
 * The numeric half of the meal search.
 *
 * Wave 2's `useMarketplaceFilters` already owns the text query and the chip groups; this owns the
 * six ranges the prompt asks for, in the same place and by the same rule: **the state lives in the
 * URL**. A filtered listing is somewhere a person can link to, reload and reach with the back
 * button, and a `useState` gives up all three.
 *
 * Two ends per range become two parameters (`energyMin`, `energyMax`) rather than one packed value.
 * A packed `energy=400-900` would need parsing, would break the moment somebody typed a stray
 * character into the address bar, and could not express "no lower bound" without a sentinel.
 *
 * ## Price is the one range that is not what it looks like
 *
 * `MealFilter.price` is in **minor units** — the contract says so, and money is integral throughout
 * this codebase. A person types dirhams. The conversion happens here, once, using the currency's
 * declared exponent, because a three-decimal currency (KWD, BHD, OMR) formats and scales differently
 * from a two-decimal one and every call site that reinvented this would eventually assume two.
 */

export const MEAL_RANGE_KEYS = [
    'energy',
    'protein',
    'carbohydrate',
    'fat',
    'price',
    'preparationMinutes',
] as const;
export type MealRangeKey = (typeof MEAL_RANGE_KEYS)[number];

export interface MealRangeState {
    readonly values: Readonly<Record<MealRangeKey, RangeValue>>;
    readonly set: (key: MealRangeKey, value: RangeValue) => void;
    readonly clear: () => void;
    readonly isFiltered: boolean;
}

function paramNames(key: MealRangeKey): readonly [string, string] {
    return [`${key}Min`, `${key}Max`];
}

function readNumber(raw: string | string[] | undefined): number | null {
    const value = Array.isArray(raw) ? raw[0] : raw;
    if (value === undefined || value === '') return null;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
}

export const MEAL_RANGE_PARAM_KEYS: readonly string[] = MEAL_RANGE_KEYS.flatMap((key) => [
    ...paramNames(key),
]);

export function useMealRanges(): MealRangeState {
    const router = useRouter();
    const params = useLocalSearchParams();

    const values = useMemo<Readonly<Record<MealRangeKey, RangeValue>>>(() => {
        const entries = MEAL_RANGE_KEYS.map((key) => {
            const [minName, maxName] = paramNames(key);
            return [
                key,
                {
                    min: readNumber(params[minName] as string | string[] | undefined),
                    max: readNumber(params[maxName] as string | string[] | undefined),
                },
            ] as const;
        });
        return Object.fromEntries(entries) as Record<MealRangeKey, RangeValue>;
    }, [params]);

    const set = useCallback(
        (key: MealRangeKey, value: RangeValue) => {
            const [minName, maxName] = paramNames(key);
            router.setParams({
                [minName]: value.min === null ? '' : String(value.min),
                [maxName]: value.max === null ? '' : String(value.max),
            });
        },
        [router],
    );

    const clear = useCallback(() => {
        const cleared: Record<string, string> = {};
        for (const name of MEAL_RANGE_PARAM_KEYS) cleared[name] = '';
        router.setParams(cleared);
    }, [router]);

    const isFiltered = MEAL_RANGE_KEYS.some(
        (key) => values[key].min !== null || values[key].max !== null,
    );

    return { values, set, clear, isFiltered };
}

/* ── turning the state into a contract filter ────────────────────────────────────────────────── */

/** A range that says nothing is omitted entirely, so it never becomes part of the query key. */
function band(value: RangeValue, scale = 1): { min?: number; max?: number } | undefined {
    const min = value.min === null ? undefined : value.min * scale;
    const max = value.max === null ? undefined : value.max * scale;
    if (min === undefined && max === undefined) return undefined;
    // A crossed range is reported by the control, not silently swapped; passing it through would
    // return nothing, which is exactly what the person asked for and what the empty state explains.
    return {
        ...(min === undefined ? {} : { min }),
        ...(max === undefined ? {} : { max }),
    };
}

export interface MealFilterInputs {
    readonly query: string;
    readonly kitchenIds: readonly KitchenId[];
    readonly mealTypes: readonly MealType[];
    readonly dietClassifications: readonly DietClassification[];
    readonly excludeAllergens: readonly AllergenCode[];
    readonly ranges: Readonly<Record<MealRangeKey, RangeValue>>;
    readonly sort: MealFilter['sort'];
    /** ISO 4217 code the price range was typed in — the exponent decides the minor-unit scale. */
    readonly currency: CurrencyCode;
    readonly limit: number;
}

export function toMealFilter(inputs: MealFilterInputs): Omit<MealFilter, 'cursor'> {
    const priceScale = 10 ** minorUnitExponent(inputs.currency);

    return {
        limit: inputs.limit,
        ...(inputs.query === '' ? {} : { query: inputs.query }),
        ...(inputs.kitchenIds.length === 0 ? {} : { kitchenIds: inputs.kitchenIds }),
        ...(inputs.mealTypes.length === 0 ? {} : { mealTypes: inputs.mealTypes }),
        ...(inputs.dietClassifications.length === 0
            ? {}
            : { dietClassifications: inputs.dietClassifications }),
        ...(inputs.excludeAllergens.length === 0
            ? {}
            : { excludeAllergens: inputs.excludeAllergens }),
        ...(band(inputs.ranges.energy) === undefined ? {} : { energy: band(inputs.ranges.energy) }),
        ...(band(inputs.ranges.protein) === undefined
            ? {}
            : { protein: band(inputs.ranges.protein) }),
        ...(band(inputs.ranges.carbohydrate) === undefined
            ? {}
            : { carbohydrate: band(inputs.ranges.carbohydrate) }),
        ...(band(inputs.ranges.fat) === undefined ? {} : { fat: band(inputs.ranges.fat) }),
        ...(band(inputs.ranges.price, priceScale) === undefined
            ? {}
            : { price: band(inputs.ranges.price, priceScale) }),
        ...(band(inputs.ranges.preparationMinutes) === undefined
            ? {}
            : { preparationMinutes: band(inputs.ranges.preparationMinutes) }),
        ...(inputs.sort === undefined ? {} : { sort: inputs.sort }),
    };
}

/* ── the control ─────────────────────────────────────────────────────────────────────────────── */

export interface MealRangeFiltersProps {
    readonly state: MealRangeState;
    /** Currency the price range is typed in, shown as the field's unit. */
    readonly currency: string;
    readonly testID?: string | undefined;
}

/**
 * The ceiling each slider runs to, and why these are round numbers rather than measurements.
 *
 * A slider needs a maximum and nothing can supply one honestly: `MealFilter` carries no extents,
 * `MarketplaceRepository` exposes no facets endpoint, and `CursorPage` meta carries only a total.
 * Deriving one from the fetched page would be worse than inventing one — it would move as you
 * filtered, so the same meal would sit at a different point on the track from one keystroke to the
 * next, and the thumb would jump under the hand that was dragging it.
 *
 * So these are editorial ceilings, chosen to clear the seeded catalogue with headroom, declared in
 * one place. The day a facets endpoint exists, this constant is what it replaces.
 */
const MEAL_RANGE_MAXIMUMS: Readonly<Record<MealRangeKey, number>> = {
    energy: 1200,
    protein: 100,
    carbohydrate: 150,
    fat: 100,
    price: 100,
    preparationMinutes: 120,
};

/**
 * Which end of the range each slider's single thumb sets.
 *
 * Declared per key rather than assumed, because the side is a property of the question. Energy,
 * carbohydrate, fat, price and time are ceilings — nobody searches for the expensive half of a menu
 * or the slowest thing on it. Protein is a floor: "at least 30 g" is the entire reason that filter
 * exists, and "protein under 30 g" is a filter no one has ever wanted.
 */
const MEAL_RANGE_DIRECTIONS: Readonly<Record<MealRangeKey, SliderDirection>> = {
    energy: 'atMost',
    protein: 'atLeast',
    carbohydrate: 'atMost',
    fat: 'atMost',
    price: 'atMost',
    preparationMinutes: 'atMost',
};

export function MealRangeFilters({
    state,
    currency,
    testID = 'meal-ranges',
}: MealRangeFiltersProps) {
    const { t } = useTranslation();
    const formatter = useFormatter();

    const rows: readonly {
        readonly key: MealRangeKey;
        readonly label: string;
        readonly unit: string;
        readonly step: number;
    }[] = [
        {
            key: 'energy',
            label: t('catalogue:filters.energy'),
            unit: t('catalogue:filters.unitKcal'),
            step: 50,
        },
        {
            key: 'protein',
            label: t('catalogue:filters.protein'),
            unit: t('catalogue:filters.unitGrams'),
            step: 5,
        },
        {
            key: 'carbohydrate',
            label: t('catalogue:filters.carbohydrate'),
            unit: t('catalogue:filters.unitGrams'),
            step: 5,
        },
        {
            key: 'fat',
            label: t('catalogue:filters.fat'),
            unit: t('catalogue:filters.unitGrams'),
            step: 5,
        },
        { key: 'price', label: t('catalogue:filters.price'), unit: currency, step: 5 },
        {
            key: 'preparationMinutes',
            label: t('catalogue:filters.preparationMinutes'),
            unit: t('catalogue:filters.unitMinutes'),
            step: 5,
        },
    ];

    return (
        /*
         * No card and no heading of its own any more: this now renders inside an accordion panel
         * that supplies both. A titled card inside a titled section is a box in a box, and it said
         * "Narrow it by the numbers" twice, once in the header and once four pixels below it.
         */
        <Stack space="md" testID={testID}>
            <Text tone="secondary" variant="caption">
                {t('catalogue:filters.rangesHint')}
            </Text>

            {rows.map((row) => {
                const direction = MEAL_RANGE_DIRECTIONS[row.key];
                const bound =
                    direction === 'atLeast' ? state.values[row.key].min : state.values[row.key].max;
                /*
                 * Composed here rather than inside the control, for the reason every other
                 * figure on this screen is: only a screen knows the locale's numbering system,
                 * and a sentence split around its number does not survive Arabic. "Under 700
                 * kcal" is one interpolated string, not a word, a figure and a word.
                 */
                const readout =
                    bound === null
                        ? t('catalogue:filters.anyValue')
                        : t(
                              direction === 'atLeast'
                                  ? 'catalogue:filters.atLeast'
                                  : 'catalogue:filters.atMost',
                              { value: formatter.formatNumber(bound), unit: row.unit },
                          );

                return (
                    <SliderField
                        key={row.key}
                        testID={`${testID}-${row.key}`}
                        id={`${testID}-${row.key}`}
                        label={row.label}
                        direction={direction}
                        value={bound}
                        min={0}
                        max={MEAL_RANGE_MAXIMUMS[row.key]}
                        step={row.step}
                        unit={row.unit}
                        readout={readout}
                        onChange={(next) => {
                            /*
                             * The slider owns one end, so the other is cleared rather than left
                             * standing: a stale `energyMin` off a shared link would go on
                             * narrowing the grid with nothing on screen able to show it or undo
                             * it. Both parameters are still written, so `?proteinMin=45` and
                             * `?energyMax=500` keep meaning exactly what they always did.
                             */
                            state.set(
                                row.key,
                                direction === 'atLeast'
                                    ? { min: next, max: null }
                                    : { min: null, max: next },
                            );
                        }}
                    />
                );
            })}
        </Stack>
    );
}
