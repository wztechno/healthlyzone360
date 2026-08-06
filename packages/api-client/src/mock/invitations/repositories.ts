import type { MembershipId } from '@healthy360/domain-types';

import { apiFailure, permissionDeniedFailure, throwFailure } from '../../contracts/failure.ts';
import type {
    AcceptedInvitation,
    Invitation,
    InvitationsRepository,
} from '../../contracts/invitations.ts';

/**
 * A very small invitation world: one offer the signed-in persona can accept, and one dead link.
 *
 * ## Two rows, and each is a state the screen has to render
 *
 * `MOCK_PENDING_INVITATION_TOKEN` is addressed to whichever account the scenario says a tester
 * signs in as, so the happy path — read, accept, land in the workspace — works without anybody
 * editing a fixture. `MOCK_EXPIRED_INVITATION_TOKEN` is the terminal branch, and it is expired
 * rather than revoked because expiry is the one a real user actually meets: revocation is rare and
 * deliberate, while a link left in an inbox over a long weekend is Tuesday morning.
 *
 * Anything else is `resource.not_found` — the same answer the API gives for a token it never issued
 * *and* for one whose row has been purged, so a screen built against this world cannot come to
 * depend on the two being distinguishable.
 *
 * ## The email mismatch is reachable, and that is the third state
 *
 * A scenario whose persona is not `invitedEmail` — every scenario but the one this world was
 * pointed at — turns the accept call into `authz.permission_denied`, which is exactly what the API
 * does. That is the state the screen has to handle most carefully (somebody clicked a colleague's
 * forwarded link), and a mock world that always succeeded would let it ship untested.
 *
 * ## Masking happens here too
 *
 * The store never holds an unmasked address on the read shape. The real endpoint masks server-side
 * precisely so a client cannot render the full one; a mock that carried it would give a screen
 * something to bind to that the API will never send.
 */

/** The token in the "pending" fixture link. Long enough to look like the real thing. */
export const MOCK_PENDING_INVITATION_TOKEN = 'mock-invitation-pending-0000000000000000';

/** A token whose invitation lapsed last week. */
export const MOCK_EXPIRED_INVITATION_TOKEN = 'mock-invitation-expired-0000000000000000';

export interface InvitationsMockRepositoriesOptions {
    /** Awaited by every method before touching the world. Set to `0` in unit tests. */
    readonly settle: () => Promise<void>;
    /**
     * The address the pending invitation was sent to.
     *
     * The scenario's own primary email, so the tester who signs in as the persona the switcher
     * names can accept without editing anything.
     */
    readonly invitedEmail: string;
    /** The signed-in account's address, or `null` when nobody is signed in. Read per call. */
    readonly currentEmail: () => string | null;
}

export interface InvitationsMockWorld {
    readonly invitations: InvitationsRepository;
    /** Whether the pending invitation has been taken up in this session. Exposed for tests. */
    accepted(): boolean;
}

function mask(email: string): string {
    const at = email.lastIndexOf('@');
    return at <= 0 ? '•••' : `${email.slice(0, 1)}•••${email.slice(at)}`;
}

function notFound(): never {
    throwFailure(
        apiFailure('resource.not_found', {
            message: 'This invitation is no longer valid. Ask for a new one.',
        }),
    );
}

export function createInvitationsMockRepositories(
    options: InvitationsMockRepositoriesOptions,
): InvitationsMockWorld {
    const { settle, invitedEmail, currentEmail } = options;

    let acceptedAt: string | null = null;

    const day = 24 * 60 * 60 * 1000;
    const pendingExpiry = new Date(Date.now() + 5 * day).toISOString();
    const lapsedExpiry = new Date(Date.now() - 7 * day).toISOString();

    function pending(): Invitation {
        return {
            id: '0198c5f2-7d3a-7b1e-9c4d-2f6a8b0e1d40',
            status: acceptedAt === null ? 'pending' : 'accepted',
            roleCode: 'kitchen_owner',
            emailMasked: mask(invitedEmail),
            expiresAt: pendingExpiry,
            organisation: { name: 'Verdant Kitchen', languageCode: 'en' },
        };
    }

    const lapsed: Invitation = {
        id: '0198c5f2-7d3a-7b1e-9c4d-2f6a8b0e1d41',
        status: 'expired',
        roleCode: 'kitchen_manager',
        emailMasked: mask(invitedEmail),
        expiresAt: lapsedExpiry,
        organisation: { name: 'Verdant Kitchen', languageCode: 'en' },
    };

    const invitations: InvitationsRepository = {
        async getInvitation(token: string): Promise<Invitation> {
            await settle();

            if (token === MOCK_PENDING_INVITATION_TOKEN) return pending();
            if (token === MOCK_EXPIRED_INVITATION_TOKEN) return lapsed;

            return notFound();
        },

        async acceptInvitation(token: string): Promise<AcceptedInvitation> {
            await settle();

            if (token !== MOCK_PENDING_INVITATION_TOKEN) {
                // An expired token is a 404 on *accept*, not a state report. The API cannot
                // distinguish "expired" from "never existed" on this path without confirming a
                // guess, and neither does this.
                return notFound();
            }

            const signedInAs = currentEmail();

            if (signedInAs === null) {
                throwFailure(
                    apiFailure('auth.unauthenticated', {
                        message: 'Sign in to accept this invitation.',
                    }),
                );
            }

            if (signedInAs.trim().toLowerCase() !== invitedEmail.trim().toLowerCase()) {
                throwFailure(
                    /*
                     * The structured builder rather than the plain one, because the API's
                     * `authz.permission_denied` always carries `permission` and `reason` and a
                     * screen that branched on them would find them missing in mock mode only.
                     * There is no permission *code* behind this refusal — the gate is identity,
                     * not a role — so the invitation's own action is named instead.
                     */
                    permissionDeniedFailure('invitations.accept', 'email_mismatch', {
                        message:
                            'This invitation was sent to a different email address. Sign in as that person to accept it.',
                    }),
                );
            }

            acceptedAt = new Date().toISOString();

            return {
                invitation: { ...pending(), status: 'accepted' },
                membershipCreated: true,
                membershipId: '0198c5f2-7d3a-7b1e-9c4d-2f6a8b0e1d42' as MembershipId,
            };
        },
    };

    return {
        invitations,
        accepted: () => acceptedAt !== null,
    };
}
