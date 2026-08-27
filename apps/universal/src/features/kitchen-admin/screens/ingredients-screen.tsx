import type { IngredientAdmin, PublishableStatus } from '@healthy360/api-client/contracts';
import {
    Badge,
    Button,
    Card,
    Dialog,
    EmptyState,
    ErrorState,
    Inline,
    Pagination,
    Skeleton,
    Stack,
    Table,
    Text,
    useToast,
} from '@healthy360/design-system';
import type { TableColumn, TableSortDirection } from '@healthy360/design-system';
import { useFormatter, useLocale } from '@healthy360/i18n';
import { useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { Gate, useCan } from '../../../access/gate.tsx';
import { toFailure } from '../../../data/hooks.ts';
import {
    pagesInResult,
    useArchiveIngredientMutation,
    useIngredientCategoriesQuery,
    useIngredientPageQuery,
} from '../../../data/kitchen-admin-hooks.ts';
import { CATALOGUE_VIEW_PERMISSION, CATALOGUE_MANAGE_PERMISSION } from '../entity-registry.ts';
import {
    INGREDIENT_STATUS_FILTERS,
    displayName,
    humaniseCode,
    ingredientRowTestId,
    statusKey,
    statusTone,
} from '../format.ts';
import { KitchenPageHeader } from '../kitchen-page-header.tsx';
import { ListToolbar } from '../list-toolbar.tsx';
import { useListPage } from '../use-list-page.ts';

/**
 * `/kitchen/ingredients` — the ingredient list.
 *
 * ## One dataset, two presentations, and neither is a compromise
 *
 * `Table` renders an ARIA table above `md` and stacked cards below it, as a *branch* rather than a
 * responsive class — so a phone gets a readable card per row and a screen reader never meets every
 * figure twice. Everything this screen does about width is therefore choosing its columns well; the
 * component owns the rest.
 *
 * ## Sorting is client-side, and that is a stated limitation rather than a hidden one
 *
 * `IngredientAdminFilter` publishes no sort parameter, so the table sorts the rows it has. With
 * numbered pages that means *within the page* — press "Name" on page 3 and the twenty-five rows on
 * page 3 reorder, not the catalogue.
 *
 * That is narrower than it sounds. The cursor list this replaced sorted "within what you have
 * fetched", which was the same page-local answer until somebody pressed Load more forty times, and
 * a sort that is only correct after forty presses is not a sort anybody relied on. What changed is
 * that the limitation is now the same on every page instead of drifting with how far the reader
 * scrolled. A real `?sort=name` on the listing endpoint makes this a server concern and this
 * comment goes away.
 *
 * ## The name column is where the bilingual rule shows up
 *
 * An admin record carries both languages (plan §4.18). The row renders the reader's own language and
 * marks the ones that fell back, because a list that silently substituted English for a missing
 * Arabic name would hide exactly the rows somebody has to go and fix before anything can publish.
 */

type SortKey = 'name' | 'status' | 'updatedAt';

export function IngredientsScreen() {
    return (
        <Gate
            area="kitchen"
            requirement={{ allOf: [CATALOGUE_VIEW_PERMISSION] }}
            testID="kitchen-ingredients"
        >
            <IngredientsList />
        </Gate>
    );
}

function IngredientsList() {
    const { t } = useTranslation();
    const router = useRouter();
    const formatter = useFormatter();
    const { locale } = useLocale();
    const toast = useToast();
    const canManage = useCan(CATALOGUE_MANAGE_PERMISSION);

    const [query, setQuery] = useState('');
    const [statuses, setStatuses] = useState<readonly PublishableStatus[]>([]);
    const [category, setCategory] = useState<string | null>(null);
    const [sortKey, setSortKey] = useState<SortKey>('name');
    const [sortDirection, setSortDirection] = useState<TableSortDirection>('asc');
    const [archiving, setArchiving] = useState<IngredientAdmin | null>(null);

    const trimmed = query.trim();
    const filter = useMemo(
        () => ({
            ...(trimmed === '' ? {} : { query: trimmed }),
            ...(statuses.length === 0 ? {} : { statuses }),
            ...(category === null ? {} : { categoryCode: category }),
        }),
        [trimmed, statuses, category],
    );

    const [page, setPage] = useListPage(filter);
    const ingredients = useIngredientPageQuery(filter, page);
    const categories = useIngredientCategoriesQuery();
    const archive = useArchiveIngredientMutation();

    // Left possibly-undefined rather than defaulted to `[]` here: `?? []` is a fresh array on
    // every render, which would re-run the sort below whether or not the data changed.
    const rows = ingredients.data?.items;
    const total = ingredients.data?.totalCount ?? null;
    const totalPages = pagesInResult(ingredients.data) ?? 0;

    const sorted = useMemo(() => {
        const factor = sortDirection === 'asc' ? 1 : -1;
        return [...(rows ?? [])].sort((left, right) => {
            if (sortKey === 'status')
                return factor * left.meta.status.localeCompare(right.meta.status);
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

    const openEditor = (ingredientId: string) => {
        router.push(`/kitchen/ingredients/${ingredientId}` as never);
    };

    const columns: readonly TableColumn<IngredientAdmin>[] = [
        {
            key: 'name',
            header: t('kitchen:list.columnName'),
            rowHeader: true,
            sortable: true,
            flex: 2,
            render: (row) => {
                const name = displayName(row.name, locale);
                return (
                    <Stack space="none">
                        <Text variant="bodyStrong" testID={`${ingredientRowTestId(row.id)}-name`}>
                            {name.value}
                        </Text>
                        {name.isFallback ? (
                            <Badge
                                testID={`${ingredientRowTestId(row.id)}-missing-arabic`}
                                tone="warning"
                                icon="warning"
                                label={t('kitchen:list.missingArabic')}
                            />
                        ) : null}
                        {row.reference === null ? null : (
                            <Text variant="caption" tone="secondary">
                                {row.reference}
                            </Text>
                        )}
                    </Stack>
                );
            },
        },
        {
            key: 'category',
            header: t('kitchen:list.columnCategory'),
            render: (row) => (
                <Text testID={`${ingredientRowTestId(row.id)}-category`} tone="secondary">
                    {row.categoryCode === ''
                        ? t('kitchen:list.noCategory')
                        : humaniseCode(row.categoryCode)}
                </Text>
            ),
        },
        {
            key: 'allergens',
            header: t('kitchen:list.columnAllergens'),
            flex: 2,
            render: (row) =>
                row.allergens.length === 0 ? (
                    <Text testID={`${ingredientRowTestId(row.id)}-allergens-none`} tone="secondary">
                        {t('kitchen:list.noAllergens')}
                    </Text>
                ) : (
                    <Inline space="xs" wrap testID={`${ingredientRowTestId(row.id)}-allergens`}>
                        {row.allergens.map((mapping) => (
                            <Badge
                                key={mapping.allergenCode}
                                tone={mapping.containment === 'contains' ? 'danger' : 'warning'}
                                label={mapping.allergenCode}
                            />
                        ))}
                    </Inline>
                ),
        },
        {
            key: 'status',
            header: t('kitchen:list.columnStatus'),
            sortable: true,
            render: (row) => (
                <Badge
                    testID={`${ingredientRowTestId(row.id)}-status`}
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
                    <Text testID={`${ingredientRowTestId(row.id)}-updated`} variant="caption">
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

    const failure = toFailure(ingredients.error);

    return (
        <Stack space="lg" testID="kitchen-ingredients-screen">
            <KitchenPageHeader
                testID="kitchen-ingredients-header"
                title={t('kitchen:list.title')}
                subtitle={t('kitchen:list.subtitle')}
                titleTestID="kitchen-ingredients-title"
                subtitleTestID="kitchen-ingredients-subtitle"
                actions={
                    canManage ? (
                        <Button
                            testID="kitchen-ingredients-toolbar-create"
                            label={t('kitchen:toolbar.create')}
                            onPress={() => {
                                router.push('/kitchen/ingredients/new' as never);
                            }}
                        />
                    ) : undefined
                }
            />

            <ListToolbar
                testID="kitchen-ingredients-toolbar"
                query={query}
                onQueryChange={setQuery}
                statuses={statuses}
                onStatusesChange={setStatuses}
                statusOptions={INGREDIENT_STATUS_FILTERS}
                categoryOptions={(categories.data ?? []).map((entry) => ({
                    value: entry.code,
                    label: humaniseCode(entry.code),
                    description: t('kitchen:hub.itemCount', { count: entry.count }),
                }))}
                category={category}
                onCategoryChange={setCategory}
                {...(ingredients.isPending || total === null
                    ? {}
                    : {
                          resultSummary: t('kitchen:toolbar.showing', {
                              shown: sorted.length,
                              total,
                          }),
                      })}
            />

            {ingredients.isPending ? (
                <Stack space="sm" testID="kitchen-ingredients-loading">
                    {Array.from({ length: 5 }, (_, index) => (
                        <Card key={index} padding="md">
                            <Stack space="xs">
                                <Skeleton
                                    testID={`kitchen-ingredients-skeleton-${String(index + 1)}`}
                                    heightClassName="h-5"
                                />
                                <Skeleton heightClassName="h-4" widthClassName="w-1/2" />
                            </Stack>
                        </Card>
                    ))}
                </Stack>
            ) : failure !== null ? (
                <ErrorState
                    testID="kitchen-ingredients-error"
                    failure={failure}
                    onRetry={() => {
                        void ingredients.refetch();
                    }}
                    retrying={ingredients.isFetching}
                />
            ) : sorted.length === 0 ? (
                <EmptyState
                    testID="kitchen-ingredients-empty"
                    title={
                        trimmed === '' && statuses.length === 0 && category === null
                            ? t('kitchen:list.emptyTitle')
                            : t('kitchen:list.filteredEmptyTitle')
                    }
                    body={
                        trimmed === '' && statuses.length === 0 && category === null
                            ? t('kitchen:list.emptyBody')
                            : t('kitchen:list.filteredEmptyBody')
                    }
                    actions={
                        <Inline space="sm" wrap>
                            <Button
                                testID="kitchen-ingredients-clear"
                                variant="secondary"
                                label={t('kitchen:toolbar.clearFilters')}
                                onPress={() => {
                                    setQuery('');
                                    setStatuses([]);
                                    setCategory(null);
                                }}
                            />
                            {canManage ? (
                                <Button
                                    testID="kitchen-ingredients-empty-create"
                                    label={t('kitchen:toolbar.create')}
                                    onPress={() => {
                                        router.push('/kitchen/ingredients/new' as never);
                                    }}
                                />
                            ) : null}
                        </Inline>
                    }
                />
            ) : (
                <Stack space="sm">
                    <Table<IngredientAdmin>
                        testID="kitchen-ingredients-table"
                        caption={t('kitchen:list.caption')}
                        captionHidden
                        columns={columns}
                        rows={sorted}
                        rowKey={(row) => String(row.id)}
                        rowTone={(row) =>
                            row.meta.status === 'draft' || row.meta.status === 'retired'
                                ? 'muted'
                                : 'default'
                        }
                        sortKey={sortKey}
                        sortDirection={sortDirection}
                        onSortChange={(key, direction) => {
                            setSortKey(key as SortKey);
                            setSortDirection(direction);
                        }}
                        rowAction={{
                            header: t('kitchen:list.actionHeader'),
                            render: (row) => (
                                <Inline space="xs" wrap justify="end">
                                    <Button
                                        testID={`${ingredientRowTestId(row.id)}-open`}
                                        size="sm"
                                        variant="secondary"
                                        label={t('kitchen:list.open')}
                                        onPress={() => {
                                            openEditor(String(row.id));
                                        }}
                                    />
                                    {canManage && row.meta.status !== 'retired' ? (
                                        <Button
                                            testID={`${ingredientRowTestId(row.id)}-archive`}
                                            size="sm"
                                            variant="ghost"
                                            label={t('kitchen:list.archive')}
                                            onPress={() => {
                                                setArchiving(row);
                                            }}
                                        />
                                    ) : null}
                                </Inline>
                            ),
                        }}
                    />

                    <Pagination
                        testID="kitchen-ingredients-pagination"
                        page={page}
                        totalPages={totalPages}
                        onPageChange={setPage}
                        disabled={ingredients.isFetching}
                    />
                </Stack>
            )}

            <Dialog
                testID="kitchen-ingredients-archive-dialog"
                open={archiving !== null}
                onClose={() => {
                    setArchiving(null);
                }}
                title={t('kitchen:editor.archiveTitle')}
                description={t('kitchen:editor.archiveBody')}
                actions={
                    <>
                        <Button
                            testID="kitchen-ingredients-archive-cancel"
                            variant="quiet"
                            label={t('kitchen:common.cancel')}
                            onPress={() => {
                                setArchiving(null);
                            }}
                        />
                        <Button
                            testID="kitchen-ingredients-archive-confirm"
                            variant="danger"
                            label={t('kitchen:editor.archiveConfirm')}
                            loading={archive.isPending}
                            onPress={() => {
                                const row = archiving;
                                if (row === null) return;
                                archive.mutate(
                                    {
                                        ingredientId: row.id,
                                        request: { lockVersion: row.meta.lockVersion },
                                    },
                                    {
                                        onSuccess: () => {
                                            setArchiving(null);
                                            toast.show({
                                                testID: 'kitchen-ingredients-archived-toast',
                                                tone: 'success',
                                                message: t('kitchen:list.archivedToast', {
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
                {archive.error === null ? null : (
                    <Text testID="kitchen-ingredients-archive-error" tone="danger">
                        {toFailure(archive.error)?.message ?? t('kitchen:list.archiveFailed')}
                    </Text>
                )}
            </Dialog>
        </Stack>
    );
}
