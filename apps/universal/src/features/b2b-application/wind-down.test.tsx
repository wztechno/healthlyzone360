import { ApiError, conflictFailure, validationFailure } from '@healthy360/api-client';
import type {
    B2BOffboarding,
    OffboardingSettlement,
    OffboardingSignoff,
    OtpChallenge,
    SettlementCheck,
} from '@healthy360/api-client/contracts';
import type { RoleId } from '@healthy360/domain-types';
import { fireEvent, screen, waitFor } from '@testing-library/react-native';

import {
    ORGANISATION_OWNER_PERMISSIONS,
    TEST_ORGANISATION_ID,
    testActiveContext,
    testMeResponse,
    testMembership,
} from '../../testing/session-fixtures.ts';
import type { RepositoryOverrides } from '../../testing/stub-repositories.ts';
import { renderStubScreen } from '../../testing/stub-screen.tsx';
import { WindDownScreen } from './screens/wind-down-screen.tsx';

/**
 * B2 — the corporate wind-down, as the buyer's screen draws it.
 *
 * The suite this replaced asked the fixture world's own state machine what it would do next. There
 * is no fixture world any more, and re-asserting values the test itself just authored would be a
 * tautology — so every case here is now stated against `WindDownScreen`: the timeline it draws from
 * a status, the controls it draws from the server's `allowedTransitions`, the settlement table's
 * refusal to flatten `not_applicable`, and the one irreversible thing a buyer does. The *intent* is
 * unchanged; what is asserted moved from the store's answer to the screen's behaviour over it.
 *
 * Two things this file authors that the fixture world used to own, and why they belong here now:
 *
 * - **`allowedTransitions`.** The screen draws its buttons from this and never from a second copy of
 *   the state machine. A test that authors it is exercising exactly that contract — including the
 *   case where the server offers nothing and the screen must offer nothing.
 * - **The consent wording and the notice digest.** A sign-off that cannot say *what* was agreed to
 *   is not evidence of anything, so both travel from the read into the write, and the assertion on
 *   `signOffOffboarding` is what proves the screen echoed back the notice it actually showed.
 */

const OFFBOARDING_ID = 'test-0000-offboarding-0001';

/** Server-authored wording. The screen shows it verbatim and the sign-off ties itself to it. */
const CONSENT_STATEMENT =
    'I confirm I am authorised to bind this company, that I have read the wind-down notice, and ' +
    'that I agree to end the commercial relationship on the effective date shown.';

/** The digest of the notice that was on screen. Echoed back on the write, never recomputed. */
const DOCUMENT_SHA256 = 'b2c9f1a4e7d0836512a4bd9e0c73f5a18d6e42b0c95713fa8d24e60b7c1f9a35';

/**
 * A corporate signatory, composed from the shared session material.
 *
 * The wind-down is read for an organisation, so the person holding the screen is a member of one —
 * an owner rather than a kitchen manager, because ending a commercial relationship is an
 * organisation-level act.
 */
const CORPORATE_SIGNATORY = testMeResponse({
    memberships: [
        testMembership({
            roles: [
                {
                    // Branded: an identifier is server-issued everywhere except here.
                    id: 'test-0000-role-0002' as RoleId,
                    key: 'organisation_owner',
                    name: 'Organisation owner',
                },
            ],
        }),
    ],
    activeContext: testActiveContext({ permissions: ORGANISATION_OWNER_PERMISSIONS }),
});

/* ══ authored world ════════════════════════════════════════════════════════════════════════════ */

/**
 * The four checks in the registry's order.
 *
 * Three of them answer `not_applicable` with the server's own reason, because there is no invoicing
 * module — that is the fact the table has to print rather than smooth into a pass.
 */
function settlementChecks(openOrders: 'clear' | 'outstanding'): readonly SettlementCheck[] {
    return [
        openOrders === 'outstanding'
            ? {
                  check: 'open_orders',
                  outcome: 'outstanding',
                  reason: null,
                  detail: '2 order(s) still in flight.',
              }
            : { check: 'open_orders', outcome: 'clear', reason: null, detail: null },
        {
            check: 'outstanding_invoices',
            outcome: 'not_applicable',
            reason: 'invoicing_module_absent',
            detail: null,
        },
        {
            check: 'credit_balance',
            outcome: 'not_applicable',
            reason: 'invoicing_module_absent',
            detail: null,
        },
        {
            check: 'security_deposit',
            outcome: 'not_applicable',
            reason: 'invoicing_module_absent',
            detail: null,
        },
    ];
}

const NOTHING_RUN: OffboardingSettlement = {
    status: 'pending',
    checks: [],
    startedAt: null,
    resolvedAt: null,
    waiverReason: null,
};

const CLEARED: OffboardingSettlement = {
    status: 'cleared',
    checks: settlementChecks('clear'),
    startedAt: '2026-08-02T09:00:00.000Z',
    resolvedAt: '2026-08-02T09:00:00.000Z',
    waiverReason: null,
};

const NOT_SIGNED: OffboardingSignoff = {
    awaitingSince: null,
    signedOffAt: null,
    signatoryName: null,
    signatoryTitle: null,
    consentStatement: null,
    documentSha256: null,
    otpVerified: false,
};

function testOffboarding(overrides: Partial<B2BOffboarding> = {}): B2BOffboarding {
    return {
        id: OFFBOARDING_ID,
        organisationId: TEST_ORGANISATION_ID,
        status: 'notice_served',
        trigger: 'non_renewal',
        reasonNote: 'The catering contract will not be renewed for the 2027 financial year.',
        effectiveOn: '2026-08-31',
        noticePeriodDays: 30,
        settlement: NOTHING_RUN,
        signoff: NOT_SIGNED,
        revocation: {
            startedAt: null,
            completedAt: null,
            membershipsRevoked: 0,
            tokensDeleted: 0,
        },
        archive: {
            startedAt: null,
            completedAt: null,
            legalEntityRetained: true,
            applicationContactsPurged: 0,
            applicationSignatoriesPurged: 0,
            kycDocumentsStampedForPurge: 0,
        },
        consentStatement: CONSENT_STATEMENT,
        documentSha256: DOCUMENT_SHA256,
        // The server's own table, so the screen draws controls without re-implementing the machine.
        allowedTransitions: ['settlement_pending', 'cancelled'],
        startedAt: '2026-08-01T09:00:00.000Z',
        cancelledAt: null,
        cancelledReason: null,
        lockVersion: 0,
        ...overrides,
    };
}

/** The one state a buyer can sign from: the checks ran and nothing is outstanding. */
function awaitingSignoff(overrides: Partial<B2BOffboarding> = {}): B2BOffboarding {
    return testOffboarding({
        status: 'awaiting_signoff',
        settlement: CLEARED,
        signoff: { ...NOT_SIGNED, awaitingSince: '2026-08-02T09:00:00.000Z' },
        allowedTransitions: ['signed_off', 'cancelled'],
        lockVersion: 1,
        ...overrides,
    });
}

function signoffChallenge(overrides: Partial<OtpChallenge> = {}): OtpChallenge {
    return {
        id: 'test-0000-challenge-0001',
        purpose: 'b2b_signatory',
        channel: 'email',
        // Server-authored, and sent to the agreement's signatory rather than to whoever is holding
        // the screen. The panel never masks anything itself.
        maskedDestination: 'd•••@northwind-catering.example',
        codeLength: 6,
        // Relative to the real clock: a challenge that has already expired closes the panel's entry,
        // which is correct behaviour and would make every case here the expired one.
        expiresAt: new Date(Date.now() + 300_000).toISOString(),
        resendCooldownSeconds: 0,
        attemptsRemaining: 3,
        resendsRemaining: 3,
        availableChannels: ['email'],
        simulatedChannels: [],
        ...overrides,
    };
}

type B2BOverrides = NonNullable<RepositoryOverrides['b2bApplication']>;

async function renderWindDown(b2bApplication: B2BOverrides) {
    return renderStubScreen(<WindDownScreen organisationId={TEST_ORGANISATION_ID} />, {
        session: CORPORATE_SIGNATORY,
        repositories: { b2bApplication },
    });
}

/* ══ the timeline ══════════════════════════════════════════════════════════════════════════════ */

describe('the wind-down is a timeline, not a badge', () => {
    it('places the notice on the timeline and offers only the transition the server allows', async () => {
        const { repositories } = await renderWindDown({
            getOffboarding: async () => testOffboarding(),
        });

        await waitFor(() => {
            expect(screen.getByTestId('wind-down-summary')).toBeTruthy();
        });
        expect(repositories.b2bApplication.getOffboarding).toHaveBeenCalledWith({
            organisationId: TEST_ORGANISATION_ID,
        });

        expect(screen.getByTestId('wind-down-status')).toHaveTextContent(/Notice served/u);
        expect(screen.getByTestId('wind-down-effective')).toHaveTextContent(/relationship ends on/);
        expect(screen.getByTestId('wind-down-effective')).toHaveTextContent(/2026/);
        expect(screen.getByTestId('wind-down-notice')).toHaveTextContent(/30 days/u);

        // Somebody whose company is winding down needs to see how far this has got, not a badge.
        expect(screen.getByTestId('wind-down-timeline-requested')).toHaveTextContent(/Done/u);
        expect(screen.getByTestId('wind-down-timeline-notice_served')).toHaveTextContent(/Now/u);
        expect(screen.getByTestId('wind-down-timeline-signed_off')).toHaveTextContent(/Ahead/u);

        // `settlement_pending` is legal from here, so the control that asks for it exists — and
        // signing is not, so nothing offers it.
        expect(screen.getByTestId('wind-down-run-checks')).toBeTruthy();
        expect(screen.queryByTestId('wind-down-signoff')).toBeNull();
    });

    it('draws no control for a transition the server did not publish', async () => {
        await renderWindDown({
            getOffboarding: async () =>
                testOffboarding({
                    status: 'revoking',
                    settlement: CLEARED,
                    signoff: {
                        ...NOT_SIGNED,
                        awaitingSince: '2026-08-02T09:00:00.000Z',
                        signedOffAt: '2026-08-03T10:00:00.000Z',
                        signatoryName: 'Dana Haddad',
                        signatoryTitle: 'Finance Director',
                        consentStatement: CONSENT_STATEMENT,
                        documentSha256: DOCUMENT_SHA256,
                        otpVerified: true,
                    },
                    // Past revocation there is no cancel: access is already gone.
                    allowedTransitions: ['archiving'],
                    lockVersion: 3,
                }),
        });

        await waitFor(() => {
            expect(screen.getByTestId('wind-down-read-only')).toBeTruthy();
        });
        expect(screen.queryByTestId('wind-down-run-checks')).toBeNull();
        expect(screen.queryByTestId('wind-down-signoff')).toBeNull();
        expect(screen.getByTestId('wind-down-read-only')).toHaveTextContent(
            /Access is being revoked/,
        );
    });

    it('answers a company that is not winding down with an empty state, not an error', async () => {
        await renderWindDown({ getOffboarding: async () => null });

        await waitFor(() => {
            expect(screen.getByTestId('wind-down-empty')).toBeTruthy();
        });
        expect(screen.getByTestId('wind-down-empty')).toHaveTextContent(/Nothing is winding down/);
    });

    it('shows revocation and archiving happening without ever offering to cause them', async () => {
        const { repositories } = await renderWindDown({
            getOffboarding: async () => testOffboarding(),
        });

        await waitFor(() => {
            expect(screen.getByTestId('wind-down-timeline')).toBeTruthy();
        });

        // Nothing has been revoked and nothing archived, and the timeline says so by placing both
        // ahead of where this is — rather than by omitting them, which would hide what comes next.
        expect(screen.getByTestId('wind-down-timeline-revoking')).toHaveTextContent(/Ahead/u);
        expect(screen.getByTestId('wind-down-timeline-archiving')).toHaveTextContent(/Ahead/u);

        // Said out loud: people are purged, the legal entity is kept, and none of it happens here.
        expect(screen.getByTestId('wind-down-platform-note')).toHaveTextContent(
            /legal entity is retained/i,
        );
        expect(repositories.b2bApplication.signOffOffboarding).not.toHaveBeenCalled();
    });
});

/* ══ the settlement ════════════════════════════════════════════════════════════════════════════ */

describe('the settlement checks do not flatten not_applicable', () => {
    it('runs the four checks in the registry order and opens the sign-off when clear', async () => {
        let current = testOffboarding();
        const { repositories } = await renderWindDown({
            getOffboarding: async () => current,
            runSettlementChecks: async () => {
                current = awaitingSignoff();
                return current;
            },
        });

        await waitFor(() => {
            expect(screen.getByTestId('wind-down-run-checks')).toBeTruthy();
        });
        // Nothing has run yet, and the table says that rather than drawing four empty rows.
        expect(screen.getByTestId('wind-down-settlement-empty')).toBeTruthy();

        await fireEvent.press(screen.getByTestId('wind-down-run-checks'));

        await waitFor(() => {
            expect(screen.getByTestId('wind-down-signoff')).toBeTruthy();
        });
        expect(repositories.b2bApplication.runSettlementChecks).toHaveBeenCalledWith({
            offboardingId: OFFBOARDING_ID,
            lockVersion: 0,
        });

        // The registry's order, drawn in the registry's order.
        expect(
            screen.getAllByTestId(/^wind-down-check-/u).map((badge) => String(badge.props.testID)),
        ).toEqual([
            'wind-down-check-open_orders',
            'wind-down-check-outstanding_invoices',
            'wind-down-check-credit_balance',
            'wind-down-check-security_deposit',
        ]);
        expect(screen.getByTestId('wind-down-settlement-status')).toHaveTextContent(/Cleared/u);
    });

    it('says three checks did not run rather than printing a tick beside them', async () => {
        await renderWindDown({ getOffboarding: async () => awaitingSignoff() });

        await waitFor(() => {
            expect(screen.getByTestId('wind-down-settlement-table')).toBeTruthy();
        });

        // The one real check. There are no orders in this world, so it is genuinely clear.
        expect(screen.getByTestId('wind-down-check-open_orders')).toHaveTextContent(/Clear/u);

        for (const check of ['outstanding_invoices', 'credit_balance', 'security_deposit']) {
            expect(screen.getByTestId(`wind-down-check-${check}`)).toHaveTextContent(
                /Not checked/u,
            );
        }
        // A reason is required on `not_applicable`, and the table prints it, so a neutral badge
        // cannot read as a pass.
        expect(screen.getAllByText(/This is not a pass\./u)).toHaveLength(3);
    });

    it('reports a stale lock version rather than overwriting another tab', async () => {
        const { repositories } = await renderWindDown({
            getOffboarding: async () => testOffboarding({ lockVersion: 3 }),
            runSettlementChecks: async () => {
                throw new ApiError(conflictFailure({ currentLockVersion: 4 }));
            },
        });

        await waitFor(() => {
            expect(screen.getByTestId('wind-down-run-checks')).toBeTruthy();
        });
        await fireEvent.press(screen.getByTestId('wind-down-run-checks'));

        await waitFor(() => {
            expect(screen.getByTestId('wind-down-error')).toBeTruthy();
        });
        // The version the screen was holding went out with the write — that is what makes the
        // server able to refuse it.
        expect(repositories.b2bApplication.runSettlementChecks).toHaveBeenCalledWith({
            offboardingId: OFFBOARDING_ID,
            lockVersion: 3,
        });
        expect(screen.getByTestId('wind-down-error')).toHaveTextContent(
            /Somebody else changed this/,
        );
        // And the refused run did not leave a settlement table that implies it happened.
        expect(screen.getByTestId('wind-down-settlement-empty')).toBeTruthy();
    });
});

/* ══ the sign-off ══════════════════════════════════════════════════════════════════════════════ */

describe('the signatory sign-off', () => {
    it('offers no way to ask for a code before the settlement clears', async () => {
        const { repositories } = await renderWindDown({
            getOffboarding: async () => testOffboarding(),
        });

        await waitFor(() => {
            expect(screen.getByTestId('wind-down-read-only')).toBeTruthy();
        });
        // Still `notice_served`. A code issued now is a code that expires unused, so the panel that
        // would ask for one does not exist.
        expect(screen.queryByTestId('wind-down-signoff')).toBeNull();
        expect(screen.queryByTestId('wind-down-request-code')).toBeNull();
        expect(screen.getByTestId('wind-down-read-only')).toHaveTextContent(
            /Run the settlement checks when you are ready/,
        );
        expect(repositories.b2bApplication.issueSignoffChallenge).not.toHaveBeenCalled();
    });

    it('sends the code only once all three claims have been made', async () => {
        const challenge = signoffChallenge();
        const { repositories } = await renderWindDown({
            getOffboarding: async () => awaitingSignoff(),
            issueSignoffChallenge: async () => challenge,
        });

        await waitFor(() => {
            expect(screen.getByTestId('wind-down-signoff')).toBeTruthy();
        });
        // The wording the signature ties itself to, above the controls rather than under them.
        expect(screen.getByTestId('wind-down-consent')).toHaveTextContent(
            /authorised to bind this company/,
        );

        expect(screen.getByTestId('wind-down-request-code').props.accessibilityState.disabled).toBe(
            true,
        );

        await fireEvent.changeText(screen.getByTestId('wind-down-name-input'), 'Dana Haddad');
        await fireEvent.changeText(screen.getByTestId('wind-down-role-input'), 'Finance Director');
        // "This is my name" and "I may bind this company" are two claims; the second is still
        // unmade, so the control is still closed.
        expect(screen.getByTestId('wind-down-request-code').props.accessibilityState.disabled).toBe(
            true,
        );

        await fireEvent.press(screen.getByTestId('wind-down-authority-control'));
        await fireEvent.press(screen.getByTestId('wind-down-request-code'));

        await waitFor(() => {
            expect(repositories.b2bApplication.issueSignoffChallenge).toHaveBeenCalledWith({
                offboardingId: OFFBOARDING_ID,
            });
        });
        // Server-authored, and not whoever is holding the screen.
        await waitFor(() => {
            expect(screen.getByTestId('wind-down-otp-destination')).toHaveTextContent(
                /d•••@northwind-catering\.example/u,
            );
        });
    });

    it('records the sign-off with the evidence, and the digest that was read', async () => {
        const challenge = signoffChallenge();
        const signed = testOffboarding({
            status: 'signed_off',
            settlement: CLEARED,
            signoff: {
                awaitingSince: '2026-08-02T09:00:00.000Z',
                signedOffAt: '2026-08-03T10:00:00.000Z',
                signatoryName: 'Dana Haddad',
                signatoryTitle: 'Finance Director',
                consentStatement: CONSENT_STATEMENT,
                documentSha256: DOCUMENT_SHA256,
                otpVerified: true,
            },
            // Past sign-off the buyer has nothing left to do: revocation is the platform's.
            allowedTransitions: ['revoking', 'cancelled'],
            lockVersion: 2,
        });

        let current = awaitingSignoff();
        const { repositories } = await renderWindDown({
            getOffboarding: async () => current,
            issueSignoffChallenge: async () => challenge,
            signOffOffboarding: async () => {
                current = signed;
                return signed;
            },
        });

        await waitFor(() => {
            expect(screen.getByTestId('wind-down-signoff')).toBeTruthy();
        });
        await fireEvent.changeText(screen.getByTestId('wind-down-name-input'), 'Dana Haddad');
        await fireEvent.changeText(screen.getByTestId('wind-down-role-input'), 'Finance Director');
        await fireEvent.press(screen.getByTestId('wind-down-authority-control'));
        await fireEvent.press(screen.getByTestId('wind-down-request-code'));

        await waitFor(() => {
            expect(screen.getByTestId('wind-down-otp-code-input')).toBeTruthy();
        });
        await fireEvent.changeText(screen.getByTestId('wind-down-otp-code-input'), '123456');
        await fireEvent.press(screen.getByTestId('wind-down-otp-submit'));

        await waitFor(() => {
            expect(repositories.b2bApplication.signOffOffboarding).toHaveBeenCalledWith({
                offboardingId: OFFBOARDING_ID,
                typedName: 'Dana Haddad',
                signatoryTitle: 'Finance Director',
                authorityConfirmed: true,
                // Echoed back from the notice that was on screen: a signature that cannot say what
                // was agreed to is not evidence of anything.
                documentSha256: DOCUMENT_SHA256,
                // `challengeId:code` — the panel hands back digits and stays ignorant of what a
                // signature needs; the screen pairs them.
                verificationToken: `${challenge.id}:123456`,
                lockVersion: 1,
            });
        });

        await waitFor(() => {
            expect(screen.getByTestId('wind-down-signed')).toHaveTextContent(/Dana Haddad/);
        });
        expect(screen.getByTestId('wind-down-signed')).toHaveTextContent(/Finance Director/);
        // Past sign-off there is nothing left for the buyer to press.
        expect(screen.queryByTestId('wind-down-signoff')).toBeNull();
        expect(screen.getByTestId('wind-down-read-only')).toHaveTextContent(/You have signed off/);
    });

    it('refuses a short code outright and reports a notice that changed underneath', async () => {
        const challenge = signoffChallenge();
        const { repositories } = await renderWindDown({
            getOffboarding: async () => awaitingSignoff(),
            issueSignoffChallenge: async () => challenge,
            signOffOffboarding: async () => {
                throw new ApiError(
                    validationFailure(
                        {
                            documentSha256: [
                                'The notice changed since you read it. Reload and re-read.',
                            ],
                        },
                        { message: 'The notice changed since you read it.' },
                    ),
                );
            },
        });

        await waitFor(() => {
            expect(screen.getByTestId('wind-down-signoff')).toBeTruthy();
        });
        await fireEvent.changeText(screen.getByTestId('wind-down-name-input'), 'Dana Haddad');
        await fireEvent.changeText(screen.getByTestId('wind-down-role-input'), 'Finance Director');
        await fireEvent.press(screen.getByTestId('wind-down-authority-control'));
        await fireEvent.press(screen.getByTestId('wind-down-request-code'));

        await waitFor(() => {
            expect(screen.getByTestId('wind-down-otp-code-input')).toBeTruthy();
        });

        // Half a code is not a code: the panel refuses to spend an attempt on it.
        await fireEvent.changeText(screen.getByTestId('wind-down-otp-code-input'), '123');
        expect(screen.getByTestId('wind-down-otp-submit').props.accessibilityState.disabled).toBe(
            true,
        );
        await fireEvent.press(screen.getByTestId('wind-down-otp-submit'));
        expect(repositories.b2bApplication.signOffOffboarding).not.toHaveBeenCalled();

        // A notice that changed under somebody is refused rather than silently signed, and the
        // screen says which refusal it was instead of swallowing it.
        await fireEvent.changeText(screen.getByTestId('wind-down-otp-code-input'), '123456');
        await fireEvent.press(screen.getByTestId('wind-down-otp-submit'));

        await waitFor(() => {
            expect(screen.getByTestId('wind-down-error')).toHaveTextContent(/notice changed/);
        });
        expect(screen.queryByTestId('wind-down-signed')).toBeNull();
    });
});
