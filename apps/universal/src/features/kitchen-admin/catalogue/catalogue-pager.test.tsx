import { render, screen } from '@testing-library/react-native';

import { CatalogueRange, splitFigures } from './catalogue-pager.tsx';

/**
 * The range picks its figures out of a sentence it did not write, so what is pinned here is that the
 * split finds whole figures in every script the catalogues use and never loses a character.
 */

describe('splitFigures', () => {
    it('separates the words from the figures, in the catalogue’s order', () => {
        expect(splitFigures('Showing 18 of 29')).toEqual([
            { text: 'Showing ', figure: false },
            { text: '18', figure: true },
            { text: ' of ', figure: false },
            { text: '29', figure: true },
        ]);
    });

    it('keeps a grouped figure whole and a range’s two ends apart', () => {
        expect(splitFigures('1–25 of 1,248').filter((part) => part.figure)).toEqual([
            { text: '1', figure: true },
            { text: '25', figure: true },
            { text: '1,248', figure: true },
        ]);
    });

    it('finds Arabic-Indic figures', () => {
        expect(splitFigures('تعرض ١٨ من ٢٩').filter((part) => part.figure)).toEqual([
            { text: '١٨', figure: true },
            { text: '٢٩', figure: true },
        ]);
    });

    it('loses nothing', () => {
        const range = '[[Šĥóŵíñĝ 18 óƒ 29 āēīō]]';
        expect(
            splitFigures(range)
                .map((part) => part.text)
                .join(''),
        ).toBe(range);
    });
});

describe('CatalogueRange', () => {
    it('reads as the one sentence it was given', async () => {
        await render(<CatalogueRange testID="range" range="Showing 18 of 29" />);
        expect(screen.getByTestId('range')).toHaveTextContent('Showing 18 of 29');
    });
});
