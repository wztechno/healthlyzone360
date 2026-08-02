import { CartId } from '@healthy360/domain-types';
import type { Money } from '@healthy360/domain-types';

import type {
    Cart,
    CheckoutPreview,
    DeliveryAddress,
    PriceLine,
} from '../../contracts/commerce.ts';
import {
    apiFailure,
    otpCooldownFailure,
    otpInvalidFailure,
    otpLockedFailure,
    throwFailure,
    validationFailure,
} from '../../contracts/failure.ts';
import type {
    ConfirmGuestContactRequest,
    ConfirmGuestDeletionRequest,
    ConvertGuestRequest,
    GuestCapability,
    GuestCheckoutDraft,
    GuestContact,
    GuestContactChallenge,
    GuestConversionPrefill,
    GuestConversionResult,
    GuestDeletionAcknowledgement,
    GuestDeletionOutcome,
    GuestOrder,
    GuestOrderLine,
    GuestSession,
    GuestSessionGrade,
    RequestGuestDeletionRequest,
    StartGuestSessionRequest,
    UpdateGuestContactRequest,
} from '../../contracts/guest.ts';
import type { OtpChallenge, OtpChannel } from '../../contracts/verification.ts';
import type { GuestTokenStore } from '../../session/guest-token-store.ts';
import {
    MOCK_OTP_CODE,
    OTP_CODE_LENGTH,
    OTP_EXPIRY_SECONDS,
    OTP_LOCKOUT_SECONDS,
    OTP_MAX_ATTEMPTS,
    OTP_MAX_RESENDS,
    OTP_REPEAT_LOCKOUT_SECONDS,
    OTP_RESEND_COOLDOWN_SECONDS,
    SIMULATED_CHANNELS,
} from '../account/store.ts';
import type { Clock } from '../store.ts';
import {
    GUEST_RUNTIME_ORDINAL_START,
    guestChallengeIdAt,
    guestContactIdAt,
    guestOrderIdAt,
    guestOrderLineIdAt,
    guestOrderReferenceAt,
    guestSessionIdAt,
    guestTokenAt,
} from './ids.ts';

/* ------------------------------------------------------------------------------------------------
 * The guest world (plan Phase G1).
 *
 * Standalone, like `../account/`: its own id band, its own store, its own repository factory, and
 * **not** a member of the `MockRepositories` bundle's required shape. It reuses the account world's
 * OTP mechanics by importing its constants — an import *within* the mock package, which is the one
 * place that is allowed — because a second set of timings would drift from the first and a guest
 * passcode behaves exactly like any other passcode.
 * ---------------------------------------------------------------------------------------------- */

/** Guest sessions are short. Hours, not weeks: this is a checkout, not a login. */
export const GUEST_SESSION_TTL_SECONDS = 4 * 60 * 60;

/**
 * How long the provisional data outlives the token.
 *
 * Longer on purpose. The token dying means "you must start again"; the data dying means "the order
 * reference you wrote down no longer finds anything". Those are different promises and they are
 * kept for different lengths of time.
 */
export const GUEST_DATA_TTL_SECONDS = 30 * 24 * 60 * 60;

/** The delivery fee floor, mirroring the prototype world's own numbers. */
const FALLBACK_DELIVERY_FEE_FILS = 1500;
const FALLBACK_FREE_DELIVERY_THRESHOLD_FILS = 15000;

function aed(amount: number): Money {
    return { amount, currency: 'AED' };
}

/**
 * How the guest world reaches the basket.
 *
 * A **port**, not an import. The basket lives in the prototype world and the guest world is
 * standalone; wiring one to the other with a direct reference would make each unusable without the
 * other, and the guest world's own tests want a two-line basket and nothing else. `createMockRepositories`
 * supplies the prototype implementation; the fallback below is what the standalone factory uses.
 */
export interface GuestCartPort {
    read(cartId: CartId): Cart;
    price(cartId: CartId): CheckoutPreview;
    /** Empties the basket once it has become an order. See {@link GuestMockStore.placeOrder}. */
    clear(cartId: CartId): void;
}

/** A single-basket world, for the guest store used on its own. */
export function createFallbackCartPort(initial?: Cart): GuestCartPort {
    const id = initial?.id ?? CartId.unsafe('01935f6f-0000-7000-8000-0000000065ff');
    let cart: Cart = initial ?? {
        id,
        items: [],
        subtotal: aed(0),
        itemCount: 0,
        updatedAt: new Date(0).toISOString(),
    };

    return {
        read: () => cart,
        price: () => {
            const deliveryFee =
                cart.subtotal.amount >= FALLBACK_FREE_DELIVERY_THRESHOLD_FILS
                    ? null
                    : aed(FALLBACK_DELIVERY_FEE_FILS);
            const lines: PriceLine[] = [
                { code: 'subtotal', label: 'Subtotal', amount: cart.subtotal },
            ];
            if (deliveryFee !== null) {
                lines.push({ code: 'delivery', label: 'Delivery', amount: deliveryFee });
            }
            return {
                cartId: cart.id,
                lines,
                subtotal: cart.subtotal,
                deliveryFee,
                discount: null,
                total: aed(cart.subtotal.amount + (deliveryFee?.amount ?? 0)),
                earliestDeliveryDate: null,
                warnings: cart.items.length === 0 ? ['checkout.empty_cart'] : [],
                paymentDeferred: true,
            };
        },
        clear: () => {
            cart = { ...cart, items: [], subtotal: aed(0), itemCount: 0 };
        },
    };
}

/* ── internal shapes ──────────────────────────────────────────────────────────────────────────── */

interface MutableContact {
    id: string;
    fullName: string;
    email: string | null;
    mobile: string | null;
    preferredChannel: OtpChannel;
    verified: boolean;
    verifiedAt: string | null;
}

interface MutableSession {
    id: string;
    token: string;
    grade: GuestSessionGrade;
    contact: MutableContact | null;
    createdAt: number;
    expiresAt: number;
    dataExpiresAt: number;
    revoked: boolean;
    orderReferences: string[];
}

interface MutableChallenge {
    id: string;
    /** `order` proves a contact so an order may be placed; `deletion` proves an erasure request. */
    kind: 'order' | 'deletion';
    channel: OtpChannel;
    destination: string;
    sentAt: number;
    expiresAt: number;
    attemptsRemaining: number;
    resendsRemaining: number;
    superseded: boolean;
}

interface Lockout {
    until: number;
    count: number;
}

export interface GuestMockStoreOptions {
    /** The clock. Defaults to the **real** one, for the reason `../account/store.ts` records. */
    readonly now?: Clock | undefined;
    /** Where the plaintext token is kept between calls. Defaults to an in-memory store. */
    readonly tokenStore?: GuestTokenStore | undefined;
    /** How the world reaches the basket. Defaults to a single-basket fallback. */
    readonly cart?: GuestCartPort | undefined;
    /** Whether channels with no real driver are simulated rather than refused. */
    readonly simulateChannels?: boolean | undefined;
}

/**
 * The mutable world behind the guest repository.
 *
 * A plain synchronous class with no I/O, like every other mock store here; the repository layer
 * above adds the latency and nothing else. Every rejection goes through `throwFailure`, so the mock
 * and the future API repository are indistinguishable to a screen.
 */
export class GuestMockStore {
    readonly #now: Clock;
    readonly #simulate: boolean;
    readonly #cart: GuestCartPort;
    readonly #tokens: GuestTokenStore;

    readonly #sessions = new Map<string, MutableSession>();
    readonly #challenges = new Map<string, MutableChallenge>();
    readonly #orders = new Map<string, GuestOrder>();
    readonly #lockouts = new Map<string, Lockout>();

    /**
     * Destinations we hold data for, as the *values* rather than as hashes.
     *
     * The real registry stores hashes; a fixture world storing the plaintext is not a weaker model
     * of the same thing, it is the same model with the one-way step omitted because there is
     * nothing here to protect. What is faithfully modelled is the *behaviour*: this map is
     * consulted only inside {@link requestDeletion}, and its answer never reaches the caller.
     */
    readonly #knownDestinations = new Set<string>();

    /** Destinations that asked never to be contacted again. Survives every purge. */
    readonly #suppressions = new Set<string>();

    #nextOrdinal = 0;
    #nextRuntimeOrdinal = GUEST_RUNTIME_ORDINAL_START;

    constructor(options: GuestMockStoreOptions = {}) {
        this.#now = options.now ?? (() => Date.now());
        this.#simulate = options.simulateChannels ?? true;
        this.#cart = options.cart ?? createFallbackCartPort();
        this.#tokens = options.tokenStore ?? memoryTokens();
    }

    /** The token store, so a caller can clear it on sign-in without reaching for a second one. */
    get tokenStore(): GuestTokenStore {
        return this.#tokens;
    }

    /** Marketing suppressions, so a test can prove one survived the erasure that produced it. */
    get suppressions(): readonly string[] {
        return [...this.#suppressions];
    }

    // ── sessions ────────────────────────────────────────────────────────────────────────────────

    startSession(_request: StartGuestSessionRequest = {}): GuestSession {
        const ordinal = this.#takeRuntimeOrdinal();
        const now = this.#now();
        const session: MutableSession = {
            id: guestSessionIdAt(ordinal),
            token: guestTokenAt(ordinal),
            grade: 'checkout_draft',
            contact: null,
            createdAt: now,
            expiresAt: now + GUEST_SESSION_TTL_SECONDS * 1000,
            dataExpiresAt: now + GUEST_DATA_TTL_SECONDS * 1000,
            revoked: false,
            orderReferences: [],
        };
        this.#sessions.set(session.token, session);
        this.#tokens.set(session.token);

        // The one moment the plaintext is handed out. Every later read carries `null`.
        return this.#read(session, session.token);
    }

    getSession(): GuestSession {
        return this.#read(this.#require(), null);
    }

    /**
     * Resolve the stored token, or refuse.
     *
     * **One deliberate null for four causes** — unknown, revoked, expired, and never-started. A
     * client that could tell them apart could tell whether a token it holds was ever real, which is
     * an oracle; and a screen's recovery is the same in all four cases anyway: start again, keeping
     * the basket.
     */
    #require(): MutableSession {
        const token = this.#tokens.get();
        const session = token === null ? undefined : this.#sessions.get(token);
        if (session === undefined || session.revoked || session.expiresAt <= this.#now()) {
            throwFailure(apiFailure('auth.unauthenticated'));
        }
        return session;
    }

    /**
     * Refuse below a grade.
     *
     * Named for the grade the caller needs rather than reading `session.grade` at the call site, so
     * a third grade later is a compile-time conversation with everything that requires one — the
     * same rule the backend's `GuestSessionService::require()` follows.
     */
    #requireGrade(session: MutableSession, required: GuestSessionGrade): MutableSession {
        if (required === 'place_order' && session.grade !== 'place_order') {
            // No `guest.contact_unverified` code exists in the shared vocabulary yet, and minting
            // one is a `contracts/failure.ts` edit the integrator wave owns. `precondition_required`
            // is the honest stand-in: something must happen first, and the screen already knows what.
            throwFailure(apiFailure('request.precondition_required'));
        }
        return session;
    }

    // ── contact and its proof ───────────────────────────────────────────────────────────────────

    updateContact(request: UpdateGuestContactRequest): GuestContactChallenge {
        const session = this.#require();

        const fullName = request.fullName.trim();
        const email = (request.email ?? '').trim();
        const mobile = (request.mobile ?? '').trim();

        const fields: Record<string, readonly string[]> = {};
        if (fullName.length === 0) fields['fullName'] = ['Enter a name.'];
        if (email.length === 0 && mobile.length === 0) {
            // One message on both fields: the rule is about the pair, and attaching it to only one
            // of them would mark an input invalid that is not the one the person must fix.
            fields['email'] = ['Enter an email address or a mobile number.'];
            fields['mobile'] = ['Enter an email address or a mobile number.'];
        }
        if (Object.keys(fields).length > 0) throwFailure(validationFailure(fields));

        const preferred =
            request.preferredChannel ?? (email.length > 0 ? 'email' : ('sms' as OtpChannel));
        const destination = preferred === 'email' && email.length > 0 ? email : mobile || email;

        const existing = session.contact;
        const changed =
            existing === null ||
            existing.email !== (email || null) ||
            existing.mobile !== (mobile || null);

        const contact: MutableContact = {
            id: existing?.id ?? guestContactIdAt(this.#takeRuntimeOrdinal()),
            fullName,
            email: email.length === 0 ? null : email,
            mobile: mobile.length === 0 ? null : mobile,
            preferredChannel: preferred,
            // Correcting the address un-proves it. Anything else would let a verified typo carry
            // its proof onto the address it was corrected to.
            verified: changed ? false : (existing?.verified ?? false),
            verifiedAt: changed ? null : (existing?.verifiedAt ?? null),
        };
        session.contact = contact;
        if (changed && session.grade === 'place_order') session.grade = 'checkout_draft';

        this.#knownDestinations.add(normalise(destination));

        return {
            contact: freezeContact(contact),
            challenge: this.#issue('order', destination, preferred),
        };
    }

    confirmContact(request: ConfirmGuestContactRequest): GuestSession {
        const session = this.#require();
        const contact = session.contact;
        if (contact === null) throwFailure(apiFailure('request.precondition_required'));

        this.#verify(request.challengeId, request.code, 'order');

        const verifiedAt = new Date(this.#now()).toISOString();
        contact.verified = true;
        contact.verifiedAt = verifiedAt;
        // The proof, and only the proof, raises the grade — mirroring the database CHECK that makes
        // the higher grade unwritable without it.
        session.grade = 'place_order';

        return this.#read(session, null);
    }

    resendChallenge(challengeId: string, channel?: OtpChannel): OtpChallenge {
        const previous = this.#challenges.get(challengeId);
        if (previous === undefined) throwFailure(apiFailure('resource.not_found'));
        if (previous.superseded) throwFailure(apiFailure('otp.expired'));

        this.#assertNotLockedOut(previous.destination);

        const elapsed = (this.#now() - previous.sentAt) / 1000;
        if (elapsed < OTP_RESEND_COOLDOWN_SECONDS) {
            throwFailure(otpCooldownFailure(Math.ceil(OTP_RESEND_COOLDOWN_SECONDS - elapsed)));
        }
        if (previous.resendsRemaining <= 0) {
            throwFailure(
                otpLockedFailure(
                    new Date(this.#now() + OTP_LOCKOUT_SECONDS * 1000).toISOString(),
                    this.#channelsFor(previous.destination),
                ),
            );
        }

        previous.superseded = true;
        return this.#issue(previous.kind, previous.destination, channel ?? previous.channel, {
            resendsRemaining: previous.resendsRemaining - 1,
        });
    }

    getChallenge(challengeId: string): OtpChallenge {
        const challenge = this.#challenges.get(challengeId);
        if (challenge === undefined) throwFailure(apiFailure('resource.not_found'));
        return this.#readChallenge(challenge);
    }

    // ── the order ───────────────────────────────────────────────────────────────────────────────

    /**
     * Place the order, and convert the basket into it.
     *
     * "Convert" rather than "copy then clear": the lines are snapshotted onto the order with the
     * prices they were quoted at, and the basket is emptied in the same step, because a basket that
     * still holds what was just ordered is an interface inviting somebody to order it twice.
     */
    placeOrder(draft: GuestCheckoutDraft): GuestOrder {
        const session = this.#requireGrade(this.#require(), 'place_order');
        const contact = session.contact;
        if (contact === null || !contact.verified) {
            throwFailure(apiFailure('request.precondition_required'));
        }

        const basket = this.#cart.read(draft.cartId);
        if (basket.items.length === 0) {
            throwFailure(validationFailure({ cartId: ['The basket is empty.'] }));
        }

        const quotation = this.#cart.price(draft.cartId);
        const ordinal = this.#nextOrdinal++;
        const lines: readonly GuestOrderLine[] = basket.items.map((item, index) => ({
            id: guestOrderLineIdAt(index),
            name: item.name,
            quantity: item.quantity,
            unitPrice: item.unitPrice,
            lineTotal: item.lineTotal,
        }));

        const order: GuestOrder = {
            id: guestOrderIdAt(ordinal),
            reference: guestOrderReferenceAt(ordinal),
            state: 'placed',
            lines,
            priceLines: quotation.lines,
            total: quotation.total,
            // Structural, not a choice made here: the draft's type has one member.
            paymentMethod: draft.paymentMethod,
            address: draft.address,
            slotCode: draft.slotCode,
            deliveryDate: draft.deliveryDate,
            contact: freezeContact(contact),
            placedAt: new Date(this.#now()).toISOString(),
        };

        this.#orders.set(order.reference, order);
        session.orderReferences.push(order.reference);
        this.#cart.clear(draft.cartId);

        // An opt-in that was never given is a suppression that stays in place. Recording the
        // *absence* rather than only the presence is what makes "I never asked for this" checkable.
        const destination = normalise(contact.email ?? contact.mobile ?? '');
        if (draft.marketingOptIn) this.#suppressions.delete(destination);
        else this.#suppressions.add(destination);

        return order;
    }

    getOrder(reference: string): GuestOrder {
        const order = this.#orders.get(reference.trim().toUpperCase());
        if (order === undefined) throwFailure(apiFailure('resource.not_found'));
        return order;
    }

    // ── conversion ──────────────────────────────────────────────────────────────────────────────

    conversionPrefill(): GuestConversionPrefill {
        const session = this.#require();
        const contact = session.contact;
        if (contact === null) throwFailure(apiFailure('request.precondition_required'));
        return {
            fullName: contact.fullName,
            email: contact.email,
            mobile: contact.mobile,
            contactVerified: contact.verified,
            orderReferences: [...session.orderReferences],
        };
    }

    convert(request: ConvertGuestRequest): GuestConversionResult {
        const session = this.#require();
        if (session.contact === null) throwFailure(apiFailure('request.precondition_required'));
        if (request.password.trim().length < 8) {
            throwFailure(validationFailure({ password: ['Use at least 8 characters.'] }));
        }

        session.contact.fullName = request.fullName.trim();
        const destination = normalise(session.contact.email ?? session.contact.mobile ?? '');
        // Decided again for the account, never inherited from the checkout.
        if (request.marketingOptIn) this.#suppressions.delete(destination);
        else this.#suppressions.add(destination);

        // The guest identity ends here: the token is revoked server-side *and* cleared locally, so
        // neither half can be left holding a credential the other has retired.
        session.revoked = true;
        this.#tokens.clear();

        return {
            accountId: guestSessionIdAt(0),
            sessionToken: `sess_${session.token.slice(4)}`,
            orderReferences: [...session.orderReferences],
            convertedAt: new Date(this.#now()).toISOString(),
        };
    }

    /** Ends the guest identity without converting — signing in, or walking away. */
    abandon(): void {
        const token = this.#tokens.get();
        const session = token === null ? undefined : this.#sessions.get(token);
        if (session !== undefined) session.revoked = true;
        this.#tokens.clear();
    }

    // ── deletion ────────────────────────────────────────────────────────────────────────────────

    /**
     * Always accepted, always the same shape.
     *
     * The known/unknown test happens **inside** and its answer never leaves: a known destination
     * gets a live challenge minted against it, an unknown one gets nothing — and both callers
     * receive an acknowledgement built entirely from what they just typed. There is no challenge
     * identifier in the answer for exactly this reason; the confirm step is addressed by the
     * destination instead.
     */
    requestDeletion(request: RequestGuestDeletionRequest): GuestDeletionAcknowledgement {
        const destination = (request.email ?? request.mobile ?? '').trim();
        if (destination.length === 0) {
            throwFailure(
                validationFailure({ email: ['Enter an email address or a mobile number.'] }),
            );
        }

        const channel: OtpChannel = destination.includes('@') ? 'email' : 'sms';
        if (this.#knownDestinations.has(normalise(destination))) {
            this.#issue('deletion', destination, channel);
        }

        return {
            accepted: true,
            destinationMasked: mask(destination),
            verificationRequired: true,
            expiresInSeconds: OTP_EXPIRY_SECONDS,
            codeLength: OTP_CODE_LENGTH,
        };
    }

    /**
     * Confirm, and purge.
     *
     * An unknown destination has no live challenge, so every code entered against it fails as
     * `otp.invalid` — which is exactly what a *wrong* code against a known destination does. The
     * two are indistinguishable from outside, which is the whole point.
     */
    confirmDeletion(request: ConfirmGuestDeletionRequest): GuestDeletionOutcome {
        const destination = (request.email ?? request.mobile ?? '').trim();
        const live = this.#liveFor('deletion', destination);

        if (live === null) {
            this.#assertNotLockedOut(destination);
            throwFailure(otpInvalidFailure(OTP_MAX_ATTEMPTS - 1));
        }
        this.#verify(live.id, request.code, 'deletion');

        this.#purge(normalise(destination));

        return {
            accepted: true,
            completedAt: new Date(this.#now()).toISOString(),
            // Said out loud rather than quietly true: one record is kept, in the person's interest.
            marketingSuppressed: true,
        };
    }

    /**
     * Hard-delete everything, and keep the one thing erasure must not take with it.
     *
     * The suppression is written *before* the sessions and contacts go, because it is derived from
     * them: a purge that dropped the contact first would have nothing left to suppress, and "delete
     * my data" would quietly cancel "never contact me again".
     */
    #purge(destination: string): void {
        this.#suppressions.add(destination);
        this.#knownDestinations.delete(destination);

        for (const [token, session] of this.#sessions) {
            const contact = session.contact;
            if (contact === null) continue;
            if (
                normalise(contact.email ?? '') !== destination &&
                normalise(contact.mobile ?? '') !== destination
            ) {
                continue;
            }
            session.revoked = true;
            session.contact = null;
            for (const reference of session.orderReferences) this.#orders.delete(reference);
            session.orderReferences = [];
            this.#sessions.delete(token);
            if (this.#tokens.get() === token) this.#tokens.clear();
        }

        // Live challenges are data about the person too, and a challenge that outlived the purge
        // would let somebody re-verify an address we have just promised to forget.
        for (const [id, challenge] of this.#challenges) {
            if (normalise(challenge.destination) === destination) this.#challenges.delete(id);
        }
        this.#lockouts.delete(destination);
    }

    // ── OTP mechanics ───────────────────────────────────────────────────────────────────────────

    #issue(
        kind: 'order' | 'deletion',
        destination: string,
        channel: OtpChannel,
        options: { resendsRemaining?: number } = {},
    ): OtpChallenge {
        this.#assertNotLockedOut(destination);

        // One live challenge per destination per kind, mirroring the backend's partial-unique
        // index: a reload has not asked for a new code, and issuing one would reset a cooldown the
        // server never reset.
        const live = this.#liveFor(kind, destination);
        if (live !== null && options.resendsRemaining === undefined) {
            return this.#readChallenge(live);
        }

        const resolved = this.#resolveChannel(destination, channel);
        const challenge: MutableChallenge = {
            id: guestChallengeIdAt(this.#nextRuntimeOrdinal++),
            kind,
            channel: resolved,
            destination,
            sentAt: this.#now(),
            expiresAt: this.#now() + OTP_EXPIRY_SECONDS * 1000,
            attemptsRemaining: OTP_MAX_ATTEMPTS,
            resendsRemaining: options.resendsRemaining ?? OTP_MAX_RESENDS,
            superseded: false,
        };
        this.#challenges.set(challenge.id, challenge);
        return this.#readChallenge(challenge);
    }

    #liveFor(kind: 'order' | 'deletion', destination: string): MutableChallenge | null {
        const key = normalise(destination);
        for (const challenge of this.#challenges.values()) {
            if (challenge.kind !== kind) continue;
            if (normalise(challenge.destination) !== key) continue;
            if (challenge.superseded || challenge.expiresAt <= this.#now()) continue;
            return challenge;
        }
        return null;
    }

    #verify(challengeId: string, code: string, kind: 'order' | 'deletion'): void {
        const challenge = this.#challenges.get(challengeId);
        if (challenge === undefined || challenge.kind !== kind) {
            throwFailure(apiFailure('resource.not_found'));
        }
        this.#assertNotLockedOut(challenge.destination);
        if (challenge.superseded || challenge.expiresAt <= this.#now()) {
            throwFailure(apiFailure('otp.expired'));
        }

        if (code.trim() !== MOCK_OTP_CODE) {
            challenge.attemptsRemaining -= 1;
            if (challenge.attemptsRemaining <= 0) {
                challenge.superseded = true;
                throwFailure(this.#lockOut(challenge.destination, challenge.channel));
            }
            throwFailure(otpInvalidFailure(challenge.attemptsRemaining));
        }

        challenge.superseded = true;
        this.#lockouts.delete(normalise(challenge.destination));
    }

    #assertNotLockedOut(destination: string): void {
        const lockout = this.#lockouts.get(normalise(destination));
        if (lockout === undefined || lockout.until <= this.#now()) return;
        throwFailure(
            otpLockedFailure(new Date(lockout.until).toISOString(), this.#channelsFor(destination)),
        );
    }

    #lockOut(destination: string, channel: OtpChannel) {
        const key = normalise(destination);
        const previous = this.#lockouts.get(key);
        const count = (previous?.count ?? 0) + 1;
        const seconds = count > 1 ? OTP_REPEAT_LOCKOUT_SECONDS : OTP_LOCKOUT_SECONDS;
        const until = this.#now() + seconds * 1000;
        this.#lockouts.set(key, { until, count });
        return otpLockedFailure(
            new Date(until).toISOString(),
            this.#channelsFor(destination).filter((candidate) => candidate !== channel),
        );
    }

    #channelsFor(destination: string): readonly OtpChannel[] {
        const all: readonly OtpChannel[] = destination.includes('@')
            ? ['email']
            : ['sms', 'whatsapp'];
        return this.#simulate ? all : all.filter((channel) => channel === 'email');
    }

    #resolveChannel(destination: string, preferred: OtpChannel): OtpChannel {
        const available = this.#channelsFor(destination);
        if (available.includes(preferred)) return preferred;
        const fallback = available[0];
        if (fallback === undefined) throwFailure(apiFailure('otp.channel_unavailable'));
        return fallback;
    }

    #readChallenge(challenge: MutableChallenge): OtpChallenge {
        const elapsed = (this.#now() - challenge.sentAt) / 1000;
        return {
            id: challenge.id,
            purpose: challenge.kind === 'order' ? 'guest_order' : 'guest_deletion',
            channel: challenge.channel,
            maskedDestination: mask(challenge.destination),
            codeLength: OTP_CODE_LENGTH,
            expiresAt: new Date(challenge.expiresAt).toISOString(),
            resendCooldownSeconds: Math.max(0, Math.ceil(OTP_RESEND_COOLDOWN_SECONDS - elapsed)),
            attemptsRemaining: challenge.attemptsRemaining,
            resendsRemaining: challenge.resendsRemaining,
            availableChannels: this.#channelsFor(challenge.destination),
            simulatedChannels: this.#simulate
                ? SIMULATED_CHANNELS.filter((channel) =>
                      this.#channelsFor(challenge.destination).includes(channel),
                  )
                : [],
        };
    }

    // ── projection ──────────────────────────────────────────────────────────────────────────────

    #read(session: MutableSession, token: string | null): GuestSession {
        return {
            id: session.id,
            token,
            grade: session.grade,
            capabilities: capabilitiesFor(session.grade),
            contactVerified: session.contact?.verified ?? false,
            contact: session.contact === null ? null : freezeContact(session.contact),
            expiresAt: new Date(session.expiresAt).toISOString(),
            dataExpiresAt: new Date(session.dataExpiresAt).toISOString(),
            createdAt: new Date(session.createdAt).toISOString(),
        };
    }

    #takeRuntimeOrdinal(): number {
        return this.#nextRuntimeOrdinal++;
    }
}

/* ── helpers ──────────────────────────────────────────────────────────────────────────────────── */

function memoryTokens(): GuestTokenStore {
    let token: string | null = null;
    const listeners = new Set<() => void>();
    const notify = () => {
        for (const listener of listeners) listener();
    };
    return {
        get: () => token,
        set: (next) => {
            token = next;
            notify();
        },
        clear: () => {
            token = null;
            notify();
        },
        subscribe: (listener) => {
            listeners.add(listener);
            return () => listeners.delete(listener);
        },
    };
}

function normalise(value: string): string {
    return value.trim().toLocaleLowerCase();
}

/** The same masking the account world does, over a bare value rather than a typed contact. */
function mask(value: string): string {
    if (value.includes('@')) {
        const at = value.indexOf('@');
        if (at <= 0) return '•'.repeat(value.length);
        return `${value.slice(0, 1)}${'•'.repeat(Math.max(1, at - 1))}${value.slice(at)}`;
    }
    const tail = value.slice(-4);
    return `${value.slice(0, Math.max(0, value.length - 4)).replace(/\d/g, '•')}${tail}`;
}

/**
 * What a grade may do.
 *
 * `request_deletion` is present at every grade, deliberately: the right to be forgotten does not
 * depend on having proven anything, and the public deletion page does not need a session at all.
 */
export function capabilitiesFor(grade: GuestSessionGrade): readonly GuestCapability[] {
    const base: readonly GuestCapability[] = ['build_basket', 'price_basket', 'request_deletion'];
    return grade === 'place_order' ? [...base, 'place_order'] : base;
}

function freezeContact(contact: MutableContact): GuestContact {
    return {
        id: contact.id,
        email: contact.email,
        mobile: contact.mobile,
        maskedDestination: mask(contact.email ?? contact.mobile ?? ''),
        fullName: contact.fullName,
        preferredChannel: contact.preferredChannel,
        verified: contact.verified,
        verifiedAt: contact.verifiedAt,
    };
}

export type { DeliveryAddress };
