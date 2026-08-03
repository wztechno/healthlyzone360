import { createMockRepositories } from '@healthy360/api-client/mock';
import type { MockRepositories } from '@healthy360/api-client/mock';
import type { Subscription } from '@healthy360/api-client/contracts';

/**
 * S1 — the balance, the credit memo and the 24-hour cut-off, against the real mock world.
 *
 * Speed mode: one suite for the journey, and it asserts the three rules that carry money or
 * expectations. Everything here runs against `createMockRepositories`, so it exercises the same
 * store the screens do — not a stub written to agree with the test.
 *
 * The wider matrix — the quote's refusal vocabulary, Free Selection's cut-off rejection, the ledger
 * filter, rendered screens in LTR and RTL — is itemised as deferred in the wave report.
 */

function repositories(): MockRepositories {
    return createMockRepositories({ latencyMs: 0 });
}

/** The seeded subscription: started before "today", weekdays 1/3/5, a four-week balance. */
async function seeded(world: MockRepositories): Promise<Subscription> {
    const page = await world.commerce.listSubscriptions();
    const first = page.items[0];
    if (first === undefined) throw new Error('The prototype world seeds one subscription.');
    return first;
}

describe('the balance is a count of delivery days', () => {
    it('reports what has been used, what is left, and the price a refund would use', async () => {
        const world = repositories();
        const subscription = await seeded(world);
        const balance = await world.commerce.getSubscriptionBalance(subscription.id);

        expect(balance.days.total).toBeGreaterThan(0);
        // The seed settles the deliveries that are already in the past, so this is not a fresh
        // balance — which is the whole reason it can demonstrate anything.
        expect(balance.days.consumed).toBeGreaterThan(0);
        expect(balance.days.remaining).toBe(balance.days.total - balance.days.consumed);

        // The effective per-day price, not a weekly price divided by seven.
        expect(balance.perDayPrice.amount).toBeGreaterThan(0);
        expect(balance.changeCutoffHours).toBe(24);
    });

    it('agrees with the ledger it is derived from', async () => {
        const world = repositories();
        const subscription = await seeded(world);
        const [balance, ledger] = await Promise.all([
            world.commerce.getSubscriptionBalance(subscription.id),
            world.commerce.listSubscriptionDeliveries(subscription.id),
        ]);

        expect(ledger.items).toHaveLength(balance.days.total);
        expect(ledger.items.filter((row) => row.consumed)).toHaveLength(balance.days.consumed);
    });

    it('puts the balance on the subscription itself, so a list needs no extra request', async () => {
        const world = repositories();
        const subscription = await seeded(world);
        const balance = await world.commerce.getSubscriptionBalance(subscription.id);

        expect(subscription.days).toEqual(balance.days);
    });
});

describe('a skip consumes nothing', () => {
    it('leaves the balance untouched and marks the day as free', async () => {
        const world = repositories();
        const subscription = await seeded(world);
        const before = await world.commerce.getSubscriptionBalance(subscription.id);

        const target = before.nextDeliveryDate;
        expect(target).not.toBeNull();

        const skipped = await world.commerce.skipDay(subscription.id, {
            date: target as string,
        });

        // The one assertion the approved semantics turn on.
        expect(skipped.days.remaining).toBe(before.days.remaining);
        expect(skipped.days.consumed).toBe(before.days.consumed);

        const ledger = await world.commerce.listSubscriptionDeliveries(subscription.id);
        const row = ledger.items.find((entry) => entry.date === target);
        expect(row?.status).toBe('skipped_customer');
        expect(row?.consumed).toBe(false);
        expect(row?.skipReason).toBe('customer_request');
    });

    it('counts the skipped day without charging for it', async () => {
        const world = repositories();
        const subscription = await seeded(world);
        const before = await world.commerce.getSubscriptionBalance(subscription.id);

        await world.commerce.skipDay(subscription.id, {
            date: before.nextDeliveryDate as string,
        });
        const after = await world.commerce.getSubscriptionBalance(subscription.id);

        expect(after.skippedDays).toBe(before.skippedDays + 1);
        expect(after.days.remaining).toBe(before.days.remaining);
    });
});

describe('cancelling mints a credit memo', () => {
    it('records unused days x the effective per-day price actually paid', async () => {
        const world = repositories();
        const subscription = await seeded(world);
        const balance = await world.commerce.getSubscriptionBalance(subscription.id);

        const { subscription: cancelled, creditMemo } = await world.commerce.cancelSubscription(
            subscription.id,
        );

        expect(cancelled.state).toBe('cancelled');
        expect(cancelled.nextDeliveryDate).toBeNull();

        expect(creditMemo).not.toBeNull();
        expect(creditMemo?.unusedDays).toBe(balance.days.remaining);
        expect(creditMemo?.perDayPrice).toEqual(balance.perDayPrice);
        // The arithmetic, asserted rather than trusted.
        expect(creditMemo?.amount.amount).toBe(balance.days.remaining * balance.perDayPrice.amount);
        expect(creditMemo?.amount.currency).toBe(balance.perDayPrice.currency);
    });

    it('says the settlement is manual and the memo is only recorded', async () => {
        const world = repositories();
        const subscription = await seeded(world);
        const { creditMemo } = await world.commerce.cancelSubscription(subscription.id);

        // Nothing in this system moves money, and the shape refuses to imply otherwise.
        expect(creditMemo?.settlement).toBe('manual');
        expect(creditMemo?.status).toBe('recorded');
        expect(creditMemo?.reason).toBe('subscription_cancelled');
    });

    it('cancels every remaining delivery and refuses a second cancellation', async () => {
        const world = repositories();
        const subscription = await seeded(world);
        await world.commerce.cancelSubscription(subscription.id);

        const ledger = await world.commerce.listSubscriptionDeliveries(subscription.id);
        expect(ledger.items.some((row) => row.status === 'scheduled')).toBe(false);

        await expect(world.commerce.cancelSubscription(subscription.id)).rejects.toThrow();
    });
});

describe('the 24-hour cut-off', () => {
    it('leaves a delivery inside the window alone and re-plans only what comes after it', async () => {
        const world = repositories();
        const subscription = await seeded(world);

        const before = await world.commerce.listSubscriptionDeliveries(subscription.id);
        const inWindow = before.items.find((row) => row.status === 'scheduled');
        expect(inWindow).toBeDefined();

        // Tuesday and Thursday, from Monday/Wednesday/Friday.
        const changed = await world.commerce.setSubscriptionWeekdays(subscription.id, {
            deliveryWeekdays: [2, 4],
        });
        expect(changed.configuration.deliveryWeekdays).toEqual([2, 4]);

        const after = await world.commerce.listSubscriptionDeliveries(subscription.id);

        // The delivery whose cut-off has already passed survives, on its original date, even though
        // that date is no longer one of the chosen weekdays.
        expect(after.items.some((row) => row.date === inWindow?.date)).toBe(true);

        // Everything the change could touch now falls on the new weekdays.
        const replanned = after.items.filter(
            (row) => row.status === 'scheduled' && row.date !== inWindow?.date,
        );
        expect(replanned.length).toBeGreaterThan(0);
        for (const row of replanned) {
            const weekday = new Date(`${row.date}T00:00:00.000Z`).getUTCDay();
            expect([2, 4]).toContain(weekday === 0 ? 7 : weekday);
        }
    });

    it('preserves the balance across a weekday change', async () => {
        const world = repositories();
        const subscription = await seeded(world);
        const before = await world.commerce.getSubscriptionBalance(subscription.id);

        const changed = await world.commerce.setSubscriptionWeekdays(subscription.id, {
            deliveryWeekdays: [2, 4],
        });

        // Somebody bought a number of days. Moving which weekdays they arrive on is not a purchase.
        expect(changed.days.total).toBe(before.days.total);
        expect(changed.days.remaining).toBe(before.days.remaining);
    });

    it('refuses an empty weekday set rather than silently stopping deliveries', async () => {
        const world = repositories();
        const subscription = await seeded(world);

        await expect(
            world.commerce.setSubscriptionWeekdays(subscription.id, { deliveryWeekdays: [] }),
        ).rejects.toThrow();
    });
});

describe('the quote replaced the seven-probe hack', () => {
    it('answers availability and price in one read', async () => {
        const world = repositories();
        const subscription = await seeded(world);

        const quote = await world.commerce.getSubscriptionQuote({
            planId: subscription.configuration.planId,
            variantId: subscription.configuration.variantId,
            duration: subscription.configuration.duration,
        });

        expect(quote.available).toBe(true);
        expect(quote.refusals).toEqual([]);
        expect(quote.availableWeekdays.length).toBeGreaterThan(0);
        // The plan the seed uses does not deliver on Saturday, and the quote says so directly
        // rather than the caller discovering it by pricing seven hypothetical subscriptions.
        expect(quote.availableWeekdays).not.toContain(6);
        expect(quote.perDayPrice.amount).toBeGreaterThan(0);
        expect(quote.changeCutoffHours).toBe(24);
    });
});
