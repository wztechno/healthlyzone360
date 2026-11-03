import type {
    IngredientAdmin,
    RecipeLine,
    RecipePackagingLine,
    RecipeVersionAdmin,
} from '@healthy360/api-client/contracts';
import {
    Badge,
    Button,
    Cascade,
    EmptyState,
    ErrorState,
    InfoTip,
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
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { Gate } from '../../../access/gate.tsx';
import { toFailure } from '../../../data/hooks.ts';
import {
    recipesFromPages,
    useRecipeQuery,
    useAllRecipesQuery,
} from '../../../data/kitchen-admin-hooks.ts';
import { batchFactor, scaleLine, scalePackaging, withWaste } from '../batch-scaling.ts';
import type { BatchMode } from '../batch-scaling.ts';
import type { CatalogueColumn } from '../catalogue/catalogue-column-spec.ts';
import { ColumnPicker } from '../catalogue/column-picker.tsx';
import { LensBar } from '../catalogue/lens-bar.tsx';
import type { LensFigure } from '../catalogue/lens-bar.tsx';
import type {
    ColumnControls,
    ColumnFilter,
    ControlledColumn,
} from '../catalogue/use-column-controls.tsx';
import {
    compareNumber,
    compareText,
    useColumnControls,
} from '../catalogue/use-column-controls.tsx';
import { CATALOGUE_VIEW_PERMISSION, RECIPE_VIEW_PERMISSION } from '../entity-registry.ts';
import { displayName, parseQuantity, statusShortKey, unitShortKey } from '../format.ts';
import { BATCH_QUANTITY_FORMAT, useBatchIngredients } from '../operations/batch-sheet.tsx';
import { usePrintSheet } from '../print-sheet.tsx';
import { ProductionTable, ProductionTableSection } from '../production-desk/production-table.tsx';

/**
 * `/kitchen/batch` — one recipe, one target, and the sheet it scales to.
 *
 * ```
 * ┌──────────────────────────────────────────────────────────────────────────────────────────┐
 * │ Version v1 Published  Base yield 2.568 Kg ⓘ │ ● Batches needed 4 ⓘ  Portions produced —  [Print sheet] │
 * ├─ hairline ───────────────────────────────────────────────────────────────────────────────┤
 * │ Recipe [Classic Sauce ⌄]  [Yield (Kg) | Portions] ⓘ  Target [ 10 Kg]  13 of 13 │ [▦ Show columns] │
 * └──────────────────────────────────────────────────────────────────────────────────────────┘
 * Scaled raw materials ⓘ
 * Ref.  Item  Unit  Per batch  To issue
 * Scaled packaging
 * ```
 *
 * ## One Lens bar, as on every other kitchen page
 *
 * The version and what the target makes are the bar's figures; the recipe, the basis and the
 * target are its query row; Print sheet is its action. No page header and no Read only badge —
 * the trail names the page, and no other page wears the badge any more. A figure the planner
 * cannot work out yet reads "—"; one still loading draws the bar's skeleton.
 *
 * "Batches needed" is the factor rounded up — a kitchen runs whole batches — and its (i) keeps the
 * exact factor, because the raw-material quantities are scaled by the exact factor, not the
 * rounded one. The raw-material table's column picker sits at the bar's end, where the other
 * pages keep theirs; the packaging table, usually empty, keeps its own.
 *
 * ## Every figure is arithmetic on one version
 *
 * There is no scaling endpoint. The current version states what it makes, so the factor is a
 * division and every row a multiplication, with the version's waste rate on top — the same rule a
 * production batch reserves by, so the two screens agree for the same yield (`batch-scaling.ts`,
 * `withWaste`). Names come from the catalogue by
 * id (`RecipeLine.ingredientName` is the sheet's blank designation), which is why the `<Gate>`
 * demands `catalogue.view_organisation` beside `recipe.view_organisation`.
 *
 * ## One unit per row
 *
 * The raw-material table has a single Unit column for both "Per batch" and "To issue", so both are
 * stated in the line's own unit. Restating half a kilogram as 500 g in one column and not the other
 * would make the Unit column wrong for one of them.
 *
 * ## No shelf column
 *
 * The planner is a sheet, not a stock check. What is on the shelf belongs to the production
 * editor, where a batch is actually started against a branch.
 *
 * ## Packaging
 *
 * Packaging lines are part of the same version and are issued with the batch, so they follow as a
 * second table, rounded up where they are counted.
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

/** The recipe picker's box: long enough for a recipe's name, short enough to keep one row. */
const RECIPE_WIDTH = 240;

/**
 * Every sheet column's width. The same for all five, because the list shares its spare room in
 * proportion to width: equal widths give five equal columns, as the design draws them, rather
 * than a wide Item with a gap after it.
 */
const SHEET_COLUMN_WIDTH = 120;

const NO_LINES: readonly RecipeLine[] = [];

function BatchPlanner() {
    const { t } = useTranslation();
    const { locale } = useLocale();
    const formatter = useFormatter();
    const print = usePrintSheet();

    const [recipeId, setRecipeId] = useState<RecipeId | null>(null);
    const [modeChoice, setModeChoice] = useState<BatchMode>('yield');
    const [target, setTarget] = useState('');

    // No status filter, matching the recipe list's own default: a kitchen cooks its drafts.
    // ponytail: one 100-row page, filtered by the select's own search. A longer book wants `query`
    // pushed into the filter and refetched as the reader types, as the recipe list does.
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

    // Held here, not in the table, so the picker can sit on the Lens bar.
    const sheet = useSheetColumns(version, factor ?? 1, ingredients);
    const lines = useColumnControls(
        planned ? version.lines : NO_LINES,
        sheet.lineColumns,
        'kitchen-batch-ingredients',
    );

    /*
     * The name on the list's one line, and the status only when it is not the ordinary one. The
     * reference is searched, not shown: an import locator beside every name doubled the list.
     */
    const recipeOptions: readonly SelectOption[] = recipeRows.map((row) => ({
        value: String(row.id),
        label: displayName(row.name, locale).value,
        ...(row.meta.status === 'published'
            ? {}
            : { description: t(statusShortKey(row.meta.status)) }),
        ...(row.reference === null ? {} : { keywords: row.reference }),
    }));

    const recipesFailure = toFailure(recipes.error);
    const recordFailure = toFailure(record.error);
    const number = (value: number): string => formatter.formatNumber(value, BATCH_QUANTITY_FORMAT);
    // Kilograms until a recipe says otherwise, so the basis never loses its unit.
    const yieldUnitLabel = t(unitShortKey(version?.yieldUnit ?? 'kg'));
    // A recipe is chosen and still being read: the figures hold their line with a skeleton.
    const reading = recipeId !== null && record.data === undefined && recordFailure === null;
    const total = planned ? version.lines.length + version.packaging.length : 0;
    const shown = planned ? lines.rows.length + version.packaging.length : 0;

    return (
        <Cascade space="md" testID="kitchen-batch-planner-screen">
            <LensBar
                testID="kitchen-batch-facts"
                label={t('kitchen:lens.label')}
                figures={facts(version, factor, reading, yieldUnitLabel, number, t)}
                actions={
                    print.mode === 'browser' ? (
                        <Button
                            testID="kitchen-batch-print"
                            size="sm"
                            variant="secondary"
                            label={t('kitchen:ops.batch.printSheet')}
                            disabled={!planned}
                            onPress={print.print}
                        />
                    ) : undefined
                }
                scope={
                    <>
                        {/* The field's name on the bar, as "to" sits between the date pickers. */}
                        <Text variant="body" tone="secondary" aria-hidden>
                            {t('kitchen:ops.batch.recipeLabel')}
                        </Text>
                        {/* A fixed-width box, lifted so its list is never covered by the tables. */}
                        <View className="z-tooltip" style={{ width: RECIPE_WIDTH }}>
                            <Select
                                testID="kitchen-batch-recipe"
                                label={t('kitchen:ops.batch.recipeLabel')}
                                labelHidden
                                placeholder={t('kitchen:ops.batch.recipePlaceholder')}
                                searchable
                                loading={recipes.isPending}
                                options={recipeOptions}
                                value={recipeId === null ? null : String(recipeId)}
                                onChange={(value) => {
                                    setRecipeId(RecipeId.safeParse(value));
                                }}
                            />
                        </View>
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
                        {/* Why Portions is greyed out, for the recipe that cannot count them. */}
                        {version !== null && version.yieldPieces === null ? (
                            <InfoTip
                                testID="kitchen-batch-no-pieces-hint"
                                label={t('kitchen:ops.batch.basisLabel')}
                                text={t('kitchen:ops.batch.noPiecesHint')}
                            />
                        ) : null}
                        <Text variant="body" tone="secondary" aria-hidden>
                            {t('kitchen:ops.batch.targetLabel')}
                        </Text>
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
                    </>
                }
                result={t('kitchen:lens.result', { shown, total })}
                clearLabel={t('kitchen:lens.clear')}
                {...(lines.filtered ? { onClear: lines.clearFilters } : {})}
                trailing={planned ? <ColumnPicker {...lines.picker} /> : undefined}
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
                <ScaledSheet
                    version={version}
                    factor={factor}
                    lines={lines}
                    packagingColumns={sheet.packagingColumns}
                />
            )}
        </Cascade>
    );
}

/**
 * The version, and what the target makes of it — the four cards this page used to draw, as the
 * Lens bar's figures. The version's facts first, plain; a hairline; then what the target makes,
 * the batch count carrying the brand dot as the cost report's Margin does.
 */
function facts(
    version: RecipeVersionAdmin | null,
    factor: number | null,
    /** A recipe is chosen and its version is still on its way. */
    reading: boolean,
    yieldUnitLabel: string,
    number: (value: number) => string,
    t: TFunction,
): readonly LensFigure[] {
    const dash = t('kitchen:list.noValue');
    const pieces = version?.yieldPieces ?? null;
    // `null` draws the skeleton; `0` with the dash is a figure there is nothing to say about yet.
    const pending = (
        value: number | null,
        display: string,
    ): Pick<LensFigure, 'value' | 'display'> =>
        reading
            ? { value: null }
            : value === null
              ? { value: 0, display: dash }
              : { value, display };
    const batches = factor === null ? null : Math.ceil(factor - ROUNDED_TOLERANCE);
    const portions = factor === null || pieces === null ? null : Math.round(factor * pieces);

    return [
        {
            key: 'version',
            label: t('kitchen:ops.batch.factVersion'),
            ...pending(
                version?.versionNumber ?? null,
                version === null
                    ? dash
                    : t('kitchen:ops.batch.versionFigure', {
                          number: version.versionNumber,
                          status: t(statusShortKey(version.status)),
                      }),
            ),
            // A dot only on a version that is not the published one: the kitchen is cooking a draft.
            ...(version !== null && version.status !== 'published'
                ? { tone: 'warning' as const }
                : {}),
        },
        {
            key: 'yield',
            label: t('kitchen:ops.batch.factBaseYield'),
            ...pending(
                version?.yieldQuantity ?? null,
                version === null ? dash : `${number(version.yieldQuantity)} ${yieldUnitLabel}`,
            ),
            ...(version === null
                ? {}
                : {
                      info:
                          pieces === null
                              ? t('kitchen:ops.batch.piecesNoneInfo')
                              : t('kitchen:ops.batch.factPortionsPerBatch', { count: pieces }),
                  }),
        },
        {
            key: 'batches',
            label: t('kitchen:ops.batch.factBatchesNeeded'),
            ...pending(batches, batches === null ? dash : number(batches)),
            tone: 'brand',
            separated: true,
            ...(factor === null
                ? {}
                : { info: t('kitchen:ops.batch.roundedUpFrom', { factor: number(factor) }) }),
        },
        {
            key: 'portions',
            label: t('kitchen:ops.batch.factPortionsProduced'),
            ...pending(portions, portions === null ? dash : number(portions)),
        },
    ];
}

const rowId = (id: { toString(): string }) => `kitchen-batch-row-${String(id)}`;

/**
 * Both tables' columns. A hook rather than part of the sheet, because the raw-material controls —
 * and so these columns — live as long as the page does: the picker is on the Lens bar.
 */
function useSheetColumns(
    version: RecipeVersionAdmin | null,
    factor: number,
    ingredients: Readonly<Record<string, IngredientAdmin>>,
): {
    readonly lineColumns: readonly ControlledColumn<RecipeLine, CatalogueColumn<RecipeLine>>[];
    readonly packagingColumns: readonly ControlledColumn<
        RecipePackagingLine,
        CatalogueColumn<RecipePackagingLine>
    >[];
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

    const lineColumns: readonly ControlledColumn<RecipeLine, CatalogueColumn<RecipeLine>>[] = [
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
                <Text variant="mono" testID={`${rowId(line.ingredientId)}-quantity`}>
                    {number(scaleLine(line.quantity, ingredientFactor))}
                </Text>
            ),
        },
    ];

    const packagingColumns: readonly ControlledColumn<
        RecipePackagingLine,
        CatalogueColumn<RecipePackagingLine>
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

    return { lineColumns, packagingColumns };
}

interface ScaledSheetProps {
    readonly version: RecipeVersionAdmin;
    readonly factor: number;
    /** The raw-material table's controls; its picker is on the Lens bar. */
    readonly lines: ColumnControls<RecipeLine, CatalogueColumn<RecipeLine>>;
    readonly packagingColumns: readonly ControlledColumn<
        RecipePackagingLine,
        CatalogueColumn<RecipePackagingLine>
    >[];
}

/**
 * The scaled raw materials, then the packaging. Row test ids are
 * `kitchen-batch-row-<ingredient id>-*`, the same stem the production editor's sheet uses.
 */
function ScaledSheet({ version, factor, lines, packagingColumns }: ScaledSheetProps) {
    const { t } = useTranslation();
    const formatter = useFormatter();
    const number = (value: number): string => formatter.formatNumber(value, BATCH_QUANTITY_FORMAT);

    return (
        <Stack space="md">
            {/*
             * ponytail: rows are keyed by ingredient id. A sheet that lists one ingredient twice
             * gives the two rows one key — index the rows if a kitchen hits it.
             *
             * The factor and the waste rate are behind the title's (i), not a line beside it.
             */}
            <ProductionTableSection<RecipeLine>
                first
                testID="kitchen-batch-ingredients"
                sectionTestID="kitchen-batch-consume"
                title={t('kitchen:ops.batch.rawMaterialsHeading')}
                description={
                    version.wastePercent > 0
                        ? t('kitchen:ops.batch.baseTimesWithWaste', {
                              factor: number(factor),
                              percent: number(version.wastePercent),
                          })
                        : t('kitchen:ops.batch.baseTimes', { factor: number(factor) })
                }
                rows={version.lines}
                controls={lines}
                rowKey={(line) => String(line.ingredientId)}
            />

            <ProductionTable<RecipePackagingLine>
                testID="kitchen-batch-packaging"
                title={t('kitchen:ops.batch.packagingScaledHeading')}
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
