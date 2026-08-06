import type { ApiFailure } from '@healthy360/api-client';
import type { Invitation } from '@healthy360/api-client/contracts';

/**
 * The pure part of the invitation screen: what to render, decided once.
 *
 * Kept out of the component so the decision is a value rather than a chain of ternaries buried in
 * JSX, and so the "who is this link for" comparison — the one piece of logic here with a security
 * flavour — is readable on its own.
 */

/** Every terminal or actionable state the screen can be in. */
export type InvitationView =
    /** Still loading, or waiting for the session to settle before deciding what to offer. */
    | { readonly kind: 'loading' }
    /** The token is unknown, purged, or mistyped. One state, deliberately. */
    | { readonly kind: 'not-found'; readonly failure: ApiFailure | null }
    /** Live and readable, but nobody is signed in yet. */
    | { readonly kind: 'signed-out'; readonly invitation: Invitation }
    /** Signed in, but the address has not been confirmed — acceptance requires it. */
    | { readonly kind: 'unverified'; readonly invitation: Invitation }
    /** Signed in as somebody this invitation was not sent to. */
    | {
          readonly kind: 'mismatch';
          readonly invitation: Invitation;
          readonly currentEmail: string;
      }
    /** Ready to accept. */
    | { readonly kind: 'acceptable'; readonly invitation: Invitation }
    /** Taken up — either just now, or before this visit. */
    | {
          readonly kind: 'accepted';
          readonly invitation: Invitation;
          /** `false` when the server accepted but granted no membership. Reported, never assumed. */
          readonly membershipCreated: boolean;
      }
    | { readonly kind: 'expired'; readonly invitation: Invitation }
    | { readonly kind: 'revoked'; readonly invitation: Invitation };

/**
 * The same mask the server applies: first character of the local part, then the domain in full.
 *
 * Reimplemented here rather than imported, because the two exist for opposite reasons. The
 * server's mask is a *redaction* — it decides what leaves the database. This one is a *comparison
 * key*: the screen holds the signed-in person's full address and the invited one only masked, so
 * the only way to ask "are these the same person" client-side is to reduce the address it has to
 * the shape it was given.
 */
export function maskEmail(email: string): string {
    const address = email.trim();
    const at = address.lastIndexOf('@');
    return at <= 0 ? '•••' : `${address.slice(0, 1)}•••${address.slice(at)}`;
}

/**
 * Whether the signed-in address could be the invited one.
 *
 * **"Could be", not "is"** — and the difference matters. Two different addresses can mask to the
 * same string (`omar@x.com` and `olivia@x.com` are both `o•••@x.com`), so a match here is a
 * *possible* match and the server remains the authority. That is why the screen treats a `403` on
 * accept as the mismatch state rather than as an unexpected error: this predicate exists to save a
 * wasted round trip in the common case, never to decide the question.
 *
 * The comparison is case-insensitive on the first character because addresses are, and because the
 * mail client that produced the link may have capitalised it.
 */
export function couldBeInvitee(currentEmail: string, emailMasked: string): boolean {
    return maskEmail(currentEmail).toLowerCase() === emailMasked.trim().toLowerCase();
}

export interface ResolveInvitationViewInput {
    readonly invitation: Invitation | undefined;
    readonly failure: ApiFailure | null;
    readonly isLoading: boolean;
    /** `'restoring'` holds the screen: deciding on a half-restored session flickers. */
    readonly session: 'restoring' | 'authenticated' | 'anonymous';
    readonly emailVerified: boolean;
    readonly currentEmail: string | null;
    /** Set once this visit has accepted, so the screen does not fall back to a re-read. */
    readonly acceptedNow: { readonly membershipCreated: boolean } | null;
    /** True while the accept call rejected with a mismatch the local predicate did not catch. */
    readonly serverRefusedIdentity: boolean;
}

export function resolveInvitationView(input: ResolveInvitationViewInput): InvitationView {
    const {
        invitation,
        failure,
        isLoading,
        session,
        emailVerified,
        currentEmail,
        acceptedNow,
        serverRefusedIdentity,
    } = input;

    if (invitation !== undefined && acceptedNow !== null) {
        return {
            kind: 'accepted',
            invitation,
            membershipCreated: acceptedNow.membershipCreated,
        };
    }

    if (isLoading || session === 'restoring') return { kind: 'loading' };

    if (invitation === undefined) return { kind: 'not-found', failure };

    // The invitation's own state comes first. An expired link is expired whoever is looking at it,
    // and asking somebody to sign in before telling them the link is dead wastes their time.
    if (invitation.status === 'accepted') {
        return { kind: 'accepted', invitation, membershipCreated: true };
    }
    if (invitation.status === 'expired') return { kind: 'expired', invitation };
    if (invitation.status === 'revoked') return { kind: 'revoked', invitation };

    if (session !== 'authenticated' || currentEmail === null) {
        return { kind: 'signed-out', invitation };
    }

    if (serverRefusedIdentity || !couldBeInvitee(currentEmail, invitation.emailMasked)) {
        return { kind: 'mismatch', invitation, currentEmail };
    }

    // Verification is checked *after* identity: telling somebody to confirm an address that is not
    // the one this invitation needs would send them down a dead end.
    if (!emailVerified) return { kind: 'unverified', invitation };

    return { kind: 'acceptable', invitation };
}

/**
 * Whole days between now and the expiry, floored at zero.
 *
 * Floored rather than rounded: "expires in 1 day" when there are ninety minutes left is a promise
 * the clock will break. Zero renders as "expires today", which is true right up to the last minute.
 */
export function daysUntil(expiresAt: string, now: Date = new Date()): number {
    const at = Date.parse(expiresAt);
    if (Number.isNaN(at)) return 0;
    return Math.max(0, Math.floor((at - now.getTime()) / 86_400_000));
}
