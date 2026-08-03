import type { CartId, IsoDateTime, Money, OrderId } from '@healthy360/domain-types';

import type { DeliveryAddress, PriceLine } from './commerce.ts';
import type { OtpChallenge, OtpChannel } from './verification.ts';

/**
 * The guest journey — ordering without an account, and leaving without one (plan Phase G1,
 * appendix E §A.3).
 *
 * Standalone for the same reason `./verification.ts` and `./account.ts` are: the shapes and the
 * mock world land first, and the integrator wave registers the repository in the `Repositories`
 * bundle and wires the HTTP surface. Nothing above this package imports it yet.
 *
 * ## The three rules this contract encodes rather than documents
 *
 * - **A guest token is graded, and the grade is raised only by proof.** {@link GuestSession} carries
 *   `grade` *and* the derived `capabilities`, because the client must never work out for itself
 *   whether a basket may become an order. `checkout_draft` builds and prices a basket, which
 *   creates an obligation to nobody. `place_order` requires a contact point a passcode has proven,
 *   because an order is a promise that somebody will be told when it is late, and a destination
 *   nobody proved is a promise made to a typo. The backend makes this structural — a database
 *   CHECK refuses the higher grade without the proof — so a client that guessed would merely be
 *   refused later and less clearly.
 * - **There is no card, anywhere.** {@link GuestCheckoutDraft} has exactly one payment method and it
 *   is `cash_on_delivery`. Not a union with one member for now, not an optional instrument
 *   reference, not a token field left null: a guest checkout that *could* carry a card is one that
 *   somebody eventually wires to a live gateway, and a person who never made an account has nowhere
 *   for a stored instrument to live in the first place.
 * - **Deletion answers the same way whether or not there is anything to delete.**
 *   {@link GuestDeletionAcknowledgement} is derived entirely from the request — the masked
 *   destination is masked from what the caller just typed, the timings come from configuration —
 *   and carries **no challenge identifier**, because a nullable identifier is a boolean in disguise
 *   and that boolean is "this address is known to us": exactly the fact an unauthenticated erasure
 *   endpoint must not disclose. The screen's script is therefore identical in both cases.
 */

/* ── the session and its grade ────────────────────────────────────────────────────────────────── */

/**
 * How much a guest token is allowed to do. Mirrors the backend `guest_sessions.grade` enum.
 *
 * Two values, and the ordering between them is total. A third grade later is a deliberate
 * conversation with every screen that reads one, which is why this is a named vocabulary rather
 * than a number.
 */
export const GUEST_SESSION_GRADES = ['checkout_draft', 'place_order'] as const;
export type GuestSessionGrade = (typeof GUEST_SESSION_GRADES)[number];

/**
 * What a token may actually *do*, named for the action rather than for the grade.
 *
 * Carried alongside `grade` rather than derived from it on the device. The two are redundant today
 * and that is the point: a screen asks "may I place an order" and gets an answer, so the day the
 * server refuses for a reason the grade does not express — a suspended account, a market that is
 * closed, a retention window that has run out — the button is already reading the right field.
 */
export const GUEST_CAPABILITIES = [
    'build_basket',
    'price_basket',
    'place_order',
    'request_deletion',
] as const;
export type GuestCapability = (typeof GUEST_CAPABILITIES)[number];

/**
 * A live guest session.
 *
 * `token` is present **only** on the answer to {@link GuestRepository.startSession} — it is the one
 * moment the plaintext exists, and the backend stores a digest. Every later read carries `null`
 * there, so a session object that leaks into a log or a cache entry cannot be replayed.
 */
export interface GuestSession {
    readonly id: string;
    /**
     * The plaintext token, on the answer to `startSession` and nowhere else.
     *
     * `null` on every subsequent read. A caller hands it to the token store once and never reads it
     * back off a session again.
     */
    readonly token: string | null;
    readonly grade: GuestSessionGrade;
    /** The server's answer to "what may this token do". Never recomputed from `grade`. */
    readonly capabilities: readonly GuestCapability[];
    /**
     * Whether a contact point has been proven by a passcode.
     *
     * The single fact that gates placing an order, stated as itself rather than left to be inferred
     * from the grade — a checkout screen shows a verification step because of *this*, and shows it
     * before it knows what grade the promotion will produce.
     */
    readonly contactVerified: boolean;
    /** The contact this session will be reached on. `null` until one has been given. */
    readonly contact: GuestContact | null;
    /** When the token stops resolving. A guest session is deliberately short. */
    readonly expiresAt: IsoDateTime;
    /**
     * When the provisional account behind it is purged if nothing more happens.
     *
     * Later than `expiresAt`: the token dies first, the data a little after, so a person who comes
     * back within the window can still be recognised by the order reference they were given.
     */
    readonly dataExpiresAt: IsoDateTime;
    readonly createdAt: IsoDateTime;
}

/** How a guest asked to be contacted. Mirrors `contact_points` without the account vocabulary. */
export interface GuestContact {
    readonly id: string;
    /** Exactly one is set; `updateContact` refuses a request that sets neither. */
    readonly email: string | null;
    readonly mobile: string | null;
    /** Server-authored mask, for anywhere the full value should not appear. */
    readonly maskedDestination: string;
    readonly fullName: string;
    /** Which channel the person asked to be reached on. The server may answer on another. */
    readonly preferredChannel: OtpChannel;
    readonly verified: boolean;
    readonly verifiedAt: IsoDateTime | null;
}

export interface StartGuestSessionRequest {
    /** An existing basket to adopt, when the person built one before the session existed. */
    readonly cartId?: CartId | undefined;
}

export interface UpdateGuestContactRequest {
    readonly fullName: string;
    /** At least one of the two. Both is allowed; neither is a validation failure. */
    readonly email?: string | undefined;
    readonly mobile?: string | undefined;
    readonly preferredChannel?: OtpChannel | undefined;
}

/**
 * The answer to giving a contact: the contact, and the challenge that will prove it.
 *
 * One shape rather than two calls, because a guest has no contact list and no reason to add an
 * address except in order to verify it. `challenge` is nevertheless nullable — a person correcting
 * a typo inside the resend cooldown gets their contact updated and the live challenge back.
 */
export interface GuestContactChallenge {
    readonly contact: GuestContact;
    readonly challenge: OtpChallenge | null;
}

export interface ConfirmGuestContactRequest {
    readonly challengeId: string;
    /** Digits only, already normalised by the input. */
    readonly code: string;
}

/* ── the order ────────────────────────────────────────────────────────────────────────────────── */

/**
 * The only payment method a guest checkout has.
 *
 * A one-member union on purpose. It is not an optional field, not a nullable instrument reference
 * and not an enum with the others commented out — there is no shape here that a card could be
 * poured into without changing this line, which is exactly the property being bought.
 */
export const GUEST_PAYMENT_METHODS = ['cash_on_delivery'] as const;
export type GuestPaymentMethod = (typeof GUEST_PAYMENT_METHODS)[number];

/** Everything the order needs, and nothing that could become a payment instrument. */
export interface GuestCheckoutDraft {
    readonly cartId: CartId;
    readonly address: DeliveryAddress;
    /**
     * The saved address row this order is delivered to.
     *
     * Separate from {@link GuestCheckoutDraft.address}, which is the value object a review screen
     * *renders*. The order is placed against an identifier because delivery is resolved from the
     * address's service area — a zone, a window, a fee — and a typed street line cannot be resolved
     * to any of them. Optional because the fixture world matches on the value object and has no row
     * to point at; against the real API it is required, and a draft without it is refused naming
     * this field rather than silently placing an order nobody can deliver.
     */
    readonly addressId?: string | undefined;
    readonly slotCode: string;
    /** `YYYY-MM-DD`. */
    readonly deliveryDate: string;
    readonly paymentMethod: GuestPaymentMethod;
    /**
     * Whether the person asked to hear from us again.
     *
     * **Defaults to off and is sent explicitly.** An opt-in that arrives absent is an opt-in
     * somebody has to decide the meaning of, and the two readings — "they left it alone" and "they
     * turned it off" — must never be distinguishable to the server.
     */
    readonly marketingOptIn: boolean;
    readonly notes?: string | undefined;
}

export const GUEST_ORDER_STATES = [
    'placed',
    'confirmed',
    'preparing',
    'out_for_delivery',
    'delivered',
    'cancelled',
] as const;
export type GuestOrderState = (typeof GUEST_ORDER_STATES)[number];

export interface GuestOrderLine {
    readonly id: string;
    readonly name: string;
    readonly quantity: number;
    readonly unitPrice: Money;
    readonly lineTotal: Money;
}

/**
 * A placed order, as a guest may read it.
 *
 * `reference` is the human-quotable string — the thing a person writes down, reads over a phone or
 * finds in a confirmation message. `id` is the identifier the system uses. Both are present because
 * conflating them produces either an unreadable reference or a guessable identifier.
 */
export interface GuestOrder {
    readonly id: OrderId;
    readonly reference: string;
    readonly state: GuestOrderState;
    readonly lines: readonly GuestOrderLine[];
    readonly priceLines: readonly PriceLine[];
    readonly total: Money;
    readonly paymentMethod: GuestPaymentMethod;
    readonly address: DeliveryAddress;
    readonly slotCode: string;
    readonly deliveryDate: string;
    readonly contact: GuestContact;
    readonly placedAt: IsoDateTime;
}

/* ── conversion ───────────────────────────────────────────────────────────────────────────────── */

/**
 * What a guest is offered after their order is placed.
 *
 * The prompt is **pre-filled and refusable**. Pre-filled because everything an account needs is
 * already known — the name, the contact, the address — and asking for it again is asking somebody
 * to prove they meant it. Refusable *visibly*, because a conversion prompt with no way past it is a
 * registration wall wearing a different hat, and this journey exists precisely to not have one.
 */
export interface GuestConversionPrefill {
    readonly fullName: string;
    readonly email: string | null;
    readonly mobile: string | null;
    /** True when the contact is already proven, so the new account skips a second passcode. */
    readonly contactVerified: boolean;
    /** Orders that will be carried onto the account. Named so the prompt can say how many. */
    readonly orderReferences: readonly string[];
}

export interface ConvertGuestRequest {
    readonly password: string;
    /** Echoed back so a changed name is captured with the decision that produced it. */
    readonly fullName: string;
    /**
     * Marketing consent for the *account*, decided again rather than inherited.
     *
     * A guest's checkout opt-in was about one order. Carrying it silently onto a standing account
     * would be a consent nobody gave.
     */
    readonly marketingOptIn: boolean;
}

/**
 * The result of becoming an account holder.
 *
 * `sessionToken` is a **session** token, not a guest token: the guest token is revoked by this call
 * and the caller clears its store. Returning both would invite a client to keep the dead one.
 */
export interface GuestConversionResult {
    readonly accountId: string;
    readonly sessionToken: string;
    /** Orders carried over, so the confirmation can name them rather than claim vaguely. */
    readonly orderReferences: readonly string[];
    readonly convertedAt: IsoDateTime;
}

/* ── deletion ─────────────────────────────────────────────────────────────────────────────────── */

export interface RequestGuestDeletionRequest {
    /** Exactly one of the two, exactly as the contact form collects it. */
    readonly email?: string | undefined;
    readonly mobile?: string | undefined;
}

/**
 * The answer to "delete everything you hold about this address" — and it is the same answer whether
 * or not there is anything to delete.
 *
 * Every field is derived from the *request*. There is deliberately no challenge identifier: see the
 * file header. `accepted` is always `true` and is present anyway, so a screen reads a field rather
 * than inferring acceptance from the absence of an error.
 */
export interface GuestDeletionAcknowledgement {
    readonly accepted: true;
    /** Masked from the value the caller just submitted, without a lookup having happened. */
    readonly destinationMasked: string;
    readonly verificationRequired: boolean;
    readonly expiresInSeconds: number;
    readonly codeLength: number;
}

export interface ConfirmGuestDeletionRequest {
    readonly email?: string | undefined;
    readonly mobile?: string | undefined;
    readonly code: string;
}

/**
 * The answer to a confirmed deletion — also always accepted-shaped.
 *
 * `purged` is **not** a count and **not** a boolean about whether anything was found. It says only
 * that the request was carried out, because "we deleted 0 things" and "we deleted 4 things" are the
 * same enumeration oracle the 202 exists to refuse. A wrong code fails the way a wrong code always
 * fails (`otp.invalid`), which is indistinguishable from an address nobody holds data for.
 */
export interface GuestDeletionOutcome {
    readonly accepted: true;
    /** When erasure completes. Immediate for guest data; stated so the screen need not guess. */
    readonly completedAt: IsoDateTime;
    /**
     * Whether a suppression record was kept.
     *
     * Always `true`, and said out loud: a hash of the address survives erasure precisely so that
     * "never contact me again" outlives the deletion of everything else. A screen that promised
     * total erasure would be lying about the one record kept in the person's own interest.
     */
    readonly marketingSuppressed: boolean;
}

/* ── the repository ───────────────────────────────────────────────────────────────────────────── */

/**
 * Ordering without an account, and erasure without one.
 *
 * Every method rejects with an `ApiError` carrying an `ApiFailure`. The guest token is supplied by
 * the caller's token store rather than passed per call, exactly as the session token is — the
 * repository holds the store, and a screen never handles a credential.
 *
 * `requestDeletion` and `confirmDeletion` are the two methods that do **not** need a guest token:
 * they are reached from a public page, by somebody who may have cleared their browser months ago,
 * and demanding a token would make the erasure right conditional on holding a credential.
 */
export interface GuestRepository {
    /** `POST /api/v1/guest/sessions`. The one call whose answer carries a plaintext token. */
    startSession(request?: StartGuestSessionRequest): Promise<GuestSession>;
    /** Re-read the session behind the stored token. Rejects `auth.unauthenticated` when it is dead. */
    getSession(): Promise<GuestSession>;

    /** Give or correct the contact, and get the challenge that will prove it. */
    updateContact(request: UpdateGuestContactRequest): Promise<GuestContactChallenge>;
    /** A correct code promotes the session to `place_order`. The answer is the promoted session. */
    confirmContact(request: ConfirmGuestContactRequest): Promise<GuestSession>;

    /**
     * Re-read a live challenge, and ask for another one — the guest half of the OTP surface.
     *
     * These two live here rather than on `VerificationRepository` because they are reached with a
     * *guest* token and no account: the verification repository's challenges hang off contact
     * points on an account that, for a guest, does not exist yet. They were bare functions on the
     * mock bundle until the integrator wave, for the same reason everything else here was — the
     * contract was unregistered — and a bare function is not something a screen can be given.
     */
    getChallenge(request: { readonly challengeId: string }): Promise<OtpChallenge>;
    resendChallenge(request: {
        readonly challengeId: string;
        readonly channel?: OtpChannel | undefined;
    }): Promise<OtpChallenge>;

    /** `POST /api/v1/guest/orders`. Refused with `guest.contact_unverified` below `place_order`. */
    placeOrder(draft: GuestCheckoutDraft): Promise<GuestOrder>;
    /** By reference, so a confirmation page survives a reload and a shared link does not. */
    getOrder(reference: string): Promise<GuestOrder>;

    /** What the conversion prompt pre-fills from. Rejects when the session cannot convert. */
    getConversionPrefill(): Promise<GuestConversionPrefill>;
    /** Become an account holder. Revokes the guest token; the caller clears its store. */
    convert(request: ConvertGuestRequest): Promise<GuestConversionResult>;

    /** Public. Always accepted, always the same shape. No token required. */
    requestDeletion(request: RequestGuestDeletionRequest): Promise<GuestDeletionAcknowledgement>;
    /** Public. Always accepted-shaped. A wrong code fails as a wrong code, and says nothing more. */
    confirmDeletion(request: ConfirmGuestDeletionRequest): Promise<GuestDeletionOutcome>;
}
