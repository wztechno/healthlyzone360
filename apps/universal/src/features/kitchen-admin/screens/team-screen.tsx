import type { StaffInvitation, TeamMemberSummary } from '@healthy360/api-client/contracts';
import { isWorkingMember } from '@healthy360/api-client/contracts';
import {
    Badge,
    Button,
    Chip,
    EmptyState,
    ErrorState,
    Heading,
    Icon,
    Stack,
    TableSkeleton,
    Text,
} from '@healthy360/design-system';
import type { MenuItem } from '@healthy360/design-system';
import { useFormatter, useLocale } from '@healthy360/i18n';
import { useRouter } from 'expo-router';
import type { TFunction } from 'i18next';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { Gate, useCan } from '../../../access/gate.tsx';
import {
    useRevokeInvitationMutation,
    useStaffInvitationsQuery,
    useTeamQuery,
} from '../../../data/access-admin-hooks.ts';
import { toFailure } from '../../../data/hooks.ts';
import { CATALOGUE_ROW_ICONS } from '../catalogue/catalogue-list-item.tsx';
import { CatalogueList } from '../catalogue/catalogue-list.tsx';
import type { CatalogueColumn } from '../catalogue/catalogue-column-spec.ts';
import { CataloguePager } from '../catalogue/catalogue-pager.tsx';
import { CatalogueStatCards } from '../catalogue/catalogue-stat-cards.tsx';
import type { CatalogueStatCard } from '../catalogue/catalogue-stat-cards.tsx';
import { CatalogueToolbar } from '../catalogue/catalogue-toolbar.tsx';
import type { CatalogueStatusSegment } from '../catalogue/catalogue-toolbar.tsx';
import { ColumnPicker } from '../catalogue/column-picker.tsx';
import { compareText, useColumnControls } from '../catalogue/use-column-controls.tsx';
import type { ControlledColumn } from '../catalogue/use-column-controls.tsx';
import {
    MEMBERSHIP_END_PERMISSION,
    MEMBERSHIP_INVITE_PERMISSION,
    MEMBERSHIP_VIEW_PERMISSION,
    USER_MANAGE_PERMISSION,
} from '../entity-registry.ts';
import { useListPage } from '../use-list-page.ts';

/**
 * `/kitchen/team` — everybody who can sign in to this kitchen (AA1), on the Catalogue list.
 *
 * ```
 * ┌ SHOWN ┐ ┌ WORKING ┐ ┌ INVITATIONS ┐ ┌ WITHOUT ROLES ┐
 * [ ⌕ search ]  [ Working | Everyone ]  [ ▦ ]  [ + Add user ]
 * USER     EMAIL     ROLES     WORKS AT     STATUS     JOINED     ✎
 * Showing 25 of 61                                              [ ‹ 1 2 3 › ]
 *
 * Waiting to be accepted
 * SIGNS IN AS     ROLE     EXPIRES     ✕
 * ```
 *
 * ## Two lists, because they are two kinds of fact
 *
 * The first list is people who are *in*. The one below it is offers that have been sent and not
 * taken up, which is a different question with a different remedy — you withdraw an invitation,
 * you do not edit it. Folding them into one list would need a status column meaning two things at
 * once, and a row that could not be opened.
 *
 * The invitation list is fetched separately and renders nothing at all when it is empty, so a
 * kitchen with no outstanding offers sees a staff list rather than a staff list and an empty box.
 *
 * ## Ended memberships are behind a segment, not gone
 *
 * The endpoint lists every status by default; this screen asks for `active` unless the segment says
 * Everyone, because "who works here" is the common question. The segment widens rather than
 * replaces — somebody looking for the person who left last month wants to see them *among* the
 * current staff, so they can tell which is which.
 *
 * ## The search is page-scoped, and says so
 *
 * The team endpoint is paged and takes no search parameter, so the toolbar's search can only narrow
 * the page in hand. When the whole team fits on one page that is the whole team; when it does not,
 * the field's placeholder reads "Search this page" rather than answering confidently and wrongly
 * about the pages it has not seen. Column sorting is page-scoped for the same reason.
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

const TEAM_PAGE_SIZE = 25;

type TeamSegment = 'working' | 'everyone';

function statusText(member: TeamMemberSummary, t: TFunction): string {
    return t(`accessAdmin:status.${member.status}` as never, { defaultValue: member.status });
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
            // No mark on Working: it is the resting state, and the tick would sit on every row.
            icon={tone === 'success' ? null : undefined}
            label={statusText(member, t)}
        />
    );
}

function PendingInvitations({ invitations }: { readonly invitations: readonly StaffInvitation[] }) {
    const { t } = useTranslation();
    const formatter = useFormatter();
    const canRevoke = useCan(MEMBERSHIP_END_PERMISSION);
    const revoke = useRevokeInvitationMutation();

    // Nothing at all when there are none: a kitchen with no outstanding offers should see a staff
    // list, not a staff list and an empty box explaining that there is nothing in it.
    if (invitations.length === 0) return null;

    const roleName = (row: StaffInvitation) =>
        t(`accessAdmin:codes.${row.roleCode}.name` as never, { defaultValue: row.roleCode });

    const columns: readonly CatalogueColumn<StaffInvitation>[] = [
        {
            key: 'email',
            role: 'title',
            label: t('accessAdmin:team.columns.email'),
            width: 260,
            priority: 100,
            value: (row) => row.email,
            render: (row) => (
                <Text
                    variant="strong"
                    numberOfLines={1}
                    testID={`kitchen-team-invitation-${row.id}-email`}
                >
                    {row.email}
                </Text>
            ),
        },
        {
            key: 'role',
            role: 'meta',
            label: t('accessAdmin:team.columns.roles'),
            width: 200,
            priority: 80,
            value: roleName,
            render: (row) => (
                <Chip testID={`kitchen-team-invitation-${row.id}-role`} label={roleName(row)} />
            ),
        },
        {
            key: 'expires',
            role: 'meta',
            label: t('accessAdmin:team.invitations.columnExpires'),
            width: 140,
            priority: 60,
            value: (row) => formatter.formatDate(row.expiresAt, { dateStyle: 'medium' }),
            render: (row) => (
                <Text tone="secondary" testID={`kitchen-team-invitation-${row.id}-expires`}>
                    {formatter.formatDate(row.expiresAt, { dateStyle: 'medium' })}
                </Text>
            ),
        },
    ];

    return (
        <Stack space="sm" testID="kitchen-team-invitations">
            <Stack space="none">
                <Heading level={2}>{t('accessAdmin:team.invitations.title')}</Heading>
                <Text variant="caption" tone="secondary">
                    {t('accessAdmin:team.invitations.subtitle')}
                </Text>
            </Stack>

            <CatalogueList<StaffInvitation>
                testID="kitchen-team-invitations-table"
                label={t('accessAdmin:team.invitations.caption')}
                columns={columns}
                rows={invitations}
                rowKey={(row) => row.id}
                density="sm"
                rowActionsLabel={t('kitchen:list.rowActions')}
                {...(canRevoke
                    ? {
                          rowActions: (row: StaffInvitation): readonly MenuItem[] => [
                              {
                                  key: 'revoke',
                                  label: t('accessAdmin:team.invitations.revoke'),
                                  icon: 'close',
                                  tone: 'danger',
                                  disabled: revoke.isPending,
                                  testID: `kitchen-team-invitation-${row.id}-revoke`,
                                  onSelect: () => {
                                      revoke.mutate(row.id);
                                  },
                              },
                          ],
                      }
                    : {})}
            />
        </Stack>
    );
}

function TeamList() {
    const { t } = useTranslation();
    const { locale } = useLocale();
    const formatter = useFormatter();
    const router = useRouter();
    const canAdd = useCan([MEMBERSHIP_INVITE_PERMISSION, USER_MANAGE_PERMISSION], 'any');

    const [segment, setSegment] = useState<TeamSegment>('working');
    const [query, setQuery] = useState('');

    // Absent rather than `'active'` for Everyone: the endpoint's default is every status, and
    // asking for all four one at a time is not a thing the segment can express.
    const filter = useMemo(
        () => (segment === 'everyone' ? {} : { status: 'active' as const }),
        [segment],
    );

    const [page, setPage] = useListPage(filter);
    const team = useTeamQuery({ ...filter, page });
    const invitations = useStaffInvitationsQuery('live');

    const pageRows = useMemo(() => team.data?.items ?? [], [team.data]);
    const totalCount = team.data?.totalCount ?? null;
    const totalPages =
        totalCount === null ? 0 : Math.max(1, Math.ceil(totalCount / TEAM_PAGE_SIZE));

    const trimmed = query.trim().toLocaleLowerCase(locale);
    const searched = useMemo(() => {
        if (trimmed === '') return pageRows;
        return pageRows.filter((row) =>
            [row.givenName, row.familyName, row.email].some(
                (field) => field?.toLocaleLowerCase(locale).includes(trimmed) ?? false,
            ),
        );
    }, [pageRows, trimmed, locale]);

    const unnamed = t('accessAdmin:team.unnamed');
    const nameOf = (row: TeamMemberSummary) => memberDisplayName(row, unnamed);
    const roleNames = (row: TeamMemberSummary) =>
        row.roles.map((role) => (locale.startsWith('ar') ? role.nameAr : role.nameEn));
    const scopeText = (row: TeamMemberSummary) =>
        row.branch?.name ?? t('accessAdmin:team.organisationWide');
    const joinedText = (row: TeamMemberSummary) =>
        row.joinedAt === null
            ? t('accessAdmin:team.notJoined')
            : formatter.formatDate(row.joinedAt, { dateStyle: 'medium' });

    const openMember = (row: TeamMemberSummary) => {
        router.push(`/kitchen/team/${String(row.membershipId)}` as never);
    };

    const columns: readonly ControlledColumn<
        TeamMemberSummary,
        CatalogueColumn<TeamMemberSummary>
    >[] = [
        {
            key: 'person',
            role: 'title',
            label: t('accessAdmin:team.columns.person'),
            width: 260,
            priority: 100,
            value: nameOf,
            sort: (left, right, direction) => compareText(nameOf(left), nameOf(right), direction),
            render: (row) => {
                const testID = teamRowTestId(String(row.membershipId));
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
            // Its own column rather than a grey suffix on the name: the address is what a
            // person signs in with, and it is scanned and sorted as a thing in itself.
            key: 'email',
            role: 'meta',
            label: t('accessAdmin:team.columns.userEmail'),
            width: 240,
            min: 160,
            priority: 88,
            value: (row) => row.email ?? t('kitchen:list.noValue'),
            sort: (left, right, direction) => compareText(left.email, right.email, direction),
            render: (row) => (
                <Text
                    tone={row.email === null ? 'secondary' : 'primary'}
                    numberOfLines={1}
                    testID={`${teamRowTestId(String(row.membershipId))}-email`}
                >
                    {row.email ?? t('kitchen:list.noValue')}
                </Text>
            ),
        },
        {
            key: 'roles',
            role: 'meta',
            label: t('accessAdmin:team.columns.roles'),
            width: 240,
            min: 160,
            priority: 90,
            value: (row) =>
                row.roles.length === 0 ? t('accessAdmin:team.noRoles') : roleNames(row).join(', '),
            filter: {
                values: (rows) => {
                    const seen = new Map<string, string>();
                    for (const row of rows) {
                        for (const role of row.roles) {
                            seen.set(
                                role.code,
                                locale.startsWith('ar') ? role.nameAr : role.nameEn,
                            );
                        }
                    }
                    return [...seen].map(([key, label]) => ({ key, label }));
                },
                match: (row, value) => row.roles.some((role) => role.code === value),
            },
            render: (row) => {
                const testID = teamRowTestId(String(row.membershipId));

                if (row.roles.length === 0) {
                    return (
                        <Text tone="secondary" testID={`${testID}-no-roles`}>
                            {t('accessAdmin:team.noRoles')}
                        </Text>
                    );
                }

                // The first role as a chip and the rest as a count. A row is one line tall,
                // so a second chip had nowhere to wrap to and ran into the Works at column;
                // the full set is on the person's page and in the Roles filter.
                const [first, ...rest] = row.roles;
                return (
                    <View
                        testID={`${testID}-roles`}
                        className="min-w-0 flex-row items-center gap-1.5 overflow-hidden"
                    >
                        {first === undefined ? null : (
                            <View className="min-w-0 shrink">
                                <Chip
                                    testID={`${testID}-role-${first.code}`}
                                    label={locale.startsWith('ar') ? first.nameAr : first.nameEn}
                                />
                            </View>
                        )}
                        {rest.length === 0 ? null : (
                            <Text
                                variant="caption"
                                tone="secondary"
                                className="shrink-0"
                                testID={`${testID}-roles-more`}
                            >
                                {t('accessAdmin:team.moreRoles', { n: rest.length })}
                            </Text>
                        )}
                    </View>
                );
            },
        },
        {
            key: 'scope',
            role: 'meta',
            label: t('accessAdmin:team.columns.scope'),
            width: 170,
            priority: 70,
            value: scopeText,
            sort: (left, right, direction) =>
                compareText(scopeText(left), scopeText(right), direction),
            render: (row) => (
                <Text
                    testID={`${teamRowTestId(String(row.membershipId))}-scope`}
                    tone={row.branch === null ? 'secondary' : 'primary'}
                    numberOfLines={1}
                >
                    {scopeText(row)}
                </Text>
            ),
        },
        {
            key: 'status',
            role: 'status',
            badge: true,
            label: t('accessAdmin:team.columns.status'),
            width: 120,
            priority: 85,
            value: (row) => statusText(row, t),
            sort: (left, right, direction) =>
                compareText(statusText(left, t), statusText(right, t), direction),
            render: (row) => <StatusBadge member={row} />,
        },
        {
            key: 'joined',
            role: 'meta',
            label: t('accessAdmin:team.columns.joined'),
            width: 130,
            priority: 40,
            value: joinedText,
            sort: (left, right, direction) => compareText(left.joinedAt, right.joinedAt, direction),
            render: (row) => (
                <Text tone="secondary" testID={`${teamRowTestId(String(row.membershipId))}-joined`}>
                    {joinedText(row)}
                </Text>
            ),
        },
    ];

    const controls = useColumnControls(searched, columns, 'kitchen-team');
    const failure = toFailure(team.error);
    const unfiltered = trimmed === '' && segment === 'working' && !controls.filtered;
    const liveInvitations = invitations.data ?? [];

    const segments: readonly CatalogueStatusSegment<TeamSegment>[] = [
        { value: 'working', label: t('accessAdmin:team.segmentWorking') },
        { value: 'everyone', label: t('accessAdmin:team.segmentEveryone') },
    ];

    const addSomebody = () => {
        router.push('/kitchen/team/new' as never);
    };

    return (
        <Stack space="md" testID="kitchen-team-screen">
            {team.isPending || failure !== null ? null : (
                <CatalogueStatCards
                    testID="kitchen-team-stats"
                    cards={statCards({
                        rows: pageRows,
                        shown: controls.rows.length,
                        total: totalCount ?? pageRows.length,
                        invitations: invitations.isPending ? null : liveInvitations.length,
                        unfiltered,
                        t,
                        clear: () => {
                            setQuery('');
                            setSegment('working');
                            controls.clearFilters();
                        },
                    })}
                />
            )}

            <CatalogueToolbar<TeamSegment>
                testID="kitchen-team-toolbar"
                search={query}
                onSearchChange={setQuery}
                searchLabel={t('accessAdmin:team.searchLabel')}
                searchPlaceholder={
                    totalPages > 1
                        ? t('accessAdmin:team.searchPageHint')
                        : t('accessAdmin:team.searchHint')
                }
                statusLabel={t('accessAdmin:team.segmentLabel')}
                statusSegments={segments}
                status={segment}
                onStatusChange={setSegment}
            >
                <ColumnPicker {...controls.picker} />
                {canAdd ? (
                    <Button
                        testID="kitchen-team-add"
                        label={t('accessAdmin:team.add')}
                        iconStart={<Icon name="plus" size="sm" />}
                        onPress={addSomebody}
                    />
                ) : null}
            </CatalogueToolbar>

            {team.isPending ? (
                <TableSkeleton testID="kitchen-team-loading" partTestID="kitchen-team" />
            ) : failure !== null ? (
                <ErrorState
                    testID="kitchen-team-error"
                    failure={failure}
                    onRetry={() => {
                        void team.refetch();
                    }}
                    retrying={team.isFetching}
                />
            ) : controls.rows.length === 0 ? (
                <EmptyState
                    testID="kitchen-team-empty"
                    title={
                        unfiltered
                            ? t('accessAdmin:team.emptyTitle')
                            : t('accessAdmin:team.filteredEmptyTitle')
                    }
                    body={
                        unfiltered
                            ? t('accessAdmin:team.emptyBody')
                            : t('accessAdmin:team.filteredEmptyBody')
                    }
                />
            ) : (
                <Stack space="sm">
                    <CatalogueList<TeamMemberSummary>
                        testID="kitchen-team-table"
                        label={t('accessAdmin:team.caption')}
                        columns={controls.columns}
                        rows={controls.rows}
                        rowKey={(row) => String(row.membershipId)}
                        density="sm"
                        onRowPress={openMember}
                        rowActionsLabel={t('kitchen:list.rowActions')}
                        rowActions={(row): readonly MenuItem[] => [
                            {
                                key: 'open',
                                label: t('accessAdmin:team.open'),
                                icon: CATALOGUE_ROW_ICONS.edit,
                                testID: `${teamRowTestId(String(row.membershipId))}-open`,
                                onSelect: () => {
                                    openMember(row);
                                },
                            },
                        ]}
                    />

                    <CataloguePager
                        testID="kitchen-team-pagination"
                        range={t('kitchen:toolbar.showing', {
                            shown: controls.rows.length,
                            total: totalCount ?? controls.rows.length,
                        })}
                        page={page}
                        totalPages={totalPages}
                        onPageChange={setPage}
                        label={t('kitchen:catalogue.pagerLabel')}
                    />
                </Stack>
            )}

            <PendingInvitations invitations={liveInvitations} />
        </Stack>
    );
}

/**
 * Shown follows the search; Working and Without roles are counted over the page in hand, which is
 * the only set this screen has — Shown's "of 61" is what says the page is not the whole team.
 * Invitations is the invitation list's own length: that endpoint is unpaged.
 */
function statCards({
    rows,
    shown,
    total,
    invitations,
    unfiltered,
    t,
    clear,
}: {
    readonly rows: readonly TeamMemberSummary[];
    readonly shown: number;
    readonly total: number;
    readonly invitations: number | null;
    readonly unfiltered: boolean;
    readonly t: TFunction;
    readonly clear: () => void;
}): readonly CatalogueStatCard[] {
    const working = rows.filter((row) => isWorkingMember(row.status)).length;
    const noRoles = rows.filter((row) => row.roles.length === 0).length;

    return [
        {
            key: 'shown',
            label: t('kitchen:list.statShown'),
            value: String(shown),
            unit: t('kitchen:list.statShownUnit', { total }),
            caption: unfiltered
                ? t('kitchen:list.statShownUnfiltered')
                : t('kitchen:list.statShownFiltered'),
            mark: 'list',
            tone: 'brand',
            onPress: clear,
            accessibilityLabel: t('kitchen:list.statShownAction'),
        },
        {
            key: 'working',
            label: t('accessAdmin:team.statWorking'),
            value: String(working),
            unit: t('accessAdmin:team.statPeople'),
            caption: t('accessAdmin:team.statWorkingCaption'),
            mark: 'circleCheck',
        },
        {
            key: 'invitations',
            label: t('accessAdmin:team.statInvitations'),
            value: invitations === null ? t('kitchen:list.noValue') : String(invitations),
            unit: t('accessAdmin:team.statOffers'),
            caption: t('accessAdmin:team.statInvitationsCaption'),
            mark: 'send',
            tone: invitations === null || invitations === 0 ? 'default' : 'warning',
        },
        {
            key: 'noRoles',
            label: t('accessAdmin:team.statNoRoles'),
            value: String(noRoles),
            unit: t('accessAdmin:team.statPeople'),
            caption: t('accessAdmin:team.statNoRolesCaption'),
            mark: 'keyRound',
            tone: noRoles === 0 ? 'default' : 'danger',
        },
    ];
}
