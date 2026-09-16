import { BranchId, MembershipId, RoleId, UserId } from '@healthy360/domain-types';
import type { IsoDateTime, OrganisationId } from '@healthy360/domain-types';

import type {
    AccessAdminRepository,
    CreateRoleRequest,
    CreateStaffAccountRequest,
    CreatedRole,
    CreatedStaffAccount,
    InviteStaffRequest,
    LockedMemberRequest,
    MembershipRoleAssignment,
    OrganisationRole,
    OrganisationRoleSummary,
    PermissionDomain,
    SetMemberRolesRequest,
    SetMemberScopeRequest,
    StaffInvitation,
    StaffInvitationStatus,
    StaffSignInDomain,
    TeamFilter,
    TeamMember,
    TeamMemberBranch,
    TeamMemberResult,
    TeamMemberRole,
    TeamMemberStatus,
    TeamMemberSummary,
    UpdateRoleRequest,
} from '../contracts/access-admin.ts';
import type { CursorPage } from '../contracts/pagination.ts';
import type {
    MembershipRoleAssignment as WireAssignment,
    OrganisationRole as WireRole,
    OrganisationRoleSummary as WireRoleSummary,
    PermissionDomain as WirePermissionDomain,
    StaffSignInDomain as WireSignInDomain,
    TeamMember as WireTeamMember,
    TeamMemberRole as WireTeamMemberRole,
    TeamMemberSummary as WireTeamMemberSummary,
} from '../generated/types.ts';
import type { Transport } from './transport.ts';

/**
 * The access-administration repository, over the real API (AA1).
 *
 * **Born real**, like `platform-admin-repository.ts` and for the same reason: every route this file
 * calls shipped in the phase that added the file, so there is no `PROTOTYPE_ENDPOINTS` entry and no
 * `notImplemented()` stub anywhere in it.
 *
 * ## `If-Match` comes from the caller, never from here
 *
 * Every write takes a `lockVersion` on its request rather than reading one this module remembered.
 * A client-held version is the wrong one by the second call; the one that matters is what the editor
 * currently has on screen. It is why the concurrency handshake is a field on the request type rather
 * than state in this file.
 *
 * ## The wire is snake_case and the domain is not
 *
 * Mapped once per shape, from `../generated/types.ts` — generated from the OpenAPI document — so a
 * backend field that disappears fails the typecheck here rather than turning into `undefined` on a
 * screen.
 */

const BASE = '/organisations';

function organisationPath(organisation: OrganisationId | string, suffix = ''): string {
    return `${BASE}/${encodeURIComponent(organisation)}${suffix}`;
}

/* ── mappers ──────────────────────────────────────────────────────────────────────────────────── */

function mapPermissionDomain(wire: WirePermissionDomain): PermissionDomain {
    return {
        domain: wire.domain,
        permissions: wire.permissions.map((permission) => ({
            code: permission.code,
            description: permission.description,
            heldByCaller: permission.held_by_caller,
        })),
    };
}

function mapRoleSummary(wire: WireRoleSummary): OrganisationRoleSummary {
    return {
        id: RoleId.unsafe(wire.id),
        code: wire.code,
        nameEn: wire.name_en,
        nameAr: wire.name_ar,
        descriptionEn: wire.description_en,
        descriptionAr: wire.description_ar,
        isSystem: wire.is_system,
        holderCount: wire.holder_count,
        permissionCount: wire.permission_count,
        lockVersion: wire.lock_version,
        updatedAt: wire.updated_at as IsoDateTime | null,
    };
}

function mapRole(wire: WireRole): OrganisationRole {
    return {
        ...mapRoleSummary(wire),
        permissions: wire.permissions,
        updatedByName: wire.updated_by_name,
    };
}

function mapMemberRole(wire: WireTeamMemberRole): TeamMemberRole {
    return {
        id: RoleId.unsafe(wire.id),
        code: wire.code,
        nameEn: wire.name_en,
        nameAr: wire.name_ar,
        isSystem: wire.is_system,
    };
}

function mapMemberSummary(wire: WireTeamMemberSummary): TeamMemberSummary {
    return {
        membershipId: MembershipId.unsafe(wire.membership_id),
        userId: UserId.unsafe(wire.user_id),
        givenName: wire.given_name,
        familyName: wire.family_name,
        email: wire.email,
        status: wire.status as TeamMemberStatus,
        joinedAt: wire.joined_at as IsoDateTime | null,
        branch:
            wire.branch === null
                ? null
                : { id: BranchId.unsafe(wire.branch.id), name: wire.branch.name },
        roles: wire.roles.map(mapMemberRole),
        lockVersion: wire.lock_version,
    };
}

/**
 * The two facts every membership response carries beside the record.
 *
 * Read in one place because all six endpoints that answer with a membership — the read, the four
 * writes and staff creation — are assembled by one class on the server for exactly this reason: six
 * near-identical readers are six chances for one of them to drop a field and for a screen to quietly
 * stop warning.
 *
 * Both defaults are the honest reading of an absent field rather than a guess. No count means nobody
 * else is known to remain, which is the direction that warns. No branches means this response named
 * none to offer, so the scope picker does not draw — better a missing control than one that cannot
 * list an option and therefore drops it on the next save.
 */
function mapMemberMeta(meta: unknown): {
    readonly remainingRoleAdministrators: number;
    readonly organisationBranches: readonly TeamMemberBranch[];
} {
    const read = meta as {
        readonly remaining_role_administrators?: number;
        readonly branches?: readonly { readonly id: string; readonly name: string }[];
    };

    return {
        remainingRoleAdministrators: read.remaining_role_administrators ?? 0,
        organisationBranches: (read.branches ?? []).map((branch) => ({
            id: BranchId.unsafe(branch.id),
            name: branch.name,
        })),
    };
}

function mapAssignment(wire: WireAssignment): MembershipRoleAssignment {
    return {
        roleId: RoleId.unsafe(wire.role_id),
        startsAt: wire.starts_at as IsoDateTime | null,
        expiresAt: wire.expires_at as IsoDateTime | null,
    };
}

function mapMember(wire: WireTeamMember): TeamMember {
    return {
        ...mapMemberSummary(wire),
        assignments: wire.assignments.map(mapAssignment),
        permissions: wire.permissions,
    };
}

function mapSignInDomain(wire: WireSignInDomain): StaffSignInDomain {
    return { organisationName: wire.organisation_name, domain: wire.domain };
}

/** The wire shape every invitation endpoint answers with, narrowed to what this surface reads. */
interface WireInvitation {
    readonly id: string;
    readonly email?: string | null;
    readonly email_masked?: string | null;
    readonly role_code: string;
    readonly status: string;
    readonly expires_at: string;
    readonly created_at?: string | null;
}

function mapInvitation(wire: WireInvitation): StaffInvitation {
    return {
        id: wire.id,
        // The organisation's own view is unmasked; the masked field is the acceptor's. Preferring the
        // full one and falling back keeps this working whichever the server sends.
        email: wire.email ?? wire.email_masked ?? '',
        roleCode: wire.role_code,
        status: wire.status as StaffInvitationStatus,
        expiresAt: wire.expires_at as IsoDateTime,
        createdAt: (wire.created_at ?? wire.expires_at) as IsoDateTime,
    };
}

/** The `If-Match` header a lock-versioned write sends, in the form the server compares. */
function ifMatch(lockVersion: number): Record<string, string> {
    return { 'If-Match': `"${lockVersion}"` };
}

/** The `{data: {membership}, meta: {remaining_role_administrators}}` shape every member write returns. */
interface WireMemberEnvelope {
    readonly membership: WireTeamMember;
}

/* ── the repository ───────────────────────────────────────────────────────────────────────────── */

export function createApiAccessAdminRepository(transport: Transport): AccessAdminRepository {
    async function memberResult(
        method: 'GET' | 'PUT' | 'PATCH' | 'POST',
        path: string,
        options: { readonly headers?: Record<string, string>; readonly body?: unknown } = {},
    ): Promise<TeamMemberResult> {
        const envelope = await transport.requestEnvelope<WireMemberEnvelope>({
            method,
            path,
            ...(options.headers === undefined ? {} : { headers: options.headers }),
            ...(options.body === undefined ? {} : { body: options.body }),
        });

        return {
            membership: mapMember(envelope.data.membership),
            ...mapMemberMeta(envelope.meta),
        };
    }

    return {
        async listPermissions(organisation): Promise<readonly PermissionDomain[]> {
            const payload = await transport.request<{ readonly domains: WirePermissionDomain[] }>({
                method: 'GET',
                path: organisationPath(organisation, '/permissions'),
            });

            return payload.domains.map(mapPermissionDomain);
        },

        async listRoles(organisation): Promise<readonly OrganisationRoleSummary[]> {
            const roles = await transport.request<WireRoleSummary[]>({
                method: 'GET',
                path: organisationPath(organisation, '/roles'),
            });

            return roles.map(mapRoleSummary);
        },

        async getRole(organisation, role): Promise<OrganisationRole> {
            const payload = await transport.request<{ readonly role: WireRole }>({
                method: 'GET',
                path: organisationPath(organisation, `/roles/${encodeURIComponent(role)}`),
            });

            return mapRole(payload.role);
        },

        async createRole(organisation, request: CreateRoleRequest): Promise<CreatedRole> {
            const envelope = await transport.requestEnvelope<{ readonly role: WireRole }>({
                method: 'POST',
                path: organisationPath(organisation, '/roles'),
                body: {
                    code: request.code,
                    name_en: request.nameEn,
                    name_ar: request.nameAr,
                    description_en: request.descriptionEn,
                    description_ar: request.descriptionAr,
                    permissions: request.permissions,
                },
            });

            const meta = envelope.meta as { readonly shadows_template?: boolean };

            return {
                role: mapRole(envelope.data.role),
                shadowsTemplate: meta.shadows_template ?? false,
            };
        },

        async updateRole(organisation, role, request: UpdateRoleRequest): Promise<OrganisationRole> {
            const payload = await transport.request<{ readonly role: WireRole }>({
                method: 'PATCH',
                path: organisationPath(organisation, `/roles/${encodeURIComponent(role)}`),
                headers: ifMatch(request.lockVersion),
                body: {
                    name_en: request.nameEn,
                    name_ar: request.nameAr,
                    description_en: request.descriptionEn,
                    description_ar: request.descriptionAr,
                    permissions: request.permissions,
                },
            });

            return mapRole(payload.role);
        },

        async deleteRole(organisation, role, request: LockedMemberRequest): Promise<void> {
            await transport.request<null>({
                method: 'DELETE',
                path: organisationPath(organisation, `/roles/${encodeURIComponent(role)}`),
                headers: ifMatch(request.lockVersion),
            });
        },

        async listTeam(organisation, filter?: TeamFilter): Promise<CursorPage<TeamMemberSummary>> {
            const search = new URLSearchParams();

            if (filter?.page !== undefined) search.set('page', String(filter.page));
            if (filter?.perPage !== undefined) search.set('per_page', String(filter.perPage));
            if (filter?.status !== undefined) search.set('status', filter.status);

            const rendered = search.toString();
            const path = organisationPath(organisation, '/memberships');

            const envelope = await transport.requestEnvelope<WireTeamMemberSummary[]>({
                method: 'GET',
                path: rendered === '' ? path : `${path}?${rendered}`,
            });

            const meta = envelope.meta as {
                readonly total_count?: number;
                readonly total_pages?: number;
                readonly page?: number;
            };

            const totalPages = meta.total_pages ?? 0;
            const page = meta.page ?? 1;

            return {
                items: envelope.data.map(mapMemberSummary),
                // A numbered page hands out no cursor — `pagination.ts` sets out why the response
                // type is still a `CursorPage` and what these two fields mean on one.
                nextCursor: null,
                hasMore: page < totalPages,
                totalCount: meta.total_count ?? null,
            };
        },

        getTeamMember(organisation, membership): Promise<TeamMemberResult> {
            return memberResult(
                'GET',
                organisationPath(organisation, `/memberships/${encodeURIComponent(membership)}`),
            );
        },

        setMemberRoles(organisation, membership, request: SetMemberRolesRequest) {
            return memberResult(
                'PUT',
                organisationPath(
                    organisation,
                    `/memberships/${encodeURIComponent(membership)}/roles`,
                ),
                {
                    headers: ifMatch(request.lockVersion),
                    body: {
                        roles: request.roles.map((assignment) => ({
                            role_id: assignment.roleId,
                            starts_at: assignment.startsAt,
                            expires_at: assignment.expiresAt,
                        })),
                    },
                },
            );
        },

        setMemberScope(organisation, membership, request: SetMemberScopeRequest) {
            return memberResult(
                'PATCH',
                organisationPath(organisation, `/memberships/${encodeURIComponent(membership)}`),
                {
                    headers: ifMatch(request.lockVersion),
                    // Sent even when null, because `present` is what distinguishes "make this person
                    // organisation-wide" from "I forgot the field" on a PATCH.
                    body: { branch_id: request.branchId },
                },
            );
        },

        suspendMember(organisation, membership, request: LockedMemberRequest) {
            return memberResult(
                'POST',
                organisationPath(
                    organisation,
                    `/memberships/${encodeURIComponent(membership)}/suspend`,
                ),
                { headers: ifMatch(request.lockVersion) },
            );
        },

        reactivateMember(organisation, membership, request: LockedMemberRequest) {
            return memberResult(
                'POST',
                organisationPath(
                    organisation,
                    `/memberships/${encodeURIComponent(membership)}/reactivate`,
                ),
                { headers: ifMatch(request.lockVersion) },
            );
        },

        endMember(organisation, membership, request: LockedMemberRequest) {
            return memberResult(
                'POST',
                organisationPath(organisation, `/memberships/${encodeURIComponent(membership)}/end`),
                { headers: ifMatch(request.lockVersion) },
            );
        },

        async createStaffAccount(
            organisation,
            request: CreateStaffAccountRequest,
        ): Promise<CreatedStaffAccount> {
            const envelope = await transport.requestEnvelope<
                WireMemberEnvelope & { readonly initial_password: string }
            >({
                method: 'POST',
                path: organisationPath(organisation, '/staff'),
                // The console generates the key so a double submission is a replay rather than a
                // second person with a second password. `crypto.randomUUID` is available on every
                // runtime this client targets.
                headers: { 'Idempotency-Key': crypto.randomUUID() },
                body: {
                    ...(request.email === undefined ? {} : { email: request.email }),
                    ...(request.localPart === undefined ? {} : { local_part: request.localPart }),
                    given_name: request.givenName,
                    family_name: request.familyName,
                    password: request.password,
                    preferred_language_code: request.preferredLanguageCode ?? null,
                    role_ids: request.roleIds,
                    branch_id: request.branchId ?? null,
                },
            });

            return {
                membership: mapMember(envelope.data.membership),
                ...mapMemberMeta(envelope.meta),
                initialPassword: envelope.data.initial_password,
            };
        },

        async inviteStaff(organisation, request: InviteStaffRequest): Promise<StaffInvitation> {
            const payload = await transport.request<{ readonly invitation: WireInvitation }>({
                method: 'POST',
                path: organisationPath(organisation, '/invitations'),
                body: {
                    email: request.email,
                    role_code: request.roleCode,
                    branch_id: request.branchId ?? null,
                    message: request.message ?? null,
                },
            });

            return mapInvitation(payload.invitation);
        },

        async listInvitations(
            organisation,
            status?: StaffInvitationStatus,
        ): Promise<readonly StaffInvitation[]> {
            const path = organisationPath(organisation, '/invitations');

            const invitations = await transport.request<WireInvitation[]>({
                method: 'GET',
                path: status === undefined ? path : `${path}?status=${encodeURIComponent(status)}`,
            });

            return invitations.map(mapInvitation);
        },

        async revokeInvitation(organisation, invitation): Promise<void> {
            await transport.request<null>({
                method: 'DELETE',
                path: organisationPath(
                    organisation,
                    `/invitations/${encodeURIComponent(invitation)}`,
                ),
            });
        },

        async listStaffSignInDomains(): Promise<readonly StaffSignInDomain[]> {
            const payload = await transport.request<{ readonly domains: WireSignInDomain[] }>({
                method: 'GET',
                // No organisation: the sign-in screen renders this picker before anybody has signed
                // in, which is the whole reason the endpoint is anonymous.
                path: '/auth/staff-domains',
            });

            return payload.domains.map(mapSignInDomain);
        },
    };
}
