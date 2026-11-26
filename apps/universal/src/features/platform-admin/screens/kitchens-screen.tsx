import type {
    KitchenTenantStatus,
    PlatformKitchenOwner,
    PlatformKitchenSummary,
} from '@healthy360/api-client/contracts';
import { isReactivatable, isTradingStatus } from '@healthy360/api-client/contracts';
import {
    Badge,
    Button,
    Callout,
    Cascade,
    DATA_TABLE_ROW_ICONS,
    DataTable,
    EmptyState,
    ErrorState,
    Icon,
    LensBar,
    TableSkeleton,
    Text,
} from '@healthy360/design-system';
import type { DataTableColumn, LensFigure, LensTone, MenuItem } from '@healthy360/design-system';
import { useFormatter } from '@healthy360/i18n';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { Gate } from '../../../access/gate.tsx';
import { toFailure } from '../../../data/hooks.ts';
import {
    usePlatformKitchenQuery,
    usePlatformKitchensQuery,
} from '../../../data/platform-admin-hooks.ts';
import { useTrailLeaf } from '../../../shell/area-trail.tsx';
import { RecordViewPage } from '../../kitchen-admin/catalogue/record-view-page.tsx';
import { kitchenRowTestId, ownerRowTestId, tenantStatusKey, tenantStatusTone } from '../format.ts';
import {
    EndMembershipDialog,
    InviteOwnerDialog,
    ReactivateKitchenDialog,
    SuspendKitchenDialog,
} from '../kitchen-dialogs.tsx';
import type { KitchenTarget } from '../kitchen-dialogs.tsx';
import { PLATFORM_NEW_KITCHEN_HREF } from '../platform-admin-chrome.tsx';

/**
 * `/platform-admin` — every kitchen on the platform, in the kitchen admin's list look (Platform
 * admin canvas, Kitchens board, 2026-11-23):
 *
 * - **The lens:** All kitchens, then one figure per status, Add a kitchen at the end, the search,
 *   the filter in force and "N of M".
 * - **The table:** Kitchen (name over slug), Status, Owners, Branches and Published. A kitchen with
 *   no owner says so on its row in amber — it is the most actionable thing this list can tell an
 *   operator, and a `0` in a column is how it goes unnoticed for a month. A row opens the kitchen;
 *   its ⋯ menu has View, Invite an owner, and Suspend or Reactivate.
 * - **The kitchen** opens as the record pop-up over the list (`?view=<slug>`), as every admin View
 *   does: its catalogue as figures, its owners and branches as tables, Reactivate or Suspend at
 *   its foot.
 *
 * ## The whole list is read, then filtered here
 *
 * A platform has tens of kitchens, not thousands. Every page is fetched once, so the figures count
 * the platform rather than the page in view, and the status filter and search answer at once.
 *
 * ## The gate is the area's, not this screen's
 *
 * `platform-admin`'s baseline already names `organisation.manage_platform`. The `<Gate>` is here
 * so a direct render in a test refuses the same way the route does.
 */
export function PlatformKitchensScreen() {
    return (
        <Gate area="platform-admin" testID="platform-admin-kitchens">
            <KitchensList />
        </Gate>
    );
}

const FILTERS = ['all', 'active', 'suspended', 'pending', 'closed'] as const;
type FilterKey = (typeof FILTERS)[number];

const FILTER_TONES: Readonly<Record<KitchenTenantStatus, LensTone>> = {
    active: 'success',
    suspended: 'danger',
    pending: 'neutral',
    closed: 'neutral',
};

type KitchenDialog =
    | { readonly kind: 'suspend'; readonly kitchen: KitchenTarget }
    | { readonly kind: 'reactivate'; readonly kitchen: KitchenTarget }
    | { readonly kind: 'invite'; readonly kitchen: KitchenTarget }
    | {
          readonly kind: 'end';
          readonly kitchen: KitchenTarget;
          readonly owner: PlatformKitchenOwner;
          readonly lastOwner: boolean;
      };

function targetOf(kitchen: PlatformKitchenSummary): KitchenTarget {
    return { slug: kitchen.slug, name: kitchen.name, lockVersion: kitchen.lockVersion };
}

function KitchensList() {
    const { t } = useTranslation();
    const router = useRouter();
    const formatter = useFormatter();
    const params = useLocalSearchParams<{ view?: string }>();
    const viewing = typeof params.view === 'string' && params.view !== '' ? params.view : null;

    const [filter, setFilter] = useState<FilterKey>('all');
    const [search, setSearch] = useState('');
    const [dialog, setDialog] = useState<KitchenDialog | null>(null);

    const kitchens = usePlatformKitchensQuery({});
    const { hasNextPage, isFetchingNextPage, fetchNextPage } = kitchens;
    useEffect(() => {
        if (hasNextPage && !isFetchingNextPage) void fetchNextPage();
    }, [fetchNextPage, hasNextPage, isFetchingNextPage]);

    const all = useMemo(
        () => (kitchens.data?.pages ?? []).flatMap((page) => page.items),
        [kitchens.data?.pages],
    );
    const rows = useMemo(() => {
        const needle = search.trim().toLowerCase();
        return all.filter(
            (row) =>
                (filter === 'all' || row.status === filter) &&
                (needle === '' ||
                    row.name.toLowerCase().includes(needle) ||
                    row.slug.toLowerCase().includes(needle)),
        );
    }, [all, filter, search]);

    const pending = kitchens.isPending;
    const failure = toFailure(kitchens.error);
    const unfiltered = filter === 'all' && search.trim() === '';
    const clearFilters = () => {
        setFilter('all');
        setSearch('');
    };
    const open = (slug: string | null) => {
        router.setParams({ view: slug ?? undefined } as never);
    };
    const count = (key: FilterKey) =>
        key === 'all' ? all.length : all.filter((row) => row.status === key).length;
    const filterLabel = (key: Exclude<FilterKey, 'all'>) => t(tenantStatusKey(key));

    const figures = FILTERS.map((value, index): LensFigure => ({
        key: value,
        label: value === 'all' ? t('platformAdmin:kitchens.statAll') : filterLabel(value),
        value: pending ? null : count(value),
        ...(value === 'all' ? {} : { tone: FILTER_TONES[value] }),
        separated: index === 1,
        active: filter === value,
        onPress: () => {
            setFilter(value);
        },
    }));

    const columns: readonly DataTableColumn<PlatformKitchenSummary>[] = [
        {
            key: 'kitchen',
            role: 'title',
            label: t('platformAdmin:kitchens.column.kitchen'),
            width: 260,
            min: 200,
            grow: true,
            priority: 100,
            value: (row) => row.name,
            render: (row) => (
                <View className="min-w-0 flex-col">
                    <Text
                        variant="bodyStrong"
                        numberOfLines={1}
                        testID={`${kitchenRowTestId(row.id)}-name`}
                    >
                        {row.name}
                    </Text>
                    <Text variant="caption" tone="secondary" numberOfLines={1}>
                        {row.slug}
                    </Text>
                </View>
            ),
        },
        {
            key: 'status',
            role: 'status',
            label: t('platformAdmin:kitchens.column.status'),
            width: 140,
            priority: 90,
            value: (row) => t(tenantStatusKey(row.status)),
            render: (row) => (
                <Badge
                    testID={`${kitchenRowTestId(row.id)}-status`}
                    tone={tenantStatusTone(row.status)}
                    label={t(tenantStatusKey(row.status))}
                />
            ),
        },
        {
            key: 'owners',
            role: 'meta',
            label: t('platformAdmin:kitchens.column.owners'),
            width: 150,
            priority: 85,
            value: (row) =>
                row.ownerCount === 0
                    ? t('platformAdmin:kitchens.noOwner')
                    : t('platformAdmin:kitchens.ownerCount', { count: row.ownerCount }),
            render: (row) =>
                row.ownerCount === 0 ? (
                    <Badge
                        testID={`${kitchenRowTestId(row.id)}-no-owner`}
                        tone="warning"
                        label={t('platformAdmin:kitchens.noOwner')}
                    />
                ) : (
                    <Text testID={`${kitchenRowTestId(row.id)}-owners`}>
                        {t('platformAdmin:kitchens.ownerCount', { count: row.ownerCount })}
                    </Text>
                ),
        },
        {
            key: 'branches',
            role: 'meta',
            label: t('platformAdmin:kitchens.column.branches'),
            width: 130,
            priority: 70,
            value: (row) => t('platformAdmin:kitchens.branchCount', { count: row.branchCount }),
            render: (row) => (
                <Text tone="secondary" testID={`${kitchenRowTestId(row.id)}-branches`}>
                    {t('platformAdmin:kitchens.branchCount', { count: row.branchCount })}
                </Text>
            ),
        },
        {
            key: 'catalogue',
            role: 'meta',
            label: t('platformAdmin:kitchens.column.catalogue'),
            width: 130,
            priority: 60,
            value: (row) =>
                t('platformAdmin:kitchens.publishedCount', { count: row.catalogue.published }),
            render: (row) => (
                <Text tone="secondary" testID={`${kitchenRowTestId(row.id)}-published`}>
                    {t('platformAdmin:kitchens.publishedCount', {
                        count: row.catalogue.published,
                    })}
                </Text>
            ),
        },
    ];

    const joined = !pending && failure === null && rows.length > 0;
    const filterToken =
        filter === 'all'
            ? null
            : t('platformAdmin:kitchens.groupToken', { group: filterLabel(filter) });

    return (
        <Cascade space="md" testID="platform-admin-kitchens-screen">
            <View className={joined ? 'z-10' : 'z-10 gap-4'}>
                <LensBar
                    testID="platform-admin-kitchens-toolbar"
                    joined={joined}
                    label={t('kitchen:lens.label')}
                    figures={figures}
                    actions={
                        <Button
                            testID="platform-admin-kitchens-create"
                            size="sm"
                            label={t('platformAdmin:kitchens.create')}
                            iconStart={<Icon name="plus" size="sm" />}
                            onPress={() => {
                                router.push(PLATFORM_NEW_KITCHEN_HREF as never);
                            }}
                        />
                    }
                    search={search}
                    onSearchChange={setSearch}
                    searchLabel={t('platformAdmin:kitchens.searchLabel')}
                    searchPlaceholder={t('platformAdmin:kitchens.searchPlaceholder')}
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
                    {...(unfiltered ? {} : { onClear: clearFilters })}
                />

                {pending ? (
                    <TableSkeleton
                        testID="platform-admin-kitchens-loading"
                        partTestID="platform-admin-kitchens"
                        rows={4}
                    />
                ) : failure !== null ? (
                    <ErrorState
                        testID="platform-admin-kitchens-error"
                        title={t('platformAdmin:kitchens.errorTitle')}
                        failure={failure}
                        onRetry={() => {
                            void kitchens.refetch();
                        }}
                        retrying={kitchens.isFetching}
                    />
                ) : rows.length === 0 ? (
                    <EmptyState
                        testID="platform-admin-kitchens-empty"
                        title={t('platformAdmin:kitchens.emptyTitle')}
                        {...(unfiltered
                            ? {}
                            : {
                                  actions: (
                                      <Button
                                          testID="platform-admin-kitchens-empty-clear"
                                          size="sm"
                                          variant="secondary"
                                          label={t('platformAdmin:kitchens.showAll')}
                                          onPress={clearFilters}
                                      />
                                  ),
                              })}
                    />
                ) : (
                    <DataTable<PlatformKitchenSummary>
                        testID="platform-admin-kitchens-table"
                        joined
                        label={t('platformAdmin:kitchens.caption')}
                        columns={columns}
                        rows={rows}
                        rowKey={(row) => String(row.id)}
                        density="sm"
                        onRowPress={(row) => {
                            open(row.slug);
                        }}
                        rowActionsLabel={t('platformAdmin:kitchens.rowActions')}
                        rowActions={(row): readonly MenuItem[] => [
                            {
                                key: 'view',
                                label: t('platformAdmin:kitchens.view'),
                                icon: DATA_TABLE_ROW_ICONS.view,
                                testID: `${kitchenRowTestId(row.id)}-view`,
                                onSelect: () => {
                                    open(row.slug);
                                },
                            },
                            {
                                key: 'invite',
                                label: t('platformAdmin:invite.title'),
                                icon: 'send',
                                testID: `${kitchenRowTestId(row.id)}-invite`,
                                onSelect: () => {
                                    setDialog({ kind: 'invite', kitchen: targetOf(row) });
                                },
                            },
                            ...(isReactivatable(row.status)
                                ? [
                                      {
                                          key: 'reactivate',
                                          label: t('platformAdmin:lifecycle.reactivate'),
                                          icon: 'play' as const,
                                          testID: `${kitchenRowTestId(row.id)}-reactivate`,
                                          onSelect: () => {
                                              setDialog({
                                                  kind: 'reactivate',
                                                  kitchen: targetOf(row),
                                              });
                                          },
                                      },
                                  ]
                                : []),
                            ...(isTradingStatus(row.status)
                                ? [
                                      {
                                          key: 'suspend',
                                          label: t('platformAdmin:lifecycle.suspend'),
                                          icon: 'pause' as const,
                                          tone: 'danger' as const,
                                          testID: `${kitchenRowTestId(row.id)}-suspend`,
                                          onSelect: () => {
                                              setDialog({
                                                  kind: 'suspend',
                                                  kitchen: targetOf(row),
                                              });
                                          },
                                      },
                                  ]
                                : []),
                        ]}
                    />
                )}
            </View>

            {viewing === null ? null : (
                <KitchenSheet
                    slug={viewing}
                    onClose={() => {
                        open(null);
                    }}
                    onDialog={setDialog}
                    formatDate={(value) => formatter.formatDate(value, { dateStyle: 'medium' })}
                />
            )}

            {dialog === null ? null : dialog.kind === 'suspend' ? (
                <SuspendKitchenDialog
                    kitchen={dialog.kitchen}
                    onClose={() => {
                        setDialog(null);
                    }}
                />
            ) : dialog.kind === 'reactivate' ? (
                <ReactivateKitchenDialog
                    kitchen={dialog.kitchen}
                    onClose={() => {
                        setDialog(null);
                    }}
                />
            ) : dialog.kind === 'invite' ? (
                <InviteOwnerDialog
                    kitchen={dialog.kitchen}
                    onClose={() => {
                        setDialog(null);
                    }}
                />
            ) : (
                <EndMembershipDialog
                    kitchen={dialog.kitchen}
                    owner={dialog.owner}
                    lastOwner={dialog.lastOwner}
                    onClose={() => {
                        setDialog(null);
                    }}
                />
            )}
        </Cascade>
    );
}

/**
 * One kitchen as the record pop-up (option A, no canopy): its name, status and region; the
 * catalogue as five figures; its owners and branches as tables; Reactivate or Suspend at its foot.
 * Read by slug, so a link to `?view=<slug>` opens it whether or not its row is loaded.
 */
function KitchenSheet({
    slug,
    onClose,
    onDialog,
    formatDate,
}: {
    readonly slug: string;
    readonly onClose: () => void;
    readonly onDialog: (dialog: KitchenDialog) => void;
    readonly formatDate: (value: string) => string;
}) {
    const { t } = useTranslation();
    const kitchen = usePlatformKitchenQuery(slug);
    const record = kitchen.data;
    useTrailLeaf(record?.name ?? null, onClose);
    // A stale link — a slug that names nothing — closes rather than holding an empty pop-up.
    const gone = kitchen.isError;
    useEffect(() => {
        if (gone) onClose();
    }, [gone, onClose]);

    // The list stays readable under a record that is still loading.
    if (record === undefined) return null;

    const testID = 'platform-admin-kitchen';
    const target = targetOf(record);
    const owners = record.owners;

    const ownerColumns: readonly DataTableColumn<PlatformKitchenOwner>[] = [
        {
            key: 'person',
            role: 'title',
            label: t('platformAdmin:owners.column.person'),
            width: 200,
            grow: true,
            priority: 100,
            value: (owner) => owner.name ?? t('platformAdmin:owners.unnamed'),
            render: (owner) => (
                <Text
                    variant="bodyStrong"
                    numberOfLines={1}
                    testID={`${ownerRowTestId(owner.membershipId)}-name`}
                >
                    {owner.name ?? t('platformAdmin:owners.unnamed')}
                </Text>
            ),
        },
        {
            key: 'email',
            role: 'meta',
            label: t('platformAdmin:owners.column.email'),
            width: 240,
            grow: true,
            priority: 90,
            value: (owner) => owner.email,
            render: (owner) => (
                <Text
                    tone="secondary"
                    numberOfLines={1}
                    testID={`${ownerRowTestId(owner.membershipId)}-email`}
                >
                    {owner.email}
                </Text>
            ),
        },
        {
            key: 'status',
            role: 'status',
            label: t('platformAdmin:owners.column.status'),
            width: 120,
            priority: 80,
            value: (owner) => t(`platformAdmin:owners.status.${owner.status}`, owner.status),
            render: (owner) => (
                <Badge
                    testID={`${ownerRowTestId(owner.membershipId)}-status`}
                    tone="success"
                    label={t(`platformAdmin:owners.status.${owner.status}`, owner.status)}
                />
            ),
        },
    ];

    const branchColumns: readonly DataTableColumn<(typeof record.branches)[number]>[] = [
        {
            key: 'name',
            role: 'title',
            label: t('platformAdmin:detail.branchColumn.name'),
            width: 200,
            grow: true,
            priority: 100,
            value: (branch) => branch.name,
        },
        {
            key: 'city',
            role: 'meta',
            label: t('platformAdmin:detail.branchColumn.city'),
            width: 160,
            priority: 80,
            value: (branch) => branch.city ?? t('platformAdmin:detail.noCity'),
        },
        {
            key: 'timezone',
            role: 'meta',
            label: t('platformAdmin:detail.branchColumn.timezone'),
            width: 160,
            priority: 70,
            value: (branch) => branch.timezone,
        },
        {
            key: 'status',
            role: 'status',
            label: t('platformAdmin:detail.branchColumn.status'),
            width: 110,
            priority: 90,
            value: (branch) => t(`platformAdmin:detail.branchStatus.${branch.status}`),
            render: (branch) => (
                <Badge
                    tone={branch.status === 'active' ? 'success' : 'neutral'}
                    label={t(`platformAdmin:detail.branchStatus.${branch.status}`)}
                />
            ),
        },
    ];

    const catalogueFigure = (key: string, label: string, value: number) => ({
        key,
        label,
        value: String(value),
    });

    return (
        <RecordViewPage
            look="sheet"
            testID={testID}
            onBack={onClose}
            eyebrow={t('platformAdmin:detail.kind')}
            title={record.name}
            kind={t('platformAdmin:kitchens.branchCount', { count: record.branchCount })}
            status={{
                label: t(tenantStatusKey(record.status)),
                tone: tenantStatusTone(record.status),
            }}
            statusLines={[`${record.slug} · ${record.countryCode} · ${record.currencyCode}`]}
            headIcon="store"
            figureKeys={['meals', 'products', 'plans', 'published', 'draft']}
            fields={[
                catalogueFigure(
                    'meals',
                    t('platformAdmin:detail.catalogueMeals'),
                    record.catalogue.meals,
                ),
                catalogueFigure(
                    'products',
                    t('platformAdmin:detail.catalogueProducts'),
                    record.catalogue.products,
                ),
                catalogueFigure(
                    'plans',
                    t('platformAdmin:detail.cataloguePlans'),
                    record.catalogue.plans,
                ),
                catalogueFigure(
                    'published',
                    t('platformAdmin:detail.cataloguePublished'),
                    record.catalogue.published,
                ),
                catalogueFigure(
                    'draft',
                    t('platformAdmin:detail.catalogueDraft'),
                    record.catalogue.draft,
                ),
            ]}
            banner={
                record.status === 'suspended' ? (
                    <Callout
                        testID={`${testID}-suspended`}
                        tone="danger"
                        icon="pause"
                        title={t('platformAdmin:detail.suspendedTitle')}
                        body={[
                            record.suspendedAt === null
                                ? null
                                : t('platformAdmin:detail.suspendedOn', {
                                      date: formatDate(record.suspendedAt),
                                  }),
                            record.suspensionReason ?? t('platformAdmin:detail.suspendedNoReason'),
                        ]
                            .filter((part): part is string => part !== null)
                            .join(' · ')}
                    />
                ) : record.status === 'closed' ? (
                    <Callout
                        testID={`${testID}-closed-note`}
                        tone="info"
                        icon="lock"
                        title={t('platformAdmin:lifecycle.closedTitle')}
                        body={t('platformAdmin:lifecycle.closedNote')}
                    />
                ) : undefined
            }
            linesWide
            linesTitle={t('platformAdmin:owners.title')}
            linesCount={
                owners.length === 0
                    ? undefined
                    : t('platformAdmin:kitchens.ownerCount', { count: owners.length })
            }
            lines={
                owners.length === 0 ? (
                    <Callout
                        testID={`${testID}-owners-empty`}
                        tone="warning"
                        icon="warning"
                        title={t('platformAdmin:owners.emptyTitle')}
                        body={t('platformAdmin:owners.emptyBody')}
                        actions={
                            <Button
                                testID={`${testID}-owners-invite`}
                                size="sm"
                                label={t('platformAdmin:invite.title')}
                                onPress={() => {
                                    onDialog({ kind: 'invite', kitchen: target });
                                }}
                            />
                        }
                    />
                ) : (
                    <View className="overflow-hidden rounded-[14px] border border-stroke-subtle">
                        <DataTable<PlatformKitchenOwner>
                            testID={`${testID}-owners-table`}
                            label={t('platformAdmin:owners.title')}
                            columns={ownerColumns}
                            rows={owners}
                            rowKey={(owner) => String(owner.membershipId)}
                            density="sm"
                            rowEntrance={false}
                            joined
                            rowActionsLabel={t('platformAdmin:kitchens.rowActions')}
                            rowActions={(owner): readonly MenuItem[] => [
                                {
                                    key: 'revoke',
                                    label: t('platformAdmin:owners.revoke'),
                                    icon: 'close',
                                    tone: 'danger',
                                    testID: `${ownerRowTestId(owner.membershipId)}-revoke`,
                                    onSelect: () => {
                                        onDialog({
                                            kind: 'end',
                                            kitchen: target,
                                            owner,
                                            lastOwner: owners.length === 1,
                                        });
                                    },
                                },
                            ]}
                        />
                    </View>
                )
            }
            sections={[
                {
                    key: 'branches',
                    title: t('platformAdmin:detail.branchesTitle'),
                    content: (
                        <View className="overflow-hidden rounded-[14px] border border-stroke-subtle">
                            <DataTable
                                testID={`${testID}-branches-table`}
                                label={t('platformAdmin:detail.branchesTitle')}
                                columns={branchColumns}
                                rows={record.branches}
                                rowKey={(branch) => String(branch.id)}
                                density="sm"
                                rowEntrance={false}
                                joined
                                rowActionsLabel={t('platformAdmin:kitchens.rowActions')}
                            />
                        </View>
                    ),
                },
            ]}
            {...(isReactivatable(record.status)
                ? {
                      primaryAction: {
                          testID: `${testID}-reactivate`,
                          label: t('platformAdmin:lifecycle.reactivate'),
                          icon: 'play' as const,
                          onPress: () => {
                              onDialog({ kind: 'reactivate', kitchen: target });
                          },
                      },
                  }
                : record.status === 'closed'
                  ? {}
                  : {
                        primaryAction: {
                            testID: `${testID}-invite`,
                            label: t('platformAdmin:invite.title'),
                            icon: 'send' as const,
                            onPress: () => {
                                onDialog({ kind: 'invite', kitchen: target });
                            },
                        },
                    })}
            {...(isTradingStatus(record.status)
                ? {
                      actions: [
                          {
                              key: 'suspend',
                              label: t('platformAdmin:lifecycle.suspend'),
                              icon: 'pause' as const,
                              tone: 'danger' as const,
                              testID: `${testID}-suspend`,
                              onSelect: () => {
                                  onDialog({ kind: 'suspend', kitchen: target });
                              },
                          },
                      ],
                  }
                : {})}
        />
    );
}
