import type { MealAdmin, PublishableStatus } from '@healthy360/api-client/contracts';
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
import { MEAL_TYPES } from '@healthy360/domain-types';
import type { MealType } from '@healthy360/domain-types';
import { useFormatter, useLocale } from '@healthy360/i18n';
import { useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { Gate, useCan } from '../../../access/gate.tsx';
import { toFailure } from '../../../data/hooks.ts';
import {
    pagesInResult,
    useAdminMealPageQuery,
    useRetireMealMutation,
} from '../../../data/kitchen-admin-hooks.ts';
import { CATALOGUE_MANAGE_PERMISSION, CATALOGUE_VIEW_PERMISSION } from '../entity-registry.ts';
import {
    MEAL_STATUS_FILTERS,
    availableChannels,
    channelKey,
    displayName,
    mealRowTestId,
    mealTypeKey,
    statusKey,
    statusTone,
} from '../format.ts';
import { ListToolbar } from '../list-toolbar.tsx';
import { useListPage } from '../use-list-page.ts';

/**
 * `/kitchen/meals` — the dishes this kitchen sells, and which of them a shopper can see.
 *
 * ## This is the one list whose rows a customer also reads
 *
 * Publishing a meal puts it in the marketplace listing and on its own public page; retiring one takes
 * it away. That is not a metaphor in this world — the admin and consumer surfaces read the same
 * store — so the publication column is the most load-bearing thing on the screen and the row actions
 * are the two lifecycle verbs the contract publishes: `publishMeal` and `retireMeal`. There is no
 * archive, because retiring *is* the archive.
 *
 * ## Publishing from a row asks first, and says what it costs
 *
 * The confirmation is not ceremony. A published meal is visible to every consumer surface at once,
 * and a quarantined one cannot be published at all (plan §4.7) — the server refuses it structurally
 * and the dialog renders that refusal beside its own button rather than letting somebody press it
 * repeatedly.
 *
 * ## The second filter axis is the meal type, because that is what the contract publishes
 *
 * `MealAdminFilter` carries `mealTypes`; there is no meal category and no cuisine filter server-side.
 * One type at a time through the shared toolbar's taxonomy slot — a closed vocabulary of four, so
 * nothing has to be derived from the rows in use the way the product categories are.
 */

type SortKey = 'name' | 'status' | 'updatedAt';

export function MealsScreen() {
    return (
        <Gate
            area="kitchen"
            requirement={{ allOf: [CATALOGUE_VIEW_PERMISSION] }}
            testID="kitchen-meals"
        >
            <MealsList />
        </Gate>
    );
}

/** The derived allergen label the meal carries. Frozen from its recipe version, never edited here. */
function AllergenCell({ row }: { readonly row: MealAdmin }) {
    const { t } = useTranslation();
    const testID = mealRowTestId(String(row.id));

    if (row.allergens.length === 0) {
        return (
            <Text testID={`${testID}-allergens-none`} tone="secondary">
                {t('kitchen:list.noAllergens')}
            </Text>
        );
    }

    return (
        <Inline space="xs" wrap testID={`${testID}-allergens`}>
            {row.allergens.map((code) => (
                <Badge key={code} tone="danger" label={String(code)} />
            ))}
        </Inline>
    );
}

function MealsList() {
    const { t } = useTranslation();
    const router = useRouter();
    const formatter = useFormatter();
    const { locale } = useLocale();
    const toast = useToast();
    const canManage = useCan(CATALOGUE_MANAGE_PERMISSION);

    const [query, setQuery] = useState('');
    const [statuses, setStatuses] = useState<readonly PublishableStatus[]>([]);
    const [mealType, setMealType] = useState<string | null>(null);
    const [sortKey, setSortKey] = useState<SortKey>('name');
    const [sortDirection, setSortDirection] = useState<TableSortDirection>('asc');
    const [retiring, setRetiring] = useState<MealAdmin | null>(null);

    const trimmed = query.trim();
    const filter = useMemo(
        () => ({
            ...(trimmed === '' ? {} : { query: trimmed }),
            ...(statuses.length === 0 ? {} : { statuses }),
            ...(mealType === null ? {} : { mealTypes: [mealType as MealType] }),
        }),
        [trimmed, statuses, mealType],
    );

    const [page, setPage] = useListPage(filter);
    const meals = useAdminMealPageQuery(filter, page);
    const retire = useRetireMealMutation();

    // Left possibly-undefined rather than defaulted to `[]`: `?? []` is a fresh array on
    // every render, which would re-run anything memoised over it whether or not it changed.
    const rows = meals.data?.items;
    const total = meals.data?.totalCount ?? null;
    const totalPages = pagesInResult(meals.data) ?? 0;

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

    const openEditor = (mealId: string) => {
        router.push(`/kitchen/meals/${mealId}` as never);
    };

    const columns: readonly TableColumn<MealAdmin>[] = [
        {
            key: 'name',
            header: t('kitchen:meals.columnName'),
            rowHeader: true,
            sortable: true,
            flex: 2,
            render: (row) => {
                const name = displayName(row.name, locale);
                const testID = mealRowTestId(String(row.id));
                return (
                    <Stack space="none">
                        <Text variant="bodyStrong" testID={`${testID}-name`}>
                            {name.value}
                        </Text>
                        {name.isFallback ? (
                            <Badge
                                testID={`${testID}-missing-arabic`}
                                tone="warning"
                                icon="warning"
                                label={t('kitchen:list.missingArabic')}
                            />
                        ) : null}
                        <Inline space="xs" wrap testID={`${testID}-meal-types`}>
                            {row.mealTypes.map((type) => (
                                <Badge key={type} tone="neutral" label={t(mealTypeKey(type))} />
                            ))}
                        </Inline>
                    </Stack>
                );
            },
        },
        {
            key: 'allergens',
            header: t('kitchen:meals.columnAllergens'),
            flex: 2,
            render: (row) => <AllergenCell row={row} />,
        },
        {
            key: 'channels',
            header: t('kitchen:meals.columnChannels'),
            flex: 2,
            render: (row) => {
                const testID = mealRowTestId(String(row.id));
                const channels = availableChannels(row.channelAvailability);
                if (channels.length === 0) {
                    return (
                        <Text testID={`${testID}-channels-none`} tone="secondary">
                            {t('kitchen:meals.noChannels')}
                        </Text>
                    );
                }
                return (
                    <Inline space="xs" wrap testID={`${testID}-channels`}>
                        {channels.map((channel) => (
                            <Badge key={channel} tone="info" label={t(channelKey(channel))} />
                        ))}
                    </Inline>
                );
            },
        },
        {
            key: 'status',
            header: t('kitchen:list.columnStatus'),
            sortable: true,
            render: (row) => (
                <Stack space="none">
                    <Badge
                        testID={`${mealRowTestId(String(row.id))}-status`}
                        tone={statusTone(row.meta.status)}
                        label={t(statusKey(row.meta.status))}
                    />
                    {row.meta.status === 'published' ? (
                        <Text
                            testID={`${mealRowTestId(String(row.id))}-visible`}
                            variant="caption"
                            tone="secondary"
                        >
                            {t('kitchen:meals.visibleToConsumers')}
                        </Text>
                    ) : null}
                </Stack>
            ),
        },
        {
            key: 'updatedAt',
            header: t('kitchen:list.columnUpdated'),
            sortable: true,
            render: (row) => (
                <Stack space="none">
                    <Text testID={`${mealRowTestId(String(row.id))}-updated`} variant="caption">
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

    const failure = toFailure(meals.error);
    const unfiltered = trimmed === '' && statuses.length === 0 && mealType === null;

    return (
        <Stack space="lg" testID="kitchen-meals-screen">
            <Stack space="xs">
                <Heading level={1} testID="kitchen-meals-title">
                    {t('kitchen:meals.title')}
                </Heading>
                <Text tone="secondary" testID="kitchen-meals-subtitle">
                    {t('kitchen:meals.subtitle')}
                </Text>
            </Stack>

            <ListToolbar
                testID="kitchen-meals-toolbar"
                query={query}
                onQueryChange={setQuery}
                statuses={statuses}
                onStatusesChange={setStatuses}
                statusOptions={MEAL_STATUS_FILTERS}
                categoryLabel={t('kitchen:meals.typeFilterLabel')}
                categoryAllLabel={t('kitchen:meals.typeFilterAll')}
                categoryOptions={MEAL_TYPES.map((type) => ({
                    value: type,
                    label: t(mealTypeKey(type)),
                }))}
                category={mealType}
                onCategoryChange={setMealType}
                createLabel={t('kitchen:meals.create')}
                {...(canManage
                    ? {
                          onCreate: () => {
                              router.push('/kitchen/meals/new' as never);
                          },
                      }
                    : {})}
                {...(meals.isPending || total === null
                    ? {}
                    : { resultSummary: t('kitchen:meals.resultCount', { count: total }) })}
            />

            {meals.isPending ? (
                <Stack space="sm" testID="kitchen-meals-loading">
                    {Array.from({ length: 5 }, (_, index) => (
                        <Card key={index} padding="md">
                            <Stack space="xs">
                                <Skeleton
                                    testID={`kitchen-meals-skeleton-${String(index + 1)}`}
                                    heightClassName="h-5"
                                />
                                <Skeleton heightClassName="h-4" widthClassName="w-1/2" />
                            </Stack>
                        </Card>
                    ))}
                </Stack>
            ) : failure !== null ? (
                <ErrorState
                    testID="kitchen-meals-error"
                    failure={failure}
                    onRetry={() => {
                        void meals.refetch();
                    }}
                    retrying={meals.isFetching}
                />
            ) : sorted.length === 0 ? (
                <EmptyState
                    testID="kitchen-meals-empty"
                    title={
                        unfiltered
                            ? t('kitchen:meals.emptyTitle')
                            : t('kitchen:meals.filteredEmptyTitle')
                    }
                    body={
                        unfiltered
                            ? t('kitchen:meals.emptyBody')
                            : t('kitchen:meals.filteredEmptyBody')
                    }
                    actions={
                        <Inline space="sm" wrap>
                            <Button
                                testID="kitchen-meals-clear"
                                variant="secondary"
                                label={t('kitchen:toolbar.clearFilters')}
                                onPress={() => {
                                    setQuery('');
                                    setStatuses([]);
                                    setMealType(null);
                                }}
                            />
                            {canManage ? (
                                <Button
                                    testID="kitchen-meals-empty-create"
                                    label={t('kitchen:meals.create')}
                                    onPress={() => {
                                        router.push('/kitchen/meals/new' as never);
                                    }}
                                />
                            ) : null}
                        </Inline>
                    }
                />
            ) : (
                <Stack space="sm">
                    <Table<MealAdmin>
                        testID="kitchen-meals-table"
                        caption={t('kitchen:meals.caption')}
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
                            render: (row) => {
                                const testID = mealRowTestId(String(row.id));
                                return (
                                    <Inline space="xs" wrap justify="end">
                                        <Button
                                            testID={`${testID}-open`}
                                            size="sm"
                                            variant="secondary"
                                            label={t('kitchen:list.open')}
                                            onPress={() => {
                                                openEditor(String(row.id));
                                            }}
                                        />
                                        {canManage &&
                                        (row.meta.status === 'published' ||
                                            row.meta.status === 'review_required') ? (
                                            <Button
                                                testID={`${testID}-retire`}
                                                size="sm"
                                                variant="ghost"
                                                label={t('kitchen:meals.retire')}
                                                onPress={() => {
                                                    setRetiring(row);
                                                }}
                                            />
                                        ) : null}
                                    </Inline>
                                );
                            },
                        }}
                    />

                    <Pagination
                        testID="kitchen-meals-pagination"
                        page={page}
                        totalPages={totalPages}
                        onPageChange={setPage}
                        disabled={meals.isFetching}
                    />
                </Stack>
            )}

            {/*
             * Retiring is what removes a meal from every consumer surface. The dialog says exactly
             * that, and says nothing is deleted, because orders and price-list entries still point
             * at the row — "retire" and "delete" are not the same word and must not read as one.
             */}
            <Dialog
                testID="kitchen-meals-retire-dialog"
                open={retiring !== null}
                onClose={() => {
                    setRetiring(null);
                }}
                title={t('kitchen:meals.retireTitle')}
                description={t('kitchen:meals.retireBody')}
                actions={
                    <>
                        <Button
                            testID="kitchen-meals-retire-cancel"
                            variant="quiet"
                            label={t('kitchen:common.cancel')}
                            onPress={() => {
                                setRetiring(null);
                            }}
                        />
                        <Button
                            testID="kitchen-meals-retire-confirm"
                            variant="danger"
                            label={t('kitchen:meals.retireConfirm')}
                            loading={retire.isPending}
                            onPress={() => {
                                const row = retiring;
                                if (row === null) return;
                                retire.mutate(
                                    {
                                        mealId: row.id,
                                        request: { lockVersion: row.meta.lockVersion },
                                    },
                                    {
                                        onSuccess: () => {
                                            setRetiring(null);
                                            toast.show({
                                                testID: 'kitchen-meals-retired-toast',
                                                tone: 'success',
                                                message: t('kitchen:meals.retiredToast', {
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
                    <Text testID="kitchen-meals-retire-error" tone="danger">
                        {toFailure(retire.error)?.message ?? t('kitchen:meals.retireFailed')}
                    </Text>
                )}
            </Dialog>
        </Stack>
    );
}
