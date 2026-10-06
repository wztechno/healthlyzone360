import { act, fireEvent, render, screen } from '@testing-library/react-native';

import { CatalogueList } from './catalogue-list.tsx';
import type { CatalogueColumn } from './catalogue-column-spec.ts';

/**
 * Every admin table shows eighteen rows a page. A screen that hands over one server page never
 * reaches the limit and keeps its own pager; one that hands over the whole set is paged here.
 */

interface Row {
    readonly id: string;
}

const columns: readonly CatalogueColumn<Row>[] = [
    {
        key: 'name',
        label: 'Name',
        width: 200,
        priority: 100,
        role: 'title',
        value: (row) => row.id,
    },
];

const rowsOf = (count: number): readonly Row[] =>
    Array.from({ length: count }, (_, index) => ({ id: `r${String(index + 1)}` }));

function renderList(count: number) {
    return render(
        <CatalogueList<Row>
            testID="list"
            label="Rows"
            columns={columns}
            rows={rowsOf(count)}
            rowKey={(row) => row.id}
            rowActionsLabel="Actions"
        />,
    );
}

describe('CatalogueList paging', () => {
    it('draws no pager for a set that fits on one page', async () => {
        await renderList(18);

        expect(screen.getByTestId('list-row-r18')).toBeTruthy();
        expect(screen.queryByTestId('list-pagination')).toBeNull();
    });

    it('cuts a longer set into pages of eighteen', async () => {
        await renderList(20);

        expect(screen.getByTestId('list-row-r18')).toBeTruthy();
        expect(screen.queryByTestId('list-row-r19')).toBeNull();

        await act(async () => {
            fireEvent.press(screen.getByTestId('list-pagination-pages-page-2'));
        });

        expect(screen.getByTestId('list-row-r19')).toBeTruthy();
        expect(screen.getByTestId('list-row-r20')).toBeTruthy();
        expect(screen.queryByTestId('list-row-r1')).toBeNull();
    });
});
