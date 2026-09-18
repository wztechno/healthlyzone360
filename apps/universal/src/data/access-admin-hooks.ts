import type {
    CreateRoleRequest,
    CreateStaffAccountRequest,
    CreatedRole,
    CreatedStaffAccount,
    CursorPage,
    InviteStaffRequest,
    LockedMemberRequest,
    OrganisationRole,
    OrganisationRoleSummary,
    PermissionDomain,
    SetMemberRolesRequest,
    SetMemberScopeRequest,
    StaffInvitation,
    StaffInvitationStatus,
    StaffSignInDomain,
    TeamFilter,
    TeamMemberResult,
    TeamMemberSummary,
    UpdateRoleRequest,
} from '@healthy360/api-client/contracts';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { UseMutationResult, UseQueryResult } from '@tanstack/react-query';
import { useCallback } from 'react';

import { useSession } from '../session/session-provider.tsx';
import { queryKeys } from './query-keys.ts';
import { useRepositories, useRepositoryContext } from './repository-provider.tsx';

/**
 * The access console's data access (phase AA1).
 *
 * The house rules apply unchanged — one hook per repository operation, `enabled` guards and
 * invalidation written once, no screen ever holding a repository. Four things are specific here.
 *
 * ## The organisation comes from the session, not from the caller
 *
 * Every endpoint is `/organisations/{organisation}/…`, and the only organisation a screen may
 * address is the one `org.context` already validated — the server answers 404 for any other. So the
 * identifier is read from the session rather than passed in: a screen that could supply it could
 * supply the wrong one, and the only thing that would achieve is a confusing 404.
 *
 * ## Every write invalidates the whole root **and `/me`**
 *
 * The root, for `platform-admin-hooks.ts`'s reason: a role edit changes the role, the list, the
 * permission count on the list and the effective permissions of everybody holding it, and no
 * targeted invalidation reaches all four.
 *
 * `/me` is the addition, and it is the one this console cannot do without. The sidebar, the hub grid
 * and every `<Gate>` read `AccessState.permissions`, which comes from `/me` and nowhere else. An
 * administrator who edits a role they themselves hold and does not refetch it is left with a rail
 * offering pages the server will now refuse — the client and the server disagreeing about the
 * caller's own authority, which is exactly the state a permission console must not produce.
 *
 * It is unconditional rather than guessed at. Working out whether a given edit touched the caller's
 * own effective set is the same computation the backend's lock-out guard performs, and a client that
 * got it wrong would be wrong silently.
 *
 * ## `lockVersion` travels from the screen
 *
 * Every mutation takes it in its argument. A version cached in a hook is the one from the last
 * render, and the whole point of `If-Match` is that it is the version the person was looking at when
 * they pressed the button.
 *
 * ## The lists are plain queries
 *
 * Roles and permissions are bounded sets read whole — a picker that cannot draw its own options is
 * not a picker. The team list is numbered rather than infinite, because a staff list is a table with
 * a page control under it; `keepPreviousData` is what stops it blanking between pages.
 */

/** The organisation every call in this module is scoped to. */
function useConsoleOrganisation(): string | undefined {
    const { accessState } = useSession();
    return accessState.organisation?.id;
}

export function usePermissionCatalogueQuery(
    enabled = true,
): UseQueryResult<readonly PermissionDomain[], unknown> {
    const { repositories } = useRepositoryContext();
    const organisation = useConsoleOrganisation();

    return useQuery({
        queryKey: queryKeys.accessAdmin.permissions(),
        enabled: enabled && repositories !== null && organisation !== undefined,
        // The catalogue is a constant in the backend's source — forty-odd codes that change when
        // somebody deploys, never while a screen is open. Refetching it on every mount would be a
        // request per visit to the editor for an answer that has not moved.
        staleTime: 5 * 60_000,
        queryFn: () => {
            if (repositories === null) throw new Error('Repositories are not ready.');
            if (organisation === undefined) throw new Error('No organisation selected.');
            return repositories.accessAdmin.listPermissions(organisation);
        },
    });
}

export function useOrganisationRolesQuery(
    enabled = true,
): UseQueryResult<readonly OrganisationRoleSummary[], unknown> {
    const { repositories } = useRepositoryContext();
    const organisation = useConsoleOrganisation();

    return useQuery({
        queryKey: queryKeys.accessAdmin.roles(),
        enabled: enabled && repositories !== null && organisation !== undefined,
        queryFn: () => {
            if (repositories === null) throw new Error('Repositories are not ready.');
            if (organisation === undefined) throw new Error('No organisation selected.');
            return repositories.accessAdmin.listRoles(organisation);
        },
    });
}

export function useOrganisationRoleQuery(
    role: string | undefined,
    enabled = true,
): UseQueryResult<OrganisationRole, unknown> {
    const { repositories } = useRepositoryContext();
    const organisation = useConsoleOrganisation();

    return useQuery({
        queryKey: queryKeys.accessAdmin.role(role ?? ''),
        enabled:
            enabled &&
            repositories !== null &&
            organisation !== undefined &&
            role !== undefined &&
            role !== '',
        queryFn: () => {
            if (repositories === null) throw new Error('Repositories are not ready.');
            if (organisation === undefined) throw new Error('No organisation selected.');
            if (role === undefined) throw new Error('No role selected.');
            return repositories.accessAdmin.getRole(organisation, role);
        },
    });
}

export function useTeamQuery(
    filter?: TeamFilter,
    enabled = true,
): UseQueryResult<CursorPage<TeamMemberSummary>, unknown> {
    const { repositories } = useRepositoryContext();
    const organisation = useConsoleOrganisation();

    return useQuery({
        queryKey: queryKeys.accessAdmin.team(filter),
        enabled: enabled && repositories !== null && organisation !== undefined,
        placeholderData: keepPreviousData,
        queryFn: () => {
            if (repositories === null) throw new Error('Repositories are not ready.');
            if (organisation === undefined) throw new Error('No organisation selected.');
            return repositories.accessAdmin.listTeam(organisation, filter);
        },
    });
}

export function useTeamMemberQuery(
    membership: string | undefined,
    enabled = true,
): UseQueryResult<TeamMemberResult, unknown> {
    const { repositories } = useRepositoryContext();
    const organisation = useConsoleOrganisation();

    return useQuery({
        queryKey: queryKeys.accessAdmin.member(membership ?? ''),
        enabled:
            enabled &&
            repositories !== null &&
            organisation !== undefined &&
            membership !== undefined &&
            membership !== '',
        queryFn: () => {
            if (repositories === null) throw new Error('Repositories are not ready.');
            if (organisation === undefined) throw new Error('No organisation selected.');
            if (membership === undefined) throw new Error('No member selected.');
            return repositories.accessAdmin.getTeamMember(organisation, membership);
        },
    });
}

export function useStaffInvitationsQuery(
    status?: StaffInvitationStatus,
    enabled = true,
): UseQueryResult<readonly StaffInvitation[], unknown> {
    const { repositories } = useRepositoryContext();
    const organisation = useConsoleOrganisation();

    return useQuery({
        queryKey: queryKeys.accessAdmin.invitations(status),
        enabled: enabled && repositories !== null && organisation !== undefined,
        queryFn: () => {
            if (repositories === null) throw new Error('Repositories are not ready.');
            if (organisation === undefined) throw new Error('No organisation selected.');
            return repositories.accessAdmin.listInvitations(organisation, status);
        },
    });
}

/**
 * The domains the sign-in screen's picker offers.
 *
 * The one query in this module that needs no organisation and no session: it is read before anybody
 * has signed in, which is the whole reason the endpoint is anonymous.
 */
export function useStaffSignInDomainsQuery(
    enabled = true,
): UseQueryResult<readonly StaffSignInDomain[], unknown> {
    const { repositories } = useRepositoryContext();

    return useQuery({
        queryKey: queryKeys.accessAdmin.signInDomains(),
        enabled: enabled && repositories !== null,
        // It changes when a kitchen is onboarded, not while somebody is typing their password.
        staleTime: 5 * 60_000,
        // A sign-in screen that cannot reach the API must still render its email field. Failing the
        // query blanks the picker and nothing else.
        retry: false,
        queryFn: () => {
            if (repositories === null) throw new Error('Repositories are not ready.');
            return repositories.accessAdmin.listStaffSignInDomains();
        },
    });
}

/**
 * One invalidation, used by every write.
 *
 * See the module docblock for why it is the whole root, and why `/me` goes with it every time.
 */
function useAccessAdminWriteEffects(): () => Promise<void> {
    const client = useQueryClient();

    return useCallback(async () => {
        await Promise.all([
            client.invalidateQueries({ queryKey: queryKeys.accessAdmin.all() }),
            client.invalidateQueries({ queryKey: queryKeys.me() }),
        ]);
    }, [client]);
}

/** The organisation a mutation writes to, resolved at call time rather than captured. */
function useWriteOrganisation(): () => string {
    const organisation = useConsoleOrganisation();

    return useCallback(() => {
        if (organisation === undefined) throw new Error('No organisation selected.');
        return organisation;
    }, [organisation]);
}

export function useCreateRoleMutation(): UseMutationResult<
    CreatedRole,
    unknown,
    CreateRoleRequest
> {
    const repositories = useRepositories();
    const organisation = useWriteOrganisation();
    const onWritten = useAccessAdminWriteEffects();

    return useMutation({
        mutationFn: (request: CreateRoleRequest) =>
            repositories.accessAdmin.createRole(organisation(), request),
        onSuccess: onWritten,
    });
}

export interface UpdateRoleVariables extends UpdateRoleRequest {
    readonly role: string;
}

export function useUpdateRoleMutation(): UseMutationResult<
    OrganisationRole,
    unknown,
    UpdateRoleVariables
> {
    const repositories = useRepositories();
    const organisation = useWriteOrganisation();
    const onWritten = useAccessAdminWriteEffects();

    return useMutation({
        mutationFn: ({ role, ...request }: UpdateRoleVariables) =>
            repositories.accessAdmin.updateRole(organisation(), role, request),
        onSuccess: onWritten,
    });
}

export interface DeleteRoleVariables extends LockedMemberRequest {
    readonly role: string;
}

export function useDeleteRoleMutation(): UseMutationResult<void, unknown, DeleteRoleVariables> {
    const repositories = useRepositories();
    const organisation = useWriteOrganisation();
    const onWritten = useAccessAdminWriteEffects();

    return useMutation({
        mutationFn: ({ role, ...request }: DeleteRoleVariables) =>
            repositories.accessAdmin.deleteRole(organisation(), role, request),
        onSuccess: onWritten,
    });
}

export interface SetMemberRolesVariables extends SetMemberRolesRequest {
    readonly membership: string;
}

export function useSetMemberRolesMutation(): UseMutationResult<
    TeamMemberResult,
    unknown,
    SetMemberRolesVariables
> {
    const repositories = useRepositories();
    const organisation = useWriteOrganisation();
    const onWritten = useAccessAdminWriteEffects();

    return useMutation({
        mutationFn: ({ membership, ...request }: SetMemberRolesVariables) =>
            repositories.accessAdmin.setMemberRoles(organisation(), membership, request),
        onSuccess: onWritten,
    });
}

export interface SetMemberScopeVariables extends SetMemberScopeRequest {
    readonly membership: string;
}

export function useSetMemberScopeMutation(): UseMutationResult<
    TeamMemberResult,
    unknown,
    SetMemberScopeVariables
> {
    const repositories = useRepositories();
    const organisation = useWriteOrganisation();
    const onWritten = useAccessAdminWriteEffects();

    return useMutation({
        mutationFn: ({ membership, ...request }: SetMemberScopeVariables) =>
            repositories.accessAdmin.setMemberScope(organisation(), membership, request),
        onSuccess: onWritten,
    });
}

export interface MemberLifecycleVariables extends LockedMemberRequest {
    readonly membership: string;
}

/**
 * The three lifecycle verbs, built from one factory.
 *
 * They are separate hooks rather than one taking an action string, for the reason the contract gives
 * about the endpoints themselves: a single call taking a verb would let a screen ship a control in
 * which the one irreversible act sits beside two reversible ones.
 */
function useMemberLifecycleMutation(
    action: 'suspendMember' | 'reactivateMember' | 'endMember',
): UseMutationResult<TeamMemberResult, unknown, MemberLifecycleVariables> {
    const repositories = useRepositories();
    const organisation = useWriteOrganisation();
    const onWritten = useAccessAdminWriteEffects();

    return useMutation({
        mutationFn: ({ membership, ...request }: MemberLifecycleVariables) =>
            repositories.accessAdmin[action](organisation(), membership, request),
        onSuccess: onWritten,
    });
}

export function useSuspendMemberMutation(): UseMutationResult<
    TeamMemberResult,
    unknown,
    MemberLifecycleVariables
> {
    return useMemberLifecycleMutation('suspendMember');
}

export function useReactivateMemberMutation(): UseMutationResult<
    TeamMemberResult,
    unknown,
    MemberLifecycleVariables
> {
    return useMemberLifecycleMutation('reactivateMember');
}

export function useEndMemberMutation(): UseMutationResult<
    TeamMemberResult,
    unknown,
    MemberLifecycleVariables
> {
    return useMemberLifecycleMutation('endMember');
}

/**
 * Opening an account outright.
 *
 * The result carries `initialPassword`, which exists on this response and on no read. A screen that
 * discards it cannot fetch it again — which is the property, not a limitation.
 */
export function useCreateStaffAccountMutation(): UseMutationResult<
    CreatedStaffAccount,
    unknown,
    CreateStaffAccountRequest
> {
    const repositories = useRepositories();
    const organisation = useWriteOrganisation();
    const onWritten = useAccessAdminWriteEffects();

    return useMutation({
        mutationFn: (request: CreateStaffAccountRequest) =>
            repositories.accessAdmin.createStaffAccount(organisation(), request),
        onSuccess: onWritten,
    });
}

export function useInviteStaffMutation(): UseMutationResult<
    StaffInvitation,
    unknown,
    InviteStaffRequest
> {
    const repositories = useRepositories();
    const organisation = useWriteOrganisation();
    const onWritten = useAccessAdminWriteEffects();

    return useMutation({
        mutationFn: (request: InviteStaffRequest) =>
            repositories.accessAdmin.inviteStaff(organisation(), request),
        onSuccess: onWritten,
    });
}

export function useRevokeInvitationMutation(): UseMutationResult<void, unknown, string> {
    const repositories = useRepositories();
    const organisation = useWriteOrganisation();
    const onWritten = useAccessAdminWriteEffects();

    return useMutation({
        mutationFn: (invitation: string) =>
            repositories.accessAdmin.revokeInvitation(organisation(), invitation),
        onSuccess: onWritten,
    });
}
