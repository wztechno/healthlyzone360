import type { Kitchen } from '@healthy360/api-client/contracts';

import { nextOpenWeekday } from './storefront-facts.ts';

function kitchenOpenOn(weekdays: readonly number[]): Kitchen {
    return {
        branches: [
            {
                isActive: true,
                status: 'active',
                openingHours: weekdays.map((weekday) => ({
                    weekday,
                    opensAt: '09:00',
                    closesAt: '17:00',
                })),
            },
        ],
    } as unknown as Kitchen;
}

describe('nextOpenWeekday', () => {
    it('finds the next open day, past the end of the week and back to today at worst', () => {
        expect(nextOpenWeekday(kitchenOpenOn([4]), 2)).toBe(4);
        expect(nextOpenWeekday(kitchenOpenOn([1]), 6)).toBe(1);
        expect(nextOpenWeekday(kitchenOpenOn([3]), 3)).toBe(3);
    });

    it('has nothing to promise for a kitchen with no hours', () => {
        expect(nextOpenWeekday(kitchenOpenOn([]), 3)).toBeNull();
    });
});
