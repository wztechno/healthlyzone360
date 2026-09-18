import type { PlanAdmin, PublishableStatus } from '@healthy360/api-client/contracts';
import {
    Badge,
    Button,
    EmptyState,
    ErrorState,
    Skeleton,
    Stack,
    Text,
} from '@healthy360/design-system';
import type { MenuItem } from '@healthy360/design-system';
import { useFormatter, useLocale } from '@healthy360/i18n';
import { useRouter } from 'expo-router';
import type { TFunction } from 'i18next';
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
import { CATALOGUE_ROW_ICONS } from '../catalogue/catalogue-list-item.tsx';
import { CatalogueList } from '../catalogue/catalogue-list.tsx';
import type { CatalogueColumn } from '../catalogue/catalogue-column-spec.ts';
import { CataloguePager } from '../catalogue/catalogue-pager.tsx';
import { CatalogueStatCards } from '../catalogue/catalogue-stat-cards.tsx';
import type { CatalogueStatCard } from '../catalogue/catalogue-stat-cards.tsx';
import { CatalogueToolbar } from '../catalogue/catalogue-toolbar.tsx';
import type { CatalogueStatusSegment } from '../catalogue/catalogue-toolbar.tsx';
import {
    compareNumber,
    compareText,
    useColumnControls,
} from '../catalogue/use-column-controls.tsx';
import type { ControlledColumn } from '../catalogue/use-column-controls.tsx';
import { CATALOGUE_MANAGE_PERMISSION, CATALOGUE_VIEW_PERMISSION } from '../entity-registry.ts';
import {
    PLAN_STATUS_FILTERS,
    displayName,
    planRowTestId,
    statusShortKey,
    statusTone,
    summarisePlanDurations,
    summarisePlanMatrix,
    summarisePlanPrices,
} from '../format.ts';
import type { PlanPriceCoverage } from '../format.ts';
import { useListPage } from '../use-list-page.ts';
import { RecordViewPage } from '../catalogue/record-view-page.tsx';
import { ColumnPicker } from '../catalogue/column-picker.tsx';

/**
 * `/kitchen/plans` — the plans this kitchen sells, and how much of each is decided (Commercial §3.3).
 *
 * ```
 *                                                                  [ + New plan ]
 * ┌ SHOWN ┐ ┌ NO CONFIGURATIONS ┐ ┌ NOTHING PRICED ┐
 * [ ⌕ search ]  [ All | Live | Draft | Review ]
 * PLAN     CONFIGURATIONS                DURATIONS     PRICES             STATUS  UPDATED  ◉ ✎
 * ```
 *
 * The Catalogue list's parts, unchanged. Three cells, three independent half-built states — a plan
 * is a matrix, a set of commitments and a set of prices, and each can be half-built. Prices come
 * from the price lists (a plan carries none of its own) and read "checking" until they arrive,
 * because "no confirmed price" is the strongest claim on the page.
 *
 * Archive stays on the editor, where `plans.retire*` already explains what it costs; the row offers
 * View and Edit.
 */
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

const SEGMENT_STATUSES: readonly PublishableStatus[] = ['published', 'draft', 'review_required'];
type StatusSegmentValue = PublishableStatus | 'all';

function PlansList() {
    const { t } = useTranslation();
    const router = useRouter();
    const formatter = useFormatter();
    const { locale } = useLocale();
    const canManage = useCan(CATALOGUE_MANAGE_PERMISSION);

    const [query, setQuery] = useState('');
    const [status, setStatus] = useState<StatusSegmentValue>('all');
    const [viewing, setViewing] = useState<PlanAdmin | null>(null);

    const trimmed = query.trim();
    const filter = useMemo(
        () => ({
            ...(trimmed === '' ? {} : { query: trimmed }),
            ...(status === 'all' ? {} : { statuses: [status] }),
        }),
        [trimmed, status],
    );
    const [page, setPage] = useListPage(filter);
    const plans = useAdminPlanPageQuery(filter, page);
    const priceLists = usePriceListsQuery({ limit: 100 });

    const rows = useMemo(() => plans.data?.items ?? [], [plans.data]);
    const total = plans.data?.totalCount ?? null;
    const totalPages = pagesInResult(plans.data) ?? 0;
    const lists = priceListsFromPages(priceLists.data?.pages);
    const pricesReady = !priceLists.isPending && priceLists.error === null;

    const coverage = useMemo(() => {
        if (!pricesReady) return new Map<string, PlanPriceCoverage>();
        return new Map(
            rows.map((row) => [String(row.id), summarisePlanPrices(row, lists)] as const),
        );
    }, [rows, lists, pricesReady]);

    /**
     * The design's Prices cell: how much of the grid is sold at a confirmed price — "9 of 12 cells
     * sold" — or `Nothing priced yet` while no list confirms one. Reads "checking" until the price
     * lists arrive, because "nothing priced" is the strongest claim on the row.
     */
    const pricesText = (row: PlanAdmin): string => {
        const found = coverage.get(String(row.id));
        if (found === undefined) return t('kitchen:plans.pricesPending');
        if (found.confirmed === 0) return t('kitchen:priceLists.noEntries');
        const matrix = summarisePlanMatrix(row);
        return t('kitchen:plans.coverage', { filled: matrix.filled, cells: matrix.cells });
    };

    /** "yesterday by Omar Fares" — the design's Last changed cell. */
    const updatedText = (row: PlanAdmin): string =>
        row.meta.updatedByName === null
            ? `${formatter.formatRelativeTime(row.meta.updatedAt)} ${t('kitchen:list.updatedBySeed')}`
            : `${formatter.formatRelativeTime(row.meta.updatedAt)} ${t('kitchen:list.updatedBy', {
                  name: row.meta.updatedByName,
              })}`;

    const openEditor = (row: PlanAdmin) => {
        setViewing(null);
        router.push(`/kitchen/plans/${String(row.id)}` as never);
    };

    const columns: readonly ControlledColumn<PlanAdmin, CatalogueColumn<PlanAdmin>>[] = [
        {
            key: 'name',
            role: 'title',
            label: t('kitchen:plans.columnName'),
            width: 200,
            priority: 100,
            value: (row) => displayName(row.name, locale).value,
            sort: (left, right, direction) =>
                compareText(
                    displayName(left.name, locale).value,
                    displayName(right.name, locale).value,
                    direction,
                ),
            render: (row) => {
                const testID = planRowTestId(String(row.id));
                const name = displayName(row.name, locale);
                return (
                    <Stack space="none" testID={testID}>
                        <Text variant="strong" numberOfLines={1} testID={`${testID}-name`}>
                            {name.value}
                        </Text>
                        {displayName(row.summary, locale).value.trim() === '' ? null : (
                            <Text variant="caption" tone="secondary" numberOfLines={1}>
                                {displayName(row.summary, locale).value}
                            </Text>
                        )}
                        {name.isFallback ? (
                            <Badge
                                testID={`${testID}-missing-arabic`}
                                tone="warning"
                                label={t('kitchen:list.missingArabic')}
                            />
                        ) : null}
                    </Stack>
                );
            },
        },
        {
            key: 'variants',
            role: 'metric',
            label: t('kitchen:plans.columnVariants'),
            width: 200,
            priority: 85,
            value: (row) => variantsText(row, t),
            sort: (left, right, direction) =>
                compareNumber(
                    summarisePlanMatrix(left).variants,
                    summarisePlanMatrix(right).variants,
                    direction,
                ),
            render: (row) => (
                <Text
                    tone={summarisePlanMatrix(row).variants === 0 ? 'secondary' : 'primary'}
                    testID={`${planRowTestId(String(row.id))}-variants-coverage`}
                >
                    {variantsText(row, t)}
                </Text>
            ),
        },
        {
            key: 'durations',
            label: t('kitchen:plans.columnDurations'),
            width: 130,
            priority: 60,
            value: (row) => durationsText(row, t),
            sort: (left, right, direction) =>
                compareNumber(
                    summarisePlanDurations(left.durations).total,
                    summarisePlanDurations(right.durations).total,
                    direction,
                ),
            render: (row) => (
                <Text
                    tone={row.durations.length === 0 ? 'secondary' : 'primary'}
                    testID={`${planRowTestId(String(row.id))}-durations`}
                >
                    {durationsText(row, t)}
                </Text>
            ),
        },
        {
            key: 'prices',
            label: t('kitchen:plans.columnPrices'),
            width: 150,
            priority: 80,
            value: pricesText,
            // By how much is confirmed. A plan still "checking" is not "nothing priced", so while
            // the price lists are loading it sorts last either way rather than as a zero.
            sort: (left, right, direction) => {
                const a = coverage.get(String(left.id));
                const b = coverage.get(String(right.id));
                if (a === undefined || b === undefined) {
                    return a === b ? 0 : a === undefined ? 1 : -1;
                }
                return compareNumber(a.confirmed, b.confirmed, direction);
            },
            render: (row) => {
                const found = coverage.get(String(row.id));
                return (
                    <Text
                        tone={
                            found === undefined
                                ? 'secondary'
                                : found.confirmed === 0
                                  ? 'warning'
                                  : 'primary'
                        }
                        testID={`${planRowTestId(String(row.id))}-prices`}
                    >
                        {pricesText(row)}
                    </Text>
                );
            },
        },
        {
            key: 'status',
            role: 'status',
            label: t('kitchen:list.columnStatus'),
            width: 96,
            priority: 70,
            value: (row) => t(statusShortKey(row.meta.status)),
            // The status the request already carries — the segments' own filter, so Archived is
            // reachable here without spending a segment on it.
            filter: {
                values: () =>
                    PLAN_STATUS_FILTERS.map((value) => ({
                        key: value,
                        label: t(statusShortKey(value)),
                    })),
                external: {
                    value: status === 'all' ? null : status,
                    onChange: (next) => {
                        setStatus(next === null ? 'all' : (next as PublishableStatus));
                        setViewing(null);
                    },
                },
            },
            render: (row) => (
                <Badge
                    testID={`${planRowTestId(String(row.id))}-status`}
                    tone={statusTone(row.meta.status)}
                    label={t(statusShortKey(row.meta.status))}
                />
            ),
        },
        {
            key: 'updatedAt',
            label: t('kitchen:list.columnUpdated'),
            width: 160,
            priority: 20,
            value: (row) => updatedText(row),
            sort: (left, right, direction) =>
                compareText(left.meta.updatedAt, right.meta.updatedAt, direction),
            render: (row) => (
                <Text
                    variant="caption"
                    tone="secondary"
                    numberOfLines={2}
                    testID={`${planRowTestId(String(row.id))}-updated`}
                >
                    {updatedText(row)}
                </Text>
            ),
        },
    ];

    const controls = useColumnControls(rows, columns, 'kitchen-plans');
    const failure = toFailure(plans.error);
    const unfiltered = trimmed === '' && status === 'all';

    const statusSegments: readonly CatalogueStatusSegment<StatusSegmentValue>[] = [
        { value: 'all', label: t('kitchen:toolbar.statusAll') },
        ...SEGMENT_STATUSES.map((value) => ({ value, label: t(statusShortKey(value)) })),
    ];

    // The design's three: Shown, Published ("on sale"), Draft ("half-built") — counted over the
    // rows in hand, so a status segment moves them with the list (§3z).
    const published = controls.rows.filter((row) => row.meta.status === 'published').length;
    const drafts = controls.rows.filter((row) => row.meta.status === 'draft').length;
    const cards: readonly CatalogueStatCard[] = [
        {
            key: 'shown',
            label: t('kitchen:list.statShown'),
            value: String(controls.rows.length),
            unit: t('kitchen:list.statShownUnit', { total: total ?? controls.rows.length }),
            caption: unfiltered
                ? t('kitchen:list.statShownUnfiltered')
                : t('kitchen:list.statShownFiltered'),
            mark: 'calendar',
            tone: 'brand',
            onPress: () => {
                setQuery('');
                setStatus('all');
            },
            accessibilityLabel: t('kitchen:list.statShownAction'),
        },
        {
            key: 'published',
            label: t(statusShortKey('published')),
            value: String(published),
            unit: t('kitchen:plans.statPlansUnit'),
            caption: t('kitchen:plans.statPublishedCaption'),
            mark: 'check',
            tone: 'default',
            onPress: () => {
                setStatus('published');
            },
            accessibilityLabel: t(statusShortKey('published')),
        },
        {
            key: 'draft',
            label: t(statusShortKey('draft')),
            value: String(drafts),
            unit: t('kitchen:plans.statPlansUnit'),
            caption: t('kitchen:plans.statDraftCaption'),
            mark: 'eyeOff',
            tone: drafts === 0 ? 'default' : 'warning',
            onPress: () => {
                setStatus('draft');
            },
            accessibilityLabel: t(statusShortKey('draft')),
        },
    ];

    if (viewing !== null) {
        return (
            <RecordViewPage
                testID="kitchen-plans-view"
                onBack={() => {
                    setViewing(null);
                }}
                title={displayName(viewing.name, locale).value}
                kind={t('kitchen:plans.viewKind')}
                status={{
                    label: t(statusShortKey(viewing.meta.status)),
                    tone: statusTone(viewing.meta.status),
                }}
                fields={[
                    {
                        key: 'variants',
                        label: t('kitchen:plans.columnVariants'),
                        value: variantsText(viewing, t),
                    },
                    {
                        key: 'combinations',
                        label: t('kitchen:plans.viewCombinations'),
                        value: t('kitchen:plans.combinationCount', {
                            count: summarisePlanMatrix(viewing).combinations,
                        }),
                    },
                    {
                        key: 'durations',
                        label: t('kitchen:plans.columnDurations'),
                        value: durationsText(viewing, t),
                    },
                    {
                        key: 'prices',
                        label: t('kitchen:plans.columnPrices'),
                        value: pricesText(viewing),
                    },
                    {
                        key: 'updated',
                        label: t('kitchen:list.columnUpdated'),
                        value: formatter.formatRelativeTime(viewing.meta.updatedAt),
                    },
                ]}
                primaryAction={{
                    label: t('kitchen:catalogue.edit'),
                    onPress: () => {
                        openEditor(viewing);
                    },
                }}
            />
        );
    }

    return (
        <Stack space="md" testID="kitchen-plans-screen">
            {plans.isPending || failure !== null ? null : (
                <CatalogueStatCards testID="kitchen-plans-stats" cards={cards} />
            )}

            <CatalogueToolbar<StatusSegmentValue>
                testID="kitchen-plans-toolbar"
                search={query}
                onSearchChange={(next) => {
                    setQuery(next);
                    setViewing(null);
                }}
                searchLabel={t('kitchen:toolbar.searchLabel')}
                statusLabel={t('kitchen:toolbar.statusLabel')}
                statusSegments={statusSegments}
                // Archived, reached from the Status column's own filter, has no segment — the set
                // reads "all" rather than lighting nothing.
                status={status === 'all' || SEGMENT_STATUSES.includes(status) ? status : 'all'}
                onStatusChange={(next) => {
                    setStatus(next);
                    setViewing(null);
                }}
            >
                <ColumnPicker {...controls.picker} />
                {canManage ? (
                    <Button
                        testID="kitchen-plans-toolbar-create"
                        label={t('kitchen:plans.create')}
                        onPress={() => {
                            router.push('/kitchen/plans/new' as never);
                        }}
                    />
                ) : null}
            </CatalogueToolbar>

            {plans.isPending ? (
                <Stack space="xs" testID="kitchen-plans-loading">
                    {Array.from({ length: 5 }, (_, index) => (
                        <Skeleton
                            key={index}
                            testID={`kitchen-plans-skeleton-${String(index + 1)}`}
                            heightClassName="h-row-sm"
                        />
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
            ) : controls.rows.length === 0 ? (
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
                    <CatalogueList<PlanAdmin>
                        testID="kitchen-plans-table"
                        label={t('kitchen:plans.caption')}
                        columns={controls.columns}
                        rows={controls.rows}
                        rowKey={(row) => String(row.id)}
                        density="sm"
                        onRowPress={openEditor}
                        rowActionsLabel={t('kitchen:list.rowActions')}
                        rowActions={(row): readonly MenuItem[] => [
                            {
                                key: 'view',
                                label: t('kitchen:list.view'),
                                icon: CATALOGUE_ROW_ICONS.view,
                                testID: `${planRowTestId(String(row.id))}-view`,
                                onSelect: () => {
                                    setViewing(row);
                                },
                            },
                            {
                                key: 'edit',
                                label: t('kitchen:catalogue.edit'),
                                icon: CATALOGUE_ROW_ICONS.edit,
                                testID: `${planRowTestId(String(row.id))}-open`,
                                onSelect: () => {
                                    openEditor(row);
                                },
                            },
                        ]}
                    />
                    <CataloguePager
                        testID="kitchen-plans-pagination"
                        range={t('kitchen:toolbar.showing', {
                            shown: controls.rows.length,
                            total: total ?? controls.rows.length,
                        })}
                        page={page}
                        totalPages={totalPages}
                        onPageChange={(next) => {
                            setPage(next);
                            setViewing(null);
                        }}
                        label={t('kitchen:catalogue.pagerLabel')}
                    />
                </Stack>
            )}
        </Stack>
    );
}

/** "9 configurations · 1 inactive", or `No configurations`. */
function variantsText(row: PlanAdmin, t: TFunction): string {
    const summary = summarisePlanMatrix(row);
    if (summary.variants === 0) return t('kitchen:plans.noVariants');
    const inactive = summary.variants - summary.activeVariants;
    const count = t('kitchen:plans.variantCount', { count: summary.variants });
    return inactive === 0
        ? count
        : `${count} · ${t('kitchen:plans.inactiveCount', { count: inactive })}`;
}

/** "4 durations", or `No durations`. */
function durationsText(row: PlanAdmin, t: TFunction): string {
    const summary = summarisePlanDurations(row.durations);
    return summary.total === 0
        ? t('kitchen:plans.noDurations')
        : t('kitchen:plans.durationCount', { count: summary.total });
}
