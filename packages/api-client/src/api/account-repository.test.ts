import { expect, it } from 'vitest';

import type { CustomerAccount as WireAccount } from '../generated/types.ts';
import { mapChecklist } from './account-repository.ts';

/**
 * A new customer's account, as the server sends it: every undone required step is in `outstanding`
 * under the same code as its checklist row, because that is what `outstanding` is — the list of
 * what is still to do. Reading membership there as "cannot be done yet" disabled every setup button
 * the checkout and the account page drew.
 */
it('leaves every undone step open to start, however the server lists it', () => {
    const wire = {
        status: 'provisional',
        is_ready: false,
        checklist: [
            { code: 'account.email_unverified', satisfied: true, required: true },
            { code: 'account.phone_unverified', satisfied: false, required: false },
            { code: 'account.no_served_address', satisfied: false, required: true },
            { code: 'account.dietary_declaration_missing', satisfied: false, required: true },
            { code: 'account.consents_outstanding', satisfied: false, required: true },
        ],
        outstanding: [
            { code: 'account.no_served_address', context: { has_address: false } },
            { code: 'account.dietary_declaration_missing', context: {} },
            { code: 'account.consents_outstanding', context: { consents: ['terms'] } },
        ],
    } as unknown as WireAccount;

    const checklist = mapChecklist(wire);

    expect(checklist.canActivate).toBe(false);
    expect(checklist.items.map((item) => [item.step, item.complete, item.blockedReason])).toEqual([
        ['verify_email', true, null],
        ['verify_phone', false, null],
        ['add_address', false, null],
        ['dietary_profile', false, null],
        ['consents', false, null],
    ]);
});
