import type { ProductionOrder, ProductionOrderStatus } from '@healthy360/api-client/contracts';
import {
    Badge,
    Button,
    Callout,
    EmptyState,
    ErrorState,
    FormSection,
    Icon,
    QuantityInput,
    RecordWindow,
    Select,
    Skeleton,
    Stack,
    Text,
    useToast,
} from '@healthy360/design-system';
import type { MenuItem, SelectOption } from '@healthy360/design-system';
import { RecipeId } from '@healthy360/domain-types';
import type { BranchId } from '@healthy360/domain-types';
import { useLocale } from '@healthy360/i18n';
import type { TFunction } from 'i18next';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { Gate, useCan } from '../../../access/gate.tsx';
import { toFailure } from '../../../data/hooks.ts';
import {
    recipesFromPages,
    useRecipeQuery,
    useRecipesQuery,
} from '../../../data/kitchen-admin-hooks.ts';
import {
    useCompleteProductionOrderMutation,
    useCreateProductionOrderMutation,
    useProductionOrdersQuery,
} from '../../../data/kitchen-ops-hooks.ts';
import { useAccessState } from '../../../session/session-provider.tsx';
import { batchFactor } from '../batch-scaling.ts';
import { CATALOGUE_ROW_ICONS } from '../catalogue/catalogue-list-item.tsx';
import { CatalogueList } from '../catalogue/catalogue-list.tsx';
import type { CatalogueColumn } from '../catalogue/catalogue-column-spec.ts';
import { CataloguePager } from '../catalogue/catalogue-pager.tsx';
import { CatalogueStatCards } from '../catalogue/catalogue-stat-cards.tsx';
import type { CatalogueStatCard } from '../catalogue/catalogue-stat-cards.tsx';
import { CatalogueToolbar } from '../catalogue/catalogue-toolbar.tsx';
import type { CatalogueStatusSegment } from '../catalogue/catalogue-toolbar.tsx';
import { compareText, useColumnControls } from '../catalogue/use-column-controls.tsx';
import type { ControlledColumn } from '../catalogue/use-column-controls.tsx';
import { EditorFrame } from '../editor-frame.tsx';
import {
    INVENTORY_MANAGE_PERMISSION,
    INVENTORY_VIEW_PERMISSION,
    RECIPE_VIEW_PERMISSION,
} from '../entity-registry.ts';
import { displayName, parseQuantity, statusKey, unitShortKey } from '../format.ts';
import {
    BatchSheet,
    useBatchIngredients,
    useShelfAvailability,
} from '../operations/batch-sheet.tsx';
import {
    isProductionOrderOpen,
    productionOrderRowTestId,
    productionStatusKey,
    productionStatusTone,
} from '../ops-format.ts';
import { useOptimisticConcurrency } from '../use-optimistic-concurrency.ts';
import { useUnsavedGuard } from '../use-unsaved-guard.ts';

/**
 * `/kitchen/production` — batch orders from recipe versions (Operations handoff, `production` +
 * `edProduction`). O5: no task UI.
 *
 * ```
 * ┌ PLANNED ┐ ┌ IN PROGRESS ┐ ┌ COMPLETED ┐
 * [ ⌕ order or recipe version ]  [ All | Planned | In progress | Completed ]  [ + New batch ]
 * ORDER        RECIPE VERSION     BRANCH        STATUS   ◉ ✓
 * ```
 *
 * "New batch" opens the batch editor: a published recipe's current version, an optional planned
 * quantity, and the sheet of what it will consume against this branch's shelves. Complete still
 * flips a planned / in-progress order to completed with empty consume and yield lists.
 *
 * ## What the design shows that the contract does not
 *
 * `ProductionOrder` is an id, a version id, a branch and a status. The design's order number,
 * recipe name, planned date and quantity have no field behind them, so the list states ids, and the
 * editor has no "Planned for" date — `CreateProductionOrderRequest` has nowhere to put one.
 */
export function ProductionScreen() {
    return (
        <Gate
            area="kitchen"
            requirement={{ allOf: [INVENTORY_VIEW_PERMISSION] }}
            testID="kitchen-production"
        >
            <Production />
        </Gate>
    );
}

const PAGE_SIZE = 25;
const SEGMENT_STATUSES: readonly ProductionOrderStatus[] = ['planned', 'in_progress', 'completed'];
type StatusSegmentValue = ProductionOrderStatus | 'all';

function shortId(id: string): string {
    return `${id.slice(0, 8)}…`;
}

function Production() {
    const [creating, setCreating] = useState(false);
    return creating ? (
        <ProductionCreate
            onDone={() => {
                setCreating(false);
            }}
        />
    ) : (
        <ProductionList
            onCreate={() => {
                setCreating(true);
            }}
        />
    );
}

function ProductionList({ onCreate }: { readonly onCreate: () => void }) {
    const { t } = useTranslation();
    const toast = useToast();
    const access = useAccessState();
    const canManage = useCan(INVENTORY_MANAGE_PERMISSION);
    const activeBranch = access.branch?.id ?? null;

    const orders = useProductionOrdersQuery();
    const completeOrder = useCompleteProductionOrderMutation();

    const [query, setQuery] = useState('');
    const [status, setStatus] = useState<StatusSegmentValue>('all');
    const [viewing, setViewing] = useState<ProductionOrder | null>(null);

    const trimmed = query.trim().toLowerCase();
    const filtered = useMemo(
        () =>
            (orders.data ?? []).filter((row) => {
                if (status !== 'all' && row.status !== status) return false;
                if (trimmed === '') return true;
                return `${String(row.id)} ${String(row.recipeVersionId)}`
                    .toLowerCase()
                    .includes(trimmed);
            }),
        [orders.data, status, trimmed],
    );

    const [page, setPage] = useState(1);
    const [pageKey, setPageKey] = useState(`${trimmed}|${status}`);
    if (pageKey !== `${trimmed}|${status}`) {
        setPageKey(`${trimmed}|${status}`);
        setPage(1);
    }

    const branchText = (branchId: BranchId): string =>
        activeBranch !== null && String(branchId) === String(activeBranch)
            ? t('kitchen:ops.production.thisBranch')
            : shortId(String(branchId));

    function submitComplete(order: ProductionOrder) {
        completeOrder.mutate(
            {
                productionOrderId: order.id,
                request: { consumes: [], yields: [] },
            },
            {
                onSuccess: () => {
                    setViewing(null);
                    toast.show({
                        testID: 'kitchen-production-completed-toast',
                        tone: 'success',
                        message: t('kitchen:ops.production.completedToast'),
                    });
                },
            },
        );
    }

    const columns: readonly ControlledColumn<ProductionOrder, CatalogueColumn<ProductionOrder>>[] =
        [
            {
                key: 'id',
                role: 'title',
                label: t('kitchen:ops.production.columnId'),
                width: 180,
                priority: 100,
                value: (row) => String(row.id),
                sort: (left, right, direction) =>
                    compareText(String(left.id), String(right.id), direction),
                render: (row) => (
                    <Text
                        variant="mono"
                        numberOfLines={1}
                        testID={`${productionOrderRowTestId(String(row.id))}-id`}
                    >
                        {shortId(String(row.id))}
                    </Text>
                ),
            },
            {
                key: 'version',
                role: 'meta',
                label: t('kitchen:ops.production.columnVersion'),
                width: 200,
                priority: 70,
                value: (row) => String(row.recipeVersionId),
                render: (row) => (
                    <Text variant="mono" tone="secondary" numberOfLines={1}>
                        {shortId(String(row.recipeVersionId))}
                    </Text>
                ),
            },
            {
                key: 'branch',
                label: t('kitchen:ops.production.columnBranch'),
                width: 130,
                priority: 40,
                value: (row) => branchText(row.branchId),
                render: (row) => (
                    <Text tone="secondary" numberOfLines={1}>
                        {branchText(row.branchId)}
                    </Text>
                ),
            },
            {
                key: 'status',
                role: 'status',
                label: t('kitchen:ops.production.columnStatus'),
                width: 110,
                priority: 80,
                value: (row) => t(productionStatusKey(row.status)),
                render: (row) => (
                    <Badge
                        testID={`${productionOrderRowTestId(String(row.id))}-status`}
                        tone={productionStatusTone(row.status)}
                        label={t(productionStatusKey(row.status))}
                    />
                ),
            },
        ];

    const controls = useColumnControls(filtered, columns, 'kitchen-production');
    const totalPages = Math.max(1, Math.ceil(controls.rows.length / PAGE_SIZE));
    // A header filter can narrow the rows under the page in hand; land on the last page there is.
    const currentPage = Math.min(page, totalPages);
    const pageRows = controls.rows.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);
    const failure = toFailure(orders.error);
    const unfiltered = trimmed === '' && status === 'all';

    const statusSegments: readonly CatalogueStatusSegment<StatusSegmentValue>[] = [
        { value: 'all', label: t('kitchen:toolbar.statusAll') },
        ...SEGMENT_STATUSES.map((value) => ({ value, label: t(productionStatusKey(value)) })),
    ];

    const canComplete = (row: ProductionOrder) => canManage && isProductionOrderOpen(row.status);

    return (
        <Stack space="md" testID="kitchen-production-screen">
            {orders.isPending || failure !== null ? null : (
                <CatalogueStatCards
                    testID="kitchen-production-stats"
                    cards={productionCards(controls.rows, t)}
                />
            )}

            <CatalogueToolbar<StatusSegmentValue>
                testID="kitchen-production-toolbar"
                search={query}
                onSearchChange={(next) => {
                    setQuery(next);
                    setViewing(null);
                }}
                searchLabel={t('kitchen:toolbar.searchLabel')}
                searchPlaceholder={t('kitchen:ops.production.searchPlaceholder')}
                statusLabel={t('kitchen:toolbar.statusLabel')}
                statusSegments={statusSegments}
                status={status}
                onStatusChange={(next) => {
                    setStatus(next);
                    setViewing(null);
                }}
            >
                {canManage ? (
                    <Button
                        testID="kitchen-production-create"
                        label={t('kitchen:ops.production.create')}
                        iconStart={<Icon name="plus" size="sm" />}
                        onPress={onCreate}
                    />
                ) : null}
            </CatalogueToolbar>

            {orders.isPending ? (
                <Stack space="xs" testID="kitchen-production-loading">
                    {Array.from({ length: 5 }, (_, index) => (
                        <Skeleton key={index} heightClassName="h-row-sm" />
                    ))}
                </Stack>
            ) : failure !== null ? (
                <ErrorState
                    testID="kitchen-production-error"
                    title={t('kitchen:ops.production.loadErrorTitle')}
                    failure={failure}
                    onRetry={() => {
                        void orders.refetch();
                    }}
                    retrying={orders.isFetching}
                />
            ) : controls.rows.length === 0 ? (
                <EmptyState
                    testID="kitchen-production-empty"
                    title={
                        unfiltered
                            ? t('kitchen:ops.production.emptyTitle')
                            : t('kitchen:ops.production.filteredEmptyTitle')
                    }
                    body={
                        unfiltered
                            ? t('kitchen:ops.production.emptyBody')
                            : t('kitchen:ops.production.filteredEmptyBody')
                    }
                />
            ) : (
                <Stack space="sm">
                    <CatalogueList<ProductionOrder>
                        testID="kitchen-production-orders"
                        label={t('kitchen:ops.production.ordersHeading')}
                        columns={controls.columns}
                        rows={pageRows}
                        rowKey={(row) => String(row.id)}
                        density="sm"
                        onRowPress={setViewing}
                        rowActionsLabel={t('kitchen:list.rowActions')}
                        rowActions={(row): readonly MenuItem[] => [
                            {
                                key: 'view',
                                label: t('kitchen:list.view'),
                                icon: CATALOGUE_ROW_ICONS.view,
                                testID: `${productionOrderRowTestId(String(row.id))}-view`,
                                onSelect: () => {
                                    setViewing(row);
                                },
                            },
                            ...(canComplete(row)
                                ? [
                                      {
                                          key: 'complete',
                                          label: t('kitchen:ops.production.complete'),
                                          icon: 'check' as const,
                                          testID: `${productionOrderRowTestId(String(row.id))}-complete`,
                                          onSelect: () => {
                                              submitComplete(row);
                                          },
                                      },
                                  ]
                                : []),
                        ]}
                    />

                    <CataloguePager
                        testID="kitchen-production-pagination"
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
                    testID="kitchen-production-view"
                    open
                    onClose={() => {
                        setViewing(null);
                    }}
                    title={shortId(String(viewing.id))}
                    kind={t('kitchen:ops.production.viewKind')}
                    status={{
                        label: t(productionStatusKey(viewing.status)),
                        tone: productionStatusTone(viewing.status),
                    }}
                    {...(isProductionOrderOpen(viewing.status)
                        ? { note: t('kitchen:ops.production.openNote') }
                        : {})}
                    footNote={t('kitchen:ops.production.footNote')}
                    fields={[
                        {
                            key: 'id',
                            label: t('kitchen:ops.production.columnId'),
                            value: String(viewing.id),
                            mono: true,
                        },
                        {
                            key: 'version',
                            label: t('kitchen:ops.production.columnVersion'),
                            value: String(viewing.recipeVersionId),
                            mono: true,
                        },
                        {
                            key: 'branch',
                            label: t('kitchen:ops.production.columnBranch'),
                            value: branchText(viewing.branchId),
                        },
                    ]}
                    {...(canComplete(viewing)
                        ? {
                              primaryAction: {
                                  label: t('kitchen:ops.production.complete'),
                                  testID: 'kitchen-production-view-complete',
                                  onPress: () => {
                                      submitComplete(viewing);
                                  },
                              },
                          }
                        : {})}
                />
            )}
        </Stack>
    );
}

/** Counted over the rows in hand, like the design's CARDS. */
function productionCards(
    rows: readonly ProductionOrder[],
    t: TFunction,
): readonly CatalogueStatCard[] {
    const count = (status: ProductionOrderStatus) =>
        rows.filter((row) => row.status === status).length;
    const inProgress = count('in_progress');
    return [
        {
            key: 'planned',
            label: t(productionStatusKey('planned')),
            value: String(count('planned')),
            unit: t('kitchen:ops.production.statUnit'),
            caption: t('kitchen:ops.production.statPlannedCaption'),
            mark: 'calendar',
        },
        {
            key: 'inProgress',
            label: t(productionStatusKey('in_progress')),
            value: String(inProgress),
            unit: t('kitchen:ops.production.statUnit'),
            caption: t('kitchen:ops.production.statInProgressCaption'),
            mark: 'clock',
            tone: inProgress === 0 ? 'default' : 'warning',
        },
        {
            key: 'completed',
            label: t(productionStatusKey('completed')),
            value: String(count('completed')),
            unit: t('kitchen:ops.production.statUnit'),
            caption: t('kitchen:ops.production.statCompletedCaption'),
            mark: 'check',
        },
    ];
}

/* ------------------------------------------------------------------------------------------------
 * New batch — the edProduction editor
 * ---------------------------------------------------------------------------------------------- */

function ProductionCreate({ onDone }: { readonly onDone: () => void }) {
    const { t } = useTranslation();
    const { locale } = useLocale();
    const toast = useToast();
    const access = useAccessState();
    const canReadRecipes = useCan(RECIPE_VIEW_PERMISSION);
    const branchId = access.branch?.id ?? null;

    const guard = useUnsavedGuard({ message: t('kitchen:unsaved.browserPrompt') });
    const concurrency = useOptimisticConcurrency({ onReload: onDone });
    const createOrder = useCreateProductionOrderMutation();

    const [recipeId, setRecipeId] = useState<RecipeId | null>(null);
    const [planned, setPlanned] = useState('');

    // Only published recipes can be produced: a draft has no settled figures.
    const recipes = useRecipesQuery({ limit: 100, statuses: ['published'] }, canReadRecipes);
    const recipeOptions: readonly SelectOption[] = recipesFromPages(recipes.data?.pages).map(
        (row) => ({
            value: String(row.id),
            label: displayName(row.name, locale).value,
            description: [
                row.reference,
                t('kitchen:ops.batch.versionCell', { number: row.currentVersionNumber }),
            ]
                .filter((part): part is string => part !== null)
                .join(' · '),
        }),
    );

    const record = useRecipeQuery(recipeId);
    const version = record.data?.currentVersion ?? null;
    const versionPublished = version !== null && version.status === 'published';
    const ingredients = useBatchIngredients(version);
    const availability = useShelfAvailability();

    const plannedYield = parseQuantity(planned);
    // No quantity is one batch as the version states it.
    const factor =
        version === null
            ? null
            : plannedYield === null
              ? 1
              : batchFactor(version, 'yield', plannedYield);

    const saveFailure = toFailure(createOrder.error);

    function submit() {
        if (branchId === null || version === null || !versionPublished) return;
        createOrder.mutate(
            {
                branchId,
                recipeVersionId: version.id,
                ...(plannedYield === null ? {} : { plannedYield }),
            },
            {
                onSuccess: () => {
                    guard.markClean();
                    toast.show({
                        testID: 'kitchen-production-created-toast',
                        tone: 'success',
                        message: t('kitchen:ops.production.createdToast'),
                    });
                    onDone();
                },
            },
        );
    }

    return (
        <EditorFrame
            testID="kitchen-production-create-editor"
            title={t('kitchen:ops.production.createTitle')}
            titleChip={{ label: t('kitchen:ops.production.createChip'), tone: 'warning' }}
            meta={null}
            guard={guard}
            concurrency={concurrency}
            saveLabel={t('kitchen:ops.production.createSubmit')}
            saving={createOrder.isPending}
            saveDisabled={branchId === null || !versionPublished || factor === null}
            onSaveDraft={submit}
            backLabel={t('kitchen:ops.production.backToList')}
            onBack={onDone}
            banner={
                saveFailure === null ? undefined : (
                    <Callout
                        testID="kitchen-production-create-error"
                        role="alert"
                        tone="danger"
                        title={t('kitchen:ops.production.createFailed')}
                        body={saveFailure.message}
                    />
                )
            }
        >
            <FormSection
                first
                testID="kitchen-production-create-batch"
                title={t('kitchen:ops.production.createTitle')}
                aside={
                    <Text variant="caption" tone="secondary">
                        {t('kitchen:ops.production.branchScoped')}
                    </Text>
                }
            >
                {branchId === null ? (
                    <EmptyState
                        testID="kitchen-production-no-branch"
                        title={t('kitchen:ops.production.noBranchTitle')}
                        body={t('kitchen:ops.production.noBranchBody')}
                    />
                ) : !canReadRecipes ? (
                    <Callout
                        testID="kitchen-production-no-recipes"
                        tone="warning"
                        title={t('kitchen:ops.production.noRecipeAccessTitle')}
                        body={t('kitchen:ops.production.noRecipeAccessBody')}
                    />
                ) : (
                    <Stack space="sm">
                        <Select
                            testID="kitchen-production-recipe"
                            label={t('kitchen:ops.production.recipeLabel')}
                            placeholder={t('kitchen:ops.production.recipePlaceholder')}
                            hint={t('kitchen:ops.production.recipeHint')}
                            searchable
                            className="min-w-[260px]"
                            options={recipeOptions}
                            value={recipeId === null ? null : String(recipeId)}
                            onChange={(value) => {
                                setRecipeId(RecipeId.safeParse(value));
                                guard.markDirty();
                            }}
                        />
                        <QuantityInput
                            testID="kitchen-production-planned"
                            size="sm"
                            label={t('kitchen:ops.production.plannedLabel')}
                            value={planned}
                            onChangeText={(next) => {
                                setPlanned(next);
                                guard.markDirty();
                            }}
                            unit={t(unitShortKey(version?.yieldUnit ?? 'kg'))}
                            className="w-40"
                        />
                        {version !== null && !versionPublished ? (
                            <Callout
                                testID="kitchen-production-version-unpublished"
                                tone="warning"
                                title={t('kitchen:ops.production.unpublishedTitle', {
                                    status: t(statusKey(version.status)),
                                })}
                                body={t('kitchen:ops.production.recipeHint')}
                            />
                        ) : null}
                    </Stack>
                )}
            </FormSection>

            {recipeId === null || branchId === null ? null : record.isPending ? (
                <Skeleton testID="kitchen-production-sheet-loading" heightClassName="h-40" />
            ) : version === null || factor === null ? null : (
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
