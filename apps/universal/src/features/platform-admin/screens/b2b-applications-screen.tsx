import type {
    PlatformApplicationStatus,
    PlatformB2bApplicationSummary,
} from '@healthy360/api-client/contracts';
import {
    Badge,
    Button,
    Cascade,
    DATA_TABLE_ROW_ICONS,
    DataTable,
    EmptyState,
    ErrorState,
    TableSkeleton,
    Text,
    useToast,
} from '@healthy360/design-system';
import type { DataTableColumn, MenuItem } from '@healthy360/design-system';
import { useFormatter } from '@healthy360/i18n';
import { useRouter } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { Gate, useCan } from '../../../access/gate.tsx';
import { toFailure } from '../../../data/hooks.ts';
import {
    useClaimApplicationMutation,
    usePlatformB2bApplicationsQuery,
} from '../../../data/platform-b2b-hooks.ts';
import { LensBar } from '../../kitchen-admin/catalogue/lens-bar.tsx';
import type { LensFigure, LensTone } from '../../kitchen-admin/catalogue/lens-bar.tsx';
import {
    applicationRowTestId,
    applicationStatusKey,
    applicationStatusTone,
} from '../b2b-review.ts';
import { platformB2bApplicationHref } from '../platform-admin-chrome.tsx';

/**
 * `/platform-admin/b2b` — companies asking to buy wholesale, in the kitchen admin's list look
 * (Platform admin canvas, B2B applications board, 2026-11-23):
 *
 * - **The lens:** All, then one figure per status — Submitted first, because that is the queue a
 *   reviewer picks up from and what the list opens on — the search, the filter in force and
 *   "N of M".
 * - **The table:** Company (name over reference), Country, Submitted, Status and Reviewer. A row
 *   opens the application; its ⋯ menu has Open and, while nobody has picked it up, Claim.
 *
 * Every page is read once and filtered here, as the kitchen list is: the figures then count the
 * queue rather than the page in view. "All" is the server's unfiltered list, which leaves drafts
 * out — an application nobody has submitted is not the platform's yet.
 */
export function PlatformB2bApplicationsScreen() {
    return (
        <Gate
            area="platform-admin"
            requirement={{ allOf: ['b2b_application.view_platform'] }}
            testID="platform-b2b-applications"
        >
            <ApplicationsQueue />
        </Gate>
    );
}

const FILTERS = [
    'all',
    'submitted',
    'in_review',
    'info_requested',
    'approved',
    'declined',
    'withdrawn',
] as const;
type FilterKey = (typeof FILTERS)[number];
type QueueStatus = Exclude<FilterKey, 'all'>;

const FILTER_TONES: Readonly<Record<QueueStatus, LensTone>> = {
    submitted: 'info',
    in_review: 'brand',
    info_requested: 'warning',
    approved: 'success',
    declined: 'danger',
    withdrawn: 'neutral',
};

const REVIEW = 'b2b_application.review_platform';

function ApplicationsQueue() {
    const { t } = useTranslation();
    const router = useRouter();
    const formatter = useFormatter();
    const toast = useToast();
    const canReview = useCan(REVIEW);
    const claim = useClaimApplicationMutation();

    const [filter, setFilter] = useState<FilterKey>('submitted');
    const [search, setSearch] = useState('');

    const applications = usePlatformB2bApplicationsQuery({});
    const { hasNextPage, isFetchingNextPage, fetchNextPage } = applications;
    useEffect(() => {
        if (hasNextPage && !isFetchingNextPage) void fetchNextPage();
    }, [fetchNextPage, hasNextPage, isFetchingNextPage]);

    const all = useMemo(
        () => (applications.data?.pages ?? []).flatMap((page) => page.items),
        [applications.data?.pages],
    );
    const companyOf = (row: PlatformB2bApplicationSummary) =>
        row.legalName ?? row.tradingName ?? t('platformAdmin:b2b.unnamed');
    const rows = useMemo(() => {
        const needle = search.trim().toLowerCase();
        return all.filter(
            (row) =>
                (filter === 'all' || row.status === filter) &&
                (needle === '' ||
                    row.reference.toLowerCase().includes(needle) ||
                    (row.legalName ?? '').toLowerCase().includes(needle) ||
                    (row.tradingName ?? '').toLowerCase().includes(needle)),
        );
    }, [all, filter, search]);

    const pending = applications.isPending;
    const failure = toFailure(applications.error);
    const searched = search.trim() !== '';
    const clearFilters = () => {
        setFilter('all');
        setSearch('');
    };
    const openApplication = (row: PlatformB2bApplicationSummary) => {
        router.push(platformB2bApplicationHref(row.id) as never);
    };
    const statusLabel = (status: PlatformApplicationStatus) => t(applicationStatusKey(status));
    const count = (key: FilterKey) =>
        key === 'all' ? all.length : all.filter((row) => row.status === key).length;
    const dateText = (value: string | null) =>
        value === null ? '—' : formatter.formatDate(value, { dateStyle: 'medium' });

    const figures = FILTERS.map((value, index): LensFigure => ({
        key: value,
        label: value === 'all' ? t('platformAdmin:b2b.tabAll') : statusLabel(value),
        value: pending ? null : count(value),
        ...(value === 'all' ? {} : { tone: FILTER_TONES[value] }),
        separated: index === 1,
        active: filter === value,
        onPress: () => {
            setFilter(value);
        },
    }));

    const columns: readonly DataTableColumn<PlatformB2bApplicationSummary>[] = [
        {
            key: 'company',
            role: 'title',
            label: t('platformAdmin:b2b.column.company'),
            width: 260,
            min: 200,
            grow: true,
            priority: 100,
            value: companyOf,
            render: (row) => (
                <View className="min-w-0 flex-col">
                    <Text
                        variant="bodyStrong"
                        numberOfLines={1}
                        testID={`${applicationRowTestId(row.id)}-name`}
                    >
                        {companyOf(row)}
                    </Text>
                    <Text
                        variant="caption"
                        tone="secondary"
                        numberOfLines={1}
                        className="tabular-nums"
                    >
                        {row.reference}
                    </Text>
                </View>
            ),
        },
        {
            key: 'country',
            role: 'meta',
            label: t('platformAdmin:b2b.column.country'),
            width: 110,
            priority: 60,
            value: (row) => row.countryCode ?? '—',
        },
        {
            key: 'submitted',
            role: 'meta',
            label: t('platformAdmin:b2b.column.submitted'),
            width: 140,
            priority: 70,
            value: (row) => dateText(row.submittedAt),
            render: (row) => (
                <Text tone="secondary" className="tabular-nums">
                    {dateText(row.submittedAt)}
                </Text>
            ),
        },
        {
            key: 'status',
            role: 'status',
            label: t('platformAdmin:b2b.column.status'),
            width: 190,
            priority: 90,
            value: (row) => statusLabel(row.status),
            render: (row) => (
                <Badge
                    testID={`${applicationRowTestId(row.id)}-status`}
                    tone={applicationStatusTone(row.status)}
                    label={statusLabel(row.status)}
                />
            ),
        },
        {
            key: 'reviewer',
            role: 'meta',
            label: t('platformAdmin:b2b.column.reviewer'),
            width: 150,
            priority: 65,
            value: (row) =>
                row.reviewedBy === null
                    ? t('platformAdmin:b2b.unclaimed')
                    : t('platformAdmin:b2b.claimed'),
            render: (row) => (
                <Badge
                    testID={`${applicationRowTestId(row.id)}-reviewer`}
                    tone={row.reviewedBy === null ? 'warning' : 'neutral'}
                    label={
                        row.reviewedBy === null
                            ? t('platformAdmin:b2b.unclaimed')
                            : t('platformAdmin:b2b.claimed')
                    }
                />
            ),
        },
    ];

    const joined = !pending && failure === null && rows.length > 0;
    const filterToken =
        filter === 'all'
            ? null
            : t('platformAdmin:kitchens.groupToken', { group: statusLabel(filter) });

    return (
        <Cascade space="md" testID="platform-b2b-applications-screen">
            <View className={joined ? 'z-10' : 'z-10 gap-4'}>
                <LensBar
                    testID="platform-b2b-applications-toolbar"
                    layout="split"
                    joined={joined}
                    label={t('kitchen:lens.label')}
                    figures={figures}
                    search={search}
                    onSearchChange={setSearch}
                    searchLabel={t('platformAdmin:b2b.searchLabel')}
                    searchPlaceholder={t('platformAdmin:b2b.searchPlaceholder')}
                    tokens={
                        filterToken === null
                            ? []
                            : [
                                  {
                                      key: 'group',
                                      label: filterToken,
                                      removeLabel: t('kitchen:toolbar.removeFilter', {
                                          filter: filterToken,
                                      }),
                                      onRemove: () => {
                                          setFilter('all');
                                      },
                                  },
                              ]
                    }
                    result={
                        pending
                            ? null
                            : t('kitchen:lens.result', { shown: rows.length, total: all.length })
                    }
                    clearLabel={t('kitchen:lens.clear')}
                    {...(filter === 'all' && !searched ? {} : { onClear: clearFilters })}
                />

                {pending ? (
                    <TableSkeleton
                        testID="platform-b2b-applications-loading"
                        partTestID="platform-b2b-applications"
                        rows={4}
                    />
                ) : failure !== null ? (
                    <ErrorState
                        testID="platform-b2b-applications-error"
                        failure={failure}
                        onRetry={() => {
                            void applications.refetch();
                        }}
                        retrying={applications.isFetching}
                    />
                ) : rows.length === 0 ? (
                    <EmptyState
                        testID="platform-b2b-applications-empty"
                        title={t('platformAdmin:b2b.emptyTitle')}
                        body={
                            filter === 'submitted' && !searched
                                ? t('platformAdmin:b2b.emptyQueueBody')
                                : t('platformAdmin:b2b.emptyBody')
                        }
                        {...(filter === 'all' && !searched
                            ? {}
                            : {
                                  actions: (
                                      <Button
                                          testID="platform-b2b-applications-show-all"
                                          size="sm"
                                          variant="secondary"
                                          label={t('platformAdmin:kitchens.showAll')}
                                          onPress={clearFilters}
                                      />
                                  ),
                              })}
                    />
                ) : (
                    <DataTable<PlatformB2bApplicationSummary>
                        testID="platform-b2b-applications-table"
                        joined
                        label={t('platformAdmin:b2b.caption')}
                        columns={columns}
                        rows={rows}
                        rowKey={(row) => row.id}
                        density="sm"
                        onRowPress={openApplication}
                        rowActionsLabel={t('platformAdmin:kitchens.rowActions')}
                        rowActionsLook="desk"
                        rowActions={(row): readonly MenuItem[] => [
                            {
                                key: 'open',
                                label: t('platformAdmin:b2b.openShort'),
                                icon: DATA_TABLE_ROW_ICONS.view,
                                testID: `${applicationRowTestId(row.id)}-open`,
                                onSelect: () => {
                                    openApplication(row);
                                },
                            },
                            ...(canReview && row.status === 'submitted' && row.reviewedBy === null
                                ? [
                                      {
                                          key: 'claim',
                                          label: t('platformAdmin:b2b.actions.claim'),
                                          icon: 'handshake' as const,
                                          testID: `${applicationRowTestId(row.id)}-claim`,
                                          onSelect: () => {
                                              claim.mutate(
                                                  {
                                                      applicationId: row.id,
                                                      lockVersion: row.lockVersion,
                                                  },
                                                  {
                                                      onSuccess: () => {
                                                          toast.show({
                                                              testID: 'platform-b2b-claimed-toast',
                                                              tone: 'success',
                                                              message: t(
                                                                  'platformAdmin:b2b.toast.claimed',
                                                              ),
                                                          });
                                                      },
                                                  },
                                              );
                                          },
                                      },
                                  ]
                                : []),
                        ]}
                    />
                )}
            </View>
        </Cascade>
    );
}
