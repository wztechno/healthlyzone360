import type { IngredientId, IsoDateTime, Locale, ServiceAreaId } from '@healthy360/domain-types';

import type { ContactPoint } from './verification.ts';

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
}
