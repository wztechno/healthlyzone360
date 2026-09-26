import type {
    IngredientAdmin,
    RecipeLine,
    RecipePackagingLine,
    RecipeVersionAdmin,
} from '@healthy360/api-client/contracts';
import {
    Badge,
    Button,
    Callout,
    Card,
    DataList,
    ErrorState,
    FormSection,
    Inline,
    QuantityInput,
    SegmentedControl,
    Select,
    Stack,
    TableSkeleton,
    Text,
} from '@healthy360/design-system';
import type { SelectOption } from '@healthy360/design-system';
import { RecipeId } from '@healthy360/domain-types';
import { useFormatter, useLocale } from '@healthy360/i18n';
import type { TFunction } from 'i18next';
import { useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { Gate, useCan } from '../../../access/gate.tsx';
import { toFailure } from '../../../data/hooks.ts';
import {
    recipesFromPages,
    useRecipeQuery,
    useRecipesQuery,
} from '../../../data/kitchen-admin-hooks.ts';
import { batchFactor, scaleLine, scalePackaging } from '../batch-scaling.ts';
import type { BatchMode } from '../batch-scaling.ts';
import { CataloguePageHeader } from '../catalogue/catalogue-page-header.tsx';
import { CatalogueStatCards } from '../catalogue/catalogue-stat-cards.tsx';
import type { CatalogueStatCard } from '../catalogue/catalogue-stat-cards.tsx';
import type { ColumnFilter, ControlledColumn } from '../catalogue/use-column-controls.tsx';
import {
    compareNumber,
    compareText,
    useColumnControls,
} from '../catalogue/use-column-controls.tsx';
import {
    CATALOGUE_VIEW_PERMISSION,
    PRODUCTION_MANAGE_PERMISSION,
    RECIPE_VIEW_PERMISSION,
} from '../entity-registry.ts';
import { displayName, parseQuantity, statusShortKey, unitShortKey } from '../format.ts';
import {
    BASIS_KEYS,
    BATCH_QUANTITY_FORMAT,
    useBatchIngredients,
} from '../operations/batch-sheet.tsx';
import { usePrintSheet } from '../print-sheet.tsx';
import { WithColumnPicker } from '../catalogue/column-picker.tsx';

/**
 * `/kitchen/batch` — one recipe, one target, and the sheet it scales to (`Batch Planner.dc.html`).
 *
 * ```
 * [ READ ONLY ] Nothing here is ordered or booked              [ Print sheet ] [ Start a batch ]
 * ┌ VERSION ┐ ┌ BASE YIELD ┐ ┌ PORTIONS PER BATCH ┐ ┌ PRODUCTION WASTE ┐    what the version says
 * ┌ Recipe ▾ · Plan by [ kg | Portions ] · Make ___ kg ────────────────┐    the question
 * ┌ BATCHES NEEDED 3 · rounded up from ×2.5 │ PORTIONS PRODUCED 35 ────┐    the answer
 * INGREDIENTS                              │ PACKAGING                      side by side from xl
 * Ref · Designation · Unit · Per batch ·   │ Ref · Designation · Unit ·
 * To issue · As written                    │ Per batch · To issue · Basis
 * ─────────────────────────────────────────────────────────────────────────────────────────────
 * Units are never converted · Nothing is written from this sheet
 * ```
 *
 * ## Every figure is arithmetic on one version
 *
 * There is no scaling endpoint. The current version states what it makes, so the factor is a
 * division and every row a multiplication — see `batch-scaling.ts`. Names come from the catalogue by
 * id (`RecipeLine.ingredientName` is the sheet's blank designation), which is why the `<Gate>`
 * demands `catalogue.view_organisation` beside `recipe.view_organisation`.
 *
 * ## What the version says, the question, then the answer
 *
 * The four cards are the version's own facts and do not move with the target. The controls sit
 * under them, and the results band under the controls holds everything the target produces —
 * "Batches needed" is the factor rounded up, because a kitchen runs whole batches, with the exact
 * factor kept beside it because the sheet is scaled by the exact one.
 *
 * ## One unit per row
 *
 * The raw-material table has a single Unit column for both "Per batch" and "To issue", so both are
 * stated in the line's own unit. Restating half a kilogram as 500 g in one column and not the other
 * would make the Unit column wrong for one of them.
 *
 * ## No shelf column, and one way out
 *
 * The planner is a sheet, not a stock check. What is on the shelf belongs to the new-batch form,
 * where a batch is opened against a branch — and "Start a batch" goes there with the recipe and the
 * number of runs already filled in, so a plan is never retyped to become a batch.
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

function BatchPlanner() {
    const { t } = useTranslation();
    const { locale } = useLocale();
    const formatter = useFormatter();
    const print = usePrintSheet();
    const router = useRouter();
    // The hand-off opens a draft batch, which the new-batch form gates on the same pair.
    const canStart = useCan([PRODUCTION_MANAGE_PERMISSION, RECIPE_VIEW_PERMISSION]);

    const [recipeId, setRecipeId] = useState<RecipeId | null>(null);
    const [modeChoice, setModeChoice] = useState<BatchMode>('yield');
    const [target, setTarget] = useState('');

    // No status filter, matching the recipe list's own default: a kitchen cooks its drafts.
    // ponytail: one 100-row page, filtered by the select's own search. A longer book wants `query`
    // pushed into the filter and refetched as the reader types, as the recipe list does.
    const recipes = useRecipesQuery({ limit: 100 });
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

    const recipeOptions: readonly SelectOption[] = recipeRows.map((row) => ({
        value: String(row.id),
        label: displayName(row.name, locale).value,
        description: [
            row.reference,
            t('kitchen:ops.batch.versionCell', { number: row.currentVersionNumber }),
            t(statusShortKey(row.meta.status)),
        ]
            .filter((part): part is string => part !== null)
            .join(' · '),
    }));

    const recipesFailure = toFailure(recipes.error);
    const recordFailure = toFailure(record.error);
    const number = (value: number): string => formatter.formatNumber(value, BATCH_QUANTITY_FORMAT);
    // Kilograms until a recipe says otherwise, so the basis never loses its unit.
    const yieldUnitLabel = t(unitShortKey(version?.yieldUnit ?? 'kg'));

    /*
     * The hand-off carries the factor, not the target. The new-batch form counts a planned yield in
     * the recipe output's unit, which need not be the version's yield unit this page scales by — so
     * a target of "10 kg" could land in a box that means litres. A number of runs means the same on
     * both pages, and it is the figure every line below was multiplied by.
     */
    const startBatch =
        canStart && recipeId !== null && factor !== null
            ? () => {
                  router.push(
                      `/kitchen/production-desk/new?recipe=${String(recipeId)}&runs=${String(
                          roundRuns(factor),
                      )}`,
                  );
              }
            : undefined;

    return (
        <Stack space="md" testID="kitchen-batch-planner-screen">
            {/*
             * No title: the shell's trail already ends in "Batch planner". The row states what the
             * page is — read only — and carries Print and the one way out of it into a real batch.
             */}
            <CataloguePageHeader
                testID="kitchen-batch-planner-header"
                titleAside={
                    <>
                        <Badge
                            testID="kitchen-batch-planner-read-only"
                            tone="neutral"
                            icon={null}
                            label={t('kitchen:ops.batch.readOnlyChip')}
                        />
                        <Text variant="caption" tone="secondary">
                            {t('kitchen:ops.batch.readOnlyCaption')}
                        </Text>
                    </>
                }
                primaryAction={
                    <Inline space="xs" align="center">
                        {print.mode === 'browser' ? (
                            <Button
                                testID="kitchen-batch-print"
                                size="sm"
                                variant="secondary"
                                label={t('kitchen:ops.batch.printSheet')}
                                disabled={factor === null}
                                onPress={print.print}
                            />
                        ) : null}
                        {canStart ? (
                            <Button
                                testID="kitchen-batch-start"
                                label={t('kitchen:ops.batch.startBatch')}
                                disabled={startBatch === undefined}
                                onPress={startBatch ?? noop}
                            />
                        ) : null}
                    </Inline>
                }
            />

            {/* What the version states, before anything is scaled. */}
            <CatalogueStatCards
                testID="kitchen-batch-facts"
                cards={facts(
                    record.data === undefined
                        ? null
                        : [displayName(record.data.name, locale).value, record.data.reference]
                              .filter((part): part is string => part !== null && part !== '')
                              .join(' · '),
                    version,
                    yieldUnitLabel,
                    number,
                    t,
                )}
            />

            {/*
             * The question. Raised: the recipe select opens downward out of this card and over the
             * band and tables drawn after it. react-native-web gives every View `z-index: 0`, so
             * without the raise the list slides under the next sibling the moment it outgrows the card.
             */}
            <View testID="kitchen-batch-controls" className="relative z-raised">
                <Card tone="raised" padding="md">
                    <Inline space="md" align="end" wrap>
                        <View className="w-field">
                            <Select
                                testID="kitchen-batch-recipe"
                                label={t('kitchen:ops.batch.recipeLabel')}
                                placeholder={t('kitchen:ops.batch.recipePlaceholder')}
                                searchable
                                options={recipeOptions}
                                value={recipeId === null ? null : String(recipeId)}
                                onChange={(value) => {
                                    setRecipeId(RecipeId.safeParse(value));
                                }}
                            />
                        </View>

                        {/*
                         * Built as a field: the label on the field label's own step and at its 4px
                         * gap, so all three labels sit on one line and all three controls on the next.
                         */}
                        <View className="flex-col gap-hair">
                            <Text variant="caption" className="font-medium">
                                {t('kitchen:ops.batch.basisLabel')}
                            </Text>
                            <SegmentedControl<BatchMode>
                                testID="kitchen-batch-mode"
                                label={t('kitchen:ops.batch.basisLabel')}
                                value={mode}
                                onChange={setModeChoice}
                                items={[
                                    {
                                        value: 'yield',
                                        label: t('kitchen:ops.batch.basisYield', {
                                            unit: yieldUnitLabel,
                                        }),
                                        testID: 'kitchen-batch-mode-yield',
                                    },
                                    {
                                        value: 'pieces',
                                        label: t('kitchen:ops.batch.basisPortions'),
                                        disabled: version === null || version.yieldPieces === null,
                                        testID: 'kitchen-batch-mode-pieces',
                                    },
                                ]}
                            />
                        </View>

                        <QuantityInput
                            testID="kitchen-batch-target"
                            size="sm"
                            label={
                                mode === 'pieces'
                                    ? t('kitchen:ops.batch.targetPortionsLabel')
                                    : t('kitchen:ops.batch.targetQuantityLabel', {
                                          unit: yieldUnitLabel,
                                      })
                            }
                            value={target}
                            onChangeText={setTarget}
                            unit={
                                mode === 'pieces'
                                    ? t('kitchen:ops.batch.portionsUnit')
                                    : yieldUnitLabel
                            }
                            className="w-field"
                        />
                    </Inline>

                    {version !== null && version.yieldPieces === null ? (
                        <Text
                            testID="kitchen-batch-no-pieces-hint"
                            variant="caption"
                            tone="secondary"
                        >
                            {t('kitchen:ops.batch.noPiecesHint')}
                        </Text>
                    ) : null}
                </Card>
            </View>

            {/* The answer: what the target makes of the version. */}
            <ResultsBand
                version={version}
                factor={factor}
                mode={mode}
                yieldUnitLabel={yieldUnitLabel}
                number={number}
            />

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
            ) : recipeId === null ? (
                <Callout
                    testID="kitchen-batch-planner-pick-recipe"
                    tone="info"
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
            ) : version === null || factor === null ? (
                <Callout
                    testID="kitchen-batch-planner-target-needed"
                    tone="info"
                    title={t('kitchen:ops.batch.targetNeededTitle')}
                    body={t('kitchen:ops.batch.targetNeededBody')}
                />
            ) : (
                <ScaledSheet version={version} factor={factor} ingredients={ingredients} />
            )}
        </Stack>
    );
}

/** Runs handed to the new-batch form: the factor to three places, which is what every figure shows. */
function roundRuns(factor: number): number {
    return Math.round(factor * 1000) / 1000;
}

function noop() {}

/**
 * What the version states — four figures, none of which move with the target. What the target
 * makes of them is the results band's, under the controls, so the question sits between the two.
 */
function facts(
    /** "Name · reference" for the chosen recipe, or `null` before one is chosen. */
    recipeLine: string | null,
    version: RecipeVersionAdmin | null,
    yieldUnitLabel: string,
    number: (value: number) => string,
    t: TFunction,
): readonly CatalogueStatCard[] {
    const dash = t('kitchen:list.noValue');
    const pieces = version?.yieldPieces ?? null;
    return [
        {
            key: 'version',
            label: t('kitchen:ops.batch.factVersion'),
            value:
                version === null
                    ? dash
                    : t('kitchen:ops.batch.versionCell', { number: version.versionNumber }),
            ...(version === null ? {} : { unit: t(statusShortKey(version.status)) }),
            caption: recipeLine ?? t('kitchen:ops.batch.noRecipeCaption'),
            mark: 'layers',
            tone: version !== null && version.status !== 'published' ? 'warning' : 'default',
        },
        {
            key: 'yield',
            label: t('kitchen:ops.batch.factBaseYield'),
            value: version === null ? dash : number(version.yieldQuantity),
            ...(version === null ? {} : { unit: yieldUnitLabel }),
            caption: t('kitchen:ops.batch.factYieldCaption'),
            mark: 'package',
        },
        {
            key: 'pieces',
            label: t('kitchen:ops.batch.factPortionsPerBatchLabel'),
            value: pieces === null ? dash : number(pieces),
            ...(pieces === null ? {} : { unit: t('kitchen:ops.batch.portionsUnit') }),
            caption:
                version !== null && pieces === null
                    ? t('kitchen:ops.batch.factPiecesNone')
                    : t('kitchen:ops.batch.factPortionsOut'),
            mark: 'utensils',
        },
        {
            key: 'waste',
            label: t('kitchen:ops.batch.factWaste'),
            value: version === null ? dash : number(version.wastePercent),
            ...(version === null ? {} : { unit: '%' }),
            caption: t('kitchen:ops.batch.factWasteCaption'),
            mark: 'percent',
        },
    ];
}

interface ResultsBandProps {
    readonly version: RecipeVersionAdmin | null;
    readonly factor: number | null;
    readonly mode: BatchMode;
    readonly yieldUnitLabel: string;
    readonly number: (value: number) => string;
}

/**
 * What the target makes: the batches, and whichever axis the cook did not type.
 *
 * Two figures, not three. In yield mode the resulting quantity *is* the figure in Make, so the
 * only derived figure is the portions; in portions mode it is the other way round. "Batches" leads
 * with whole runs — a kitchen runs whole batches — and keeps the exact factor beside it, because
 * the sheet is scaled by the exact factor, not the rounded one.
 */
function ResultsBand({ version, factor, mode, yieldUnitLabel, number }: ResultsBandProps) {
    const { t } = useTranslation();
    const dash = t('kitchen:list.noValue');
    const pieces = version?.yieldPieces ?? null;

    const quantity = factor === null || version === null ? null : factor * version.yieldQuantity;
    const portions = factor === null || pieces === null ? null : Math.round(factor * pieces);

    const figures: readonly ResultFigure[] = [
        {
            key: 'batches',
            label: t('kitchen:ops.batch.factBatchesNeeded'),
            value: factor === null ? dash : number(Math.ceil(factor - ROUNDED_TOLERANCE)),
            unit: t('kitchen:ops.batch.batchesUnit'),
            caption:
                factor === null
                    ? t('kitchen:ops.batch.awaitingTarget')
                    : t('kitchen:ops.batch.roundedUpFrom', { factor: number(factor) }),
            lead: true,
        },
        mode === 'pieces'
            ? {
                  key: 'quantity',
                  label: t('kitchen:ops.batch.resultQuantity'),
                  value: quantity === null ? dash : number(quantity),
                  unit: yieldUnitLabel,
                  caption: t('kitchen:ops.batch.resultQuantityCaption'),
              }
            : {
                  key: 'portions',
                  label: t('kitchen:ops.batch.factPortionsProduced'),
                  value: portions === null ? dash : number(portions),
                  unit: t('kitchen:ops.batch.portionsUnit'),
                  caption:
                      version !== null && pieces === null
                          ? t('kitchen:ops.batch.factPiecesNone')
                          : t('kitchen:ops.batch.resultPortionsCaption'),
              },
    ];

    return (
        <Card tone="sunken" padding="md" testID="kitchen-batch-results">
            <Inline space="xl" align="start" wrap>
                {figures.map((figure) => (
                    <View
                        key={figure.key}
                        testID={`kitchen-batch-results-${figure.key}`}
                        className="flex-col gap-hair"
                    >
                        <Text variant="caption" tone="secondary" className="font-medium">
                            {figure.label}
                        </Text>
                        <View className="flex-row items-baseline gap-tight">
                            <Text
                                variant="display"
                                tone={figure.lead === true && factor !== null ? 'brand' : 'primary'}
                                testID={`kitchen-batch-results-${figure.key}-value`}
                            >
                                {figure.value}
                            </Text>
                            <Text variant="body" tone="secondary">
                                {figure.unit}
                            </Text>
                        </View>
                        <Text
                            variant="caption"
                            tone="secondary"
                            {...(figure.lead === true ? { testID: 'kitchen-batch-factor' } : {})}
                        >
                            {figure.caption}
                        </Text>
                    </View>
                ))}
            </Inline>
        </Card>
    );
}

interface ResultFigure {
    readonly key: string;
    readonly label: string;
    readonly value: string;
    readonly unit: string;
    readonly caption: string;
    readonly lead?: boolean | undefined;
}

interface ScaledSheetProps {
    readonly version: RecipeVersionAdmin;
    readonly factor: number;
    readonly ingredients: Readonly<Record<string, IngredientAdmin>>;
}

/**
 * The scaled raw materials, then the packaging. Row test ids are
 * `kitchen-batch-row-<ingredient id>-*`, the same stem the production editor's sheet uses.
 */
function ScaledSheet({ version, factor, ingredients }: ScaledSheetProps) {
    const { t } = useTranslation();
    const { locale } = useLocale();
    const formatter = useFormatter();

    const dash = t('kitchen:list.noValue');
    const number = (value: number): string => formatter.formatNumber(value, BATCH_QUANTITY_FORMAT);
    const rowId = (id: { toString(): string }) => `kitchen-batch-row-${String(id)}`;

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
     * Every header sorts or filters, in memory: both tables are the whole of one version's lines,
     * not a page of them. Unit filters, because a sheet's units are a handful of codes; the rest
     * sort. Before any header is pressed the rows keep the version's own order.
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

    const lineColumns: readonly ControlledColumn<RecipeLine>[] = [
        {
            key: 'reference',
            label: t('kitchen:ops.batch.columnRef'),
            width: 96,
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
            label: t('kitchen:ops.batch.columnDesignation'),
            width: 200,
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
                            icon={null}
                            label={t('kitchen:ops.batch.optionalBadge')}
                        />
                    ) : null}
                </Inline>
            ),
        },
        {
            key: 'unit',
            label: t('kitchen:ops.batch.columnUnit'),
            width: 64,
            priority: 60,
            align: 'center',
            filter: unitFilter<RecipeLine>(),
            value: (line) => t(unitShortKey(line.unit)),
        },
        {
            key: 'base',
            label: t('kitchen:ops.batch.columnPerBatch'),
            width: 96,
            priority: 50,
            align: 'center',
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
            label: t('kitchen:ops.batch.columnToIssue'),
            width: 96,
            priority: 90,
            align: 'center',
            mono: true,
            sort: (left, right, direction) =>
                compareNumber(
                    scaleLine(left.quantity, factor),
                    scaleLine(right.quantity, factor),
                    direction,
                ),
            render: (line) => (
                <Text variant="mono" testID={`${rowId(line.ingredientId)}-quantity`}>
                    {number(scaleLine(line.quantity, factor))}
                </Text>
            ),
        },
        {
            // The designation the source sheet wrote — "Poulet blanc" — so a cook reading a supplier's
            // label can find the line. First to go when the column narrows.
            key: 'asWritten',
            label: t('kitchen:ops.batch.columnAsWritten'),
            width: 140,
            priority: 30,
            sort: (left, right, direction) =>
                compareText(left.sourceDesignation, right.sourceDesignation, direction),
            render: (line) => (
                <Text tone="secondary" numberOfLines={1}>
                    {line.sourceDesignation ?? dash}
                </Text>
            ),
        },
    ];

    const packagingColumns: readonly ControlledColumn<RecipePackagingLine>[] = [
        {
            key: 'reference',
            label: t('kitchen:ops.batch.columnRef'),
            width: 96,
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
            label: t('kitchen:ops.batch.columnDesignation'),
            width: 200,
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
            width: 64,
            priority: 60,
            align: 'center',
            filter: unitFilter<RecipePackagingLine>(),
            value: (row) => t(unitShortKey(row.unit)),
        },
        {
            key: 'base',
            label: t('kitchen:ops.batch.columnPerBatch'),
            width: 96,
            priority: 50,
            align: 'center',
            mono: true,
            sort: (left, right, direction) =>
                compareNumber(left.quantity, right.quantity, direction),
            value: (row) => number(row.quantity),
        },
        {
            key: 'scaled',
            label: t('kitchen:ops.batch.columnToIssue'),
            width: 140,
            priority: 90,
            align: 'center',
            mono: true,
            // By what is issued, the rounded-up count: the figure the cell leads with.
            sort: (left, right, direction) =>
                compareNumber(
                    scalePackaging(left.quantity, factor, left.unit),
                    scalePackaging(right.quantity, factor, right.unit),
                    direction,
                ),
            render: (row) => {
                const applied = scalePackaging(row.quantity, factor, row.unit);
                const exact = scaleLine(row.quantity, factor);
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
        {
            key: 'basis',
            label: t('kitchen:ops.batch.columnBasis'),
            width: 140,
            priority: 40,
            filter: {
                values: (loaded) =>
                    [...new Set(loaded.map((row) => row.basis))].map((basis) => ({
                        key: basis,
                        label: t(BASIS_KEYS[basis]),
                    })),
                match: (row, value) => row.basis === value,
            },
            render: (row) => (
                <Stack space="none">
                    <Text tone="secondary" numberOfLines={1}>
                        {t(BASIS_KEYS[row.basis])}
                    </Text>
                    {row.comment === null ? null : (
                        <Text tone="secondary" variant="caption" numberOfLines={1}>
                            {row.comment}
                        </Text>
                    )}
                </Stack>
            ),
        },
    ];

    const lineControls = useColumnControls(version.lines, lineColumns, 'kitchen-batch-ingredients');
    const packagingControls = useColumnControls(
        version.packaging,
        packagingColumns,
        'kitchen-batch-packaging',
    );

    return (
        <Stack space="md">
            {/*
             * Side by side from `xl`, where each table still gets the width of its columns beside
             * the admin rail; stacked below it. `items-start`, so a short packaging list does not
             * stretch to the height of a long ingredient one.
             */}
            <View className="flex-col gap-loose xl:flex-row xl:items-start">
                <View className="min-w-0 xl:flex-1">
                    <FormSection
                        first
                        testID="kitchen-batch-consume"
                        title={t('kitchen:ops.batch.rawMaterialsHeading')}
                        aside={
                            <Text
                                variant="caption"
                                tone="secondary"
                                testID="kitchen-batch-base-times"
                            >
                                {t('kitchen:ops.batch.baseTimes', { factor: number(factor) })}
                            </Text>
                        }
                    >
                        {/*
                         * ponytail: rows are keyed by ingredient id. A sheet that lists one ingredient twice
                         * gives the two rows one key — index the rows if a kitchen hits it.
                         */}
                        <WithColumnPicker picker={lineControls.picker}>
                            <DataList<RecipeLine>
                                testID="kitchen-batch-ingredients"
                                label={t('kitchen:ops.batch.rawMaterialsHeading')}
                                columns={lineControls.columns}
                                rows={lineControls.rows}
                                rowKey={(line) => String(line.ingredientId)}
                                density="sm"
                            />
                        </WithColumnPicker>
                    </FormSection>
                </View>

                <View className="min-w-0 xl:flex-1">
                    <FormSection
                        first
                        testID="kitchen-batch-packaging-section"
                        title={t('kitchen:ops.batch.packagingScaledHeading')}
                        aside={
                            <Text variant="caption" tone="secondary">
                                {version.packaging.length === 0
                                    ? t('kitchen:ops.batch.noneRecorded')
                                    : t('kitchen:ops.batch.lineCount', {
                                          count: version.packaging.length,
                                      })}
                            </Text>
                        }
                    >
                        {version.packaging.length === 0 ? (
                            <Text
                                testID="kitchen-batch-packaging-empty"
                                variant="caption"
                                tone="secondary"
                            >
                                {t('kitchen:ops.batch.noPackaging')}
                            </Text>
                        ) : (
                            <Stack space="xs">
                                <WithColumnPicker picker={packagingControls.picker}>
                                    <DataList<RecipePackagingLine>
                                        testID="kitchen-batch-packaging"
                                        label={t('kitchen:ops.batch.packagingScaledHeading')}
                                        columns={packagingControls.columns}
                                        rows={packagingControls.rows}
                                        rowKey={(row) => String(row.ingredientId)}
                                        density="sm"
                                    />
                                </WithColumnPicker>
                                <Text variant="caption" tone="secondary">
                                    {t('kitchen:ops.batch.roundingFoot')}
                                </Text>
                            </Stack>
                        )}
                    </FormSection>
                </View>
            </View>

            {/* What the sheet promises, once, under both tables. */}
            <View
                testID="kitchen-batch-foot"
                className="gap-hair border-t border-stroke-subtle pt-2"
            >
                <Text variant="caption" tone="secondary">
                    {t('kitchen:ops.batch.footUnits')}
                </Text>
                <Text variant="caption" tone="secondary">
                    {t('kitchen:ops.batch.footNothingWritten')}
                </Text>
            </View>
        </Stack>
    );
}
