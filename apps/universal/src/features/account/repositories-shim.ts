import { ServiceAreaId } from '@healthy360/domain-types';
import { useMemo } from 'react';

import { useRepositoryContext } from '../../data/repository-provider.tsx';

/**
 * ████ TEMPORARY — REMOVED BY THE INTEGRATOR WAVE ████
 *
 * `VerificationRepository` and `AccountRepository` landed in J1's groundwork as **standalone**
 * contracts (`packages/api-client/src/contracts/{verification,account}.ts`): declared, mocked, and
 * deliberately *not* members of the required `Repositories` bundle in `contracts/index.ts`. Adding
 * a required field to that bundle is a change that also has to write the API-side stub, and that
 * pair of edits belongs in one commit owned by one wave. This slice does not own it.
 *
 * So the account screens need to reach two repositories the application's `Repositories` type does
 * not mention yet, without either pretending it does or waiting for a slice that has not been
 * scheduled. This module is that bridge, and it is written to disappear.
 *
 * ## How it finds them
 *
 * The **mock bundle already carries them** as extra fields (`mock/repositories.ts`), so in mock
 * mode the object the factory built genuinely has `account` and `verification` on it — there is
 * nothing to construct here and, more importantly, nothing to import. That matters: the
 * application's ESLint guard forbids any screen or hook from importing
 * `@healthy360/api-client/mock` (plan §5), and an exemption for one shim file would open exactly
 * the door that guard exists to keep shut.
 *
 * So the resolution is one runtime `typeof` test against the resolved bundle — **not** a type
 * assertion about what the bundle contains:
 *
 * 1. Fields present → use them. True today via the mock bundle's extra fields, and true tomorrow
 *    via the registered contract, with no edit at any call site.
 * 2. Fields absent → every method rejects with a message naming the missing registration. That is
 *    what `dataMode: 'api'` gets until the API implementations exist, and it is the right answer:
 *    a screen quietly rendering fixture data against a real API would be the worst of the outcomes.
 *
 * ## What the integrator wave deletes
 *
 * This file, `ServiceAreaOption` and `listServiceAreas` (see the gap below), the extra fields on
 * `MockRepositories`, and the shim import at the top of `src/data/account-hooks.ts` — which then
 * reads `useRepositories().account` and `.verification` like every other hook module.
 *
 * ## CONTRACT GAP — service areas
 *
 * The address editor has to offer a closed list of areas (`CustomerAddress.areaId` is a foreign key
 * and free text is refused), and `AccountRepository` publishes no operation that lists them.
 * `KitchenAdminRepository.listServiceAreas` exists but is an organisation-scoped management surface
 * a consumer has neither the context nor the permission for. Until `AccountRepository` gains a
 * `listServiceAreas()` — or a public `GET /api/v1/reference/service-areas` exists — the mock bundle
 * carries the list as a bare `accountServiceAreas` function, deliberately *not* shaped like a
 * repository method so it cannot be mistaken for one, and API mode rejects.
 */

/* ── the two contracts, structurally ──────────────────────────────────────────────────────────── */

/**
 * The account contract as this application needs it.
 *
 * Declared structurally rather than imported, for the same reason
 * `features/verification/otp-challenge-panel.tsx` declares `OtpChallengeView` that way:
 * `@healthy360/api-client/contracts` does not re-export `account.ts` or `verification.ts`, which is
 * the "not registered yet" fact seen from the type side. A real `AccountRepository` satisfies this
 * interface exactly, so the integrator wave swaps the import and nothing else — no cast, no
 * adapter.
 */
export interface AccountRepository {
    getOverview(): Promise<AccountOverview>;
    getChecklist(): Promise<AccountSetupChecklist>;
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

export interface VerificationRepository {
    listContactPoints(): Promise<readonly ContactPoint[]>;
    addContactPoint(request: AddContactPointRequest): Promise<ContactPointAdded>;
    removeContactPoint(request: { readonly contactPointId: string }): Promise<void>;
    setPrimaryContactPoint(request: { readonly contactPointId: string }): Promise<ContactPoint>;
    issueChallenge(request: IssueOtpRequest): Promise<OtpChallenge>;
    getChallenge(request: { readonly challengeId: string }): Promise<OtpChallenge>;
    resendChallenge(request: ResendOtpRequest): Promise<OtpChallenge>;
    verifyChallenge(request: VerifyOtpRequest): Promise<OtpVerificationResult>;
}

export type AccountLifecycle = 'provisional' | 'active' | 'suspended' | 'closing' | 'closed';

export type AccountChecklistStep =
    'verify_email' | 'verify_phone' | 'add_address' | 'dietary_profile' | 'consents';

export interface AccountChecklistItem {
    readonly step: AccountChecklistStep;
    readonly complete: boolean;
    /** Whether this step blocks activation **in this environment**. The server's answer, always. */
    readonly required: boolean;
    readonly blockedReason: string | null;
}

export interface AccountSetupChecklist {
    readonly lifecycle: AccountLifecycle;
    readonly items: readonly AccountChecklistItem[];
    /** The evaluator's answer. Never recomputed from `items` on the device. */
    readonly canActivate: boolean;
}

export interface CustomerAccount {
    readonly id: string;
    readonly lifecycle: AccountLifecycle;
    readonly displayName: string;
    readonly loginEmail: string;
    readonly locale: string;
    readonly createdAt: string;
    readonly activatedAt: string | null;
}

export interface AccountOverview {
    readonly account: CustomerAccount;
    readonly contacts: readonly ContactPoint[];
    readonly checklist: AccountSetupChecklist;
}

export interface CustomerAddress {
    readonly id: string;
    readonly label: string;
    readonly areaId: ServiceAreaId;
    /** Resolved server-side, so a list needs one request. */
    readonly areaName: string;
    readonly line1: string;
    readonly line2: string | null;
    readonly building: string | null;
    readonly floor: string | null;
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

export type AllergenSeverity = 'avoidance' | 'intolerance' | 'allergy';

export interface AllergenDeclaration {
    readonly allergenCode: string;
    readonly severity: AllergenSeverity;
    readonly note: string | null;
}

export interface DietaryProfile {
    readonly dietCategoryCodes: readonly string[];
    readonly allergens: readonly AllergenDeclaration[];
    readonly excludedIngredientIds: readonly string[];
    /** `null` until the person has answered — which is not the same as having no allergies. */
    readonly updatedAt: string | null;
}

export interface SaveDietaryProfileRequest {
    readonly dietCategoryCodes: readonly string[];
    readonly allergens: readonly AllergenDeclaration[];
    readonly excludedIngredientIds: readonly string[];
}

export interface ConsentDefinition {
    readonly key: string;
    readonly version: string;
    readonly title: string;
    /** Authored per locale on the server, never machine-translated at render time (OQ-033). */
    readonly text: string;
    readonly required: boolean;
}

export interface ConsentState {
    readonly definition: ConsentDefinition;
    readonly granted: boolean;
    readonly grantedAt: string | null;
    readonly withdrawnAt: string | null;
}

export interface SetConsentRequest {
    readonly key: string;
    readonly granted: boolean;
}

export type ContactKind = 'email' | 'phone';
export type OtpChannel = 'email' | 'sms' | 'whatsapp';
export type OtpPurpose =
    | 'contact_verification'
    | 'guest_order'
    | 'guest_deletion'
    | 'closure_step_up'
    | 'payment_details_step_up'
    | 'b2b_signatory';

export interface ContactPoint {
    readonly id: string;
    readonly kind: ContactKind;
    readonly value: string;
    /** Server-authored. The client is never given the value to mask for itself. */
    readonly maskedValue: string;
    readonly verified: boolean;
    readonly verifiedAt: string | null;
    readonly isPrimary: boolean;
    readonly isLoginEmail: boolean;
    readonly createdAt: string;
}

export interface AddContactPointRequest {
    readonly kind: ContactKind;
    readonly value: string;
    readonly verifyNow?: boolean | undefined;
}

export interface ContactPointAdded {
    readonly contact: ContactPoint;
    readonly challenge: OtpChallenge | null;
}

export interface OtpChallenge {
    readonly id: string;
    readonly purpose: OtpPurpose;
    readonly channel: OtpChannel;
    readonly maskedDestination: string;
    readonly codeLength: number;
    readonly expiresAt: string;
    /** Present on *every* read, not only on the answer to a resend. */
    readonly resendCooldownSeconds: number;
    readonly attemptsRemaining: number;
    readonly resendsRemaining: number;
    readonly availableChannels: readonly OtpChannel[];
    /** Non-production only. Always empty in production. */
    readonly simulatedChannels: readonly OtpChannel[];
}

export interface IssueOtpRequest {
    readonly purpose: OtpPurpose;
    readonly contactPointId?: string | undefined;
    readonly channel?: OtpChannel | undefined;
}

export interface ResendOtpRequest {
    readonly challengeId: string;
    readonly channel?: OtpChannel | undefined;
}

export interface VerifyOtpRequest {
    readonly challengeId: string;
    readonly code: string;
}

export interface OtpVerificationResult {
    readonly challengeId: string;
    readonly purpose: OtpPurpose;
    readonly verifiedAt: string;
    readonly contactPointId: string | null;
    readonly stepUpUntil: string | null;
}

/** An area an address may point at. Shim-only; see the contract gap in the header. */
export interface ServiceAreaOption {
    readonly id: ServiceAreaId;
    readonly name: string;
}

/* ── resolution ──────────────────────────────────────────────────────────────────────────────── */

/**
 * Everything the account area needs, however it was obtained.
 *
 * `ready` is separate from the repositories being usable because the bundle resolves
 * asynchronously: a query hook guards on `ready` exactly as the other modules guard on
 * `repositories !== null`.
 */
export interface AccountRepositories {
    readonly account: AccountRepository;
    readonly verification: VerificationRepository;
    readonly listServiceAreas: () => Promise<readonly ServiceAreaOption[]>;
    readonly ready: boolean;
}

/** The shapes the resolved bundle *may* carry. Probed, never asserted. */
interface MaybeRegistered {
    readonly account?: unknown;
    readonly verification?: unknown;
    readonly accountServiceAreas?: unknown;
}

function isRepositoryLike(value: unknown): boolean {
    return typeof value === 'object' && value !== null;
}

function unregistered(): never {
    throw new Error(
        'AccountRepository / VerificationRepository are not registered in the Repositories bundle. ' +
            'Register both in packages/api-client/src/contracts/index.ts, implement them in ' +
            'src/api/, and then delete src/features/account/repositories-shim.ts.',
    );
}

/** A repository whose every method throws the registration message, so no screen renders a lie. */
function refusing<T extends object>(): T {
    return new Proxy({} as T, { get: unregistered });
}

const REFUSING_ACCOUNT = refusing<AccountRepository>();
const REFUSING_VERIFICATION = refusing<VerificationRepository>();

/**
 * The account and verification repositories.
 *
 * The `typeof` tests are genuine runtime checks against the object the factory produced. That is
 * what makes the hand-over automatic: when the contracts are registered, this hook keeps working
 * and then gets deleted, rather than needing a search-and-replace first.
 */
export function useAccountRepositories(): AccountRepositories {
    const { repositories } = useRepositoryContext();

    return useMemo<AccountRepositories>(() => {
        // `Repositories` and `MaybeRegistered` have no members in common — which is precisely the
        // fact this file exists for — so the probe reads the object through `unknown`. The two
        // `typeof` tests below are what make that safe; nothing is assumed about the shape.
        const bundle = (repositories ?? {}) as unknown as MaybeRegistered;

        if (!isRepositoryLike(bundle.account) || !isRepositoryLike(bundle.verification)) {
            return {
                account: REFUSING_ACCOUNT,
                verification: REFUSING_VERIFICATION,
                listServiceAreas: unregistered,
                // `false` whether the bundle is still resolving or will never carry these: either
                // way nothing here may be called, and the queries stay disabled.
                ready: false,
            };
        }

        const areas = bundle.accountServiceAreas;
        const listServiceAreas =
            typeof areas === 'function'
                ? async (): Promise<readonly ServiceAreaOption[]> => {
                      const rows = (await (
                          areas as () => Promise<readonly { id: string; name: string }[]>
                      )()) satisfies readonly { id: string; name: string }[];
                      // The brand is re-applied at the boundary rather than carried through an
                      // `unknown`: `ServiceAreaId.parse` rejects a value that is not one, which is
                      // the point of the codec.
                      return rows.map((row) => ({
                          id: ServiceAreaId.parse(row.id),
                          name: row.name,
                      }));
                  }
                : unregistered;

        return {
            account: bundle.account as AccountRepository,
            verification: bundle.verification as VerificationRepository,
            listServiceAreas,
            ready: true,
        };
    }, [repositories]);
}
