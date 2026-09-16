import type { OrganisationRoleSummary } from '@healthy360/api-client/contracts';
import { isDeletableRole, isEditableRole } from '@healthy360/api-client/contracts';
import {
    Button,
    Card,
    EmptyState,
    ErrorState,
    Heading,
    Inline,
    Skeleton,
    Stack,
    Table,
    Text,
} from '@healthy360/design-system';
import type { TableColumn } from '@healthy360/design-system';
import { useLocale } from '@healthy360/i18n';
import { useRouter } from 'expo-router';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { Gate, useCan } from '../../../access/gate.tsx';
import { useOrganisationRolesQuery } from '../../../data/access-admin-hooks.ts';
import { toFailure } from '../../../data/hooks.ts';
import { ROLE_MANAGE_PERMISSION, ROLE_VIEW_PERMISSION } from '../entity-registry.ts';
import { KitchenPageHeader } from '../kitchen-page-header.tsx';

/**
 * `/kitchen/roles` — what each job title is allowed to reach (AA1).
 *
 * ## Two sections, because they are edited differently
 *
 * The endpoint serves templates and the kitchen's own in one list, because from the *assigning* side
 * they are one set. This screen splits them, because from the *editing* side they are not: a
 * template is defined by the platform and cannot be changed from inside a tenant — the policy
 * refuses it and the row-level-security policy refuses it again — so those rows offer **Copy** and
 * never Edit.
 *
 * That is not a limitation being worked around. Forking a template into a role of your own is the
 * supported way to change what it means inside one kitchen: acceptance prefers a tenant's own role
 * over the template of the same code, so a copy that keeps the code takes its place everywhere.
 *
 * ## `holderCount` is on the row, so Delete can be honest before it is pressed
 *
 * Deleting a role somebody holds is refused, because `membership_roles` cascades and the database
 * would take it away from six people without a word. The count arrives with the list, so the control
 * is disabled with a reason rather than offered and then refused.
 */

export function RolesScreen() {
    return (
        <Gate
            area="kitchen"
            requirement={{ allOf: [ROLE_VIEW_PERMISSION] }}
            testID="kitchen-roles"
        >
            <RolesList />
        </Gate>
    );
}

export function roleRowTestId(roleId: string): string {
    return `kitchen-roles-row-${roleId}`;
}

function RolesList() {
    const { t } = useTranslation();
    const { locale } = useLocale();
    const router = useRouter();
    const canManage = useCan(ROLE_MANAGE_PERMISSION);

    const roles = useOrganisationRolesQuery();

    const { templates, own } = useMemo(() => {
        const rows = roles.data ?? [];
        return {
            templates: rows.filter((role) => role.isSystem),
            own: rows.filter((role) => !role.isSystem),
        };
    }, [roles.data]);

    // One set for both sections: the columns say the same things about a template and about a
    // role you wrote. What differs is the action, which is why that is a function and this is not.
    const columns: readonly TableColumn<OrganisationRoleSummary>[] = [
        {
            key: 'role',
            header: t('accessAdmin:roles.columns.role'),
            rowHeader: true,
            flex: 2,
            render: (row) => {
                const testID = roleRowTestId(String(row.id));
                const description = locale.startsWith('ar')
                    ? row.descriptionAr
                    : row.descriptionEn;

                return (
                    <Stack space="none">
                        <Text variant="bodyStrong" testID={`${testID}-name`}>
                            {locale.startsWith('ar') ? row.nameAr : row.nameEn}
                        </Text>
                        <Text variant="caption" tone="secondary" testID={`${testID}-code`}>
                            {description ?? row.code}
                        </Text>
                    </Stack>
                );
            },
        },
        {
            key: 'holders',
            header: t('accessAdmin:roles.columns.holders'),
            numeric: true,
            render: (row) => (
                <Text
                    testID={`${roleRowTestId(String(row.id))}-holders`}
                    tone={row.holderCount === 0 ? 'secondary' : 'primary'}
                >
                    {row.holderCount === 0
                        ? t('accessAdmin:roles.holdersNone')
                        : t('accessAdmin:roles.holders', { count: row.holderCount })}
                </Text>
            ),
        },
        {
            key: 'permissions',
            header: t('accessAdmin:roles.columns.pages'),
            numeric: true,
            render: (row) => (
                <Text testID={`${roleRowTestId(String(row.id))}-permissions`}>
                    {t('accessAdmin:roles.permissionCount', { count: row.permissionCount })}
                </Text>
            ),
        },
    ];

    // A function because the action differs per row, not per section: Copy is offered on a template
    // and Edit on a role you wrote, and the row itself is what says which it is.
    const rowAction = () => ({
        header: t('kitchen:list.actionHeader'),
        render: (row: OrganisationRoleSummary) => (
            <Inline space="xs" wrap justify="end">
                {/*
                 * Copy on a template, Edit on your own. Never both, and never Edit on a template:
                 * the server would answer 404, and offering a door that slams is worse than not
                 * drawing it.
                 */}
                {canManage && !isEditableRole(row) ? (
                    <Button
                        testID={`${roleRowTestId(String(row.id))}-copy`}
                        size="sm"
                        variant="secondary"
                        label={t('accessAdmin:roles.copy')}
                        onPress={() => {
                            router.push(
                                `/kitchen/roles/new?from=${encodeURIComponent(String(row.id))}` as never,
                            );
                        }}
                    />
                ) : null}
                <Button
                    testID={`${roleRowTestId(String(row.id))}-open`}
                    size="sm"
                    variant="secondary"
                    label={
                        canManage && isEditableRole(row)
                            ? t('accessAdmin:roles.edit')
                            : t('accessAdmin:roles.open')
                    }
                    onPress={() => {
                        router.push(`/kitchen/roles/${String(row.id)}` as never);
                    }}
                />
            </Inline>
        ),
    });

    const failure = toFailure(roles.error);

    return (
        <Stack space="lg" testID="kitchen-roles-screen">
            <KitchenPageHeader
                testID="kitchen-roles-header"
                title={t('accessAdmin:roles.title')}
                subtitle={t('accessAdmin:roles.subtitle')}
                titleTestID="kitchen-roles-title"
                subtitleTestID="kitchen-roles-subtitle"
            />

            {canManage ? (
                <Inline space="sm" justify="end" wrap testID="kitchen-roles-toolbar">
                    <Button
                        testID="kitchen-roles-create"
                        label={t('accessAdmin:roles.create')}
                        onPress={() => {
                            router.push('/kitchen/roles/new' as never);
                        }}
                    />
                </Inline>
            ) : null}

            {roles.isPending ? (
                <Stack space="sm" testID="kitchen-roles-loading">
                    {Array.from({ length: 4 }, (_, index) => (
                        <Card key={index} padding="md">
                            <Skeleton
                                testID={`kitchen-roles-skeleton-${String(index + 1)}`}
                                heightClassName="h-5"
                            />
                        </Card>
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
            ) : (
                <Stack space="lg">
                    <Stack space="sm" testID="kitchen-roles-own-section">
                        <Stack space="none">
                            <Heading level={2}>{t('accessAdmin:roles.ownHeading')}</Heading>
                            <Text tone="secondary">{t('accessAdmin:roles.ownHint')}</Text>
                        </Stack>

                        {own.length === 0 ? (
                            <EmptyState
                                testID="kitchen-roles-own-empty"
                                title={t('accessAdmin:roles.emptyTitle')}
                                body={t('accessAdmin:roles.emptyBody')}
                            />
                        ) : (
                            <Table<OrganisationRoleSummary>
                                testID="kitchen-roles-own-table"
                                caption={t('accessAdmin:roles.caption')}
                                captionHidden
                                columns={columns}
                                rows={own}
                                rowKey={(row) => String(row.id)}
                                rowAction={rowAction()}
                            />
                        )}
                    </Stack>

                    <Stack space="sm" testID="kitchen-roles-template-section">
                        <Stack space="none">
                            <Heading level={2}>{t('accessAdmin:roles.templatesHeading')}</Heading>
                            <Text tone="secondary">{t('accessAdmin:roles.templatesHint')}</Text>
                        </Stack>

                        <Table<OrganisationRoleSummary>
                            testID="kitchen-roles-template-table"
                            caption={t('accessAdmin:roles.caption')}
                            captionHidden
                            columns={columns}
                            rows={templates}
                            rowKey={(row) => String(row.id)}
                            rowAction={rowAction()}
                        />
                    </Stack>
                </Stack>
            )}
        </Stack>
    );
}

/** Re-exported so the editor can answer "may Delete be offered" from the same predicate. */
export { isDeletableRole };
