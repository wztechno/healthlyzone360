import type { IsoDateTime } from '@healthy360/domain-types';

/**
 * B2B onboarding contract (plan Phase B1; appendix E §A.4).
 *
 * Standalone for the same reason `./verification.ts` and `./account.ts` are: the shapes and the mock
 * world land first, and the integrator wave registers the repository in the `Repositories` bundle
 * and writes the API-side implementation. Nothing in `./index.ts` mentions this file yet.
 *
 * ## What this contract is about
 *
 * A company asking to buy from the platform. The applicant is a **real registered person with no
 * organisation** — the corporate organisation is created *by* approval, not before it (plan §B.2,
 * D-027) — which is why nothing here is tenant-scoped and why the wizard lives in a route group
 * gated as `area=customer` rather than in a new route area.
 *
 * ## Four rules this contract encodes rather than documents
 *
 * 1. **The draft lives on the server.** Every step is a {@link B2BApplicationRepository.saveSection}
 *    round trip against a real row, not a local reducer flushed at the end. The quotation builder
 *    made the other choice and the defect it produced is the reason this one is written down: a
 *    wizard whose answers exist only in a tab is a wizard that loses a company's registration number
 *    to a refresh, and it cannot support "come back tomorrow with the trade licence", which is the
 *    normal way a B2B application is filled in.
 * 2. **The server decides what is required.** {@link B2BApplication.requiredDocumentKinds} is a
 *    *field*, not a client constant. Which documents an application must carry is a policy that
 *    changes per market and per business type, and a UI that hard-coded "registration plus identity"
 *    would refuse a submission the server would have accepted, or accept one it will refuse.
 *    {@link B2BApplicationSectionState.missingFields} is the same rule for fields.
 * 3. **A reviewer's request names sections.** {@link ReviewerRequest} carries the sections it
 *    reopens, so the status panel can link "we need your trade terms again" straight at the step
 *    that owns those fields instead of dropping the applicant at the top of a form they have already
 *    filled in. It is also what narrows editing: outside `draft`, only the named sections are
 *    writable, and the server enforces that.
 * 4. **The signature is click-wrap, and says so.** {@link AGREEMENT_SIGNATURE_KINDS} has exactly one
 *    member and it is `typed_name`. There is no drawn signature, no certificate, no signing-key
 *    field — the union is closed at one so that adding a second is a decision somebody has to make
 *    rather than a shape that quietly grew. INT-007 is the register entry for real e-signature.
 */

/* ── the application ──────────────────────────────────────────────────────────────────────────── */

/**
 * The eleven states an application passes through, as the applicant's status panel draws them.
 *
 * The first seven are the backend's `b2b_applications.status` verbatim
 * (`draft → submitted → in_review → info_requested → approved | declined | withdrawn`). The last
 * four are the **provisioning progression**, and they are states of the application rather than a
 * separate object because that is the only honest way to answer the question the applicant is
 * actually asking after approval: "so when can I order?"
 *
 * `approved` and `agreement_pending` are not the same thing and collapsing them would be the panel's
 * worst lie. Approved means a reviewer said yes; agreement pending means terms have been drafted and
 * are waiting for a signature *from the applicant*. One of those is the platform's turn and the
 * other is theirs, and a panel that showed "approved" for both would leave somebody waiting for an
 * email that is never coming.
 *
 * `provisioning` is likewise distinct from `provisioned`: the transaction that creates the
 * organisation, the customer account, the terms and the memberships is idempotent but not
 * instantaneous, and "we are setting your account up" is a true thing to say for the minute it
 * takes. `provisioned` is the only state from which the buying surfaces exist.
 */
export const B2B_APPLICATION_STATES = [
    'draft',
    'submitted',
    'in_review',
    'info_requested',
    'approved',
    'agreement_pending',
    'agreement_signed',
    'provisioning',
    'provisioned',
    'declined',
    'withdrawn',
] as const;
export type B2BApplicationState = (typeof B2B_APPLICATION_STATES)[number];

/**
 * The sheet-4 field groups — the unit a wizard step writes and a reviewer reopens.
 *
 * Verbatim the backend's `ApplicationSection` enum. A section is the write unit because a PATCH is
 * checked against the section's own allowlist and *refuses* a key it does not own rather than
 * silently dropping it: a client that sent `legalName` to the logistics step believed it was saving
 * something.
 *
 * **Documents are deliberately not a section.** They have their own lifecycle, their own per-file
 * review and their own failure modes, and folding them in would put a PATCH of a text box and an
 * upload of a passport on one code path.
 *
 * **Contacts and delivery locations are also not sections** — the backend gives them their own
 * tables (`b2b_application_contacts`, `b2b_application_locations`) and their own collection
 * endpoints. This contract does not publish those operations yet; see the gap noted on
 * {@link B2BApplicationRepository}.
 */
export const B2B_APPLICATION_SECTIONS = [
    'company',
    'signatory',
    'trade_terms',
    'logistics',
] as const;
export type B2BApplicationSection = (typeof B2B_APPLICATION_SECTIONS)[number];

/**
 * What a company is, as sheet-4's Business Type list has it.
 *
 * A vocabulary the source owns, not a platform entity: these are the options on a dropdown, and
 * modelling them as rows would imply a lifecycle they do not have.
 */
export const B2B_BUSINESS_TYPES = [
    'restaurant',
    'cafe',
    'hotel',
    'catering',
    'retail',
    'corporate_office',
    'school',
    'hospital',
    'gym',
    'other',
] as const;
export type B2BBusinessType = (typeof B2B_BUSINESS_TYPES)[number];

/** How long a corporate buyer asks to have to pay. Requested here; granted on the agreement. */
export const B2B_PAYMENT_TERMS = ['prepaid', 'net_15', 'net_30', 'net_60'] as const;
export type B2BPaymentTerms = (typeof B2B_PAYMENT_TERMS)[number];

/** Sheet-4's expected-volume bands. */
export const B2B_VOLUME_BANDS = [
    'under_50',
    'from_50_to_200',
    'from_200_to_500',
    'from_500_to_2000',
    'over_2000',
] as const;
export type B2BVolumeBand = (typeof B2B_VOLUME_BANDS)[number];

/** Sheet-4's order-frequency list. */
export const B2B_ORDER_FREQUENCIES = [
    'daily',
    'weekdays',
    'weekly',
    'fortnightly',
    'monthly',
    'ad_hoc',
] as const;
export type B2BOrderFrequency = (typeof B2B_ORDER_FREQUENCIES)[number];

/** Sheet-4's B2B product categories. Vocabulary strings, carried as a list. */
export const B2B_PRODUCT_CATEGORIES = [
    'meals',
    'meal_plans',
    'bulk_catering',
    'snacks',
    'beverages',
    'ingredients',
] as const;
export type B2BProductCategory = (typeof B2B_PRODUCT_CATEGORIES)[number];

/** When a buyer wants deliveries. A window, not a slot — slots are F1's problem. */
export const B2B_DELIVERY_WINDOWS = ['early_morning', 'morning', 'afternoon', 'evening'] as const;
export type B2BDeliveryWindow = (typeof B2B_DELIVERY_WINDOWS)[number];

/**
 * The company section — who is applying.
 *
 * Every member is nullable because a draft is allowed to be half-finished; which of them must be
 * present before submission is the server's answer, carried on
 * {@link B2BApplicationSectionState.missingFields}.
 */
export interface B2BCompanySection {
    /** As written on the commercial registration. */
    readonly legalName: string | null;
    readonly legalNameAr: string | null;
    readonly tradingName: string | null;
    readonly businessType: B2BBusinessType | null;
    /** ISO 3166-1 alpha-2. */
    readonly countryCode: string | null;
    readonly commercialRegistrationNumber: string | null;
    /** VAT/TRN as written. */
    readonly taxRegistrationNumber: string | null;
    /** `YYYY-MM-DD`. */
    readonly incorporatedOn: string | null;
    readonly website: string | null;
}

/** The person authorised to bind the company. Checked against the identity document at review. */
export interface B2BSignatorySection {
    readonly signatoryName: string | null;
    readonly signatoryTitle: string | null;
    readonly signatoryEmail: string | null;
    /** E.164. */
    readonly signatoryPhone: string | null;
}

/**
 * What the applicant asks for. Nothing here is granted — the agreement grants.
 *
 * `requestedCreditLimitMinor` is pointedly not required: an applicant asking for nothing is asking
 * to pay up front, which is a complete answer.
 */
export interface B2BTradeTermsSection {
    readonly requestedPaymentTerms: B2BPaymentTerms | null;
    /** Minor units of `currencyCode`. An ask, never a limit. */
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

/** The payload a section PATCH accepts — a partial of exactly the section it names. */
export type B2BSectionPayload<S extends B2BApplicationSection = B2BApplicationSection> = Partial<
    B2BApplicationSections[S]
>;

/**
 * The server's verdict on one section.
 *
 * `complete` is the *server's* readiness answer, and `completedByApplicant` is the applicant's own
 * progress claim — the two are separate fields because the backend keeps them separate columns for
 * the same reason: a claim is not a check. A wizard draws its ticks from `complete`, and a person
 * who marked a step done and left a required field empty is told which field.
 */
export interface B2BApplicationSectionState {
    readonly section: B2BApplicationSection;
    /** The server's answer: every field it requires for submission is present. */
    readonly complete: boolean;
    /** The applicant said they had finished this step. Not evidence of anything. */
    readonly completedByApplicant: boolean;
    /**
     * Required fields still missing, named. Empty when `complete`.
     *
     * Field names, not messages: the client owns the copy and the label, the server owns the rule.
     */
    readonly missingFields: readonly string[];
    /** False when the current state, or the reviewer's request, does not reopen this section. */
    readonly editable: boolean;
}

/**
 * A reviewer asking for something.
 *
 * `sections` and `documentKinds` are both present and both may be empty: "re-upload the trade
 * licence" names no section, and "your trade terms do not match your volume band" names no document.
 * A request with neither is a plain message, which is also a real thing for a reviewer to send.
 *
 * `message` is the half of the review the applicant is shown, authored by a human. The reviewer's
 * internal note is a different column and never reaches this contract (§4.8 denylist).
 */
export interface ReviewerRequest {
    readonly id: string;
    readonly requestedAt: IsoDateTime;
    readonly message: string;
    readonly sections: readonly B2BApplicationSection[];
    readonly documentKinds: readonly B2BDocumentKind[];
    /** Set when the applicant's answer put the application back in the queue. */
    readonly resolvedAt: IsoDateTime | null;
}

/**
 * One B2B application, whole.
 *
 * `lockVersion` is the optimistic-concurrency token, carried on every read and required on every
 * write, exactly as the kitchen editors carry theirs: a stale write is refused with
 * `resource.conflict` and `currentLockVersion`, and the screen offers reload-or-keep rather than
 * silently overwriting whatever a second tab saved.
 */
export interface B2BApplication {
    readonly id: string;
    /** Human-quotable. What a support ticket and a reviewer both name. */
    readonly reference: string;
    readonly state: B2BApplicationState;
    readonly sections: B2BApplicationSections;
    readonly sectionStates: readonly B2BApplicationSectionState[];
    /**
     * The document kinds this application must carry before it may be submitted.
     *
     * **The server's list.** Never a client constant — see rule 2 in the file header.
     */
    readonly requiredDocumentKinds: readonly B2BDocumentKind[];
    readonly documents: readonly KycDocument[];
    /** Newest first. Unresolved requests are what the status panel acts on. */
    readonly reviewerRequests: readonly ReviewerRequest[];
    /**
     * The half of a decision the applicant is shown, for `approved` and `declined`.
     *
     * Separate from the reviewer's internal `decision_note`, which never leaves the platform.
     */
    readonly applicantMessage: string | null;
    /** The agreement drafted for this application, once there is one. */
    readonly agreement: B2BAgreement | null;
    /** Present from `provisioning` onwards. */
    readonly provisioning: ProvisioningProgress | null;
    readonly createdAt: IsoDateTime;
    readonly submittedAt: IsoDateTime | null;
    readonly decidedAt: IsoDateTime | null;
    readonly lockVersion: number;
}

/* ── documents ────────────────────────────────────────────────────────────────────────────────── */

/**
 * What a document is supposed to prove. Verbatim the backend's `DocumentKind`.
 *
 * `signed_agreement` is produced by the signing flow and is **not** applicant-uploadable: accepting
 * one from a client would let an applicant supply their own idea of what they signed.
 */
export const B2B_DOCUMENT_KINDS = [
    'commercial_registration',
    'tax_certificate',
    'trade_licence',
    'signatory_identification',
    'authorisation_letter',
    'proof_of_address',
    'food_safety_certificate',
    'insurance_certificate',
    'signed_agreement',
    'other',
] as const;
export type B2BDocumentKind = (typeof B2B_DOCUMENT_KINDS)[number];

/** A human's verdict on a document. `superseded` is not a verdict — it is what replacement does. */
export const KYC_REVIEW_STATUSES = ['pending', 'accepted', 'rejected', 'superseded'] as const;
export type KycReviewStatus = (typeof KYC_REVIEW_STATUSES)[number];

/**
 * Why a reviewer turned a document down.
 *
 * A closed vocabulary rather than free text, because this is the half of a rejection the applicant
 * is shown and "unreadable, please send another" is actionable in a way a reviewer's internal note
 * is not.
 */
export const KYC_REJECTION_REASONS = [
    'unreadable',
    'wrong_document',
    'expired',
    'incomplete',
    'mismatch',
    'other',
] as const;
export type KycRejectionReason = (typeof KYC_REJECTION_REASONS)[number];

/**
 * A document in the vault, as its owner may see it.
 *
 * **No URL, ever.** The bytes live on a private disk and are reached through an audited temporary
 * link the server mints on request (`getDocumentDownload`), which is why there is no `url` member to
 * be accidentally logged, cached or shared. `sha256` is carried so a client can tell "you uploaded
 * this one twice" without a second download.
 *
 * `scanStatus` is honest about the gate: no malware scanning exists yet (INT-008), so a real
 * deployment answers `not_scanned` and a surface that rendered a green tick for it would be
 * inventing assurance.
 */
export interface KycDocument {
    readonly id: string;
    readonly kind: B2BDocumentKind;
    /** As the person's device named it. Shown, never trusted as a type. */
    readonly fileName: string;
    /** Sniffed from the bytes server-side, not taken from the upload's `Content-Type`. */
    readonly mimeType: string;
    readonly byteSize: number;
    readonly sha256: string;
    readonly uploadedAt: IsoDateTime;
    readonly reviewStatus: KycReviewStatus;
    /** Set only when `reviewStatus` is `rejected`. */
    readonly rejectionReason: KycRejectionReason | null;
    /** `YYYY-MM-DD`. Meaningful only for kinds that expire. */
    readonly expiresOn: string | null;
    /** Retention: when the vault deletes this row's bytes. */
    readonly purgeAfter: IsoDateTime | null;
    readonly scanStatus: 'not_scanned' | 'pending' | 'clean' | 'infected';
}

/** The bytes a client hands over, already read from the picker. */
export interface UploadDocumentRequest {
    readonly applicationId: string;
    readonly kind: B2BDocumentKind;
    readonly fileName: string;
    /** The device's guess. The server sniffs the bytes and may disagree. */
    readonly mimeType: string;
    readonly byteSize: number;
    /** Base64 payload. */
    readonly content: string;
    /**
     * Replace an existing document of the same kind rather than adding beside it.
     *
     * The replaced row is kept and marked `superseded`, so a reviewer's decision trail survives the
     * applicant re-uploading.
     */
    readonly replacesDocumentId?: string | undefined;
}

/**
 * A short-lived link to one document's bytes.
 *
 * A separate operation rather than a member of {@link KycDocument} because minting it is an audited
 * event with a purpose of use: reading a passport is a thing that gets recorded, and a URL that
 * arrived with the list would be one nobody could attribute.
 */
export interface DocumentDownload {
    readonly documentId: string;
    readonly url: string;
    readonly expiresAt: IsoDateTime;
}

/* ── the agreement ────────────────────────────────────────────────────────────────────────────── */

/**
 * How a signature is made. **One member, on purpose.**
 *
 * `typed_name` is click-wrap: the person types their name, states their title, confirms they may
 * bind the company, and steps up with a one-time code. That is evidence, and the platform says so
 * in the copy the person reads before they click. It is not a qualified electronic signature and
 * there is no member of this union that claims to be one — a drawn-signature or certificate variant
 * would need INT-007 and a legal opinion first, and leaving the slot open would invite a UI that
 * implied one existed.
 */
export const AGREEMENT_SIGNATURE_KINDS = ['typed_name'] as const;
export type AgreementSignatureKind = (typeof AGREEMENT_SIGNATURE_KINDS)[number];

export const AGREEMENT_STATUSES = [
    'draft',
    'pending_signature',
    'active',
    'suspended',
    'terminated',
] as const;
export type AgreementStatus = (typeof AGREEMENT_STATUSES)[number];

/** The commercial terms actually granted. Compare against what was asked for on the application. */
export interface AgreementTerms {
    readonly paymentTerms: B2BPaymentTerms | null;
    readonly creditLimitMinor: number | null;
    readonly minimumOrderMinor: number | null;
    readonly currencyCode: string | null;
    readonly deliveryLeadTimeDays: number | null;
    readonly noticePeriodDays: number | null;
    /** `YYYY-MM-DD`. */
    readonly startsOn: string | null;
    readonly endsOn: string | null;
    readonly autoRenews: boolean;
}

/**
 * The evidence recorded when somebody accepted the terms.
 *
 * Deliberately shaped so nothing reads as more than it is: a name typed, a title claimed, the
 * wording that was on screen, the digest of the document that was on screen, and whether a one-time
 * code was verified. No certificate, no key, no image.
 */
export interface SignatureEvidence {
    readonly kind: AgreementSignatureKind;
    readonly typedName: string;
    readonly signatoryTitle: string;
    /** The wording the person accepted, verbatim, server-authored. */
    readonly consentStatement: string;
    /** The digest of the exact bytes shown. Without it "they agreed" cannot say to what. */
    readonly documentSha256: string;
    readonly signedAt: IsoDateTime;
    /**
     * Whether a one-time code actually stepped the signatory up.
     *
     * Carried rather than assumed. The B1 backend leaves the OTP link as an unconstrained seam and
     * answers `false` on every signature it records; a surface that drew "identity verified" from
     * the mere existence of a signature would be reporting something nobody checked.
     */
    readonly otpVerified: boolean;
}

/**
 * A versioned commercial agreement.
 *
 * An `active` version is immutable — a change of terms is a new version that supersedes the old one,
 * never an edit of a document somebody has already accepted. `documentSha256` is the digest of the
 * bytes at `documentText`, and the signing request echoes it back so the server can refuse a
 * signature made against a document the person was not shown.
 */
export interface B2BAgreement {
    readonly id: string;
    readonly applicationId: string;
    readonly version: number;
    readonly status: AgreementStatus;
    readonly title: string;
    /** The full text, per locale, authored on the server. Never machine-translated at render time. */
    readonly documentText: string;
    readonly documentSha256: string;
    readonly terms: AgreementTerms;
    /** The précis a person reads before the full text. Server-authored. */
    readonly termsSummary: string | null;
    /** The exact wording the signature ties itself to. Rendered beside the confirmation control. */
    readonly consentStatement: string;
    readonly signature: SignatureEvidence | null;
    readonly supersedesAgreementId: string | null;
    readonly lockVersion: number;
}

/**
 * Signing.
 *
 * `authorityConfirmed` is a separate boolean rather than something inferred from the typed name,
 * because it is a *different claim*: "this is my name" and "I may bind this company" are two
 * statements and only the second is the one that matters in a dispute. The server refuses the
 * request when it is false.
 *
 * `verificationToken` comes from a verified one-time-code challenge with purpose `b2b_signatory`
 * (`./verification.ts`). It is the step-up, and it is required — a signature that anybody holding a
 * session cookie could produce is not evidence of who signed.
 *
 * `documentSha256` is echoed back from the agreement the person actually read, so a document that
 * changed under them is refused rather than silently signed.
 */
export interface SignAgreementRequest {
    readonly agreementId: string;
    readonly kind: AgreementSignatureKind;
    readonly typedName: string;
    readonly signatoryTitle: string;
    readonly authorityConfirmed: boolean;
    readonly documentSha256: string;
    readonly verificationToken: string;
    readonly lockVersion: number;
}

/* ── provisioning ─────────────────────────────────────────────────────────────────────────────── */

/**
 * The steps that turn a signed agreement into an account somebody can order from.
 *
 * Named steps rather than a percentage: "creating your organisation" is a thing a person can
 * understand and, if it stalls, a thing support can be told. A progress bar over an idempotent
 * transaction would be a number invented on the device.
 */
export const PROVISIONING_STEPS = [
    'organisation',
    'customer_account',
    'commercial_terms',
    'delivery_locations',
    'team_invitations',
] as const;
export type ProvisioningStep = (typeof PROVISIONING_STEPS)[number];

export interface ProvisioningStepState {
    readonly step: ProvisioningStep;
    readonly complete: boolean;
    /** Server-authored explanation when a step is stuck. Usually `null`. */
    readonly blockedReason: string | null;
}

export interface ProvisioningProgress {
    readonly steps: readonly ProvisioningStepState[];
    /** Set once everything is done; the buying surfaces exist from this moment. */
    readonly completedAt: IsoDateTime | null;
    /** The organisation approval created. `null` until it exists. */
    readonly organisationId: string | null;
}

/* ── the repository ───────────────────────────────────────────────────────────────────────────── */

/**
 * The applicant's side of B2B onboarding.
 *
 * Reviewer surfaces are a platform-only workspace and are **not** here: the two audiences have
 * different permissions, different screens and different data (a reviewer sees internal notes and
 * duplicate matches, which must never reach an applicant's client), and one repository serving both
 * would be one bundle that has to be trusted to filter.
 *
 * `getApplication` answers `null` rather than rejecting when the person has no live application —
 * "you have not applied yet" is a state the entry screen draws, not an error.
 *
 * **Contract gap.** `b2b_application_contacts` and `b2b_application_locations` exist in the backend
 * and have no operations here: the B1 frontend builds the four field sections and the document
 * vault, and the two collection editors are deferred. Adding speculative method signatures for them
 * would be inventing a shape the API wave then has to honour.
 */
export interface B2BApplicationRepository {
    /** The applicant's live application, or `null` if they have never started one. */
    getApplication(): Promise<B2BApplication | null>;
    startApplication(): Promise<B2BApplication>;

    saveSection(request: {
        readonly applicationId: string;
        readonly section: B2BApplicationSection;
        readonly payload: B2BSectionPayload;
        /** Marks the step finished — the applicant's claim, not a readiness verdict. */
        readonly markComplete?: boolean | undefined;
        readonly lockVersion: number;
    }): Promise<B2BApplication>;

    uploadDocument(request: UploadDocumentRequest): Promise<B2BApplication>;
    removeDocument(request: {
        readonly applicationId: string;
        readonly documentId: string;
    }): Promise<B2BApplication>;
    /** Mints an audited, short-lived link. Never a member of the document itself. */
    getDocumentDownload(request: {
        readonly applicationId: string;
        readonly documentId: string;
    }): Promise<DocumentDownload>;

    /**
     * Hand it to a reviewer.
     *
     * Rejects with `validation.failed` naming the sections and document kinds that are missing —
     * the server's completeness rule, which is the only one that counts.
     */
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
