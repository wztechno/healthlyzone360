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
    Select,
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
    useSetMemberScopeMutation,
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
import { useOptimisticConcurrency } from '../use-optimistic-concurrency.ts';
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

/**
 * The `Select` value standing in for "not one branch".
 *
 * A sentinel rather than `null`, because `Select`'s own `null` means "nothing chosen yet" and the
 * whole kitchen is a choice somebody makes. It never leaves this file: `save()` turns it back into
 * the `null` the API is documented to take.
 */
const WHOLE_KITCHEN = '__organisation__';

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
    const scopeWrite = useSetMemberScopeMutation();
    const suspend = useSuspendMemberMutation();
    const reactivate = useReactivateMemberMutation();
    const end = useEndMemberMutation();

    const [selected, setSelected] = useState<ReadonlySet<string> | null>(null);
    // `undefined` is untouched, `null` is the whole kitchen, a string is one branch. Three states
    // because null is a real answer here, not the absence of one.
    const [scope, setScope] = useState<string | null | undefined>(undefined);
    const [confirmingEnd, setConfirmingEnd] = useState(false);

    const guard = useUnsavedGuard({ message: t('kitchen:editor.unsavedMessage') });

    /**
     * The conflict dialog, wired to every write on this screen.
     *
     * Unlike the role editor — where a delete refused over its holders is a `resource.conflict` that
     * is not a lost race — all five membership endpoints are versioned and a conflict from any of
     * them means exactly one thing: somebody else changed this person while this screen was open.
     * Reloading drops the local edits, which is the point of the button.
     */
    const concurrency = useOptimisticConcurrency({
        onReload: () => {
            setSelected(null);
            setScope(undefined);
            guard.markClean();
            void member.refetch();
        },
    });

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

    const branches = member.data?.organisationBranches ?? [];
    const savedScope = record?.branch === null || record?.branch === undefined
        ? null
        : String(record.branch.id);
    const chosenScope = scope === undefined ? savedScope : scope;
    const scopeMoved = scope !== undefined && scope !== savedScope;

    const failure = toFailure(member.error);
    // A captured conflict belongs to the dialog; repeating it in the banner would state the same
    // race twice, and the banner is the copy with no way out of it.
    const writeFailure =
        concurrency.conflict !== null
            ? null
            : (toFailure(scopeWrite.error) ??
              toFailure(setRoles.error) ??
              toFailure(suspend.error) ??
              toFailure(reactivate.error) ??
              toFailure(end.error));

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

    /**
     * One Save for both halves of the record.
     *
     * Scope and roles are two endpoints — a `PATCH` and a `PUT` — but two save buttons on one record
     * is how a person saves half their change and walks away. So they go in sequence, and the roles
     * write takes the lock version the scope write *returned*: the server bumps it on every write,
     * so reusing the version this screen loaded with would make the second call lose to the first.
     */
    function save() {
        if (membershipId === undefined || record === undefined) return;

        if (scopeMoved) {
            scopeWrite.mutate(
                {
                    membership: membershipId,
                    lockVersion: record.lockVersion,
                    branchId: chosenScope,
                },
                {
                    onSuccess: (result) => {
                        saveRoles(result.membership.lockVersion);
                    },
                    onError: (error: unknown) => {
                        concurrency.capture(error);
                    },
                },
            );
            return;
        }

        saveRoles(record.lockVersion);
    }

    function saveRoles(lockVersion: number) {
        if (membershipId === undefined) return;

        setRoles.mutate(
            {
                membership: membershipId,
                lockVersion,
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
                    setScope(undefined);
                    toast.show({
                        message: t('accessAdmin:member.saved', {
                            name,
                            count: result.membership.roles.length,
                        }),
                    });
                },
                onError: (error: unknown) => {
                    concurrency.capture(error);
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
            onError: (error: unknown) => {
                setConfirmingEnd(false);
                concurrency.capture(error);
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
                concurrency={concurrency}
                onSave={save}
                saveLabel={t('accessAdmin:member.save')}
                // Both halves of the chain: a scope write still running is a save still running, and
                // a button that came back to life between the two would take a second press.
                saving={scopeWrite.isPending || setRoles.isPending}
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
                        <Stack space="sm" testID="kitchen-team-member-scope">
                            <Heading level={2}>{t('accessAdmin:member.scopeHeading')}</Heading>
                            <Text tone="secondary">{t('accessAdmin:member.scopeHint')}</Text>

                            {/*
                             * The vocabulary comes from `meta.branches` on the membership read and
                             * from nowhere else: the kitchen workspace cannot list its own branches,
                             * and the session is no help because an organisation-wide membership has
                             * no branches of its own. With no options there is no decision, so the
                             * control says so rather than drawing an empty picker.
                             */}
                            {branches.length === 0 ? (
                                <Text tone="secondary" testID="kitchen-team-member-scope-single">
                                    {t('accessAdmin:member.scopeSingleBranch')}
                                </Text>
                            ) : (
                                <Select
                                    testID="kitchen-team-member-scope-select"
                                    label={t('accessAdmin:member.scopeHeading')}
                                    labelHidden
                                    disabled={!canUpdate}
                                    options={[
                                        {
                                            value: WHOLE_KITCHEN,
                                            label: t('accessAdmin:member.scopeWholeKitchen'),
                                        },
                                        ...branches.map((branch) => ({
                                            value: String(branch.id),
                                            label: branch.name,
                                        })),
                                    ]}
                                    value={chosenScope ?? WHOLE_KITCHEN}
                                    onChange={(next) => {
                                        setScope(next === WHOLE_KITCHEN ? null : next);
                                        guard.markDirty();
                                    }}
                                />
                            )}
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
