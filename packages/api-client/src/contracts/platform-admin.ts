import type {
    BranchId,
    IsoDateTime,
    MembershipId,
    OrganisationId,
    UserId,
} from '@healthy360/domain-types';

import type { CursorPage, CursorPageRequest } from './pagination.ts';

/**
 * Platform administration of kitchen tenants (plan Phase PA1).
 *
 * The console a Healthy360 operator uses to bring a kitchen onto the platform, hand it to an owner,
 * and — when it comes to it — take it off again. It is the only contract in this package whose
 * subject is *somebody else's tenant*, which is what makes every rule below different from
 * `./kitchen-admin.ts`: that one is a kitchen managing itself, this one is the platform managing
 * kitchens.
 *
 * ## Born real, unlike the nine
 *
 * The prototype families in `../api/prototype-repositories.ts` answer every call with
 * `prototype.not_implemented` because their endpoints do not exist. Every method here maps onto a
 * route that shipped with PA1, so there is no `PROTOTYPE_ENDPOINTS` entry for any of it and the API
 * implementation is a real one. The mock world exists so `mock` mode still boots, not as the only
 * working implementation.
 *
 * ## Five rules this contract encodes rather than documents
 *
 * 1. **Lifecycle is verbs, never a status field.** There is no `updateKitchen({ status })`. There is
 *    {@link PlatformAdminRepository.suspendKitchen} and {@link PlatformAdminRepository.reactivateKitchen},
 *    because they are two different decisions with two different consequences, and a contract that
 *    made them one call with a string argument would let a screen ship a dropdown containing
 *    `closed` — a state that means "offboarded, memberships ended, personal data purged" and that
 *    nothing here may write.
 * 2. **Both lifecycle writes carry a `lockVersion`.** Two operators on one console is the ordinary
 *    case, not the edge case: one of them reactivating while the other suspends is a coin flip that
 *    last-write-wins would settle silently. {@link LockedRequest} is the same shape the kitchen
 *    workspace uses for the same reason.
 * 3. **Ownership is a membership, not a flag.** {@link PlatformKitchenOwner} carries a
 *    `membershipId`, and revoking takes that identifier. It is the truth the backend actually
 *    stores — a membership holding the `organisation_owner` role — and a contract that modelled
 *    ownership as a property of a user would have to invent a second one for every screen.
 * 4. **Revoking the last owner is allowed, and reported.** {@link OwnerRevocation.remainingOwners}
 *    is the whole point of the return shape. A kitchen whose only owner has left has to be able to
 *    have that membership ended before a replacement exists, so the API does not refuse; it returns
 *    the consequence and the console warns. A rule that refused would leave the operator unable to
 *    do the one thing they opened the console to do.
 * 5. **The invitation's role is not a parameter.** {@link InviteOwnerRequest} has no `roleCode`.
 *    A general "invite somebody to an organisation" call already exists for members of that
 *    organisation; this one is the platform naming who will *run* a tenant, and letting the caller
 *    pick the role would collapse the two into one endpoint with a platform gate on it for no
 *    reason.
 *
 * ## What is deliberately absent
 *
 * No `deleteKitchen`. Tenants are suspended, and — through offboarding, which is not this console —
 * closed. Nothing on this platform hard-deletes an organisation, and a method that existed only to
 * throw would be worse than its absence.
 *
 * No branch or catalogue *management*. The counts on {@link PlatformKitchen} are there so an
 * operator can see whether a kitchen is actually trading; the moment the platform could edit a
 * tenant's menu, "who published this" would stop having an answer.
 */

/* ── vocabularies ─────────────────────────────────────────────────────────────────────────────── */

/**
 * The four organisation statuses, verbatim from the backend's `organisations.status` CHECK.
 *
 * `suspended` and `closed` are not synonyms and the console must never draw them the same. A
 * suspended kitchen has been stopped and is expected back — its members keep their memberships and
 * reactivating it is one click. A closed one has been offboarded: every membership ended, the
 * agreement terminated, the personal data purged. Only the first is reversible, which is why
 * {@link PlatformAdminRepository.reactivateKitchen} refuses the second.
 */
export const KITCHEN_TENANT_STATUSES = ['active', 'suspended', 'pending', 'closed'] as const;
export type KitchenTenantStatus = (typeof KITCHEN_TENANT_STATUSES)[number];

/** Whether a kitchen in this status may sell. The one predicate the console branches on. */
export function isTradingStatus(status: KitchenTenantStatus): boolean {
    return status === 'active';
}

/** Whether the console may offer "reactivate" at all. `closed` is terminal. */
export function isReactivatable(status: KitchenTenantStatus): boolean {
    return status === 'suspended' || status === 'pending';
}

/* ── the kitchen ──────────────────────────────────────────────────────────────────────────────── */

/**
 * What a kitchen is selling, in five numbers.
 *
 * The type breakdown counts **published** rows only, because "what is this kitchen selling" is the
 * question the console asks and a half-written draft is not an answer to it. `published` and
 * `draft` beside them are the progress pair and count everything, which is how an operator tells
 * "brand new" apart from "given up".
 */
export interface KitchenCatalogueCounts {
    readonly meals: number;
    readonly products: number;
    readonly plans: number;
    readonly published: number;
    readonly draft: number;
}

/** A kitchen as a row in the console's list. */
export interface PlatformKitchenSummary {
    readonly id: OrganisationId;
    readonly slug: string;
    readonly name: string;
    readonly status: KitchenTenantStatus;
    readonly countryCode: string;
    readonly currencyCode: string;
    readonly languageCode: string;
    readonly branchCount: number;
    readonly activeBranchCount: number;
    readonly ownerCount: number;
    readonly catalogue: KitchenCatalogueCounts;
    /** When the platform suspended it. `null` whenever the status is not `suspended`. */
    readonly suspendedAt: IsoDateTime | null;
    readonly lockVersion: number;
    readonly createdAt: IsoDateTime | null;
}

/**
 * An owner, as the console lists and revokes them.
 *
 * `name` is nullable because a person who has accepted an invitation but never completed a profile
 * has an email address and nothing else, and inventing a display name from the local part of the
 * address is the kind of helpfulness that ends up on a screen next to a revoke button.
 */
export interface PlatformKitchenOwner {
    readonly membershipId: MembershipId;
    readonly userId: UserId;
    readonly name: string | null;
    readonly email: string;
    readonly status: string;
}

export interface PlatformKitchenBranch {
    readonly id: BranchId;
    readonly name: string;
    readonly city: string | null;
    readonly countryCode: string;
    readonly timezone: string;
    readonly status: 'active' | 'closed';
}

/**
 * One kitchen in full.
 *
 * `suspensionReason` is operator prose, not a code. It is cleared on reactivation rather than kept
 * as history — the history of suspensions is the audit log's, which is append-only and records
 * every one, and a stale reason sitting on a trading kitchen would give the console two sources for
 * one fact.
 */
export interface PlatformKitchen extends PlatformKitchenSummary {
    readonly suspensionReason: string | null;
    readonly suspendedBy: UserId | null;
    readonly owners: readonly PlatformKitchenOwner[];
    readonly branches: readonly PlatformKitchenBranch[];
}

/* ── requests ─────────────────────────────────────────────────────────────────────────────────── */

export interface KitchenTenantFilter extends CursorPageRequest {
    readonly status?: KitchenTenantStatus | undefined;
    /** Free text over the name and the slug. */
    readonly query?: string | undefined;
}

/**
 * Everything a kitchen needs to exist and work on its first day.
 *
 * `nameAr` is required even though `organisations` stores a single name: the Arabic goes onto the
 * sales channel the kitchen sells through, which does carry both, and the operator typing the
 * English name knows the Arabic one. A screen that asked three weeks later would get a
 * transliteration.
 *
 * `branchName` and `timezone` are required for the same reason the backend writes a branch in the
 * same transaction — the kitchen workspace gates on a branch, so a kitchen without one is a kitchen
 * whose owner cannot open it.
 */
export interface CreateKitchenRequest {
    readonly nameEn: string;
    readonly nameAr: string;
    readonly slug: string;
    readonly countryCode: string;
    readonly currencyCode: string;
    readonly languageCode: string;
    readonly timezone: string;
    readonly branchName: string;
    readonly city?: string | undefined;
}

/**
 * A write against a row the caller has read, carrying the version it read.
 *
 * Declared here rather than imported from `./kitchen-admin.ts`: the two contracts are independent
 * families and a shared four-line interface would be a dependency edge bought to avoid four lines.
 */
export interface LockedPlatformRequest {
    readonly lockVersion: number;
}

export interface SuspendKitchenRequest extends LockedPlatformRequest {
    /** Operator prose. Optional, because a required reason produces "n/a" and "see ticket". */
    readonly reason?: string | undefined;
}

export interface InviteOwnerRequest {
    readonly email: string;
    /** Used in the email greeting and nowhere else — never stored. */
    readonly name?: string | undefined;
    /** A line from the operator, shown in the invitation email. */
    readonly message?: string | undefined;
}

/* ── results ──────────────────────────────────────────────────────────────────────────────────── */

/**
 * The outcome of inviting an owner.
 *
 * `mailed` is reported honestly rather than assumed. A transport failure does not lose the
 * invitation — the row and its token exist and the operator can re-invite, which supersedes
 * cleanly — but it does mean nobody has been told, and a console that showed an unqualified success
 * would leave an operator waiting for a reply to a message that was never sent.
 */
export interface OwnerInvitation {
    readonly id: string;
    readonly organisationId: OrganisationId;
    readonly email: string;
    readonly status: 'live' | 'accepted' | 'revoked' | 'expired';
    readonly expiresAt: IsoDateTime;
    readonly mailed: boolean;
}

/** The outcome of revoking an owner. See rule 4 on the module docblock for `remainingOwners`. */
export interface OwnerRevocation {
    readonly membershipId: MembershipId;
    readonly userId: UserId;
    readonly status: string;
    /** How many active owners the kitchen has left. `0` is legal, and is the warning. */
    readonly remainingOwners: number;
}

/* ── the repository ───────────────────────────────────────────────────────────────────────────── */

/**
 * The platform operator's surface.
 *
 * Every method here is behind `platform.context` plus `organisation.manage_platform` on the server.
 * The client gate in `@healthy360/permissions` names the same permission, so the sidebar and the
 * route guard cannot drift from what the API would actually allow — but the server remains the
 * boundary, and a screen that skipped the gate would simply receive a 403.
 */
export interface PlatformAdminRepository {
    listKitchens(filter?: KitchenTenantFilter): Promise<CursorPage<PlatformKitchenSummary>>;
    getKitchen(kitchen: OrganisationId | string): Promise<PlatformKitchen>;
    createKitchen(request: CreateKitchenRequest): Promise<PlatformKitchen>;

    suspendKitchen(
        kitchen: OrganisationId | string,
        request: SuspendKitchenRequest,
    ): Promise<PlatformKitchenSummary>;
    reactivateKitchen(
        kitchen: OrganisationId | string,
        request: LockedPlatformRequest,
    ): Promise<PlatformKitchenSummary>;

    inviteOwner(
        kitchen: OrganisationId | string,
        request: InviteOwnerRequest,
    ): Promise<OwnerInvitation>;
    revokeOwner(
        kitchen: OrganisationId | string,
        membership: MembershipId | string,
    ): Promise<OwnerRevocation>;
}
