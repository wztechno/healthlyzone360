import { ApiError, validationFailure } from '../contracts/failure.ts';
import type {
    AddContactPointRequest,
    ContactPoint,
    ContactPointAdded,
    IssueOtpRequest,
    OtpChallenge,
    OtpChannel,
    OtpVerificationResult,
    ResendOtpRequest,
    VerificationRepository,
    VerifyOtpRequest,
} from '../contracts/verification.ts';
import { OTP_CHANNELS } from '../contracts/verification.ts';
import type {
    AddCustomerContactRequest,
    CustomerContact as WireContact,
    OtpChallengeResult as WireChallengeResult,
    VerificationChallenge as WireChallenge,
} from '../generated/types.ts';
import type { Transport } from './transport.ts';

/**
 * Contact points and the one-time-code framework, over HTTP (plan Phase J1).
 *
 * Four things about this family are not obvious from the endpoint list, and every one of them is a
 * place where the wire and the contract genuinely differ rather than merely spell things
 * differently.
 *
 * ## 1. There is no `POST /otp/challenges`
 *
 * The backend issues challenges from *purpose-specific* endpoints — `POST /verification/email/
 * challenges` for confirming an address, `POST /verification/step-up/challenges` for a step-up, and
 * the guest and signatory flows from their own families. `IssueOtpRequest.purpose` therefore selects
 * the route rather than filling a field, which is why {@link routeForPurpose} exists and why two of
 * the six purposes reject here: `guest_order` and `guest_deletion` are reached with a guest token
 * through `GuestRepository`, and `b2b_signatory` hangs off an agreement. Sending them to an
 * account-scoped endpoint would produce a 404 the panel could not explain.
 *
 * ## 2. `codeLength` is not on the wire
 *
 * Nothing in any challenge payload says how many digits the code has. The contract carries it so an
 * input can size itself without hard-coding six — and six is what every Healthy360 passcode is, so
 * {@link PASSCODE_LENGTH} is a client constant with its name written down rather than a magic
 * number buried in a mapper. The day the backend publishes it, this constant becomes a fallback.
 *
 * ## 3. Two challenge shapes, one model
 *
 * Issuing and resending answer `OtpChallengeResult` — cooldown seconds, available channels,
 * simulation flags, everything a freshly-sent code implies. Re-reading answers
 * `VerificationChallenge`, which is a *status* projection: it has `resend_available_at` but no
 * cooldown seconds, and no channel list at all. Both map to `OtpChallenge`; the re-read derives the
 * cooldown from the instant, and answers an empty channel list rather than inventing one, because
 * "the server did not say what else you could try" and "there is nothing else to try" must not look
 * the same to a lockout screen.
 *
 * ## 4. The address book carries no mask
 *
 * `CustomerContact.value` is served in the clear, deliberately — its audience is the person who
 * typed it, and a masked address book is one nobody can read their own numbers out of. The contract
 * still needs `maskedValue` for the places a full value must not appear, so {@link maskContactValue}
 * derives one here. That is the one place this file computes something the server owns elsewhere,
 * and it is confined to the address book: every mask on a *challenge* — which is where a mask
 * actually matters, because the person is being told where a code went — comes from
 * `destination_masked` and is never recomputed.
 */

/** Every Healthy360 passcode. Stated once, here, rather than assumed at each input. */
export const PASSCODE_LENGTH = 6;

/**
 * Which endpoint issues a challenge for a purpose.
 *
 * `null` for the three purposes this repository cannot reach: two belong to the guest journey and
 * one to agreement signing, and each is issued by the family that owns the thing being proven.
 */
function routeForPurpose(purpose: IssueOtpRequest['purpose']): string | null {
    switch (purpose) {
        case 'contact_verification':
            return '/verification/email/challenges';
        case 'closure_step_up':
        case 'payment_details_step_up':
            return '/verification/step-up/challenges';
        default:
            return null;
    }
}

function knownChannel(value: string): value is OtpChannel {
    return (OTP_CHANNELS as readonly string[]).includes(value);
}

/**
 * Seconds until a resend is accepted, from the instant the server named.
 *
 * Clamped at zero and rounded up: a cooldown of "0.4 seconds left" that the panel renders as `0`
 * would enable a button the server is still going to refuse.
 */
export function cooldownSecondsUntil(resendAvailableAt: string | null | undefined): number {
    if (typeof resendAvailableAt !== 'string' || resendAvailableAt === '') return 0;
    const target = Date.parse(resendAvailableAt);
    if (Number.isNaN(target)) return 0;
    return Math.max(0, Math.ceil((target - Date.now()) / 1000));
}

/**
 * A display mask for a value the endpoint served in the clear.
 *
 * Two shapes, because an address and a number hide different halves: an address keeps its first
 * character and its domain, a number keeps its last four digits and its country prefix. Neither is
 * clever, and neither claims to be the server's mask — anywhere a *challenge* is involved the
 * server's `destination_masked` is used instead.
 */
export function maskContactValue(kind: 'email' | 'phone', value: string): string {
    if (kind === 'email') {
        const at = value.lastIndexOf('@');
        if (at <= 0) return '•••';
        const local = value.slice(0, at);
        const domain = value.slice(at);
        return local.length <= 1 ? `•••${domain}` : `${local[0]!}•••${domain}`;
    }

    const digits = value.replace(/[^\d+]/g, '');
    if (digits.length <= 4) return '•••';
    return `${digits.slice(0, Math.min(4, digits.length - 4))}•••${digits.slice(-4)}`;
}

export function mapContactPoint(wire: WireContact): ContactPoint {
    return {
        id: wire.id,
        kind: wire.channel,
        value: wire.value,
        maskedValue: maskContactValue(wire.channel, wire.value),
        verified: wire.is_verified,
        verifiedAt: wire.verified_at ?? null,
        isPrimary: wire.is_primary,
        isLoginEmail: wire.is_login_identity,
        // The wire marks a contact's creation as optional; the contract requires the moment. An
        // empty string is the package's "the API does not expose this" sentinel (`./mappers.ts`),
        // and a screen renders it as unknown rather than formatting it into 1 January 1970.
        createdAt: wire.created_at ?? '',
    };
}

/** The freshly-sent shape: everything a panel needs the moment a code goes out. */
export function mapIssuedChallenge(wire: WireChallengeResult): OtpChallenge {
    const available = wire.available_channels
        .filter((entry) => knownChannel(entry.channel))
        .map((entry) => ({ channel: entry.channel as OtpChannel, simulated: entry.simulated }));

    return {
        id: wire.challenge_id,
        purpose: wire.purpose,
        channel: wire.channel,
        maskedDestination: wire.destination_masked,
        codeLength: PASSCODE_LENGTH,
        expiresAt: wire.expires_at,
        resendCooldownSeconds: wire.resend_cooldown_seconds,
        attemptsRemaining: wire.attempts_remaining,
        resendsRemaining: wire.resends_remaining,
        availableChannels: available.map((entry) => entry.channel),
        // Non-production only, and derived from the per-channel flag rather than from the
        // challenge-level `simulated`: the panel badges the *channels* that do not really deliver,
        // and the challenge-level flag says only that this one did not.
        simulatedChannels: available
            .filter((entry) => entry.simulated)
            .map((entry) => entry.channel),
    };
}

/**
 * The status shape a re-read answers.
 *
 * `availableChannels` and `simulatedChannels` are empty because this projection carries neither.
 * That is a real loss and it is left visible: a panel that has only re-read a challenge cannot
 * offer "try another way", and it should not pretend it can by echoing the channel it already used.
 */
export function mapChallengeStatus(wire: WireChallenge): OtpChallenge {
    return {
        id: wire.challenge_id,
        purpose: wire.purpose,
        channel: wire.channel,
        maskedDestination: wire.destination_masked,
        codeLength: PASSCODE_LENGTH,
        expiresAt: wire.expires_at,
        resendCooldownSeconds: cooldownSecondsUntil(wire.resend_available_at),
        attemptsRemaining: wire.attempts_remaining,
        resendsRemaining: wire.resends_remaining,
        availableChannels: [],
        simulatedChannels: [],
    };
}

/**
 * A purpose this repository cannot issue.
 *
 * `validation.failed` against the `purpose` field rather than `server`, because it is exactly that:
 * the caller asked for something this surface does not offer, and the field that is wrong is named
 * so a screen can say which. It is a client defect either way — no UI reaches this — but a client
 * defect that names itself is one somebody can fix.
 */
function unreachablePurpose(purpose: string): ApiError {
    return new ApiError(
        validationFailure(
            { purpose: [`Passcodes for ${purpose} are not issued from the account surface.`] },
            {
                message:
                    `A ${purpose} passcode is not issued from the account verification surface. ` +
                    'The guest journey and agreement signing each issue their own.',
            },
        ),
    );
}

export function createApiVerificationRepository(transport: Transport): VerificationRepository {
    return {
        async listContactPoints(): Promise<readonly ContactPoint[]> {
            const wire = await transport.request<WireContact[]>({
                method: 'GET',
                path: '/me/contacts',
            });
            return wire.map(mapContactPoint);
        },

        /**
         * Add, and optionally verify in the same gesture.
         *
         * Two round trips rather than one, because the backend splits them: `POST /me/contacts`
         * creates the row and `POST /verification/email/challenges` sends the code. The contract
         * promises one call answering both, and honouring that here — rather than making every
         * screen remember the sequence — is the whole reason the repository layer exists.
         *
         * The challenge is best-effort: a contact that was created and a code that was not sent is
         * still a contact, and rejecting the whole call would leave the person with a row they
         * cannot see and cannot re-add (`contact.already_in_use` on the second attempt).
         */
        async addContactPoint(request: AddContactPointRequest): Promise<ContactPointAdded> {
            const body: AddCustomerContactRequest = {
                channel: request.kind,
                value: request.value,
            };

            const wire = await transport.request<WireContact>({
                method: 'POST',
                path: '/me/contacts',
                body,
            });

            const contact = mapContactPoint(wire);
            if (request.verifyNow !== true) return { contact, challenge: null };

            try {
                const challenge = await transport.request<WireChallengeResult>({
                    method: 'POST',
                    path: '/verification/email/challenges',
                    body: { contact_id: wire.id },
                });
                return { contact, challenge: mapIssuedChallenge(challenge) };
            } catch {
                return { contact, challenge: null };
            }
        },

        async removeContactPoint(request: { readonly contactPointId: string }): Promise<void> {
            await transport.requestVoid({
                method: 'DELETE',
                path: `/me/contacts/${encodeURIComponent(request.contactPointId)}`,
            });
        },

        async setPrimaryContactPoint(request: {
            readonly contactPointId: string;
        }): Promise<ContactPoint> {
            const wire = await transport.request<WireContact>({
                method: 'POST',
                path: `/me/contacts/${encodeURIComponent(request.contactPointId)}/primary`,
            });
            return mapContactPoint(wire);
        },

        async issueChallenge(request: IssueOtpRequest): Promise<OtpChallenge> {
            const route = routeForPurpose(request.purpose);
            if (route === null) throw unreachablePurpose(request.purpose);

            const wire = await transport.request<WireChallengeResult>({
                method: 'POST',
                path: route,
                body:
                    request.purpose === 'contact_verification'
                        ? {
                              ...(request.contactPointId === undefined
                                  ? {}
                                  : { contact_id: request.contactPointId }),
                              ...(request.channel === undefined
                                  ? {}
                                  : { delivery_channel: request.channel }),
                          }
                        : { purpose: request.purpose },
            });

            return mapIssuedChallenge(wire);
        },

        async getChallenge(request: { readonly challengeId: string }): Promise<OtpChallenge> {
            const wire = await transport.request<WireChallenge>({
                method: 'GET',
                path: `/verification/challenges/${encodeURIComponent(request.challengeId)}`,
            });
            return mapChallengeStatus(wire);
        },

        async resendChallenge(request: ResendOtpRequest): Promise<OtpChallenge> {
            const wire = await transport.request<WireChallengeResult>({
                method: 'POST',
                path: `/verification/challenges/${encodeURIComponent(request.challengeId)}/resend`,
                body: request.channel === undefined ? {} : { delivery_channel: request.channel },
            });
            return mapIssuedChallenge(wire);
        },

        /**
         * Verify, and answer what the verification bought.
         *
         * The endpoint answers a `{ verified, contact }` envelope — it says *what* was proven, not
         * *when* — so `verifiedAt` comes from the contact's own `verified_at` and falls back to now
         * only when the payload omits it. `stepUpUntil` is `null` here by construction: a step-up
         * window is opened by `POST /verification/step-up/confirm`, which is a different call with
         * a different answer, and reporting a window this endpoint never opened would let a screen
         * skip a confirmation the server is still going to demand.
         */
        async verifyChallenge(request: VerifyOtpRequest): Promise<OtpVerificationResult> {
            const wire = await transport.request<{
                verified: true;
                contact?: { id: string; verified_at?: string | null };
            }>({
                method: 'POST',
                path: `/verification/challenges/${encodeURIComponent(request.challengeId)}/verify`,
                body: { code: request.code },
            });

            return {
                challengeId: request.challengeId,
                purpose: 'contact_verification',
                verifiedAt: wire.contact?.verified_at ?? new Date().toISOString(),
                contactPointId: wire.contact?.id ?? null,
                stepUpUntil: null,
            };
        },
    };
}
