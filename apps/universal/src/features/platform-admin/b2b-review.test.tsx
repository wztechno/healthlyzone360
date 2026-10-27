import type {
    B2BAgreement,
    PlatformB2bApplication,
    PlatformB2bApplicationSummary,
} from '@healthy360/api-client/contracts';
import { fireEvent, screen, waitFor } from '@testing-library/react-native';
import type { ReactNode } from 'react';

import {
    PLATFORM_ADMINISTRATOR_PERMISSIONS,
    PLATFORM_B2B_REVIEWER_PERMISSIONS,
    testActiveContext,
    testMeResponse,
    testMembership,
} from '../../testing/session-fixtures.ts';
import { renderStubScreen } from '../../testing/stub-screen.tsx';
import { nextReviewStep, reviewStage } from './b2b-review.ts';
import { PlatformB2bApplicationScreen } from './screens/b2b-application-screen.tsx';
import { PlatformB2bApplicationsScreen } from './screens/b2b-applications-screen.tsx';

/**
 * The reviewer's console over stub repositories.
 *
 * `nextReviewStep` is the table the screen draws its one action from, so it is asserted directly;
 * the screen tests then check each state offers that action, gated on the permission its route
 * demands, and sends the version on screen. Every `fireEvent` is awaited (see
 * `b2b-application.test.tsx` for why).
 */

jest.mock('expo-router', () => {
    const push = jest.fn();
    return {
        __esModule: true,
        useRouter: () => ({ push, replace: jest.fn(), setParams: jest.fn(), back: jest.fn() }),
        usePathname: () => '/platform-admin/b2b',
        useLocalSearchParams: () => ({ application: 'app-1' }),
        Redirect: () => null,
        Link: ({ children }: { children: ReactNode }) => children,
        Slot: () => null,
        __push: push,
    };
});

// eslint-disable-next-line @typescript-eslint/no-require-imports
const routerMock = require('expo-router') as { __push: jest.Mock };

beforeEach(() => {
    routerMock.__push.mockClear();
});

function session(permissions: readonly string[] = PLATFORM_B2B_REVIEWER_PERMISSIONS) {
    return testMeResponse({
        memberships: [testMembership()],
        activeContext: testActiveContext({ permissions }),
    });
}

const SUMMARY: PlatformB2bApplicationSummary = {
    id: 'app-1',
    reference: 'B2B-2026-000009',
    status: 'in_review',
    legalName: 'Cedars Catering SAL',
    tradingName: null,
    countryCode: 'LB',
    submittedAt: '2026-10-20T09:00:00Z',
    decidedAt: null,
    reviewedBy: 'reviewer-1',
    lockVersion: 4,
};

function application(overrides: Partial<PlatformB2bApplication> = {}): PlatformB2bApplication {
    return {
        ...SUMMARY,
        sections: {
            company: {
                legalName: 'Cedars Catering SAL',
                legalNameAr: null,
                tradingName: null,
                businessType: 'catering',
                countryCode: 'LB',
                commercialRegistrationNumber: 'CR-1',
                taxRegistrationNumber: null,
                incorporatedOn: null,
                website: null,
            },
            signatory: {
                signatoryName: 'Nadia Haddad',
                signatoryTitle: 'Director',
                signatoryEmail: 'nadia@cedars.test',
                signatoryPhone: null,
            },
            trade_terms: {
                requestedPaymentTerms: 'net_30',
                requestedCreditLimitMinor: null,
                currencyCode: 'USD',
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
        },
        completedSections: ['company', 'signatory', 'trade_terms', 'logistics'],
        contacts: [
            {
                role: 'billing',
                name: 'Rami',
                title: null,
                email: 'accounts@cedars.test',
                phone: null,
                notes: null,
            },
        ],
        locations: [],
        documents: [],
        missingDocumentKinds: ['signatory_identification'],
        duplicateApplications: [],
        informationRequest: null,
        informationRequestedSections: [],
        applicantMessage: null,
        decisionNote: null,
        provisionedOrganisationId: null,
        createdAt: '2026-10-20T08:00:00Z',
        ...overrides,
    };
}

function agreement(overrides: Partial<B2BAgreement> = {}): B2BAgreement {
    return {
        id: 'agr-1',
        applicationId: 'app-1',
        version: 1,
        status: 'draft',
        title: 'Supply agreement',
        priceListId: 'list-1',
        seller: {
            organisationId: 'kitchen-1',
            organisationName: 'Verdant Kitchen',
            priceListNameEn: 'Cedars negotiated',
            priceListNameAr: null,
        },
        documentText: '',
        documentSha256: 'a'.repeat(64),
        terms: {
            paymentTerms: 'net_30',
            creditLimitMinor: null,
            minimumOrderMinor: null,
            currencyCode: 'USD',
            deliveryLeadTimeDays: null,
            noticePeriodDays: null,
            startsOn: null,
            endsOn: null,
            autoRenews: false,
        },
        termsSummary: null,
        consentStatement: '',
        signature: null,
        supersedesAgreementId: null,
        lockVersion: 2,
        ...overrides,
    };
}

describe('nextReviewStep', () => {
    it('walks the owner-ruled order: claim, decide, draft, send, wait, provision', () => {
        expect(nextReviewStep(application({ status: 'submitted' }), []).kind).toBe('claim');
        expect(nextReviewStep(application(), []).kind).toBe('decide');
        expect(nextReviewStep(application({ status: 'info_requested' }), []).kind).toBe(
            'waiting_applicant',
        );
        expect(nextReviewStep(application({ status: 'approved' }), []).kind).toBe(
            'draft_agreement',
        );
        expect(nextReviewStep(application({ status: 'approved' }), [agreement()]).kind).toBe(
            'send_agreement',
        );
        expect(
            nextReviewStep(application({ status: 'approved' }), [
                agreement({ status: 'pending_signature' }),
            ]).kind,
        ).toBe('waiting_signature');
        expect(
            nextReviewStep(application({ status: 'approved' }), [agreement({ status: 'active' })])
                .kind,
        ).toBe('provision');
        expect(
            nextReviewStep(
                application({ status: 'approved', provisionedOrganisationId: 'org-1' }),
                [],
            ).kind,
        ).toBe('provisioned');
        expect(nextReviewStep(application({ status: 'declined' }), []).kind).toBe('closed');
        expect(reviewStage(application({ status: 'withdrawn' }), [])).toBeNull();
    });

    it('ignores a terminated version when a revision is the live draft', () => {
        const step = nextReviewStep(application({ status: 'approved' }), [
            agreement({ id: 'agr-1', status: 'terminated' }),
            agreement({ id: 'agr-2', version: 2, status: 'draft' }),
        ]);

        expect(step.kind).toBe('send_agreement');
    });
});

describe('the queue', () => {
    it('lists submitted applications first and opens one', async () => {
        const { repositories } = await renderStubScreen(<PlatformB2bApplicationsScreen />, {
            session: session(),
            repositories: {
                platformB2b: {
                    listApplications: async () => ({
                        items: [{ ...SUMMARY, status: 'submitted', reviewedBy: null }],
                        nextCursor: null,
                        hasMore: false,
                        totalCount: null,
                    }),
                },
            },
        });

        expect(await screen.findByText('Cedars Catering SAL')).toBeTruthy();
        expect(repositories.platformB2b.listApplications).toHaveBeenCalledWith(
            expect.objectContaining({ status: 'submitted' }),
        );

        await fireEvent.press(screen.getByTestId('platform-b2b-application-app-1-open'));
        expect(routerMock.__push).toHaveBeenCalledWith('/platform-admin/b2b/app-1');
    });

    it('refuses an operator without the B2B view permission', async () => {
        await renderStubScreen(<PlatformB2bApplicationsScreen />, {
            session: session(PLATFORM_ADMINISTRATOR_PERMISSIONS),
        });

        expect(screen.queryByTestId('platform-b2b-applications-screen')).toBeNull();
    });
});

describe('the application', () => {
    it('offers the decision, warns about unaccepted documents, and approves at the version on screen', async () => {
        const { repositories } = await renderStubScreen(<PlatformB2bApplicationScreen />, {
            session: session(),
            repositories: {
                platformB2b: {
                    getApplication: async () => application(),
                    listAgreements: async () => [],
                    approve: async () => undefined,
                },
            },
        });

        await fireEvent.press(await screen.findByTestId('platform-b2b-approve'));
        expect(screen.getByTestId('platform-b2b-approve-documents-warning')).toBeTruthy();

        await fireEvent.press(screen.getByTestId('platform-b2b-approve-confirm'));

        await waitFor(() => {
            expect(repositories.platformB2b.approve).toHaveBeenCalledWith({
                applicationId: 'app-1',
                lockVersion: 4,
            });
        });
        expect(screen.getByTestId('platform-b2b-request-information')).toBeTruthy();
        expect(screen.getByTestId('platform-b2b-decline')).toBeTruthy();
    });

    it('hides the decision from a reviewer who may only work the queue', async () => {
        await renderStubScreen(<PlatformB2bApplicationScreen />, {
            session: session([
                ...PLATFORM_ADMINISTRATOR_PERMISSIONS,
                'b2b_application.view_platform',
                'b2b_application.review_platform',
            ]),
            repositories: {
                platformB2b: {
                    getApplication: async () => application(),
                    listAgreements: async () => [],
                },
            },
        });

        expect(await screen.findByTestId('platform-b2b-request-information')).toBeTruthy();
        expect(screen.queryByTestId('platform-b2b-approve')).toBeNull();
        expect(screen.queryByTestId('platform-b2b-decline')).toBeNull();
    });

    it('sends a drafted agreement at its own version', async () => {
        const { repositories } = await renderStubScreen(<PlatformB2bApplicationScreen />, {
            session: session(),
            repositories: {
                platformB2b: {
                    getApplication: async () => application({ status: 'approved' }),
                    listAgreements: async () => [agreement()],
                    sendAgreement: async () =>
                        agreement({ status: 'pending_signature', lockVersion: 3 }),
                },
            },
        });

        expect(await screen.findByText('Verdant Kitchen — Cedars negotiated')).toBeTruthy();

        await fireEvent.press(screen.getByTestId('platform-b2b-send-agreement'));
        await fireEvent.press(screen.getByTestId('platform-b2b-send-dialog-confirm'));

        await waitFor(() => {
            expect(repositories.platformB2b.sendAgreement).toHaveBeenCalledWith({
                agreementId: 'agr-1',
                lockVersion: 2,
            });
        });
    });

    it('provisions only once the agreement is signed', async () => {
        const { repositories } = await renderStubScreen(<PlatformB2bApplicationScreen />, {
            session: session(),
            repositories: {
                platformB2b: {
                    getApplication: async () => application({ status: 'approved' }),
                    listAgreements: async () => [agreement({ status: 'active' })],
                    provision: async () => ({
                        organisationId: 'org-1',
                        organisationName: 'Cedars Catering SAL',
                        invitationsIssued: 1,
                        ownerMembershipCreated: true,
                    }),
                },
            },
        });

        await fireEvent.press(await screen.findByTestId('platform-b2b-provision'));
        expect(screen.getByTestId('platform-b2b-provision-consequences')).toBeTruthy();

        await fireEvent.press(screen.getByTestId('platform-b2b-provision-dialog-confirm'));

        await waitFor(() => {
            expect(repositories.platformB2b.provision).toHaveBeenCalledWith('app-1');
        });
    });

    it('offers no provisioning while the agreement waits for a signature', async () => {
        await renderStubScreen(<PlatformB2bApplicationScreen />, {
            session: session(),
            repositories: {
                platformB2b: {
                    getApplication: async () => application({ status: 'approved' }),
                    listAgreements: async () => [agreement({ status: 'pending_signature' })],
                },
            },
        });

        expect(await screen.findByTestId('platform-b2b-revise-agreement')).toBeTruthy();
        expect(screen.queryByTestId('platform-b2b-provision')).toBeNull();
    });
});
