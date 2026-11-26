import type {
    IngredientAdmin,
    RecipeAdminSummary,
    RecipeLine,
    RecipePackagingLine,
    RecipeVersionAdmin,
} from '@healthy360/api-client/contracts';
import {
    Badge,
    Button,
    Cascade,
    compareNumber,
    compareText,
    EmptyState,
    ErrorState,
    Heading,
    Icon,
    IconButton,
    InfoTip,
    Inline,
    QuantityInput,
    SearchInput,
    SegmentedControl,
    Skeleton,
    Stack,
    TableSkeleton,
    Text,
    useColumnControls,
} from '@healthy360/design-system';
import type {
    ColumnControls,
    ColumnFilter,
    ControlledColumn,
    DataTableColumn,
} from '@healthy360/design-system';
import { RecipeId } from '@healthy360/domain-types';
import { useFormatter, useLocale } from '@healthy360/i18n';
import type { TFunction } from 'i18next';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, ScrollView, View } from 'react-native';

import { Gate, useCan } from '../../../access/gate.tsx';
import { toFailure } from '../../../data/hooks.ts';
import {
    recipesFromPages,
    useRecipeQuery,
    useAllRecipesQuery,
} from '../../../data/kitchen-admin-hooks.ts';
import { withQuery } from '../../../navigation/return-to.ts';
import { batchFactor, scaleLine, scalePackaging, withWaste } from '../batch-scaling.ts';
import type { BatchMode } from '../batch-scaling.ts';
import { LensFigureCell } from '../catalogue/lens-bar.tsx';
import type { LensFigure } from '../catalogue/lens-bar.tsx';
import {
    CATALOGUE_VIEW_PERMISSION,
    PRODUCTION_MANAGE_PERMISSION,
    RECIPE_VIEW_PERMISSION,
} from '../entity-registry.ts';
import { displayName, parseQuantity, statusShortKey, unitShortKey } from '../format.ts';
import { BATCH_QUANTITY_FORMAT, useBatchIngredients } from '../operations/batch-sheet.tsx';
import { usePrintSheet } from '../print-sheet.tsx';
import { ProductionTable, ProductionTableSection } from '../production-desk/production-table.tsx';

/**
 * `/kitchen/batch` — the batch calculator (batch planner canvas, option C, 2026-11-15).
 *
 * ```
 * ┌ Plan ─────────────────────┐ ┌──────────────────────────────────────────────────────────────┐
 * │ (1) Recipe                │ │ Crispy Chicken Marination          [Print sheet] [+ Start batch] │
 * │ [⌕ Search recipes      ]  │ │ [Version v1 Published] [● Batches 2 ×1.857]                  │
 * │ ▌Crispy Chicken  RC-0004  │ │ [Portions 260]         [Total weight 13.6 Kg +5 % waste]     │
 * │  Classic Sauce   RC-0001  │ └──────────────────────────────────────────────────────────────┘
 * │ (2) How much              │ ┌ To issue  12 lines ──────────────────────────────────────────┐
 * │ [ Weight (Kg) | Portions ]│ │ REF.   ITEM   UNIT   PER BATCH   TO ISSUE                    │
 * │ (−) [Target 260 portions] (+) │ ING-1  Flour  Kg     1.2         2.229                      │
 * │ (1 batch)(2 batches)(3)(5)│ └──────────────────────────────────────────────────────────────┘
 * └───────────────────────────┘   Packaging — none recorded
 * ```
 *
 * ## The plan on the left, the result on the right
 *
 * The recipe is a list rather than a dropdown, so choosing one is one press and the chosen one stays
 * in view. The target has a stepper and four whole-batch chips: most plans are "two batches", and a
 * chip says so without arithmetic. Switching between weight and portions restates the target in the
 * other unit, so the plan does not change under the switch.
 *
 * The summary card names the recipe and carries the figures as the list pages' chips — four of them,
 * in one row when the content is wide (the page panel closed) and two rows of two when it is not.
 *
 * ## "Batches" and Start
 *
 * "Batches" is the factor rounded up — a kitchen runs whole batches — and its note keeps the exact
 * factor, because every quantity is scaled by the exact factor. Start opens New batch at that exact
 * factor (the user's choice, 2026-11-15), so the batch reserves what the To issue list shows; the
 * form's Cancel comes back here with the plan intact (`returnTo` carries it).
 *
 * ## No tick column
 *
 * The board drew a tick per line, to check lines off while weighing out. The user took it out on
 * 2026-11-18: the list is a sheet to read, and nothing on it is deducted until a batch is booked.
 *
 * ## Every figure is arithmetic on one version
 *
 * There is no scaling endpoint. The current version states what it makes, so the factor is a
 * division and every row a multiplication, with the version's waste rate on top — the same rule a
 * production batch reserves by, so the two screens agree for the same yield (`batch-scaling.ts`,
 * `withWaste`). Names come from the catalogue by id, which is why the `<Gate>` demands
 * `catalogue.view_organisation` beside `recipe.view_organisation`.
 *
 * ## One unit per row, no shelf column
 *
 * The table has a single Unit column for both "Per batch" and "To issue". What is on the shelf
 * belongs to the production editor, where a batch is actually started against a branch.
 */
export function BatchPlannerScreen() {
    return (
        <Gate
            area="kitchen"
            requirement={{ allOf: [RECIPE_VIEW_PERMISSION, CATALOGUE_VIEW_PERMISSION] }}
            testID="kitchen-batch-planner"
        >
            <BatchPlanner />
        </Gate>
    );
}

/** Below this a packaging figure was not rounded — it is floating-point noise, not a whole box. */
const ROUNDED_TOLERANCE = 1e-6;

/** The plan card's width on the canvas. */
const PLAN_WIDTH = 340;

/** About six recipes before the list scrolls, so the How much step stays on screen. */
const RECIPE_LIST_MAX_HEIGHT = 330;

/** The chips a kitchen reaches for most: whole batches. */
const QUICK_BATCHES = [1, 2, 3, 5] as const;

/** Below this per chip the summary's four chips go to two rows of two. */
const SUMMARY_CHIP_MIN = 220;

/** The gap between the summary's chips (`gap-2`). */
const SUMMARY_GAP = 8;

/**
 * Every sheet column's width. The same for all, because the list shares its spare room in
 * proportion to width: equal widths give equal columns rather than a wide Item with a gap after it.
 */
const SHEET_COLUMN_WIDTH = 120;

const NO_LINES: readonly RecipeLine[] = [];

const PLANNER_PATH = '/kitchen/batch';
const NEW_BATCH_PATH = '/kitchen/production-desk/new';

/** A figure typed or set by a button, as the target field holds it: at most three decimals. */
function targetText(value: number): string {
    return value > 0 ? String(Math.round(value * 1000) / 1000) : '';
}

function BatchPlanner() {
    const { t } = useTranslation();
    const { locale } = useLocale();
    const formatter = useFormatter();
    const router = useRouter();
    const print = usePrintSheet();
    const canStart = useCan(PRODUCTION_MANAGE_PERMISSION);

    // Back from New batch's Cancel: the plan that was handed over, read once as the initial state.
    const params = useLocalSearchParams<{
        readonly recipe?: string;
        readonly basis?: string;
        readonly target?: string;
    }>();
    const [recipeId, setRecipeId] = useState<RecipeId | null>(() =>
        typeof params.recipe === 'string' ? RecipeId.safeParse(params.recipe) : null,
    );
    const [modeChoice, setModeChoice] = useState<BatchMode>(() =>
        params.basis === 'pieces' ? 'pieces' : 'yield',
    );
    const [target, setTarget] = useState(() =>
        typeof params.target === 'string' ? params.target : '',
    );
    const [query, setQuery] = useState('');

    // No status filter, matching the recipe list's own default: a kitchen cooks its drafts.
    // ponytail: one 100-row page, searched in memory. A longer book wants `query` pushed into the
    // filter and refetched as the reader types, as the recipe list does.
    const recipes = useAllRecipesQuery();
    const recipeRows = useMemo(() => recipesFromPages(recipes.data?.pages), [recipes.data]);

    const record = useRecipeQuery(recipeId);
    const version = record.data?.currentVersion ?? null;
    const ingredients = useBatchIngredients(version);

    /**
     * The mode in force, derived rather than stored: a recipe that does not count in portions can
     * only be planned by yield, and resetting the choice in an effect would lose it on the way past.
     */
    const mode: BatchMode = version === null || version.yieldPieces === null ? 'yield' : modeChoice;
    const factor = version === null ? null : batchFactor(version, mode, parseQuantity(target));
    const planned = version !== null && factor !== null;

    const sheet = useSheetColumns(version, factor ?? 1, ingredients);
    const lines = useColumnControls(
        planned ? version.lines : NO_LINES,
        sheet.lineColumns,
        'kitchen-batch-ingredients',
    );

    const recipesFailure = toFailure(recipes.error);
    const recordFailure = toFailure(record.error);
    const number = (value: number): string => formatter.formatNumber(value, BATCH_QUANTITY_FORMAT);
    // Kilograms until a recipe says otherwise, so the basis never loses its unit.
    const yieldUnitLabel = t(unitShortKey(version?.yieldUnit ?? 'kg'));
    // One batch in the mode's own unit: what the quick chips and the stepper count in.
    const base =
        version === null ? null : mode === 'pieces' ? version.yieldPieces : version.yieldQuantity;
    const step = mode === 'pieces' ? 10 : 1;
    const typed = parseQuantity(target) ?? 0;

    /** Restates the target in the other unit, so switching the basis keeps the plan. */
    const switchMode = (next: BatchMode) => {
        if (next === mode) return;
        setModeChoice(next);
        if (!planned || version.yieldPieces === null) return;
        setTarget(
            targetText(
                next === 'pieces' ? factor * version.yieldPieces : factor * version.yieldQuantity,
            ),
        );
    };

    const needle = query.trim().toLocaleLowerCase(locale);
    const shownRecipes =
        needle === ''
            ? recipeRows
            : recipeRows.filter(
                  (row) =>
                      displayName(row.name, locale)
                          .value.toLocaleLowerCase(locale)
                          .includes(needle) ||
                      (row.reference ?? '').toLocaleLowerCase(locale).includes(needle),
              );

    const startBatch = () => {
        if (!planned || recipeId === null) return;
        const here = withQuery(PLANNER_PATH, {
            recipe: String(recipeId),
            basis: mode,
            target,
        });
        /*
         * New batch counts its yield in the output's unit and plans against the published version.
         * When this version is that one, the yield is handed over in the output's unit and the form
         * opens with it typed in; otherwise the exact factor, which means the same on both pages.
         */
        const output =
            version.status === 'published'
                ? (version.outputs.find((candidate) => candidate.isPrimary) ?? version.outputs[0])
                : undefined;
        router.push(
            withQuery(NEW_BATCH_PATH, {
                recipe: String(recipeId),
                ...(output !== undefined && output.quantity > 0
                    ? { yield: targetText(factor * output.quantity) }
                    : { runs: targetText(factor) }),
                returnTo: here,
            }) as never,
        );
    };

    return (
        <Cascade space="md" testID="kitchen-batch-planner-screen">
            {recipesFailure !== null ? (
                <ErrorState
                    testID="kitchen-batch-planner-recipes-error"
                    failure={recipesFailure}
                    title={t('kitchen:ops.batch.recipesErrorTitle')}
                    onRetry={() => {
                        void recipes.refetch();
                    }}
                    retrying={recipes.isFetching}
                />
            ) : (
                <View className="flex-row flex-wrap items-start gap-3">
                    {/* ── The plan ─────────────────────────────────────────────────────────── */}
                    <View
                        testID="kitchen-batch-plan"
                        role="region"
                        aria-label={t('kitchen:ops.batch.planLabel')}
                        className="gap-[18px] rounded-[22px] border border-stroke-subtle bg-surface-raised p-[18px]"
                        style={{ width: PLAN_WIDTH }}
                    >
                        <View className="gap-2.5">
                            <PlanStep number={1} title={t('kitchen:ops.batch.recipeLabel')} />
                            <SearchInput
                                testID="kitchen-batch-recipe-search"
                                size="sm"
                                label={t('kitchen:ops.batch.searchRecipes')}
                                placeholder={t('kitchen:ops.batch.searchRecipes')}
                                value={query}
                                onChangeText={setQuery}
                            />
                            <ScrollView
                                testID="kitchen-batch-recipe"
                                role="radiogroup"
                                aria-label={t('kitchen:ops.batch.recipeLabel')}
                                style={{ maxHeight: RECIPE_LIST_MAX_HEIGHT }}
                                contentContainerClassName="gap-0.5"
                            >
                                {recipes.isPending ? (
                                    <Stack space="xs" testID="kitchen-batch-recipe-loading">
                                        <Skeleton
                                            heightClassName="h-[54px]"
                                            widthClassName="w-full"
                                        />
                                        <Skeleton
                                            heightClassName="h-[54px]"
                                            widthClassName="w-full"
                                        />
                                        <Skeleton
                                            heightClassName="h-[54px]"
                                            widthClassName="w-full"
                                        />
                                    </Stack>
                                ) : shownRecipes.length === 0 ? (
                                    <Text
                                        testID="kitchen-batch-recipe-none"
                                        variant="caption"
                                        tone="secondary"
                                        className="px-3 py-2"
                                    >
                                        {t('kitchen:ops.batch.noRecipeMatch')}
                                    </Text>
                                ) : (
                                    shownRecipes.map((row) => (
                                        <RecipeOption
                                            key={String(row.id)}
                                            row={row}
                                            selected={row.id === recipeId}
                                            // The chosen one says what a batch makes once it is read.
                                            batch={
                                                row.id === recipeId && version !== null
                                                    ? batchLine(version, yieldUnitLabel, number, t)
                                                    : null
                                            }
                                            onPress={() => {
                                                setRecipeId(row.id);
                                            }}
                                        />
                                    ))
                                )}
                            </ScrollView>
                        </View>

                        <View className="gap-2.5">
                            <PlanStep number={2} title={t('kitchen:ops.batch.howMuch')} />
                            <View className="flex-row items-center gap-1.5">
                                <View className="flex-1">
                                    <SegmentedControl<BatchMode>
                                        testID="kitchen-batch-mode"
                                        label={t('kitchen:ops.batch.basisLabel')}
                                        value={mode}
                                        onChange={switchMode}
                                        block
                                        items={[
                                            {
                                                value: 'yield',
                                                label: t('kitchen:ops.batch.basisWeight', {
                                                    unit: yieldUnitLabel,
                                                }),
                                                testID: 'kitchen-batch-mode-yield',
                                            },
                                            {
                                                value: 'pieces',
                                                label: t('kitchen:ops.batch.basisPortions'),
                                                disabled:
                                                    version === null ||
                                                    version.yieldPieces === null,
                                                testID: 'kitchen-batch-mode-pieces',
                                            },
                                        ]}
                                    />
                                </View>
                                {/* Why Portions is greyed out, for the recipe that cannot count them. */}
                                {version !== null && version.yieldPieces === null ? (
                                    <InfoTip
                                        testID="kitchen-batch-no-pieces-hint"
                                        label={t('kitchen:ops.batch.basisLabel')}
                                        text={t('kitchen:ops.batch.noPiecesHint')}
                                    />
                                ) : null}
                            </View>
                            <View className="flex-row items-center justify-center gap-1.5">
                                <IconButton
                                    variant="secondary"
                                    testID="kitchen-batch-less"
                                    label={t('kitchen:ops.batch.less')}
                                    icon={<Icon name="minus" size="sm" />}
                                    disabled={version === null || typed <= 0}
                                    onPress={() => {
                                        setTarget(targetText(Math.max(0, typed - step)));
                                    }}
                                />
                                <View>
                                    <QuantityInput
                                        testID="kitchen-batch-target"
                                        size="sm"
                                        labelHidden
                                        label={
                                            mode === 'pieces'
                                                ? t('kitchen:ops.batch.targetPortionsLabel')
                                                : t('kitchen:ops.batch.targetQuantityLabel', {
                                                      unit: yieldUnitLabel,
                                                  })
                                        }
                                        placeholder={t('kitchen:fields.quantityPlaceholder')}
                                        value={target}
                                        onChangeText={setTarget}
                                        unit={
                                            mode === 'pieces'
                                                ? t('kitchen:ops.batch.portionsUnit')
                                                : yieldUnitLabel
                                        }
                                    />
                                </View>
                                <IconButton
                                    variant="secondary"
                                    testID="kitchen-batch-more"
                                    label={t('kitchen:ops.batch.more')}
                                    icon={<Icon name="plus" size="sm" />}
                                    disabled={version === null}
                                    onPress={() => {
                                        setTarget(targetText(typed + step));
                                    }}
                                />
                            </View>
                            {base === null ? null : (
                                <View
                                    role="group"
                                    aria-label={t('kitchen:ops.batch.wholeBatches')}
                                    className="flex-row flex-wrap justify-center gap-1.5"
                                >
                                    {QUICK_BATCHES.map((count) => (
                                        <QuickBatch
                                            key={count}
                                            testID={`kitchen-batch-quick-${String(count)}`}
                                            label={t('kitchen:ops.batch.quickBatches', { count })}
                                            on={
                                                planned &&
                                                Math.abs(factor - count) < ROUNDED_TOLERANCE
                                            }
                                            onPress={() => {
                                                setTarget(targetText(count * base));
                                            }}
                                        />
                                    ))}
                                </View>
                            )}
                        </View>
                    </View>

                    {/* ── What it makes ────────────────────────────────────────────────────── */}
                    <View className="min-w-[320px] flex-1 gap-3">
                        {recipeId === null ? (
                            <EmptyState
                                testID="kitchen-batch-planner-pick-recipe"
                                title={t('kitchen:ops.batch.pickRecipeTitle')}
                                body={t('kitchen:ops.batch.pickRecipeBody')}
                            />
                        ) : recordFailure !== null ? (
                            <ErrorState
                                testID="kitchen-batch-planner-error"
                                failure={recordFailure}
                                title={t('kitchen:ops.batch.loadErrorTitle')}
                                onRetry={() => {
                                    void record.refetch();
                                }}
                                retrying={record.isFetching}
                            />
                        ) : record.data === undefined ? (
                            <Stack space="xs" testID="kitchen-batch-planner-loading">
                                <TableSkeleton rows={6} />
                                <Text variant="caption" tone="secondary">
                                    {t('kitchen:ops.batch.loadingCaption')}
                                </Text>
                            </Stack>
                        ) : !planned ? (
                            <EmptyState
                                testID="kitchen-batch-planner-target-needed"
                                title={t('kitchen:ops.batch.targetNeededTitle')}
                                body={t('kitchen:ops.batch.targetNeededBody')}
                            />
                        ) : (
                            <>
                                <Summary
                                    name={displayName(record.data.name, locale).value}
                                    figures={facts(
                                        version,
                                        factor,
                                        sheet.totalWeight,
                                        yieldUnitLabel,
                                        number,
                                        t,
                                    )}
                                    actions={
                                        <Inline space="xs" align="center">
                                            {print.mode === 'browser' ? (
                                                <Button
                                                    testID="kitchen-batch-print"
                                                    size="sm"
                                                    variant="secondary"
                                                    label={t('kitchen:ops.batch.printSheet')}
                                                    iconStart={<Icon name="printer" size="sm" />}
                                                    onPress={print.print}
                                                />
                                            ) : null}
                                            {canStart ? (
                                                <Button
                                                    testID="kitchen-batch-start"
                                                    size="sm"
                                                    label={t('kitchen:ops.batch.startBatch')}
                                                    iconStart={<Icon name="plus" size="sm" />}
                                                    onPress={startBatch}
                                                />
                                            ) : null}
                                        </Inline>
                                    }
                                />
                                <ScaledSheet
                                    version={version}
                                    lines={lines}
                                    packagingColumns={sheet.packagingColumns}
                                />
                            </>
                        )}
                    </View>
                </View>
            )}
        </Cascade>
    );
}

/** `.sh` — a plan step's number in a soft green disc, then its name. */
function PlanStep({ number, title }: { readonly number: number; readonly title: string }) {
    return (
        <View className="flex-row items-center gap-2.5">
            <View
                aria-hidden
                className="h-[26px] w-[26px] items-center justify-center rounded-full bg-surface-brand-subtle"
            >
                <Text className="font-display text-xs font-bold text-content-on-brand-subtle">
                    {String(number)}
                </Text>
            </View>
            <Heading level={3} className="!text-base font-bold">
                {title}
            </Heading>
        </View>
    );
}

/** `.rec` — one recipe of the book: its name and, once chosen and read, what a batch makes. */
function RecipeOption({
    row,
    selected,
    batch,
    onPress,
}: {
    readonly row: RecipeAdminSummary;
    readonly selected: boolean;
    /** Translated — what one batch makes; `null` until the recipe is chosen and read. */
    readonly batch: string | null;
    readonly onPress: () => void;
}) {
    const { t } = useTranslation();
    const { locale } = useLocale();
    const name = displayName(row.name, locale).value;
    // The reference is searched, not shown: a kitchen's imported book carries an import locator
    // there ("v6-recipes.json#classic-sauce"), which beside every name doubled the list.
    const meta = batch ?? '';
    return (
        <Pressable
            testID={`kitchen-batch-recipe-${String(row.id)}`}
            role="radio"
            accessibilityRole="radio"
            accessibilityLabel={name}
            accessibilityState={{ checked: selected }}
            aria-checked={selected}
            onPress={onPress}
            className={`min-h-10 justify-center gap-0.5 rounded-[14px] border px-3 py-1.5 web:transition-colors ${
                selected
                    ? 'border-surface-brand bg-surface-brand-subtle'
                    : 'border-transparent hover:bg-surface-sunken'
            }`}
        >
            <View className="flex-row items-center gap-1.5">
                <Text
                    numberOfLines={1}
                    className={`shrink text-sm font-bold ${
                        selected ? 'text-content-on-brand-subtle' : 'text-content-primary'
                    }`}
                >
                    {name}
                </Text>
                {row.meta.status === 'published' ? null : (
                    <Badge
                        testID={`kitchen-batch-recipe-${String(row.id)}-status`}
                        tone="warning"
                        label={t(statusShortKey(row.meta.status))}
                    />
                )}
            </View>
            {meta === '' ? null : (
                <Text
                    numberOfLines={1}
                    className={`text-xs font-medium tabular-nums ${
                        selected ? 'text-content-on-brand-subtle' : 'text-content-secondary'
                    }`}
                >
                    {meta}
                </Text>
            )}
        </Pressable>
    );
}

/** `.gp` — a whole-batch chip: sunken until it is the plan, then soft green with a brand edge. */
function QuickBatch({
    label,
    on,
    onPress,
    testID,
}: {
    readonly label: string;
    readonly on: boolean;
    readonly onPress: () => void;
    readonly testID: string;
}) {
    return (
        <Pressable
            testID={testID}
            role="button"
            accessibilityRole="button"
            accessibilityLabel={label}
            accessibilityState={{ selected: on }}
            aria-pressed={on}
            onPress={onPress}
            className={`h-8 flex-row items-center rounded-full border px-3 web:transition-colors ${
                on
                    ? 'border-surface-brand bg-surface-brand-subtle'
                    : 'border-transparent bg-surface-sunken hover:bg-surface-brand-subtle'
            }`}
        >
            <Text
                className={`text-sm font-semibold ${
                    on ? 'text-content-on-brand-subtle' : 'text-content-primary'
                }`}
            >
                {label}
            </Text>
        </Pressable>
    );
}

/**
 * The summary card: the recipe's name with Print and Start beside it, then the figures as the list
 * pages' chips — four in a row when there is room for them, two rows of two when there is not.
 */
function Summary({
    name,
    figures,
    actions,
}: {
    readonly name: string;
    readonly figures: readonly LensFigure[];
    readonly actions: ReactNode;
}) {
    const { t } = useTranslation();
    const [width, setWidth] = useState(0);
    const columns = width >= SUMMARY_CHIP_MIN * 4 + SUMMARY_GAP * 3 ? 4 : 2;
    // Floored: a fractional width summed with the gaps can overrun the row and wrap the last chip.
    const chipWidth =
        width === 0 ? undefined : Math.floor((width - SUMMARY_GAP * (columns - 1)) / columns);

    return (
        <View
            testID="kitchen-batch-summary"
            role="region"
            aria-label={t('kitchen:ops.batch.summaryLabel')}
            className="gap-[14px] rounded-[22px] border border-stroke-subtle bg-surface-raised px-[22px] py-5"
        >
            <View className="flex-row flex-wrap items-center justify-between gap-4">
                <Heading
                    level={2}
                    testID="kitchen-batch-summary-name"
                    numberOfLines={2}
                    className="!text-2xl min-w-0 shrink font-bold"
                >
                    {name}
                </Heading>
                {actions}
            </View>
            <View
                testID="kitchen-batch-facts"
                role="group"
                aria-label={t('kitchen:lens.label')}
                className="flex-row flex-wrap gap-2"
                onLayout={(event) => {
                    setWidth(event.nativeEvent.layout.width);
                }}
            >
                {figures.map((figure) => (
                    <View
                        key={figure.key}
                        style={chipWidth === undefined ? undefined : { width: chipWidth }}
                    >
                        <LensFigureCell
                            figure={figure}
                            narrow={false}
                            chip
                            fill
                            testID={`kitchen-batch-facts-${figure.key}`}
                        />
                    </View>
                ))}
            </View>
        </View>
    );
}

/** What one batch of the version makes — "7 Kg · 20 portions a batch". */
function batchLine(
    version: RecipeVersionAdmin,
    yieldUnitLabel: string,
    number: (value: number) => string,
    t: TFunction,
): string {
    const quantity = `${number(version.yieldQuantity)} ${yieldUnitLabel}`;
    return version.yieldPieces === null
        ? t('kitchen:ops.batch.batchMakes', { quantity })
        : t('kitchen:ops.batch.batchMakesPortions', { quantity, count: version.yieldPieces });
}

/**
 * The summary's four chips: the version, then what the target makes of it. "Batches" carries the
 * brand pill and the exact factor; the weight carries the waste the issue list already includes.
 */
function facts(
    version: RecipeVersionAdmin,
    factor: number,
    /** Every kilogram line of the To issue list, summed; `null` when the sheet has none. */
    totalWeight: number | null,
    yieldUnitLabel: string,
    number: (value: number) => string,
    t: TFunction,
): readonly LensFigure[] {
    const dash = t('kitchen:list.noValue');
    const pieces = version.yieldPieces;
    const batches = Math.ceil(factor - ROUNDED_TOLERANCE);
    const portions = pieces === null ? null : Math.round(factor * pieces);

    return [
        {
            key: 'version',
            label: t('kitchen:ops.batch.factVersion'),
            value: version.versionNumber,
            display: t('kitchen:ops.batch.versionFigure', {
                number: version.versionNumber,
                status: t(statusShortKey(version.status)),
            }),
            // A dot only on a version that is not the published one: the kitchen is cooking a draft.
            ...(version.status !== 'published' ? { tone: 'warning' as const } : {}),
        },
        {
            key: 'batches',
            label: t('kitchen:ops.batch.factBatches'),
            value: batches,
            display: number(batches),
            tone: 'brand',
            active: true,
            note: t('kitchen:ops.batch.baseTimes', { factor: number(factor) }),
        },
        {
            key: 'portions',
            label: t('kitchen:ops.batch.factPortions'),
            value: portions ?? 0,
            display: portions === null ? dash : number(portions),
            ...(pieces === null ? { info: t('kitchen:ops.batch.piecesNoneInfo') } : {}),
        },
        {
            key: 'weight',
            label: t('kitchen:ops.batch.factTotalWeight'),
            value: totalWeight ?? 0,
            display: totalWeight === null ? dash : `${number(totalWeight)} ${yieldUnitLabel}`,
            ...(version.wastePercent > 0
                ? {
                      // Behind the (i), not inline: at four to a row the chip has no room for it.
                      info: t('kitchen:ops.batch.wasteNote', {
                          percent: number(version.wastePercent),
                      }),
                  }
                : {}),
        },
    ];
}

const rowId = (id: { toString(): string }) => `kitchen-batch-row-${String(id)}`;

/**
 * Both tables' columns, and the To issue list's weight. A hook rather than part of the sheet,
 * because the raw-material controls — and so these columns — live as long as the page does.
 */
function useSheetColumns(
    version: RecipeVersionAdmin | null,
    factor: number,
    ingredients: Readonly<Record<string, IngredientAdmin>>,
): {
    readonly lineColumns: readonly ControlledColumn<RecipeLine, DataTableColumn<RecipeLine>>[];
    readonly packagingColumns: readonly ControlledColumn<
        RecipePackagingLine,
        DataTableColumn<RecipePackagingLine>
    >[];
    /** The kilogram lines' To issue, summed — the summary's Total weight. */
    readonly totalWeight: number | null;
} {
    const { t } = useTranslation();
    const { locale } = useLocale();
    const formatter = useFormatter();

    const dash = t('kitchen:list.noValue');
    const number = (value: number): string => formatter.formatNumber(value, BATCH_QUANTITY_FORMAT);

    // What a production batch for the same yield reserves: the production waste rate on every
    // ingredient, the packaging rate on every packaging line (see `withWaste`).
    const ingredientFactor = withWaste(factor, version?.wastePercent ?? 0);
    const packagingFactor = withWaste(factor, version?.packagingWastePercent ?? 0);

    // The weight the list issues, in the yield's own unit — only the lines stated in it count.
    const weighed = (version?.lines ?? []).filter((line) => line.unit === version?.yieldUnit);
    const totalWeight =
        weighed.length === 0
            ? null
            : weighed.reduce((sum, line) => sum + scaleLine(line.quantity, ingredientFactor), 0);

    const found = (id: RecipeLine['ingredientId']) => ingredients[String(id)];
    const nameOf = (id: RecipeLine['ingredientId']): string => {
        const ingredient = found(id);
        return ingredient === undefined ? dash : displayName(ingredient.name, locale).value;
    };
    const referenceOf = (id: RecipeLine['ingredientId']): string => found(id)?.reference ?? dash;
    // Blank rather than the dash, so a line with no reference sorts last rather than among the Rs.
    const sortReference = (id: RecipeLine['ingredientId']): string | null =>
        found(id)?.reference ?? null;
    const sortName = (id: RecipeLine['ingredientId']): string | null => {
        const ingredient = found(id);
        return ingredient === undefined ? null : displayName(ingredient.name, locale).value;
    };

    /*
     * Every header sorts or filters, in memory: both tables are the whole of one
     * version's lines, not a page of them. Unit filters, because a sheet's units are a handful of
     * codes; the rest sort. Before any header is pressed the rows keep the version's own order.
     */
    function unitFilter<Row extends { readonly unit: RecipeLine['unit'] }>(): ColumnFilter<Row> {
        return {
            values: (loaded) =>
                [...new Set(loaded.map((row) => row.unit))].map((unit) => ({
                    key: unit,
                    label: t(unitShortKey(unit)),
                })),
            match: (row, value) => row.unit === value,
        };
    }

    const lineColumns: readonly ControlledColumn<RecipeLine, DataTableColumn<RecipeLine>>[] = [
        {
            key: 'reference',
            role: 'meta',
            label: t('kitchen:ops.batch.columnRef'),
            width: SHEET_COLUMN_WIDTH,
            priority: 70,
            mono: true,
            sort: (left, right, direction) =>
                compareText(
                    sortReference(left.ingredientId),
                    sortReference(right.ingredientId),
                    direction,
                ),
            render: (line) => (
                <Text
                    variant="mono"
                    tone="secondary"
                    testID={`${rowId(line.ingredientId)}-reference`}
                >
                    {referenceOf(line.ingredientId)}
                </Text>
            ),
        },
        {
            key: 'name',
            role: 'title',
            label: t('kitchen:ops.batch.columnDesignation'),
            width: SHEET_COLUMN_WIDTH,
            priority: 100,
            sort: (left, right, direction) =>
                compareText(sortName(left.ingredientId), sortName(right.ingredientId), direction),
            render: (line) => (
                <Inline space="xs" align="center" wrap>
                    <Text variant="bodyStrong" testID={`${rowId(line.ingredientId)}-name`}>
                        {nameOf(line.ingredientId)}
                    </Text>
                    {line.isOptional ? (
                        <Badge
                            testID={`${rowId(line.ingredientId)}-optional`}
                            tone="neutral"
                            label={t('kitchen:ops.batch.optionalBadge')}
                        />
                    ) : null}
                </Inline>
            ),
        },
        {
            key: 'unit',
            label: t('kitchen:ops.batch.columnUnit'),
            width: SHEET_COLUMN_WIDTH,
            priority: 60,
            filter: unitFilter<RecipeLine>(),
            value: (line) => t(unitShortKey(line.unit)),
        },
        {
            key: 'base',
            label: t('kitchen:ops.batch.columnPerBatch'),
            width: SHEET_COLUMN_WIDTH,
            priority: 50,
            mono: true,
            sort: (left, right, direction) =>
                compareNumber(left.quantity, right.quantity, direction),
            render: (line) => (
                <Text variant="mono" tone="secondary" testID={`${rowId(line.ingredientId)}-base`}>
                    {number(line.quantity)}
                </Text>
            ),
        },
        {
            key: 'scaled',
            role: 'metric',
            label: t('kitchen:ops.batch.columnToIssue'),
            width: SHEET_COLUMN_WIDTH,
            priority: 90,
            mono: true,
            sort: (left, right, direction) =>
                compareNumber(
                    scaleLine(left.quantity, ingredientFactor),
                    scaleLine(right.quantity, ingredientFactor),
                    direction,
                ),
            render: (line) => (
                <Text
                    variant="mono"
                    className="font-bold"
                    testID={`${rowId(line.ingredientId)}-quantity`}
                >
                    {number(scaleLine(line.quantity, ingredientFactor))}
                </Text>
            ),
        },
    ];

    const packagingColumns: readonly ControlledColumn<
        RecipePackagingLine,
        DataTableColumn<RecipePackagingLine>
    >[] = [
        {
            key: 'reference',
            role: 'meta',
            label: t('kitchen:ops.batch.columnRef'),
            width: SHEET_COLUMN_WIDTH,
            priority: 70,
            mono: true,
            sort: (left, right, direction) =>
                compareText(
                    sortReference(left.ingredientId),
                    sortReference(right.ingredientId),
                    direction,
                ),
            value: (row) => referenceOf(row.ingredientId),
        },
        {
            key: 'name',
            role: 'title',
            label: t('kitchen:ops.batch.columnDesignation'),
            width: SHEET_COLUMN_WIDTH,
            priority: 100,
            sort: (left, right, direction) =>
                compareText(sortName(left.ingredientId), sortName(right.ingredientId), direction),
            render: (row) => (
                <Text variant="bodyStrong" testID={`${rowId(row.ingredientId)}-name`}>
                    {nameOf(row.ingredientId)}
                </Text>
            ),
        },
        {
            key: 'unit',
            label: t('kitchen:ops.batch.columnUnit'),
            width: SHEET_COLUMN_WIDTH,
            priority: 60,
            filter: unitFilter<RecipePackagingLine>(),
            value: (row) => t(unitShortKey(row.unit)),
        },
        {
            key: 'base',
            label: t('kitchen:ops.batch.columnPerBatch'),
            width: SHEET_COLUMN_WIDTH,
            priority: 50,
            mono: true,
            sort: (left, right, direction) =>
                compareNumber(left.quantity, right.quantity, direction),
            value: (row) => number(row.quantity),
        },
        {
            key: 'scaled',
            role: 'metric',
            label: t('kitchen:ops.batch.columnToIssue'),
            width: SHEET_COLUMN_WIDTH,
            priority: 90,
            mono: true,
            // By what is issued, the rounded-up count: the figure the cell leads with.
            sort: (left, right, direction) =>
                compareNumber(
                    scalePackaging(left.quantity, packagingFactor, left.unit),
                    scalePackaging(right.quantity, packagingFactor, right.unit),
                    direction,
                ),
            render: (row) => {
                const applied = scalePackaging(row.quantity, packagingFactor, row.unit);
                const exact = scaleLine(row.quantity, packagingFactor);
                return (
                    <Inline space="xs" align="center">
                        <Text variant="mono" testID={`${rowId(row.ingredientId)}-quantity`}>
                            {number(applied)}
                        </Text>
                        {Math.abs(applied - exact) > ROUNDED_TOLERANCE ? (
                            <Text
                                variant="caption"
                                tone="secondary"
                                testID={`${rowId(row.ingredientId)}-exact`}
                            >
                                {t('kitchen:ops.batch.roundedFrom', { exact: number(exact) })}
                            </Text>
                        ) : null}
                    </Inline>
                );
            },
        },
    ];

    return { lineColumns, packagingColumns, totalWeight };
}

interface ScaledSheetProps {
    readonly version: RecipeVersionAdmin;
    readonly lines: ColumnControls<RecipeLine, DataTableColumn<RecipeLine>>;
    readonly packagingColumns: readonly ControlledColumn<
        RecipePackagingLine,
        DataTableColumn<RecipePackagingLine>
    >[];
}

/**
 * The To issue list, then the packaging. Row test ids are `kitchen-batch-row-<ingredient id>-*`,
 * the same stem the production editor's sheet uses.
 */
function ScaledSheet({ version, lines, packagingColumns }: ScaledSheetProps) {
    const { t } = useTranslation();
    const formatter = useFormatter();
    const number = (value: number): string => formatter.formatNumber(value, BATCH_QUANTITY_FORMAT);

    return (
        <Stack space="md">
            {/*
             * ponytail: rows are keyed by ingredient id. A sheet that lists one ingredient twice
             * gives the two rows one key — index the rows if a kitchen hits it.
             */}
            <ProductionTableSection<RecipeLine>
                panel
                picker
                testID="kitchen-batch-ingredients"
                sectionTestID="kitchen-batch-consume"
                title={t('kitchen:ops.batch.columnToIssue')}
                aside={
                    <Text testID="kitchen-batch-line-count" variant="caption" tone="secondary">
                        {t('kitchen:ops.batch.lineCount', { count: version.lines.length })}
                    </Text>
                }
                rows={version.lines}
                controls={lines}
                rowKey={(line) => String(line.ingredientId)}
            />

            <ProductionTable<RecipePackagingLine>
                testID="kitchen-batch-packaging"
                title={t('kitchen:ops.batch.packagingHeading')}
                rows={version.packaging}
                columns={packagingColumns}
                rowKey={(row) => String(row.ingredientId)}
                empty={
                    <Text testID="kitchen-batch-packaging-empty" variant="caption" tone="secondary">
                        {t('kitchen:ops.batch.noPackaging')}
                    </Text>
                }
                aside={
                    <Inline space="xs" align="center">
                        <Text variant="caption" tone="secondary">
                            {version.packaging.length === 0
                                ? t('kitchen:ops.batch.noneRecorded')
                                : t('kitchen:ops.batch.lineCount', {
                                      count: version.packaging.length,
                                  })}
                        </Text>
                        {version.packaging.length > 0 && version.packagingWastePercent > 0 ? (
                            <Text
                                variant="caption"
                                tone="secondary"
                                testID="kitchen-batch-packaging-waste"
                            >
                                {t('kitchen:ops.batch.packagingWasteIncluded', {
                                    percent: number(version.packagingWastePercent),
                                })}
                            </Text>
                        ) : null}
                    </Inline>
                }
            />
        </Stack>
    );
}
