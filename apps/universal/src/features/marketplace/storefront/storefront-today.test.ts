import type { Kitchen, KitchenDeliveryWindow } from '@healthy360/api-client/contracts';

import {
    daySchedule,
    deliveryMinutesRange,
    kitchenClock,
    minutesUntil,
    monogram,
    scheduleStatus,
} from './storefront-today.ts';

function window(code: string, startsAt: string, weekdays: readonly number[] = []) {
    return { code, label: code, startsAt, endsAt: '23:59', weekdays } as KitchenDeliveryWindow;
}

/** Only the fields these readings touch. Thursday is ISO weekday 4. */
function kitchen(windows: readonly KitchenDeliveryWindow[], minutes: readonly number[] = []) {
    return {
        branches: [
            {
                isActive: true,
                timeZone: 'Asia/Dubai',
                openingHours: [
                    { weekday: 4, opensAt: '07:00', closesAt: '21:30', orderCutOffAt: '11:30' },
                ],
                deliveryZones: minutes.map((estimatedMinutes) => ({ estimatedMinutes })),
            },
        ],
        deliveryWindows: windows,
    } as unknown as Kitchen;
}

describe('kitchenClock', () => {
    it('reads the weekday and time in the kitchen’s zone, not the viewer’s', () => {
        // Thursday 1 October 2026, 07:12 UTC — 11:12 in Dubai (UTC+4).
        const now = new Date(Date.UTC(2026, 9, 1, 7, 12));
        expect(kitchenClock('Asia/Dubai', now)).toEqual({ weekday: 4, time: '11:12' });
        // 23:30 UTC on the Wednesday is already Thursday in Dubai.
        expect(kitchenClock('Asia/Dubai', new Date(Date.UTC(2026, 8, 30, 23, 30)))).toEqual({
            weekday: 4,
            time: '03:30',
        });
    });

    it('is null for a zone it cannot resolve, rather than answering in another zone', () => {
        expect(kitchenClock('Not/AZone', new Date())).toBeNull();
        expect(kitchenClock(null, new Date())).toBeNull();
    });
});

describe('daySchedule', () => {
    it('orders the opening, the cut-off, the day’s windows and the closing by time', () => {
        const subject = kitchen([
            window('evening', '18:00'),
            window('lunch', '12:15', [4]),
            window('friday', '12:00', [5]),
        ]);

        expect(daySchedule(subject, 4).map((event) => event.key)).toEqual([
            'opens',
            'cutoff',
            'window-lunch',
            'window-evening',
            'closes',
        ]);
        // A closed day still lists the windows that run on it.
        expect(daySchedule(subject, 5).map((event) => event.key)).toEqual([
            'window-friday',
            'window-evening',
        ]);
    });
});

describe('scheduleStatus', () => {
    it('marks passed steps done and the first one ahead next, against the kitchen’s clock', () => {
        const events = daySchedule(kitchen([window('lunch', '12:15')]), 4);
        expect(scheduleStatus(events, { weekday: 4, time: '11:12' })).toEqual([
            'done',
            'next',
            'todo',
            'todo',
        ]);
    });

    it('marks nothing passed and nothing next without a clock', () => {
        const events = daySchedule(kitchen([]), 4);
        expect(scheduleStatus(events, null)).toEqual(['todo', 'todo', 'todo']);
    });
});

describe('minutesUntil', () => {
    it('counts down to a published time and goes negative once it has passed', () => {
        expect(minutesUntil('11:30', { weekday: 4, time: '11:12' })).toBe(18);
        expect(minutesUntil('11:30', { weekday: 4, time: '12:00' })).toBe(-30);
    });
});

describe('deliveryMinutesRange', () => {
    it('spans the fastest and slowest zone, ignoring zones with no estimate', () => {
        expect(deliveryMinutesRange(kitchen([], [40, 25]))).toEqual({ min: 25, max: 40 });
        expect(deliveryMinutesRange(kitchen([]))).toBeNull();
    });
});

describe('monogram', () => {
    it('takes the first letter of the first two words', () => {
        expect(monogram('Mission Kitchen')).toBe('MK');
        expect(monogram('verdant')).toBe('V');
    });
});
