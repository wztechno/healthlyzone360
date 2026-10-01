import type { Kitchen, KitchenBranch, MarketplaceMeal } from '@healthy360/api-client/contracts';
import type { AllergenCode } from '@healthy360/domain-types';

import { allergenTally, latestCutOffToday, menuShelves } from './storefront-menu.ts';

/** Only the fields these readings touch; the rest of the contract is irrelevant to them. */
function meal(
    category: MarketplaceMeal['publishedCategory'],
    allergens: readonly string[] = [],
): MarketplaceMeal {
    return { publishedCategory: category, allergens } as unknown as MarketplaceMeal;
}

function branch(
    cutOffs: readonly (string | null)[],
    isActive = true,
): Pick<KitchenBranch, 'isActive' | 'openingHours'> {
    return {
        isActive,
        openingHours: cutOffs.map((orderCutOffAt) => ({
            weekday: 4,
            opensAt: '08:00',
            closesAt: '22:00',
            orderCutOffAt,
        })),
    };
}

function kitchen(...branches: Pick<KitchenBranch, 'isActive' | 'openingHours'>[]): Kitchen {
    return { branches } as unknown as Kitchen;
}

describe('menuShelves', () => {
    it('lists the shelves in the order the menu reaches them, unfiled listings last', () => {
        const bowls = { code: 'bowls', name: 'Bowls' };
        const drinks = { code: 'beverage', name: 'Drinks' };

        expect(menuShelves([meal(null), meal(bowls), meal(drinks), meal(bowls)])).toEqual([
            { key: 'bowls', name: 'Bowls', count: 2 },
            { key: 'beverage', name: 'Drinks', count: 1 },
            { key: 'other', name: null, count: 1 },
        ]);
    });
});

describe('allergenTally', () => {
    it('counts each listing once per allergen, most-declared first', () => {
        const tally = allergenTally([
            meal(null, ['sesame', 'milk', 'milk']),
            meal(null, ['milk']),
            meal(null, []),
        ]);

        expect(tally).toEqual([
            { code: 'milk' as AllergenCode, count: 2 },
            { code: 'sesame' as AllergenCode, count: 1 },
        ]);
    });
});

describe('latestCutOffToday', () => {
    it('takes the latest cut-off any active branch publishes for the day', () => {
        const subject = kitchen(branch(['11:30']), branch(['14:00']), branch(['20:00'], false));
        expect(latestCutOffToday(subject, 4)).toBe('14:00');
    });

    it('is null when no branch publishes one for the day', () => {
        expect(latestCutOffToday(kitchen(branch([null])), 4)).toBeNull();
        expect(latestCutOffToday(kitchen(branch(['11:30'])), 5)).toBeNull();
    });
});
