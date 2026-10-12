import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { Dimensions, StyleSheet } from 'react-native';

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

/**
 * Slack is shared in proportion to width, but never to a figure or a badge: a `metric` or `status`
 * column holds its declared track unless its spec asks to grow.
 */
describe('CatalogueList slack', () => {
    const tracked: readonly CatalogueColumn<Row>[] = [
        {
            key: 'name',
            label: 'Name',
            width: 200,
            priority: 100,
            role: 'title',
            value: (r) => r.id,
        },
        {
            key: 'cost',
            label: 'Cost',
            width: 104,
            priority: 85,
            role: 'metric',
            value: (r) => r.id,
        },
        {
            key: 'yield',
            label: 'Yield',
            width: 104,
            priority: 84,
            role: 'metric',
            grow: true,
            value: (row) => row.id,
        },
    ];

    // The tracks are the wide table's; below `md` the row is two-line and has none.
    const window = Dimensions.get('window');
    const screenSize = Dimensions.get('screen');
    beforeAll(() => {
        Dimensions.set({
            window: { ...window, width: 1440, height: 900 },
            screen: { ...screenSize, width: 1440, height: 900 },
        });
    });
    afterAll(() => {
        Dimensions.set({ window, screen: screenSize });
    });

    const flexGrow = (key: string): unknown =>
        StyleSheet.flatten(screen.getByTestId(`list-columnheader-${key}`).props.style).flexGrow;

    it('freezes metric columns, keeps the title growing, and honours an explicit grow', async () => {
        await render(
            <CatalogueList<Row>
                testID="list"
                label="Rows"
                columns={tracked}
                rows={rowsOf(1)}
                rowKey={(row) => row.id}
                rowActionsLabel="Actions"
            />,
        );

        expect(flexGrow('cost')).toBe(0);
        expect(flexGrow('name')).toBeGreaterThan(0);
        expect(flexGrow('yield')).toBeGreaterThan(0);
    });
});
