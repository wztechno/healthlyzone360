import { useMemo } from 'react';

import { useRepositoryContext } from '../../data/repository-provider.tsx';

/**
 * ████ TEMPORARY — REMOVED BY THE INTEGRATOR WAVE ████
 *
 * `B2BApplicationRepository` landed in B1's frontend groundwork as a **standalone** contract
 * (`packages/api-client/src/contracts/b2b-application.ts`): declared, mocked, and deliberately not a
 * member of the required `Repositories` bundle in `contracts/index.ts`. Adding a required field to
 * that bundle is a change that also has to write the API-side implementation, and that pair of edits
 * belongs in one commit owned by one wave. This slice does not own it.
 *
 * This is the same bridge `features/account/repositories-shim.ts` is, written the same way and for
 * the same reason — see that file's header for the full argument. In short: the **mock bundle
 * already carries the repository** as an extra field, so in mock mode the object the factory built
 * genuinely has `b2bApplication` on it; the resolution is one runtime `typeof` test against the
 * resolved bundle rather than a type assertion, so the day the contract is registered this hook
 * keeps working and is then deleted.
 *
 * In `dataMode: 'api'`, every method rejects with a message naming the missing registration. That is
 * the right answer: a wizard quietly saving a company's registration number into a fixture world
 * while pointed at a real API would be the worst of the available outcomes.
 *
 * ## What the integrator wave deletes
 *
 * This file, the extra fields on `MockRepositories`, and the shim import at the top of
 * `src/data/b2b-application-hooks.ts` — which then reads `useRepositories().b2bApplication` like
 * every other hook module.
 */

/* ── the contract, structurally ───────────────────────────────────────────────────────────────── */

export type B2BApplicationState =
    | 'draft'
    | 'submitted'
    | 'in_review'
    | 'info_requested'
    | 'approved'
    | 'agreement_pending'
    | 'agreement_signed'
    | 'provisioning'
    | 'provisioned'
    | 'declined'
    | 'withdrawn';

export type B2BApplicationSection = 'company' | 'signatory' | 'trade_terms' | 'logistics';

export type B2BBusinessType =
    | 'restaurant'
    | 'cafe'
    | 'hotel'
    | 'catering'
    | 'retail'
    | 'corporate_office'
    | 'school'
    | 'hospital'
    | 'gym'
    | 'other';

export type B2BPaymentTerms = 'prepaid' | 'net_15' | 'net_30' | 'net_60';

export type B2BVolumeBand =
    'under_50' | 'from_50_to_200' | 'from_200_to_500' | 'from_500_to_2000' | 'over_2000';

export type B2BOrderFrequency =
    'daily' | 'weekdays' | 'weekly' | 'fortnightly' | 'monthly' | 'ad_hoc';

export type B2BProductCategory =
    'meals' | 'meal_plans' | 'bulk_catering' | 'snacks' | 'beverages' | 'ingredients';

export type B2BDeliveryWindow = 'early_morning' | 'morning' | 'afternoon' | 'evening';

export type B2BDocumentKind =
    | 'commercial_registration'
    | 'tax_certificate'
    | 'trade_licence'
    | 'signatory_identification'
    | 'authorisation_letter'
    | 'proof_of_address'
    | 'food_safety_certificate'
    | 'insurance_certificate'
    | 'signed_agreement'
    | 'other';

export type KycReviewStatus = 'pending' | 'accepted' | 'rejected' | 'superseded';

export type KycRejectionReason =
    'unreadable' | 'wrong_document' | 'expired' | 'incomplete' | 'mismatch' | 'other';

export type AgreementSignatureKind = 'typed_name';

export type AgreementStatus = 'draft' | 'pending_signature' | 'active' | 'suspended' | 'terminated';

export type ProvisioningStep =
    | 'organisation'
    | 'customer_account'
    | 'commercial_terms'
    | 'delivery_locations'
    | 'team_invitations';

export interface B2BCompanySection {
    readonly legalName: string | null;
    readonly legalNameAr: string | null;
    readonly tradingName: string | null;
    readonly businessType: B2BBusinessType | null;
    readonly countryCode: string | null;
    readonly commercialRegistrationNumber: string | null;
    readonly taxRegistrationNumber: string | null;
    readonly incorporatedOn: string | null;
    readonly website: string | null;
}

export interface B2BSignatorySection {
    readonly signatoryName: string | null;
    readonly signatoryTitle: string | null;
    readonly signatoryEmail: string | null;
    readonly signatoryPhone: string | null;
}

export interface B2BTradeTermsSection {
    readonly requestedPaymentTerms: B2BPaymentTerms | null;
    readonly requestedCreditLimitMinor: number | null;
    readonly currencyCode: string | null;
    readonly expectedVolumeBand: B2BVolumeBand | null;
    readonly expectedOrderFrequency: B2BOrderFrequency | null;
    readonly productCategories: readonly B2BProductCategory[];
}

export interface B2BLogisticsSection {
    readonly preferredDeliveryWindow: B2BDeliveryWindow | null;
    readonly leadTimeDays: number | null;
    readonly requiresInvoicePerLocation: boolean;
    readonly deliveryNotes: string | null;
}

export interface B2BApplicationSections {
    readonly company: B2BCompanySection;
    readonly signatory: B2BSignatorySection;
    readonly trade_terms: B2BTradeTermsSection;
    readonly logistics: B2BLogisticsSection;
}

export type B2BSectionPayload<S extends B2BApplicationSection = B2BApplicationSection> = Partial<
    B2BApplicationSections[S]
>;

export interface B2BApplicationSectionState {
    readonly section: B2BApplicationSection;
    /** The server's readiness answer. Never recomputed on the device. */
    readonly complete: boolean;
    /** The applicant's own progress claim. Not evidence of anything. */
    readonly completedByApplicant: boolean;
    readonly missingFields: readonly string[];
    readonly editable: boolean;
}

export interface ReviewerRequest {
    readonly id: string;
    readonly requestedAt: string;
    readonly message: string;
    readonly sections: readonly B2BApplicationSection[];
    readonly documentKinds: readonly B2BDocumentKind[];
    readonly resolvedAt: string | null;
}

export interface KycDocument {
    readonly id: string;
    readonly kind: B2BDocumentKind;
    readonly fileName: string;
    readonly mimeType: string;
    readonly byteSize: number;
    readonly sha256: string;
    readonly uploadedAt: string;
    readonly reviewStatus: KycReviewStatus;
    readonly rejectionReason: KycRejectionReason | null;
    readonly expiresOn: string | null;
    readonly purgeAfter: string | null;
    readonly scanStatus: 'not_scanned' | 'pending' | 'clean' | 'infected';
}

export interface UploadDocumentRequest {
    readonly applicationId: string;
    readonly kind: B2BDocumentKind;
    readonly fileName: string;
    readonly mimeType: string;
    readonly byteSize: number;
    readonly content: string;
    readonly replacesDocumentId?: string | undefined;
}

export interface DocumentDownload {
    readonly documentId: string;
    readonly url: string;
    readonly expiresAt: string;
}

export interface AgreementTerms {
    readonly paymentTerms: B2BPaymentTerms | null;
    readonly creditLimitMinor: number | null;
    readonly minimumOrderMinor: number | null;
    readonly currencyCode: string | null;
    readonly deliveryLeadTimeDays: number | null;
    readonly noticePeriodDays: number | null;
    readonly startsOn: string | null;
    readonly endsOn: string | null;
    readonly autoRenews: boolean;
}

export interface SignatureEvidence {
    readonly kind: AgreementSignatureKind;
    readonly typedName: string;
    readonly signatoryTitle: string;
    readonly consentStatement: string;
    readonly documentSha256: string;
    readonly signedAt: string;
    /** Whether a one-time code actually stepped the signatory up. Carried, never assumed. */
    readonly otpVerified: boolean;
}

export interface B2BAgreement {
    readonly id: string;
    readonly applicationId: string;
    readonly version: number;
    readonly status: AgreementStatus;
    readonly title: string;
    readonly documentText: string;
    readonly documentSha256: string;
    readonly terms: AgreementTerms;
    readonly termsSummary: string | null;
    readonly consentStatement: string;
    readonly signature: SignatureEvidence | null;
    readonly supersedesAgreementId: string | null;
    readonly lockVersion: number;
}

export interface SignAgreementRequest {
    readonly agreementId: string;
    readonly kind: AgreementSignatureKind;
    readonly typedName: string;
    readonly signatoryTitle: string;
    readonly authorityConfirmed: boolean;
    readonly documentSha256: string;
    /** From a verified `b2b_signatory` challenge. Required — a signature without a step-up is not evidence. */
    readonly verificationToken: string;
    readonly lockVersion: number;
}

export interface ProvisioningStepState {
    readonly step: ProvisioningStep;
    readonly complete: boolean;
    readonly blockedReason: string | null;
}

export interface ProvisioningProgress {
    readonly steps: readonly ProvisioningStepState[];
    readonly completedAt: string | null;
    readonly organisationId: string | null;
}

export interface B2BApplication {
    readonly id: string;
    readonly reference: string;
    readonly state: B2BApplicationState;
    readonly sections: B2BApplicationSections;
    readonly sectionStates: readonly B2BApplicationSectionState[];
    /** The server's list. Never a client constant. */
    readonly requiredDocumentKinds: readonly B2BDocumentKind[];
    readonly documents: readonly KycDocument[];
    readonly reviewerRequests: readonly ReviewerRequest[];
    readonly applicantMessage: string | null;
    readonly agreement: B2BAgreement | null;
    readonly provisioning: ProvisioningProgress | null;
    readonly createdAt: string;
    readonly submittedAt: string | null;
    readonly decidedAt: string | null;
    readonly lockVersion: number;
}

export interface SaveSectionRequest {
    readonly applicationId: string;
    readonly section: B2BApplicationSection;
    readonly payload: B2BSectionPayload;
    readonly markComplete?: boolean | undefined;
    readonly lockVersion: number;
}

export interface B2BApplicationRepository {
    getApplication(): Promise<B2BApplication | null>;
    startApplication(): Promise<B2BApplication>;
    saveSection(request: SaveSectionRequest): Promise<B2BApplication>;
    uploadDocument(request: UploadDocumentRequest): Promise<B2BApplication>;
    removeDocument(request: {
        readonly applicationId: string;
        readonly documentId: string;
    }): Promise<B2BApplication>;
    getDocumentDownload(request: {
        readonly applicationId: string;
        readonly documentId: string;
    }): Promise<DocumentDownload>;
    submitApplication(request: {
        readonly applicationId: string;
        readonly lockVersion: number;
    }): Promise<B2BApplication>;
    withdrawApplication(request: {
        readonly applicationId: string;
        readonly lockVersion: number;
    }): Promise<B2BApplication>;
    getAgreement(request: { readonly applicationId: string }): Promise<B2BAgreement | null>;
    signAgreement(request: SignAgreementRequest): Promise<B2BApplication>;
}

/* ── resolution ──────────────────────────────────────────────────────────────────────────────── */

export interface B2BApplicationRepositories {
    readonly b2bApplication: B2BApplicationRepository;
    /**
     * Whether the repository may be called at all.
     *
     * Separate from the repository being present because the bundle resolves asynchronously: a
     * query hook guards on `ready` exactly as the other modules guard on `repositories !== null`.
     */
    readonly ready: boolean;
}

/** The shape the resolved bundle *may* carry. Probed, never asserted. */
interface MaybeRegistered {
    readonly b2bApplication?: unknown;
}

function unregistered(): never {
    throw new Error(
        'B2BApplicationRepository is not registered in the Repositories bundle. Register it in ' +
            'packages/api-client/src/contracts/index.ts, implement it in src/api/, and then delete ' +
            'src/features/b2b-application/repositories-shim.ts.',
    );
}

/** A repository whose every method throws the registration message, so no screen renders a lie. */
function refusing<T extends object>(): T {
    return new Proxy({} as T, { get: unregistered });
}

const REFUSING = refusing<B2BApplicationRepository>();

export function useB2BApplicationRepositories(): B2BApplicationRepositories {
    const { repositories } = useRepositoryContext();

    return useMemo<B2BApplicationRepositories>(() => {
        // `Repositories` and `MaybeRegistered` have no members in common — which is precisely the
        // fact this file exists for — so the probe reads the object through `unknown`. The `typeof`
        // test below is what makes that safe; nothing is assumed about the shape.
        const bundle = (repositories ?? {}) as unknown as MaybeRegistered;
        const candidate = bundle.b2bApplication;

        if (typeof candidate !== 'object' || candidate === null) {
            // `false` whether the bundle is still resolving or will never carry this: either way
            // nothing here may be called, and the queries stay disabled.
            return { b2bApplication: REFUSING, ready: false };
        }

        return { b2bApplication: candidate as B2BApplicationRepository, ready: true };
    }, [repositories]);
}
