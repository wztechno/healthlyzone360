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

describe('CatalogueList coming back', () => {
    function renderReturning(props: {
        readonly count: number;
        readonly highlightedId?: string;
        readonly initialPage?: number;
        readonly onPageChange?: (page: number) => void;
    }) {
        return render(
            <CatalogueList<Row>
                testID="list"
                label="Rows"
                columns={columns}
                rows={rowsOf(props.count)}
                rowKey={(row) => row.id}
                rowActionsLabel="Actions"
                onRowPress={() => undefined}
                highlightedId={props.highlightedId}
                initialPage={props.initialPage}
                onPageChange={props.onPageChange}
            />,
        );
    }

    const selected = (testID: string) =>
        (screen.getByTestId(testID).props.accessibilityState as { selected?: boolean } | undefined)
            ?.selected === true;

    it('marks the row that was opened, and no other', async () => {
        await renderReturning({ count: 3, highlightedId: 'r2' });

        expect(selected('list-row-r2')).toBe(true);
        expect(selected('list-row-r1')).toBe(false);
        expect(selected('list-row-r3')).toBe(false);
    });

    it('opens on the page holding the row that was opened', async () => {
        await renderReturning({ count: 40, highlightedId: 'r20', initialPage: 1 });

        expect(screen.getByTestId('list-row-r20')).toBeTruthy();
        expect(screen.queryByTestId('list-row-r1')).toBeNull();
        expect(selected('list-row-r20')).toBe(true);
    });

    it('opens on the page it was left on, and reports the next one', async () => {
        const onPageChange = jest.fn();
        await renderReturning({ count: 40, initialPage: 3, onPageChange });

        expect(screen.getByTestId('list-row-r37')).toBeTruthy();

        await act(async () => {
            fireEvent.press(screen.getByTestId('list-pagination-pages-page-2'));
        });

        expect(screen.getByTestId('list-row-r19')).toBeTruthy();
        expect(onPageChange).toHaveBeenCalledWith(2);
    });
});
