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
    DataList,
    ErrorState,
    FormSection,
    Inline,
    QuantityInput,
    SegmentedControl,
    Select,
    Skeleton,
    Stack,
    Text,
} from '@healthy360/design-system';
import type { DataListColumn, SelectOption } from '@healthy360/design-system';
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
    useRecipesQuery,
} from '../../../data/kitchen-admin-hooks.ts';
import { batchFactor, scaleLine, scalePackaging } from '../batch-scaling.ts';
import type { BatchMode } from '../batch-scaling.ts';
import { CataloguePageHeader } from '../catalogue/catalogue-page-header.tsx';
import { CatalogueStatCards } from '../catalogue/catalogue-stat-cards.tsx';
import type { CatalogueStatCard } from '../catalogue/catalogue-stat-cards.tsx';
import { CATALOGUE_VIEW_PERMISSION, RECIPE_VIEW_PERMISSION } from '../entity-registry.ts';
import { displayName, parseQuantity, statusShortKey, unitShortKey } from '../format.ts';
import { BATCH_QUANTITY_FORMAT, useBatchIngredients } from '../operations/batch-sheet.tsx';
import { usePrintSheet } from '../print-sheet.tsx';

/**
 * `/kitchen/batch` — one recipe, one target, and the sheet it scales to (`HealthZone Admin.dc.html`,
 * the `batch` screen).
 *
 * ```
 * [ READ ONLY ]                                                           [ Print sheet ]
 * ┌ VERSION ┐ ┌ BASE YIELD ┐ ┌ BATCHES NEEDED ┐ ┌ PORTIONS PRODUCED ┐
 *        [ Recipe ▾ ]  [ Yield (kg) | Portions ]  [ Target quantity ___ kg ]
 *                      Scale factor ×2.5 — 10 kg of product
 * ─────────────────────────────────────────────────────────────────────────────────────────
 * SCALED RAW MATERIALS   Base quantities × 2.5
 * REF.  DESIGNATION  UNIT  PER BATCH  TO ISSUE
 * SCALED PACKAGING
 * ```
 *
 * ## Every figure is arithmetic on one version
 *
 * There is no scaling endpoint. The current version states what it makes, so the factor is a
 * division and every row a multiplication — see `batch-scaling.ts`. Names come from the catalogue by
 * id (`RecipeLine.ingredientName` is the sheet's blank designation), which is why the `<Gate>`
 * demands `catalogue.view_organisation` beside `recipe.view_organisation`.
 *
 * ## One band of facts, over the controls
 *
 * The version and what the target makes sit in one strip above the controls, which are centred
 * under it as three equal 280px fields — labels on one line, controls on the next.
 * "Batches needed" is the factor rounded up — a kitchen runs whole batches — and the caption keeps the exact factor beside
 * it, because the raw-material quantities are scaled by the exact factor, not the rounded one.
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
 * ## What the design shows that the product keeps
 *
 * The design draws raw materials only. Packaging lines are part of the same version and are issued
 * with the batch, so they follow as a second table, rounded up where they are counted.
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

    const factorLine =
        factor === null || version === null
            ? t('kitchen:ops.batch.factorNone')
            : t('kitchen:ops.batch.factorLine', {
                  factor: number(factor),
                  quantity: number(factor * version.yieldQuantity),
                  unit: yieldUnitLabel,
              });

    return (
        <Stack space="md" testID="kitchen-batch-planner-screen">
            {/*
             * No title and no subtitle: the shell's trail already ends in "Batch planner", so the
             * row carries only the Read-only badge and Print.
             */}
            <CataloguePageHeader
                testID="kitchen-batch-planner-header"
                titleAside={
                    <Badge
                        testID="kitchen-batch-planner-read-only"
                        tone="neutral"
                        icon={null}
                        label={t('kitchen:ops.batch.readOnlyChip')}
                    />
                }
                primaryAction={
                    print.mode === 'browser' ? (
                        <Button
                            testID="kitchen-batch-print"
                            size="sm"
                            variant="secondary"
                            label={t('kitchen:ops.batch.printSheet')}
                            disabled={factor === null}
                            onPress={print.print}
                        />
                    ) : undefined
                }
            />

            <CatalogueStatCards
                testID="kitchen-batch-facts"
                cards={facts(
                    record.data === undefined
                        ? null
                        : [displayName(record.data.name, locale).value, record.data.reference]
                              .filter((part): part is string => part !== null && part !== '')
                              .join(' · '),
                    version,
                    factor,
                    yieldUnitLabel,
                    number,
                    t,
                )}
            />

            {/*
             * Raised: the recipe select opens downward out of this band and over the cards and
             * tables drawn after it. react-native-web gives every View `z-index: 0`, so without the
             * raise the list slides under the next sibling the moment it outgrows the band.
             */}
            <View
                testID="kitchen-batch-controls"
                className="relative z-raised gap-2 border-b border-stroke-subtle pb-3"
            >
                <Inline space="md" align="end" justify="center" wrap>
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
                     * Built as a field: the label on the field label's own step and at its 4px gap,
                     * so all three labels sit on one line and all three controls on the next.
                     */}
                    <View className="w-field flex-col gap-hair">
                        <Text variant="caption" className="font-medium">
                            {t('kitchen:ops.batch.basisLabel')}
                        </Text>
                        <SegmentedControl<BatchMode>
                            testID="kitchen-batch-mode"
                            label={t('kitchen:ops.batch.basisLabel')}
                            value={mode}
                            onChange={setModeChoice}
                            block
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
                            mode === 'pieces' ? t('kitchen:ops.batch.portionsUnit') : yieldUnitLabel
                        }
                        className="w-field"
                    />
                </Inline>

                <Stack space="xs" align="center">
                    <Text testID="kitchen-batch-factor" variant="caption" tone="secondary">
                        {factorLine}
                    </Text>
                    {version !== null && version.yieldPieces === null ? (
                        <Text
                            testID="kitchen-batch-no-pieces-hint"
                            variant="caption"
                            tone="secondary"
                        >
                            {t('kitchen:ops.batch.noPiecesHint')}
                        </Text>
                    ) : null}
                </Stack>
            </View>

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
                    {Array.from({ length: 6 }, (_, index) => (
                        <Skeleton key={index} heightClassName="h-row-sm" />
                    ))}
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

/** The version, and what the target makes of it — one band, as the design draws it. */
function facts(
    /** "Name · reference" for the chosen recipe, or `null` before one is chosen. */
    recipeLine: string | null,
    version: RecipeVersionAdmin | null,
    factor: number | null,
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
            mark: 'check',
            tone: version !== null && version.status !== 'published' ? 'warning' : 'default',
        },
        {
            key: 'yield',
            label: t('kitchen:ops.batch.factBaseYield'),
            value: version === null ? dash : number(version.yieldQuantity),
            ...(version === null ? {} : { unit: yieldUnitLabel }),
            caption:
                version !== null && pieces === null
                    ? t('kitchen:ops.batch.factPiecesNone')
                    : pieces === null
                      ? t('kitchen:ops.batch.factYieldCaption')
                      : t('kitchen:ops.batch.factPortionsPerBatch', { count: pieces }),
            mark: 'basket',
        },
        {
            key: 'batches',
            label: t('kitchen:ops.batch.factBatchesNeeded'),
            value: factor === null ? dash : number(Math.ceil(factor - ROUNDED_TOLERANCE)),
            unit: t('kitchen:ops.batch.batchesUnit'),
            caption:
                factor === null
                    ? t('kitchen:ops.batch.awaitingTarget')
                    : t('kitchen:ops.batch.roundedUpFrom', { factor: number(factor) }),
            mark: 'calendar',
        },
        {
            key: 'portions',
            label: t('kitchen:ops.batch.factPortionsProduced'),
            value: factor === null || pieces === null ? dash : number(Math.round(factor * pieces)),
            unit: t('kitchen:ops.batch.portionsUnit'),
            caption:
                version === null
                    ? t('kitchen:ops.batch.awaitingTarget')
                    : t('kitchen:ops.batch.wasteAppliesToCost', {
                          percent: number(version.wastePercent),
                      }),
            mark: 'plate',
            tone: factor === null ? 'default' : 'brand',
        },
    ];
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

    const lineColumns: readonly DataListColumn<RecipeLine>[] = [
        {
            key: 'reference',
            label: t('kitchen:ops.batch.columnRef'),
            width: 96,
            priority: 70,
            mono: true,
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
            value: (line) => t(unitShortKey(line.unit)),
        },
        {
            key: 'base',
            label: t('kitchen:ops.batch.columnPerBatch'),
            width: 96,
            priority: 50,
            align: 'end',
            mono: true,
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
            align: 'end',
            mono: true,
            render: (line) => (
                <Text variant="mono" testID={`${rowId(line.ingredientId)}-quantity`}>
                    {number(scaleLine(line.quantity, factor))}
                </Text>
            ),
        },
    ];

    const packagingColumns: readonly DataListColumn<RecipePackagingLine>[] = [
        {
            key: 'reference',
            label: t('kitchen:ops.batch.columnRef'),
            width: 96,
            priority: 70,
            mono: true,
            value: (row) => referenceOf(row.ingredientId),
        },
        {
            key: 'name',
            label: t('kitchen:ops.batch.columnDesignation'),
            width: 200,
            priority: 100,
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
            value: (row) => t(unitShortKey(row.unit)),
        },
        {
            key: 'base',
            label: t('kitchen:ops.batch.columnPerBatch'),
            width: 96,
            priority: 50,
            align: 'end',
            mono: true,
            value: (row) => number(row.quantity),
        },
        {
            key: 'scaled',
            label: t('kitchen:ops.batch.columnToIssue'),
            width: 140,
            priority: 90,
            align: 'end',
            mono: true,
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
    ];

    return (
        <Stack space="md">
            <FormSection
                first
                testID="kitchen-batch-consume"
                title={t('kitchen:ops.batch.rawMaterialsHeading')}
                aside={
                    <Text variant="caption" tone="secondary" testID="kitchen-batch-base-times">
                        {t('kitchen:ops.batch.baseTimes', { factor: number(factor) })}
                    </Text>
                }
            >
                {/*
                 * ponytail: rows are keyed by ingredient id. A sheet that lists one ingredient twice
                 * gives the two rows one key — index the rows if a kitchen hits it.
                 */}
                <DataList<RecipeLine>
                    testID="kitchen-batch-ingredients"
                    label={t('kitchen:ops.batch.rawMaterialsHeading')}
                    columns={lineColumns}
                    rows={version.lines}
                    rowKey={(line) => String(line.ingredientId)}
                    density="sm"
                />
            </FormSection>

            <FormSection
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
                    <Text testID="kitchen-batch-packaging-empty" variant="caption" tone="secondary">
                        {t('kitchen:ops.batch.noPackaging')}
                    </Text>
                ) : (
                    <Stack space="xs">
                        <DataList<RecipePackagingLine>
                            testID="kitchen-batch-packaging"
                            label={t('kitchen:ops.batch.packagingScaledHeading')}
                            columns={packagingColumns}
                            rows={version.packaging}
                            rowKey={(row) => String(row.ingredientId)}
                            density="sm"
                        />
                        <Text variant="caption" tone="secondary">
                            {t('kitchen:ops.batch.roundingFoot')}
                        </Text>
                    </Stack>
                )}
            </FormSection>
        </Stack>
    );
}
