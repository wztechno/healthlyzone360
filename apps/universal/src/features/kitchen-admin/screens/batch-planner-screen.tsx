import type { PublishableStatus, RecipeAdminSummary } from '@healthy360/api-client/contracts';
import {
    Badge,
    Callout,
    EmptyState,
    ErrorState,
    FormSection,
    Inline,
    QuantityInput,
    RecordWindow,
    SegmentedControl,
    Skeleton,
    Stack,
    Text,
} from '@healthy360/design-system';
import type { MenuItem } from '@healthy360/design-system';
import type { RecipeId } from '@healthy360/domain-types';
import { useFormatter, useLocale } from '@healthy360/i18n';
import { useRouter } from 'expo-router';
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
import { CATALOGUE_ROW_ICONS } from '../catalogue/catalogue-list-item.tsx';
import { CatalogueList } from '../catalogue/catalogue-list.tsx';
import type { CatalogueColumn } from '../catalogue/catalogue-column-spec.ts';
import { CataloguePager } from '../catalogue/catalogue-pager.tsx';
import { CatalogueStatCards } from '../catalogue/catalogue-stat-cards.tsx';
import type { CatalogueStatCard } from '../catalogue/catalogue-stat-cards.tsx';
import { CatalogueToolbar } from '../catalogue/catalogue-toolbar.tsx';
import type { CatalogueStatusSegment } from '../catalogue/catalogue-toolbar.tsx';
import { compareNumber, compareText, useColumnControls } from '../catalogue/use-column-controls.tsx';
import type { ControlledColumn } from '../catalogue/use-column-controls.tsx';
import { EditorFrame } from '../editor-frame.tsx';
import { CATALOGUE_VIEW_PERMISSION, RECIPE_VIEW_PERMISSION } from '../entity-registry.ts';
import { displayName, parseQuantity, statusShortKey, statusTone, unitShortKey } from '../format.ts';
import { KpiTile } from '../kpi-tile.tsx';
import {
    BATCH_QUANTITY_FORMAT,
    BatchSheet,
    useBatchIngredients,
    useShelfAvailability,
} from '../operations/batch-sheet.tsx';
import { useOptimisticConcurrency } from '../use-optimistic-concurrency.ts';
import { useUnsavedGuard } from '../use-unsaved-guard.ts';

/**
 * `/kitchen/batch` — the recipe book as a list, and behind each row the batch sheet (Operations
 * handoff, `batch` + `edProduction`).
 *
 * ```
 * ┌ SHOWN ┐ ┌ PUBLISHED ┐ ┌ DRAFT ┐
 * [ ⌕ recipe name or reference ]  [ All | Live | Draft ]
 * RECIPE              CURRENT VERSION   LAST CHANGED                 ◉ ✎
 * ```
 *
 * The page creates nothing, books nothing and costs nothing: a production *order* is the
 * production screen's, which is where the sheet's one action goes.
 *
 * ## Every figure is arithmetic on one version
 *
 * There is no scaling endpoint. The current version states what it makes, so the factor is a
 * division and every row a multiplication — see `batch-scaling.ts`. Names come from the catalogue by
 * id (`RecipeLine.ingredientName` is the sheet's blank designation), which is why the `<Gate>`
 * demands `catalogue.view_organisation` beside `recipe.view_organisation`.
 *
 * ## What the design shows that the data does not
 *
 * The design's Yield and Portions columns and its `Short` segment need the current version of every
 * recipe on the page; the list endpoint returns summaries, so those live on the sheet, not the list.
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

const PAGE_SIZE = 25;
const SEGMENT_STATUSES: readonly PublishableStatus[] = ['published', 'draft'];
type StatusSegmentValue = PublishableStatus | 'all';

function recipeRowTestId(recipeId: string): string {
    return `kitchen-batch-recipe-${recipeId}`;
}

function BatchPlanner() {
    const [sheetFor, setSheetFor] = useState<RecipeId | null>(null);

    return sheetFor === null ? (
        <RecipeBook onOpen={setSheetFor} />
    ) : (
        <BatchSheetEditor
            recipeId={sheetFor}
            onBack={() => {
                setSheetFor(null);
            }}
        />
    );
}

function RecipeBook({ onOpen }: { readonly onOpen: (recipeId: RecipeId) => void }) {
    const { t } = useTranslation();
    const { locale } = useLocale();
    const formatter = useFormatter();

    const [query, setQuery] = useState('');
    const [status, setStatus] = useState<StatusSegmentValue>('all');
    const [viewing, setViewing] = useState<RecipeAdminSummary | null>(null);

    // ponytail: one 100-row page, filtered here. A longer book wants `query` in the filter.
    const recipes = useRecipesQuery({ limit: 100 });
    const all = useMemo(() => recipesFromPages(recipes.data?.pages), [recipes.data]);

    const trimmed = query.trim().toLowerCase();
    const filtered = useMemo(
        () =>
            all.filter((row) => {
                if (status !== 'all' && row.meta.status !== status) return false;
                if (trimmed === '') return true;
                return [displayName(row.name, locale).value, row.reference ?? '']
                    .join(' ')
                    .toLowerCase()
                    .includes(trimmed);
            }),
        [all, status, trimmed, locale],
    );

    const [page, setPage] = useState(1);
    const [pageKey, setPageKey] = useState(`${trimmed}|${status}`);
    if (pageKey !== `${trimmed}|${status}`) {
        setPageKey(`${trimmed}|${status}`);
        setPage(1);
    }

    const changedText = (row: RecipeAdminSummary): string =>
        row.meta.updatedByName === null
            ? `${formatter.formatRelativeTime(row.meta.updatedAt)} ${t('kitchen:list.updatedBySeed')}`
            : `${formatter.formatRelativeTime(row.meta.updatedAt)} ${t('kitchen:list.updatedBy', { name: row.meta.updatedByName })}`;

    const columns: readonly ControlledColumn<
        RecipeAdminSummary,
        CatalogueColumn<RecipeAdminSummary>
    >[] = [
        {
            key: 'name',
            role: 'title',
            label: t('kitchen:ops.batch.columnRecipe'),
            width: 260,
            priority: 100,
            value: (row) => displayName(row.name, locale).value,
            sort: (left, right, direction) =>
                compareText(
                    displayName(left.name, locale).value,
                    displayName(right.name, locale).value,
                    direction,
                ),
            render: (row) => {
                const testID = recipeRowTestId(String(row.id));
                return (
                    <View testID={testID} className="min-w-0 flex-col">
                        <Text variant="strong" numberOfLines={1} testID={`${testID}-name`}>
                            {displayName(row.name, locale).value}
                        </Text>
                        {row.reference === null ? null : (
                            <Text variant="mono" tone="secondary" numberOfLines={1}>
                                {row.reference}
                            </Text>
                        )}
                    </View>
                );
            },
        },
        {
            key: 'version',
            role: 'meta',
            label: t('kitchen:ops.batch.columnVersion'),
            width: 130,
            priority: 70,
            value: (row) => versionText(row, t),
            sort: (left, right, direction) =>
                compareNumber(left.currentVersionNumber, right.currentVersionNumber, direction),
            render: (row) => (
                <Text variant="mono" testID={`${recipeRowTestId(String(row.id))}-version`}>
                    {versionText(row, t)}
                </Text>
            ),
        },
        {
            key: 'status',
            role: 'status',
            label: t('kitchen:list.columnStatus'),
            width: 96,
            priority: 80,
            value: (row) => t(statusShortKey(row.meta.status)),
            render: (row) => (
                <Badge
                    testID={`${recipeRowTestId(String(row.id))}-status`}
                    tone={statusTone(row.meta.status)}
                    label={t(statusShortKey(row.meta.status))}
                />
            ),
        },
        {
            key: 'updatedAt',
            label: t('kitchen:ops.batch.columnChanged'),
            width: 190,
            priority: 20,
            value: changedText,
            sort: (left, right, direction) =>
                compareText(left.meta.updatedAt, right.meta.updatedAt, direction),
            render: (row) => (
                <Text variant="caption" tone="secondary" numberOfLines={1}>
                    {changedText(row)}
                </Text>
            ),
        },
    ];

    const controls = useColumnControls(filtered, columns, 'kitchen-batch-planner');
    const totalPages = Math.max(1, Math.ceil(controls.rows.length / PAGE_SIZE));
    // A header filter can narrow the rows under the page in hand; land on the last page there is.
    const currentPage = Math.min(page, totalPages);
    const pageRows = controls.rows.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);
    const failure = toFailure(recipes.error);
    const unfiltered = trimmed === '' && status === 'all';

    const statusSegments: readonly CatalogueStatusSegment<StatusSegmentValue>[] = [
        { value: 'all', label: t('kitchen:toolbar.statusAll') },
        ...SEGMENT_STATUSES.map((value) => ({ value, label: t(statusShortKey(value)) })),
    ];

    const open = (row: RecipeAdminSummary) => {
        setViewing(null);
        onOpen(row.id);
    };

    return (
        <Stack space="md" testID="kitchen-batch-planner-screen">
            {recipes.isPending || failure !== null ? null : (
                <CatalogueStatCards
                    testID="kitchen-batch-planner-stats"
                    cards={statCards(controls.rows, all.length, unfiltered, t, () => {
                        setQuery('');
                        setStatus('all');
                    })}
                />
            )}

            <CatalogueToolbar<StatusSegmentValue>
                testID="kitchen-batch-planner-toolbar"
                search={query}
                onSearchChange={(next) => {
                    setQuery(next);
                    setViewing(null);
                }}
                searchLabel={t('kitchen:toolbar.searchLabel')}
                searchPlaceholder={t('kitchen:ops.batch.searchPlaceholder')}
                statusLabel={t('kitchen:toolbar.statusLabel')}
                statusSegments={statusSegments}
                status={status}
                onStatusChange={(next) => {
                    setStatus(next);
                    setViewing(null);
                }}
            />

            {recipes.isPending ? (
                <Stack space="xs" testID="kitchen-batch-planner-loading">
                    {Array.from({ length: 5 }, (_, index) => (
                        <Skeleton key={index} heightClassName="h-row-sm" />
                    ))}
                </Stack>
            ) : failure !== null ? (
                <ErrorState
                    testID="kitchen-batch-planner-recipes-error"
                    failure={failure}
                    title={t('kitchen:ops.batch.recipesErrorTitle')}
                    onRetry={() => {
                        void recipes.refetch();
                    }}
                    retrying={recipes.isFetching}
                />
            ) : controls.rows.length === 0 ? (
                <EmptyState
                    testID="kitchen-batch-planner-empty"
                    title={
                        unfiltered
                            ? t('kitchen:ops.batch.emptyTitle')
                            : t('kitchen:ops.batch.filteredEmptyTitle')
                    }
                    body={
                        unfiltered
                            ? t('kitchen:ops.batch.emptyBody')
                            : t('kitchen:ops.batch.filteredEmptyBody')
                    }
                />
            ) : (
                <Stack space="sm">
                    <CatalogueList<RecipeAdminSummary>
                        testID="kitchen-batch-planner-table"
                        label={t('kitchen:ops.batch.caption')}
                        columns={controls.columns}
                        rows={pageRows}
                        rowKey={(row) => String(row.id)}
                        density="sm"
                        onRowPress={open}
                        rowActionsLabel={t('kitchen:list.rowActions')}
                        rowActions={(row): readonly MenuItem[] => [
                            {
                                key: 'view',
                                label: t('kitchen:list.view'),
                                icon: CATALOGUE_ROW_ICONS.view,
                                testID: `${recipeRowTestId(String(row.id))}-view`,
                                onSelect: () => {
                                    setViewing(row);
                                },
                            },
                            {
                                key: 'open',
                                label: t('kitchen:ops.batch.openSheet'),
                                icon: CATALOGUE_ROW_ICONS.edit,
                                testID: `${recipeRowTestId(String(row.id))}-open`,
                                onSelect: () => {
                                    open(row);
                                },
                            },
                        ]}
                    />

                    <CataloguePager
                        testID="kitchen-batch-planner-pagination"
                        range={t('kitchen:toolbar.showing', {
                            shown: pageRows.length,
                            total: controls.rows.length,
                        })}
                        page={currentPage}
                        totalPages={totalPages}
                        onPageChange={(next) => {
                            setPage(next);
                            setViewing(null);
                        }}
                        label={t('kitchen:catalogue.pagerLabel')}
                    />
                </Stack>
            )}

            {viewing === null ? null : (
                <RecordWindow
                    testID="kitchen-batch-planner-view"
                    open
                    onClose={() => {
                        setViewing(null);
                    }}
                    title={displayName(viewing.name, locale).value}
                    kind={t('kitchen:ops.batch.viewKind')}
                    status={{
                        label: t(statusShortKey(viewing.meta.status)),
                        tone: statusTone(viewing.meta.status),
                    }}
                    footNote={t('kitchen:ops.batch.footNote')}
                    fields={[
                        {
                            key: 'reference',
                            label: t('kitchen:ops.batch.fieldReference'),
                            value: viewing.reference ?? t('kitchen:list.noValue'),
                            mono: true,
                        },
                        {
                            key: 'version',
                            label: t('kitchen:ops.batch.columnVersion'),
                            value: versionText(viewing, t),
                            mono: true,
                        },
                        {
                            key: 'changed',
                            label: t('kitchen:ops.batch.columnChanged'),
                            value: changedText(viewing),
                        },
                    ]}
                    primaryAction={{
                        label: t('kitchen:ops.batch.openSheet'),
                        onPress: () => {
                            open(viewing);
                        },
                    }}
                />
            )}
        </Stack>
    );
}

function versionText(row: RecipeAdminSummary, t: TFunction): string {
    return t('kitchen:ops.batch.versionCell', { number: row.currentVersionNumber });
}

/** Counted over the rows in hand, like the design's CARDS. */
function statCards(
    rows: readonly RecipeAdminSummary[],
    total: number,
    unfiltered: boolean,
    t: TFunction,
    clear: () => void,
): readonly CatalogueStatCard[] {
    const published = rows.filter((row) => row.meta.status === 'published').length;
    const draft = rows.filter((row) => row.meta.status === 'draft').length;
    return [
        {
            key: 'shown',
            label: t('kitchen:list.statShown'),
            value: String(rows.length),
            unit: t('kitchen:list.statShownUnit', { total }),
            caption: unfiltered
                ? t('kitchen:list.statShownUnfiltered')
                : t('kitchen:list.statShownFiltered'),
            mark: 'calendar',
            tone: 'brand',
            onPress: clear,
            accessibilityLabel: t('kitchen:list.statShownAction'),
        },
        {
            key: 'published',
            label: t(statusShortKey('published')),
            value: String(published),
            unit: t('kitchen:list.statRecords'),
            caption: t('kitchen:ops.batch.statPublishedCaption'),
            mark: 'check',
        },
        {
            key: 'draft',
            label: t(statusShortKey('draft')),
            value: String(draft),
            unit: t('kitchen:list.statRecords'),
            caption: t('kitchen:ops.batch.statDraftCaption'),
            mark: 'warning',
            tone: draft === 0 ? 'default' : 'warning',
        },
    ];
}

/* ------------------------------------------------------------------------------------------------
 * The batch sheet
 * ---------------------------------------------------------------------------------------------- */

function BatchSheetEditor({
    recipeId,
    onBack,
}: {
    readonly recipeId: RecipeId;
    readonly onBack: () => void;
}) {
    const { t } = useTranslation();
    const { locale } = useLocale();
    const formatter = useFormatter();
    const router = useRouter();

    // Nothing on a batch sheet is ever written, so the guard never goes dirty.
    const guard = useUnsavedGuard({ message: t('kitchen:unsaved.browserPrompt'), enabled: false });
    const record = useRecipeQuery(recipeId);
    const concurrency = useOptimisticConcurrency({
        onReload: () => {
            void record.refetch();
        },
    });

    const [modeChoice, setModeChoice] = useState<BatchMode>('yield');
    const [target, setTarget] = useState('');

    const version = record.data?.currentVersion ?? null;
    const ingredients = useBatchIngredients(version);
    const availability = useShelfAvailability();

    /**
     * The mode in force, derived rather than stored: a recipe that does not count in pieces can
     * only be planned by yield, and resetting the choice in an effect would lose it.
     */
    const mode: BatchMode = version === null || version.yieldPieces === null ? 'yield' : modeChoice;
    const factor = version === null ? null : batchFactor(version, mode, parseQuantity(target));

    const quantity = (value: number | null): string | null =>
        value === null ? null : formatter.formatNumber(value, BATCH_QUANTITY_FORMAT);

    const recordFailure = toFailure(record.error);

    if (recordFailure !== null) {
        return (
            <ErrorState
                testID="kitchen-batch-planner-error"
                failure={recordFailure}
                title={t('kitchen:ops.batch.loadErrorTitle')}
                onRetry={() => {
                    void record.refetch();
                }}
                retrying={record.isFetching}
            />
        );
    }
    if (record.data === undefined) {
        return (
            <Stack space="sm" testID="kitchen-batch-planner-loading">
                {Array.from({ length: 4 }, (_, index) => (
                    <Skeleton key={index} heightClassName="h-10" />
                ))}
            </Stack>
        );
    }

    // Kilograms until a recipe says otherwise, so "By " never loses its unit.
    const yieldUnitLabel = t(unitShortKey(version?.yieldUnit ?? 'kg'));

    return (
        <EditorFrame
            testID="kitchen-batch-sheet"
            title={displayName(record.data.name, locale).value}
            titleChip={{ label: t('kitchen:ops.batch.readOnlyChip'), tone: 'neutral' }}
            meta={record.data.meta}
            guard={guard}
            concurrency={concurrency}
            saveLabel={t('kitchen:ops.batch.openProduction')}
            onSaveDraft={() => {
                router.push('/kitchen/production' as never);
            }}
            backLabel={t('kitchen:ops.batch.backToList')}
            onBack={onBack}
        >
            <FormSection
                first
                testID="kitchen-batch-controls"
                title={t('kitchen:ops.batch.sheetHeading')}
                description={t('kitchen:ops.batch.footNote')}
            >
                <Stack space="sm">
                    <Inline space="sm" align="end" wrap>
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
                                mode === 'pieces'
                                    ? t('kitchen:ops.batch.piecesUnit')
                                    : yieldUnitLabel
                            }
                            className="w-40"
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
                                          BATCH_QUANTITY_FORMAT,
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
                            // Informational: the sheets state process loss on the output.
                            label={t('kitchen:ops.batch.metrics.waste')}
                            value={
                                version === null
                                    ? null
                                    : `${formatter.formatNumber(version.wastePercent)}%`
                            }
                        />
                    </View>
                </Stack>
            </FormSection>

            {version === null || factor === null ? (
                <Callout
                    testID="kitchen-batch-planner-target-needed"
                    tone="info"
                    title={t('kitchen:ops.batch.targetNeededTitle')}
                    body={t('kitchen:ops.batch.targetNeededBody')}
                />
            ) : (
                <BatchSheet
                    version={version}
                    factor={factor}
                    ingredients={ingredients}
                    availability={availability}
                />
            )}
        </EditorFrame>
    );
}
