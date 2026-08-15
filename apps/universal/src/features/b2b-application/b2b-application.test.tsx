import type {
    B2BAgreement,
    B2BApplication,
    B2BApplicationSection,
    B2BApplicationSectionState,
    B2BApplicationSections,
    B2BApplicationState,
    B2BDocumentKind,
    KycDocument,
    ReviewerRequest,
} from '@healthy360/api-client/contracts';
import { fireEvent, screen, waitFor } from '@testing-library/react-native';
import type { ReactNode } from 'react';

import { testMeResponse } from '../../testing/session-fixtures.ts';
import { renderStubScreen } from '../../testing/stub-screen.tsx';
import { AgreementPanel } from './agreement-panel.tsx';
import { firstIncompleteStep, validateSection } from './sections.ts';
import { ApplyStepScreen } from './screens/apply-step-screen.tsx';
import { StatusPanel } from './status-panel.tsx';

/**
 * The B1 applicant journey, against a world this file authors.
 *
 * Coverage: the five things this wave exists to get right — per-section validation, the deep link
 * landing on the first *incomplete* step, document upload and removal against a vault that
 * supersedes, all eleven status states rendering distinctly, and a signature that cannot be produced
 * without both the authority confirmation and a step-up token.
 *
 * Screens run over `renderStubScreen`: the session is declared, and every repository answer the
 * screen is allowed to rely on is declared beside it. Anything the screen reaches for that this file
 * did not stub rejects by name rather than rendering an empty state over the hole.
 *
 * ## Where the "server" is in these tests
 *
 * The upload case is the one to read carefully. Supersede-on-replacement is the *server's* rule, and
 * this file no longer has a server — so what is asserted here is the client's half of it: that the
 * screen sends `replacesDocumentId` naming the row it is replacing, and that it draws the answer the
 * server gives back (a superseded attempt kept beside the file that replaced it) rather than a list
 * it maintains for itself. The authored answers stand in for the server; the assertions are all
 * about what the screen asked for and what it did with the reply.
 *
 * ## One convention, and why
 *
 * **Every `fireEvent` is awaited.** RNTL wraps each one in an `act` scope, and an unawaited scope
 * overlaps the next — at which point `IS_REACT_ACT_ENVIRONMENT` is left off and *no further state
 * update in the file commits*. It presents as "the tree stopped settling after the third mount",
 * which is not what it is: a typed field silently keeps its old value and a button stays disabled
 * forever. Awaiting is the whole fix.
 *
 * The wider matrix — lock-version conflicts on every write, the `info_requested` narrowing across
 * all four sections, withdrawal, download links, RTL and axe — is itemised as deferred in the wave
 * report.
 */

/**
 * The router, stubbed.
 *
 * `Redirect` records its destination and renders nothing. It deliberately does **not** build an
 * element: a `jest.mock` factory that references a React Native component gets NativeWind's babel
 * transform injected into it, and the factory may not reference anything out of its own scope —
 * which is a transform-time failure of the whole suite rather than a test that merely fails.
 * Recording the href answers the same question ("where did this send them?") with none of that.
 */
jest.mock('expo-router', () => {
    const push = jest.fn();
    const replace = jest.fn();
    const redirected = jest.fn();
    return {
        __esModule: true,
        useRouter: () => ({ push, replace, setParams: jest.fn(), back: jest.fn() }),
        usePathname: () => '/apply',
        useLocalSearchParams: () => ({}),
        Redirect: ({ href }: { href: string }) => {
            redirected(href);
            return null;
        },
        Link: ({ children }: { children: ReactNode }) => children,
        Slot: () => null,
        Stack: () => null,
        __push: push,
        __replace: replace,
        __redirected: redirected,
    };
});

/**
 * The file picker, stubbed.
 *
 * The vault's upload control is `expo-document-picker`, which has no native module under Node. The
 * stub is what lets the *screen* be driven — press the slot's control, and the file the person chose
 * arrives the way it would on the web.
 */
jest.mock('expo-document-picker', () => ({
    __esModule: true,
    getDocumentAsync: jest.fn(),
}));

// eslint-disable-next-line @typescript-eslint/no-require-imports
const routerMock = require('expo-router') as {
    __push: jest.Mock;
    __replace: jest.Mock;
    __redirected: jest.Mock;
};

// eslint-disable-next-line @typescript-eslint/no-require-imports
const pickerMock = require('expo-document-picker') as { getDocumentAsync: jest.Mock };

beforeEach(() => {
    routerMock.__push.mockClear();
    routerMock.__replace.mockClear();
    routerMock.__redirected.mockClear();
    pickerMock.getDocumentAsync.mockReset();
    globalThis.localStorage?.clear();
});

/* ══ the authored application ══════════════════════════════════════════════════════════════════ */

const APPLICATION_ID = 'test-0000-application-0001';

/**
 * The applicant: a registered person with **no** organisation.
 *
 * That is the whole premise of B1 — the corporate organisation is created by approval, not before
 * it — so the consumer session from the shared fixtures is the right one, and a membership here
 * would be describing a company that does not exist yet.
 */
const APPLICANT = testMeResponse();

/** The server's list, never a client constant. Two kinds, and the screen must ask for both. */
const REQUIRED_KINDS: readonly B2BDocumentKind[] = [
    'commercial_registration',
    'signatory_identification',
];

const SECTIONS: readonly B2BApplicationSection[] = [
    'company',
    'signatory',
    'trade_terms',
    'logistics',
];

/** Field names the server would report missing, per section. Names, never messages. */
const MISSING_FIELDS: Readonly<Record<B2BApplicationSection, readonly string[]>> = {
    company: ['legalName', 'countryCode', 'commercialRegistrationNumber'],
    signatory: ['signatoryName', 'signatoryTitle', 'signatoryEmail'],
    trade_terms: ['requestedPaymentTerms'],
    logistics: [],
};

/**
 * The server's per-section verdict.
 *
 * `complete` is the *server's* readiness answer and the wizard reads nothing else, so a test that
 * wants a half-finished application says so here rather than by leaving fields blank and hoping the
 * client agrees.
 */
function sectionStatesFor(
    complete: readonly B2BApplicationSection[],
    editable = true,
): readonly B2BApplicationSectionState[] {
    return SECTIONS.map((section) => ({
        section,
        complete: complete.includes(section),
        completedByApplicant: complete.includes(section),
        missingFields: complete.includes(section) ? [] : MISSING_FIELDS[section],
        editable,
    }));
}

function northwindSections(): B2BApplicationSections {
    return {
        company: {
            legalName: 'Northwind Catering Services LLC',
            legalNameAr: null,
            tradingName: 'Northwind Kitchens',
            businessType: 'catering',
            countryCode: 'AE',
            commercialRegistrationNumber: 'CR-1000-2201',
            taxRegistrationNumber: null,
            incorporatedOn: '2019-04-11',
            website: null,
        },
        signatory: {
            signatoryName: 'Layla Haddad',
            signatoryTitle: 'Managing Director',
            signatoryEmail: 'layla.haddad@northwind-catering.example',
            signatoryPhone: '+971500000101',
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

function testDocument(
    ordinal: number,
    kind: B2BDocumentKind,
    overrides: Partial<KycDocument> = {},
): KycDocument {
    return {
        id: `test-0000-document-000${String(ordinal)}`,
        kind,
        fileName: 'northwind-cr-2026.pdf',
        mimeType: 'application/pdf',
        byteSize: 248_310,
        sha256: String(ordinal).padStart(2, '0').repeat(32).slice(0, 64),
        uploadedAt: '2026-08-01T09:00:00.000Z',
        reviewStatus: 'pending',
        rejectionReason: null,
        expiresOn: null,
        purgeAfter: null,
        // No malware scanning exists (INT-008). The authored world says so rather than showing a
        // tick the platform has not earned.
        scanStatus: 'not_scanned',
        ...overrides,
    };
}

/** Company and signatory answered, trade terms and logistics not: what a person comes back to. */
function testApplication(overrides: Partial<B2BApplication> = {}): B2BApplication {
    return {
        id: APPLICATION_ID,
        reference: 'APP-2026-0001',
        state: 'draft',
        sections: northwindSections(),
        sectionStates: sectionStatesFor(['company', 'signatory']),
        requiredDocumentKinds: REQUIRED_KINDS,
        documents: [],
        reviewerRequests: [],
        applicantMessage: null,
        agreement: null,
        provisioning: null,
        createdAt: '2026-07-01T09:00:00.000Z',
        submittedAt: null,
        decidedAt: null,
        lockVersion: 0,
        ...overrides,
    };
}

/**
 * The wording a signatory accepts, verbatim.
 *
 * The honesty sentence is the second one and it is not decoration: click-wrap evidence is what this
 * is, and a person is told so before they type their name rather than in a footnote afterwards.
 */
const CONSENT_STATEMENT =
    'By typing my name below I confirm that I am authorised to enter into this agreement on behalf ' +
    'of the company named above, and that I accept its terms. I understand this is a record of my ' +
    'acceptance — it is not a qualified or certified electronic signature.';

function testAgreement(overrides: Partial<B2BAgreement> = {}): B2BAgreement {
    return {
        id: 'test-0000-agreement-0001',
        applicationId: APPLICATION_ID,
        version: 1,
        status: 'pending_signature',
        title: 'Master Supply Agreement — Northwind Catering Services LLC',
        documentText: 'SPECIMEN AGREEMENT — NOT A REAL CONTRACT.',
        documentSha256: 'a1'.repeat(32),
        terms: {
            paymentTerms: 'net_30',
            creditLimitMinor: 3_000_000,
            minimumOrderMinor: 50_000,
            currencyCode: 'USD',
            deliveryLeadTimeDays: 2,
            noticePeriodDays: 30,
            startsOn: '2026-09-01',
            endsOn: null,
            autoRenews: true,
        },
        termsSummary: null,
        consentStatement: CONSENT_STATEMENT,
        signature: null,
        supersedesAgreementId: null,
        lockVersion: 0,
        ...overrides,
    };
}

/* ══ pure decisions ════════════════════════════════════════════════════════════════════════════ */

describe('section validation', () => {
    it('names every missing required field at once rather than the first', () => {
        const result = validateSection('company', {
            legalName: '',
            legalNameAr: '',
            tradingName: '',
            businessType: null,
            countryCode: '',
            commercialRegistrationNumber: '',
            taxRegistrationNumber: '',
            incorporatedOn: '',
            website: '',
        });

        expect(result.ok).toBe(false);
        if (result.ok) return;
        expect(Object.keys(result.errors).sort()).toEqual([
            'commercialRegistrationNumber',
            'countryCode',
            'legalName',
        ]);
    });

    it('normalises an unanswered optional to null rather than to an empty string', () => {
        const result = validateSection('company', {
            legalName: 'Northwind Catering Services LLC',
            legalNameAr: '',
            tradingName: '  ',
            businessType: 'catering',
            countryCode: 'ae',
            commercialRegistrationNumber: 'CR-1',
            taxRegistrationNumber: '',
            incorporatedOn: '',
            website: '',
        });

        expect(result.ok).toBe(true);
        if (!result.ok) return;
        const value = result.value as Record<string, unknown>;
        expect(value['tradingName']).toBeNull();
        expect(value['website']).toBeNull();
        // Uppercased at the boundary: the server holds a foreign key, not a typed string.
        expect(value['countryCode']).toBe('AE');
    });

    it('refuses an address that is not an email and a number that is not E.164', () => {
        const result = validateSection('signatory', {
            signatoryName: 'Layla Haddad',
            signatoryTitle: 'Managing Director',
            signatoryEmail: 'layla at northwind',
            signatoryPhone: '0501234567',
        });

        expect(result.ok).toBe(false);
        if (result.ok) return;
        expect(result.errors['signatoryEmail']).toBe('email');
        expect(result.errors['signatoryPhone']).toBe('phone');
    });

    it('lands a deep link on the first incomplete step, not on the first step', () => {
        // Company and signatory are answered; trade terms is not. A person who filled those in
        // yesterday should arrive at what is left rather than at step one.
        const application = testApplication({
            sectionStates: sectionStatesFor(['company', 'signatory']),
            documents: [testDocument(1, 'commercial_registration')],
        });

        expect(firstIncompleteStep(application)).toBe('trade-terms');
    });
});

/* ══ screens ═══════════════════════════════════════════════════════════════════════════════════ */

describe('the wizard', () => {
    it('redirects a step to the status panel once the application has left the applicant', async () => {
        await renderStubScreen(<ApplyStepScreen step="company" />, {
            session: APPLICANT,
            repositories: {
                b2bApplication: {
                    getApplication: async () =>
                        testApplication({
                            state: 'in_review',
                            // Nothing is editable once a reviewer has it, and the server says so.
                            sectionStates: sectionStatesFor([...SECTIONS], false),
                            submittedAt: '2026-07-28T08:00:00.000Z',
                            lockVersion: 3,
                        }),
                },
            },
        });

        // The destination is assertable rather than merely "something navigated": an application
        // that has left the applicant must not show an editable form nobody will read.
        await waitFor(() => {
            expect(routerMock.__redirected).toHaveBeenCalledWith('/apply/status');
        });
    });

    it('uploads against a document slot, asks for a supersede, and removes', async () => {
        const held = testDocument(1, 'commercial_registration');
        const replacement = testDocument(2, 'commercial_registration', {
            fileName: 'clearer-scan.pdf',
        });
        const superseded: KycDocument = { ...held, reviewStatus: 'superseded' };

        /*
         * The server's three answers, authored. A replacement keeps the replaced row and marks it
         * `superseded` — a reviewer's decision trail has to survive a re-upload — and a removal
         * takes away only the live one. `requiredDocumentKinds` never moves, because it is a policy
         * rather than a consequence of what has been sent.
         */
        const draft = testApplication({
            sectionStates: sectionStatesFor([...SECTIONS]),
            documents: [held],
        });
        const replaced: B2BApplication = {
            ...draft,
            documents: [superseded, replacement],
            lockVersion: 1,
        };
        const removed: B2BApplication = { ...draft, documents: [superseded], lockVersion: 2 };

        let current = draft;
        pickerMock.getDocumentAsync.mockResolvedValue({
            canceled: false,
            assets: [
                {
                    name: 'clearer-scan.pdf',
                    mimeType: 'application/pdf',
                    size: 2048,
                    uri: 'file:///clearer-scan.pdf',
                    base64: 'AAAA',
                },
            ],
        });

        const { repositories } = await renderStubScreen(<ApplyStepScreen step="documents" />, {
            session: APPLICANT,
            repositories: {
                b2bApplication: {
                    getApplication: async () => current,
                    uploadDocument: async () => {
                        current = replaced;
                        return replaced;
                    },
                    removeDocument: async () => {
                        current = removed;
                        return removed;
                    },
                },
            },
        });

        await waitFor(() => {
            expect(screen.getByTestId('b2b-documents-commercial_registration')).toBeTruthy();
        });
        // One of the two required kinds is supplied, so one is outstanding.
        expect(screen.getByTestId('b2b-apply-step-documents-outstanding')).toHaveTextContent(
            /1 required document still to upload/u,
        );

        await fireEvent.press(
            screen.getByTestId('b2b-documents-commercial_registration-upload-choose'),
        );

        await waitFor(() => {
            expect(repositories.b2bApplication.uploadDocument).toHaveBeenCalledWith({
                applicationId: APPLICATION_ID,
                kind: 'commercial_registration',
                fileName: 'clearer-scan.pdf',
                mimeType: 'application/pdf',
                byteSize: 2048,
                content: 'AAAA',
                // Replace the row in this slot rather than adding beside it. Naming it is the
                // client's whole part in supersede-on-replacement.
                replacesDocumentId: held.id,
            });
        });

        // The replaced attempt is kept and shown beside the file that replaced it, not overwritten.
        await waitFor(() => {
            expect(
                screen.getByTestId(`b2b-documents-commercial_registration-history-${held.id}`),
            ).toHaveTextContent(/Replaced/u);
        });
        expect(
            screen.getByTestId('b2b-documents-commercial_registration-upload-attachment-name'),
        ).toHaveTextContent(/clearer-scan\.pdf/u);

        await fireEvent.press(
            screen.getByTestId('b2b-documents-commercial_registration-upload-remove'),
        );

        await waitFor(() => {
            expect(repositories.b2bApplication.removeDocument).toHaveBeenCalledWith({
                applicationId: APPLICATION_ID,
                documentId: replacement.id,
            });
        });

        // The requirement is the server's list, and it does not move when a file does: both slots
        // are still drawn, and both kinds are outstanding again.
        await waitFor(() => {
            expect(screen.getByTestId('b2b-apply-step-documents-outstanding')).toHaveTextContent(
                /2 required documents still to upload/u,
            );
        });
        expect(screen.getByTestId('b2b-documents-signatory_identification')).toBeTruthy();
    });
});

/* ══ the applicant's two panels ════════════════════════════════════════════════════════════════ */

const STATES: readonly B2BApplicationState[] = [
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
];

describe('the applicant panels', () => {
    it('draws every state distinctly', async () => {
        await renderStubScreen(
            <>
                {STATES.map((state) => (
                    <StatusPanel
                        key={state}
                        testID={`state-${state}`}
                        application={testApplication({ state })}
                    />
                ))}
            </>,
        );

        const bodies = new Set<string>();
        for (const state of STATES) {
            expect(screen.getByTestId(`state-${state}-badge`)).toBeTruthy();
            bodies.add(String(screen.getByTestId(`state-${state}-body`).props.children));
        }
        // Eleven distinct bodies: `approved` must not read as `agreement_pending`, and `declined`
        // must not read as `withdrawn`. A shared string here would be the panel's worst lie.
        expect(bodies.size).toBe(STATES.length);
    });

    it('links each reviewer request at the thing it is about', async () => {
        const aboutTerms: ReviewerRequest = {
            id: 'test-0000-request-0001',
            requestedAt: '2026-07-30T11:15:00.000Z',
            message:
                'The credit limit you asked for is higher than we normally open with at this ' +
                'volume. Could you confirm the expected monthly volume?',
            sections: ['trade_terms'],
            documentKinds: [],
            resolvedAt: null,
        };
        const aboutIdentity: ReviewerRequest = {
            id: 'test-0000-request-0002',
            requestedAt: '2026-07-30T11:18:00.000Z',
            message: 'The identity document did not open cleanly on our side.',
            sections: [],
            documentKinds: ['signatory_identification'],
            resolvedAt: null,
        };

        const opened: string[] = [];
        await renderStubScreen(
            <StatusPanel
                testID="requests"
                application={testApplication({
                    state: 'info_requested',
                    sectionStates: sectionStatesFor([...SECTIONS]),
                    reviewerRequests: [aboutTerms, aboutIdentity],
                    documents: [
                        testDocument(1, 'commercial_registration', { reviewStatus: 'accepted' }),
                        testDocument(2, 'signatory_identification', {
                            fileName: 'passport-scan.pdf',
                            reviewStatus: 'rejected',
                            rejectionReason: 'unreadable',
                        }),
                    ],
                })}
                onOpenStep={(slug) => {
                    opened.push(slug);
                }}
            />,
        );

        await fireEvent.press(
            screen.getByTestId(`requests-request-${aboutTerms.id}-section-trade_terms`),
        );
        await fireEvent.press(
            screen.getByTestId(
                `requests-request-${aboutIdentity.id}-document-signatory_identification`,
            ),
        );

        // One names a section and one names a document kind; each links at its own thing.
        expect(opened).toEqual(['trade-terms', 'documents']);
    });

    it('opens signing only after a step-up, and then carries all three claims', async () => {
        const withoutToken = jest.fn();
        const withToken = jest.fn();

        await renderStubScreen(
            <>
                <AgreementPanel
                    testID="open"
                    agreement={testAgreement()}
                    onRequestCode={jest.fn()}
                    onVerifyCode={jest.fn()}
                    onResendCode={jest.fn()}
                    onSign={withoutToken}
                />
                <AgreementPanel
                    testID="stepped"
                    agreement={testAgreement()}
                    verificationToken="verified-challenge-id"
                    onRequestCode={jest.fn()}
                    onVerifyCode={jest.fn()}
                    onResendCode={jest.fn()}
                    onSign={withToken}
                />
            </>,
        );

        // The honesty block sits above the controls, not as a footnote under them.
        expect(screen.getByTestId('open-honesty')).toHaveTextContent(
            /not a qualified or certified electronic signature/i,
        );
        expect(screen.getByTestId('open-consent-statement')).toHaveTextContent(
            /record of my acceptance/i,
        );
        expect(screen.getByTestId('open-verify-first')).toBeTruthy();

        // Everything typed and the authority ticked, but no code verified: still refused.
        await fireEvent.changeText(screen.getByTestId('open-typed-name-input'), 'Layla Haddad');
        await fireEvent.changeText(
            screen.getByTestId('open-signatory-title-input'),
            'Managing Director',
        );
        await fireEvent.press(screen.getByTestId('open-authority-control'));
        await fireEvent.press(screen.getByTestId('open-submit'));
        expect(withoutToken).not.toHaveBeenCalled();

        // The same three answers, with a verified code behind them.
        await fireEvent.changeText(screen.getByTestId('stepped-typed-name-input'), 'Layla Haddad');
        await fireEvent.changeText(
            screen.getByTestId('stepped-signatory-title-input'),
            'Managing Director',
        );
        await fireEvent.press(screen.getByTestId('stepped-authority-control'));
        await fireEvent.press(screen.getByTestId('stepped-submit'));

        // Three separate claims, and the acceptance carries all three.
        expect(withToken).toHaveBeenCalledWith({
            typedName: 'Layla Haddad',
            signatoryTitle: 'Managing Director',
            authorityConfirmed: true,
        });
    });
});
