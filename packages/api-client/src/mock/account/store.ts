import type {
    AccountChecklistItem,
    AccountSetupChecklist,
    AllergenDeclaration,
    ClosurePreconditions,
    ClosureTicket,
    ConsentState,
    CustomerAccount,
    CustomerAddress,
    DietaryProfile,
    RequestClosureRequest,
    SaveAddressRequest,
    SaveDietaryProfileRequest,
    SetConsentRequest,
    VerifyClosureRequest,
} from '../../contracts/account.ts';
import {
    apiFailure,
    conflictFailure,
    otpCooldownFailure,
    otpInvalidFailure,
    otpLockedFailure,
    rateLimitFailure,
    throwFailure,
    validationFailure,
} from '../../contracts/failure.ts';
import type {
    AddContactPointRequest,
    ContactKind,
    ContactPoint,
    ContactPointAdded,
    IssueOtpRequest,
    OtpChallenge,
    OtpChannel,
    OtpPurpose,
    OtpVerificationResult,
    ResendOtpRequest,
    VerifyOtpRequest,
} from '../../contracts/verification.ts';
import type { Clock } from '../store.ts';
import { closurePreconditions } from './closure.ts';
import type { ClosureWorldPorts } from './closure.ts';
import {
    ACCOUNT_RUNTIME_ORDINAL_START,
    closureRequestIdAt,
    contactPointIdAt,
    customerAddressIdAt,
    otpChallengeIdAt,
} from './ids.ts';
import { SEED_ACCOUNT, SEED_CONSENTS, SEED_CONTACTS, SEED_SERVICE_AREAS } from './seed.ts';

/* ------------------------------------------------------------------------------------------------
 * The mock OTP mechanics (plan §G.2).
 *
 * The code is fixed and published; **everything around it is real**. That is the entire design: a
 * demo where any six digits pass teaches nobody what the screen does, and a demo with a random code
 * cannot be driven by a Playwright spec. So the code is `424242` and the expiry, the cooldown, the
 * attempt budget, the supersession rule and the lockout all behave exactly as the backend's will.
 * ---------------------------------------------------------------------------------------------- */

/** The one code the mock accepts. Published on purpose — the mechanics are what is being modelled. */
export const MOCK_OTP_CODE = '424242';

export const OTP_CODE_LENGTH = 6;
/** Appendix C: 300 s expiry. */
export const OTP_EXPIRY_SECONDS = 300;
/** Appendix C: three attempts per challenge. */
export const OTP_MAX_ATTEMPTS = 3;
/** Appendix C: 45 s between sends, three resends. */
export const OTP_RESEND_COOLDOWN_SECONDS = 45;
export const OTP_MAX_RESENDS = 3;
/** Appendix C: 5 min on the first lockout, 15 min on every one after it. */
export const OTP_LOCKOUT_SECONDS = 300;
export const OTP_REPEAT_LOCKOUT_SECONDS = 900;

/**
 * Channels whose "delivery" is a log line.
 *
 * Non-production only, and the mock world is by definition non-production. Exposing them is what
 * lets the panel draw the honest badge — "we did not really send this" — instead of claiming an SMS
 * arrived (plan §3 #16).
 */
export const SIMULATED_CHANNELS: readonly OtpChannel[] = ['sms', 'whatsapp'];

/** Which channels can carry a code to which kind of contact. */
const CHANNELS_FOR_KIND: Readonly<Record<ContactKind, readonly OtpChannel[]>> = {
    email: ['email'],
    phone: ['sms', 'whatsapp'],
};

interface MutableContact {
    id: string;
    kind: ContactKind;
    value: string;
    maskedValue: string;
    verified: boolean;
    verifiedAt: string | null;
    isPrimary: boolean;
    isLoginEmail: boolean;
    createdAt: string;
}

interface MutableChallenge {
    id: string;
    purpose: OtpPurpose;
    channel: OtpChannel;
    contactId: string;
    /** Epoch milliseconds. */
    sentAt: number;
    expiresAt: number;
    attemptsRemaining: number;
    resendsRemaining: number;
    /** Set when a resend replaced it, or when it was consumed. A dead challenge reads as expired. */
    superseded: boolean;
    verifiedAt: string | null;
}

interface MutableClosure {
    id: string;
    scope: ClosureTicket['scope'];
    status: ClosureTicket['status'];
    reasonCode: ClosureTicket['reasonCode'];
    reasonNote: string | null;
    blockers: ClosureTicket['blockers'];
    blocked: boolean;
    challengeId: string | null;
    completedAt: string | null;
}

interface Lockout {
    until: number;
    /** How many times this contact has been locked. The second and later lockouts are longer. */
    count: number;
}

export interface AccountMockStoreOptions {
    /**
     * The clock. Defaults to the **real** one, like `../store.ts`.
     *
     * It used to default to the fixed `MOCK_NOW`, and that was a defect rather than a preference: a
     * challenge is issued at `now` and expires 300 s later, so a world pinned to a date in the past
     * mints challenges that are already expired. Every panel it fed opened in its expired state
     * with the code field closed, in the development app as much as in a test. Tests that need a
     * fixed clock still pass one — the account world's own suite always did.
     */
    readonly now?: Clock | undefined;
    /**
     * Whether channels with no real driver are *simulated* rather than refused.
     *
     * Defaults to true because the mock world stands in for a development environment. Set it to
     * false to rehearse the production shape, where `simulatedChannels` is empty and asking for SMS
     * is refused outright with `otp.channel_unavailable`.
     */
    readonly simulateChannels?: boolean | undefined;
    /**
     * What else exists, for the closure blocker registry.
     *
     * A **port**, on the same terms as the guest world's basket port: this world must not import the
     * prototype store, and a closure check that could only be tested by building the whole universe
     * would not get tested. Members that are absent report `not_applicable`, never `clear` — see
     * `./closure.ts`.
     */
    readonly closureWorld?: ClosureWorldPorts | undefined;
    /**
     * What to do when a full closure finalises.
     *
     * The account world does not own the session, and it must not: signing somebody out is the
     * bundle's business (clear the credential, end the server session). This is how the bundle is
     * told, so that "the account is closed" and "you are signed out" are one event rather than a
     * screen noticing later.
     */
    readonly onAccountClosed?: (() => void) | undefined;
}

/**
 * The mutable world behind the verification and account repositories.
 *
 * A plain synchronous class with no I/O, like `../store.ts`: the repository layer above adds the
 * latency and nothing else. Every rejection goes through `throwFailure`, so the mock and the future
 * API repository are indistinguishable to a screen.
 */
export class AccountMockStore {
    readonly #now: Clock;
    readonly #simulate: boolean;
    readonly #closureWorld: ClosureWorldPorts;
    readonly #onAccountClosed: (() => void) | null;

    #account: CustomerAccount = SEED_ACCOUNT;
    readonly #contacts: MutableContact[] = SEED_CONTACTS.map((contact) => ({ ...contact }));
    readonly #challenges = new Map<string, MutableChallenge>();
    /** `contactId:purpose` → the one live challenge, mirroring the backend's partial-unique index. */
    readonly #liveChallenges = new Map<string, string>();
    readonly #lockouts = new Map<string, Lockout>();
    readonly #addresses: CustomerAddress[] = [];
    readonly #consents = new Map<
        string,
        { granted: boolean; at: string | null; off: string | null }
    >();

    #dietary: DietaryProfile = {
        dietCategoryCodes: [],
        allergens: [],
        excludedIngredientIds: [],
        updatedAt: null,
    };

    /** The one closure a person may have in flight. The backend's partial unique index, honestly. */
    #closure: MutableClosure | null = null;

    #nextChallengeOrdinal = 0;
    #nextClosureOrdinal = 0;
    #nextRuntimeOrdinal = ACCOUNT_RUNTIME_ORDINAL_START;

    constructor(options: AccountMockStoreOptions = {}) {
        this.#now = options.now ?? (() => Date.now());
        this.#simulate = options.simulateChannels ?? true;
        this.#closureWorld = options.closureWorld ?? {};
        this.#onAccountClosed = options.onAccountClosed ?? null;
        for (const definition of SEED_CONSENTS) {
            this.#consents.set(definition.key, { granted: false, at: null, off: null });
        }
    }

    // ── contacts ────────────────────────────────────────────────────────────────────────────────

    listContacts(): readonly ContactPoint[] {
        return this.#contacts.map(freezeContact);
    }

    #requireContact(contactPointId: string): MutableContact {
        const contact = this.#contacts.find((candidate) => candidate.id === contactPointId);
        if (contact === undefined) throwFailure(apiFailure('resource.not_found'));
        return contact;
    }

    addContact(request: AddContactPointRequest): ContactPointAdded {
        const value = request.value.trim();
        if (value.length === 0) {
            throwFailure(validationFailure({ value: ['Enter a value.'] }));
        }

        // Duplicate detection is by value, exactly as the backend's hashed uniqueness is: a second
        // copy of an address that is already verified would let two accounts claim one inbox.
        const existing = this.#contacts.find(
            (candidate) => candidate.kind === request.kind && candidate.value === value,
        );
        if (existing !== undefined) {
            throwFailure(conflictFailure());
        }

        const contact: MutableContact = {
            id: contactPointIdAt(this.#takeRuntimeOrdinal()),
            kind: request.kind,
            value,
            maskedValue: maskValue(request.kind, value),
            verified: false,
            verifiedAt: null,
            isPrimary: !this.#contacts.some((candidate) => candidate.kind === request.kind),
            isLoginEmail: false,
            createdAt: this.#iso(),
        };
        this.#contacts.push(contact);

        const challenge =
            request.verifyNow === true
                ? this.issueChallenge({
                      purpose: 'contact_verification',
                      contactPointId: contact.id,
                  })
                : null;

        return { contact: freezeContact(contact), challenge };
    }

    removeContact(contactPointId: string): void {
        const contact = this.#requireContact(contactPointId);
        // The sign-in address is a mirror of the account's own email, not a contact a person owns.
        if (contact.isLoginEmail) throwFailure(conflictFailure());
        this.#contacts.splice(this.#contacts.indexOf(contact), 1);
    }

    setPrimaryContact(contactPointId: string): ContactPoint {
        const contact = this.#requireContact(contactPointId);
        if (!contact.verified) throwFailure(conflictFailure());
        for (const candidate of this.#contacts) {
            if (candidate.kind === contact.kind) candidate.isPrimary = candidate.id === contact.id;
        }
        return freezeContact(contact);
    }

    // ── challenges ──────────────────────────────────────────────────────────────────────────────

    /**
     * Issue, or hand back the challenge that is already live.
     *
     * Returning the live one rather than minting a second is the honest reading of "one live
     * challenge per contact per purpose": a person who reloads the page has not asked for a new
     * code, and a screen that silently issued one would reset a cooldown the server never reset.
     */
    issueChallenge(request: IssueOtpRequest): OtpChallenge {
        const contact = this.#requireContact(request.contactPointId ?? '');
        this.#assertNotLockedOut(contact);

        const key = `${contact.id}:${request.purpose}`;
        const liveId = this.#liveChallenges.get(key);
        const live = liveId === undefined ? undefined : this.#challenges.get(liveId);
        if (live !== undefined && !live.superseded && live.expiresAt > this.#now()) {
            return this.#read(live, contact);
        }

        const channel = this.#resolveChannel(contact, request.channel);
        const challenge: MutableChallenge = {
            id: otpChallengeIdAt(this.#nextChallengeOrdinal++),
            purpose: request.purpose,
            channel,
            contactId: contact.id,
            sentAt: this.#now(),
            expiresAt: this.#now() + OTP_EXPIRY_SECONDS * 1000,
            attemptsRemaining: OTP_MAX_ATTEMPTS,
            resendsRemaining: OTP_MAX_RESENDS,
            superseded: false,
            verifiedAt: null,
        };
        this.#challenges.set(challenge.id, challenge);
        this.#liveChallenges.set(key, challenge.id);
        return this.#read(challenge, contact);
    }

    getChallenge(challengeId: string): OtpChallenge {
        const challenge = this.#challenges.get(challengeId);
        if (challenge === undefined) throwFailure(apiFailure('resource.not_found'));
        return this.#read(challenge, this.#requireContact(challenge.contactId));
    }

    /**
     * Resend — and supersede.
     *
     * The answer carries a **new** identifier and the previous challenge stops verifying. That is
     * what stops a person typing the code from the first message after asking for a second one, and
     * it is the behaviour the partial-unique index gives the real service for free.
     */
    resendChallenge(request: ResendOtpRequest): OtpChallenge {
        const previous = this.#challenges.get(request.challengeId);
        if (previous === undefined) throwFailure(apiFailure('resource.not_found'));
        if (previous.superseded) throwFailure(apiFailure('otp.expired'));

        const contact = this.#requireContact(previous.contactId);
        this.#assertNotLockedOut(contact);

        const elapsed = (this.#now() - previous.sentAt) / 1000;
        if (elapsed < OTP_RESEND_COOLDOWN_SECONDS) {
            throwFailure(otpCooldownFailure(Math.ceil(OTP_RESEND_COOLDOWN_SECONDS - elapsed)));
        }
        if (previous.resendsRemaining <= 0) {
            throwFailure(rateLimitFailure(OTP_LOCKOUT_SECONDS));
        }

        const channel = this.#resolveChannel(contact, request.channel ?? previous.channel);

        previous.superseded = true;
        const challenge: MutableChallenge = {
            id: otpChallengeIdAt(this.#nextChallengeOrdinal++),
            purpose: previous.purpose,
            channel,
            contactId: contact.id,
            sentAt: this.#now(),
            expiresAt: this.#now() + OTP_EXPIRY_SECONDS * 1000,
            attemptsRemaining: OTP_MAX_ATTEMPTS,
            resendsRemaining: previous.resendsRemaining - 1,
            superseded: false,
            verifiedAt: null,
        };
        this.#challenges.set(challenge.id, challenge);
        this.#liveChallenges.set(`${contact.id}:${challenge.purpose}`, challenge.id);
        return this.#read(challenge, contact);
    }

    verifyChallenge(request: VerifyOtpRequest): OtpVerificationResult {
        const challenge = this.#challenges.get(request.challengeId);
        if (challenge === undefined) throwFailure(apiFailure('resource.not_found'));

        const contact = this.#requireContact(challenge.contactId);
        this.#assertNotLockedOut(contact);

        if (challenge.superseded || challenge.expiresAt <= this.#now()) {
            throwFailure(apiFailure('otp.expired'));
        }

        if (request.code.trim() !== MOCK_OTP_CODE) {
            challenge.attemptsRemaining -= 1;
            if (challenge.attemptsRemaining <= 0) {
                challenge.superseded = true;
                throwFailure(this.#lockOut(contact, challenge.channel));
            }
            throwFailure(otpInvalidFailure(challenge.attemptsRemaining));
        }

        const verifiedAt = this.#iso();
        challenge.verifiedAt = verifiedAt;
        challenge.superseded = true;
        this.#liveChallenges.delete(`${contact.id}:${challenge.purpose}`);
        this.#lockouts.delete(contact.id);

        if (challenge.purpose === 'contact_verification') {
            contact.verified = true;
            contact.verifiedAt = verifiedAt;
        }

        return {
            challengeId: challenge.id,
            purpose: challenge.purpose,
            verifiedAt,
            contactPointId: challenge.purpose === 'contact_verification' ? contact.id : null,
            stepUpUntil: challenge.purpose.endsWith('_step_up')
                ? new Date(this.#now() + OTP_EXPIRY_SECONDS * 1000).toISOString()
                : null,
        };
    }

    // ── account area ────────────────────────────────────────────────────────────────────────────

    get account(): CustomerAccount {
        return this.#account;
    }

    /**
     * The activation evaluator — server-side, and only server-side.
     *
     * `verify_phone` is present but **not required**, because in production phone verification is
     * switched off until a real SMS provider exists (gate A-011). The client is told that rather
     * than left to infer it, which is the whole reason `required` is a field.
     */
    checklist(): AccountSetupChecklist {
        const emailVerified = this.#contacts.some(
            (contact) => contact.kind === 'email' && contact.isLoginEmail && contact.verified,
        );
        const phoneVerified = this.#contacts.some(
            (contact) => contact.kind === 'phone' && contact.verified,
        );
        const requiredConsentsGranted = SEED_CONSENTS.filter(
            (definition) => definition.required,
        ).every((definition) => this.#consents.get(definition.key)?.granted === true);

        const items: readonly AccountChecklistItem[] = [
            item('verify_email', emailVerified, true),
            item('verify_phone', phoneVerified, false),
            item('add_address', this.#addresses.length > 0, true),
            item('dietary_profile', this.#dietary.updatedAt !== null, false),
            item('consents', requiredConsentsGranted, true),
        ];

        const canActivate = items.every((entry) => !entry.required || entry.complete);
        // A closed account is never re-activated by a checklist read. The evaluator only ever moves
        // a *provisional* account forward; closure is terminal and the guard says so out loud.
        if (canActivate && this.#account.lifecycle === 'provisional') {
            this.#account = {
                ...this.#account,
                lifecycle: 'active',
                activatedAt: this.#iso(),
            };
        }

        return { lifecycle: this.#account.lifecycle, items, canActivate };
    }

    listAddresses(): readonly CustomerAddress[] {
        return [...this.#addresses];
    }

    addAddress(request: SaveAddressRequest): CustomerAddress {
        const address = this.#buildAddress(
            customerAddressIdAt(this.#takeRuntimeOrdinal()),
            request,
        );
        this.#addresses.push(address);
        this.#applyDefault(address);
        return address;
    }

    updateAddress(addressId: string, request: SaveAddressRequest): CustomerAddress {
        const index = this.#addresses.findIndex((candidate) => candidate.id === addressId);
        if (index < 0) throwFailure(apiFailure('resource.not_found'));
        const address = this.#buildAddress(addressId, request);
        this.#addresses.splice(index, 1, address);
        this.#applyDefault(address);
        return address;
    }

    removeAddress(addressId: string): void {
        const index = this.#addresses.findIndex((candidate) => candidate.id === addressId);
        if (index < 0) throwFailure(apiFailure('resource.not_found'));
        this.#addresses.splice(index, 1);
    }

    dietaryProfile(): DietaryProfile {
        return this.#dietary;
    }

    saveDietaryProfile(request: SaveDietaryProfileRequest): DietaryProfile {
        for (const declaration of request.allergens) {
            if (declaration.allergenCode.trim().length === 0) {
                throwFailure(validationFailure({ allergens: ['Choose an allergen.'] }));
            }
        }
        this.#dietary = {
            dietCategoryCodes: [...request.dietCategoryCodes],
            allergens: request.allergens.map((entry): AllergenDeclaration => ({ ...entry })),
            excludedIngredientIds: [...request.excludedIngredientIds],
            updatedAt: this.#iso(),
        };
        return this.#dietary;
    }

    listConsents(): readonly ConsentState[] {
        return SEED_CONSENTS.map((definition) => this.#consentState(definition.key));
    }

    setConsent(request: SetConsentRequest): ConsentState {
        const state = this.#consents.get(request.key);
        if (state === undefined) throwFailure(apiFailure('resource.not_found'));
        const at = this.#iso();
        this.#consents.set(request.key, {
            granted: request.granted,
            at: request.granted ? at : state.at,
            off: request.granted ? null : at,
        });
        return this.#consentState(request.key);
    }

    /** The closed list an address may point at. */
    serviceAreas(): readonly { readonly id: string; readonly name: string }[] {
        return SEED_SERVICE_AREAS;
    }

    // -- closure (J2) ---------------------------------------------------------------------------

    /**
     * Which consents a `marketing_opt_out` request withdraws.
     *
     * A **prefix**, not a fixed pair, and that is a recorded divergence rather than a shortcut. The
     * backend's `ClosureService::MARKETING_CONSENT_CODES` names exactly two codes —
     * `consent.marketing_email` and `consent.marketing_whatsapp` — while this world's consent set
     * predates them and seeds `marketing_email` and `marketing_sms` (`./seed.ts`). Hard-coding the
     * backend's two here would produce a short-circuit that withdrew nothing at all, which is the
     * one outcome worse than withdrawing the wrong thing.
     *
     * Matching a prefix and nothing else is what keeps it safe: a short-circuit that withdrew
     * *every* consent would also revoke the terms of service somebody is still trading under.
     */
    static readonly MARKETING_CONSENT_PREFIXES: readonly string[] = [
        'marketing_',
        'consent.marketing_',
    ];

    #marketingConsentKeys(): readonly string[] {
        return [...this.#consents.keys()].filter((key) =>
            AccountMockStore.MARKETING_CONSENT_PREFIXES.some((prefix) => key.startsWith(prefix)),
        );
    }

    closurePreconditions(): ClosurePreconditions {
        return closurePreconditions(this.#closureWorld);
    }

    liveClosureRequest(): ClosureTicket | null {
        if (this.#closure === null) return null;
        const status = this.#closure.status;
        // Completed and cancelled requests are history, not something in flight.
        if (status === 'completed' || status === 'cancelled') return null;
        return this.#readClosure(this.#closure);
    }

    /**
     * Ask to close -- and get the code in the same answer.
     *
     * Three outcomes, and the wizard draws all three:
     *
     * - **`marketing_opt_out`** short-circuits. The two marketing consents are withdrawn and the
     *   request completes immediately: nothing was destroyed, so there is nothing to step up for.
     * - **`full`, blocked.** The row exists, `blocked` is true and no challenge is issued. Refusing
     *   to start is the answer, not an error, and the wizard renders the blockers as work to do.
     * - **`full`, clear.** A `closure_step_up` challenge is issued against the sign-in address, and
     *   `verifyClosure` is the irreversible step.
     */
    requestClosure(request: RequestClosureRequest): ClosureTicket {
        if (this.liveClosureRequest() !== null) throwFailure(conflictFailure());

        const id = closureRequestIdAt(this.#nextClosureOrdinal++);
        const note = request.reasonNote?.trim() ?? '';

        if (request.scope === 'marketing_opt_out') {
            for (const key of this.#marketingConsentKeys()) {
                this.setConsent({ key, granted: false });
            }
            this.#closure = {
                id,
                scope: 'marketing_opt_out',
                status: 'completed',
                reasonCode: request.reasonCode,
                reasonNote: note.length === 0 ? null : note,
                blockers: [],
                blocked: false,
                challengeId: null,
                completedAt: this.#iso(),
            };
            return this.#readClosure(this.#closure);
        }

        const preconditions = this.closurePreconditions();
        if (!preconditions.canClose) {
            this.#closure = {
                id,
                scope: 'full',
                status: 'requested',
                reasonCode: request.reasonCode,
                reasonNote: note.length === 0 ? null : note,
                blockers: preconditions.blockers,
                blocked: true,
                challengeId: null,
                completedAt: null,
            };
            return this.#readClosure(this.#closure);
        }

        const contact =
            this.#contacts.find((candidate) => candidate.isLoginEmail) ?? this.#contacts[0];
        if (contact === undefined) throwFailure(apiFailure('otp.channel_unavailable'));

        const challenge = this.issueChallenge({
            purpose: 'closure_step_up',
            contactPointId: contact.id,
        });

        this.#closure = {
            id,
            scope: 'full',
            status: 'requested',
            reasonCode: request.reasonCode,
            reasonNote: note.length === 0 ? null : note,
            blockers: preconditions.blockers,
            blocked: false,
            challengeId: challenge.id,
            completedAt: null,
        };
        return this.#readClosure(this.#closure);
    }

    /**
     * The irreversible step.
     *
     * The blockers are **re-read** before the account is touched, not trusted from the request: a
     * subscription can be created between step three and step four, and closing over an active one
     * is the defect the whole registry exists to prevent. A closure that has become blocked comes
     * back blocked with its challenge spent, which is the honest outcome.
     */
    verifyClosure(request: VerifyClosureRequest): ClosureTicket {
        const closure = this.#requireLiveClosure(request.ticketId);
        if (closure.challengeId === null) throwFailure(conflictFailure());

        this.verifyChallenge({ challengeId: closure.challengeId, code: request.code });
        closure.status = 'verified';

        const preconditions = this.closurePreconditions();
        closure.blockers = preconditions.blockers;
        if (!preconditions.canClose) {
            closure.blocked = true;
            closure.challengeId = null;
            return this.#readClosure(closure);
        }

        this.#finaliseClosure(closure);
        return this.#readClosure(closure);
    }

    cancelClosure(ticketId: string): ClosureTicket {
        const closure = this.#requireLiveClosure(ticketId);
        closure.status = 'cancelled';
        closure.challengeId = null;
        return this.#readClosure(closure);
    }

    #requireLiveClosure(ticketId: string): MutableClosure {
        const closure = this.#closure;
        if (closure === null || closure.id !== ticketId) {
            throwFailure(apiFailure('resource.not_found'));
        }
        if (closure.status === 'completed' || closure.status === 'cancelled') {
            throwFailure(conflictFailure());
        }
        return closure;
    }

    /**
     * What closing actually does to this world.
     *
     * Contacts, addresses and the dietary profile go; consents are withdrawn; the account lifecycle
     * becomes `closed`. The free-text reason note is deleted here rather than kept for analytics --
     * it is the one confidential field on the request and it has done its job. The bundle is then
     * told, so the credential is cleared in the same breath.
     */
    #finaliseClosure(closure: MutableClosure): void {
        const at = this.#iso();

        for (const key of this.#consents.keys()) {
            const state = this.#consents.get(key);
            if (state?.granted === true)
                this.#consents.set(key, { granted: false, at: state.at, off: at });
        }

        this.#contacts.splice(0, this.#contacts.length);
        this.#addresses.splice(0, this.#addresses.length);
        this.#dietary = {
            dietCategoryCodes: [],
            allergens: [],
            excludedIngredientIds: [],
            updatedAt: null,
        };

        this.#account = { ...this.#account, lifecycle: 'closed' };
        closure.status = 'completed';
        closure.completedAt = at;
        closure.reasonNote = null;
        closure.challengeId = null;

        this.#onAccountClosed?.();
    }

    #readClosure(closure: MutableClosure): ClosureTicket {
        return {
            id: closure.id,
            scope: closure.scope,
            status: closure.status,
            reasonCode: closure.reasonCode,
            blockers: closure.blockers,
            blocked: closure.blocked,
            verificationRequired: closure.challengeId !== null,
            challenge: closure.challengeId === null ? null : this.getChallenge(closure.challengeId),
            scheduledFor: null,
            completedAt: closure.completedAt,
        };
    }

    // ── internals ───────────────────────────────────────────────────────────────────────────────

    #iso(): string {
        return new Date(this.#now()).toISOString();
    }

    #takeRuntimeOrdinal(): number {
        return this.#nextRuntimeOrdinal++;
    }

    #consentState(key: string): ConsentState {
        const definition = SEED_CONSENTS.find((candidate) => candidate.key === key);
        if (definition === undefined) throwFailure(apiFailure('resource.not_found'));
        const state = this.#consents.get(key) ?? { granted: false, at: null, off: null };
        return {
            definition,
            granted: state.granted,
            grantedAt: state.at,
            withdrawnAt: state.off,
        };
    }

    #buildAddress(id: string, request: SaveAddressRequest): CustomerAddress {
        const area = SEED_SERVICE_AREAS.find((candidate) => candidate.id === request.areaId);
        // No free text and no string matching: an unknown area is a rejection, not a guess.
        if (area === undefined) {
            throwFailure(validationFailure({ areaId: ['Choose an area we deliver to.'] }));
        }
        return {
            id,
            label: request.label,
            areaId: area.id,
            areaName: area.name,
            line1: request.line1,
            line2: request.line2 ?? null,
            building: request.building ?? null,
            floor: request.floor ?? null,
            notes: request.notes ?? null,
            isDefault: request.makeDefault === true || this.#addresses.length === 0,
        };
    }

    #applyDefault(address: CustomerAddress): void {
        if (!address.isDefault) return;
        for (const [index, candidate] of this.#addresses.entries()) {
            if (candidate.id !== address.id && candidate.isDefault) {
                this.#addresses.splice(index, 1, { ...candidate, isDefault: false });
            }
        }
    }

    /**
     * The channels this account could switch to, minus the one that just failed.
     *
     * Derived from the contacts that actually exist. A lockout screen that offered SMS to somebody
     * with no number on file would be sending them nowhere.
     */
    #escapeChannels(except: OtpChannel): readonly OtpChannel[] {
        const kinds = new Set(this.#contacts.map((contact) => contact.kind));
        const channels = [...kinds].flatMap((kind) => CHANNELS_FOR_KIND[kind]);
        return channels.filter(
            (channel) => channel !== except && (this.#simulate || channel === 'email'),
        );
    }

    #resolveChannel(contact: MutableContact, requested: OtpChannel | undefined): OtpChannel {
        const allowed = CHANNELS_FOR_KIND[contact.kind];
        const usable = allowed.filter((channel) => this.#simulate || channel === 'email');
        if (usable.length === 0) throwFailure(apiFailure('otp.channel_unavailable'));
        if (requested === undefined) return usable[0] as OtpChannel;
        if (!usable.includes(requested)) throwFailure(apiFailure('otp.channel_unavailable'));
        return requested;
    }

    #assertNotLockedOut(contact: MutableContact): void {
        const lockout = this.#lockouts.get(contact.id);
        if (lockout === undefined) return;
        if (lockout.until <= this.#now()) {
            this.#lockouts.delete(contact.id);
            return;
        }
        throwFailure(
            otpLockedFailure(
                new Date(lockout.until).toISOString(),
                this.#escapeChannels(CHANNELS_FOR_KIND[contact.kind][0] as OtpChannel),
            ),
        );
    }

    #lockOut(contact: MutableContact, channel: OtpChannel) {
        const previous = this.#lockouts.get(contact.id);
        const count = (previous?.count ?? 0) + 1;
        const seconds = count === 1 ? OTP_LOCKOUT_SECONDS : OTP_REPEAT_LOCKOUT_SECONDS;
        const until = this.#now() + seconds * 1000;
        this.#lockouts.set(contact.id, { until, count });
        return otpLockedFailure(new Date(until).toISOString(), this.#escapeChannels(channel));
    }

    /** Every challenge read carries the cooldown — journey-forced shape 1. */
    #read(challenge: MutableChallenge, contact: MutableContact): OtpChallenge {
        const elapsed = (this.#now() - challenge.sentAt) / 1000;
        return {
            id: challenge.id,
            purpose: challenge.purpose,
            channel: challenge.channel,
            maskedDestination: contact.maskedValue,
            codeLength: OTP_CODE_LENGTH,
            expiresAt: new Date(challenge.expiresAt).toISOString(),
            resendCooldownSeconds: Math.max(0, Math.ceil(OTP_RESEND_COOLDOWN_SECONDS - elapsed)),
            attemptsRemaining: challenge.attemptsRemaining,
            resendsRemaining: challenge.resendsRemaining,
            availableChannels: CHANNELS_FOR_KIND[contact.kind].filter(
                (candidate) => this.#simulate || candidate === 'email',
            ),
            simulatedChannels: this.#simulate ? SIMULATED_CHANNELS : [],
        };
    }
}

function item(
    step: AccountChecklistItem['step'],
    complete: boolean,
    required: boolean,
): AccountChecklistItem {
    return { step, complete, required, blockedReason: null };
}

function freezeContact(contact: MutableContact): ContactPoint {
    return { ...contact };
}

/**
 * The one place the *mock server* masks a value.
 *
 * It lives here rather than anywhere a client could reach it, because the contract's fourth
 * journey-forced shape is precisely that masking is the server's job.
 */
function maskValue(kind: ContactKind, value: string): string {
    if (kind === 'email') {
        const at = value.indexOf('@');
        if (at <= 0) return '•'.repeat(value.length);
        return `${value.slice(0, 1)}${'•'.repeat(Math.max(1, at - 1))}${value.slice(at)}`;
    }
    const tail = value.slice(-4);
    return `${value.slice(0, Math.max(0, value.length - 4)).replace(/\d/g, '•')}${tail}`;
}
