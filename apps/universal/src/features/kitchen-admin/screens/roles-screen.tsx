import type { OrganisationRoleSummary } from '@healthy360/api-client/contracts';
import { isDeletableRole, isEditableRole } from '@healthy360/api-client/contracts';
import {
    Badge,
    Button,
    EmptyState,
    ErrorState,
    Icon,
    Skeleton,
    Stack,
    Text,
} from '@healthy360/design-system';
import type { MenuItem } from '@healthy360/design-system';
import { useLocale } from '@healthy360/i18n';
import { useRouter } from 'expo-router';
import type { TFunction } from 'i18next';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { Gate, useCan } from '../../../access/gate.tsx';
import { useOrganisationRolesQuery } from '../../../data/access-admin-hooks.ts';
import { toFailure } from '../../../data/hooks.ts';
import { CATALOGUE_ROW_ICONS } from '../catalogue/catalogue-list-item.tsx';
import { CatalogueList } from '../catalogue/catalogue-list.tsx';
import type { CatalogueColumn } from '../catalogue/catalogue-column-spec.ts';
import { CatalogueStatCards } from '../catalogue/catalogue-stat-cards.tsx';
import type { CatalogueStatCard } from '../catalogue/catalogue-stat-cards.tsx';
import { CatalogueToolbar } from '../catalogue/catalogue-toolbar.tsx';
import type { CatalogueStatusSegment } from '../catalogue/catalogue-toolbar.tsx';
import { ColumnPicker } from '../catalogue/column-picker.tsx';
import {
    compareNumber,
    compareText,
    useColumnControls,
} from '../catalogue/use-column-controls.tsx';
import type { ControlledColumn } from '../catalogue/use-column-controls.tsx';
import { ROLE_MANAGE_PERMISSION, ROLE_VIEW_PERMISSION } from '../entity-registry.ts';

/**
 * `/kitchen/roles` — what each job title is allowed to reach (AA1), on the Catalogue list.
 *
 * ```
 * ┌ SHOWN ┐ ┌ THIS KITCHEN'S ┐ ┌ STANDARD ┐ ┌ UNASSIGNED ┐
 * [ ⌕ search ]  [ All | This kitchen's | Standard ]  [ ▦ ]  [ + New role ]
 * ROLE     DESCRIPTION     TYPE     HELD BY     PERMISSIONS     ⧉ ✎
 * ```
 *
 * ## Templates and the kitchen's own are one list with a segment, not two tables
 *
 * The endpoint serves both in one list, because from the *assigning* side they are one set. From the
 * *editing* side they are not: a template is defined by the platform and cannot be changed from
 * inside a tenant — the policy refuses it and the row-level-security policy refuses it again — so
 * those rows offer **Copy** and never Edit. The Type column and the segment say which is which; the
 * row's actions follow from it.
 *
 * Forking a template into a role of your own is the supported way to change what it means inside
 * one kitchen: acceptance prefers a tenant's own role over the template of the same code, so a copy
 * that keeps the code takes its place everywhere.
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

type RoleSegment = 'all' | 'own' | 'templates';

function holdersText(row: OrganisationRoleSummary, t: TFunction): string {
    return row.holderCount === 0
        ? t('accessAdmin:roles.holdersNone')
        : t('accessAdmin:roles.holders', { count: row.holderCount });
}

function kindText(row: OrganisationRoleSummary, t: TFunction): string {
    return row.isSystem ? t('accessAdmin:roles.kindTemplate') : t('accessAdmin:roles.kindOwn');
}

function RolesList() {
    const { t } = useTranslation();
    const { locale } = useLocale();
    const router = useRouter();
    const canManage = useCan(ROLE_MANAGE_PERMISSION);

    const [query, setQuery] = useState('');
    const [segment, setSegment] = useState<RoleSegment>('all');

    const roles = useOrganisationRolesQuery();
    const arabic = locale.startsWith('ar');
    const nameOf = (row: OrganisationRoleSummary) => (arabic ? row.nameAr : row.nameEn);
    const descriptionOf = (row: OrganisationRoleSummary) =>
        arabic ? row.descriptionAr : row.descriptionEn;

    const trimmed = query.trim().toLocaleLowerCase(locale);
    const searched = useMemo(() => {
        const rows = (roles.data ?? []).filter((row) =>
            segment === 'own' ? !row.isSystem : segment === 'templates' ? row.isSystem : true,
        );
        if (trimmed === '') return rows;
        // Both names and the code, whatever the reading language: a manager reading Arabic may type
        // the English title printed on a rota.
        return rows.filter((row) =>
            [row.nameEn, row.nameAr, row.code].some((field) =>
                field.toLocaleLowerCase(locale).includes(trimmed),
            ),
        );
    }, [roles.data, segment, trimmed, locale]);

    const openRole = (row: OrganisationRoleSummary) => {
        router.push(`/kitchen/roles/${String(row.id)}` as never);
    };

    const copyRole = (row: OrganisationRoleSummary) => {
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
            key: 'kind',
            role: 'status',
            badge: true,
            label: t('accessAdmin:roles.columns.kind'),
            width: 110,
            priority: 80,
            value: (row) => kindText(row, t),
            sort: (left, right, direction) =>
                compareText(kindText(left, t), kindText(right, t), direction),
            filter: {
                values: () => [
                    { key: 'own', label: t('accessAdmin:roles.kindOwn') },
                    { key: 'template', label: t('accessAdmin:roles.kindTemplate') },
                ],
                match: (row, value) => (value === 'template') === row.isSystem,
            },
            render: (row) => (
                <Badge
                    testID={`${roleRowTestId(String(row.id))}-kind`}
                    tone={row.isSystem ? 'neutral' : 'success'}
                    // A mark only on the kitchen's own: "Standard" is the resting state, and the
                    // tick is what a reader scanning for editable rows is looking for.
                    icon={row.isSystem ? null : undefined}
                    label={kindText(row, t)}
                />
            ),
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
    const unfiltered = trimmed === '' && segment === 'all' && !controls.filtered;

    const segments: readonly CatalogueStatusSegment<RoleSegment>[] = [
        { value: 'all', label: t('accessAdmin:roles.segmentAll') },
        { value: 'own', label: t('accessAdmin:roles.segmentOwn') },
        { value: 'templates', label: t('accessAdmin:roles.segmentTemplates') },
    ];

    const createRole = () => {
        router.push('/kitchen/roles/new' as never);
    };

    return (
        <Stack space="md" testID="kitchen-roles-screen">
            {roles.isPending || failure !== null ? null : (
                <CatalogueStatCards
                    testID="kitchen-roles-stats"
                    cards={statCards({
                        all: roles.data ?? [],
                        shown: controls.rows.length,
                        unfiltered,
                        t,
                        clear: () => {
                            setQuery('');
                            setSegment('all');
                            controls.clearFilters();
                        },
                        setSegment,
                    })}
                />
            )}

            <CatalogueToolbar<RoleSegment>
                testID="kitchen-roles-toolbar"
                search={query}
                onSearchChange={setQuery}
                searchLabel={t('accessAdmin:roles.searchLabel')}
                searchPlaceholder={t('accessAdmin:roles.searchHint')}
                statusLabel={t('accessAdmin:roles.segmentLabel')}
                statusSegments={segments}
                status={segment}
                onStatusChange={setSegment}
            >
                <ColumnPicker {...controls.picker} />
                {canManage ? (
                    <Button
                        testID="kitchen-roles-create"
                        label={t('accessAdmin:roles.create')}
                        iconStart={<Icon name="plus" size="sm" />}
                        onPress={createRole}
                    />
                ) : null}
            </CatalogueToolbar>

            {roles.isPending ? (
                <Stack space="xs" testID="kitchen-roles-loading">
                    {Array.from({ length: 5 }, (_, index) => (
                        <Skeleton
                            key={index}
                            testID={`kitchen-roles-skeleton-${String(index + 1)}`}
                            heightClassName="h-row-sm"
                        />
                    ))}
                </Stack>
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
                // "No roles of your own" is the one empty state worth its own words: it is the
                // ordinary state of a new kitchen, and the way out is Copy, not New.
                segment === 'own' && trimmed === '' && !controls.filtered ? (
                    <EmptyState
                        testID="kitchen-roles-own-empty"
                        title={t('accessAdmin:roles.emptyTitle')}
                        body={t('accessAdmin:roles.emptyBody')}
                    />
                ) : (
                    <EmptyState
                        testID="kitchen-roles-empty"
                        title={t('accessAdmin:roles.filteredEmptyTitle')}
                        body={t('accessAdmin:roles.filteredEmptyBody')}
                    />
                )
            ) : (
                <CatalogueList<OrganisationRoleSummary>
                    testID="kitchen-roles-table"
                    label={t('accessAdmin:roles.caption')}
                    columns={controls.columns}
                    rows={controls.rows}
                    rowKey={(row) => String(row.id)}
                    density="sm"
                    onRowPress={openRole}
                    rowActionsLabel={t('kitchen:list.rowActions')}
                    rowActions={(row): readonly MenuItem[] => [
                        /*
                         * Copy on a template, Edit on your own. Never both, and never Edit on a
                         * template: the server would answer 404, and offering a door that slams is
                         * worse than not drawing it. Somebody who cannot manage roles gets Open,
                         * which is the read-only editor.
                         */
                        ...(canManage && !isEditableRole(row)
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
                        {
                            key: 'open',
                            label:
                                canManage && isEditableRole(row)
                                    ? t('accessAdmin:roles.edit')
                                    : t('accessAdmin:roles.open'),
                            icon:
                                canManage && isEditableRole(row)
                                    ? CATALOGUE_ROW_ICONS.edit
                                    : CATALOGUE_ROW_ICONS.view,
                            testID: `${roleRowTestId(String(row.id))}-open`,
                            onSelect: () => {
                                openRole(row);
                            },
                        },
                    ]}
                />
            )}
        </Stack>
    );
}

/**
 * Counted over the whole role book, which is all in hand: the list is unpaged. Shown is the one
 * card that follows the search; the other three describe the book, and two of them narrow to it.
 */
function statCards({
    all,
    shown,
    unfiltered,
    t,
    clear,
    setSegment,
}: {
    readonly all: readonly OrganisationRoleSummary[];
    readonly shown: number;
    readonly unfiltered: boolean;
    readonly t: TFunction;
    readonly clear: () => void;
    readonly setSegment: (segment: RoleSegment) => void;
}): readonly CatalogueStatCard[] {
    const own = all.filter((role) => !role.isSystem).length;
    const unheld = all.filter((role) => role.holderCount === 0).length;

    return [
        {
            key: 'shown',
            label: t('kitchen:list.statShown'),
            value: String(shown),
            unit: t('kitchen:list.statShownUnit', { total: all.length }),
            caption: unfiltered
                ? t('kitchen:list.statShownUnfiltered')
                : t('kitchen:list.statShownFiltered'),
            mark: 'list',
            tone: 'brand',
            onPress: clear,
            accessibilityLabel: t('kitchen:list.statShownAction'),
        },
        {
            key: 'own',
            label: t('accessAdmin:roles.statOwn'),
            value: String(own),
            unit: t('accessAdmin:roles.statRoles'),
            caption: t('accessAdmin:roles.statOwnCaption'),
            mark: 'keyRound',
            onPress: () => {
                setSegment('own');
            },
            accessibilityLabel: t('accessAdmin:roles.segmentOwn'),
        },
        {
            key: 'templates',
            label: t('accessAdmin:roles.statTemplates'),
            value: String(all.length - own),
            unit: t('accessAdmin:roles.statRoles'),
            caption: t('accessAdmin:roles.statTemplatesCaption'),
            mark: 'shield',
            onPress: () => {
                setSegment('templates');
            },
            accessibilityLabel: t('accessAdmin:roles.segmentTemplates'),
        },
        {
            key: 'unheld',
            label: t('accessAdmin:roles.statUnheld'),
            value: String(unheld),
            unit: t('accessAdmin:roles.statRoles'),
            caption: t('accessAdmin:roles.statUnheldCaption'),
            mark: 'users',
        },
    ];
}

/** Re-exported so the editor can answer "may Delete be offered" from the same predicate. */
export { isDeletableRole };
