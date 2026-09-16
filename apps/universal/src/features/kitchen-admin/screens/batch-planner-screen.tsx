import type { RecipeVersionAdmin } from '@healthy360/api-client/contracts';
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
    useRecipesQuery,
} from '../../../data/kitchen-admin-hooks.ts';
import { batchFactor } from '../batch-scaling.ts';
import type { BatchMode } from '../batch-scaling.ts';
import { CatalogueStatCards } from '../catalogue/catalogue-stat-cards.tsx';
import type { CatalogueStatCard } from '../catalogue/catalogue-stat-cards.tsx';
import { CATALOGUE_VIEW_PERMISSION, RECIPE_VIEW_PERMISSION } from '../entity-registry.ts';
import { displayName, parseQuantity, statusShortKey, unitShortKey } from '../format.ts';
import {
    BATCH_QUANTITY_FORMAT,
    BatchSheet,
    useBatchIngredients,
} from '../operations/batch-sheet.tsx';

/**
 * `/kitchen/batch` — one recipe, one target, and the sheet it scales to (Batch Planner handoff).
 *
 * ```
 * [ READ ONLY ] [ NOTHING HERE IS ORDERED OR BOOKED ]
 * ┌ CURRENT VERSION ┐ ┌ YIELD ┐ ┌ PIECES A BATCH ┐ ┌ PRODUCTION WASTE ┐   what the version states
 * [ Recipe ⌕ ▾ ]  [ By Kg | By pieces ]  [ Make ___ Kg ]
 * ┌ BATCHES ┐ ┌ RESULTING PIECES ┐                                        what the target makes
 * INGREDIENTS · 7 lines     ITEM · QUANTITY · UNIT · AS WRITTEN
 * PACKAGING   · 4 lines     ITEM · QUANTITY (from 7.5) · UNIT · BASIS
 * Units are never converted …   Nothing is written from this sheet …
 * ```
 *
 * ## Every figure is arithmetic on one version
 *
 * There is no scaling endpoint. The current version states what it makes, so the factor is a
 * division and every row a multiplication — see `batch-scaling.ts`. Names come from the catalogue by
 * id (`RecipeLine.ingredientName` is the sheet's blank designation), which is why the `<Gate>`
 * demands `catalogue.view_organisation` beside `recipe.view_organisation`.
 *
 * ## Two bands of cards, never three
 *
 * The version's facts sit above the controls because they are true before anything is typed. The
 * results sit below and carry only what the target does not already say: in yield mode "resulting
 * quantity" is the number in Make, so the band states the factor and the other axis.
 *
 * ## What the design shows that the product does not
 *
 * The canvas's `wasteUplift` and `packagingRounding: exact` are arithmetic experiments; the shipped
 * rule is no uplift and packaging rounded up, which is `batch-scaling.ts` as it stands. Its offline
 * banner has nothing behind it in the data layer.
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

function BatchPlanner() {
    const { t } = useTranslation();
    const { locale } = useLocale();
    const formatter = useFormatter();

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
     * The mode in force, derived rather than stored: a recipe that does not count in pieces can
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
    // Kilograms until a recipe says otherwise, so "By " never loses its unit.
    const yieldUnitLabel = t(unitShortKey(version?.yieldUnit ?? 'kg'));

    return (
        <Stack space="md" testID="kitchen-batch-planner-screen">
            <Inline space="xs" align="center" wrap testID="kitchen-batch-planner-chips">
                <Badge tone="neutral" icon={null} label={t('kitchen:ops.batch.readOnlyChip')} />
                <Badge
                    tone="neutral"
                    icon={null}
                    label={t('kitchen:ops.batch.nothingBookedChip')}
                />
            </Inline>

            <CatalogueStatCards
                testID="kitchen-batch-facts"
                cards={versionFacts(version, yieldUnitLabel, number, formatter, t)}
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
                        className="min-w-[280px]"
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

            <CatalogueStatCards
                testID="kitchen-batch-results"
                cards={results(version, mode, factor, yieldUnitLabel, number, t)}
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
                <Stack space="md">
                    <BatchSheet first version={version} factor={factor} ingredients={ingredients} />
                    <Stack space="xs" testID="kitchen-batch-planner-notes">
                        <Text variant="caption" tone="secondary">
                            {t('kitchen:ops.batch.unitsNote')}
                        </Text>
                        <Text variant="caption" tone="secondary">
                            {t('kitchen:ops.batch.nothingWrittenNote')}
                        </Text>
                    </Stack>
                </Stack>
            )}
        </Stack>
    );
}

type Formatter = ReturnType<typeof useFormatter>;

/** What the version states before anything is scaled. */
function versionFacts(
    version: RecipeVersionAdmin | null,
    yieldUnitLabel: string,
    number: (value: number) => string,
    formatter: Formatter,
    t: TFunction,
): readonly CatalogueStatCard[] {
    const dash = t('kitchen:list.noValue');
    return [
        {
            key: 'version',
            label: t('kitchen:ops.batch.columnVersion'),
            value:
                version === null
                    ? dash
                    : t('kitchen:ops.batch.versionCell', { number: version.versionNumber }),
            caption:
                version === null
                    ? t('kitchen:ops.batch.noRecipeCaption')
                    : t(statusShortKey(version.status)),
            mark: 'check',
            tone: version !== null && version.status !== 'published' ? 'warning' : 'default',
        },
        {
            key: 'yield',
            label: t('kitchen:ops.batch.factYield'),
            value: version === null ? dash : number(version.yieldQuantity),
            unit: version === null ? undefined : yieldUnitLabel,
            caption: t('kitchen:ops.batch.factYieldCaption'),
            mark: 'basket',
        },
        {
            key: 'pieces',
            label: t('kitchen:ops.batch.factPieces'),
            value:
                version === null || version.yieldPieces === null
                    ? dash
                    : number(version.yieldPieces),
            caption:
                version !== null && version.yieldPieces === null
                    ? t('kitchen:ops.batch.factPiecesNone')
                    : t('kitchen:ops.batch.factPiecesCaption'),
            mark: 'plate',
        },
        {
            key: 'waste',
            label: t('kitchen:ops.batch.metrics.waste'),
            value: version === null ? dash : formatter.formatNumber(version.wastePercent),
            unit: version === null ? undefined : '%',
            caption: t('kitchen:ops.batch.factWasteCaption'),
            mark: 'warning',
        },
    ];
}

/** What the target makes: the factor, and whichever axis the cook did not type. */
function results(
    version: RecipeVersionAdmin | null,
    mode: BatchMode,
    factor: number | null,
    yieldUnitLabel: string,
    number: (value: number) => string,
    t: TFunction,
): readonly CatalogueStatCard[] {
    const dash = t('kitchen:list.noValue');
    const batches: CatalogueStatCard = {
        key: 'batches',
        label: t('kitchen:ops.batch.metrics.batches'),
        value: factor === null ? dash : number(factor),
        unit: t('kitchen:ops.batch.batchesUnit'),
        caption: t('kitchen:ops.batch.batchesCaption'),
        mark: 'calendar',
        tone: factor === null ? 'default' : 'brand',
    };
    if (mode === 'pieces') {
        const quantity =
            factor === null || version === null ? null : factor * version.yieldQuantity;
        return [
            batches,
            {
                key: 'quantity',
                label: t('kitchen:ops.batch.metrics.quantity'),
                value: quantity === null ? dash : number(quantity),
                unit: quantity === null ? undefined : yieldUnitLabel,
                caption: t('kitchen:ops.batch.quantityCaption'),
                mark: 'basket',
            },
        ];
    }
    const pieces =
        factor === null || version === null || version.yieldPieces === null
            ? null
            : factor * version.yieldPieces;
    return [
        batches,
        {
            key: 'pieces',
            label: t('kitchen:ops.batch.metrics.pieces'),
            value: pieces === null ? dash : number(pieces),
            caption:
                version !== null && version.yieldPieces === null
                    ? t('kitchen:ops.batch.factPiecesNone')
                    : t('kitchen:ops.batch.piecesCaption'),
            mark: 'plate',
        },
    ];
}
