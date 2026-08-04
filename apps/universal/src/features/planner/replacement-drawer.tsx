import {
    Badge,
    Button,
    Callout,
    Card,
    Chip,
    Drawer,
    FilterChip,
    Inline,
    RangeFilter,
    Stack,
    Tabs,
    Text,
    TextInputField,
    useBreakpoint,
} from '@healthy360/design-system';
import type { RangeValue } from '@healthy360/design-system';
import type {
    Kitchen,
    MealFilter,
    MealPlanEntry,
    RecipeFilter,
    ReplacementMode,
} from '@healthy360/api-client/contracts';
import { minorUnitExponent } from '@healthy360/domain-types';
import type {
    AllergenCode,
    DietClassification,
    KitchenId,
    MealPlanId,
    MealType,
    Money,
} from '@healthy360/domain-types';
import { useFormatter } from '@healthy360/i18n';
import { amountValue } from '@healthy360/nutrition';
import type { NutrientTarget, NutritionFacts } from '@healthy360/nutrition';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import {
    useReplaceEntryMutation,
    useReplacementMealsQuery,
    useReplacementRecipesQuery,
} from '../../data/planner-hooks.ts';
import { MedicalDisclaimer } from '../../safety/medical-disclaimer.tsx';
import { formatMoney } from '../marketplace/format.ts';
import { QueryStates } from '../marketplace/query-states.tsx';
import {
    EMPTY_RANGES,
    REPLACEMENT_RANGE_KEYS,
    allergenDifference,
    applyClientRanges,
    dateInstant,
    majorUnits,
    mealCandidates,
    nutritionDifference,
    recipeCandidates,
    replacementCompatibility,
} from './format.ts';
import type {
    Compatibility,
    ReplacementCandidate,
    ReplacementRangeKey,
    ReplacementSource,
} from './format.ts';

/**
 * The replacement drawer.
 *
 * Doc 17, PLN-15 names this as the planner's clearest build-without-precedent item: **neither
 * reference product previews the difference a swap would make.** They both show a list of
 * alternatives and let you find out afterwards. So every row here answers the three questions a
 * person actually has before pressing anything — what changes nutritionally, what it costs, and what
 * it brings into the food — and answers them as *differences*, signed, with the direction in words
 * as well as in the sign so the reading never depends on colour.
 *
 * ## The state is local, and deliberately not in the URL
 *
 * Every other filtered surface in this application keeps its filters in the address bar, because a
 * filtered *listing* is somewhere a person links to and returns to. A replacement search is not: it
 * is scoped to one entry, it is abandoned as often as it is completed, and putting it in the URL
 * would mean a back press closing a drawer sometimes and navigating away from the planner at
 * others. So the drawer owns its own state, it starts from the entry it is replacing, and it is
 * deterministic: the same entry always opens the same drawer.
 *
 * ## Two sources, one comparison
 *
 * Marketplace meals and home-prepared recipes are separate tabs because they are separate decisions
 * — one arrives cooked and one costs an evening — but the difference arithmetic is identical for
 * both, computed against the entry's own portion factor so the preview describes the entry that
 * would actually be created (`replaceEntry` keeps the portion unless one is passed).
 *
 * ## What this cannot claim, and says so
 *
 * No consumer contract publishes the person's declared allergies. So the allergen preview reports
 * what the candidate **introduces relative to the current entry** — a fact it can verify — and never
 * asserts "you are allergic to this". The allergen-exclusion filter is the real defence, and the
 * entry that comes back from `replaceEntry` carries the server-derived warning if one applies.
 *
 * ## Recipe filtering is partly client-side, and that is a contract gap
 *
 * `RecipeFilter` publishes query, meal types, cuisines, diets, allergen exclusion, energy, protein,
 * total minutes and complexity — but no carbohydrate, fat or price band, which `MealFilter` has.
 * Those three are applied here over the returned page so the two tabs offer the same controls, and
 * the gap is recorded in the wave report rather than hidden by removing the controls.
 */

/** The fourteen allergen groups EU, UK and GCC labelling regimes require to be declared. */
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

const MEAL_TYPE_OPTIONS: readonly MealType[] = ['breakfast', 'lunch', 'snack', 'dinner'];

const DIET_OPTIONS: readonly DietClassification[] = [
    'omnivore',
    'vegetarian',
    'vegan',
    'pescatarian',
    'high_protein',
    'low_carb',
    'mediterranean',
    'gluten_free',
];

export interface ReplacementDrawerProps {
    readonly planId: MealPlanId;
    /** `null` closes the drawer. Opening it with an entry resets every filter. */
    readonly entry: MealPlanEntry | null;
    readonly onClose: () => void;
    readonly onAnnounce: (message: string) => void;
    readonly kitchens?: readonly Kitchen[] | undefined;
    /** The day this entry sits in, so compatibility can check the day's energy after the swap. */
    readonly dayPlanned?: NutritionFacts | undefined;
    readonly targets?: readonly NutrientTarget[] | undefined;
    readonly testID?: string | undefined;
}

export function ReplacementDrawer({
    planId,
    entry,
    onClose,
    onAnnounce,
    kitchens,
    dayPlanned,
    targets,
    testID = 'planner-replace',
}: ReplacementDrawerProps) {
    const { t } = useTranslation();
    const formatter = useFormatter();
    const { atLeast } = useBreakpoint();

    const [source, setSource] = useState<ReplacementSource>('kitchen_meal');
    const [query, setQuery] = useState('');
    const [kitchenIds, setKitchenIds] = useState<readonly KitchenId[]>([]);
    const [mealTypes, setMealTypes] = useState<readonly MealType[]>([]);
    const [diets, setDiets] = useState<readonly DietClassification[]>([]);
    const [excluded, setExcluded] = useState<readonly string[]>([]);
    const [ranges, setRanges] =
        useState<Readonly<Record<ReplacementRangeKey, RangeValue>>>(EMPTY_RANGES);
    const [mode, setMode] = useState<ReplacementMode>('once');

    const replace = useReplaceEntryMutation();

    const open = entry !== null;
    const portionFactor = entry?.portionFactor ?? 1;
    const currency = entry?.estimatedCost?.currency ?? 'USD';
    const priceScale = 10 ** minorUnitExponent(currency);

    const setRange = (key: ReplacementRangeKey, value: RangeValue) => {
        setRanges((current) => ({ ...current, [key]: value }));
    };

    const clearFilters = () => {
        setQuery('');
        setKitchenIds([]);
        setMealTypes([]);
        setDiets([]);
        setExcluded([]);
        setRanges(EMPTY_RANGES);
    };

    const band = (value: RangeValue, scale = 1): { min?: number; max?: number } | undefined => {
        const min = value.min === null ? undefined : value.min * scale;
        const max = value.max === null ? undefined : value.max * scale;
        if (min === undefined && max === undefined) return undefined;
        return { ...(min === undefined ? {} : { min }), ...(max === undefined ? {} : { max }) };
    };

    const mealFilter: Omit<MealFilter, 'cursor'> = useMemo(
        () => ({
            limit: 12,
            ...(query.trim() === '' ? {} : { query: query.trim() }),
            ...(kitchenIds.length === 0 ? {} : { kitchenIds }),
            ...(mealTypes.length === 0 ? {} : { mealTypes }),
            ...(diets.length === 0 ? {} : { dietClassifications: diets }),
            ...(excluded.length === 0
                ? {}
                : { excludeAllergens: excluded as readonly AllergenCode[] }),
            ...(band(ranges.energy) === undefined ? {} : { energy: band(ranges.energy) }),
            ...(band(ranges.protein) === undefined ? {} : { protein: band(ranges.protein) }),
            ...(band(ranges.carbohydrate) === undefined
                ? {}
                : { carbohydrate: band(ranges.carbohydrate) }),
            ...(band(ranges.fat) === undefined ? {} : { fat: band(ranges.fat) }),
            ...(band(ranges.price, priceScale) === undefined
                ? {}
                : { price: band(ranges.price, priceScale) }),
            ...(band(ranges.preparationMinutes) === undefined
                ? {}
                : { preparationMinutes: band(ranges.preparationMinutes) }),
        }),
        [query, kitchenIds, mealTypes, diets, excluded, ranges, priceScale],
    );

    const recipeFilter: RecipeFilter = useMemo(
        () => ({
            limit: 12,
            ...(query.trim() === '' ? {} : { query: query.trim() }),
            ...(mealTypes.length === 0 ? {} : { mealTypes }),
            ...(diets.length === 0 ? {} : { dietClassifications: diets }),
            ...(excluded.length === 0
                ? {}
                : { excludeAllergens: excluded as readonly AllergenCode[] }),
            ...(band(ranges.energy) === undefined ? {} : { energy: band(ranges.energy) }),
            ...(band(ranges.protein) === undefined ? {} : { protein: band(ranges.protein) }),
            ...(band(ranges.preparationMinutes) === undefined
                ? {}
                : { totalMinutes: band(ranges.preparationMinutes) }),
        }),
        [query, mealTypes, diets, excluded, ranges],
    );

    const meals = useReplacementMealsQuery(
        planId,
        entry?.id ?? null,
        mealFilter,
        open && source === 'kitchen_meal',
    );
    const recipes = useReplacementRecipesQuery(
        planId,
        entry?.id ?? null,
        recipeFilter,
        open && source === 'recipe',
    );

    const activeQuery = source === 'kitchen_meal' ? meals : recipes;

    const candidates = useMemo<readonly ReplacementCandidate[]>(() => {
        if (source === 'kitchen_meal') {
            return mealCandidates(meals.data?.items ?? [], portionFactor);
        }
        return applyClientRanges(
            recipeCandidates(recipes.data?.items ?? [], portionFactor),
            ranges,
            priceScale,
        );
    }, [source, meals.data, recipes.data, portionFactor, ranges, priceScale]);

    const onReplace = (candidate: ReplacementCandidate, chosen: ReplacementMode) => {
        if (entry === null) return;
        replace.mutate(
            {
                planId,
                entryId: entry.id,
                request: {
                    mode: chosen,
                    kind: candidate.source,
                    ...(candidate.mealId === undefined ? {} : { mealId: candidate.mealId }),
                    ...(candidate.recipeId === undefined ? {} : { recipeId: candidate.recipeId }),
                },
            },
            {
                onSuccess: (replaced) => {
                    onAnnounce(
                        t(
                            chosen === 'recurring'
                                ? 'planner:announce.replacedRecurring'
                                : 'planner:announce.replaced',
                            {
                                slot: t('planner:card.slot', {
                                    mealType: t(`marketplace:mealTypes.${entry.mealType}`),
                                    day: formatter.formatDate(dateInstant(entry.date), {
                                        weekday: 'long',
                                    }),
                                }),
                                meal: candidate.name,
                                items: replaced.length,
                            },
                        ),
                    );
                    onClose();
                },
            },
        );
    };

    const filtered =
        query !== '' ||
        kitchenIds.length > 0 ||
        mealTypes.length > 0 ||
        diets.length > 0 ||
        excluded.length > 0 ||
        REPLACEMENT_RANGE_KEYS.some((key) => ranges[key].min !== null || ranges[key].max !== null);

    return (
        <Drawer
            testID={testID}
            open={open}
            onClose={onClose}
            placement={atLeast('lg') ? 'end' : 'bottom'}
            title={
                entry === null
                    ? t('planner:replace.title')
                    : t('planner:replace.titleFor', { meal: entry.label })
            }
            className={atLeast('lg') ? 'w-[520px] max-w-[95vw]' : undefined}
        >
            {entry === null ? null : (
                <Stack space="md" testID={`${testID}-body`}>
                    <Callout
                        testID={`${testID}-current`}
                        role="note"
                        tone="info"
                        icon="info"
                        title={t('planner:replace.currentTitle', { meal: entry.label })}
                        body={t('planner:replace.currentBody', {
                            energy: formatter.formatNumber(
                                Math.round(amountValue(entry.nutrition, 'energy')),
                            ),
                            protein: formatter.formatNumber(
                                Math.round(amountValue(entry.nutrition, 'protein')),
                            ),
                            cost:
                                entry.estimatedCost === null
                                    ? t('planner:card.costUnknown')
                                    : formatMoney(formatter, entry.estimatedCost),
                        })}
                    />

                    <Tabs
                        testID={`${testID}-source`}
                        label={t('planner:replace.sourceLabel')}
                        variant="segmented"
                        block
                        value={source}
                        onChange={setSource}
                        items={[
                            {
                                value: 'kitchen_meal',
                                label: t('planner:replace.sourceMeals'),
                                testID: `${testID}-source-meals`,
                            },
                            {
                                value: 'recipe',
                                label: t('planner:replace.sourceRecipes'),
                                testID: `${testID}-source-recipes`,
                            },
                        ]}
                    />

                    <TextInputField
                        testID={`${testID}-search`}
                        id={`${testID}-search`}
                        label={t('planner:replace.searchLabel')}
                        placeholder={t('planner:replace.searchPlaceholder')}
                        value={query}
                        onChangeText={setQuery}
                    />

                    <Stack space="sm" testID={`${testID}-filters`}>
                        {source === 'kitchen_meal' && kitchens !== undefined ? (
                            <Stack space="xs" testID={`${testID}-filter-kitchen`}>
                                <Text variant="label">{t('planner:replace.filterKitchen')}</Text>
                                <Inline space="xs" wrap>
                                    {kitchens.map((kitchen) => (
                                        <FilterChip
                                            key={String(kitchen.id)}
                                            testID={`${testID}-kitchen-${String(kitchen.id)}`}
                                            label={kitchen.name}
                                            selected={kitchenIds.includes(kitchen.id)}
                                            onChange={(next) => {
                                                setKitchenIds((current) =>
                                                    next
                                                        ? [...current, kitchen.id]
                                                        : current.filter((id) => id !== kitchen.id),
                                                );
                                            }}
                                        />
                                    ))}
                                </Inline>
                            </Stack>
                        ) : null}

                        <Stack space="xs" testID={`${testID}-filter-meal-type`}>
                            <Text variant="label">{t('planner:replace.filterMealType')}</Text>
                            <Inline space="xs" wrap>
                                {MEAL_TYPE_OPTIONS.map((mealType) => (
                                    <FilterChip
                                        key={mealType}
                                        testID={`${testID}-meal-type-${mealType}`}
                                        label={t(`marketplace:mealTypes.${mealType}`)}
                                        selected={mealTypes.includes(mealType)}
                                        onChange={(next) => {
                                            setMealTypes((current) =>
                                                next
                                                    ? [...current, mealType]
                                                    : current.filter((item) => item !== mealType),
                                            );
                                        }}
                                    />
                                ))}
                            </Inline>
                        </Stack>

                        <Stack space="xs" testID={`${testID}-filter-diet`}>
                            <Text variant="label">{t('planner:replace.filterDiet')}</Text>
                            <Inline space="xs" wrap>
                                {DIET_OPTIONS.map((diet) => (
                                    <FilterChip
                                        key={diet}
                                        testID={`${testID}-diet-${diet}`}
                                        label={t(`marketplace:diets.${diet}`)}
                                        selected={diets.includes(diet)}
                                        onChange={(next) => {
                                            setDiets((current) =>
                                                next
                                                    ? [...current, diet]
                                                    : current.filter((item) => item !== diet),
                                            );
                                        }}
                                    />
                                ))}
                            </Inline>
                        </Stack>

                        <Stack space="xs" testID={`${testID}-filter-allergens`}>
                            <Text variant="label">{t('planner:replace.filterAllergens')}</Text>
                            <Text variant="caption" tone="secondary">
                                {t('planner:replace.filterAllergensHint')}
                            </Text>
                            <Inline space="xs" wrap>
                                {ALLERGEN_CODES.map((code) => (
                                    <FilterChip
                                        key={code}
                                        testID={`${testID}-allergen-${code}`}
                                        label={t(`marketplace:allergens.${code}`)}
                                        selected={excluded.includes(code)}
                                        onChange={(next) => {
                                            setExcluded((current) =>
                                                next
                                                    ? [...current, code]
                                                    : current.filter((item) => item !== code),
                                            );
                                        }}
                                    />
                                ))}
                            </Inline>
                        </Stack>

                        <RangeFilter
                            testID={`${testID}-range-energy`}
                            id={`${testID}-range-energy`}
                            label={t('planner:replace.rangeEnergy')}
                            unit={t('planner:common.unitKcal')}
                            step={50}
                            bounds={{ min: 0 }}
                            value={ranges.energy}
                            onChange={(next) => {
                                setRange('energy', next);
                            }}
                        />
                        <RangeFilter
                            testID={`${testID}-range-protein`}
                            id={`${testID}-range-protein`}
                            label={t('planner:replace.rangeProtein')}
                            unit={t('planner:common.unitGrams')}
                            step={5}
                            bounds={{ min: 0 }}
                            value={ranges.protein}
                            onChange={(next) => {
                                setRange('protein', next);
                            }}
                        />
                        <RangeFilter
                            testID={`${testID}-range-carbohydrate`}
                            id={`${testID}-range-carbohydrate`}
                            label={t('planner:replace.rangeCarbohydrate')}
                            unit={t('planner:common.unitGrams')}
                            step={5}
                            bounds={{ min: 0 }}
                            value={ranges.carbohydrate}
                            onChange={(next) => {
                                setRange('carbohydrate', next);
                            }}
                        />
                        <RangeFilter
                            testID={`${testID}-range-fat`}
                            id={`${testID}-range-fat`}
                            label={t('planner:replace.rangeFat')}
                            unit={t('planner:common.unitGrams')}
                            step={5}
                            bounds={{ min: 0 }}
                            value={ranges.fat}
                            onChange={(next) => {
                                setRange('fat', next);
                            }}
                        />
                        <RangeFilter
                            testID={`${testID}-range-price`}
                            id={`${testID}-range-price`}
                            label={t('planner:replace.rangePrice')}
                            unit={currency}
                            step={5}
                            bounds={{ min: 0 }}
                            value={ranges.price}
                            onChange={(next) => {
                                setRange('price', next);
                            }}
                        />
                        <RangeFilter
                            testID={`${testID}-range-preparation`}
                            id={`${testID}-range-preparation`}
                            label={t('planner:replace.rangePreparation')}
                            unit={t('planner:common.unitMinutes')}
                            step={5}
                            bounds={{ min: 0 }}
                            value={ranges.preparationMinutes}
                            onChange={(next) => {
                                setRange('preparationMinutes', next);
                            }}
                        />

                        {filtered ? (
                            <Button
                                testID={`${testID}-clear`}
                                size="sm"
                                variant="ghost"
                                label={t('planner:replace.clearFilters')}
                                onPress={clearFilters}
                            />
                        ) : null}
                    </Stack>

                    <Tabs
                        testID={`${testID}-mode`}
                        label={t('planner:replace.modeLabel')}
                        variant="segmented"
                        block
                        value={mode}
                        onChange={setMode}
                        items={[
                            {
                                value: 'once',
                                label: t('planner:replace.modeOnce'),
                                testID: `${testID}-mode-once`,
                            },
                            {
                                value: 'recurring',
                                label: t('planner:replace.modeRecurring'),
                                testID: `${testID}-mode-recurring`,
                            },
                        ]}
                    />
                    <Text testID={`${testID}-mode-explanation`} variant="caption" tone="secondary">
                        {mode === 'recurring'
                            ? t('planner:replace.modeRecurringExplanation', {
                                  mealType: t(`marketplace:mealTypes.${entry.mealType}`),
                              })
                            : t('planner:replace.modeOnceExplanation')}
                    </Text>

                    {replace.isError ? (
                        <Callout
                            testID={`${testID}-error`}
                            role="alert"
                            tone="danger"
                            icon="error"
                            title={t('planner:replace.errorTitle')}
                            body={t('planner:replace.errorBody')}
                        />
                    ) : null}

                    <QueryStates
                        query={activeQuery}
                        isEmpty={candidates.length === 0}
                        emptyTitle={t('planner:replace.emptyTitle')}
                        emptyBody={t('planner:replace.emptyBody')}
                        emptyActions={
                            filtered ? (
                                <Button
                                    testID={`${testID}-empty-clear`}
                                    variant="secondary"
                                    label={t('planner:replace.clearFilters')}
                                    onPress={clearFilters}
                                />
                            ) : undefined
                        }
                        skeletonCount={2}
                        testID={`${testID}-results`}
                    >
                        <Stack space="sm" testID={`${testID}-candidates`}>
                            {candidates.map((candidate) => (
                                <CandidateRow
                                    key={candidate.key}
                                    testID={`${testID}-candidate-${candidate.key}`}
                                    entry={entry}
                                    candidate={candidate}
                                    mode={mode}
                                    busy={replace.isPending}
                                    {...(dayPlanned === undefined ? {} : { dayPlanned })}
                                    {...(targets === undefined ? {} : { targets })}
                                    onReplace={onReplace}
                                />
                            ))}
                        </Stack>
                    </QueryStates>

                    <MedicalDisclaimer />
                </Stack>
            )}
        </Drawer>
    );
}

/* ── one candidate ───────────────────────────────────────────────────────────────────────────── */

const COMPATIBILITY_TONE: Readonly<
    Record<Compatibility['level'], 'success' | 'warning' | 'danger'>
> = {
    fits: 'success',
    check: 'warning',
    conflict: 'danger',
};

interface CandidateRowProps {
    readonly entry: MealPlanEntry;
    readonly candidate: ReplacementCandidate;
    readonly mode: ReplacementMode;
    readonly busy: boolean;
    readonly dayPlanned?: NutritionFacts | undefined;
    readonly targets?: readonly NutrientTarget[] | undefined;
    readonly onReplace: (candidate: ReplacementCandidate, mode: ReplacementMode) => void;
    readonly testID: string;
}

function CandidateRow({
    entry,
    candidate,
    mode,
    busy,
    dayPlanned,
    targets,
    onReplace,
    testID,
}: CandidateRowProps) {
    const { t } = useTranslation();
    const formatter = useFormatter();

    const differences = nutritionDifference(entry.nutrition, candidate.facts);
    const allergens = allergenDifference(entry.allergens, candidate.allergens);
    const compatibility = replacementCompatibility({
        entry,
        candidateFacts: candidate.facts,
        candidateAllergens: candidate.allergens,
        candidateMealTypes: candidate.mealTypes,
        ...(dayPlanned === undefined ? {} : { dayPlanned }),
        ...(targets === undefined ? {} : { targets }),
    });

    const costBefore = entry.estimatedCost;
    const costAfter = candidate.estimatedCost;
    const comparableCost =
        costBefore !== null && costAfter !== null && costBefore.currency === costAfter.currency;
    const costDelta = comparableCost ? costAfter.amount - costBefore.amount : null;

    const signWord = (delta: number): string =>
        delta > 0
            ? t('planner:difference.more')
            : delta < 0
              ? t('planner:difference.less')
              : t('planner:difference.same');

    return (
        <Card testID={testID} padding="md" tone="raised">
            <Stack space="sm">
                <Stack space="none">
                    <Text testID={`${testID}-name`} variant="bodyStrong">
                        {candidate.name}
                    </Text>
                    <Text variant="caption" tone="secondary">
                        {candidate.kitchenName === null
                            ? t('planner:replace.homePrepared')
                            : t('planner:replace.fromKitchen', {
                                  kitchen: candidate.kitchenName,
                              })}
                    </Text>
                </Stack>

                <Inline space="xs" wrap>
                    <Badge
                        testID={`${testID}-compatibility`}
                        tone={COMPATIBILITY_TONE[compatibility.level]}
                        icon={compatibility.level === 'fits' ? 'success' : 'warning'}
                        label={t(`planner:replace.compatibility.${compatibility.level}`)}
                    />
                    {candidate.preparationMinutes === null ? null : (
                        <Chip
                            testID={`${testID}-prep`}
                            tone="neutral"
                            label={t('planner:card.preparationMinutes', {
                                minutes: formatter.formatNumber(candidate.preparationMinutes),
                            })}
                        />
                    )}
                </Inline>

                {compatibility.reasons.length === 0 ? null : (
                    <Stack space="none" testID={`${testID}-compatibility-reasons`}>
                        {compatibility.reasons.map((reason) => (
                            <Text key={reason} variant="caption" tone="secondary">
                                {t(`planner:replace.reasons.${reason}`)}
                            </Text>
                        ))}
                    </Stack>
                )}

                <Stack space="none" testID={`${testID}-nutrition-difference`}>
                    <Text variant="label">{t('planner:difference.nutritionTitle')}</Text>
                    {differences.map((difference) => (
                        <Text
                            key={difference.nutrientId}
                            testID={`${testID}-difference-${difference.nutrientId}`}
                            variant="caption"
                            tone={
                                difference.sign === 'same'
                                    ? 'secondary'
                                    : difference.sign === 'up'
                                      ? 'warning'
                                      : 'success'
                            }
                        >
                            {t('planner:difference.line', {
                                nutrient: t(`marketplace:nutrients.${difference.nutrientId}`),
                                before: formatter.formatNumber(difference.before),
                                after: formatter.formatNumber(difference.after),
                                delta: formatter.formatNumber(difference.delta, {
                                    signDisplay: 'exceptZero',
                                }),
                                direction: signWord(difference.delta),
                            })}
                        </Text>
                    ))}
                </Stack>

                <Text testID={`${testID}-cost-difference`} variant="caption" tone="secondary">
                    {costDelta === null
                        ? t('planner:difference.costUnknown')
                        : t('planner:difference.cost', {
                              before: formatMoney(formatter, costBefore as Money),
                              after: formatMoney(formatter, costAfter as Money),
                              delta: formatter.formatCurrency(
                                  majorUnits({
                                      amount: costDelta,
                                      currency: (costAfter as Money).currency,
                                  }),
                                  (costAfter as Money).currency,
                                  { signDisplay: 'exceptZero' },
                              ),
                              direction: signWord(costDelta),
                          })}
                </Text>

                {allergens.introduced.length > 0 ? (
                    <Callout
                        testID={`${testID}-allergen-difference`}
                        role="alert"
                        tone="danger"
                        icon="warning"
                        title={t('planner:difference.allergensIntroducedTitle')}
                        body={t('planner:difference.allergensIntroducedBody', {
                            allergens: allergens.introduced
                                .map((code) => t(`marketplace:allergens.${code}`))
                                .join(t('planner:common.listSeparator')),
                        })}
                    />
                ) : (
                    <Text
                        testID={`${testID}-allergen-difference`}
                        variant="caption"
                        tone="secondary"
                    >
                        {allergens.removed.length > 0
                            ? t('planner:difference.allergensRemoved', {
                                  allergens: allergens.removed
                                      .map((code) => t(`marketplace:allergens.${code}`))
                                      .join(t('planner:common.listSeparator')),
                              })
                            : t('planner:difference.allergensSame')}
                    </Text>
                )}

                <Inline space="xs" wrap>
                    <Button
                        testID={`${testID}-replace-once`}
                        size="sm"
                        label={t('planner:replace.replaceOnce')}
                        disabled={busy}
                        onPress={() => {
                            onReplace(candidate, 'once');
                        }}
                    />
                    <Button
                        testID={`${testID}-replace-recurring`}
                        size="sm"
                        variant="secondary"
                        label={t('planner:replace.replaceRecurring')}
                        disabled={busy}
                        onPress={() => {
                            onReplace(candidate, 'recurring');
                        }}
                    />
                </Inline>
                <Text variant="caption" tone="secondary">
                    {mode === 'recurring'
                        ? t('planner:replace.modeRecurringHint')
                        : t('planner:replace.modeOnceHint')}
                </Text>
            </Stack>
        </Card>
    );
}
