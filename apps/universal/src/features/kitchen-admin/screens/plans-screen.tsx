import type { PlanAdmin, PublishableStatus } from '@healthy360/api-client/contracts';
import {
    Badge,
    Button,
    Card,
    EmptyState,
    ErrorState,
    Heading,
    Inline,
    Pagination,
    Skeleton,
    Stack,
    Table,
    Text,
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
    priceListsFromPages,
    useAdminPlanPageQuery,
    usePriceListsQuery,
} from '../../../data/kitchen-admin-hooks.ts';
import { CATALOGUE_MANAGE_PERMISSION, CATALOGUE_VIEW_PERMISSION } from '../entity-registry.ts';
import {
    PLAN_STATUS_FILTERS,
    displayName,
    planRowTestId,
    statusKey,
    statusTone,
    summarisePlanDurations,
    summarisePlanMatrix,
    summarisePlanPrices,
} from '../format.ts';
import type { PlanPriceCoverage } from '../format.ts';
import { ListToolbar } from '../list-toolbar.tsx';
import { useListPage } from '../use-list-page.ts';

/**
 * `/kitchen/plans` — the commercial plans this kitchen sells, and how much of each one is decided.
 *
 * ## Three columns, and each of them answers "is this finished?"
 *
 * A plan is not one record; it is a *matrix* of configurations, a set of commitments and a set of
 * prices, and every one of the three can be half-built. So the list reports the completeness of each
 * rather than a count:
 *
 * 1. **Configurations** — how many cells of the combination × energy-band grid actually exist. A
 *    plan with three combinations and three bands has nine cells and the seeded plans fill three of
 *    them; "3 configurations" without "of 9" would read as complete when it is not.
 * 2. **Durations** — the kinds offered and the day counts, because the whole point of the
 *    `duration_kind` model (plan §4.3) is that 5, 20, 40 and 60 days are representable and a
 *    one-off delivery is a *kind* rather than a zero.
 * 3. **Prices** — derived from the kitchen's price lists, which is the only place a plan price
 *    lives. This column is why the publish refusal is never a surprise: `publishPlan` is refused
 *    while no confirmed price exists, and the row says so before anybody opens the plan.
 *
 * ## Sorting is client-side, and stated
 *
 * The same limitation the other five lists document: `PlanAdminFilter` publishes no sort parameter,
 * so the table sorts what has been loaded.
 */

type SortKey = 'name' | 'status' | 'updatedAt';

export function PlansScreen() {
    return (
        <Gate
            area="kitchen"
            requirement={{ allOf: [CATALOGUE_VIEW_PERMISSION] }}
            testID="kitchen-plans"
        >
            <PlansList />
        </Gate>
    );
}

/** How much of a plan's matrix exists, as a fraction of the grid it is drawn on. */
function MatrixCell({ row }: { readonly row: PlanAdmin }) {
    const { t } = useTranslation();
    const testID = planRowTestId(String(row.id));
    const summary = summarisePlanMatrix(row);

    if (summary.variants === 0) {
        return (
            <Text testID={`${testID}-variants-none`} tone="secondary">
                {t('kitchen:plans.noVariants')}
            </Text>
        );
    }

    return (
        <Stack space="xs" testID={`${testID}-variants`}>
            <Text variant="bodyStrong" testID={`${testID}-variants-coverage`}>
                {t('kitchen:plans.coverage', { filled: summary.filled, cells: summary.cells })}
            </Text>
            <Inline space="xs" wrap>
                <Badge
                    testID={`${testID}-variants-count`}
                    tone="neutral"
                    label={t('kitchen:plans.variantCount', { count: summary.variants })}
                />
                <Badge
                    testID={`${testID}-combination-count`}
                    tone="info"
                    label={t('kitchen:plans.combinationCount', { count: summary.combinations })}
                />
                {summary.activeVariants === summary.variants ? null : (
                    <Badge
                        testID={`${testID}-variants-inactive`}
                        tone="warning"
                        icon="warning"
                        label={t('kitchen:plans.inactiveCount', {
                            count: summary.variants - summary.activeVariants,
                        })}
                    />
                )}
            </Inline>
        </Stack>
    );
}

/** The commitments a plan offers — kinds first, then the day counts they carry. */
function DurationsCell({ row }: { readonly row: PlanAdmin }) {
    const { t } = useTranslation();
    const formatter = useFormatter();
    const testID = planRowTestId(String(row.id));
    const summary = summarisePlanDurations(row.durations);

    if (summary.total === 0) {
        return (
            <Text testID={`${testID}-durations-none`} tone="secondary">
                {t('kitchen:plans.noDurations')}
            </Text>
        );
    }

    return (
        <Stack space="xs" testID={`${testID}-durations`}>
            <Text testID={`${testID}-durations-days`}>
                {summary.dayCounts.length === 0
                    ? t('kitchen:plans.noFixedDurations')
                    : t('kitchen:plans.dayCountList', {
                          days: summary.dayCounts
                              .map((days) => formatter.formatNumber(days))
                              .join(t('kitchen:common.listSeparator')),
                      })}
            </Text>
            <Inline space="xs" wrap>
                {summary.oneOff === 0 ? null : (
                    <Badge
                        testID={`${testID}-durations-one-off`}
                        tone="info"
                        label={t('kitchen:plans.oneOffCount', { count: summary.oneOff })}
                    />
                )}
                {summary.undecidedDiscounts === 0 ? null : (
                    <Badge
                        testID={`${testID}-durations-undecided`}
                        tone="neutral"
                        label={t('kitchen:plans.undecidedDiscountCount', {
                            count: summary.undecidedDiscounts,
                        })}
                    />
                )}
                {summary.inconsistent === 0 ? null : (
                    <Badge
                        testID={`${testID}-durations-inconsistent`}
                        tone="danger"
                        icon="warning"
                        label={t('kitchen:plans.inconsistentDurationCount', {
                            count: summary.inconsistent,
                        })}
                    />
                )}
            </Inline>
        </Stack>
    );
}

/**
 * What the price lists say about this plan.
 *
 * `null` while the price lists are still loading, which is rendered as "checking" rather than as a
 * zero: "no confirmed price" is the strongest claim on this screen and stating it before the
 * evidence has arrived would be wrong exactly when it matters.
 */
function PricesCell({
    row,
    coverage,
}: {
    readonly row: PlanAdmin;
    readonly coverage: PlanPriceCoverage | null;
}) {
    const { t } = useTranslation();
    const testID = planRowTestId(String(row.id));

    if (coverage === null) {
        return (
            <Text testID={`${testID}-prices-pending`} tone="secondary" variant="caption">
                {t('kitchen:plans.pricesPending')}
            </Text>
        );
    }

    return (
        <Stack space="xs" testID={`${testID}-prices`}>
            <Badge
                testID={`${testID}-prices-confirmed`}
                tone={coverage.confirmed === 0 ? 'warning' : 'success'}
                {...(coverage.confirmed === 0 ? { icon: 'warning' as const } : {})}
                label={t('kitchen:plans.confirmedPriceCount', { count: coverage.confirmed })}
            />
            <Inline space="xs" wrap>
                {coverage.placeholder === 0 ? null : (
                    <Badge
                        testID={`${testID}-prices-placeholder`}
                        tone="warning"
                        label={t('kitchen:plans.placeholderPriceCount', {
                            count: coverage.placeholder,
                        })}
                    />
                )}
                {coverage.unpriced === 0 ? null : (
                    <Badge
                        testID={`${testID}-prices-unpriced`}
                        tone="neutral"
                        label={t('kitchen:plans.unpricedCount', { count: coverage.unpriced })}
                    />
                )}
            </Inline>
        </Stack>
    );
}

function PlansList() {
    const { t } = useTranslation();
    const router = useRouter();
    const formatter = useFormatter();
    const { locale } = useLocale();
    const canManage = useCan(CATALOGUE_MANAGE_PERMISSION);

    const [query, setQuery] = useState('');
    const [statuses, setStatuses] = useState<readonly PublishableStatus[]>([]);
    const [sortKey, setSortKey] = useState<SortKey>('name');
    const [sortDirection, setSortDirection] = useState<TableSortDirection>('asc');

    const trimmed = query.trim();
    const filter = useMemo(
        () => ({
            ...(trimmed === '' ? {} : { query: trimmed }),
            ...(statuses.length === 0 ? {} : { statuses }),
        }),
        [trimmed, statuses],
    );

    const [page, setPage] = useListPage(filter);
    const plans = useAdminPlanPageQuery(filter, page);
    /*
     * The price coverage column reads the lists, because `PlanAdmin` carries no price and should
     * not: a price belongs to an effective-dated list in one currency, and a second copy on the plan
     * would be a second answer to "what does this cost?". One capped listing serves every row.
     */
    const priceLists = usePriceListsQuery({ limit: 100 });

    // Left possibly-undefined rather than defaulted to `[]`: `?? []` is a fresh array on
    // every render, which would re-run anything memoised over it whether or not it changed.
    const rows = plans.data?.items;
    const total = plans.data?.totalCount ?? null;
    const totalPages = pagesInResult(plans.data) ?? 0;
    const lists = priceListsFromPages(priceLists.data?.pages);
    const pricesReady = !priceLists.isPending && priceLists.error === null;

    const coverage = useMemo(() => {
        if (!pricesReady) return new Map<string, PlanPriceCoverage>();
        return new Map(
            (rows ?? []).map((row) => [String(row.id), summarisePlanPrices(row, lists)] as const),
        );
    }, [rows, lists, pricesReady]);

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

    const columns: readonly TableColumn<PlanAdmin>[] = [
        {
            key: 'name',
            header: t('kitchen:plans.columnName'),
            rowHeader: true,
            sortable: true,
            flex: 2,
            render: (row) => {
                const name = displayName(row.name, locale);
                const testID = planRowTestId(String(row.id));
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
                    </Stack>
                );
            },
        },
        {
            key: 'variants',
            header: t('kitchen:plans.columnVariants'),
            flex: 2,
            render: (row) => <MatrixCell row={row} />,
        },
        {
            key: 'durations',
            header: t('kitchen:plans.columnDurations'),
            flex: 2,
            render: (row) => <DurationsCell row={row} />,
        },
        {
            key: 'prices',
            header: t('kitchen:plans.columnPrices'),
            flex: 2,
            render: (row) => (
                <PricesCell row={row} coverage={coverage.get(String(row.id)) ?? null} />
            ),
        },
        {
            key: 'status',
            header: t('kitchen:list.columnStatus'),
            sortable: true,
            render: (row) => (
                <Badge
                    testID={`${planRowTestId(String(row.id))}-status`}
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
                    <Text testID={`${planRowTestId(String(row.id))}-updated`} variant="caption">
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

    const failure = toFailure(plans.error);
    const unfiltered = trimmed === '' && statuses.length === 0;

    return (
        <Stack space="lg" testID="kitchen-plans-screen">
            <Stack space="xs">
                <Heading level={1} testID="kitchen-plans-title">
                    {t('kitchen:plans.title')}
                </Heading>
                <Text tone="secondary" testID="kitchen-plans-subtitle">
                    {t('kitchen:plans.subtitle')}
                </Text>
            </Stack>

            <ListToolbar
                testID="kitchen-plans-toolbar"
                query={query}
                onQueryChange={setQuery}
                statuses={statuses}
                onStatusesChange={setStatuses}
                statusOptions={PLAN_STATUS_FILTERS}
                createLabel={t('kitchen:plans.create')}
                {...(canManage
                    ? {
                          onCreate: () => {
                              router.push('/kitchen/plans/new' as never);
                          },
                      }
                    : {})}
                {...(plans.isPending || total === null
                    ? {}
                    : { resultSummary: t('kitchen:plans.resultCount', { count: total }) })}
            />

            {plans.isPending ? (
                <Stack space="sm" testID="kitchen-plans-loading">
                    {Array.from({ length: 4 }, (_, index) => (
                        <Card key={index} padding="md">
                            <Stack space="xs">
                                <Skeleton
                                    testID={`kitchen-plans-skeleton-${String(index + 1)}`}
                                    heightClassName="h-5"
                                />
                                <Skeleton heightClassName="h-4" widthClassName="w-1/2" />
                            </Stack>
                        </Card>
                    ))}
                </Stack>
            ) : failure !== null ? (
                <ErrorState
                    testID="kitchen-plans-error"
                    failure={failure}
                    onRetry={() => {
                        void plans.refetch();
                    }}
                    retrying={plans.isFetching}
                />
            ) : sorted.length === 0 ? (
                <EmptyState
                    testID="kitchen-plans-empty"
                    title={
                        unfiltered
                            ? t('kitchen:plans.emptyTitle')
                            : t('kitchen:plans.filteredEmptyTitle')
                    }
                    body={
                        unfiltered
                            ? t('kitchen:plans.emptyBody')
                            : t('kitchen:plans.filteredEmptyBody')
                    }
                />
            ) : (
                <Stack space="sm">
                    <Table<PlanAdmin>
                        testID="kitchen-plans-table"
                        caption={t('kitchen:plans.caption')}
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
                                <Inline space="xs" wrap justify="end">
                                    <Button
                                        testID={`${planRowTestId(String(row.id))}-open`}
                                        size="sm"
                                        variant="secondary"
                                        label={t('kitchen:list.open')}
                                        onPress={() => {
                                            router.push(
                                                `/kitchen/plans/${String(row.id)}` as never,
                                            );
                                        }}
                                    />
                                </Inline>
                            ),
                        }}
                    />

                    <Pagination
                        testID="kitchen-plans-pagination"
                        page={page}
                        totalPages={totalPages}
                        onPageChange={setPage}
                        disabled={plans.isFetching}
                    />
                </Stack>
            )}
        </Stack>
    );
}
