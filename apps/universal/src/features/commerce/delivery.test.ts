import type { Kitchen, KitchenDeliveryWindow } from '@healthy360/api-client/contracts';

import { deliverySlotsForKitchen, offeredSlots } from './delivery.ts';

function window(code: string, startsAt: string, endsAt: string): KitchenDeliveryWindow {
    return { code, label: code, startsAt, endsAt, weekdays: [] };
}

/** Only `deliveryWindows` is read. */
function kitchenWith(deliveryWindows: readonly KitchenDeliveryWindow[]): Kitchen {
    return { deliveryWindows } as unknown as Kitchen;
}

describe('the kitchen’s delivery slots', () => {
    it('lists them in the order of the day, whatever order the kitchen created them in', () => {
        // The kitchen's own order: Snack was added after Dinner.
        const kitchen = kitchenWith([
            window('morning', '08:00', '11:00'),
            window('midday', '12:00', '15:00'),
            window('evening', '18:00', '21:00'),
            window('afternoon', '15:00', '17:00'),
        ]);

        const slots = deliverySlotsForKitchen(kitchen);
        expect(slots.map((slot) => slot.code)).toEqual([
            'morning',
            'midday',
            'afternoon',
            'evening',
        ]);
        // Narrowed to the zone's slots, still in that order.
        expect(
            offeredSlots(slots, ['evening', 'afternoon', 'morning']).map((slot) => slot.code),
        ).toEqual(['morning', 'afternoon', 'evening']);
    });
});
