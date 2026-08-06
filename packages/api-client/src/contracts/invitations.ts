import type { IsoDateTime, MembershipId } from '@healthy360/domain-types';

/**
 * Taking up an offer of membership, from the acceptor's side of the link.
 *
 * The smallest contract in this package, and deliberately its own rather than two methods bolted
 * onto a neighbour. It exists because the person it serves is nobody yet.
 *
 * ## Why not `PlatformAdminRepository`
 *
 * That contract is the *operator* surface: it issues invitations, from inside a console, behind two
 * platform gates. This one is read by whoever opened the email — who may not work for the platform,
 * may not work for the organisation, and in the common case has never signed in here at all.
 * Folding the acceptor's two calls into the operator's contract would put a method every anonymous
 * visitor needs behind an interface nothing but the console should be holding.
 *
 * ## Why not `AccountRepository`
 *
 * Because the acceptor may not have an account. {@link InvitationsRepository.getInvitation} is
 * answered with no credential at all — the token *is* the credential — and a contract named for the
 * signed-in person's own record is the wrong home for the one call that works before there is a
 * person. The screen's whole job is to be renderable first and to ask for a sign-in second.
 *
 * ## Born real
 *
 * Both methods map onto routes that exist: `GET /api/v1/invitations/{token}` and
 * `POST /api/v1/invitations/{token}/accept`. There is no `PROTOTYPE_ENDPOINTS` entry for either,
 * and the API implementation is a real one — the same standing `PlatformAdminRepository` has. The
 * mock world exists so `mock` mode still boots, not as the only working implementation.
 *
 * ## Two rules this contract encodes rather than documents
 *
 * 1. **The read never returns a full email address.** {@link Invitation.emailMasked} is masked
 *    server-side and there is no unmasked sibling, so no screen can accidentally render one and no
 *    future caller can ask for the real thing. The mask is what makes "you are signed in as the
 *    wrong person" sayable without turning a mailed link into a working address.
 * 2. **The read cannot mutate and the accept cannot be inferred.** `getInvitation` takes a token and
 *    returns facts; nothing about calling it moves the invitation, and a client that polls it is
 *    doing no harm. Acceptance is a separate, deliberate call — which is also why a screen can show
 *    an `accepted` invitation honestly instead of discovering the state by trying.
 *
 * ## What is deliberately absent
 *
 * No `declineInvitation`. The backend has no such route: an invitation somebody does not want is
 * one they let expire, and a method that existed only to reject would be a contract promising a
 * button that cannot be built. No `listInvitations` either — that question belongs to the
 * organisation's own membership screens, which are behind `membership.view_organisation`.
 */

/* ── vocabulary ───────────────────────────────────────────────────────────────────────────────── */

/**
 * The four states an invitation can be in, verbatim from the wire.
 *
 * `pending` is the only one from which acceptance can succeed; the other three are terminal and the
 * screen renders an explanation rather than a button.
 *
 * **There is no `superseded`.** Re-inviting the same address revokes the outstanding offer and
 * issues a new token, so a superseded invitation is a revoked one. A fifth member would name a
 * state the backend cannot produce, and the screen would carry a branch that never runs.
 */
export const INVITATION_STATUSES = ['pending', 'accepted', 'revoked', 'expired'] as const;
export type InvitationStatus = (typeof INVITATION_STATUSES)[number];

/** Whether the accept call could possibly succeed. The one predicate the screen branches on. */
export function isAcceptable(status: InvitationStatus): boolean {
    return status === 'pending';
}

/* ── shapes ───────────────────────────────────────────────────────────────────────────────────── */

/**
 * The organisation, named and nothing more.
 *
 * No identifier and no slug, because the read is anonymous and an endpoint that served them would
 * answer questions about a tenant to anybody holding one link into it. `languageCode` is the
 * organisation's own default, so a name in Arabic renders in the right script and direction even
 * when the visitor's interface is in English.
 */
export interface InvitationOrganisation {
    readonly name: string;
    readonly languageCode: string;
}

/**
 * An invitation as the person holding the link may see it.
 *
 * `roleCode` is the backend's code (`kitchen_owner`, …), not a label. Translating it is the
 * client's job — a server-chosen label would be untranslatable the moment the screen renders in
 * Arabic — and an unknown code is rendered verbatim rather than hidden, so a role added on the
 * backend does not blank out the one line on the screen that says what is being offered.
 */
export interface Invitation {
    /**
     * A plain `string`, not a branded identifier, matching `OwnerInvitation.id` on the operator
     * side. Nothing on this surface addresses an invitation by identifier — the token does that —
     * so a brand would buy no transposition safety, only a codec to keep in step.
     */
    readonly id: string;
    readonly status: InvitationStatus;
    readonly roleCode: string;
    /** `o•••@example.com`. Masked by the server; there is no unmasked form on this surface. */
    readonly emailMasked: string;
    /** Always present, and in the past when `status` is `expired`. */
    readonly expiresAt: IsoDateTime;
    readonly organisation: InvitationOrganisation;
}

/**
 * What acceptance actually did.
 *
 * `membershipCreated` is reported rather than assumed, and `membershipId` is `null` when nothing
 * was granted. The backend is explicit that the membership write arrives through a port whose
 * default grants nothing, so a client that treated a `200` as "you are in" could send somebody to a
 * workspace they cannot enter. The screen shows the success state on `membershipCreated`, not on
 * the absence of an error.
 */
export interface AcceptedInvitation {
    readonly invitation: Invitation;
    readonly membershipCreated: boolean;
    readonly membershipId: MembershipId | null;
}

/* ── the contract ─────────────────────────────────────────────────────────────────────────────── */

export interface InvitationsRepository {
    /**
     * What the link says, before the visitor has decided or signed in anything.
     *
     * Anonymous: the token is the capability. Fails with `resource.not_found` for a token this
     * platform never issued **and** for one whose invitation has been purged — the two are one
     * answer, so a caller cannot use it to discover which tokens are real.
     */
    getInvitation(token: string): Promise<Invitation>;

    /**
     * Take up the offer.
     *
     * Requires a signed-in, email-verified caller whose own address is the one the invitation was
     * sent to. A mismatch is `authz.permission_denied` — the only failure on this path that is
     * allowed to be specific, because the caller already holds a valid token and there is nothing
     * left to conceal.
     */
    acceptInvitation(token: string): Promise<AcceptedInvitation>;
}
