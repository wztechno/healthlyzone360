import type { IsoDateTime, MembershipId } from '@healthy360/domain-types';

import type {
    AcceptedInvitation,
    Invitation,
    InvitationStatus,
    InvitationsRepository,
} from '../contracts/invitations.ts';
import type {
    AcceptedInvitationEnvelope,
    PublicInvitation as WirePublicInvitation,
} from '../generated/types.ts';
import { pathSegment } from './marketplace-mappers.ts';
import type { Transport } from './transport.ts';

/**
 * The acceptor's two calls, over the real API (PA1).
 *
 * **Born real.** There is no `PROTOTYPE_ENDPOINTS` entry for either route and no `notImplemented()`
 * stub: `GET /invitations/{token}` and `POST /invitations/{token}/accept` both exist. The mock
 * world beside this file is there so `mock` mode still boots, not because this one does not work.
 *
 * ## The read is `anonymous: true`, deliberately
 *
 * Not "because it happens to work without a token" — because sending one would be wrong. The link
 * is opened by whoever received the email, and the common case is a browser with a stale session
 * belonging to somebody else entirely. An `Authorization` header on this request would make the
 * response depend on an identity the endpoint does not consult, and would make a signed-in visitor
 * and a signed-out one take different code paths through the same screen for no reason.
 *
 * The **accept** call is the opposite and sends the credential as usual: the whole point of that
 * request is which signed-in person is accepting.
 *
 * ## The token is escaped on the way into the path
 *
 * `pathSegment` rather than interpolation. The token is base64-ish and a stray `/` or `+` reaching
 * the path raw would address a different route or a different token, and "the link mostly works"
 * is the worst failure mode available to an invitation.
 */

/* ── mappers ──────────────────────────────────────────────────────────────────────────────────── */

function mapInvitation(wire: WirePublicInvitation): Invitation {
    return {
        id: wire.id,
        status: wire.status as InvitationStatus,
        roleCode: wire.role_code,
        emailMasked: wire.email_masked,
        expiresAt: wire.expires_at as IsoDateTime,
        organisation: {
            name: wire.organisation.name,
            languageCode: wire.organisation.language_code,
        },
    };
}

/**
 * The accept response and the read response are **different shapes**, and this is where that stops
 * mattering to the screen.
 *
 * `POST .../accept` answers with the member-facing `OrganisationInvitation` — full email address,
 * inviter, branch, audit columns — because by then the caller has proved they are the person it was
 * sent to. The screen still renders the same success panel it would have rendered from the read, so
 * the fields it does not need are dropped here rather than widened into the domain shape. In
 * particular the **full address is not carried across**: `emailMasked` is masked again from what
 * the read already established, so no component downstream can start depending on the unmasked one.
 */
function mapAcceptedInvitation(
    wire: AcceptedInvitationEnvelope['data'],
    known: Invitation,
): AcceptedInvitation {
    return {
        invitation: {
            ...known,
            id: wire.invitation.id,
            status: 'accepted',
            roleCode: wire.invitation.role_code,
            expiresAt: wire.invitation.expires_at as IsoDateTime,
        },
        membershipCreated: wire.membership_created,
        membershipId: (wire.membership?.id ?? null) as MembershipId | null,
    };
}

/* ── the repository ───────────────────────────────────────────────────────────────────────────── */

export function createApiInvitationsRepository(transport: Transport): InvitationsRepository {
    async function read(token: string): Promise<Invitation> {
        const payload = await transport.request<{ invitation: WirePublicInvitation }>({
            method: 'GET',
            path: `/invitations/${pathSegment(token)}`,
            anonymous: true,
        });

        return mapInvitation(payload.invitation);
    }

    return {
        getInvitation(token: string): Promise<Invitation> {
            return read(token);
        },

        async acceptInvitation(token: string): Promise<AcceptedInvitation> {
            /*
             * Read first, then accept.
             *
             * Two round trips where one would do, and the second one is the reason: the accept
             * response does not carry the organisation's name, and the success panel says "you have
             * joined Cedar Kitchen". Reading it here rather than making the caller pass it in keeps
             * `acceptInvitation(token)` a call anybody can make from a deep link, including a screen
             * that mounted straight into the accept state after a sign-in round trip and never
             * rendered the invitation.
             *
             * The read is safe to repeat — it consumes nothing — so this costs a request, never a
             * token.
             */
            const known = await read(token);

            const payload = await transport.request<AcceptedInvitationEnvelope['data']>({
                method: 'POST',
                path: `/invitations/${pathSegment(token)}/accept`,
                body: {},
            });

            return mapAcceptedInvitation(payload, known);
        },
    };
}
