import type {
    B2BOffboarding,
    OffboardingStatus,
    SettlementCheck,
} from '../../contracts/b2b-application.ts';
import { organisationIdAt } from './ids.ts';

/**
 * The B2 wind-down world.
 *
 * One fixture, in one deliberately chosen state, plus the state machine and the settlement registry
 * around it. Kept out of `./store.ts` because it is a separate lifecycle over a separate row — an
 * application is how a company *arrives*, an offboarding is how it leaves, and folding the two into
 * one file would suggest they are stages of the same thing.
 *
 * ## Why the fixture sits at `notice_served`
 *
 * Because it is the only state from which a *buyer* can do anything interesting. Nine states exist
 * and the corporate signatory acts in two of them: they re-run the settlement checks, and — once
 * those clear — they sign off. Everything after sign-off (revocation, archiving, the purge) belongs
 * to the platform, and there is deliberately no method for any of it: a company must not be able to
 * revoke its own users' access from a self-service screen, and a screen that offered the button
 * would be a screen somebody eventually wires up.
 *
 * Seeding at `awaiting_signoff` instead would have hidden the settlement table, which is the part
 * that has to be honest: three of the four checks answer `not_applicable` because there is no
 * invoicing module, and a table that printed a tick beside them would be lying about a company's
 * money.
 */

export const OFFBOARDING_ORGANISATION_ID = organisationIdAt(0);

/** The state machine, from the backend's `OffboardingStatus::allowedTransitions()`. */
export const OFFBOARDING_TRANSITIONS: Readonly<
    Record<OffboardingStatus, readonly OffboardingStatus[]>
> = {
    requested: ['notice_served', 'cancelled'],
    notice_served: ['settlement_pending', 'cancelled'],
    // The self-loop is re-running the checks, which is a thing the buyer does more than once.
    settlement_pending: ['settlement_pending', 'awaiting_signoff', 'cancelled'],
    awaiting_signoff: ['signed_off', 'cancelled'],
    signed_off: ['revoking', 'cancelled'],
    // Past revocation there is no cancel: access is already gone and cannot be un-revoked.
    revoking: ['archiving'],
    archiving: ['archiving', 'completed'],
    completed: [],
    cancelled: [],
};

export function isTerminalOffboarding(status: OffboardingStatus): boolean {
    return status === 'completed' || status === 'cancelled';
}

/**
 * The four settlement checks, in the registry's order.
 *
 * `open_orders` is real — it reads whatever the world knows about orders this organisation placed.
 * The other three are `not_applicable` with the backend's own reason strings, because invoicing,
 * credit balances and security deposits are modules nobody has written. That is stated on the wire
 * so the table can print it, rather than being smoothed into a pass.
 */
export function runChecks(openOrders: number): readonly SettlementCheck[] {
    return [
        openOrders > 0
            ? {
                  check: 'open_orders',
                  outcome: 'outstanding',
                  reason: null,
                  detail: `${String(openOrders)} order(s) still in flight.`,
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

/** Only `outstanding` blocks. `not_applicable` never does, and never silently passes either. */
export function settlementIsClear(checks: readonly SettlementCheck[]): boolean {
    return !checks.some((check) => check.outcome === 'outstanding');
}

/**
 * The wording a signatory ties their sign-off to, and the digest of the notice they read.
 *
 * Fixed, and published, for the same reason the agreement's is: a signature that cannot say *what*
 * was agreed to is not evidence of anything. The digest is a fixture value — this world holds no
 * real document — and the store echoes it back so a notice that changed under somebody is refused.
 */
export const OFFBOARDING_CONSENT_STATEMENT =
    'I confirm I am authorised to bind this company, that I have read the wind-down notice, and ' +
    'that I agree to end the commercial relationship on the effective date shown.';

export const OFFBOARDING_DOCUMENT_SHA256 =
    'b2c9f1a4e7d0836512a4bd9e0c73f5a18d6e42b0c95713fa8d24e60b7c1f9a35';

export interface MutableOffboarding {
    id: string;
    organisationId: string;
    status: OffboardingStatus;
    trigger: B2BOffboarding['trigger'];
    reasonNote: string | null;
    effectiveOn: string | null;
    noticePeriodDays: number;
    settlementStatus: B2BOffboarding['settlement']['status'];
    checks: readonly SettlementCheck[];
    settlementStartedAt: string | null;
    settlementResolvedAt: string | null;
    waiverReason: string | null;
    awaitingSince: string | null;
    signedOffAt: string | null;
    signatoryName: string | null;
    signatoryTitle: string | null;
    otpVerified: boolean;
    startedAt: string;
    cancelledAt: string | null;
    cancelledReason: string | null;
    lockVersion: number;
}

/** A fixed instant, so the fixture's timestamps do not drift with the wall clock. */
export const OFFBOARDING_SEED_NOW = '2026-08-01T09:00:00.000Z';

export function seedOffboarding(): MutableOffboarding {
    return {
        id: organisationIdAt(1),
        organisationId: OFFBOARDING_ORGANISATION_ID,
        status: 'notice_served',
        trigger: 'non_renewal',
        reasonNote: 'The catering contract will not be renewed for the 2027 financial year.',
        effectiveOn: '2026-08-31',
        noticePeriodDays: 30,
        settlementStatus: 'pending',
        checks: [],
        settlementStartedAt: null,
        settlementResolvedAt: null,
        waiverReason: null,
        awaitingSince: null,
        signedOffAt: null,
        signatoryName: null,
        signatoryTitle: null,
        otpVerified: false,
        startedAt: OFFBOARDING_SEED_NOW,
        cancelledAt: null,
        cancelledReason: null,
        lockVersion: 0,
    };
}

export function readOffboarding(row: MutableOffboarding): B2BOffboarding {
    return {
        id: row.id,
        organisationId: row.organisationId,
        status: row.status,
        trigger: row.trigger,
        reasonNote: row.reasonNote,
        effectiveOn: row.effectiveOn,
        noticePeriodDays: row.noticePeriodDays,
        settlement: {
            status: row.settlementStatus,
            checks: row.checks,
            startedAt: row.settlementStartedAt,
            resolvedAt: row.settlementResolvedAt,
            waiverReason: row.waiverReason,
        },
        signoff: {
            awaitingSince: row.awaitingSince,
            signedOffAt: row.signedOffAt,
            signatoryName: row.signatoryName,
            signatoryTitle: row.signatoryTitle,
            consentStatement: row.signedOffAt === null ? null : OFFBOARDING_CONSENT_STATEMENT,
            documentSha256: row.signedOffAt === null ? null : OFFBOARDING_DOCUMENT_SHA256,
            otpVerified: row.otpVerified,
        },
        // Revocation and archiving are the platform's, and this world never performs them. Zeroes
        // with null timestamps are the truthful reading: nothing has happened yet.
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
        consentStatement: OFFBOARDING_CONSENT_STATEMENT,
        documentSha256: OFFBOARDING_DOCUMENT_SHA256,
        allowedTransitions: OFFBOARDING_TRANSITIONS[row.status],
        startedAt: row.startedAt,
        cancelledAt: row.cancelledAt,
        cancelledReason: row.cancelledReason,
        lockVersion: row.lockVersion,
    };
}
