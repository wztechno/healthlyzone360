import type {
    BranchId,
    IsoDateTime,
    MembershipId,
    OrganisationId,
    RoleId,
    UserId,
} from '@healthy360/domain-types';

import type { CursorPage, OffsetPageRequest } from './pagination.ts';

/**
 * A kitchen administering itself: the roles it has defined, what each one reaches, who holds which,
 * and how somebody comes to have a login at all.
 *
 * ## Why this is its own contract
 *
 * Not `./platform-admin.ts` — that one's subject is *somebody else's* tenant, every route behind a
 * platform gate, and it is the only contract in this package whose caller is a Healthy360 operator.
 * Here the subject is the caller's own organisation and there is no platform gate anywhere.
 *
 * Not `./kitchen-admin.ts` either, and the reason is sharper than tidiness. Every record there
 * carries `AdminEntityMeta` with a publication status — draft, review, live, archived. A role has no
 * lifecycle: it exists, it grants things, it is deleted. Folding it in would put a `draft` badge on
 * the editor frame of a role that has been in use for a year, which is `OpsRecordFrame`'s whole
 * complaint about `EditorFrame` stated one contract earlier.
 *
 * ## Six rules this contract encodes rather than documents
 *
 * 1. **A role's grant set is replaced, never patched.** {@link WriteRoleRequest.permissions} is the
 *    codes the role should end up with. There is no `addPermission`/`removePermission` pair, because
 *    an additive API cannot express "take this away" — and taking things away is the half of a role
 *    editor that matters.
 * 2. **A membership's roles are replaced too, in one call.** {@link AccessAdminRepository.setMemberRoles}
 *    takes the whole set. Expressed as add-and-remove it would be three requests with two
 *    intermediate states, one of which is "holds nothing"; on a permission table an intermediate
 *    state is not untidiness, it is authority nobody granted.
 * 3. **Membership lifecycle is verbs, never a status field.** There is no `setMemberStatus`. There is
 *    {@link AccessAdminRepository.suspendMember}, {@link AccessAdminRepository.reactivateMember} and
 *    {@link AccessAdminRepository.endMember}, because a single call taking a string would let a
 *    screen ship a dropdown in which the one irreversible act sits beside three reversible ones.
 *    Branch scope is the exception and is a patch, because where somebody works moves both ways.
 * 4. **A template is readable and not writable.** {@link OrganisationRoleSummary.isSystem} is the
 *    field every screen branches on: the console offers **Copy** on those rows and never Edit.
 *    `updateRole` on one answers `resource.not_found` — from the writing side there is no role at
 *    that identifier belonging to you.
 * 5. **Every write carries a lock version.** Two administrators on one console is the ordinary case,
 *    and what last-write-wins would silently discard here is an authorisation decision.
 * 6. **The initial password is returned once.** {@link CreatedStaffAccount.initialPassword} exists on
 *    the create response and on nothing else — there is no `getStaffPassword`, and a later read of
 *    the same membership does not carry it. The same shape `Invitation` takes to its token.
 *
 * ## What is deliberately absent
 *
 * No `deleteMembership`. A membership is ended, never removed: orders, audit entries and recipe
 * versions point at the person behind it, and who *used* to have access is what an access review
 * reads.
 *
 * No way to make a role a template. `isSystem` is the platform's, and a tenant that could set it
 * would be a tenant defining a role it could then never edit.
 *
 * No `grantPermissionToMember`. Permissions reach people through roles and nothing else — the
 * backend has no table for a direct grant, and a method that existed only to throw would be a
 * contract promising a screen that cannot be built.
 */

/* ── the vocabulary ───────────────────────────────────────────────────────────────────────────── */

/**
 * One permission code, as the role editor's Advanced tab reads it.
 *
 * `description` is the server's English text, and the client falls back to it when it has no
 * translation for the code — the rule `Invitation.roleCode` settles on next door. A code added on
 * the backend tomorrow therefore shows up in the editor rather than as a blank row.
 *
 * `heldByCaller` is information, not a gate. Role management on this platform is total: an
 * administrator may grant an authority they cannot exercise themselves. This is how the editor marks
 * that rather than hiding it, and it is the affordance a stricter rule would need if that decision is
 * ever revisited.
 */
export interface PermissionDefinition {
    readonly code: string;
    readonly description: string;
    readonly heldByCaller: boolean;
}

/** The catalogue, grouped the way the backend groups it — `permissions.domain`, not a code prefix. */
export interface PermissionDomain {
    readonly domain: string;
    readonly permissions: readonly PermissionDefinition[];
}

/* ── roles ────────────────────────────────────────────────────────────────────────────────────── */

/**
 * A role as a list row.
 *
 * `holderCount` is the figure that makes the list actionable: it says which roles are real and which
 * were defined and forgotten, and it is the number that decides whether Delete will be refused.
 *
 * `lockVersion` is `0` on a template and is never checked there. Served anyway, so a client can type
 * one shape for both kinds of row rather than branching on whether a validator arrived.
 */
export interface OrganisationRoleSummary {
    readonly id: RoleId;
    /** Immutable once set — it is what an invitation's `roleCode` resolves against. */
    readonly code: string;
    readonly nameEn: string;
    readonly nameAr: string;
    readonly descriptionEn: string | null;
    readonly descriptionAr: string | null;
    /** A platform template: visible in every tenant, editable in none. Copy, never Edit. */
    readonly isSystem: boolean;
    readonly holderCount: number;
    readonly permissionCount: number;
    readonly lockVersion: number;
    readonly updatedAt: IsoDateTime | null;
}

export interface OrganisationRole extends OrganisationRoleSummary {
    /** Catalogue order, not submission order, so two saves that changed nothing produce the same list. */
    readonly permissions: readonly string[];
    /** Who last changed what this role reaches. `createdBy` cannot answer that. */
    readonly updatedByName: string | null;
}

/** Whether the console may offer Edit and Delete on this row at all. The one predicate it branches on. */
export function isEditableRole(role: OrganisationRoleSummary): boolean {
    return !role.isSystem;
}

/** Whether deleting would be refused. Answered from the row, so the screen need not try it to find out. */
export function isDeletableRole(role: OrganisationRoleSummary): boolean {
    return isEditableRole(role) && role.holderCount === 0;
}

export interface CreateRoleRequest {
    readonly code: string;
    readonly nameEn: string;
    readonly nameAr: string;
    readonly descriptionEn: string | null;
    readonly descriptionAr: string | null;
    readonly permissions: readonly string[];
}

/**
 * `code` is absent, and that is the difference from creating one. Changing it would silently redirect
 * every outstanding invitation naming the old one, and on a role shadowing a template would change
 * which of the two an acceptance resolves to. Renaming, as a person means it, is the two name fields.
 */
export interface UpdateRoleRequest {
    readonly nameEn: string;
    readonly nameAr: string;
    readonly descriptionEn: string | null;
    readonly descriptionAr: string | null;
    readonly permissions: readonly string[];
    readonly lockVersion: number;
}

/**
 * What creating a role reports back.
 *
 * `shadowsTemplate` is true when the kitchen has just defined a role carrying a platform template's
 * code. Permitted — it is the mechanism Copy relies on, because acceptance prefers a tenant's own
 * role over the template of the same code — and reported, because a kitchen that did it deliberately
 * and one that did it by accident type exactly the same thing.
 */
export interface CreatedRole {
    readonly role: OrganisationRole;
    readonly shadowsTemplate: boolean;
}

/* ── people ───────────────────────────────────────────────────────────────────────────────────── */

/**
 * The four membership states, verbatim from the wire.
 *
 * All four, unlike `Membership.status` on `/me` — that one describes the caller's own live
 * memberships, and an ended one is not a workspace they can enter. Here `ended` is a row the list
 * shows behind a filter, because who *used* to have access is exactly what an access review reads.
 */
export const TEAM_MEMBER_STATUSES = ['invited', 'active', 'suspended', 'ended'] as const;
export type TeamMemberStatus = (typeof TEAM_MEMBER_STATUSES)[number];

/** Whether this person can sign in and work today. The predicate the status chip branches on. */
export function isWorkingMember(status: TeamMemberStatus): boolean {
    return status === 'active';
}

/** Whether the console may offer Reactivate. `ended` is terminal — coming back is a new invitation. */
export function isReactivatableMember(status: TeamMemberStatus): boolean {
    return status === 'suspended';
}

export interface TeamMemberRole {
    readonly id: RoleId;
    readonly code: string;
    readonly nameEn: string;
    readonly nameAr: string;
    readonly isSystem: boolean;
}

export interface TeamMemberBranch {
    readonly id: BranchId;
    readonly name: string;
}

/**
 * Somebody who works here.
 *
 * `email` is served in full, unlike `Invitation.emailMasked`. That one is read anonymously, where the
 * address would be a credential; this is read by a member of the organisation holding
 * `membership.view_organisation`, and it is the login identifier — an administrator who cannot see it
 * cannot tell two people with the same name apart.
 *
 * `branch` is null or an object: null means organisation-wide. A boolean beside an identifier would
 * make "organisation-wide, branch A" representable, which is not a thing.
 */
export interface TeamMemberSummary {
    readonly membershipId: MembershipId;
    readonly userId: UserId;
    /** Null until a profile exists; the console renders the address in its place rather than a blank. */
    readonly givenName: string | null;
    readonly familyName: string | null;
    readonly email: string | null;
    readonly status: TeamMemberStatus;
    readonly joinedAt: IsoDateTime | null;
    readonly branch: TeamMemberBranch | null;
    readonly roles: readonly TeamMemberRole[];
    readonly lockVersion: number;
}

/**
 * One assignment, with the window it applies in.
 *
 * Both bounds null is the ordinary case — the role applies now and until somebody removes it. A
 * `startsAt` in the future is a role that has been scheduled; the console shows it and the
 * permission list does not, because the backend's checker applies the same bounds.
 */
export interface MembershipRoleAssignment {
    readonly roleId: RoleId;
    readonly startsAt: IsoDateTime | null;
    readonly expiresAt: IsoDateTime | null;
}

export interface TeamMember extends TeamMemberSummary {
    /**
     * Every assignment, including ones that have not started and ones that have expired. A console
     * that hid a future assignment could not show you what you scheduled — and the editor would drop
     * it on the next save, because a replace writes back what it was shown.
     */
    readonly assignments: readonly MembershipRoleAssignment[];
    /**
     * What the roles add up to. Computed server-side rather than derived here: two roles overlapping
     * is the ordinary case, and a client that got the union wrong would be wrong quietly.
     */
    readonly permissions: readonly string[];
}

/**
 * A membership, and how many administrators would be left.
 *
 * `remainingRoleAdministrators` counts *other* active memberships that can still administer access.
 * It is reported on every read and every write and enforced on neither: removing the last other
 * administrator is permitted, because a console that refuses the thing an operator opened it to do is
 * a control that has made itself unusable. Zero on your own row means nobody else can.
 */
export interface TeamMemberResult {
    readonly membership: TeamMember;
    readonly remainingRoleAdministrators: number;
    /**
     * The organisation's open branches — the scope picker's vocabulary.
     *
     * Here rather than on `TeamMember` because it is a fact about the kitchen, not about the person;
     * and served at all because **nothing else a kitchen can reach lists its own branches.** The
     * admin contract has `getBranchOperating(branchId)` and no `listBranches`, and a membership's own
     * `branches` is *its* scope — empty for the organisation-wide administrator most likely to be
     * setting somebody else's. Deriving the list from colleagues' current branches would hide a
     * branch nobody works at yet, and a picker missing an option drops it on the next save.
     *
     * Present on every read *and* every write, because all five endpoints answer through one
     * assembler and this one mapper: served on the read alone it would come back empty from a save
     * and take the picker with it, mid-edit.
     *
     * Empty means a single-branch kitchen, where there is no scope decision to make.
     */
    readonly organisationBranches: readonly TeamMemberBranch[];
}

/**
 * Numbered pages, like the kitchen's own catalogue screens and for their reason: a staff list is a
 * table with a page control under it, read occasionally and deliberately by the people of one
 * kitchen. The response is still a `CursorPage` — `pagination.ts` explains why a second page type
 * would earn nothing.
 */
export interface TeamFilter extends OffsetPageRequest {
    readonly status?: TeamMemberStatus | undefined;
}

/** A locked write with nothing else to say — the shape suspend, reactivate and end all take. */
export interface LockedMemberRequest {
    readonly lockVersion: number;
}

export interface SetMemberRolesRequest extends LockedMemberRequest {
    /** Empty strips every role while leaving the person a member. Not the same as ending them. */
    readonly roles: readonly MembershipRoleAssignment[];
}

export interface SetMemberScopeRequest extends LockedMemberRequest {
    /** Null means organisation-wide, and is a value rather than an absence. */
    readonly branchId: BranchId | string | null;
}

/* ── letting somebody in ──────────────────────────────────────────────────────────────────────── */

/**
 * Opening an account for somebody who cannot open one themselves.
 *
 * Exactly one of `email` and `localPart`. The second is the whole reason the feature exists: a
 * kitchen hand types `ahmad.khalil` and the organisation's staff domain supplies the rest, so what
 * reaches the server is an ordinary address and nothing in the authentication pipeline learns that
 * this form exists.
 */
export interface CreateStaffAccountRequest {
    readonly email?: string | undefined;
    readonly localPart?: string | undefined;
    readonly givenName: string;
    readonly familyName: string;
    readonly password: string;
    readonly preferredLanguageCode?: string | undefined;
    readonly roleIds: readonly (RoleId | string)[];
    readonly branchId?: BranchId | string | null | undefined;
}

/**
 * What provisioning produced.
 *
 * `initialPassword` is here and on nothing else. There is no method that fetches it later and no read
 * that carries it, which is what makes "shown once" a property of the contract rather than a
 * convention the screen is trusted to keep.
 */
export interface CreatedStaffAccount extends TeamMemberResult {
    readonly initialPassword: string;
}

/** Inviting a colleague who has a mailbox of their own — still the better path when it is available. */
export interface InviteStaffRequest {
    readonly email: string;
    readonly roleCode: string;
    readonly branchId?: BranchId | string | null | undefined;
    readonly message?: string | undefined;
}

export const STAFF_INVITATION_STATUSES = ['live', 'accepted', 'revoked', 'expired'] as const;
export type StaffInvitationStatus = (typeof STAFF_INVITATION_STATUSES)[number];

/**
 * An offer, from the organisation's side of it.
 *
 * `email` is unmasked here for the reason `TeamMemberSummary.email` is: the caller is a member of the
 * organisation that sent it. The acceptor's own view of the same row is masked, and lives in
 * `./invitations.ts`.
 */
export interface StaffInvitation {
    readonly id: string;
    readonly email: string;
    readonly roleCode: string;
    readonly status: StaffInvitationStatus;
    readonly expiresAt: IsoDateTime;
    readonly createdAt: IsoDateTime;
}

/** A staff sign-in domain, as the anonymous picker on the sign-in screen reads it. */
export interface StaffSignInDomain {
    readonly organisationName: string;
    readonly domain: string;
}

/* ── the contract ─────────────────────────────────────────────────────────────────────────────── */

export interface AccessAdminRepository {
    /** The vocabulary a role is written in. Organisation-scoped, assignable codes only. */
    listPermissions(organisation: OrganisationId | string): Promise<readonly PermissionDomain[]>;

    /** Platform templates and the kitchen's own, in one list — from the assigning side they are one set. */
    listRoles(organisation: OrganisationId | string): Promise<readonly OrganisationRoleSummary[]>;
    /** Resolves a template too, because Copy is the only supported way to change what one means. */
    getRole(
        organisation: OrganisationId | string,
        role: RoleId | string,
    ): Promise<OrganisationRole>;
    createRole(
        organisation: OrganisationId | string,
        request: CreateRoleRequest,
    ): Promise<CreatedRole>;
    updateRole(
        organisation: OrganisationId | string,
        role: RoleId | string,
        request: UpdateRoleRequest,
    ): Promise<OrganisationRole>;
    /** Refused with a count while anybody still holds it — the cascade would revoke silently. */
    deleteRole(
        organisation: OrganisationId | string,
        role: RoleId | string,
        request: LockedMemberRequest,
    ): Promise<void>;

    listTeam(
        organisation: OrganisationId | string,
        filter?: TeamFilter,
    ): Promise<CursorPage<TeamMemberSummary>>;
    getTeamMember(
        organisation: OrganisationId | string,
        membership: MembershipId | string,
    ): Promise<TeamMemberResult>;

    setMemberRoles(
        organisation: OrganisationId | string,
        membership: MembershipId | string,
        request: SetMemberRolesRequest,
    ): Promise<TeamMemberResult>;
    setMemberScope(
        organisation: OrganisationId | string,
        membership: MembershipId | string,
        request: SetMemberScopeRequest,
    ): Promise<TeamMemberResult>;
    suspendMember(
        organisation: OrganisationId | string,
        membership: MembershipId | string,
        request: LockedMemberRequest,
    ): Promise<TeamMemberResult>;
    reactivateMember(
        organisation: OrganisationId | string,
        membership: MembershipId | string,
        request: LockedMemberRequest,
    ): Promise<TeamMemberResult>;
    /** Terminal, and stamped rather than removed. */
    endMember(
        organisation: OrganisationId | string,
        membership: MembershipId | string,
        request: LockedMemberRequest,
    ): Promise<TeamMemberResult>;

    /** The password comes back once, in {@link CreatedStaffAccount.initialPassword}. */
    createStaffAccount(
        organisation: OrganisationId | string,
        request: CreateStaffAccountRequest,
    ): Promise<CreatedStaffAccount>;

    /**
     * The invitation trio lives here rather than on `InvitationsRepository`, which is deliberately the
     * *acceptor's* surface — "the person it serves is nobody yet". These are the organisation's side,
     * they had no client at all before this, and the Team screen shows members and outstanding offers
     * in one list.
     */
    inviteStaff(
        organisation: OrganisationId | string,
        request: InviteStaffRequest,
    ): Promise<StaffInvitation>;
    listInvitations(
        organisation: OrganisationId | string,
        status?: StaffInvitationStatus,
    ): Promise<readonly StaffInvitation[]>;
    revokeInvitation(organisation: OrganisationId | string, invitation: string): Promise<void>;

    /**
     * The domains a member of staff signs in under. Anonymous — the sign-in screen renders the picker
     * before anybody has signed in, which is also why this takes no organisation.
     */
    listStaffSignInDomains(): Promise<readonly StaffSignInDomain[]>;
}
