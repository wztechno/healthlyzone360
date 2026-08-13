import type { IngredientId, IsoDateTime, Locale, ServiceAreaId } from '@healthy360/domain-types';

import type { ContactPoint, OtpChallenge } from './verification.ts';

/**
 * D2C account contract (plan Phase J1, appendix D customers cluster; appendix E §A.2).
 *
 * Standalone for the same reason `./verification.ts` is: the shapes and the mock world land first,
 * and a follow-up slice registers the repository in the `Repositories` bundle and adds the query
 * hooks. Nothing above this package imports it yet.
 *
 * ## Two rules this contract encodes rather than documents
 *
 * - **The server decides activation.** {@link AccountSetupChecklist} carries `canActivate` and a
 *   `required` flag *per step*, so the client never re-implements the activation evaluator. Whether
 *   phone verification is required at all is configurable and off in production until a real SMS
 *   provider exists (gate A-011) — a client with a hard-coded "phone then address then consents"
 *   rule would show a step the server does not want and block a person who is already activatable.
 * - **The allergy declaration is the store of record.** The onboarding wizard pre-fills from
 *   {@link DietaryProfile} and writes back to it; the meal configurator prefers the declaration over
 *   anything it holds locally. There is one home for "what this person cannot eat", and it is here.
 */

/**
 * The account lifecycle (appendix D-bis #5).
 *
 * `provisional` is a real state, not a placeholder: an account exists from the first registration
 * step so contacts and addresses have somewhere to hang, and it becomes `active` only when the
 * server's evaluator says so. Abandoned provisionals are purged on a schedule.
 */
export const ACCOUNT_LIFECYCLES = [
    'provisional',
    'active',
    'suspended',
    'closing',
    'closed',
] as const;
export type AccountLifecycle = (typeof ACCOUNT_LIFECYCLES)[number];

export interface CustomerAccount {
    readonly id: string;
    readonly lifecycle: AccountLifecycle;
    readonly displayName: string;
    /** The sign-in address. Mirrored as a `login_email` contact point that cannot be removed. */
    readonly loginEmail: string;
    readonly locale: Locale;
    readonly createdAt: IsoDateTime;
    readonly activatedAt: IsoDateTime | null;
}

/**
 * The setup steps a checklist screen draws.
 *
 * Named rather than free-form so the client can order and illustrate them; which of them *count* is
 * still the server's answer, carried on each item.
 */
export const ACCOUNT_CHECKLIST_STEPS = [
    'verify_email',
    'verify_phone',
    'add_address',
    'dietary_profile',
    'consents',
] as const;
export type AccountChecklistStep = (typeof ACCOUNT_CHECKLIST_STEPS)[number];

export interface AccountChecklistItem {
    readonly step: AccountChecklistStep;
    readonly complete: boolean;
    /**
     * Whether this step blocks activation **in this environment**.
     *
     * The one field that stops the client owning the activation rules. A step that is incomplete
     * and not required is shown as an invitation, not a blocker.
     */
    readonly required: boolean;
    /** Server-authored explanation when the step cannot be completed yet. Usually `null`. */
    readonly blockedReason: string | null;
}

export interface AccountSetupChecklist {
    readonly lifecycle: AccountLifecycle;
    readonly items: readonly AccountChecklistItem[];
    /** The evaluator's answer. Never recomputed from `items` on the device. */
    readonly canActivate: boolean;
}

/**
 * A delivery address.
 *
 * `areaId` is a foreign key into the platform's service areas, never free text: matching a typed
 * area name against a delivery zone is how an order gets accepted for somewhere nobody drives to.
 */
export interface CustomerAddress {
    readonly id: string;
    /** "Home", "Office" — the person's own name for it. */
    readonly label: string;
    readonly areaId: ServiceAreaId;
    /** The area's display name, resolved server-side so a list needs one request. */
    readonly areaName: string;
    readonly line1: string;
    readonly line2: string | null;
    readonly building: string | null;
    readonly floor: string | null;
    /** Directions for the driver. Not an address line. */
    readonly notes: string | null;
    readonly isDefault: boolean;
    /**
     * Whether a kitchen currently publishes a delivery zone covering this address's area —
     * computed by the server against the real zone coverage, which is the only place that answer
     * exists. Screens must prefer this over any client-side comparison of area strings: the
     * gazetteer's granularity and a zone's display label do not have to match textually.
     */
    readonly isDeliverable: boolean;
}

export interface SaveAddressRequest {
    readonly label: string;
    readonly areaId: ServiceAreaId;
    readonly line1: string;
    readonly line2?: string | undefined;
    readonly building?: string | undefined;
    readonly floor?: string | undefined;
    readonly notes?: string | undefined;
    readonly makeDefault?: boolean | undefined;
}

/**
 * How badly an allergen matters to this person.
 *
 * `avoidance` is a preference and `intolerance` is a discomfort; `allergy` is a safety constraint
 * and is the only one the configurator treats as a hard exclusion. Collapsing the three would either
 * over-restrict a menu or under-protect a person, and both are wrong.
 */
export const ALLERGEN_SEVERITIES = ['avoidance', 'intolerance', 'allergy'] as const;
export type AllergenSeverity = (typeof ALLERGEN_SEVERITIES)[number];

export interface AllergenDeclaration {
    /** The platform allergen code (`allergens.code` — the justified natural-key exception). */
    readonly allergenCode: string;
    readonly severity: AllergenSeverity;
    readonly note: string | null;
}

/**
 * Dietary profile — special-category data (appendix D).
 *
 * Religious dietary requirements are special-category too, which is why they sit here rather than
 * being smuggled into a generic preferences blob: a staff read of this record is audited with a
 * purpose of use.
 */
export interface DietaryProfile {
    /** Diet category codes (`vegetarian`, `halal`, …). */
    readonly dietCategoryCodes: readonly string[];
    readonly allergens: readonly AllergenDeclaration[];
    /** Ingredients this person will not eat for reasons that are not an allergen class. */
    readonly excludedIngredientIds: readonly IngredientId[];
    readonly updatedAt: IsoDateTime | null;
}

export interface SaveDietaryProfileRequest {
    readonly dietCategoryCodes: readonly string[];
    readonly allergens: readonly AllergenDeclaration[];
    readonly excludedIngredientIds: readonly IngredientId[];
}

/**
 * A consent the D2C set defines (seven at J1, including age confirmation).
 *
 * `text` is authored per locale on the server, not machine-translated at render time — a consent a
 * person agreed to has to be the text they were shown (OQ-033).
 */
export interface ConsentDefinition {
    readonly key: string;
    readonly version: string;
    readonly title: string;
    readonly text: string;
    /** Required consents block activation; optional ones are genuinely optional. */
    readonly required: boolean;
}

export interface ConsentState {
    readonly definition: ConsentDefinition;
    readonly granted: boolean;
    readonly grantedAt: IsoDateTime | null;
    readonly withdrawnAt: IsoDateTime | null;
}

export interface SetConsentRequest {
    readonly key: string;
    readonly granted: boolean;
}

/**
 * The account area's data surface.
 *
 * `getContacts` is deliberately absent — contacts belong to `VerificationRepository`, which is also
 * what adds and verifies them. `AccountOverview` re-exposes them read-only so the checklist screen
 * does not need two round trips to say "your email is confirmed and your phone is not".
 */
export interface AccountOverview {
    readonly account: CustomerAccount;
    readonly contacts: readonly ContactPoint[];
    readonly checklist: AccountSetupChecklist;
}

/**
 * One area a delivery address may point at.
 *
 * A consumer-facing projection of the platform's service areas, and the smallest one that works:
 * an address editor needs the identifier to send and the name to show, and nothing else.
 * `KitchenAdminRepository.listServiceAreas` covers the same rows for a *management* audience — with
 * zone membership, activation state and a tenant context a consumer has neither the permission nor
 * the need for — which is why this is a separate operation rather than a shared one.
 *
 * It became a repository method in the integrator wave. Before that the mock bundle carried the
 * list as a bare `accountServiceAreas` function, deliberately not shaped like a contract, because
 * no consumer-facing endpoint published one. `GET /api/v1/reference/delivery-areas` does.
 */
export interface AccountServiceArea {
    readonly id: ServiceAreaId;
    readonly name: string;
}

/* ------------------------------------------------------------------------------------------------
 * J2 — closure and data offboarding
 *
 * The rule this section exists to encode: **a blocker is never fabricated**. The backend runs seven
 * checks and each answers with one of four statuses, two of which mean "this check did not apply".
 * A closure screen that collapsed `not_applicable` into `clear` would tell somebody their wallet
 * balance was settled when there is no wallet module at all — a sentence that becomes a lie the day
 * PAY1 ships. So the vocabulary reaches the client whole and the wizard renders all four.
 * ---------------------------------------------------------------------------------------------- */

/** Why somebody is leaving. The backend's `ClosureReasonCode`, verbatim and in its order. */
export const CLOSURE_REASON_CODES = [
    'no_longer_needed',
    'too_expensive',
    'moving_away',
    'dietary_needs_unmet',
    'service_quality',
    'privacy_concerns',
    'duplicate_account',
    'other',
] as const;
export type ClosureReasonCode = (typeof CLOSURE_REASON_CODES)[number];

/**
 * How far the request goes.
 *
 * `marketing_opt_out` is the **short-circuit**: it withdraws the marketing consents and stops. It
 * consults no blockers and needs no one-time code, because nothing is destroyed. Offering it first
 * is not a dark pattern — most people who reach a closure screen want the emails to stop, and
 * closing an account to achieve that is a worse outcome for them than for the business.
 *
 * The value is `full`, not `full_closure`: the backend's enum case is `Full`.
 */
export const CLOSURE_SCOPES = ['marketing_opt_out', 'full'] as const;
export type ClosureScope = (typeof CLOSURE_SCOPES)[number];

/**
 * What a check answered.
 *
 * - `blocking` — a real thing in the way. Only this stops closure.
 * - `clear` — the check ran and found nothing.
 * - `advisory` — something worth saying before it disappears (an unsettled credit memo), which does
 *   not stop anything. Acknowledged, never resolved.
 * - `not_applicable` — the module behind the check does not exist. Honest, and temporary.
 */
export const CLOSURE_BLOCKER_STATUSES = [
    'blocking',
    'clear',
    'advisory',
    'not_applicable',
] as const;
export type ClosureBlockerStatus = (typeof CLOSURE_BLOCKER_STATUSES)[number];

/** The seven registered checks, in the order the backend registers them. */
export const CLOSURE_BLOCKER_CODES = [
    'open_orders',
    'active_subscriptions',
    'organisation_memberships',
    'pending_b2b_signatures',
    'unsettled_credit_memos',
    'wallet_balance',
    'payment_methods',
] as const;
export type ClosureBlockerCode = (typeof CLOSURE_BLOCKER_CODES)[number];

export interface ClosureBlocker {
    readonly code: ClosureBlockerCode;
    readonly status: ClosureBlockerStatus;
    /** How many things. Always `0` on `clear` and `not_applicable`. */
    readonly count: number;
    /** The server's own reason string (`orders_in_flight`, `no_wallet_module`). `null` on `clear`. */
    readonly reason: string | null;
    /**
     * Where the person goes to deal with it.
     *
     * Client-side routing, and deliberately so: the server knows *what* is in the way, the
     * application knows *which screen* resolves it. A blocker with nowhere to go carries `null` and
     * the wizard states the fact without a dead control.
     */
    readonly resolveHref: string | null;
}

/**
 * What closing would cost, before anybody commits to it.
 *
 * `canClose` is the server's verdict and is never recomputed from `blockers` on the device — the
 * same rule {@link AccountSetupChecklist} encodes for activation, for the same reason.
 *
 * `retainedRecordCodes` says what survives the purge. Orders keep their amounts, dates and area for
 * accounting; a one-way fingerprint of the email keeps "never contact me again" true after the
 * address itself is gone. Stating it up front is the difference between a promise the system keeps
 * and one it breaks.
 */
export interface ClosurePreconditions {
    readonly canClose: boolean;
    readonly blockers: readonly ClosureBlocker[];
    readonly retainedRecordCodes: readonly string[];
}

export const CLOSURE_REQUEST_STATUSES = [
    'requested',
    'verified',
    'scheduled',
    'completed',
    'cancelled',
] as const;
export type ClosureRequestStatus = (typeof CLOSURE_REQUEST_STATUSES)[number];

export interface RequestClosureRequest {
    readonly reasonCode: ClosureReasonCode;
    /** Free text, invited only by `other`. Confidential, and deleted when the closure finalises. */
    readonly reasonNote?: string | undefined;
    readonly scope: ClosureScope;
}

/**
 * A closure in flight.
 *
 * The one-time-code challenge is **issued with the ticket**, not fetched afterwards: a request that
 * needs a step-up and a challenge that has to be asked for separately is two round trips and one
 * race. `challenge` is `null` for `marketing_opt_out`, which needs no step-up, and for a request
 * that came back `blocked`.
 */
export interface ClosureTicket {
    readonly id: string;
    readonly scope: ClosureScope;
    readonly status: ClosureRequestStatus;
    readonly reasonCode: ClosureReasonCode;
    /** The verdict at the moment the request was made. Re-read, never cached from step three. */
    readonly blockers: readonly ClosureBlocker[];
    readonly blocked: boolean;
    readonly verificationRequired: boolean;
    readonly challenge: OtpChallenge | null;
    readonly scheduledFor: IsoDateTime | null;
    readonly completedAt: IsoDateTime | null;
}

export interface VerifyClosureRequest {
    readonly ticketId: string;
    readonly code: string;
}

export interface AccountRepository {
    getOverview(): Promise<AccountOverview>;
    getChecklist(): Promise<AccountSetupChecklist>;

    /** The closed list an address editor's area select is built from. */
    listServiceAreas(): Promise<readonly AccountServiceArea[]>;

    listAddresses(): Promise<readonly CustomerAddress[]>;
    addAddress(request: SaveAddressRequest): Promise<CustomerAddress>;
    updateAddress(
        request: SaveAddressRequest & { readonly addressId: string },
    ): Promise<CustomerAddress>;
    removeAddress(request: { readonly addressId: string }): Promise<void>;

    getDietaryProfile(): Promise<DietaryProfile>;
    saveDietaryProfile(request: SaveDietaryProfileRequest): Promise<DietaryProfile>;

    listConsents(): Promise<readonly ConsentState[]>;
    setConsent(request: SetConsentRequest): Promise<ConsentState>;

    /* ── J2: closure ─────────────────────────────────────────────────────────────────────────── */

    /** `GET /api/v1/me/closure-preconditions` — what is in the way, and what survives. */
    getClosurePreconditions(): Promise<ClosurePreconditions>;

    /**
     * `GET /api/v1/me/closure-requests/live` — the one request in flight, or `null`.
     *
     * A person has at most one; the backend's partial unique index says so, and asking for a second
     * is refused with `closure_already_in_flight`. The wizard reads this on mount so a reload lands
     * back on the step it left — with the challenge's cooldown intact rather than reset.
     */
    getLiveClosureRequest(): Promise<ClosureTicket | null>;

    /**
     * `POST /api/v1/me/closure-requests` — and it issues the code in the same answer.
     *
     * A `full` request whose blockers are blocking comes back `blocked: true` with no challenge:
     * refusing to start is not an error, it is the answer, and the wizard renders it as a list of
     * things to go and do.
     */
    requestClosure(request: RequestClosureRequest): Promise<ClosureTicket>;

    /**
     * `POST /api/v1/me/closure-requests/{request}/verify` — the irreversible step.
     *
     * Request-bound: the code proves this person asked for *this* closure, not merely that somebody
     * holding the session can read an inbox.
     */
    verifyClosure(request: VerifyClosureRequest): Promise<ClosureTicket>;

    /** `DELETE /api/v1/me/closure-requests/{request}` — changed their mind. */
    cancelClosure(request: { readonly ticketId: string }): Promise<ClosureTicket>;
}
