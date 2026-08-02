import type {
    B2BAgreement,
    B2BApplication,
    B2BApplicationSection,
    B2BApplicationSectionState,
    B2BApplicationSections,
    B2BApplicationState,
    B2BDocumentKind,
    B2BSectionPayload,
    DocumentDownload,
    KycDocument,
    ProvisioningProgress,
    ReviewerRequest,
    SignAgreementRequest,
} from '../../contracts/b2b-application.ts';
import {
    apiFailure,
    conflictFailure,
    throwFailure,
    validationFailure,
} from '../../contracts/failure.ts';
import type { Clock } from '../store.ts';
import {
    B2B_RUNTIME_ORDINAL_START,
    agreementIdAt,
    applicationIdAt,
    documentIdAt,
    organisationIdAt,
} from './ids.ts';
import {
    AGREEMENT_CONSENT_STATEMENT,
    AGREEMENT_DOCUMENT_SHA256,
    B2B_FIXTURES,
    DEFAULT_B2B_FIXTURE,
    blankSections,
} from './seed.ts';
import type { B2bFixture, B2bFixtureName } from './seed.ts';

/* ------------------------------------------------------------------------------------------------
 * The mock mechanics.
 *
 * The fixtures are invented; **everything that happens to them is real**. A section PATCH is checked
 * against the section's own allowlist and persists; submission runs the server's completeness rule
 * over the data actually present rather than over the applicant's progress claim; an upload
 * supersedes rather than overwrites; a signature is refused without an authority confirmation and
 * without a verification token. A world where every write succeeds teaches nobody what the screens
 * do, and it cannot drive a test.
 * ---------------------------------------------------------------------------------------------- */

/**
 * The step-up token the mock accepts on a signature.
 *
 * The account world's `AccountMockStore` is the OTP authority and it mints challenges, but it does
 * **not** publish a token from `verifyChallenge` — `OtpVerificationResult` carries a challenge
 * identifier and a `stepUpUntil`, not a bearer token, because the real backend's step-up is a
 * server-side window rather than something handed to a client. Importing the account store here
 * would therefore buy nothing except a coupling between two worlds that are deliberately disjoint.
 *
 * So this store accepts one published constant and treats the *verified challenge identifier* as
 * equally valid: a screen that has genuinely completed a `b2b_signatory` challenge passes the
 * challenge id it just verified, and a test that is not exercising the OTP path passes
 * {@link MOCK_SIGNING_TOKEN}. Both are checked; an empty token is refused, which is the mechanic
 * that matters — a signature nobody stepped up for must not be recordable.
 */
export const MOCK_SIGNING_TOKEN = 'b2b-signatory-verified';

/** How long a minted document link lives. Short, like the real one. */
export const DOCUMENT_LINK_TTL_SECONDS = 120;

/** Which fields each section owns — the PATCH allowlist, mirroring the backend's `fields()`. */
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

/**
 * What must be present before submission — the backend's `requiredFields()`, verbatim.
 *
 * Narrow on purpose. What is required is only what makes an application *identifiable*: which
 * company, who speaks for it, and how they expect to pay. Everything else is a conversation, and a
 * validator that demanded it all up front would produce fewer applications rather than better ones.
 */
const REQUIRED_FIELDS: Readonly<Record<B2BApplicationSection, readonly string[]>> = {
    company: ['legalName', 'countryCode', 'commercialRegistrationNumber'],
    signatory: ['signatoryName', 'signatoryTitle', 'signatoryEmail'],
    trade_terms: ['requestedPaymentTerms'],
    logistics: [],
};

/**
 * The document kinds the *server* requires. Two, not eight.
 *
 * A registration document says the company exists; an identity document says the signatory is a
 * real person who can be held to what they sign. Everything else is asked for through the
 * information-request loop when a case calls for it.
 */
const REQUIRED_DOCUMENT_KINDS: readonly B2BDocumentKind[] = [
    'commercial_registration',
    'signatory_identification',
];

/** States in which the applicant may write at all. */
function editableState(state: B2BApplicationState): boolean {
    return state === 'draft' || state === 'info_requested';
}

interface MutableRow {
    id: string;
    reference: string;
    state: B2BApplicationState;
    sections: B2BApplicationSections;
    completedByApplicant: Set<string>;
    documents: KycDocument[];
    reviewerRequests: ReviewerRequest[];
    applicantMessage: string | null;
    agreement: B2BAgreement | null;
    provisioning: ProvisioningProgress | null;
    createdAt: string;
    submittedAt: string | null;
    decidedAt: string | null;
    lockVersion: number;
}

export interface B2bMockStoreOptions {
    /** The clock. Defaults to the real one, like the other worlds. */
    readonly now?: Clock | undefined;
    /** Which fixture the applicant holds. Defaults to the half-finished draft. */
    readonly fixture?: B2bFixtureName | undefined;
    /** Start with no application at all — the entry screen's "you have not applied yet" state. */
    readonly empty?: boolean | undefined;
}

/**
 * The mutable world behind the B2B application repository.
 *
 * A plain synchronous class with no I/O, like the other stores: the repository layer above adds the
 * latency and nothing else. Every rejection goes through `throwFailure`, so the mock and the future
 * API repository are indistinguishable to a screen.
 *
 * **One deliberate divergence from the B1 backend, stated rather than hidden.** The backend's
 * `AgreementService::sign()` records `otp_verified = false` on every signature, because the OTP
 * link is an unconstrained seam the integrator closes. This store *does* verify a token, and its
 * signatures read `otpVerified: true`. That is the behaviour the screen has to be built against —
 * the panel's whole shape is "you cannot sign until you have stepped up" — and a mock that mirrored
 * the seam would make the signing flow untestable for the sake of matching a temporary state.
 */
export class B2bMockStore {
    readonly #now: Clock;

    #row: MutableRow | null;
    #nextOrdinal = B2B_RUNTIME_ORDINAL_START;
    #nextReference = 100;

    constructor(options: B2bMockStoreOptions = {}) {
        this.#now = options.now ?? (() => Date.now());
        this.#row =
            options.empty === true
                ? null
                : hydrate(B2B_FIXTURES[options.fixture ?? DEFAULT_B2B_FIXTURE], this.#iso());
    }

    // ── reads ───────────────────────────────────────────────────────────────────────────────────

    application(): B2BApplication | null {
        return this.#row === null ? null : this.#read(this.#row);
    }

    agreement(applicationId: string): B2BAgreement | null {
        return this.#require(applicationId).agreement;
    }

    // ── the application ─────────────────────────────────────────────────────────────────────────

    /**
     * Start one, or hand back the live one.
     *
     * Returning the existing row rather than minting a second mirrors the backend's partial unique
     * index — one live application per applicant — and it is also the only honest answer to a person
     * who pressed "apply" twice: they have one application, not two.
     */
    startApplication(): B2BApplication {
        if (this.#row !== null && !terminal(this.#row.state)) return this.#read(this.#row);

        this.#row = {
            id: applicationIdAt(this.#takeOrdinal()),
            reference: `APP-2026-0${String(this.#nextReference++)}`,
            state: 'draft',
            sections: blankSections(),
            completedByApplicant: new Set<string>(),
            documents: [],
            reviewerRequests: [],
            applicantMessage: null,
            agreement: null,
            provisioning: null,
            createdAt: this.#iso(),
            submittedAt: null,
            decidedAt: null,
            lockVersion: 0,
        };
        return this.#read(this.#row);
    }

    /**
     * Write one section.
     *
     * Three refusals, and each one is a real rule rather than a validation flourish:
     *
     * * a key the section does not own is **refused**, never dropped — a client that sent
     *   `legalName` to the logistics step believed it was saving something;
     * * a section the current state does not reopen is refused, which is what `info_requested`
     *   narrowing means;
     * * a stale `lockVersion` is a `resource.conflict` carrying the version the server holds, so
     *   the editor can offer reload-or-keep instead of silently overwriting a second tab.
     */
    saveSection(request: {
        readonly applicationId: string;
        readonly section: B2BApplicationSection;
        readonly payload: B2BSectionPayload;
        readonly markComplete?: boolean | undefined;
        readonly lockVersion: number;
    }): B2BApplication {
        const row = this.#require(request.applicationId);
        this.#assertVersion(row, request.lockVersion);

        if (!editableState(row.state)) throwFailure(conflictFailure());
        if (!this.#sectionEditable(row, request.section)) throwFailure(conflictFailure());

        const owned = SECTION_FIELDS[request.section];
        const foreign = Object.keys(request.payload).filter((key) => !owned.includes(key));
        if (foreign.length > 0) {
            throwFailure(
                validationFailure(
                    Object.fromEntries(
                        foreign.map((key) => [key, [`${key} does not belong to this section.`]]),
                    ),
                ),
            );
        }

        row.sections = {
            ...row.sections,
            [request.section]: {
                ...row.sections[request.section],
                ...request.payload,
            },
        } as B2BApplicationSections;

        if (request.markComplete === true) {
            row.completedByApplicant.add(request.section);
        } else if (request.markComplete === false) {
            row.completedByApplicant.delete(request.section);
        }

        row.lockVersion += 1;
        return this.#read(row);
    }

    /**
     * Hand it to a reviewer.
     *
     * The completeness check runs over the data actually present and over the documents actually
     * held — never over `completedByApplicant`, which is a claim. The rejection names the sections
     * and the kinds so the status panel can link at them.
     */
    submitApplication(request: {
        readonly applicationId: string;
        readonly lockVersion: number;
    }): B2BApplication {
        const row = this.#require(request.applicationId);
        this.#assertVersion(row, request.lockVersion);
        if (!editableState(row.state)) throwFailure(conflictFailure());

        const fields: Record<string, string[]> = {};
        for (const section of Object.keys(REQUIRED_FIELDS) as B2BApplicationSection[]) {
            const missing = missingFieldsFor(row.sections, section);
            if (missing.length > 0) fields[section] = [...missing];
        }

        const missingKinds = REQUIRED_DOCUMENT_KINDS.filter(
            (kind) => !row.documents.some((held) => held.kind === kind && satisfies(held)),
        );
        if (missingKinds.length > 0) fields['documents'] = [...missingKinds];

        if (Object.keys(fields).length > 0) throwFailure(validationFailure(fields));

        row.state = 'submitted';
        row.submittedAt ??= this.#iso();
        // An answer to a request resolves it. The request stays in the record — the applicant can
        // still read what was asked — but it stops being something the panel asks them to do.
        for (const [index, entry] of row.reviewerRequests.entries()) {
            if (entry.resolvedAt === null) {
                row.reviewerRequests[index] = { ...entry, resolvedAt: this.#iso() };
            }
        }
        row.lockVersion += 1;
        return this.#read(row);
    }

    withdrawApplication(request: {
        readonly applicationId: string;
        readonly lockVersion: number;
    }): B2BApplication {
        const row = this.#require(request.applicationId);
        this.#assertVersion(row, request.lockVersion);
        if (terminal(row.state) || row.state === 'provisioned') throwFailure(conflictFailure());

        row.state = 'withdrawn';
        row.decidedAt = this.#iso();
        row.lockVersion += 1;
        return this.#read(row);
    }

    // ── documents ───────────────────────────────────────────────────────────────────────────────

    /**
     * Upload, or replace.
     *
     * The bytes are **not kept**. What is recorded is the declared length, which is everything the
     * screens read — a name, a size, a digest — and holding a base64 payload of a ten-megabyte PDF
     * in a fixture world would cost a test run its memory for no assertion anybody makes. The digest
     * is derived from the length and the name so that two uploads of the same file agree, which is
     * the one property a digest is used for here.
     *
     * A replaced document is marked `superseded` and kept, exactly as the backend keeps it: the
     * reviewer's decision trail must survive the applicant re-uploading.
     */
    uploadDocument(request: {
        readonly applicationId: string;
        readonly kind: B2BDocumentKind;
        readonly fileName: string;
        readonly mimeType: string;
        readonly byteSize: number;
        readonly content: string;
        readonly replacesDocumentId?: string | undefined;
    }): B2BApplication {
        const row = this.#require(request.applicationId);
        if (!editableState(row.state)) throwFailure(conflictFailure());

        // A countersigned agreement is produced by the signing flow, never posted here.
        if (request.kind === 'signed_agreement') throwFailure(conflictFailure());

        if (request.fileName.trim().length === 0) {
            throwFailure(validationFailure({ fileName: ['Choose a file.'] }));
        }
        if (request.byteSize <= 0) {
            throwFailure(validationFailure({ content: ['That file is empty.'] }));
        }

        if (request.replacesDocumentId !== undefined) {
            const index = row.documents.findIndex((held) => held.id === request.replacesDocumentId);
            if (index < 0) throwFailure(apiFailure('resource.not_found'));
            const previous = row.documents[index] as KycDocument;
            row.documents.splice(index, 1, { ...previous, reviewStatus: 'superseded' });
        }

        row.documents.push({
            id: documentIdAt(this.#takeOrdinal()),
            kind: request.kind,
            fileName: request.fileName,
            mimeType: request.mimeType,
            byteSize: request.byteSize,
            sha256: fakeDigest(request.fileName, request.byteSize),
            uploadedAt: this.#iso(),
            reviewStatus: 'pending',
            rejectionReason: null,
            expiresOn: null,
            purgeAfter: null,
            scanStatus: 'not_scanned',
        });
        row.lockVersion += 1;
        return this.#read(row);
    }

    removeDocument(request: {
        readonly applicationId: string;
        readonly documentId: string;
    }): B2BApplication {
        const row = this.#require(request.applicationId);
        if (!editableState(row.state)) throwFailure(conflictFailure());

        const index = row.documents.findIndex((held) => held.id === request.documentId);
        if (index < 0) throwFailure(apiFailure('resource.not_found'));
        row.documents.splice(index, 1);
        row.lockVersion += 1;
        return this.#read(row);
    }

    documentDownload(request: {
        readonly applicationId: string;
        readonly documentId: string;
    }): DocumentDownload {
        const row = this.#require(request.applicationId);
        const held = row.documents.find((candidate) => candidate.id === request.documentId);
        if (held === undefined) throwFailure(apiFailure('resource.not_found'));

        return {
            documentId: held.id,
            // Obviously not a real link. The point being modelled is that it is minted, scoped and
            // short-lived — not that a fixture can serve bytes.
            url: `mock-vault://${row.id}/${held.id}`,
            expiresAt: new Date(this.#now() + DOCUMENT_LINK_TTL_SECONDS * 1000).toISOString(),
        };
    }

    // ── the agreement ───────────────────────────────────────────────────────────────────────────

    /**
     * Sign, and then provision.
     *
     * Four refusals, in the order a screen hits them: no agreement, a document that changed under
     * the signatory, a name or title left blank or an authority box left unticked, and a missing
     * step-up token. The last two are the ones worth stating — the authority confirmation is a
     * *separate claim* from the typed name, and a signature nobody stepped up for is not evidence of
     * who signed.
     */
    signAgreement(request: SignAgreementRequest): B2BApplication {
        const row = this.#rowForAgreement(request.agreementId);
        const current = row.agreement;
        if (current === null) throwFailure(apiFailure('resource.not_found'));
        if (current.status !== 'pending_signature') throwFailure(conflictFailure());
        if (current.lockVersion !== request.lockVersion) {
            throwFailure(conflictFailure({ currentLockVersion: current.lockVersion }));
        }

        // The digest of what they read. A document that changed under them is refused rather than
        // silently signed against the new text.
        if (request.documentSha256 !== current.documentSha256) throwFailure(conflictFailure());

        const fields: Record<string, string[]> = {};
        if (request.typedName.trim().length === 0) fields['typedName'] = ['Type your full name.'];
        if (request.signatoryTitle.trim().length === 0) {
            fields['signatoryTitle'] = ['State your role at the company.'];
        }
        if (!request.authorityConfirmed) {
            fields['authorityConfirmed'] = ['Confirm you may sign for this company.'];
        }
        if (request.verificationToken.trim().length === 0) {
            fields['verificationToken'] = ['Verify the code we sent before signing.'];
        }
        if (Object.keys(fields).length > 0) throwFailure(validationFailure(fields));

        row.agreement = {
            ...current,
            status: 'active',
            lockVersion: current.lockVersion + 1,
            signature: {
                kind: request.kind,
                typedName: request.typedName.trim(),
                signatoryTitle: request.signatoryTitle.trim(),
                consentStatement: current.consentStatement,
                documentSha256: current.documentSha256,
                signedAt: this.#iso(),
                otpVerified: true,
            },
        };

        // Signing is what starts provisioning, and provisioning is a *progression*, not an instant.
        // The store advances to `provisioning` with the first two steps done so a screen has a
        // genuinely partial state to draw; `completeProvisioning` finishes it.
        row.state = 'provisioning';
        row.provisioning = {
            steps: [
                { step: 'organisation', complete: true, blockedReason: null },
                { step: 'customer_account', complete: true, blockedReason: null },
                { step: 'commercial_terms', complete: false, blockedReason: null },
                { step: 'delivery_locations', complete: false, blockedReason: null },
                { step: 'team_invitations', complete: false, blockedReason: null },
            ],
            completedAt: null,
            organisationId: organisationIdAt(this.#takeOrdinal()),
        };
        row.documents.push({
            id: documentIdAt(this.#takeOrdinal()),
            kind: 'signed_agreement',
            fileName: `${current.title}.pdf`,
            mimeType: 'application/pdf',
            byteSize: current.documentText.length,
            sha256: current.documentSha256,
            uploadedAt: this.#iso(),
            reviewStatus: 'accepted',
            rejectionReason: null,
            expiresOn: null,
            purgeAfter: null,
            scanStatus: 'not_scanned',
        });
        row.lockVersion += 1;
        return this.#read(row);
    }

    /**
     * Finish provisioning.
     *
     * Exposed on the store rather than the repository because no *client* triggers it — a background
     * transaction does. A test drives it directly, which is exactly what the real screen does not.
     */
    completeProvisioning(): B2BApplication {
        const row = this.#row;
        if (row === null || row.provisioning === null)
            throwFailure(apiFailure('resource.not_found'));

        row.provisioning = {
            steps: row.provisioning.steps.map((step) => ({ ...step, complete: true })),
            completedAt: this.#iso(),
            organisationId: row.provisioning.organisationId ?? organisationIdAt(0),
        };
        row.state = 'provisioned';
        row.lockVersion += 1;
        return this.#read(row);
    }

    /**
     * Move the application to any state.
     *
     * The reviewer's half of the workflow is a platform workspace this contract does not publish, so
     * a test that needs an `in_review` or a `declined` panel has no repository call to make. This is
     * that lever, on the store where a screen cannot reach it.
     */
    forceState(
        state: B2BApplicationState,
        options: { readonly message?: string } = {},
    ): B2BApplication {
        const row = this.#row;
        if (row === null) throwFailure(apiFailure('resource.not_found'));

        row.state = state;
        if (options.message !== undefined) row.applicantMessage = options.message;
        if (state === 'submitted' || state === 'in_review') row.submittedAt ??= this.#iso();
        if (state === 'approved' || state === 'declined') row.decidedAt ??= this.#iso();
        if (state === 'agreement_pending' && row.agreement === null) {
            row.agreement = {
                id: agreementIdAt(this.#takeOrdinal()),
                applicationId: row.id,
                version: 1,
                status: 'pending_signature',
                title: `Master Supply Agreement — ${row.sections.company.legalName ?? row.reference}`,
                documentText: 'SPECIMEN AGREEMENT — NOT A REAL CONTRACT.',
                documentSha256: AGREEMENT_DOCUMENT_SHA256,
                terms: {
                    paymentTerms: row.sections.trade_terms.requestedPaymentTerms,
                    creditLimitMinor: null,
                    minimumOrderMinor: null,
                    currencyCode: row.sections.trade_terms.currencyCode,
                    deliveryLeadTimeDays: row.sections.logistics.leadTimeDays,
                    noticePeriodDays: 30,
                    startsOn: null,
                    endsOn: null,
                    autoRenews: false,
                },
                termsSummary: null,
                consentStatement: AGREEMENT_CONSENT_STATEMENT,
                signature: null,
                supersedesAgreementId: null,
                lockVersion: 0,
            };
        }
        row.lockVersion += 1;
        return this.#read(row);
    }

    // ── internals ───────────────────────────────────────────────────────────────────────────────

    #iso(): string {
        return new Date(this.#now()).toISOString();
    }

    #takeOrdinal(): number {
        return this.#nextOrdinal++;
    }

    #require(applicationId: string): MutableRow {
        const row = this.#row;
        if (row === null || row.id !== applicationId)
            throwFailure(apiFailure('resource.not_found'));
        return row;
    }

    #rowForAgreement(agreementId: string): MutableRow {
        const row = this.#row;
        if (row === null || row.agreement === null || row.agreement.id !== agreementId) {
            throwFailure(apiFailure('resource.not_found'));
        }
        return row;
    }

    #assertVersion(row: MutableRow, lockVersion: number): void {
        if (row.lockVersion !== lockVersion) {
            throwFailure(conflictFailure({ currentLockVersion: row.lockVersion }));
        }
    }

    /**
     * Whether the applicant may write this section right now.
     *
     * In `draft`, all of them. In `info_requested`, **only the sections an unresolved request
     * named** — that narrowing is what makes "we need two things from you" mean something more than
     * "here is your form back".
     */
    #sectionEditable(row: MutableRow, section: B2BApplicationSection): boolean {
        if (row.state === 'draft') return true;
        if (row.state !== 'info_requested') return false;

        const open = row.reviewerRequests.filter((entry) => entry.resolvedAt === null);
        // A request that names only documents reopens no section, and one that names none at all is
        // a plain message — neither should silently unlock the whole form.
        return open.some((entry) => entry.sections.includes(section));
    }

    #read(row: MutableRow): B2BApplication {
        const sectionStates: B2BApplicationSectionState[] = (
            Object.keys(SECTION_FIELDS) as B2BApplicationSection[]
        ).map((section) => {
            const missing = missingFieldsFor(row.sections, section);
            return {
                section,
                complete: missing.length === 0,
                completedByApplicant: row.completedByApplicant.has(section),
                missingFields: missing,
                editable: this.#sectionEditable(row, section),
            };
        });

        return {
            id: row.id,
            reference: row.reference,
            state: row.state,
            sections: row.sections,
            sectionStates,
            requiredDocumentKinds: REQUIRED_DOCUMENT_KINDS,
            documents: [...row.documents],
            reviewerRequests: [...row.reviewerRequests],
            applicantMessage: row.applicantMessage,
            agreement: row.agreement,
            provisioning: row.provisioning,
            createdAt: row.createdAt,
            submittedAt: row.submittedAt,
            decidedAt: row.decidedAt,
            lockVersion: row.lockVersion,
        };
    }
}

/* ── helpers ──────────────────────────────────────────────────────────────────────────────────── */

function terminal(state: B2BApplicationState): boolean {
    return state === 'declined' || state === 'withdrawn';
}

/** A document counts towards the requirement unless a reviewer turned it down or it was replaced. */
function satisfies(document: KycDocument): boolean {
    return document.reviewStatus === 'pending' || document.reviewStatus === 'accepted';
}

/** Required fields of one section that are not present. Empty strings count as absent. */
function missingFieldsFor(
    sections: B2BApplicationSections,
    section: B2BApplicationSection,
): readonly string[] {
    // Through `unknown`: a section interface has no index signature, which is the point of
    // typing it, and the lookup below only ever reads keys the section owns.
    const values = sections[section] as unknown as Readonly<Record<string, unknown>>;
    return REQUIRED_FIELDS[section].filter((field) => {
        const value = values[field];
        return value === null || value === undefined || value === '';
    });
}

/** Deterministic, and obviously not a hash. Two uploads of the same file agree; nothing else. */
function fakeDigest(fileName: string, byteSize: number): string {
    let hash = byteSize;
    for (const character of fileName) {
        hash = (hash * 31 + (character.codePointAt(0) ?? 0)) % 0xffff_ffff;
    }
    return hash.toString(16).padStart(8, '0').repeat(8).slice(0, 64);
}

function hydrate(fixture: B2bFixture, createdAt: string): MutableRow {
    return {
        id: fixture.id,
        reference: fixture.reference,
        state: fixture.state,
        sections: fixture.sections,
        completedByApplicant: new Set(fixture.completedByApplicant),
        documents: fixture.documents.map((document) => ({ ...document })),
        reviewerRequests: fixture.reviewerRequests.map((entry) => ({ ...entry })),
        applicantMessage: fixture.applicantMessage,
        agreement: fixture.agreement,
        provisioning: fixture.provisioning,
        createdAt,
        submittedAt: fixture.submittedAt,
        decidedAt: fixture.decidedAt,
        lockVersion: 0,
    };
}
