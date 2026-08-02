import type { IsoDateTime } from '@healthy360/domain-types';

/**
 * Verification contract (plan Phase J1, appendix C keystone tables `otp_challenges` and
 * `contact_points`; appendix E §A.1).
 *
 * This file is deliberately standalone: it is **not** yet a member of the `Repositories` bundle in
 * `./index.ts`. J1's groundwork lands the shapes and the mock world first so that the panel, the
 * error matrix and the fixtures can be built and reviewed against a fixed surface; a follow-up slice
 * registers the repository and wires the query hooks. Declaring it early does not cost anything —
 * an unregistered contract is a type, and a type nobody imports is free.
 *
 * ## The five journey-forced shapes
 *
 * Four of the five sit on {@link OtpChallenge} and one sits on the failure union
 * (`./failure.ts`). Each exists because a *journey* cannot be drawn honestly without it, not
 * because the backend happens to have the column:
 *
 * 1. **`resendCooldownSeconds` on every challenge read.** Not only on the response to a resend. A
 *    person who reloads the page mid-challenge, or returns from their mail client, must see the same
 *    countdown they left — a panel that forgets the cooldown draws an enabled "Send again" button
 *    that is certain to be refused.
 * 2. **`attemptsRemaining` on the failure, not just on the challenge.** The number that matters is
 *    the one *after* the rejected attempt, and it is the rejection that carries it
 *    (`otp.invalid`). A client that decremented its own copy would be guessing, and would guess
 *    wrong the moment two tabs raced.
 * 3. **Lockout details.** `otp.attempts_exceeded` carries `lockedUntil` **and**
 *    `availableChannels`, because a lockout screen that cannot say *when* and cannot offer a way
 *    round is a dead end. The channels are the server's answer to "what else could we send this
 *    to", never the client's guess from a contact list.
 * 4. **Server-authored `maskedDestination`.** The client is never given the address or the number
 *    to mask for itself. Masking rules differ per channel and per market, and a client that
 *    reconstructed `n***@example.com` would both leak more than intended and disagree with the
 *    email the person actually received.
 * 5. **`simulatedChannels`.** Channels whose delivery is a log line rather than a message. Populated
 *    only outside production (plan §3 #16): in production it is always empty, because a channel
 *    that is not real is not offered at all. The panel renders a "not delivered" badge against
 *    these — the alternative is a screen that lies about having sent an SMS.
 */

/**
 * How a code reaches a person.
 *
 * `email` is the only channel with a real driver in production at J1. `sms` and `whatsapp` exist in
 * the vocabulary because the challenge, the lockout fallback and the channel picker all have to
 * name them — but outside local and testing environments they are neither offered nor simulated
 * (gate A-011).
 */
export const OTP_CHANNELS = ['email', 'sms', 'whatsapp'] as const;
export type OtpChannel = (typeof OTP_CHANNELS)[number];

/**
 * Why a challenge exists. Mirrors the backend `otp_challenges.purpose` enum (appendix C).
 *
 * The purpose is carried rather than inferred because the same panel serves all six, and the copy,
 * the destination and what a successful verification *does* differ per purpose. J1 implements
 * `contact_verification`; the rest are declared so the later phases that own them (G1, J2, B1, PAY1)
 * add screens rather than vocabulary.
 */
export const OTP_PURPOSES = [
    'contact_verification',
    'guest_order',
    'guest_deletion',
    'closure_step_up',
    'payment_details_step_up',
    'b2b_signatory',
] as const;
export type OtpPurpose = (typeof OTP_PURPOSES)[number];

/** A contact point is exactly one of these — the `contact_points` CHECK, in the type system. */
export const CONTACT_KINDS = ['email', 'phone'] as const;
export type ContactKind = (typeof CONTACT_KINDS)[number];

/**
 * A live one-time-code challenge.
 *
 * Everything here is server-authored. In particular the client never computes the cooldown, the
 * remaining attempts, the mask or the expiry: all four are properties of a row the server owns, and
 * a second opinion computed on the device would be wrong across a reload, a clock skew or a second
 * tab.
 */
export interface OtpChallenge {
    readonly id: string;
    readonly purpose: OtpPurpose;
    /** The channel this challenge was actually sent on. */
    readonly channel: OtpChannel;
    /** Shape 4: server-authored. Never reconstructed on the device. */
    readonly maskedDestination: string;
    /** How many digits the code has, so the input can size itself without a hard-coded 6. */
    readonly codeLength: number;
    readonly expiresAt: IsoDateTime;
    /** Shape 1: present on *every* read, not only on the response to a resend. */
    readonly resendCooldownSeconds: number;
    /** Attempts left before the challenge locks. Mirrored on `otp.invalid` (shape 2). */
    readonly attemptsRemaining: number;
    /** How many resends remain before the person must start again. */
    readonly resendsRemaining: number;
    /** Channels this challenge may be switched to — the server's list, not the client's guess. */
    readonly availableChannels: readonly OtpChannel[];
    /** Shape 5: non-production only. Always empty in production. */
    readonly simulatedChannels: readonly OtpChannel[];
}

/** A verified-or-not contact address on an account (`contact_points`, §4.9/§4.10). */
export interface ContactPoint {
    readonly id: string;
    readonly kind: ContactKind;
    /** The normalised value, shown to its owner only. Phones are E.164. */
    readonly value: string;
    /** The masked form, for anywhere the full value should not appear. Server-authored. */
    readonly maskedValue: string;
    readonly verified: boolean;
    readonly verifiedAt: IsoDateTime | null;
    /** The one contact of its kind that notifications go to. */
    readonly isPrimary: boolean;
    /** True for the mirror of the sign-in email address, which cannot be removed. */
    readonly isLoginEmail: boolean;
    readonly createdAt: IsoDateTime;
}

export interface AddContactPointRequest {
    readonly kind: ContactKind;
    readonly value: string;
    /** Ask for a challenge in the same round trip — the usual case for "add and verify now". */
    readonly verifyNow?: boolean | undefined;
}

/**
 * The result of adding a contact.
 *
 * `challenge` is `null` when the caller did not ask to verify immediately, rather than the method
 * being overloaded into two shapes: a screen that added a second address and a screen that added it
 * *in order to verify it* are the same screen with a different button.
 */
export interface ContactPointAdded {
    readonly contact: ContactPoint;
    readonly challenge: OtpChallenge | null;
}

export interface IssueOtpRequest {
    readonly purpose: OtpPurpose;
    /** The contact to send to. Omitted only by purposes that derive it (guest flows carry a token). */
    readonly contactPointId?: string | undefined;
    /** Preferred channel. The server may answer on another and says which in the challenge. */
    readonly channel?: OtpChannel | undefined;
}

export interface ResendOtpRequest {
    readonly challengeId: string;
    /**
     * Switch channel while resending — the lockout escape hatch.
     *
     * A resend supersedes the challenge it was asked for: the answer carries a **new** identifier
     * and the old one stops verifying. That is the honest model of "one live challenge per contact
     * per purpose" (appendix C), and it is what stops a person entering a code from the first email
     * after asking for a second one.
     */
    readonly channel?: OtpChannel | undefined;
}

export interface VerifyOtpRequest {
    readonly challengeId: string;
    /** Digits only, already normalised by the input. */
    readonly code: string;
}

/**
 * What a successful verification bought.
 *
 * Both members are nullable because the purposes differ in what they produce: verifying a contact
 * marks a contact point, a step-up opens a time-boxed window, and a guest challenge does neither.
 * A caller reads the one its purpose implies.
 */
export interface OtpVerificationResult {
    readonly challengeId: string;
    readonly purpose: OtpPurpose;
    readonly verifiedAt: IsoDateTime;
    /** Set when the challenge verified a contact point. */
    readonly contactPointId: string | null;
    /** Set for step-up purposes: how long the elevated window stays open. */
    readonly stepUpUntil: IsoDateTime | null;
}

/**
 * Contact points and the OTP framework.
 *
 * Every method rejects with an `ApiError` carrying an `ApiFailure`; the `otp.*` codes in
 * `./failure.ts` are the ones a panel branches on. `getChallenge` exists so that a reload can
 * recover the live challenge — with its cooldown intact — instead of issuing a second one.
 */
export interface VerificationRepository {
    listContactPoints(): Promise<readonly ContactPoint[]>;
    addContactPoint(request: AddContactPointRequest): Promise<ContactPointAdded>;
    removeContactPoint(request: { readonly contactPointId: string }): Promise<void>;
    setPrimaryContactPoint(request: { readonly contactPointId: string }): Promise<ContactPoint>;

    issueChallenge(request: IssueOtpRequest): Promise<OtpChallenge>;
    /** Re-read a live challenge — after a reload, or when returning from a mail client. */
    getChallenge(request: { readonly challengeId: string }): Promise<OtpChallenge>;
    resendChallenge(request: ResendOtpRequest): Promise<OtpChallenge>;
    verifyChallenge(request: VerifyOtpRequest): Promise<OtpVerificationResult>;
}
