import type { MembershipRoleAssignment } from '@healthy360/api-client/contracts';
import { isReactivatableMember, isWorkingMember } from '@healthy360/api-client/contracts';
import {
    Badge,
    Button,
    Callout,
    Card,
    Checkbox,
    Dialog,
    ErrorState,
    Heading,
    Inline,
    Skeleton,
    Stack,
    Text,
    useToast,
} from '@healthy360/design-system';
import { useLocale } from '@healthy360/i18n';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { apiFailure } from '@healthy360/api-client/contracts';

import { Gate, useCan } from '../../../access/gate.tsx';
import {
    useEndMemberMutation,
    useOrganisationRolesQuery,
    useReactivateMemberMutation,
    useSetMemberRolesMutation,
    useSuspendMemberMutation,
    useTeamMemberQuery,
} from '../../../data/access-admin-hooks.ts';
import { toFailure } from '../../../data/hooks.ts';
import {
    MEMBERSHIP_END_PERMISSION,
    MEMBERSHIP_UPDATE_PERMISSION,
    MEMBERSHIP_VIEW_PERMISSION,
    ROLE_MANAGE_PERMISSION,
} from '../entity-registry.ts';
import { OpsRecordFrame } from '../ops-record-frame.tsx';
import { useUnsavedGuard } from '../use-unsaved-guard.ts';
import { memberDisplayName } from './team-screen.tsx';

/**
 * `/kitchen/team/{membership}` — one person, what they may do, and whether they may still do it.
 *
 * ## `OpsRecordFrame`, not `EditorFrame`
 *
 * A membership carries a `lock_version` but no `updated_by`, so `EditorFrame` would have to render
 * "last changed by" with nothing to put in it — the same complaint that frame's own docblock makes
 * about a false Draft badge. The concurrency handshake still happens: the version travels on every
 * mutation, and a lost race comes back as a `resource.conflict` this screen surfaces in its banner
 * rather than in a reload dialog, because what the person did is re-appliable from what they can see.
 *
 * ## The roles editor is a set of checkboxes and saves as a whole
 *
 * Because that is what the endpoint takes. Add-and-remove would be three requests with two
 * intermediate states, one of which is "holds nothing"; the whole set in one `PUT` has neither.
 *
 * Existing assignments carry their time bounds through the save untouched. This screen cannot *set*
 * a window — that is a later slice — but it must not silently discard one, because a `PUT` writes
 * back exactly what it was shown.
 *
 * ## The last-administrator warning is on the read, not the write
 *
 * `remainingRoleAdministrators` arrives with the member, so the banner is up **before** anybody
 * presses End rather than after. Zero on your own row means nobody else can administer access —
 * which is the one thing worth knowing before you go on holiday.
 */

export function TeamMemberScreen() {
    return (
        <Gate
            area="kitchen"
            requirement={{ allOf: [MEMBERSHIP_VIEW_PERMISSION] }}
            testID="kitchen-team-member"
        >
            <TeamMemberEditor />
        </Gate>
    );
}

/** Where a role sits relative to now — the assignment's bounds, said in words. */
function assignmentNote(assignment: MembershipRoleAssignment | undefined): 'scheduled' | 'expired' | null {
    if (assignment === undefined) return null;

    const now = Date.now();

    if (assignment.startsAt !== null && Date.parse(assignment.startsAt) > now) return 'scheduled';
    if (assignment.expiresAt !== null && Date.parse(assignment.expiresAt) <= now) return 'expired';
    return null;
}

function TeamMemberEditor() {
    const { t } = useTranslation();
    const { locale } = useLocale();
    const router = useRouter();
    const toast = useToast();

    const params = useLocalSearchParams<{ readonly membership?: string }>();
    const membershipId = params.membership;

    const canAssignRoles = useCan(ROLE_MANAGE_PERMISSION);
    const canUpdate = useCan(MEMBERSHIP_UPDATE_PERMISSION);
    const canEnd = useCan(MEMBERSHIP_END_PERMISSION);

    const member = useTeamMemberQuery(membershipId);
    const roles = useOrganisationRolesQuery();

    const setRoles = useSetMemberRolesMutation();
    const suspend = useSuspendMemberMutation();
    const reactivate = useReactivateMemberMutation();
    const end = useEndMemberMutation();

    const [selected, setSelected] = useState<ReadonlySet<string> | null>(null);
    const [confirmingEnd, setConfirmingEnd] = useState(false);

    const guard = useUnsavedGuard({ message: t('kitchen:editor.unsavedMessage') });

    const record = member.data?.membership;
    const remaining = member.data?.remainingRoleAdministrators ?? null;

    // Null until the person touches something: the saved set is the source of truth while the form
    // is clean, so a refetch that changes it is reflected rather than overwritten by stale state.
    const held = useMemo(() => {
        if (selected !== null) return selected;
        return new Set((record?.roles ?? []).map((role) => String(role.id)));
    }, [selected, record]);

    const assignments = useMemo(() => {
        const byRole = new Map<string, MembershipRoleAssignment>();
        for (const assignment of record?.assignments ?? []) {
            byRole.set(String(assignment.roleId), assignment);
        }
        return byRole;
    }, [record]);

    const failure = toFailure(member.error);
    const writeFailure =
        toFailure(setRoles.error) ??
        toFailure(suspend.error) ??
        toFailure(reactivate.error) ??
        toFailure(end.error);

    if (member.isPending) {
        return (
            <Stack space="sm" testID="kitchen-team-member-loading">
                {Array.from({ length: 3 }, (_, index) => (
                    <Card key={index} padding="md">
                        <Skeleton heightClassName="h-5" />
                    </Card>
                ))}
            </Stack>
        );
    }

    if (failure !== null || record === undefined) {
        return (
            <ErrorState
                testID="kitchen-team-member-error"
                // `record === undefined` with no failure means the row vanished between the list and
                // this screen — somebody else ended the membership. Answered as a not-found rather
                // than as a blank page, which is what the reader would otherwise be shown.
                failure={failure ?? apiFailure('resource.not_found')}
                onRetry={() => {
                    void member.refetch();
                }}
                retrying={member.isFetching}
            />
        );
    }

    const name = memberDisplayName(record, t('accessAdmin:team.unnamed'));

    function toggleRole(roleId: string, on: boolean) {
        const next = new Set(held);
        if (on) next.add(roleId);
        else next.delete(roleId);
        setSelected(next);
        guard.markDirty();
    }

    function save() {
        if (membershipId === undefined || record === undefined) return;

        setRoles.mutate(
            {
                membership: membershipId,
                lockVersion: record.lockVersion,
                // The bounds ride along untouched. A `PUT` writes back what it was shown, so
                // dropping them here would silently cancel a role somebody scheduled.
                roles: [...held].map((roleId) => {
                    const existing = assignments.get(roleId);
                    return {
                        roleId: roleId as MembershipRoleAssignment['roleId'],
                        startsAt: existing?.startsAt ?? null,
                        expiresAt: existing?.expiresAt ?? null,
                    };
                }),
            },
            {
                onSuccess: (result) => {
                    guard.markClean();
                    setSelected(null);
                    toast.show({
                        message: t('accessAdmin:member.saved', {
                            name,
                            count: result.membership.roles.length,
                        }),
                    });
                },
            },
        );
    }

    function lifecycle(action: 'suspend' | 'reactivate' | 'end') {
        if (membershipId === undefined || record === undefined) return;

        const variables = { membership: membershipId, lockVersion: record.lockVersion };
        const mutation =
            action === 'suspend' ? suspend : action === 'reactivate' ? reactivate : end;

        mutation.mutate(variables, {
            onSuccess: () => {
                setConfirmingEnd(false);
                toast.show({ message: t(`accessAdmin:member.${action}d` as never, { name }) });
                if (action === 'end') router.back();
            },
        });
    }

    return (
        <>
            <OpsRecordFrame
                testID="kitchen-team-member"
                title={name}
                guard={guard}
                onBack={() => {
                    guard.intercept(() => {
                        router.back();
                    });
                }}
                backLabel={t('accessAdmin:member.back')}
                onSave={save}
                saveLabel={t('accessAdmin:member.save')}
                saving={setRoles.isPending}
                hideSave={!canAssignRoles}
                primaryAction={
                    <Inline space="xs" wrap justify="end">
                        {canUpdate && isWorkingMember(record.status) ? (
                            <Button
                                testID="kitchen-team-member-suspend"
                                size="sm"
                                variant="secondary"
                                label={t('accessAdmin:member.suspend')}
                                loading={suspend.isPending}
                                onPress={() => {
                                    lifecycle('suspend');
                                }}
                            />
                        ) : null}
                        {canUpdate && isReactivatableMember(record.status) ? (
                            <Button
                                testID="kitchen-team-member-reactivate"
                                size="sm"
                                variant="secondary"
                                label={t('accessAdmin:member.reactivate')}
                                loading={reactivate.isPending}
                                onPress={() => {
                                    lifecycle('reactivate');
                                }}
                            />
                        ) : null}
                        {canEnd && record.status !== 'ended' ? (
                            <Button
                                testID="kitchen-team-member-end"
                                size="sm"
                                variant="secondary"
                                label={t('accessAdmin:member.end')}
                                onPress={() => {
                                    setConfirmingEnd(true);
                                }}
                            />
                        ) : null}
                    </Inline>
                }
                banner={
                    <Stack space="sm">
                        {writeFailure === null ? null : (
                            <Callout
                                testID="kitchen-team-member-write-error"
                                tone="danger"
                                role="alert"
                                title={
                                    writeFailure.code === 'access.self_lockout'
                                        ? t('accessAdmin:member.selfLockout')
                                        : writeFailure.message
                                }
                            />
                        )}
                        {remaining === 0 ? (
                            <Callout
                                testID="kitchen-team-member-last-administrator"
                                tone="warning"
                                title={t('accessAdmin:member.lastAdministrator')}
                            />
                        ) : null}
                    </Stack>
                }
            >
                <Stack space="lg">
                    <Card padding="md">
                        <Stack space="sm">
                            <Inline space="sm" align="center" justify="between" wrap>
                                <Heading level={2}>
                                    {t('accessAdmin:member.rolesHeading')}
                                </Heading>
                                <Badge
                                    testID="kitchen-team-member-status"
                                    tone={isWorkingMember(record.status) ? 'success' : 'warning'}
                                    label={t(`accessAdmin:status.${record.status}` as never, {
                                        defaultValue: record.status,
                                    })}
                                />
                            </Inline>
                            <Text tone="secondary">{t('accessAdmin:member.rolesHint')}</Text>

                            <Stack space="xs" testID="kitchen-team-member-roles">
                                {(roles.data ?? []).map((role) => {
                                    const id = String(role.id);
                                    const note = assignmentNote(assignments.get(id));

                                    return (
                                        <Checkbox
                                            key={id}
                                            testID={`kitchen-team-member-role-${role.code}`}
                                            label={locale.startsWith('ar') ? role.nameAr : role.nameEn}
                                            {...(note === null
                                                ? {}
                                                : {
                                                      description: t(
                                                          note === 'scheduled'
                                                              ? 'accessAdmin:member.assignmentScheduled'
                                                              : 'accessAdmin:member.assignmentExpired',
                                                      ),
                                                  })}
                                            checked={held.has(id)}
                                            disabled={!canAssignRoles}
                                            onChange={(on) => {
                                                toggleRole(id, on);
                                            }}
                                        />
                                    );
                                })}
                            </Stack>
                        </Stack>
                    </Card>

                    <Card padding="md">
                        <Stack space="sm">
                            <Heading level={2}>
                                {t('accessAdmin:member.permissionsHeading')}
                            </Heading>
                            <Text tone="secondary">
                                {t('accessAdmin:member.permissionsHint')}
                            </Text>
                            <Inline space="xs" wrap testID="kitchen-team-member-permissions">
                                {record.permissions.map((code) => (
                                    <Badge
                                        key={code}
                                        tone="neutral"
                                        testID={`kitchen-team-member-permission-${code}`}
                                        label={t(`accessAdmin:codes.${code}.name` as never, {
                                            defaultValue: code,
                                        })}
                                    />
                                ))}
                            </Inline>
                        </Stack>
                    </Card>
                </Stack>
            </OpsRecordFrame>

            <Dialog
                testID="kitchen-team-member-end-dialog"
                open={confirmingEnd}
                onClose={() => {
                    setConfirmingEnd(false);
                }}
                title={t('accessAdmin:member.endTitle', { name })}
                description={t('accessAdmin:member.endBody')}
                actions={
                    <>
                        <Button
                            testID="kitchen-team-member-end-cancel"
                            variant="secondary"
                            label={t('accessAdmin:member.cancel')}
                            onPress={() => {
                                setConfirmingEnd(false);
                            }}
                        />
                        <Button
                            testID="kitchen-team-member-end-confirm"
                            label={t('accessAdmin:member.endConfirm')}
                            loading={end.isPending}
                            onPress={() => {
                                lifecycle('end');
                            }}
                        />
                    </>
                }
            />
        </>
    );
}
