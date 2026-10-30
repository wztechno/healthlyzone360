import type { StaffInvitation, TeamMemberSummary } from '@healthy360/api-client/contracts';
import { isWorkingMember } from '@healthy360/api-client/contracts';
import {
    Badge,
    Button,
    Cascade,
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
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { Gate, useCan } from '../../../access/gate.tsx';
import {
    useRevokeInvitationMutation,
    useStaffInvitationsQuery,
    useTeamQuery,
    useTeamWholeSetQuery,
} from '../../../data/access-admin-hooks.ts';
import { toFailure } from '../../../data/hooks.ts';
import { CATALOGUE_ROW_ICONS } from '../catalogue/catalogue-list-item.tsx';
import { CatalogueList } from '../catalogue/catalogue-list.tsx';
import type { CatalogueColumn } from '../catalogue/catalogue-column-spec.ts';
import { CataloguePager } from '../catalogue/catalogue-pager.tsx';
import { ColumnPicker } from '../catalogue/column-picker.tsx';
import { LensBar, LensScope } from '../catalogue/lens-bar.tsx';
import type { LensFigure } from '../catalogue/lens-bar.tsx';
import { compareText, useColumnControls } from '../catalogue/use-column-controls.tsx';
import type { ControlledColumn } from '../catalogue/use-column-controls.tsx';
import {
    MEMBERSHIP_END_PERMISSION,
    MEMBERSHIP_INVITE_PERMISSION,
    MEMBERSHIP_VIEW_PERMISSION,
    USER_MANAGE_PERMISSION,
} from '../entity-registry.ts';
import {
    useListMemory,
    useRememberedFilter,
    useRememberedOpened,
    useRememberedPage,
    useRememberedQuery,
    useRestoredPageFallback,
} from '../list-memory.ts';

/**
 * `/kitchen/team` — everybody who can sign in to this kitchen (AA1), on the Catalogue list.
 *
 * ```
 * All people 61 │ ● Working 58  ● Invitations 2  ● Without roles 1               [ + Add user ]
 * [Who to show Working ▾] [ ⌕ search                   ]                     18 of 61 │ ▦
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
 * ## Ended memberships are behind a scope, not gone
 *
 * The endpoint lists every status by default; this screen asks for `active` unless the scope says
 * Everyone, because "who works here" is the common question. The scope widens rather than
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

const TEAM_PAGE_SIZE = 18;

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

    // Segment, search, page and the member last opened survive leaving the list for a member.
    const memory = useListMemory('kitchen.team');
    const [segment, setSegment] = useRememberedFilter<TeamSegment>(memory, 'segment', 'working');
    const [query, setQuery] = useRememberedQuery(memory);
    const [lastOpenedId, rememberOpened] = useRememberedOpened(memory);

    // Absent rather than `'active'` for Everyone: the endpoint's default is every status, and
    // asking for all four one at a time is not a thing the segment can express.
    const filter = useMemo(
        () => (segment === 'everyone' ? {} : { status: 'active' as const }),
        [segment],
    );

    const [page, setPage] = useRememberedPage(memory, filter);
    const team = useTeamQuery({ ...filter, page, perPage: TEAM_PAGE_SIZE });
    useRestoredPageFallback(memory, page, team.isError, () => {
        setPage(1);
    });
    const wholeTeam = useTeamWholeSetQuery(filter);
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
        rememberOpened(String(row.membershipId));
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
    // The segment is a scope, which Clear leaves alone; the search and the column filters are not.
    const searchedOrFiltered = trimmed !== '' || controls.filtered;
    const unfiltered = !searchedOrFiltered && segment === 'working';
    const liveInvitations = invitations.data ?? [];

    const addSomebody = () => {
        router.push('/kitchen/team/new' as never);
    };

    return (
        <Cascade space="md" testID="kitchen-team-screen">
            <LensBar
                testID="kitchen-team-toolbar"
                label={t('kitchen:lens.label')}
                figures={lensFigures({
                    total: team.isPending ? null : failure === null ? totalCount : undefined,
                    rows: wholeTeam.isPending ? null : wholeTeam.data,
                    invitations: invitations.isPending ? null : invitations.data?.length,
                    t,
                })}
                scope={
                    // Not figures: on Working the whole set is asked for active people only, so
                    // there is no count of Everyone to draw beside it.
                    <LensScope<TeamSegment>
                        testID="kitchen-team-toolbar-status"
                        label={t('accessAdmin:team.segmentLabel')}
                        value={segment}
                        onChange={setSegment}
                        options={SEGMENTS.map(([value, labelKey]) => ({
                            value,
                            label: t(labelKey),
                            testID: `kitchen-team-toolbar-status-${value}`,
                        }))}
                    />
                }
                search={query}
                onSearchChange={setQuery}
                searchLabel={t('accessAdmin:team.searchLabel')}
                searchPlaceholder={
                    totalPages > 1
                        ? t('accessAdmin:team.searchPageHint')
                        : t('accessAdmin:team.searchHint')
                }
                result={
                    team.isPending
                        ? null
                        : failure !== null
                          ? t('kitchen:list.noValue')
                          : t('kitchen:lens.result', {
                                // Rows up to the end of this page (18 of 61, then 36); a search
                                // narrows the page in hand, so then it is the matches on it.
                                shown: searchedOrFiltered
                                    ? controls.rows.length
                                    : Math.min(
                                          page * TEAM_PAGE_SIZE,
                                          totalCount ?? pageRows.length,
                                      ),
                                total: totalCount ?? pageRows.length,
                            })
                }
                clearLabel={t('kitchen:lens.clear')}
                {...(searchedOrFiltered
                    ? {
                          onClear: () => {
                              setQuery('');
                              controls.clearFilters();
                          },
                      }
                    : {})}
                trailing={(narrow) => <ColumnPicker {...controls.picker} compact={narrow} />}
                actions={
                    canAdd ? (
                        <Button
                            testID="kitchen-team-add"
                            label={t('accessAdmin:team.add')}
                            iconStart={<Icon name="plus" size="sm" />}
                            onPress={addSomebody}
                        />
                    ) : undefined
                }
            />

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
                        highlightedId={lastOpenedId}
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
                        page={page}
                        totalPages={totalPages}
                        onPageChange={setPage}
                        label={t('kitchen:catalogue.pagerLabel')}
                    />
                </Stack>
            )}

            <PendingInvitations invitations={liveInvitations} />
        </Cascade>
    );
}

const SEGMENTS = [
    ['working', 'accessAdmin:team.segmentWorking'],
    ['everyone', 'accessAdmin:team.segmentEveryone'],
] as const satisfies readonly (readonly [TeamSegment, string])[];

/**
 * All people is the segment's total across pages; Working and Without roles count every member the
 * segment matches, across all pages; Invitations is the invitation list's own length — that
 * endpoint is unpaged. `null` is in flight; `undefined` is a read that failed, drawn as a dash.
 */
function lensFigures({
    total,
    rows,
    invitations,
    t,
}: {
    readonly total: number | null | undefined;
    readonly rows: readonly TeamMemberSummary[] | null | undefined;
    readonly invitations: number | null | undefined;
    readonly t: TFunction;
}): readonly LensFigure[] {
    const figure = (count: number | null | undefined) =>
        count === undefined ? { value: 0, display: t('kitchen:list.noValue') } : { value: count };
    const counted = (match: (row: TeamMemberSummary) => boolean) =>
        figure(rows === null || rows === undefined ? rows : rows.filter(match).length);

    return [
        { key: 'all', label: t('kitchen:lens.allPeople'), ...figure(total) },
        {
            key: 'working',
            label: t('accessAdmin:team.statWorking'),
            ...counted((row) => isWorkingMember(row.status)),
            tone: 'success',
            separated: true,
        },
        {
            key: 'invitations',
            label: t('accessAdmin:team.statInvitations'),
            ...figure(invitations),
            tone: 'warning',
        },
        {
            key: 'noRoles',
            label: t('accessAdmin:team.statNoRoles'),
            ...counted((row) => row.roles.length === 0),
            tone: 'danger',
            alarm: true,
        },
    ];
}
