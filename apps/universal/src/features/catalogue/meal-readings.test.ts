import type { MarketplaceMeal } from '@healthy360/api-client/contracts';

import { isSoldOut, unavailableReason } from './meal-readings.ts';

/** Only the availability matters to these rules, so the rest of the record is left out. */
function withDays(days: MarketplaceMeal['availability']): MarketplaceMeal {
    return { availability: days } as unknown as MarketplaceMeal;
}

const day = (available: boolean, remaining: number | null) => ({
    date: '2026-10-01',
    available,
    remaining,
    orderCutOffAt: null,
});

describe('isSoldOut / unavailableReason', () => {
    it('never blocks a dish whose kitchen published no days', () => {
        expect(isSoldOut(withDays([]))).toBe(false);
    });

    it('blocks a dish only when every published day is unavailable', () => {
        expect(isSoldOut(withDays([day(false, null), day(true, 4)]))).toBe(false);
        expect(isSoldOut(withDays([day(false, null), day(false, 0)]))).toBe(true);
    });

    it('calls it sold out only when a day ran out, and unavailable when it was not offered', () => {
        expect(unavailableReason(withDays([day(false, null), day(false, 0)]))).toBe('sold-out');
        expect(unavailableReason(withDays([day(false, null), day(false, null)]))).toBe(
            'unavailable',
        );
    });
});
