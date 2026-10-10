import { render, screen } from '@testing-library/react-native';

import { CataloguePager } from './catalogue-pager.tsx';

/**
 * The pager is the page buttons and nothing else: no "Showing 18 of 306" beside them, and no row at
 * all when there is only one page to be on.
 */

describe('CataloguePager', () => {
    it('draws the page buttons without a range beside them', async () => {
        await render(
            <CataloguePager
                testID="pager"
                page={1}
                totalPages={3}
                onPageChange={() => undefined}
                label="Pages"
            />,
        );

        expect(screen.getByTestId('pager-pages')).toBeTruthy();
        expect(screen.queryByTestId('pager-range')).toBeNull();
        expect(screen.queryByText(/Showing/)).toBeNull();
    });

    it('draws nothing when the list fits on one page', async () => {
        await render(
            <CataloguePager
                testID="pager"
                page={1}
                totalPages={1}
                onPageChange={() => undefined}
                label="Pages"
            />,
        );

        expect(screen.queryByTestId('pager')).toBeNull();
    });
});
