import type {
    AgreementTerms,
    B2BAgreement,
    B2BApplicationSections,
    B2BApplicationState,
    B2BDocumentKind,
    KycDocument,
    ProvisioningProgress,
    ReviewerRequest,
} from '../../contracts/b2b-application.ts';
import {
    agreementIdAt,
    applicationIdAt,
    documentIdAt,
    organisationIdAt,
    reviewerRequestIdAt,
} from './ids.ts';

/**
 * Four applications, one per interesting state (appendix E §G.3).
 *
 * Not one per *state* — there are eleven and nine of them would be the same screen with a different
 * badge. These four are the ones where the panel has genuinely different work to do:
 *
 * 1. **`draft-half-complete`** — the wizard's real starting condition. Two sections answered, two
 *    not, one document uploaded of the two the server requires. It is what a person comes back to,
 *    and it is the state that proves the deep-link redirect lands on the first *incomplete* step
 *    rather than the first step.
 * 2. **`information-requested`** — two unresolved reviewer requests, one naming sections and one
 *    naming a document kind. The status panel's hardest job: two different asks, each linking
 *    somewhere different, in a state that is neither a rejection nor a wait.
 * 3. **`agreement-pending`** — approved, terms drafted, signature outstanding. The state
 *    `approved` on its own would hide.
 * 4. **`provisioned`** — the end. Every provisioning step done, an organisation that exists.
 *
 * Everything in them is invented. There is no real company here and no real registration number:
 * the trading names are obviously fictional and the registration numbers are sequential.
 */

/** The applicant every fixture belongs to. One person, one live application (the partial unique). */
export const SEED_APPLICANT_EMAIL = 'procurement@northwind-catering.example';

export const B2B_FIXTURE_NAMES = [
    'draft-half-complete',
    'information-requested',
    'agreement-pending',
    'provisioned',
] as const;
export type B2bFixtureName = (typeof B2B_FIXTURE_NAMES)[number];

/** A fixed instant, so a fixture's timestamps do not drift with the wall clock. */
export const B2B_SEED_NOW = '2026-08-01T09:00:00.000Z';

function emptySections(): B2BApplicationSections {
    return {
        company: {
            legalName: null,
            legalNameAr: null,
            tradingName: null,
            businessType: null,
            countryCode: null,
            commercialRegistrationNumber: null,
            taxRegistrationNumber: null,
            incorporatedOn: null,
            website: null,
        },
        signatory: {
            signatoryName: null,
            signatoryTitle: null,
            signatoryEmail: null,
            signatoryPhone: null,
        },
        trade_terms: {
            requestedPaymentTerms: null,
            requestedCreditLimitMinor: null,
            currencyCode: null,
            expectedVolumeBand: null,
            expectedOrderFrequency: null,
            productCategories: [],
        },
        logistics: {
            preferredDeliveryWindow: null,
            leadTimeDays: null,
            requiresInvoicePerLocation: false,
            deliveryNotes: null,
        },
    };
}

/** The blank application a person gets from `startApplication`. */
export function blankSections(): B2BApplicationSections {
    return emptySections();
}

function northwindCompany(): B2BApplicationSections['company'] {
    return {
        legalName: 'Northwind Catering Services LLC',
        legalNameAr: 'نورث ويند لخدمات التموين ذ.م.م',
        tradingName: 'Northwind Kitchens',
        businessType: 'catering',
        countryCode: 'AE',
        commercialRegistrationNumber: 'CR-1000-2201',
        taxRegistrationNumber: '100220133700003',
        incorporatedOn: '2019-04-11',
        website: 'https://northwind-catering.example',
    };
}

function northwindSignatory(): B2BApplicationSections['signatory'] {
    return {
        signatoryName: 'Layla Haddad',
        signatoryTitle: 'Managing Director',
        signatoryEmail: 'layla.haddad@northwind-catering.example',
        signatoryPhone: '+971500000101',
    };
}

function northwindTradeTerms(): B2BApplicationSections['trade_terms'] {
    return {
        requestedPaymentTerms: 'net_30',
        requestedCreditLimitMinor: 5_000_000,
        currencyCode: 'USD',
        expectedVolumeBand: 'from_200_to_500',
        expectedOrderFrequency: 'weekdays',
        productCategories: ['meals', 'bulk_catering'],
    };
}

function northwindLogistics(): B2BApplicationSections['logistics'] {
    return {
        preferredDeliveryWindow: 'early_morning',
        leadTimeDays: 2,
        requiresInvoicePerLocation: true,
        deliveryNotes: 'Loading bay is on the north side; security needs a name on the gate list.',
    };
}

function document(
    ordinal: number,
    kind: B2BDocumentKind,
    fileName: string,
    overrides: Partial<KycDocument> = {},
): KycDocument {
    return {
        id: documentIdAt(ordinal),
        kind,
        fileName,
        mimeType: 'application/pdf',
        byteSize: 248_310,
        // Deterministic and obviously not a real digest of anything — the mock never hashes bytes.
        sha256: `${String(ordinal).padStart(2, '0')}`.repeat(32).slice(0, 64),
        uploadedAt: B2B_SEED_NOW,
        reviewStatus: 'pending',
        rejectionReason: null,
        expiresOn: null,
        purgeAfter: null,
        // No malware scanning exists (INT-008). The fixture says so rather than showing a tick.
        scanStatus: 'not_scanned',
        ...overrides,
    };
}

const TERMS: AgreementTerms = {
    paymentTerms: 'net_30',
    creditLimitMinor: 3_000_000,
    minimumOrderMinor: 50_000,
    currencyCode: 'USD',
    deliveryLeadTimeDays: 2,
    noticePeriodDays: 30,
    startsOn: '2026-09-01',
    endsOn: null,
    autoRenews: true,
};

/**
 * The agreement text.
 *
 * Short, and deliberately not drafted to look like a real master services agreement: a fixture that
 * reads as genuine legal wording is a fixture somebody eventually ships. The clauses that matter for
 * the *screen* are here — terms, notice, price confidentiality — and the rest says what it is.
 */
const AGREEMENT_TEXT = [
    'MASTER SUPPLY AGREEMENT (SPECIMEN — NOT A REAL CONTRACT)',
    '',
    '1. Scope. The supplier will make catalogue items available to the buyer at the prices held in',
    '   the price list attached to this agreement.',
    '',
    '2. Payment. Invoices are payable within the term recorded above. No invoicing or payment',
    '   facility exists on the platform yet; the term is recorded, not enforced.',
    '',
    '3. Prices are confidential to this relationship and are not shown to any other buyer.',
    '',
    '4. Either party may end this agreement on the notice period recorded above.',
    '',
    '5. This specimen exists so the signing screen can be built and reviewed. It is not legal',
    '   advice and it is not a contract.',
].join('\n');

/** The digest of the exact bytes above, as the mock server would have computed it. */
export const AGREEMENT_DOCUMENT_SHA256 = 'a1'.repeat(32);

/**
 * The wording a signatory accepts, verbatim.
 *
 * The honesty sentence is the second one and it is not decoration: click-wrap evidence is what this
 * is, and a person is told so before they type their name rather than in a footnote afterwards.
 */
export const AGREEMENT_CONSENT_STATEMENT =
    'By typing my name below I confirm that I am authorised to enter into this agreement on behalf ' +
    'of the company named above, and that I accept its terms. I understand this is a record of my ' +
    'acceptance — it is not a qualified or certified electronic signature.';

function agreement(overrides: Partial<B2BAgreement> = {}): B2BAgreement {
    return {
        id: agreementIdAt(0),
        applicationId: applicationIdAt(2),
        version: 1,
        status: 'pending_signature',
        title: 'Master Supply Agreement — Northwind Catering Services LLC',
        documentText: AGREEMENT_TEXT,
        documentSha256: AGREEMENT_DOCUMENT_SHA256,
        terms: TERMS,
        termsSummary:
            'Net 30 payment, a 30,000.00 USD credit limit, a 500.00 USD minimum order, two days ' +
            'lead time and 30 days notice. Renews yearly unless either party gives notice.',
        consentStatement: AGREEMENT_CONSENT_STATEMENT,
        signature: null,
        supersedesAgreementId: null,
        lockVersion: 0,
        ...overrides,
    };
}

function provisioning(complete: boolean): ProvisioningProgress {
    return {
        steps: [
            { step: 'organisation', complete, blockedReason: null },
            { step: 'customer_account', complete, blockedReason: null },
            { step: 'commercial_terms', complete, blockedReason: null },
            { step: 'delivery_locations', complete, blockedReason: null },
            { step: 'team_invitations', complete, blockedReason: null },
        ],
        completedAt: complete ? B2B_SEED_NOW : null,
        organisationId: complete ? organisationIdAt(0) : null,
    };
}

/** One fixture, in the shape the store keeps its rows. */
export interface B2bFixture {
    readonly id: string;
    readonly reference: string;
    readonly state: B2BApplicationState;
    readonly sections: B2BApplicationSections;
    /** The applicant's own progress claim — never the readiness verdict. */
    readonly completedByApplicant: readonly string[];
    readonly documents: readonly KycDocument[];
    readonly reviewerRequests: readonly ReviewerRequest[];
    readonly applicantMessage: string | null;
    readonly agreement: B2BAgreement | null;
    readonly provisioning: ProvisioningProgress | null;
    readonly submittedAt: string | null;
    readonly decidedAt: string | null;
}

export const B2B_FIXTURES: Readonly<Record<B2bFixtureName, B2bFixture>> = {
    /** Two sections in, two to go, one of the two required documents supplied. */
    'draft-half-complete': {
        id: applicationIdAt(0),
        reference: 'APP-2026-0001',
        state: 'draft',
        sections: {
            ...emptySections(),
            company: northwindCompany(),
            signatory: northwindSignatory(),
        },
        completedByApplicant: ['company', 'signatory'],
        documents: [document(0, 'commercial_registration', 'northwind-cr-2026.pdf')],
        reviewerRequests: [],
        applicantMessage: null,
        agreement: null,
        provisioning: null,
        submittedAt: null,
        decidedAt: null,
    },

    /** Two unresolved asks: one about fields, one about a document. */
    'information-requested': {
        id: applicationIdAt(1),
        reference: 'APP-2026-0002',
        state: 'info_requested',
        sections: {
            company: northwindCompany(),
            signatory: northwindSignatory(),
            trade_terms: northwindTradeTerms(),
            logistics: northwindLogistics(),
        },
        completedByApplicant: ['company', 'signatory', 'trade_terms', 'logistics'],
        documents: [
            document(1, 'commercial_registration', 'northwind-cr-2026.pdf', {
                reviewStatus: 'accepted',
            }),
            document(2, 'signatory_identification', 'passport-scan.pdf', {
                reviewStatus: 'rejected',
                rejectionReason: 'unreadable',
            }),
        ],
        reviewerRequests: [
            {
                id: reviewerRequestIdAt(0),
                requestedAt: '2026-07-30T11:15:00.000Z',
                message:
                    'The credit limit you asked for is higher than we normally open with at this ' +
                    'volume. Could you confirm the expected monthly volume and the payment term ' +
                    'you need?',
                sections: ['trade_terms'],
                documentKinds: [],
                resolvedAt: null,
            },
            {
                id: reviewerRequestIdAt(1),
                requestedAt: '2026-07-30T11:18:00.000Z',
                message:
                    'The identity document did not open cleanly on our side. A clearer scan or a ' +
                    'photograph of the same page would do.',
                sections: [],
                documentKinds: ['signatory_identification'],
                resolvedAt: null,
            },
        ],
        applicantMessage: null,
        agreement: null,
        provisioning: null,
        submittedAt: '2026-07-28T08:00:00.000Z',
        decidedAt: null,
    },

    /** Approved, terms drafted, waiting on a signature that is the applicant's move to make. */
    'agreement-pending': {
        id: applicationIdAt(2),
        reference: 'APP-2026-0003',
        state: 'agreement_pending',
        sections: {
            company: northwindCompany(),
            signatory: northwindSignatory(),
            trade_terms: northwindTradeTerms(),
            logistics: northwindLogistics(),
        },
        completedByApplicant: ['company', 'signatory', 'trade_terms', 'logistics'],
        documents: [
            document(3, 'commercial_registration', 'northwind-cr-2026.pdf', {
                reviewStatus: 'accepted',
            }),
            document(4, 'signatory_identification', 'passport-scan.pdf', {
                reviewStatus: 'accepted',
            }),
        ],
        reviewerRequests: [],
        applicantMessage:
            'Approved on the strength of the registration and the volumes you gave us. The terms ' +
            'we can offer are in the agreement — the credit limit is lower than you asked for, ' +
            'and we can revisit it after six months of trading.',
        agreement: agreement(),
        provisioning: null,
        submittedAt: '2026-07-20T08:00:00.000Z',
        decidedAt: '2026-07-27T14:30:00.000Z',
    },

    /** Everything done. The buying surfaces exist from here. */
    provisioned: {
        id: applicationIdAt(3),
        reference: 'APP-2026-0004',
        state: 'provisioned',
        sections: {
            company: northwindCompany(),
            signatory: northwindSignatory(),
            trade_terms: northwindTradeTerms(),
            logistics: northwindLogistics(),
        },
        completedByApplicant: ['company', 'signatory', 'trade_terms', 'logistics'],
        documents: [
            document(5, 'commercial_registration', 'northwind-cr-2026.pdf', {
                reviewStatus: 'accepted',
            }),
            document(6, 'signatory_identification', 'passport-scan.pdf', {
                reviewStatus: 'accepted',
            }),
            document(7, 'signed_agreement', 'master-supply-agreement-v1.pdf', {
                reviewStatus: 'accepted',
            }),
        ],
        reviewerRequests: [],
        applicantMessage: 'Approved. Your account is open.',
        agreement: agreement({
            id: agreementIdAt(1),
            applicationId: applicationIdAt(3),
            status: 'active',
            signature: {
                kind: 'typed_name',
                typedName: 'Layla Haddad',
                signatoryTitle: 'Managing Director',
                consentStatement: AGREEMENT_CONSENT_STATEMENT,
                documentSha256: AGREEMENT_DOCUMENT_SHA256,
                signedAt: '2026-07-29T10:05:00.000Z',
                // True here because the mock's signing path genuinely verifies a token. The B1
                // backend answers false; that difference is stated in the store's header.
                otpVerified: true,
            },
            lockVersion: 1,
        }),
        provisioning: provisioning(true),
        submittedAt: '2026-07-10T08:00:00.000Z',
        decidedAt: '2026-07-18T14:30:00.000Z',
    },
};

/** The fixture a freshly built world hands back from `getApplication()`. */
export const DEFAULT_B2B_FIXTURE: B2bFixtureName = 'draft-half-complete';
