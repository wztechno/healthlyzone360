import type { PublishableStatus, RecipeAdminSummary } from '@healthy360/api-client/contracts';
import {
    Badge,
    Button,
    Card,
    Dialog,
    EmptyState,
    ErrorState,
    Heading,
    Inline,
    Pagination,
    Skeleton,
    Stack,
    Table,
    Text,
    useToast,
} from '@healthy360/design-system';
import type { TableColumn, TableSortDirection } from '@healthy360/design-system';
import type { KitchenId, RecipeId } from '@healthy360/domain-types';
import { useFormatter, useLocale } from '@healthy360/i18n';
import { useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { Gate, useCan } from '../../../access/gate.tsx';
import { toFailure } from '../../../data/hooks.ts';
import {
    pagesInResult,
    useOpenRecipeDraftMutation,
    useRecipeKitchensQuery,
    useRecipePageQuery,
    useRecipeQuery,
    useRetireRecipeMutation,
} from '../../../data/kitchen-admin-hooks.ts';
import { CATALOGUE_MANAGE_PERMISSION, CATALOGUE_VIEW_PERMISSION } from '../entity-registry.ts';
import {
    RECIPE_STATUS_FILTERS,
    displayName,
    recipeRowTestId,
    statusKey,
    statusTone,
} from '../format.ts';
import { ListToolbar } from '../list-toolbar.tsx';
import { useListPage } from '../use-list-page.ts';

/**
 * `/kitchen/recipes` — the recipe list.
 *
 * ## Why a row costs a second request, and why that is the honest answer
 *
 * `listRecipes` answers with {@link RecipeAdminSummary}: a name, a slug, a kitchen, the current
 * version *number*, a version count and the publication meta. It carries no allergen label and no
 * current-version status — and both are exactly what somebody scanning this list is looking for.
 * "Which recipes still have a draft open?" and "which of these declare sesame?" are the two
 * questions a kitchen brings to a recipe index, and a column that rendered a dash for both would
 * make the list decorative.
 *
 * So the two columns that need the version read it, per row, through {@link useRecipeQuery}. That is
 * an N+1 and it is written down rather than hidden: a real `GET /kitchen/recipes` returns the
 * derived label and the version state on the summary, and when it does these two cells become plain
 * fields. Until then the cost buys something back — the detail entry each cell fills is the same one
 * the editor opens, so following a row costs no further request.
 *
 * ## The list narrows by kitchen, not by category
 *
 * A recipe has no category on this contract. `RecipeAdminFilter` publishes `kitchenId`, so that is
 * the second axis, derived from the rows in use (`data/kitchen-admin-hooks.ts`). Inventing a
 * taxonomy the server has never published would put a filter on screen that no endpoint could ever
 * honour.
 *
 * ## Sorting is client-side, and stated
 *
 * Same limitation as the ingredient list: no sort parameter on the filter, so the table sorts what
 * has been loaded. Honest for a book of twenty, wrong for one of two thousand.
 */

type SortKey = 'name' | 'status' | 'updatedAt';

export function RecipesScreen() {
    return (
        <Gate
            area="kitchen"
            requirement={{ allOf: [CATALOGUE_VIEW_PERMISSION] }}
            testID="kitchen-recipes"
        >
            <RecipesList />
        </Gate>
    );
}

/**
 * The current version's number and state, read from the recipe's own record.
 *
 * Renders the number the *summary* already knows while the detail is in flight, so the cell is never
 * blank and never jumps: the version number is a fact the list has, and only its status is not.
 */
function VersionCell({ row }: { readonly row: RecipeAdminSummary }) {
    const { t } = useTranslation();
    const recipe = useRecipeQuery(row.id);
    const testID = recipeRowTestId(String(row.id));
    const status = recipe.data?.currentVersion.status ?? null;

    return (
        <Stack space="none">
            <Text variant="bodyStrong" testID={`${testID}-version`}>
                {t('kitchen:recipes.versionNumber', { number: row.currentVersionNumber })}
            </Text>

            {status === null ? (
                <Skeleton
                    testID={`${testID}-version-loading`}
                    heightClassName="h-4"
                    widthClassName="w-16"
                />
            ) : (
                <Badge
                    testID={`${testID}-version-status`}
                    tone={statusTone(status)}
                    label={t(statusKey(status))}
                />
            )}

            {/*
             * The quarantine badge reads the *recipe*, not the version: `setIngredientAllergens`
             * moves the recipe to `review_required` when a published label it derived is
             * contradicted, and that is the row a person has to go and resolve.
             */}
            {row.meta.status === 'review_required' ? (
                <Badge
                    testID={`${testID}-quarantine`}
                    tone="warning"
                    icon="warning"
                    label={t('kitchen:recipes.quarantined')}
                />
            ) : null}

            <Text variant="caption" tone="secondary">
                {t('kitchen:recipes.versionCount', { count: row.versionCount })}
            </Text>
        </Stack>
    );
}

/** The derived allergen label, from the current version. Never invented, never silently empty. */
function AllergenCell({ row }: { readonly row: RecipeAdminSummary }) {
    const { t } = useTranslation();
    const recipe = useRecipeQuery(row.id);
    const testID = recipeRowTestId(String(row.id));

    if (recipe.data === undefined) {
        return (
            <Skeleton
                testID={`${testID}-allergens-loading`}
                heightClassName="h-5"
                widthClassName="w-24"
            />
        );
    }

    const declarations = recipe.data.currentVersion.allergens;
    if (declarations.length === 0) {
        return (
            <Text testID={`${testID}-allergens-none`} tone="secondary">
                {t('kitchen:recipes.noAllergens')}
            </Text>
        );
    }

    return (
        <Inline space="xs" wrap testID={`${testID}-allergens`}>
            {declarations.map((declaration) => (
                <Badge
                    key={declaration.allergenCode}
                    tone={declaration.containment === 'contains' ? 'danger' : 'warning'}
                    label={declaration.allergenCode}
                />
            ))}
        </Inline>
    );
}

interface RowActionsProps {
    readonly row: RecipeAdminSummary;
    readonly canManage: boolean;
    readonly onOpen: () => void;
    readonly onNewDraft: () => void;
    readonly onArchive: () => void;
    readonly openingDraft: boolean;
}

/**
 * Open, new draft, archive.
 *
 * "New draft" appears only when the current version is one that cannot be edited — a published or
 * retired version is immutable, so the *only* way to change it is to open its successor. Offering
 * the control against a draft that is already open would write a version bump that changed nothing.
 */
function RowActions({
    row,
    canManage,
    onOpen,
    onNewDraft,
    onArchive,
    openingDraft,
}: RowActionsProps) {
    const { t } = useTranslation();
    const recipe = useRecipeQuery(row.id);
    const testID = recipeRowTestId(String(row.id));
    const versionStatus = recipe.data?.currentVersion.status ?? null;
    const isImmutable = versionStatus === 'published' || versionStatus === 'retired';

    return (
        <Inline space="xs" wrap justify="end">
            <Button
                testID={`${testID}-open`}
                size="sm"
                variant="secondary"
                label={t('kitchen:recipes.open')}
                onPress={onOpen}
            />
            {canManage && isImmutable && row.meta.status !== 'retired' ? (
                <Button
                    testID={`${testID}-new-draft`}
                    size="sm"
                    variant="ghost"
                    label={t('kitchen:recipes.newDraft')}
                    loading={openingDraft}
                    onPress={onNewDraft}
                />
            ) : null}
            {canManage && row.meta.status !== 'retired' ? (
                <Button
                    testID={`${testID}-archive`}
                    size="sm"
                    variant="ghost"
                    label={t('kitchen:recipes.archive')}
                    onPress={onArchive}
                />
            ) : null}
        </Inline>
    );
}

function RecipesList() {
    const { t } = useTranslation();
    const router = useRouter();
    const formatter = useFormatter();
    const { locale } = useLocale();
    const toast = useToast();
    const canManage = useCan(CATALOGUE_MANAGE_PERMISSION);

    const [query, setQuery] = useState('');
    const [statuses, setStatuses] = useState<readonly PublishableStatus[]>([]);
    const [kitchen, setKitchen] = useState<string | null>(null);
    const [sortKey, setSortKey] = useState<SortKey>('name');
    const [sortDirection, setSortDirection] = useState<TableSortDirection>('asc');
    const [archiving, setArchiving] = useState<RecipeAdminSummary | null>(null);
    const [openingDraftFor, setOpeningDraftFor] = useState<RecipeId | null>(null);

    const trimmed = query.trim();
    const filter = useMemo(
        () => ({
            ...(trimmed === '' ? {} : { query: trimmed }),
            ...(statuses.length === 0 ? {} : { statuses }),
            ...(kitchen === null ? {} : { kitchenId: kitchen as KitchenId }),
        }),
        [trimmed, statuses, kitchen],
    );

    const [page, setPage] = useListPage(filter);
    const recipes = useRecipePageQuery(filter, page);
    const kitchens = useRecipeKitchensQuery();
    const retire = useRetireRecipeMutation();
    const openDraft = useOpenRecipeDraftMutation();

    // Left possibly-undefined rather than defaulted to `[]`: `?? []` is a fresh array on
    // every render, which would re-run anything memoised over it whether or not it changed.
    const rows = recipes.data?.items;
    const total = recipes.data?.totalCount ?? null;
    const totalPages = pagesInResult(recipes.data) ?? 0;

    const sorted = useMemo(() => {
        const factor = sortDirection === 'asc' ? 1 : -1;
        return [...(rows ?? [])].sort((left, right) => {
            if (sortKey === 'status') {
                return factor * left.meta.status.localeCompare(right.meta.status);
            }
            if (sortKey === 'updatedAt') {
                return factor * left.meta.updatedAt.localeCompare(right.meta.updatedAt);
            }
            return (
                factor *
                displayName(left.name, locale).value.localeCompare(
                    displayName(right.name, locale).value,
                    locale,
                )
            );
        });
    }, [rows, sortKey, sortDirection, locale]);

    const openEditor = (recipeId: string) => {
        router.push(`/kitchen/recipes/${recipeId}` as never);
    };

    const startDraft = (row: RecipeAdminSummary) => {
        setOpeningDraftFor(row.id);
        openDraft.mutate(
            { recipeId: row.id, request: { lockVersion: row.meta.lockVersion } },
            {
                onSuccess: (updated) => {
                    setOpeningDraftFor(null);
                    toast.show({
                        testID: 'kitchen-recipes-draft-opened-toast',
                        tone: 'success',
                        message: t('kitchen:recipes.draftOpenedToast', {
                            number: updated.currentVersion.versionNumber,
                        }),
                    });
                    openEditor(String(row.id));
                },
                onSettled: () => {
                    setOpeningDraftFor(null);
                },
            },
        );
    };

    const columns: readonly TableColumn<RecipeAdminSummary>[] = [
        {
            key: 'name',
            header: t('kitchen:recipes.columnName'),
            rowHeader: true,
            sortable: true,
            flex: 2,
            render: (row) => {
                const name = displayName(row.name, locale);
                return (
                    <Stack space="none">
                        <Text
                            variant="bodyStrong"
                            testID={`${recipeRowTestId(String(row.id))}-name`}
                        >
                            {name.value}
                        </Text>
                        {name.isFallback ? (
                            <Badge
                                testID={`${recipeRowTestId(String(row.id))}-missing-arabic`}
                                tone="warning"
                                icon="warning"
                                label={t('kitchen:list.missingArabic')}
                            />
                        ) : null}
                        <Text variant="caption" tone="secondary">
                            {row.slug}
                        </Text>
                    </Stack>
                );
            },
        },
        {
            key: 'version',
            header: t('kitchen:recipes.columnVersion'),
            sortable: true,
            render: (row) => <VersionCell row={row} />,
        },
        {
            key: 'allergens',
            header: t('kitchen:recipes.columnAllergens'),
            flex: 2,
            render: (row) => <AllergenCell row={row} />,
        },
        {
            key: 'status',
            header: t('kitchen:list.columnStatus'),
            render: (row) => (
                <Badge
                    testID={`${recipeRowTestId(String(row.id))}-status`}
                    tone={statusTone(row.meta.status)}
                    label={t(statusKey(row.meta.status))}
                />
            ),
        },
        {
            key: 'updatedAt',
            header: t('kitchen:list.columnUpdated'),
            sortable: true,
            render: (row) => (
                <Stack space="none">
                    <Text testID={`${recipeRowTestId(String(row.id))}-updated`} variant="caption">
                        {formatter.formatRelativeTime(row.meta.updatedAt)}
                    </Text>
                    <Text variant="caption" tone="secondary">
                        {row.meta.updatedByName === null
                            ? t('kitchen:list.updatedBySeed')
                            : t('kitchen:list.updatedBy', { name: row.meta.updatedByName })}
                    </Text>
                </Stack>
            ),
        },
    ];

    const failure = toFailure(recipes.error);
    const unfiltered = trimmed === '' && statuses.length === 0 && kitchen === null;

    return (
        <Stack space="lg" testID="kitchen-recipes-screen">
            <Stack space="xs">
                <Heading level={1} testID="kitchen-recipes-title">
                    {t('kitchen:recipes.title')}
                </Heading>
                <Text tone="secondary" testID="kitchen-recipes-subtitle">
                    {t('kitchen:recipes.subtitle')}
                </Text>
            </Stack>

            <ListToolbar
                testID="kitchen-recipes-toolbar"
                query={query}
                onQueryChange={setQuery}
                statuses={statuses}
                onStatusesChange={setStatuses}
                statusOptions={RECIPE_STATUS_FILTERS}
                categoryLabel={t('kitchen:recipes.kitchenFilterLabel')}
                categoryAllLabel={t('kitchen:recipes.kitchenFilterAll')}
                categoryOptions={(kitchens.data ?? []).map((entry) => ({
                    value: String(entry.kitchenId),
                    label: String(entry.kitchenId),
                    description: t('kitchen:recipes.recipeCount', { count: entry.count }),
                }))}
                category={kitchen}
                onCategoryChange={setKitchen}
                createLabel={t('kitchen:recipes.create')}
                {...(canManage
                    ? {
                          onCreate: () => {
                              router.push('/kitchen/recipes/new' as never);
                          },
                      }
                    : {})}
                {...(recipes.isPending || total === null
                    ? {}
                    : { resultSummary: t('kitchen:recipes.resultCount', { count: total }) })}
            />

            {recipes.isPending ? (
                <Stack space="sm" testID="kitchen-recipes-loading">
                    {Array.from({ length: 5 }, (_, index) => (
                        <Card key={index} padding="md">
                            <Stack space="xs">
                                <Skeleton
                                    testID={`kitchen-recipes-skeleton-${String(index + 1)}`}
                                    heightClassName="h-5"
                                />
                                <Skeleton heightClassName="h-4" widthClassName="w-1/2" />
                            </Stack>
                        </Card>
                    ))}
                </Stack>
            ) : failure !== null ? (
                <ErrorState
                    testID="kitchen-recipes-error"
                    failure={failure}
                    onRetry={() => {
                        void recipes.refetch();
                    }}
                    retrying={recipes.isFetching}
                />
            ) : sorted.length === 0 ? (
                <EmptyState
                    testID="kitchen-recipes-empty"
                    title={
                        unfiltered
                            ? t('kitchen:recipes.emptyTitle')
                            : t('kitchen:recipes.filteredEmptyTitle')
                    }
                    body={
                        unfiltered
                            ? t('kitchen:recipes.emptyBody')
                            : t('kitchen:recipes.filteredEmptyBody')
                    }
                    actions={
                        <Inline space="sm" wrap>
                            <Button
                                testID="kitchen-recipes-clear"
                                variant="secondary"
                                label={t('kitchen:toolbar.clearFilters')}
                                onPress={() => {
                                    setQuery('');
                                    setStatuses([]);
                                    setKitchen(null);
                                }}
                            />
                            {canManage ? (
                                <Button
                                    testID="kitchen-recipes-empty-create"
                                    label={t('kitchen:recipes.create')}
                                    onPress={() => {
                                        router.push('/kitchen/recipes/new' as never);
                                    }}
                                />
                            ) : null}
                        </Inline>
                    }
                />
            ) : (
                <Stack space="sm">
                    <Table<RecipeAdminSummary>
                        testID="kitchen-recipes-table"
                        caption={t('kitchen:recipes.caption')}
                        captionHidden
                        columns={columns}
                        rows={sorted}
                        rowKey={(row) => String(row.id)}
                        sortKey={sortKey}
                        sortDirection={sortDirection}
                        onSortChange={(key, direction) => {
                            setSortKey(key as SortKey);
                            setSortDirection(direction);
                        }}
                        rowAction={{
                            header: t('kitchen:list.actionHeader'),
                            render: (row) => (
                                <RowActions
                                    row={row}
                                    canManage={canManage}
                                    openingDraft={openingDraftFor === row.id}
                                    onOpen={() => {
                                        openEditor(String(row.id));
                                    }}
                                    onNewDraft={() => {
                                        startDraft(row);
                                    }}
                                    onArchive={() => {
                                        setArchiving(row);
                                    }}
                                />
                            ),
                        }}
                    />

                    <Pagination
                        testID="kitchen-recipes-pagination"
                        page={page}
                        totalPages={totalPages}
                        onPageChange={setPage}
                        disabled={recipes.isFetching}
                    />
                </Stack>
            )}

            {/*
             * Retiring *is* the archive: the contract has no `archiveRecipe`, and nothing is
             * deleted because meals, products and cost snapshots still point at the version. A
             * refusal — a recipe a published meal still depends on — arrives as the server's own
             * sentence, which this dialog already renders.
             */}
            <Dialog
                testID="kitchen-recipes-archive-dialog"
                open={archiving !== null}
                onClose={() => {
                    setArchiving(null);
                }}
                title={t('kitchen:recipes.archiveTitle')}
                description={t('kitchen:recipes.archiveBody')}
                actions={
                    <>
                        <Button
                            testID="kitchen-recipes-archive-cancel"
                            variant="quiet"
                            label={t('kitchen:common.cancel')}
                            onPress={() => {
                                setArchiving(null);
                            }}
                        />
                        <Button
                            testID="kitchen-recipes-archive-confirm"
                            variant="danger"
                            label={t('kitchen:recipes.archiveConfirm')}
                            loading={retire.isPending}
                            onPress={() => {
                                const row = archiving;
                                if (row === null) return;
                                retire.mutate(
                                    {
                                        recipeId: row.id,
                                        request: { lockVersion: row.meta.lockVersion },
                                    },
                                    {
                                        onSuccess: () => {
                                            setArchiving(null);
                                            toast.show({
                                                testID: 'kitchen-recipes-archived-toast',
                                                tone: 'success',
                                                message: t('kitchen:recipes.archivedToast', {
                                                    name: displayName(row.name, locale).value,
                                                }),
                                            });
                                        },
                                    },
                                );
                            }}
                        />
                    </>
                }
            >
                {retire.error === null ? null : (
                    <Text testID="kitchen-recipes-archive-error" tone="danger">
                        {toFailure(retire.error)?.message ?? t('kitchen:recipes.archiveFailed')}
                    </Text>
                )}
            </Dialog>
        </Stack>
    );
}
