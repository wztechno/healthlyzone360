import { ApiError, apiFailure, validationFailure } from '../contracts/failure.ts';
import type {
    AgreementTerms,
    B2BAgreement,
    B2BApplication,
    B2BApplicationRepository,
    B2BApplicationSection,
    B2BApplicationSectionState,
    B2BApplicationSections,
    B2BApplicationState,
    B2BBusinessType,
    B2BDeliveryWindow,
    B2BOffboarding,
    B2BOrderFrequency,
    B2BProductCategory,
    B2BSectionPayload,
    B2BVolumeBand,
    DocumentDownload,
    KycDocument,
    OffboardingTrigger,
    ProvisioningProgress,
    ReviewerRequest,
    SettlementCheck,
    SettlementCheckCode,
    SignAgreementRequest,
    SignOffOffboardingRequest,
    SignatureEvidence,
    UploadDocumentRequest,
} from '../contracts/b2b-application.ts';
import {
    B2B_APPLICATION_SECTIONS,
    B2B_BUSINESS_TYPES,
    B2B_DELIVERY_WINDOWS,
    B2B_ORDER_FREQUENCIES,
    B2B_PRODUCT_CATEGORIES,
    B2B_VOLUME_BANDS,
    OFFBOARDING_TRIGGERS,
    PROVISIONING_STEPS,
    SETTLEMENT_CHECK_CODES,
} from '../contracts/b2b-application.ts';
import type { OtpChallenge } from '../contracts/verification.ts';
import type {
    B2bAgreement as WireAgreement,
    B2bApplication as WireApplication,
    KycDocument as WireDocument,
    KycDocumentDownload as WireDownload,
    Offboarding as WireOffboarding,
    OffboardingEnvelope,
    OtpChallengeEnvelope,
    SignOffOffboardingRequest as WireSignoffBody,
    UpdateB2bApplicationSectionRequest,
} from '../generated/types.ts';
import { MultipartBody } from './transport.ts';
import type { Transport } from './transport.ts';
import { mapIssuedChallenge } from './verification-repository.ts';

/**
 * The applicant's side of B2B onboarding, over HTTP (plan Phase B1).
 *
 * This is the family where the wire and the contract differ *structurally* rather than in spelling,
 * and the differences are not oversights on either side — they are two honest models of the same
 * thing, written for different jobs. The backend stores an application as one flat row because that
 * is what a row is; the contract publishes it as four named sections with per-section verdicts
 * because that is what a wizard draws. This file is where the two meet, and every reshaping is
 * recorded below.
 *
 * ## 1. Flat row → four sections
 *
 * `B2bApplication` has `legal_name`, `signatory_email`, `lead_time_days` and thirty others as
 * siblings. {@link SECTION_FIELDS} is the mapping, and it is used in **both** directions: reading
 * groups the row into {@link B2BApplicationSections}, and `saveSection` uses it to refuse a payload
 * key the named section does not own — which is the rule the contract states and the backend
 * enforces, applied one round trip earlier so a wizard step reports it as a field error rather than
 * as a rejected save.
 *
 * ## 2. `sectionStates` is assembled, and `missingFields` is empty
 *
 * The wire sends `completed_sections` (the applicant's claim) and `writable_sections` (what this
 * state permits). It does **not** send a per-section readiness verdict or the names of the fields
 * that are missing — the server evaluates those at submission and answers `validation.failed`.
 * So `complete` mirrors `completedByApplicant`, `editable` comes from `writable_sections`, and
 * `missingFields` is always empty. A wizard therefore learns what is missing when it submits, not
 * while it types. That is the largest loss in this file and the one worth closing backend-side;
 * nothing here invents a rule the server did not state.
 *
 * ## 3. One reviewer request, not a list
 *
 * The row carries a single `information_request` with its sections and timestamp. The contract has
 * a list because a reviewer may ask more than once. The list therefore has zero or one member, and
 * the panel — which reads "the newest unresolved request" — is right either way.
 *
 * ## 4. `requiredDocumentKinds` is empty, deliberately
 *
 * The contract's rule 2 says the server owns which documents an application must carry. The wire
 * publishes no such list, so this is empty rather than filled from a client constant: a wizard that
 * hard-coded "registration plus identity" would refuse a submission the server would accept. An
 * empty list means "the server has not said", and the vault shows what was uploaded rather than a
 * checklist nobody authored.
 *
 * ## 5. Provisioning has no endpoint
 *
 * The four provisioning states are real application states, and `provisioned_organisation_id` says
 * when it finished. There is no per-step progress payload, so {@link mapProvisioning} reports every
 * step as complete once an organisation exists and none complete before — which is true, coarse,
 * and does not pretend to a granularity the server does not publish.
 *
 * ## 6. Uploads are multipart, and the contract carries base64
 *
 * `POST …/documents` takes a file part. The contract takes a base64 string, because that is what a
 * React Native document picker produces without a filesystem. {@link base64ToBlob} converts, once,
 * here — and a `Blob` the runtime does not support fails loudly rather than uploading nothing.
 *
 * ## 7. There is no way to delete a document
 *
 * `removeDocument` is on the contract and has no endpoint at all. It rejects with a named failure
 * rather than resolving: a vault that silently kept a document the applicant believed they had
 * removed is the worse outcome by a distance. Re-uploading with `replacesDocumentId` supersedes,
 * which is the operation that does exist.
 */

/** Which flat wire fields belong to which section — read one way, written the other. */
const SECTION_FIELDS: Readonly<Record<B2BApplicationSection, readonly string[]>> = {
    company: [
        'legalName',
        'legalNameAr',
        'tradingName',
        'businessType',
        'countryCode',
        'commercialRegistrationNumber',
        'taxRegistrationNumber',
        'incorporatedOn',
        'website',
    ],
    signatory: ['signatoryName', 'signatoryTitle', 'signatoryEmail', 'signatoryPhone'],
    trade_terms: [
        'requestedPaymentTerms',
        'requestedCreditLimitMinor',
        'currencyCode',
        'expectedVolumeBand',
        'expectedOrderFrequency',
        'productCategories',
    ],
    logistics: [
        'preferredDeliveryWindow',
        'leadTimeDays',
        'requiresInvoicePerLocation',
        'deliveryNotes',
    ],
};

/** Contract field → wire field. The whole vocabulary, so neither direction can drift. */
const WIRE_FIELDS: Readonly<Record<string, keyof UpdateB2bApplicationSectionRequest>> = {
    legalName: 'legal_name',
    legalNameAr: 'legal_name_ar',
    tradingName: 'trading_name',
    businessType: 'business_type',
    countryCode: 'country_code',
    commercialRegistrationNumber: 'commercial_registration_number',
    taxRegistrationNumber: 'tax_registration_number',
    incorporatedOn: 'incorporated_on',
    website: 'website',
    signatoryName: 'signatory_name',
    signatoryTitle: 'signatory_title',
    signatoryEmail: 'signatory_email',
    signatoryPhone: 'signatory_phone',
    requestedPaymentTerms: 'requested_payment_terms',
    requestedCreditLimitMinor: 'requested_credit_limit_minor',
    currencyCode: 'currency_code',
    expectedVolumeBand: 'expected_volume_band',
    expectedOrderFrequency: 'expected_order_frequency',
    productCategories: 'product_categories',
    preferredDeliveryWindow: 'preferred_delivery_window',
    leadTimeDays: 'lead_time_days',
    requiresInvoicePerLocation: 'requires_invoice_per_location',
    deliveryNotes: 'delivery_notes',
};

/** A vocabulary member the wire sends as a bare string, or `null` when this build does not know it. */
function oneOf<T extends string>(
    vocabulary: readonly T[],
    value: string | null | undefined,
): T | null {
    return typeof value === 'string' && (vocabulary as readonly string[]).includes(value)
        ? (value as T)
        : null;
}

export function mapSections(wire: WireApplication): B2BApplicationSections {
    return {
        company: {
            legalName: wire.legal_name ?? null,
            legalNameAr: wire.legal_name_ar ?? null,
            tradingName: wire.trading_name ?? null,
            businessType: oneOf<B2BBusinessType>(B2B_BUSINESS_TYPES, wire.business_type),
            countryCode: wire.country_code ?? null,
            commercialRegistrationNumber: wire.commercial_registration_number ?? null,
            taxRegistrationNumber: wire.tax_registration_number ?? null,
            incorporatedOn: wire.incorporated_on ?? null,
            website: wire.website ?? null,
        },
        signatory: {
            signatoryName: wire.signatory_name ?? null,
            signatoryTitle: wire.signatory_title ?? null,
            signatoryEmail: wire.signatory_email ?? null,
            signatoryPhone: wire.signatory_phone ?? null,
        },
        trade_terms: {
            requestedPaymentTerms: wire.requested_payment_terms ?? null,
            requestedCreditLimitMinor: wire.requested_credit_limit_minor ?? null,
            currencyCode: wire.currency_code ?? null,
            expectedVolumeBand: oneOf<B2BVolumeBand>(B2B_VOLUME_BANDS, wire.expected_volume_band),
            expectedOrderFrequency: oneOf<B2BOrderFrequency>(
                B2B_ORDER_FREQUENCIES,
                wire.expected_order_frequency,
            ),
            productCategories: (wire.product_categories ?? []).filter(
                (category): category is B2BProductCategory =>
                    (B2B_PRODUCT_CATEGORIES as readonly string[]).includes(category),
            ),
        },
        logistics: {
            preferredDeliveryWindow: oneOf<B2BDeliveryWindow>(
                B2B_DELIVERY_WINDOWS,
                wire.preferred_delivery_window,
            ),
            leadTimeDays: wire.lead_time_days ?? null,
            requiresInvoicePerLocation: wire.requires_invoice_per_location,
            deliveryNotes: wire.delivery_notes ?? null,
        },
    };
}

export function mapSectionStates(wire: WireApplication): readonly B2BApplicationSectionState[] {
    const claimed = new Set(wire.completed_sections);
    const writable = new Set(wire.writable_sections);

    return B2B_APPLICATION_SECTIONS.map((section) => ({
        section,
        // The wire publishes no independent readiness verdict, so the applicant's claim is the only
        // answer available. See §2 of the file header: this is a known loss, not a shortcut.
        complete: claimed.has(section),
        completedByApplicant: claimed.has(section),
        missingFields: [],
        editable: writable.has(section),
    }));
}

export function mapReviewerRequests(wire: WireApplication): readonly ReviewerRequest[] {
    const message = wire.information_request;
    if (typeof message !== 'string' || message === '') return [];

    return [
        {
            // The row holds one request and no identifier for it. The application's own reference
            // is stable, unique per application and never confusable with a document identifier.
            id: `${wire.id}:information-request`,
            requestedAt: wire.information_requested_at ?? wire.updated_at ?? '',
            message,
            sections: wire.information_requested_sections ?? [],
            documentKinds: [],
            // A request is open exactly while the application sits in `info_requested`; answering
            // it is what moves the state back to `in_review`.
            resolvedAt: wire.status === 'info_requested' ? null : (wire.updated_at ?? null),
        },
    ];
}

/**
 * The application's state, including the four provisioning states the backend does not store.
 *
 * `b2b_applications.status` stops at `approved | declined | withdrawn`. The provisioning
 * progression the applicant actually asks about — "so when can I order?" — is derived from what
 * approval produced: an agreement waiting for a signature, an agreement signed, an organisation
 * being created, an organisation that exists. The distinction between `approved` and
 * `agreement_pending` is the panel's most important one (one is our turn, the other is theirs), so
 * it is derived rather than collapsed.
 */
export function mapApplicationState(
    wire: WireApplication,
    agreement: WireAgreement | null,
): B2BApplicationState {
    if (wire.status !== 'approved') return wire.status;

    if (wire.provisioned_organisation_id != null) return 'provisioned';
    if (agreement === null) return 'approved';
    if (agreement.signed_at != null) {
        return wire.customer_account_id != null ? 'provisioning' : 'agreement_signed';
    }
    return agreement.status === 'pending_signature' ? 'agreement_pending' : 'approved';
}

export function mapProvisioning(wire: WireApplication): ProvisioningProgress | null {
    const organisationId = wire.provisioned_organisation_id ?? null;
    if (organisationId === null && wire.customer_account_id == null) return null;

    const complete = organisationId !== null;
    return {
        // Every step or none: the provisioning transaction is idempotent and reported only by its
        // outcome, and a per-step tick nobody sent would be a progress bar invented on the device.
        steps: PROVISIONING_STEPS.map((step) => ({ step, complete, blockedReason: null })),
        completedAt: complete ? (wire.updated_at ?? null) : null,
        organisationId,
    };
}

export function mapDocument(wire: WireDocument): KycDocument {
    return {
        id: wire.id,
        kind: wire.document_kind,
        fileName: wire.original_filename,
        // Sniffed server-side. `declared_mime_type` is what the device claimed and is deliberately
        // not shown: `media_type_mismatch` is the fact a reviewer cares about, and it belongs to
        // the review surface rather than to the applicant's list.
        mimeType: wire.mime_type,
        byteSize: wire.byte_size,
        sha256: wire.sha256,
        uploadedAt: wire.uploaded_at,
        reviewStatus: wire.review_status,
        rejectionReason: wire.rejection_reason ?? null,
        expiresOn: wire.expires_on ?? null,
        // Retention is a vault policy the applicant's projection does not carry.
        purgeAfter: null,
        // The wire's three against the contract's four: `pending` exists in the contract for a
        // scanner that runs asynchronously, and nothing sends it while INT-008 is open.
        scanStatus: wire.scan_status,
    };
}

export function mapAgreementTerms(wire: WireAgreement): AgreementTerms {
    return {
        paymentTerms: wire.payment_terms ?? null,
        creditLimitMinor: wire.credit_limit_minor ?? null,
        minimumOrderMinor: wire.minimum_order_minor ?? null,
        currencyCode: wire.currency_code ?? null,
        deliveryLeadTimeDays: wire.delivery_lead_time_days ?? null,
        noticePeriodDays: wire.notice_period_days ?? null,
        startsOn: wire.starts_on ?? null,
        endsOn: wire.ends_on ?? null,
        autoRenews: wire.auto_renews,
    };
}

export function mapSignature(wire: WireAgreement): SignatureEvidence | null {
    const signedAt = wire.signed_at;
    if (signedAt == null) return null;

    return {
        kind: 'typed_name',
        typedName: wire.signatory_name ?? '',
        signatoryTitle: wire.signatory_title ?? '',
        consentStatement: wire.signature_consent_statement ?? '',
        documentSha256: wire.signature_document_sha256 ?? '',
        signedAt,
        // Carried rather than assumed. The backend records what actually happened, and a surface
        // that drew "identity verified" from the existence of a signature would report something
        // nobody checked.
        otpVerified: wire.signature_otp_verified,
    };
}

/**
 * The agreement, minus the one thing the wire does not send: the document text.
 *
 * `B2bAgreement` carries a `terms_summary` and the digest of the bytes that were signed, but not
 * the bytes. `documentText` is therefore the summary when there is one and empty otherwise — never
 * a placeholder sentence, because the signing panel renders this verbatim above a control that
 * says "I agree to the above", and inventing the above is the one thing that surface must not do.
 * The panel already refuses to enable signing on empty text.
 */
export function mapAgreement(wire: WireAgreement): B2BAgreement {
    return {
        id: wire.id,
        applicationId: wire.b2b_application_id,
        version: wire.version,
        status: wire.status,
        title: wire.title,
        documentText: wire.terms_summary ?? '',
        documentSha256: wire.signature_document_sha256 ?? '',
        terms: mapAgreementTerms(wire),
        termsSummary: wire.terms_summary ?? null,
        consentStatement: wire.signature_consent_statement ?? '',
        signature: mapSignature(wire),
        supersedesAgreementId: wire.supersedes_agreement_id ?? null,
        lockVersion: wire.lock_version,
    };
}

/**
 * A base64 payload as a `Blob` the upload endpoint can take.
 *
 * `atob` is present on every runtime this app ships to (browsers, Hermes with the standard
 * polyfill, Node 16+). Failing loudly when it is not is deliberate: a silent empty upload would
 * produce a document row with no bytes, which a reviewer would reject and an applicant could not
 * explain.
 */
export function base64ToBlob(content: string, mimeType: string): Blob {
    const decode = (globalThis as { atob?: (data: string) => string }).atob;
    if (typeof decode !== 'function') {
        throw new ApiError(
            apiFailure('server', {
                message: 'This device cannot prepare the file for upload.',
                retryable: false,
            }),
        );
    }

    const binary = decode(content);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
    return new Blob([bytes], { type: mimeType });
}

/*
 * The wind-down (B2), over the wire that exists.
 *
 * The backend landed the offboarding family under `/platform/b2b/offboardings/{offboarding}` — a
 * platform-operator surface — where the contract anticipated an organisation-scoped one. The four
 * methods below are honest translations onto that wire, and the three places the two models
 * genuinely differ are recorded here, in the manner of the file header above.
 *
 * ## 8. There is no organisation → wind-down lookup
 *
 * The only read is `GET /platform/b2b/offboardings/{offboarding}`, resolved by the wind-up's own
 * key; no list and no by-organisation query exists. `getOffboarding` therefore sends the identifier
 * it is given as that path parameter — the caller must hold the wind-up's identifier, which the
 * platform operator who started it does — and a `404` answers `null` ("not winding down"), the same
 * shape `getApplication` gives "never applied". The argument keeps the contract's `organisationId`
 * name so the signature cannot drift from the mock, and the row that comes back carries the true
 * `organisationId` for the cache key. Asking this method about an organisation whose wind-up
 * identifier nobody holds is a question the wire cannot answer, and it answers `null` rather than
 * inventing.
 *
 * ## 9. The consent wording is client-authored, and the sign-off is two calls
 *
 * The contract calls `consentStatement` server-authored; the backend deliberately made it the
 * caller's echo ("the evidence has to be what the person actually read" — its request docblock),
 * and serves no wording before signing. So the wording lives here, once, as
 * {@link OFFBOARDING_SIGNOFF_CONSENT_STATEMENT}: the mapper serves it on every row, a signing
 * screen renders what the mapper served, and `signOffOffboarding` echoes the same constant — the
 * chain "what was served is what was shown is what was recorded" holds by construction. The wire
 * also wants the passcode *consumed before* sign-off (`otp_challenge_id` names a spent challenge),
 * so the one-call contract becomes two requests here: the `<challengeId>:<code>` token — the same
 * packing `signAgreement` documents — is spent through the generic verification endpoint, then the
 * sign-off travels with the challenge identifier. `lockVersion` is deliberately not sent on either
 * write: the offboarding actions take no `If-Match`, because the state machine is the stronger
 * guard (`signed_off → signed_off` is illegal whatever validator you hold). The mock still checks
 * it, so a stale screen is caught in development where the wire would shrug.
 *
 * ## 10. Facts the wire does not serve are derived from ones it does
 *
 * `signoff.otpVerified` has no wire field: the service refuses every sign-off that lacks a
 * consumed, owned challenge, so a recorded `signed_off_at` *is* the proof, and the flag is derived
 * from it — before signing it is honestly `false`. The archive's `completedAt` is the wind-up's
 * own `completed_at` (the `archiving → completed` transition is the archive finishing), its counts
 * come from the summary map's named keys, and `legalEntityRetained` defaults `true` — the platform
 * always retains the legal entity, and the wire states it only once a summary exists. A settlement
 * check whose code this build does not know is dropped (§versioning: clients ignore unknown enum
 * members); the top-level `documentSha256` is the empty-string sentinel until a signed digest
 * exists, and `signOffOffboarding` sends `null` for an empty echo, which the wire documents as "no
 * document beyond the agreement already on file".
 */

/**
 * The wording a signatory ties their sign-off to.
 *
 * Client-authored (§9 above) and stated once. The mock world fixes the same sentence
 * (`../mock/b2b-application/offboarding.ts`), so a screen rehearsed against the mock shows the
 * wording production records.
 */
export const OFFBOARDING_SIGNOFF_CONSENT_STATEMENT =
    'I confirm I am authorised to bind this company, that I have read the wind-down notice, and ' +
    'that I agree to end the commercial relationship on the effective date shown.';

function knownSettlementCheck(value: string): value is SettlementCheckCode {
    return (SETTLEMENT_CHECK_CODES as readonly string[]).includes(value);
}

export function mapSettlementChecks(
    checks: WireOffboarding['settlement']['checks'],
): readonly SettlementCheck[] {
    return checks
        .filter((check): check is (typeof checks)[number] & { check: SettlementCheckCode } =>
            knownSettlementCheck(check.check),
        )
        .map((check) => ({
            check: check.check,
            outcome: check.outcome,
            reason: check.reason ?? null,
            detail: check.detail ?? null,
        }));
}

export function mapOffboarding(wire: WireOffboarding): B2BOffboarding {
    const summary = wire.archive.summary ?? {};
    const signedOffAt = wire.signoff.signed_off_at ?? null;

    return {
        id: wire.id,
        organisationId: wire.organisation_id,
        status: wire.status,
        // Unreachable fallback: the backend requires a trigger to start a wind-up, and nothing
        // clears the column. It exists for the type system, not for a screen.
        trigger: oneOf<OffboardingTrigger>(OFFBOARDING_TRIGGERS, wire.trigger) ?? 'client_request',
        reasonNote: wire.reason_note ?? null,
        effectiveOn: wire.effective_on ?? null,
        // Copied onto the row when notice is served; `0` only for a row that predates serving.
        noticePeriodDays: wire.notice_period_days ?? 0,
        settlement: {
            status: wire.settlement.status,
            checks: mapSettlementChecks(wire.settlement.checks),
            startedAt: wire.settlement.started_at ?? null,
            resolvedAt: wire.settlement.resolved_at ?? null,
            waiverReason: wire.settlement.waiver_reason ?? null,
        },
        signoff: {
            awaitingSince: wire.signoff.awaiting_since ?? null,
            signedOffAt,
            signatoryName: wire.signoff.signatory_name ?? null,
            signatoryTitle: wire.signoff.signatory_title ?? null,
            consentStatement: wire.signoff.consent_statement ?? null,
            documentSha256: wire.signoff.document_sha256 ?? null,
            // §10 above: derived, because the service refuses a sign-off without a consumed
            // challenge — a recorded sign-off is a proved one.
            otpVerified: signedOffAt !== null,
        },
        revocation: {
            startedAt: wire.revocation.started_at ?? null,
            completedAt: wire.revocation.completed_at ?? null,
            membershipsRevoked: wire.revocation.memberships_revoked ?? 0,
            tokensDeleted: wire.revocation.tokens_deleted ?? 0,
        },
        archive: {
            startedAt: wire.archive.started_at ?? null,
            // §10 above: the `archiving → completed` transition is the archive finishing.
            completedAt: wire.completed_at ?? null,
            legalEntityRetained: wire.archive.legal_entity_retained ?? true,
            applicationContactsPurged: summary['application_contacts_purged'] ?? 0,
            applicationSignatoriesPurged: summary['application_signatories_purged'] ?? 0,
            kycDocumentsStampedForPurge: summary['kyc_documents_stamped_for_purge'] ?? 0,
        },
        consentStatement: OFFBOARDING_SIGNOFF_CONSENT_STATEMENT,
        documentSha256: wire.signoff.document_sha256 ?? '',
        allowedTransitions: wire.allowed_transitions,
        startedAt: wire.requested_at,
        cancelledAt: wire.cancelled_at ?? null,
        cancelledReason: wire.cancellation_reason ?? null,
        lockVersion: wire.lock_version,
    };
}

export function createApiB2bApplicationRepository(transport: Transport): B2BApplicationRepository {
    function path(applicationId: string, suffix = ''): string {
        return `/b2b/applications/${encodeURIComponent(applicationId)}${suffix}`;
    }

    /** The platform wind-down surface — the only place the offboarding family lives (§8 above). */
    function offboardingPath(offboardingId: string, suffix = ''): string {
        return `/platform/b2b/offboardings/${encodeURIComponent(offboardingId)}${suffix}`;
    }

    /** The optimistic-concurrency header every write on this family carries (plan §4.13). */
    function ifMatch(lockVersion: number): Readonly<Record<string, string>> {
        return { 'If-Match': `"${lockVersion}"` };
    }

    async function readAgreement(applicationId: string): Promise<WireAgreement | null> {
        try {
            const agreements = await transport.request<WireAgreement[]>({
                method: 'GET',
                path: path(applicationId, '/agreements'),
            });
            // Newest version first; an application has one live agreement and any number of
            // superseded ones.
            return [...agreements].sort((a, b) => b.version - a.version)[0] ?? null;
        } catch (caught: unknown) {
            // No agreement drafted yet is a `404`, and it is a *state* the panel draws rather than
            // an error — the same reason `getApplication` answers `null` for "never applied".
            if (caught instanceof ApiError && caught.code === 'resource.not_found') return null;
            throw caught;
        }
    }

    /** One application, whole: the row, its documents and its agreement, in parallel. */
    async function hydrate(wire: WireApplication): Promise<B2BApplication> {
        const [documents, agreement] = await Promise.all([
            transport
                .request<WireDocument[]>({ method: 'GET', path: path(wire.id, '/documents') })
                .catch(() => [] as WireDocument[]),
            readAgreement(wire.id),
        ]);

        return {
            id: wire.id,
            reference: wire.reference,
            state: mapApplicationState(wire, agreement),
            sections: mapSections(wire),
            sectionStates: mapSectionStates(wire),
            // Empty on purpose — see §4 of the file header.
            requiredDocumentKinds: [],
            documents: documents.map(mapDocument),
            reviewerRequests: mapReviewerRequests(wire),
            applicantMessage: wire.applicant_message ?? null,
            agreement: agreement === null ? null : mapAgreement(agreement),
            provisioning: mapProvisioning(wire),
            createdAt: wire.created_at ?? '',
            submittedAt: wire.submitted_at ?? null,
            decidedAt: wire.decided_at ?? null,
            lockVersion: wire.lock_version,
        };
    }

    /**
     * A section payload as the wire wants it — and a refusal for a key the section does not own.
     *
     * The backend checks the same thing and answers `422`. Checking here as well is not belt and
     * braces: it turns "the server refused your save" into "this field belongs to another step",
     * which is the difference between a wizard that can point at something and one that cannot.
     */
    function sectionBody(
        section: B2BApplicationSection,
        payload: B2BSectionPayload,
    ): UpdateB2bApplicationSectionRequest {
        const owned = new Set(SECTION_FIELDS[section]);
        const body: Record<string, unknown> = {};

        for (const [key, value] of Object.entries(payload)) {
            if (!owned.has(key)) {
                throw new ApiError(
                    validationFailure(
                        { [key]: [`This field belongs to another step, not to ${section}.`] },
                        { message: `\`${key}\` is not part of the ${section} section.` },
                    ),
                );
            }
            const wireKey = WIRE_FIELDS[key];
            if (wireKey !== undefined) body[wireKey] = value;
        }

        return body as UpdateB2bApplicationSectionRequest;
    }

    return {
        /**
         * The applicant's live application, or `null`.
         *
         * "You have not applied yet" is a state the entry screen draws, not an error — so an empty
         * list answers `null` rather than rejecting. The list is newest-first by creation, and an
         * applicant has one live application at a time.
         */
        async getApplication(): Promise<B2BApplication | null> {
            const applications = await transport.request<WireApplication[]>({
                method: 'GET',
                path: '/b2b/applications',
            });

            const live = applications[0];
            if (live === undefined) return null;

            // The list projection is a summary on some deployments and the full row on others; the
            // detail endpoint is the one that is guaranteed to carry every section field.
            const wire = await transport.request<WireApplication>({
                method: 'GET',
                path: path(live.id),
            });
            return hydrate(wire);
        },

        async startApplication(): Promise<B2BApplication> {
            const wire = await transport.request<WireApplication>({
                method: 'POST',
                path: '/b2b/applications',
            });
            return hydrate(wire);
        },

        async saveSection(request: {
            readonly applicationId: string;
            readonly section: B2BApplicationSection;
            readonly payload: B2BSectionPayload;
            readonly markComplete?: boolean | undefined;
            readonly lockVersion: number;
        }): Promise<B2BApplication> {
            const wire = await transport.request<WireApplication>({
                method: 'PATCH',
                path: path(
                    request.applicationId,
                    `/sections/${encodeURIComponent(request.section)}`,
                ),
                headers: ifMatch(request.lockVersion),
                body: {
                    ...sectionBody(request.section, request.payload),
                    // The applicant's claim that they have finished the step. A claim, not a
                    // verdict — the contract is explicit that the two are different columns.
                    ...(request.markComplete === undefined
                        ? {}
                        : { mark_complete: request.markComplete }),
                },
            });
            return hydrate(wire);
        },

        /**
         * Upload a document.
         *
         * Multipart, because the endpoint takes bytes. `replacesDocumentId` is sent when given:
         * the replaced row is kept and marked `superseded`, so a reviewer's decision trail survives
         * the applicant re-uploading. The answer is the document; the whole application is re-read
         * because the vault is part of it and the wizard renders both.
         */
        async uploadDocument(request: UploadDocumentRequest): Promise<B2BApplication> {
            const form = new FormData();
            form.append('file', base64ToBlob(request.content, request.mimeType), request.fileName);
            form.append('document_kind', request.kind);
            if (request.replacesDocumentId !== undefined) {
                form.append('replaces_document_id', request.replacesDocumentId);
            }

            await transport.request<WireDocument>({
                method: 'POST',
                path: path(request.applicationId, '/documents'),
                body: new MultipartBody(form),
            });

            const wire = await transport.request<WireApplication>({
                method: 'GET',
                path: path(request.applicationId),
            });
            return hydrate(wire);
        },

        /**
         * There is no endpoint for this.
         *
         * Rejecting is the honest answer, and `prototype.not_implemented` is the code that says
         * exactly why: the operation is on the contract, nothing serves it, and the vault would
         * otherwise report a removal that never happened. Re-uploading the same kind supersedes,
         * which is the operation the backend does publish.
         */
        removeDocument(_request: {
            readonly applicationId: string;
            readonly documentId: string;
        }): Promise<B2BApplication> {
            return Promise.reject(
                new ApiError(
                    apiFailure('prototype.not_implemented', {
                        message:
                            'Documents cannot be removed yet — there is no endpoint for it. ' +
                            'Uploading another document of the same kind supersedes this one.',
                    }),
                ),
            );
        },

        /**
         * Mint an audited, short-lived link.
         *
         * `purpose` is required by the endpoint and is the audit record's reason-for-access:
         * reading a passport is a thing that gets recorded, and a link minted without a stated
         * purpose is one nobody could attribute afterwards.
         */
        async getDocumentDownload(request: {
            readonly applicationId: string;
            readonly documentId: string;
        }): Promise<DocumentDownload> {
            const wire = await transport.request<WireDownload>({
                method: 'GET',
                path: path(
                    request.applicationId,
                    `/documents/${encodeURIComponent(request.documentId)}/download?purpose=applicant_review`,
                ),
            });

            return {
                documentId: request.documentId,
                url: wire.url,
                expiresAt: wire.expires_at,
            };
        },

        async submitApplication(request: {
            readonly applicationId: string;
            readonly lockVersion: number;
        }): Promise<B2BApplication> {
            const wire = await transport.request<WireApplication>({
                method: 'POST',
                path: path(request.applicationId, '/submit'),
                headers: ifMatch(request.lockVersion),
            });
            return hydrate(wire);
        },

        async withdrawApplication(request: {
            readonly applicationId: string;
            readonly lockVersion: number;
        }): Promise<B2BApplication> {
            const wire = await transport.request<WireApplication>({
                method: 'POST',
                path: path(request.applicationId, '/withdraw'),
                headers: ifMatch(request.lockVersion),
            });
            return hydrate(wire);
        },

        async getAgreement(request: {
            readonly applicationId: string;
        }): Promise<B2BAgreement | null> {
            const wire = await readAgreement(request.applicationId);
            return wire === null ? null : mapAgreement(wire);
        },

        /**
         * Sign.
         *
         * `verificationToken` on the contract is the step-up, and the endpoint wants the challenge
         * and the code that proved it — two values where the contract carries one. They are packed
         * as `<challengeId>:<code>`, which is what the signing screen already produces from the
         * passcode panel it renders, and unpacked here. A token that does not carry both is refused
         * naming the field rather than sent as a challenge identifier with an empty code, which the
         * server would refuse less clearly.
         *
         * `authorityConfirmed` is checked *here* as well as server-side: it is a separate claim
         * from the typed name, and a request that reached the wire with it false would be a client
         * that had lost the one statement that matters in a dispute.
         */
        async signAgreement(request: SignAgreementRequest): Promise<B2BApplication> {
            if (!request.authorityConfirmed) {
                throw new ApiError(
                    validationFailure({
                        authorityConfirmed: ['Confirm that you may bind this company.'],
                    }),
                );
            }

            const separator = request.verificationToken.indexOf(':');
            if (separator <= 0) {
                throw new ApiError(
                    apiFailure('b2b.signatory_required', {
                        message: 'Confirm the code we sent before signing.',
                    }),
                );
            }

            const challengeId = request.verificationToken.slice(0, separator);
            const code = request.verificationToken.slice(separator + 1);

            // The signing endpoint is nested under the application, and `SignAgreementRequest`
            // carries only the agreement. The applicant has one live application, which is what
            // `getApplication` already relies on, so it is read rather than made a contract change
            // that would ripple through the screens.
            const applications = await transport.request<WireApplication[]>({
                method: 'GET',
                path: '/b2b/applications',
            });
            const application = applications[0];
            if (application === undefined) {
                throw new ApiError(
                    apiFailure('resource.not_found', {
                        message: 'There is no application to sign an agreement for.',
                    }),
                );
            }

            await transport.request<WireAgreement>({
                method: 'POST',
                path: path(
                    application.id,
                    `/agreements/${encodeURIComponent(request.agreementId)}/sign`,
                ),
                body: {
                    challenge_id: challengeId,
                    code,
                    signatory_name: request.typedName,
                    signatory_title: request.signatoryTitle,
                    // Echoed back from the agreement the person actually read, so a document that
                    // changed under them is refused rather than silently signed.
                    document_sha256: request.documentSha256,
                    consent_statement: '',
                },
            });

            const wire = await transport.request<WireApplication>({
                method: 'GET',
                path: path(application.id),
            });
            return hydrate(wire);
        },

        /* ── B2: the wind-down — see notes §8–§10 above the mappers ──────────────────────────── */

        /**
         * The wind-down, or `null`.
         *
         * §8 above: the identifier this method sends is the wind-up's own, because the by-key show
         * is the only read the platform publishes. A `404` is the state the screen draws — "this
         * company is not winding down" — never an error.
         */
        async getOffboarding(request: {
            readonly organisationId: string;
        }): Promise<B2BOffboarding | null> {
            try {
                const wire = await transport.request<OffboardingEnvelope['data']>({
                    method: 'GET',
                    path: offboardingPath(request.organisationId),
                });
                return mapOffboarding(wire.offboarding);
            } catch (caught: unknown) {
                if (caught instanceof ApiError && caught.code === 'resource.not_found') return null;
                throw caught;
            }
        },

        /**
         * Re-run the four checks.
         *
         * Idempotent by nature — the answer is whatever the financial modules say *now* — and
         * `settlement_pending → settlement_pending` is legal, so re-running is the normal case.
         * `lockVersion` is accepted and not sent (§9 above): the action takes no `If-Match`
         * because the state machine is the stronger guard.
         */
        async runSettlementChecks(request: {
            readonly offboardingId: string;
            readonly lockVersion: number;
        }): Promise<B2BOffboarding> {
            const wire = await transport.request<OffboardingEnvelope['data']>({
                method: 'POST',
                path: offboardingPath(request.offboardingId, '/settlement-checks'),
            });
            return mapOffboarding(wire.offboarding);
        },

        /**
         * Send the signatory a code.
         *
         * A `202` — the message is a queued job — carrying the challenge with its masked
         * destination and countdown, never the code. The destination is the **agreement's**
         * signatory through their login contact, not whoever is driving the wind-up; the panel
         * pairs this challenge's identifier with the code the signatory types, which is the
         * `<challengeId>:<code>` token `signOffOffboarding` unpacks.
         */
        async issueSignoffChallenge(request: {
            readonly offboardingId: string;
        }): Promise<OtpChallenge> {
            const wire = await transport.request<OtpChallengeEnvelope['data']>({
                method: 'POST',
                path: offboardingPath(request.offboardingId, '/signoff-challenges'),
            });
            return mapIssuedChallenge(wire.challenge);
        },

        /**
         * The only irreversible act a signatory performs in this flow.
         *
         * Two requests over one method (§9 above): the packed `<challengeId>:<code>` token is
         * spent through the generic verification endpoint — the wire demands a *consumed*
         * challenge, and evidence a caller asserts is not evidence — then the sign-off travels
         * with the spent challenge's identifier. A wrong code rejects with `otp.invalid` before
         * anything is signed; a challenge that is not the caller's own rejects the sign-off with
         * `b2b.signatory_required`, indistinguishably from every other way it can fail.
         *
         * `authorityConfirmed` is checked here as well as implied server-side, on the same terms
         * as {@link signAgreement}: it is a separate claim from the typed name, and a request that
         * reached the wire with it false would have lost the one statement a dispute turns on.
         */
        async signOffOffboarding(request: SignOffOffboardingRequest): Promise<B2BOffboarding> {
            if (!request.authorityConfirmed) {
                throw new ApiError(
                    validationFailure({
                        authorityConfirmed: ['Confirm that you may bind this company.'],
                    }),
                );
            }

            const separator = request.verificationToken.indexOf(':');
            if (separator <= 0) {
                throw new ApiError(
                    apiFailure('b2b.signatory_required', {
                        message: 'Confirm the code we sent before signing off.',
                    }),
                );
            }

            const challengeId = request.verificationToken.slice(0, separator);
            const code = request.verificationToken.slice(separator + 1);

            await transport.request({
                method: 'POST',
                path: `/verification/challenges/${encodeURIComponent(challengeId)}/verify`,
                body: { code },
            });

            const body: WireSignoffBody = {
                signatory_name: request.typedName,
                signatory_title: request.signatoryTitle,
                // §9 above: the same constant the mapper serves, so what was shown is what is
                // recorded.
                consent_statement: OFFBOARDING_SIGNOFF_CONSENT_STATEMENT,
                // Echoed from the row the person read; an empty echo means the wind-up published
                // no digest yet, which the wire spells `null`.
                document_sha256: request.documentSha256 === '' ? null : request.documentSha256,
                otp_challenge_id: challengeId,
            };

            const wire = await transport.request<OffboardingEnvelope['data']>({
                method: 'POST',
                path: offboardingPath(request.offboardingId, '/signoff'),
                body,
            });
            return mapOffboarding(wire.offboarding);
        },
    };
}

/**
 * Issue the signatory step-up challenge.
 *
 * Exported beside the repository rather than added to `B2BApplicationRepository`, for the same
 * reason `getChallenge` belongs to `GuestRepository`: it is not the applicant's data surface, it is
 * the one call the signing *panel* makes before it can produce a `verificationToken`. The panel
 * pairs the challenge identifier it gets here with the code the person types, which is the
 * `<challengeId>:<code>` pair `signAgreement` unpacks.
 */
export async function issueSignatureChallenge(
    transport: Transport,
    request: { readonly applicationId: string; readonly agreementId: string },
): Promise<{ readonly challengeId: string }> {
    const wire = await transport.request<{ challenge_id: string }>({
        method: 'POST',
        path:
            `/b2b/applications/${encodeURIComponent(request.applicationId)}` +
            `/agreements/${encodeURIComponent(request.agreementId)}/signature-challenges`,
    });
    return { challengeId: wire.challenge_id };
}
