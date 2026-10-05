import { SHOWN_SHELVES, shelfNarrowing } from './shown-shelves.ts';

describe('shelfNarrowing', () => {
    it('shows the Frozen shelf alone, for now', () => {
        expect(SHOWN_SHELVES).toEqual(['frozen']);
    });

    it('narrows a listing to the one shown shelf, and asks for the products it holds', () => {
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
        expect(shownItemTypes(['meal'])).toEqual(['meal', 'product', 'frozen_meal']);
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
