import type { StaffInvitation, TeamMemberSummary } from '@healthy360/api-client/contracts';
import { isWorkingMember } from '@healthy360/api-client/contracts';
import {
    Badge,
    Button,
    Card,
    Chip,
    EmptyState,
    ErrorState,
    FilterChip,
    Heading,
    Inline,
    Pagination,
    Skeleton,
    Stack,
    Table,
    Text,
} from '@healthy360/design-system';
import type { TableColumn } from '@healthy360/design-system';
import { useLocale } from '@healthy360/i18n';
import { useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { Gate, useCan } from '../../../access/gate.tsx';
import {
    useRevokeInvitationMutation,
    useStaffInvitationsQuery,
    useTeamQuery,
} from '../../../data/access-admin-hooks.ts';
import { toFailure } from '../../../data/hooks.ts';
import {
    MEMBERSHIP_END_PERMISSION,
    MEMBERSHIP_INVITE_PERMISSION,
    MEMBERSHIP_VIEW_PERMISSION,
    USER_MANAGE_PERMISSION,
} from '../entity-registry.ts';
import { KitchenPageHeader } from '../kitchen-page-header.tsx';
import { useListPage } from '../use-list-page.ts';

/**
 * `/kitchen/team` — everybody who can sign in to this kitchen (AA1).
 *
 * ## Two sections, because they are two kinds of fact
 *
 * The table is people who are *in*. The panel below it is offers that have been sent and not taken
 * up, which is a different question with a different remedy — you re-send or withdraw an invitation,
 * you do not edit it. Folding them into one list would need a status column meaning two things at
 * once, and a row that could not be opened.
 *
 * The invitation panel is fetched separately and renders nothing at all when it is empty, so a
 * kitchen with no outstanding offers sees a staff list rather than a staff list and an empty box.
 *
 * ## Ended memberships are behind a filter, not gone
 *
 * The endpoint lists every status by default; this screen asks for `active` unless the filter is on,
 * because "who works here" is the common question. The filter widens rather than replaces — somebody
 * looking for the person who left last month wants to see them *among* the current staff, so they
 * can tell which is which.
 *
 * ## Numbered pages, and a server-side filter
 *
 * A staff list is a table with a page control under it. There is no client-side search: unlike the
 * supplier book this list is paged, so filtering the page in memory would hide matches on every
 * other page — the worst kind of search, because it answers confidently and wrongly.
 */

export function TeamScreen() {
    return (
        <Gate
            area="kitchen"
            requirement={{ allOf: [MEMBERSHIP_VIEW_PERMISSION] }}
            testID="kitchen-team"
        >
            <TeamList />
        </Gate>
    );
}

export function teamRowTestId(membershipId: string): string {
    return `kitchen-team-row-${membershipId}`;
}

/** The name to show, falling back through what the record actually has. */
export function memberDisplayName(
    member: Pick<TeamMemberSummary, 'givenName' | 'familyName' | 'email'>,
    unnamed: string,
): string {
    const full = [member.givenName, member.familyName].filter((part) => part !== null).join(' ');

    if (full.trim() !== '') return full.trim();
    // The address rather than a blank: a provisioned account has a login before it has a profile,
    // and a row with nothing in its first column looks like a bug rather than a new starter.
    return member.email ?? unnamed;
}

function StatusBadge({ member }: { readonly member: TeamMemberSummary }) {
    const { t } = useTranslation();
    const testID = `${teamRowTestId(String(member.membershipId))}-status`;

    const tone = isWorkingMember(member.status)
        ? 'success'
        : member.status === 'ended'
          ? 'neutral'
          : 'warning';

    return (
        <Badge
            testID={testID}
            tone={tone}
            label={t(`accessAdmin:status.${member.status}` as never, {
                defaultValue: member.status,
            })}
        />
    );
}

function PendingInvitations() {
    const { t } = useTranslation();
    const canRevoke = useCan(MEMBERSHIP_END_PERMISSION);
    const invitations = useStaffInvitationsQuery('live');
    const revoke = useRevokeInvitationMutation();

    const rows = invitations.data ?? [];

    // Nothing at all when there are none: a kitchen with no outstanding offers should see a staff
    // list, not a staff list and an empty box explaining that there is nothing in it.
    if (invitations.isPending || rows.length === 0) return null;

    const columns: readonly TableColumn<StaffInvitation>[] = [
        {
            key: 'email',
            header: t('accessAdmin:team.columns.email'),
            rowHeader: true,
            flex: 2,
            render: (row) => <Text testID={`kitchen-team-invitation-${row.id}-email`}>{row.email}</Text>,
        },
        {
            key: 'role',
            header: t('accessAdmin:team.columns.roles'),
            render: (row) => (
                <Chip
                    testID={`kitchen-team-invitation-${row.id}-role`}
                    label={t(`accessAdmin:codes.${row.roleCode}.name` as never, {
                        defaultValue: row.roleCode,
                    })}
                />
            ),
        },
    ];

    return (
        <Stack space="sm" testID="kitchen-team-invitations">
            <Stack space="none">
                <Heading level={2}>{t('accessAdmin:team.invitations.title')}</Heading>
                <Text tone="secondary">{t('accessAdmin:team.invitations.subtitle')}</Text>
            </Stack>

            <Table<StaffInvitation>
                testID="kitchen-team-invitations-table"
                caption={t('accessAdmin:team.invitations.caption')}
                captionHidden
                columns={columns}
                rows={rows}
                rowKey={(row) => row.id}
                {...(canRevoke
                    ? {
                          rowAction: {
                              header: t('kitchen:list.actionHeader'),
                              render: (row: StaffInvitation) => (
                                  <Inline space="xs" wrap justify="end">
                                      <Button
                                          testID={`kitchen-team-invitation-${row.id}-revoke`}
                                          size="sm"
                                          variant="secondary"
                                          label={t('accessAdmin:team.invitations.revoke')}
                                          loading={revoke.isPending}
                                          onPress={() => {
                                              revoke.mutate(row.id);
                                          }}
                                      />
                                  </Inline>
                              ),
                          },
                      }
                    : {})}
            />
        </Stack>
    );
}

function TeamList() {
    const { t } = useTranslation();
    const { locale } = useLocale();
    const router = useRouter();
    const canAdd = useCan([MEMBERSHIP_INVITE_PERMISSION, USER_MANAGE_PERMISSION], 'any');

    const [includeFormer, setIncludeFormer] = useState(false);

    // Absent rather than `'active'` when the filter is on: the endpoint's default is every status,
    // and asking for all four one at a time is not a thing the filter can express.
    const filter = useMemo(
        () => (includeFormer ? {} : { status: 'active' as const }),
        [includeFormer],
    );

    const [page, setPage] = useListPage(filter);
    const team = useTeamQuery({ ...filter, page });

    const rows = team.data?.items;
    const totalCount = team.data?.totalCount ?? null;
    const totalPages = totalCount === null ? 0 : Math.max(1, Math.ceil(totalCount / 25));

    const columns: readonly TableColumn<TeamMemberSummary>[] = [
        {
            key: 'person',
            header: t('accessAdmin:team.columns.person'),
            rowHeader: true,
            flex: 2,
            render: (row) => {
                const testID = teamRowTestId(String(row.membershipId));
                return (
                    <Stack space="none">
                        <Text variant="bodyStrong" testID={`${testID}-name`}>
                            {memberDisplayName(row, t('accessAdmin:team.unnamed'))}
                        </Text>
                        <Text variant="caption" tone="secondary" testID={`${testID}-email`}>
                            {row.email ?? ''}
                        </Text>
                    </Stack>
                );
            },
        },
        {
            key: 'roles',
            header: t('accessAdmin:team.columns.roles'),
            flex: 2,
            render: (row) => {
                const testID = teamRowTestId(String(row.membershipId));

                if (row.roles.length === 0) {
                    return (
                        <Text tone="secondary" testID={`${testID}-no-roles`}>
                            {t('accessAdmin:team.noRoles')}
                        </Text>
                    );
                }

                return (
                    <Inline space="xs" wrap testID={`${testID}-roles`}>
                        {row.roles.map((role) => (
                            <Chip
                                key={String(role.id)}
                                testID={`${testID}-role-${role.code}`}
                                label={locale.startsWith('ar') ? role.nameAr : role.nameEn}
                            />
                        ))}
                    </Inline>
                );
            },
        },
        {
            key: 'scope',
            header: t('accessAdmin:team.columns.scope'),
            render: (row) => (
                <Text
                    testID={`${teamRowTestId(String(row.membershipId))}-scope`}
                    tone={row.branch === null ? 'secondary' : 'primary'}
                >
                    {row.branch?.name ?? t('accessAdmin:team.organisationWide')}
                </Text>
            ),
        },
        {
            key: 'status',
            header: t('accessAdmin:team.columns.status'),
            render: (row) => <StatusBadge member={row} />,
        },
    ];

    const failure = toFailure(team.error);

    return (
        <Stack space="lg" testID="kitchen-team-screen">
            <KitchenPageHeader
                testID="kitchen-team-header"
                title={t('accessAdmin:team.title')}
                subtitle={t('accessAdmin:team.subtitle')}
                titleTestID="kitchen-team-title"
                subtitleTestID="kitchen-team-subtitle"
            />

            <Inline space="sm" align="end" justify="between" wrap testID="kitchen-team-toolbar">
                <FilterChip
                    testID="kitchen-team-former-filter"
                    label={t('accessAdmin:team.showEnded')}
                    selected={includeFormer}
                    onChange={setIncludeFormer}
                />

                {canAdd ? (
                    <Button
                        testID="kitchen-team-add"
                        label={t('accessAdmin:team.add')}
                        onPress={() => {
                            router.push('/kitchen/team/new' as never);
                        }}
                    />
                ) : null}
            </Inline>

            {team.isPending ? (
                <Stack space="sm" testID="kitchen-team-loading">
                    {Array.from({ length: 4 }, (_, index) => (
                        <Card key={index} padding="md">
                            <Stack space="xs">
                                <Skeleton
                                    testID={`kitchen-team-skeleton-${String(index + 1)}`}
                                    heightClassName="h-5"
                                />
                                <Skeleton heightClassName="h-4" widthClassName="w-1/2" />
                            </Stack>
                        </Card>
                    ))}
                </Stack>
            ) : failure !== null ? (
                <ErrorState
                    testID="kitchen-team-error"
                    failure={failure}
                    onRetry={() => {
                        void team.refetch();
                    }}
                    retrying={team.isFetching}
                />
            ) : (rows ?? []).length === 0 ? (
                <EmptyState
                    testID="kitchen-team-empty"
                    title={
                        includeFormer
                            ? t('accessAdmin:team.filteredEmptyTitle')
                            : t('accessAdmin:team.emptyTitle')
                    }
                    body={
                        includeFormer
                            ? t('accessAdmin:team.filteredEmptyBody')
                            : t('accessAdmin:team.emptyBody')
                    }
                />
            ) : (
                <Stack space="sm">
                    <Table<TeamMemberSummary>
                        testID="kitchen-team-table"
                        caption={t('accessAdmin:team.caption')}
                        captionHidden
                        columns={columns}
                        rows={rows ?? []}
                        rowKey={(row) => String(row.membershipId)}
                        rowAction={{
                            header: t('kitchen:list.actionHeader'),
                            render: (row) => (
                                <Inline space="xs" wrap justify="end">
                                    <Button
                                        testID={`${teamRowTestId(String(row.membershipId))}-open`}
                                        size="sm"
                                        variant="secondary"
                                        label={t('accessAdmin:team.open')}
                                        onPress={() => {
                                            router.push(
                                                `/kitchen/team/${String(row.membershipId)}` as never,
                                            );
                                        }}
                                    />
                                </Inline>
                            ),
                        }}
                    />

                    {totalPages > 1 ? (
                        <Pagination
                            testID="kitchen-team-pagination"
                            page={page}
                            totalPages={totalPages}
                            onPageChange={setPage}
                            disabled={team.isFetching}
                        />
                    ) : null}
                </Stack>
            )}

            <PendingInvitations />
        </Stack>
    );
}
