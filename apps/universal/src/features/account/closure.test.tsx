import { MOCK_OTP_CODE, createMockRepositories } from '@healthy360/api-client/mock';
import type { MockRepositories } from '@healthy360/api-client/mock';

/**
 * J2 — the closure wizard's rules, against the real mock world.
 *
 * Speed mode: one suite for the journey, covering the three things that would be worst to get
 * wrong — the marketing short-circuit, the honesty of the blocker statuses, and what verifying the
 * code actually does. It runs against `createMockRepositories`, so the blockers are derived from
 * the same store the subscription screens write to, not from a fixture written to agree.
 *
 * The wider matrix — rendered wizard steps, the OTP attempt budget and lockout, cancellation, RTL
 * and axe — is itemised as deferred in the wave report.
 */

function repositories(): MockRepositories {
    return createMockRepositories({ latencyMs: 0 });
}

describe('the blocker registry does not flatten its four statuses', () => {
    it('reports a live subscription as blocking, from the store rather than a fixture', async () => {
        const world = repositories();
        const preconditions = await world.account.getClosurePreconditions();

        const subscriptions = preconditions.blockers.find(
            (blocker) => blocker.code === 'active_subscriptions',
        );
        // The prototype world seeds one live subscription, so this path is genuinely reachable.
        expect(subscriptions?.status).toBe('blocking');
        expect(subscriptions?.count).toBeGreaterThan(0);
        expect(subscriptions?.reason).toBe('subscriptions_live');
        expect(subscriptions?.resolveHref).toBe('/customer/subscriptions');
        expect(preconditions.canClose).toBe(false);
    });

    it('says a check did not run rather than pretending it passed', async () => {
        const world = repositories();
        const { blockers } = await world.account.getClosurePreconditions();

        const wallet = blockers.find((blocker) => blocker.code === 'wallet_balance');
        const payments = blockers.find((blocker) => blocker.code === 'payment_methods');

        // There is no wallet module and no payment module. A tick here would be a lie that becomes
        // an expensive one the day PAY1 ships.
        expect(wallet?.status).toBe('not_applicable');
        expect(wallet?.reason).toBe('no_wallet_module');
        expect(payments?.status).toBe('not_applicable');
        expect(payments?.reason).toBe('no_payment_module');

        // `not_applicable` carries a reason precisely so a neutral badge cannot read as a pass.
        for (const blocker of blockers) {
            if (blocker.status === 'not_applicable') expect(blocker.reason).not.toBeNull();
            if (blocker.status === 'clear') expect(blocker.reason).toBeNull();
        }
    });

    it('publishes all seven checks, in the backend order', async () => {
        const world = repositories();
        const { blockers } = await world.account.getClosurePreconditions();

        expect(blockers.map((blocker) => blocker.code)).toEqual([
            'open_orders',
            'active_subscriptions',
            'organisation_memberships',
            'pending_b2b_signatures',
            'unsettled_credit_memos',
            'wallet_balance',
            'payment_methods',
        ]);
    });

    it('turns an unsettled credit memo into an advisory, never a blocker', async () => {
        const world = repositories();
        const page = await world.commerce.listSubscriptions();
        const subscription = page.items[0];
        if (subscription === undefined) throw new Error('The world seeds one subscription.');

        // Cancelling clears the blocking subscription *and* mints the memo behind the advisory.
        const { creditMemo } = await world.commerce.cancelSubscription(subscription.id);
        expect(creditMemo).not.toBeNull();

        const { blockers, canClose } = await world.account.getClosurePreconditions();
        const memos = blockers.find((blocker) => blocker.code === 'unsettled_credit_memos');

        expect(memos?.status).toBe('advisory');
        expect(memos?.count).toBe(1);
        expect(memos?.reason).toBe('credit_memos_unsettled');
        // Advisory never stops a closure. That is the entire distinction from `blocking`.
        expect(canClose).toBe(true);
    });

    it('names what survives the purge', async () => {
        const world = repositories();
        const { retainedRecordCodes } = await world.account.getClosurePreconditions();

        expect(retainedRecordCodes).toContain('orders_anonymised');
        expect(retainedRecordCodes).toContain('contact_suppression');
        expect(retainedRecordCodes).toContain('closure_tombstone');
    });
});

describe('the marketing short-circuit', () => {
    it('completes immediately, needs no code, and consults no blockers', async () => {
        const world = repositories();

        // Deliberately run against the *blocked* world: a marketing opt-out must not be stopped by
        // a live subscription, because nothing is being destroyed.
        expect((await world.account.getClosurePreconditions()).canClose).toBe(false);

        const ticket = await world.account.requestClosure({
            reasonCode: 'no_longer_needed',
            scope: 'marketing_opt_out',
        });

        expect(ticket.status).toBe('completed');
        expect(ticket.blocked).toBe(false);
        expect(ticket.verificationRequired).toBe(false);
        expect(ticket.challenge).toBeNull();
        expect(ticket.completedAt).not.toBeNull();
    });

    it('withdraws the marketing consents and leaves the account alone', async () => {
        const world = repositories();
        for (const consent of await world.account.listConsents()) {
            await world.account.setConsent({ key: consent.definition.key, granted: true });
        }

        await world.account.requestClosure({
            reasonCode: 'too_expensive',
            scope: 'marketing_opt_out',
        });

        const consents = await world.account.listConsents();
        // This world's consent set predates the backend's `consent.` prefix and seeds
        // `marketing_email` / `marketing_sms`; the store matches the prefix rather than two
        // hard-coded codes. See `AccountMockStore.MARKETING_CONSENT_PREFIXES`.
        const marketing = consents.filter((consent) =>
            consent.definition.key.startsWith('marketing_'),
        );
        expect(marketing.length).toBeGreaterThan(0);
        for (const consent of marketing) expect(consent.granted).toBe(false);

        // Everything else is untouched — including the account itself.
        const overview = await world.account.getOverview();
        expect(overview.account.lifecycle).not.toBe('closed');
        expect(consents.some((consent) => consent.granted)).toBe(true);
    });
});

describe('a full closure', () => {
    /** Clearing the one blocking check the seeded world has. */
    async function unblock(world: MockRepositories): Promise<void> {
        const page = await world.commerce.listSubscriptions();
        for (const subscription of page.items) {
            await world.commerce.cancelSubscription(subscription.id);
        }
    }

    it('comes back blocked, with no code issued, while something is in the way', async () => {
        const world = repositories();
        const ticket = await world.account.requestClosure({
            reasonCode: 'privacy_concerns',
            scope: 'full',
        });

        expect(ticket.blocked).toBe(true);
        expect(ticket.challenge).toBeNull();
        expect(ticket.verificationRequired).toBe(false);
        expect(ticket.blockers.some((blocker) => blocker.status === 'blocking')).toBe(true);
    });

    it('issues the step-up challenge with the ticket once nothing is in the way', async () => {
        const world = repositories();
        await unblock(world);

        const ticket = await world.account.requestClosure({
            reasonCode: 'moving_away',
            scope: 'full',
        });

        expect(ticket.blocked).toBe(false);
        expect(ticket.verificationRequired).toBe(true);
        // One round trip, not two: a request that needs a step-up and a challenge fetched
        // afterwards is one race nobody needs.
        expect(ticket.challenge?.purpose).toBe('closure_step_up');
        expect(ticket.challenge?.maskedDestination).toBeTruthy();
        expect(await world.account.getLiveClosureRequest()).not.toBeNull();
    });

    it('destroys the personal data and signs the person out when the code is verified', async () => {
        const world = repositories();
        await unblock(world);

        const ticket = await world.account.requestClosure({
            reasonCode: 'other',
            reasonNote: 'Trying something else.',
            scope: 'full',
        });

        const verified = await world.account.verifyClosure({
            ticketId: ticket.id,
            code: MOCK_OTP_CODE,
        });

        expect(verified.status).toBe('completed');
        expect(verified.completedAt).not.toBeNull();

        const overview = await world.account.getOverview();
        expect(overview.account.lifecycle).toBe('closed');
        expect(overview.contacts).toHaveLength(0);
        expect(await world.account.listAddresses()).toHaveLength(0);

        // The credential is gone in the same breath — closing and signing out are one event.
        expect(world.tokenStore.get()).toBeNull();
        // And there is no longer a live request to resume.
        expect(await world.account.getLiveClosureRequest()).toBeNull();
    });

    it('refuses a wrong code and refuses a second request while one is in flight', async () => {
        const world = repositories();
        await unblock(world);

        const ticket = await world.account.requestClosure({
            reasonCode: 'service_quality',
            scope: 'full',
        });

        await expect(
            world.account.verifyClosure({ ticketId: ticket.id, code: '000000' }),
        ).rejects.toThrow();

        await expect(
            world.account.requestClosure({ reasonCode: 'duplicate_account', scope: 'full' }),
        ).rejects.toThrow();
    });
});
