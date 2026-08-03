import {
    MOCK_OTP_CODE,
    OFFBOARDING_DOCUMENT_SHA256,
    OFFBOARDING_ORGANISATION_ID,
    createMockRepositories,
} from '@healthy360/api-client/mock';
import type { MockRepositories } from '@healthy360/api-client/mock';
import type { B2BOffboarding } from '@healthy360/api-client/contracts';

/**
 * B2 — the corporate wind-down, against the real mock world.
 *
 * Speed mode: one suite for the journey, covering the state machine the timeline draws, the
 * settlement table's honesty, and the sign-off — the only irreversible thing a buyer does here.
 *
 * The wider matrix — the waiver path, cancellation, a settlement that stays outstanding, rendered
 * screens in LTR and RTL — is itemised as deferred in the wave report. Platform-side acts
 * (revocation, archiving, the purge) are deliberately not in this contract at all.
 */

function repositories(): MockRepositories {
    return createMockRepositories({ latencyMs: 0 });
}

async function current(world: MockRepositories): Promise<B2BOffboarding> {
    const offboarding = await world.b2bApplication.getOffboarding({
        organisationId: OFFBOARDING_ORGANISATION_ID,
    });
    if (offboarding === null) throw new Error('The B2B world seeds one wind-down.');
    return offboarding;
}

describe('the wind-down is a timeline, not a badge', () => {
    it('starts at notice_served and publishes the transitions the server would accept', async () => {
        const world = repositories();
        const offboarding = await current(world);

        expect(offboarding.status).toBe('notice_served');
        expect(offboarding.trigger).toBe('non_renewal');
        expect(offboarding.effectiveOn).toBe('2026-08-31');
        expect(offboarding.noticePeriodDays).toBe(30);

        // The server's own table, so the screen draws controls without re-implementing the machine.
        expect(offboarding.allowedTransitions).toEqual(['settlement_pending', 'cancelled']);
    });

    it('answers null for an organisation that is not winding down', async () => {
        const world = repositories();
        expect(
            await world.b2bApplication.getOffboarding({ organisationId: 'someone-else' }),
        ).toBeNull();
    });

    it('reports nothing revoked and nothing archived, because nothing has been', async () => {
        const world = repositories();
        const offboarding = await current(world);

        expect(offboarding.revocation.startedAt).toBeNull();
        expect(offboarding.revocation.membershipsRevoked).toBe(0);
        expect(offboarding.archive.startedAt).toBeNull();
        // Published rather than assumed: people are purged, the legal entity is kept.
        expect(offboarding.archive.legalEntityRetained).toBe(true);
    });
});

describe('the settlement checks do not flatten not_applicable', () => {
    it('runs the four checks in the registry order and moves to awaiting_signoff when clear', async () => {
        const world = repositories();
        const before = await current(world);

        const after = await world.b2bApplication.runSettlementChecks({
            offboardingId: before.id,
            lockVersion: before.lockVersion,
        });

        expect(after.settlement.checks.map((check) => check.check)).toEqual([
            'open_orders',
            'outstanding_invoices',
            'credit_balance',
            'security_deposit',
        ]);
        expect(after.settlement.status).toBe('cleared');
        expect(after.status).toBe('awaiting_signoff');
        expect(after.signoff.awaitingSince).not.toBeNull();
    });

    it('says three checks did not run rather than printing a tick beside them', async () => {
        const world = repositories();
        const before = await current(world);
        const after = await world.b2bApplication.runSettlementChecks({
            offboardingId: before.id,
            lockVersion: before.lockVersion,
        });

        const absent = after.settlement.checks.filter(
            (check) => check.outcome === 'not_applicable',
        );
        expect(absent.map((check) => check.check)).toEqual([
            'outstanding_invoices',
            'credit_balance',
            'security_deposit',
        ]);
        // A reason is required on `not_applicable`, so a neutral badge cannot read as a pass.
        for (const check of absent) expect(check.reason).toBe('invoicing_module_absent');

        // The one real check. There are no orders in this world, so it is genuinely clear.
        const orders = after.settlement.checks.find((check) => check.check === 'open_orders');
        expect(orders?.outcome).toBe('clear');
        expect(orders?.reason).toBeNull();
    });

    it('refuses a stale lock version rather than overwriting another tab', async () => {
        const world = repositories();
        const before = await current(world);

        await expect(
            world.b2bApplication.runSettlementChecks({
                offboardingId: before.id,
                lockVersion: before.lockVersion + 7,
            }),
        ).rejects.toThrow();
    });
});

describe('the signatory sign-off', () => {
    /** Get the wind-down to the one state a buyer can sign from. */
    async function awaitingSignoff(world: MockRepositories): Promise<B2BOffboarding> {
        const before = await current(world);
        return world.b2bApplication.runSettlementChecks({
            offboardingId: before.id,
            lockVersion: before.lockVersion,
        });
    }

    it('refuses to send a code before the settlement clears', async () => {
        const world = repositories();
        const offboarding = await current(world);

        // Still `notice_served`. A code issued now is a code that expires unused.
        await expect(
            world.b2bApplication.issueSignoffChallenge({ offboardingId: offboarding.id }),
        ).rejects.toThrow();
    });

    it('sends the code to the agreement signatory once the checks have cleared', async () => {
        const world = repositories();
        const ready = await awaitingSignoff(world);

        const challenge = await world.b2bApplication.issueSignoffChallenge({
            offboardingId: ready.id,
        });

        expect(challenge.purpose).toBe('b2b_signatory');
        // Server-authored, and not whoever is holding the screen.
        expect(challenge.maskedDestination).toContain('@');
        expect(challenge.codeLength).toBe(6);
    });

    it('records the sign-off with the evidence, and the digest that was read', async () => {
        const world = repositories();
        const ready = await awaitingSignoff(world);
        const challenge = await world.b2bApplication.issueSignoffChallenge({
            offboardingId: ready.id,
        });

        const signed = await world.b2bApplication.signOffOffboarding({
            offboardingId: ready.id,
            typedName: 'Dana Haddad',
            signatoryTitle: 'Finance Director',
            authorityConfirmed: true,
            documentSha256: ready.documentSha256,
            verificationToken: `${challenge.id}:${MOCK_OTP_CODE}`,
            lockVersion: ready.lockVersion,
        });

        expect(signed.status).toBe('signed_off');
        expect(signed.signoff.signedOffAt).not.toBeNull();
        expect(signed.signoff.signatoryName).toBe('Dana Haddad');
        expect(signed.signoff.signatoryTitle).toBe('Finance Director');
        expect(signed.signoff.otpVerified).toBe(true);
        // A signature that cannot say what was agreed to is not evidence of anything.
        expect(signed.signoff.consentStatement).toBe(ready.consentStatement);
        expect(signed.signoff.documentSha256).toBe(OFFBOARDING_DOCUMENT_SHA256);

        // Past sign-off the buyer has nothing left to do: revocation is the platform's.
        expect(signed.allowedTransitions).toEqual(['revoking', 'cancelled']);
    });

    it('refuses without authority, without a code, and against a changed notice', async () => {
        const world = repositories();
        const ready = await awaitingSignoff(world);
        const challenge = await world.b2bApplication.issueSignoffChallenge({
            offboardingId: ready.id,
        });

        const base = {
            offboardingId: ready.id,
            typedName: 'Dana Haddad',
            signatoryTitle: 'Finance Director',
            authorityConfirmed: true,
            documentSha256: ready.documentSha256,
            verificationToken: `${challenge.id}:${MOCK_OTP_CODE}`,
            lockVersion: ready.lockVersion,
        };

        // "This is my name" and "I may bind this company" are two claims; only the second binds.
        await expect(
            world.b2bApplication.signOffOffboarding({ ...base, authorityConfirmed: false }),
        ).rejects.toThrow();

        // A notice that changed under somebody is refused rather than silently signed.
        await expect(
            world.b2bApplication.signOffOffboarding({ ...base, documentSha256: 'something-else' }),
        ).rejects.toThrow();

        // And a wrong code spends an attempt rather than passing.
        await expect(
            world.b2bApplication.signOffOffboarding({
                ...base,
                verificationToken: `${challenge.id}:000000`,
            }),
        ).rejects.toThrow();
    });
});
