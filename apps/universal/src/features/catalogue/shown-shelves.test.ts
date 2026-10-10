import { SHOWN_SHELVES, shelfNarrowing } from './shown-shelves.ts';

describe('shelfNarrowing', () => {
    it('shows the meal, sauce, dressing and frozen shelves', () => {
        expect(SHOWN_SHELVES).toEqual(['meal', 'sauce', 'dressing', 'frozen']);
    });

    it('asks for every item type the shown shelves hold, and leaves the shelf to the caller', () => {
        const { narrowed, isShownShelf, shownCategory, shownItemTypes } =
            shelfNarrowing(SHOWN_SHELVES);

        expect(narrowed).toBe(true);
        expect(isShownShelf('sauce')).toBe(true);
        expect(isShownShelf('bread')).toBe(false);
        expect(shownCategory()).toBeUndefined();
        expect(shownCategory('dressing')).toBe('dressing');
        expect(shownItemTypes(['meal'])).toEqual([
            'meal',
            'product',
            'sauce',
            'dressing',
            'frozen_meal',
        ]);
    });

    it('narrows a listing to a single shown shelf', () => {
        const { narrowed, isShownShelf, shownCategory, shownItemTypes } = shelfNarrowing([
            'frozen',
        ]);

        expect(narrowed).toBe(true);
        expect(isShownShelf('frozen')).toBe(true);
        expect(isShownShelf('meal')).toBe(false);
        // Nothing picked, or a hidden shelf picked by a link: the shown shelf.
        expect(shownCategory()).toBe('frozen');
        expect(shownCategory('meal')).toBe('frozen');
        expect(shownCategory('frozen')).toBe('frozen');
        expect(shownItemTypes(['meal'])).toEqual([
            'meal',
            'product',
            'sauce',
            'dressing',
            'frozen_meal',
        ]);
    });

    it('leaves the shelf to the caller when more than one is shown', () => {
        const { shownCategory } = shelfNarrowing(['frozen', 'meal']);

        expect(shownCategory()).toBeUndefined();
        expect(shownCategory('meal')).toBe('meal');
        expect(shownCategory('bread')).toBeUndefined();
    });

    it('narrows nothing when no shelf is listed', () => {
        const { narrowed, isShownShelf, shownCategory, shownItemTypes } = shelfNarrowing([]);

        expect(narrowed).toBe(false);
        expect(isShownShelf('meal')).toBe(true);
        expect(shownCategory()).toBeUndefined();
        expect(shownCategory('meal')).toBe('meal');
        expect(shownItemTypes(['meal'])).toEqual(['meal']);
    });
});
