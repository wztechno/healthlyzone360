import type {
    IngredientAdmin,
    PackagingBasis,
    RecipeLine,
    RecipePackagingLine,
    RecipeVersionAdmin,
} from '@healthy360/api-client/contracts';
import {
    Badge,
    Callout,
    ErrorState,
    Inline,
    QuantityInput,
    SegmentedControl,
    Select,
    Skeleton,
    Stack,
    Table,
    Text,
} from '@healthy360/design-system';
import type { SelectOption, TableColumn } from '@healthy360/design-system';
import { RecipeId } from '@healthy360/domain-types';
import type { IngredientId } from '@healthy360/domain-types';
import { useFormatter, useLocale } from '@healthy360/i18n';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { Gate } from '../../../access/gate.tsx';
import { toFailure } from '../../../data/hooks.ts';
import {
    recipesFromPages,
    useIngredientsByIds,
    useRecipeQuery,
    useRecipesQuery,
} from '../../../data/kitchen-admin-hooks.ts';
import { batchFactor, displayQuantity, scaleLine, scalePackaging } from '../batch-scaling.ts';
import type { BatchMode } from '../batch-scaling.ts';
import { CATALOGUE_VIEW_PERMISSION, RECIPE_VIEW_PERMISSION } from '../entity-registry.ts';
import { displayName, parseQuantity, statusKey, statusTone, unitShortKey } from '../format.ts';
import { KitchenPageHeader } from '../kitchen-page-header.tsx';
import { KpiTile } from '../kpi-tile.tsx';

/**
 * `/kitchen/batch` — a recipe, a quantity, and the weigh-out sheet that follows from them.
 *
 * A cook picks a recipe, says how much to produce, and reads off what to weigh and what to pack it
 * in. That is the whole surface. It creates nothing, books nothing and costs nothing: a production
 * *order* is the production screen's, a buy list is the requirements screen's, and money does not
 * appear on this page at all — which is why the family is a `workbench` card with no manage
 * permission.
 *
 * ## Every figure is arithmetic on one version
 *
 * There is no scaling endpoint and this slice does not add one. The current version already states
 * what it makes, so the factor is a division and every row is a multiplication — see
 * `batch-scaling.ts`, where the interesting cases live as pure functions. The consequence worth
 * stating is what the arithmetic will *not* do: it never converts a unit on the way to a figure. A
 * line written in grams is scaled in grams. The one restatement is on the way out — a fraction of a
 * kilogram is *read* as grams (`displayQuantity`), because a cook weighs 526 g, not 0.526 kg — and
 * it borrows the catalogue's conversion table rather than keeping a second one, which is how two
 * parts of one product would start disagreeing about what a kilogram is.
 *
 * ## Names come from the catalogue, never from the line
 *
 * `RecipeLine.ingredientName` looks like the answer and is not one: the mapper fills it from the
 * sheet's own `source_designation`, which is blank on most rows. So every name on this page —
 * ingredients and packaging alike — is resolved by id through `useIngredientsByIds`, and the
 * designation as written keeps its own column instead of standing in for the name it is not.
 *
 * ## Two permissions, one registry slot
 *
 * Reading a recipe is `recipe.view_organisation`; resolving those ids is `catalogue.view_organisation`,
 * because the ingredient endpoint asks for it. The `<Gate>` demands both — a person holding only the
 * first would meet a page of em dashes where the ingredient names should be.
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

/** The three packaging bases, as keys. A template literal would not typecheck against `t`. */
const BASIS_KEYS: Readonly<Record<PackagingBasis, string>> = {
    fills_yield: 'kitchen:ops.batch.basis.fills_yield',
    per_container: 'kitchen:ops.batch.basis.per_container',
    per_batch: 'kitchen:ops.batch.basis.per_batch',
};

/** Scaled quantities are shown to three decimals: 0.4 of an egg is a real instruction, 0.4000 is noise. */
const QUANTITY_FORMAT: Intl.NumberFormatOptions = { maximumFractionDigits: 3 };

function BatchPlanner() {
    const { t } = useTranslation();
    const { locale } = useLocale();
    const formatter = useFormatter();

    const [recipeId, setRecipeId] = useState<RecipeId | null>(null);
    const [modeChoice, setModeChoice] = useState<BatchMode>('yield');
    const [target, setTarget] = useState('');

    // No status filter, matching the recipe list's own default: a kitchen cooks its drafts.
    // ponytail: one 100-row page, filtered client-side by the select's own search. A kitchen with a
    // longer book wants `query` pushed into the filter and refetched as the reader types — the
    // recipe list already does exactly that and is the pattern to copy.
    const recipes = useRecipesQuery({ limit: 100 });
    const recipeRows = recipesFromPages(recipes.data?.pages);

    const record = useRecipeQuery(recipeId);
    const version = record.data?.currentVersion ?? null;

    /**
     * The mode actually in force, derived rather than stored.
     *
     * A recipe that does not count in pieces can only be planned by yield, and the segmented
     * control says so by disabling that half. Resetting `modeChoice` in an effect would be the
     * other way to get here, and it would lose the cook's choice every time they looked at a
     * recipe with no piece count on their way to one that has it.
     */
    const mode: BatchMode = version === null || version.yieldPieces === null ? 'yield' : modeChoice;
    const factor = version === null ? null : batchFactor(version, mode, parseQuantity(target));

    /**
     * Every ingredient this version names, ingredients and packaging together and each id once.
     *
     * Keyed by the string form because the branded ids are plain strings at runtime; the map keeps
     * the branded value so the hook is still called with `IngredientId`s.
     */
    const ingredientIds = useMemo<readonly IngredientId[]>(() => {
        if (version === null) return [];
        const byId = new Map<string, IngredientId>();
        for (const line of version.lines) byId.set(String(line.ingredientId), line.ingredientId);
        for (const row of version.packaging) byId.set(String(row.ingredientId), row.ingredientId);
        return [...byId.values()];
    }, [version]);

    const ingredients = useIngredientsByIds(ingredientIds);

    const recipeOptions: readonly SelectOption[] = recipeRows.map((row) => {
        const description = [row.reference, t(statusKey(row.meta.status))].filter(
            (part): part is string => part !== null,
        );
        return {
            value: String(row.id),
            label: displayName(row.name, locale).value,
            description: description.join(' · '),
        };
    });

    /** A formatted figure, or `null` for one the page genuinely cannot state yet. */
    const quantity = (value: number | null): string | null =>
        value === null ? null : formatter.formatNumber(value, QUANTITY_FORMAT);

    const recipesFailure = toFailure(recipes.error);
    const recordFailure = toFailure(record.error);

    // Kilograms until a recipe says otherwise: every formulation in this kitchen yields a mass, and
    // "By " with nothing after it is a control that has lost its label.
    const yieldUnitLabel = t(unitShortKey(version?.yieldUnit ?? 'kg'));

    return (
        <Stack space="lg" testID="kitchen-batch-planner-screen">
            <KitchenPageHeader
                testID="kitchen-batch-planner-header"
                title={t('kitchen:ops.batch.title')}
                subtitle={t('kitchen:ops.batch.subtitle')}
                statusChip={
                    version === null ? undefined : (
                        <Badge
                            testID="kitchen-batch-status"
                            tone={statusTone(version.status)}
                            label={t(statusKey(version.status))}
                        />
                    )
                }
            />

            {/*
             * Raised, because the recipe select opens *downward* out of this panel and over the
             * tiles and tables drawn after it. react-native-web gives every View
             * `position: relative; z-index: 0`, so a panel paints as one layer in source order
             * among its siblings whatever the select sets on its own listbox; without the raise the
             * list slid under the metrics the moment it grew past the panel's edge.
             */}
            <View
                testID="kitchen-batch-controls"
                className="relative z-raised gap-3 rounded-panel border border-brand-100 bg-surface-raised p-4 shadow-elevation-card"
            >
                <Inline space="sm" align="end" wrap>
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
                        className="min-w-[260px]"
                    />

                    <Stack space="xs">
                        <Text variant="micro" tone="secondary">
                            {t('kitchen:ops.batch.modeLabel')}
                        </Text>
                        <SegmentedControl<BatchMode>
                            testID="kitchen-batch-mode"
                            label={t('kitchen:ops.batch.modeLabel')}
                            value={mode}
                            onChange={setModeChoice}
                            items={[
                                {
                                    value: 'yield',
                                    label: t('kitchen:ops.batch.modeYield', {
                                        unit: yieldUnitLabel,
                                    }),
                                    testID: 'kitchen-batch-mode-yield',
                                },
                                {
                                    value: 'pieces',
                                    label: t('kitchen:ops.batch.modePieces'),
                                    disabled: version === null || version.yieldPieces === null,
                                    testID: 'kitchen-batch-mode-pieces',
                                },
                            ]}
                        />
                    </Stack>

                    <QuantityInput
                        testID="kitchen-batch-target"
                        size="sm"
                        label={t('kitchen:ops.batch.targetLabel')}
                        value={target}
                        onChangeText={setTarget}
                        unit={
                            mode === 'pieces' ? t('kitchen:ops.batch.piecesUnit') : yieldUnitLabel
                        }
                        className="w-40"
                    />
                </Inline>

                {version !== null && version.yieldPieces === null ? (
                    <Text testID="kitchen-batch-no-pieces-hint" variant="caption" tone="secondary">
                        {t('kitchen:ops.batch.noPiecesHint')}
                    </Text>
                ) : null}
            </View>

            <View testID="kitchen-batch-metrics" className="flex-row flex-wrap gap-3">
                <KpiTile
                    testID="kitchen-batch-metric-batches"
                    label={t('kitchen:ops.batch.metrics.batches')}
                    value={quantity(factor)}
                />
                <KpiTile
                    testID="kitchen-batch-metric-quantity"
                    label={t('kitchen:ops.batch.metrics.quantity')}
                    value={
                        factor === null || version === null
                            ? null
                            : `${formatter.formatNumber(
                                  factor * version.yieldQuantity,
                                  QUANTITY_FORMAT,
                              )} ${yieldUnitLabel}`
                    }
                />
                <KpiTile
                    testID="kitchen-batch-metric-pieces"
                    label={t('kitchen:ops.batch.metrics.pieces')}
                    value={
                        factor === null || version === null || version.yieldPieces === null
                            ? null
                            : quantity(factor * version.yieldPieces)
                    }
                />
                <KpiTile
                    testID="kitchen-batch-metric-waste"
                    // Informational, and deliberately not multiplied into anything below: the
                    // sheets state process loss on the output, not on each input.
                    label={t('kitchen:ops.batch.metrics.waste')}
                    value={
                        version === null ? null : `${formatter.formatNumber(version.wastePercent)}%`
                    }
                />
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
            ) : record.isPending ? (
                <Stack space="sm" testID="kitchen-batch-planner-loading">
                    {Array.from({ length: 4 }, (_, index) => (
                        <Skeleton key={index} heightClassName="h-10" />
                    ))}
                </Stack>
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
            ) : version === null || factor === null ? (
                <Callout
                    testID="kitchen-batch-planner-target-needed"
                    tone="info"
                    title={t('kitchen:ops.batch.targetNeededTitle')}
                    body={t('kitchen:ops.batch.targetNeededBody')}
                />
            ) : (
                <ScaledOutput version={version} factor={factor} ingredients={ingredients} />
            )}
        </Stack>
    );
}

interface ScaledOutputProps {
    readonly version: RecipeVersionAdmin;
    /** Always a real factor — the caller renders the "say how much" callout instead of `null`. */
    readonly factor: number;
    readonly ingredients: Readonly<Record<string, IngredientAdmin>>;
}

/**
 * The two tables, once there is something to scale.
 *
 * A component rather than a branch inside the screen so `factor` and `version` arrive non-null and
 * every cell can simply multiply, instead of each render carrying a fallback for a state its own
 * caller has already ruled out.
 */
function ScaledOutput({ version, factor, ingredients }: ScaledOutputProps) {
    const { t } = useTranslation();
    const { locale } = useLocale();
    const formatter = useFormatter();

    const dash = t('kitchen:list.noValue');

    /**
     * The catalogue's name for an id, or the dash.
     *
     * A miss is the honest answer while the per-id reads are still in flight, and it stays the
     * answer for a row whose ingredient the reader may not see — never the line's own
     * `ingredientName`, which is the sheet's designation and usually empty.
     */
    const nameOf = (ingredientId: IngredientId): string => {
        const found = ingredients[String(ingredientId)];
        return found === undefined ? dash : displayName(found.name, locale).value;
    };

    const number = (value: number): string => formatter.formatNumber(value, QUANTITY_FORMAT);

    // ponytail: rows are keyed by ingredient id. A sheet that legitimately lists one ingredient
    // twice gives the two rows one key — index the rows if a kitchen hits it.
    const lineColumns: readonly TableColumn<RecipeLine>[] = [
        {
            key: 'item',
            header: t('kitchen:ops.batch.columnItem'),
            rowHeader: true,
            flex: 2,
            render: (line) => (
                <Inline space="xs" align="center" wrap>
                    <Text
                        variant="bodyStrong"
                        testID={`kitchen-batch-row-${String(line.ingredientId)}-name`}
                    >
                        {nameOf(line.ingredientId)}
                    </Text>
                    {line.isOptional ? (
                        <Badge
                            testID={`kitchen-batch-row-${String(line.ingredientId)}-optional`}
                            tone="neutral"
                            icon={null}
                            label={t('kitchen:ops.batch.optionalBadge')}
                        />
                    ) : null}
                </Inline>
            ),
        },
        {
            key: 'quantity',
            header: t('kitchen:ops.batch.columnQuantity'),
            numeric: true,
            primary: true,
            render: (line) => (
                <Text testID={`kitchen-batch-row-${String(line.ingredientId)}-quantity`}>
                    {number(displayQuantity(scaleLine(line.quantity, factor), line.unit).quantity)}
                </Text>
            ),
        },
        {
            key: 'unit',
            header: t('kitchen:ops.batch.columnUnit'),
            // The unit the figure beside it is read in — grams under a kilogram — so the two cells
            // are one statement. See `displayQuantity`.
            render: (line) => (
                <Text tone="secondary">
                    {t(
                        unitShortKey(
                            displayQuantity(scaleLine(line.quantity, factor), line.unit).unit,
                        ),
                    )}
                </Text>
            ),
        },
        {
            key: 'note',
            header: t('kitchen:ops.batch.columnNote'),
            render: (line) => (
                <Text tone="secondary" variant="caption">
                    {line.sourceDesignation ?? dash}
                </Text>
            ),
        },
    ];

    const packagingColumns: readonly TableColumn<RecipePackagingLine>[] = [
        {
            key: 'item',
            header: t('kitchen:ops.batch.columnItem'),
            rowHeader: true,
            flex: 2,
            render: (row) => (
                <Text
                    variant="bodyStrong"
                    testID={`kitchen-batch-row-${String(row.ingredientId)}-name`}
                >
                    {nameOf(row.ingredientId)}
                </Text>
            ),
        },
        {
            key: 'quantity',
            header: t('kitchen:ops.batch.columnQuantity'),
            numeric: true,
            primary: true,
            render: (row) => (
                <Text testID={`kitchen-batch-row-${String(row.ingredientId)}-quantity`}>
                    {number(
                        displayQuantity(scalePackaging(row.quantity, factor, row.unit), row.unit)
                            .quantity,
                    )}
                </Text>
            ),
        },
        {
            key: 'unit',
            header: t('kitchen:ops.batch.columnUnit'),
            render: (row) => (
                <Text tone="secondary">
                    {t(
                        unitShortKey(
                            displayQuantity(
                                scalePackaging(row.quantity, factor, row.unit),
                                row.unit,
                            ).unit,
                        ),
                    )}
                </Text>
            ),
        },
        {
            key: 'basis',
            header: t('kitchen:ops.batch.columnBasis'),
            render: (row) => (
                <Stack space="none">
                    <Text tone="secondary">{t(BASIS_KEYS[row.basis])}</Text>
                    {row.comment === null ? null : (
                        <Text tone="secondary" variant="caption">
                            {row.comment}
                        </Text>
                    )}
                </Stack>
            ),
        },
    ];

    return (
        <Stack space="lg">
            <Table<RecipeLine>
                testID="kitchen-batch-ingredients"
                caption={t('kitchen:ops.batch.ingredientsHeading')}
                columns={lineColumns}
                rows={version.lines}
                rowKey={(line) => String(line.ingredientId)}
                rowSize="sm"
            />

            {version.packaging.length === 0 ? (
                <Text testID="kitchen-batch-packaging-empty" variant="caption" tone="secondary">
                    {t('kitchen:ops.batch.noPackaging')}
                </Text>
            ) : (
                <Table<RecipePackagingLine>
                    testID="kitchen-batch-packaging"
                    caption={t('kitchen:ops.batch.packagingHeading')}
                    columns={packagingColumns}
                    rows={version.packaging}
                    rowKey={(row) => String(row.ingredientId)}
                    rowSize="sm"
                />
            )}
        </Stack>
    );
}
