import type { OrganisationRoleSummary } from '@healthy360/api-client/contracts';
import { isDeletableRole } from '@healthy360/api-client/contracts';
import {
    Button,
    Cascade,
    EmptyState,
    ErrorState,
    Icon,
    TableSkeleton,
    Text,
} from '@healthy360/design-system';
import type { MenuItem } from '@healthy360/design-system';
import { useLocale } from '@healthy360/i18n';
import { useRouter } from 'expo-router';
import type { TFunction } from 'i18next';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { Gate, useCan } from '../../../access/gate.tsx';
import {
    useIsBranchBoundAdmin,
    useOrganisationRolesQuery,
} from '../../../data/access-admin-hooks.ts';
import { toFailure } from '../../../data/hooks.ts';
import { CATALOGUE_ROW_ICONS } from '../catalogue/catalogue-list-item.tsx';
import { CatalogueList } from '../catalogue/catalogue-list.tsx';
import type { CatalogueColumn } from '../catalogue/catalogue-column-spec.ts';
import { ColumnPicker } from '../catalogue/column-picker.tsx';
import { LensBar } from '../catalogue/lens-bar.tsx';
import type { LensFigure } from '../catalogue/lens-bar.tsx';
import {
    compareNumber,
    compareText,
    useColumnControls,
} from '../catalogue/use-column-controls.tsx';
import type { ControlledColumn } from '../catalogue/use-column-controls.tsx';
import { ROLE_MANAGE_PERMISSION, ROLE_VIEW_PERMISSION } from '../entity-registry.ts';
import { useListMemory, useRememberedOpened, useRememberedQuery } from '../list-memory.ts';

/**
 * `/kitchen/roles` — what each job title is allowed to reach (AA1), on the Catalogue list.
 *
 * ```
 * All roles 9 │ ○ Unassigned 2                                              [ + New role ]
 * [ ⌕ search                                   ]                          9 of 9 │ ▦
 * ROLE     DESCRIPTION     HELD BY     PERMISSIONS     ⧉ ✎
 * ```
 *
 * ## Every role is the kitchen's own
 *
 * Each kitchen holds its own copy of every standard role, made when the kitchen was created, so
 * every row here is editable — owner and chef included — and editing one changes nothing for any
 * other kitchen. Copy stays as a second action: it is how a kitchen starts a new role from an
 * existing one.
 *
 * A role is shared by every branch, so an administrator bound to one branch sees the book
 * read-only (`useIsBranchBoundAdmin`) — the server refuses their writes too.
 *
 * ## Search is client-side
 *
 * The roles endpoint is unpaged — a kitchen's role book is a bounded set — so the search covers the
 * English name, the Arabic name and the code of every role, not one page of them.
 *
 * ## `holderCount` is on the row, so Delete can be honest before it is pressed
 *
 * Deleting a role somebody holds is refused, because `membership_roles` cascades and the database
 * would take it away from six people without a word. The count arrives with the list, so the editor
 * can disable the control with a reason rather than offer it and then be refused.
 */

export function RolesScreen() {
    return (
        <Gate area="kitchen" requirement={{ allOf: [ROLE_VIEW_PERMISSION] }} testID="kitchen-roles">
            <RolesList />
        </Gate>
    );
}

export function roleRowTestId(roleId: string): string {
    return `kitchen-roles-row-${roleId}`;
}

function holdersText(row: OrganisationRoleSummary, t: TFunction): string {
    return row.holderCount === 0
        ? t('accessAdmin:roles.holdersNone')
        : t('accessAdmin:roles.holders', { count: row.holderCount });
}

function RolesList() {
    const { t } = useTranslation();
    const { locale } = useLocale();
    const router = useRouter();
    const branchBound = useIsBranchBoundAdmin();
    const canManage = useCan(ROLE_MANAGE_PERMISSION) && !branchBound;

    // Search, page and the role last opened survive leaving the list for a role.
    const memory = useListMemory('kitchen.roles');
    const [query, setQuery] = useRememberedQuery(memory);
    const [lastOpenedId, rememberOpened] = useRememberedOpened(memory);

    const roles = useOrganisationRolesQuery();
    const arabic = locale.startsWith('ar');
    const nameOf = (row: OrganisationRoleSummary) => (arabic ? row.nameAr : row.nameEn);
    const descriptionOf = (row: OrganisationRoleSummary) =>
        arabic ? row.descriptionAr : row.descriptionEn;

    const trimmed = query.trim().toLocaleLowerCase(locale);
    const searched = useMemo(() => {
        const rows = roles.data ?? [];
        if (trimmed === '') return rows;
        // Both names and the code, whatever the reading language: a manager reading Arabic may type
        // the English title printed on a rota.
        return rows.filter((row) =>
            [row.nameEn, row.nameAr, row.code].some((field) =>
                field.toLocaleLowerCase(locale).includes(trimmed),
            ),
        );
    }, [roles.data, trimmed, locale]);

    const openRole = (row: OrganisationRoleSummary) => {
        rememberOpened(String(row.id));
        router.push(`/kitchen/roles/${String(row.id)}` as never);
    };

    const copyRole = (row: OrganisationRoleSummary) => {
        rememberOpened(String(row.id));
        router.push(`/kitchen/roles/new?from=${encodeURIComponent(String(row.id))}` as never);
    };

    const columns: readonly ControlledColumn<
        OrganisationRoleSummary,
        CatalogueColumn<OrganisationRoleSummary>
    >[] = [
        {
            key: 'role',
            role: 'title',
            label: t('accessAdmin:roles.columns.role'),
            width: 240,
            priority: 100,
            value: nameOf,
            sort: (left, right, direction) => compareText(nameOf(left), nameOf(right), direction),
            render: (row) => {
                const testID = roleRowTestId(String(row.id));
                return (
                    <View testID={testID} className="min-w-0 flex-row items-center">
                        <Text variant="strong" numberOfLines={1} testID={`${testID}-name`}>
                            {nameOf(row)}
                        </Text>
                    </View>
                );
            },
        },
        {
            key: 'description',
            role: 'meta',
            label: t('accessAdmin:roles.columns.description'),
            width: 280,
            min: 180,
            priority: 50,
            value: (row) => descriptionOf(row) ?? t('accessAdmin:roles.noDescription'),
            render: (row) => {
                const description = descriptionOf(row);
                return (
                    <Text
                        tone="secondary"
                        numberOfLines={2}
                        testID={`${roleRowTestId(String(row.id))}-description`}
                    >
                        {description ?? t('accessAdmin:roles.noDescription')}
                    </Text>
                );
            },
        },
        {
            key: 'holders',
            role: 'metric',
            label: t('accessAdmin:roles.columns.holders'),
            width: 120,
            priority: 85,
            value: (row) => holdersText(row, t),
            sort: (left, right, direction) =>
                compareNumber(left.holderCount, right.holderCount, direction),
            render: (row) => (
                <Text
                    testID={`${roleRowTestId(String(row.id))}-holders`}
                    tone={row.holderCount === 0 ? 'secondary' : 'primary'}
                >
                    {holdersText(row, t)}
                </Text>
            ),
        },
        {
            key: 'permissions',
            role: 'meta',
            label: t('accessAdmin:roles.columns.pages'),
            width: 130,
            priority: 60,
            value: (row) => t('accessAdmin:roles.permissionCount', { count: row.permissionCount }),
            sort: (left, right, direction) =>
                compareNumber(left.permissionCount, right.permissionCount, direction),
            render: (row) => (
                <Text testID={`${roleRowTestId(String(row.id))}-permissions`}>
                    {t('accessAdmin:roles.permissionCount', { count: row.permissionCount })}
                </Text>
            ),
        },
    ];

    const controls = useColumnControls(searched, columns, 'kitchen-roles');
    const failure = toFailure(roles.error);
    const unfiltered = trimmed === '' && !controls.filtered;

    const createRole = () => {
        router.push('/kitchen/roles/new' as never);
    };

    return (
        <Cascade space="md" testID="kitchen-roles-screen">
            <LensBar
                testID="kitchen-roles-toolbar"
                label={t('kitchen:lens.label')}
                figures={lensFigures(roles.data, roles.isPending, t)}
                search={query}
                onSearchChange={setQuery}
                searchLabel={t('accessAdmin:roles.searchLabel')}
                searchPlaceholder={t('accessAdmin:roles.searchHint')}
                result={
                    roles.isPending
                        ? null
                        : failure !== null
                          ? t('kitchen:list.noValue')
                          : t('kitchen:lens.result', {
                                shown: controls.rows.length,
                                total: roles.data?.length ?? 0,
                            })
                }
                clearLabel={t('kitchen:lens.clear')}
                {...(unfiltered
                    ? {}
                    : {
                          onClear: () => {
                              setQuery('');
                              controls.clearFilters();
                          },
                      })}
                trailing={(narrow) => <ColumnPicker {...controls.picker} compact={narrow} />}
                actions={
                    canManage ? (
                        <Button
                            testID="kitchen-roles-create"
                            label={t('accessAdmin:roles.create')}
                            iconStart={<Icon name="plus" size="sm" />}
                            onPress={createRole}
                        />
                    ) : undefined
                }
            />

            {roles.isPending ? (
                <TableSkeleton testID="kitchen-roles-loading" partTestID="kitchen-roles" />
            ) : failure !== null ? (
                <ErrorState
                    testID="kitchen-roles-error"
                    failure={failure}
                    onRetry={() => {
                        void roles.refetch();
                    }}
                    retrying={roles.isFetching}
                />
            ) : controls.rows.length === 0 ? (
                <EmptyState
                    testID="kitchen-roles-empty"
                    title={t('accessAdmin:roles.filteredEmptyTitle')}
                    body={t('accessAdmin:roles.filteredEmptyBody')}
                />
            ) : (
                <CatalogueList<OrganisationRoleSummary>
                    testID="kitchen-roles-table"
                    label={t('accessAdmin:roles.caption')}
                    columns={controls.columns}
                    rows={controls.rows}
                    rowKey={(row) => String(row.id)}
                    density="sm"
                    highlightedId={lastOpenedId}
                    initialPage={memory.initial.page}
                    onPageChange={(page) => {
                        memory.remember({ page });
                    }}
                    onRowPress={openRole}
                    rowActionsLabel={t('kitchen:list.rowActions')}
                    rowActions={(row): readonly MenuItem[] => [
                        /*
                         * Edit on every role for somebody who may manage them; Open — the
                         * read-only editor — for everybody else. Copy starts a new role from
                         * this one.
                         */
                        {
                            key: 'open',
                            label: canManage
                                ? t('accessAdmin:roles.edit')
                                : t('accessAdmin:roles.open'),
                            icon: canManage ? CATALOGUE_ROW_ICONS.edit : CATALOGUE_ROW_ICONS.view,
                            testID: `${roleRowTestId(String(row.id))}-open`,
                            onSelect: () => {
                                openRole(row);
                            },
                        },
                        ...(canManage
                            ? [
                                  {
                                      key: 'copy',
                                      label: t('accessAdmin:roles.copy'),
                                      icon: 'layers' as const,
                                      testID: `${roleRowTestId(String(row.id))}-copy`,
                                      onSelect: () => {
                                          copyRole(row);
                                      },
                                  },
                              ]
                            : []),
                    ]}
                />
            )}
        </Cascade>
    );
}

/**
 * Counted over the whole role book, which is all in hand: the list is unpaged. A failed read counts
 * nothing, so its figures are dashes rather than zeros.
 */
function lensFigures(
    all: readonly OrganisationRoleSummary[] | undefined,
    pending: boolean,
    t: TFunction,
): readonly LensFigure[] {
    const figure = (count: (roles: readonly OrganisationRoleSummary[]) => number) =>
        pending
            ? { value: null }
            : all === undefined
              ? { value: 0, display: t('kitchen:list.noValue') }
              : { value: count(all) };

    return [
        {
            key: 'all',
            label: t('kitchen:lens.allRoles'),
            ...figure((roles) => roles.length),
        },
        {
            key: 'unheld',
            label: t('accessAdmin:roles.statUnheld'),
            ...figure((roles) => roles.filter((role) => role.holderCount === 0).length),
            tone: 'neutral',
            separated: true,
        },
    ];
}

/** Re-exported so the editor can answer "may Delete be offered" from the same predicate. */
export { isDeletableRole };
