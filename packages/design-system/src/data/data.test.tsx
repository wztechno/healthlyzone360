import { fireEvent, screen } from '@testing-library/react-native';
import { Text as RNText, useWindowDimensions } from 'react-native';

import { DensityProvider } from '../hooks/use-density.tsx';
import { assertSubtreeIsLogical, renderWithI18n } from '../testing/render.tsx';
import { CalendarGrid } from './calendar-grid.tsx';
import type { CalendarDay, CalendarSlot } from './calendar-grid.tsx';
import { MeterBar, ProgressRing } from './progress.tsx';
import { Rating } from './rating.tsx';
import { Table } from './table.tsx';
import type { TableColumn } from './table.tsx';

jest.mock('react-native/Libraries/Utilities/useWindowDimensions');

const mockedDimensions = useWindowDimensions as unknown as jest.Mock;

function setViewport(width: number) {
    mockedDimensions.mockReturnValue({ width, height: 900, scale: 2, fontScale: 1 });
}

beforeEach(() => {
    setViewport(1280);
});

interface NutrientRow {
    readonly key: string;
    readonly name: string;
    readonly amount: string;
    readonly target: string;
}

const rows: readonly NutrientRow[] = [
    { key: 'protein', name: 'Protein', amount: '96 g', target: '120 g' },
    { key: 'fibre', name: 'Fibre', amount: '22 g', target: '30 g' },
];

const columns: readonly TableColumn<NutrientRow>[] = [
    {
        key: 'name',
        header: 'Nutrient',
        rowHeader: true,
        render: (row) => <RNText testID={`name-${row.key}`}>{row.name}</RNText>,
    },
    {
        key: 'amount',
        header: 'Amount',
        numeric: true,
        render: (row) => <RNText>{row.amount}</RNText>,
    },
    {
        key: 'target',
        header: 'Target',
        numeric: true,
        render: (row) => <RNText>{row.target}</RNText>,
    },
];

describe('Table — wide', () => {
    it('is a named ARIA table with column headers', async () => {
        await renderWithI18n(
            <Table
                testID="nutrients"
                caption="Nutrition per serving"
                columns={columns}
                rows={rows}
                rowKey={(row) => row.key}
            />,
        );

        const table = screen.getByTestId('nutrients-table');
        expect(table.props.role).toBe('table');
        expect(table.props['aria-labelledby']).toBe('nutrients-caption');
        expect(table.props['aria-colcount']).toBe(3);
        expect(table.props['aria-rowcount']).toBe(3);
        expect(screen.getByTestId('nutrients-columnheader-name').props.role).toBe('columnheader');
    });

    /** `rowheader` is the ARIA equivalent of `scope="row"`, and it means the same on both platforms. */
    it('promotes the naming column to a row header and leaves the rest as cells', async () => {
        await renderWithI18n(
            <Table
                testID="nutrients"
                caption="Nutrition per serving"
                columns={columns}
                rows={rows}
                rowKey={(row) => row.key}
            />,
        );

        expect(screen.getByTestId('nutrients-cell-protein-name').props.role).toBe('rowheader');
        expect(screen.getByTestId('nutrients-cell-protein-amount').props.role).toBe('cell');
    });

    it('aligns numeric columns to the trailing edge, never a physical side', async () => {
        await renderWithI18n(
            <Table
                testID="nutrients"
                caption="Nutrition per serving"
                columns={columns}
                rows={rows}
                rowKey={(row) => row.key}
            />,
        );

        expect(screen.getByTestId('nutrients-columnheader-amount').props.className).toContain(
            'text-end',
        );
        expect(screen.getByTestId('nutrients-columnheader-name').props.className).toContain(
            'text-start',
        );
    });

    it('draws column headers demoted and in sentence case rather than as tracked capitals', async () => {
        await renderWithI18n(
            <Table
                testID="nutrients"
                caption="Nutrition per serving"
                columns={columns}
                rows={rows}
                rowKey={(row) => row.key}
            />,
        );

        // A header labels its column; it must not compete with the figures beneath it. The ink is
        // `content-secondary` — the same ink `DataList` gives the same label, so the two header
        // ramps match in colour as well as in size. It was `content-disabled`, which reads as a
        // control nobody can press; a column header is neither disabled nor inert.
        const header = screen.getByTestId('nutrients-columnheader-name').props.className;
        expect(header).toContain('text-content-secondary');
        expect(header).not.toContain('text-content-disabled');

        // It was `uppercase tracking-widest`. Capitals were how a header used to distinguish
        // itself from its column; colour and the ramp do that now, and a header that shouts is one
        // of the five shapes this product used to draw the same demoted label in.
        expect(header).not.toContain('uppercase');
        expect(header).not.toContain('tracking-widest');
    });

    it('puts the admin header on the same step and ink DataList draws', async () => {
        await renderWithI18n(
            <DensityProvider value="compact">
                <Table
                    testID="nutrients"
                    caption="Nutrition per serving"
                    columns={columns}
                    rows={rows}
                    rowKey={(row) => row.key}
                />
            </DensityProvider>,
        );

        // The Catalogue drew two header ramps — `Table` at 12px bold Inter and `DataList` at the
        // `micro` step in Schibsted — often on the same screen. They are one shape now, and this
        // asserts the whole shape rather than one class of it.
        //
        // `label` (12px) rather than `micro` (10px): a header sits on the same step as the cells
        // it names, which are `role-body` at 12px.
        const header = screen.getByTestId('nutrients-columnheader-name').props.className;
        expect(header).toContain('text-role-label');
        expect(header).toContain('text-content-secondary');
        expect(header).not.toContain('uppercase');
        expect(header).not.toContain('tracking-widest');
        // No family class survives anywhere: there is one, set on `html` per script.
        for (const face of ['font-admin', 'font-display', 'font-mono']) {
            expect(header).not.toContain(face);
        }
    });

    it('emphasises the primary numeric column by size and weight, and only that one', async () => {
        const withPrimary = columns.map((column) =>
            column.key === 'amount' ? { ...column, primary: true } : column,
        );
        await renderWithI18n(
            <Table
                testID="nutrients"
                caption="Nutrition per serving"
                columns={withPrimary}
                rows={rows}
                rowKey={(row) => row.key}
            />,
        );

        const key = rows[0]!.key;
        const primary = screen.getByTestId(`nutrients-cell-${key}-amount`).props.className;
        expect(primary).toContain('font-semibold');
        // It was `font-display` — Space Grotesk — a fourth Latin face inside the table, one cell
        // wide. A figure that matters is bigger and heavier, not a different typeface.
        expect(primary).not.toContain('font-display');

        // Two "most important" numbers is none, so the treatment must not leak to its neighbours.
        expect(screen.getByTestId(`nutrients-cell-${key}-target`).props.className).not.toContain(
            'font-semibold',
        );
    });

    it('shows a translated empty message instead of an empty table', async () => {
        await renderWithI18n(
            <Table
                testID="nutrients"
                caption="Nutrition per serving"
                columns={columns}
                rows={[]}
                rowKey={(row: NutrientRow) => row.key}
            />,
        );

        expect(screen.queryByTestId('nutrients-table')).toBeNull();
        expect(screen.getByTestId('nutrients-empty')).toHaveTextContent(
            'There is nothing to show here yet.',
        );
    });
});

describe('Table — sorting', () => {
    /** `name` stays unsortable on purpose: it is what proves `aria-sort` is omitted, not "none". */
    const sortableColumns: readonly TableColumn<NutrientRow>[] = columns.map((column) =>
        column.key === 'name' ? column : { ...column, sortable: true },
    );

    it('puts the state on the header and omits it where there is nothing to sort', async () => {
        await renderWithI18n(
            <Table
                testID="nutrients"
                caption="Nutrition per serving"
                columns={sortableColumns}
                rows={rows}
                rowKey={(row) => row.key}
                sortKey="amount"
                sortDirection="desc"
                onSortChange={jest.fn()}
            />,
        );

        expect(screen.getByTestId('nutrients-columnheader-amount').props['aria-sort']).toBe(
            'descending',
        );
        expect(screen.getByTestId('nutrients-columnheader-target').props['aria-sort']).toBe('none');
        // Not "none" — a column that cannot be sorted must carry no `aria-sort` at all.
        expect(
            screen.getByTestId('nutrients-columnheader-name').props['aria-sort'],
        ).toBeUndefined();
        expect(screen.queryByTestId('nutrients-sort-name')).toBeNull();
    });

    it('names the sort control and reads it as a button', async () => {
        await renderWithI18n(
            <Table
                testID="nutrients"
                caption="Nutrition per serving"
                columns={sortableColumns}
                rows={rows}
                rowKey={(row) => row.key}
                sortKey="amount"
                sortDirection="asc"
                onSortChange={jest.fn()}
            />,
        );

        const button = screen.getByTestId('nutrients-sort-amount');
        expect(button.props.accessibilityRole).toBe('button');
        expect(button.props.accessibilityLabel).toBe('Sort by Amount');
        // Native has no `aria-sort`, so the state has to reach it some other way.
        expect(button.props.accessibilityHint).toBe('Sorted ascending');
        expect(screen.getByTestId('nutrients-sort-target').props.accessibilityHint).toBeUndefined();
    });

    it('toggles the direction when the active column is pressed again', async () => {
        const onSortChange = jest.fn();
        await renderWithI18n(
            <Table
                testID="nutrients"
                caption="Nutrition per serving"
                columns={sortableColumns}
                rows={rows}
                rowKey={(row) => row.key}
                sortKey="amount"
                sortDirection="asc"
                onSortChange={onSortChange}
            />,
        );

        await fireEvent.press(screen.getByTestId('nutrients-sort-amount'));
        expect(onSortChange).toHaveBeenCalledWith('amount', 'desc');
    });

    it('starts a newly chosen column ascending', async () => {
        const onSortChange = jest.fn();
        await renderWithI18n(
            <Table
                testID="nutrients"
                caption="Nutrition per serving"
                columns={sortableColumns}
                rows={rows}
                rowKey={(row) => row.key}
                sortKey="amount"
                sortDirection="desc"
                onSortChange={onSortChange}
            />,
        );

        await fireEvent.press(screen.getByTestId('nutrients-sort-target'));
        expect(onSortChange).toHaveBeenCalledWith('target', 'asc');
    });

    /** Fully controlled: the table reports intent and renders whatever the caller hands back. */
    it('never reorders the rows itself', async () => {
        await renderWithI18n(
            <Table
                testID="nutrients"
                caption="Nutrition per serving"
                columns={sortableColumns}
                rows={rows}
                rowKey={(row) => row.key}
                sortKey="amount"
                sortDirection="desc"
                onSortChange={jest.fn()}
            />,
        );

        const order = screen
            .getAllByTestId(/^nutrients-row-/)
            .map((node) => node.props.testID as string);
        expect(order).toEqual(['nutrients-row-protein', 'nutrients-row-fibre']);
    });

    it('translates the sort control', async () => {
        await renderWithI18n(
            <Table
                testID="nutrients"
                caption="القيم الغذائية"
                columns={sortableColumns}
                rows={rows}
                rowKey={(row) => row.key}
                sortKey="amount"
                sortDirection="desc"
                onSortChange={jest.fn()}
            />,
            'ar',
        );

        expect(screen.getByTestId('nutrients-sort-amount').props.accessibilityLabel).toBe(
            'الترتيب حسب Amount',
        );
        expect(screen.getByTestId('nutrients-sort-amount').props.accessibilityHint).toBe(
            'مرتَّب تنازليًا',
        );
        assertSubtreeIsLogical(screen.getByTestId('nutrients'));
    });

    /** A card list has no column headers, so there is nothing to press and nothing to draw. */
    it('offers no sorting affordance in the stacked presentation', async () => {
        setViewport(390);
        await renderWithI18n(
            <Table
                testID="nutrients"
                caption="Nutrition per serving"
                columns={sortableColumns}
                rows={rows}
                rowKey={(row) => row.key}
                sortKey="amount"
                sortDirection="asc"
                onSortChange={jest.fn()}
            />,
        );

        expect(screen.queryByTestId('nutrients-sort-amount')).toBeNull();
        expect(screen.getByTestId('nutrients-card-protein')).toBeTruthy();
    });
});

describe('Table — row action', () => {
    const rowAction = {
        header: 'Actions',
        render: (row: NutrientRow) => <RNText testID={`action-${row.key}`}>View</RNText>,
    };

    it('is a trailing cell above md, and is counted in the column count', async () => {
        await renderWithI18n(
            <Table
                testID="nutrients"
                caption="Nutrition per serving"
                columns={columns}
                rows={rows}
                rowKey={(row) => row.key}
                rowAction={rowAction}
            />,
        );

        expect(screen.getByTestId('nutrients-table').props['aria-colcount']).toBe(4);
        expect(screen.getByTestId('nutrients-columnheader-action').props.role).toBe('columnheader');
        expect(screen.getByTestId('nutrients-columnheader-action')).toHaveTextContent('Actions');
        expect(screen.getByTestId('nutrients-cell-protein-action').props.role).toBe('cell');
        expect(screen.getByTestId('action-protein')).toHaveTextContent('View');
    });

    it('leaves the column count alone when there is no action', async () => {
        await renderWithI18n(
            <Table
                testID="nutrients"
                caption="Nutrition per serving"
                columns={columns}
                rows={rows}
                rowKey={(row) => row.key}
            />,
        );

        expect(screen.getByTestId('nutrients-table').props['aria-colcount']).toBe(3);
        expect(screen.queryByTestId('nutrients-columnheader-action')).toBeNull();
    });

    it('becomes a footer inside each card below md', async () => {
        setViewport(390);
        await renderWithI18n(
            <Table
                testID="nutrients"
                caption="Nutrition per serving"
                columns={columns}
                rows={rows}
                rowKey={(row) => row.key}
                rowAction={rowAction}
            />,
        );

        expect(screen.queryByTestId('nutrients-table')).toBeNull();
        expect(screen.getByTestId('nutrients-card-protein-action')).toBeTruthy();
        expect(screen.getByTestId('action-fibre')).toHaveTextContent('View');
    });
});

describe('Table — narrow', () => {
    /**
     * The table is *replaced*, not hidden. A hidden copy would stay in the accessibility tree and a
     * screen reader user would meet every figure twice.
     */
    it('becomes stacked cards below md and drops the table entirely', async () => {
        setViewport(390);
        await renderWithI18n(
            <Table
                testID="nutrients"
                caption="Nutrition per serving"
                columns={columns}
                rows={rows}
                rowKey={(row) => row.key}
            />,
        );

        expect(screen.queryByTestId('nutrients-table')).toBeNull();
        expect(screen.getByTestId('nutrients-card-protein')).toBeTruthy();
        expect(screen.getByTestId('name-protein')).toHaveTextContent('Protein');
    });

    it('uses no physical direction utility in either presentation', async () => {
        setViewport(390);
        await renderWithI18n(
            <Table
                testID="nutrients"
                caption="القيم الغذائية"
                columns={columns}
                rows={rows}
                rowKey={(row) => row.key}
            />,
            'ar',
        );
        assertSubtreeIsLogical(screen.getByTestId('nutrients'));

        setViewport(1280);
        await renderWithI18n(
            <Table
                testID="wide"
                caption="القيم الغذائية"
                columns={columns}
                rows={rows}
                rowKey={(row) => row.key}
            />,
            'ar',
        );
        assertSubtreeIsLogical(screen.getByTestId('wide'));
    });
});

describe('MeterBar', () => {
    it('is a progress bar with visible figures and its own value text', async () => {
        await renderWithI18n(
            <MeterBar testID="protein" label="Protein" value={96} target={120} unit="g" />,
        );

        const node = screen.getByTestId('protein');
        expect(node.props.role).toBe('progressbar');
        expect(node.props['aria-valuenow']).toBe(96);
        expect(node.props['aria-valuemax']).toBe(120);
        expect(node.props['aria-valuetext']).toBe('96 / 120 g');
        expect(screen.getByTestId('protein-value')).toHaveTextContent('96 / 120 g');
    });

    it('fills in proportion, from the leading edge', async () => {
        await renderWithI18n(<MeterBar testID="protein" label="Protein" value={60} target={120} />);

        expect(screen.getByTestId('protein-fill').props.style).toMatchObject({ width: '50%' });
        expect(screen.getByTestId('protein-track').props.className).toContain('flex-row');
    });

    it('never lets a nutrition level speak through colour alone', async () => {
        await renderWithI18n(
            <MeterBar
                testID="protein"
                label="Protein"
                value={200}
                target={120}
                level="excessive"
                levelLabel="Excessive"
            />,
        );

        // Five marks for the fifth stop — an ordinal signal that survives greyscale.
        expect(screen.getByTestId('protein-pattern')).toHaveTextContent('▮▮▮▮▮');
        expect(screen.getByTestId('protein-level')).toHaveTextContent('Excessive');
    });

    it('clamps the fill rather than overflowing when the target is exceeded', async () => {
        await renderWithI18n(
            <MeterBar testID="protein" label="Protein" value={400} target={120} />,
        );
        expect(screen.getByTestId('protein-fill').props.style).toMatchObject({ width: '100%' });
    });

    it('survives a zero or missing target without dividing by zero', async () => {
        await renderWithI18n(<MeterBar testID="protein" label="Protein" value={30} target={0} />);
        expect(screen.getByTestId('protein-fill').props.style).toMatchObject({ width: '0%' });
    });
});

describe('ProgressRing', () => {
    it('is a progress bar with an always-visible numeric label', async () => {
        await renderWithI18n(
            <ProgressRing
                testID="energy"
                label="Energy against target"
                value={1050}
                target={2100}
                unit="kcal"
            />,
        );

        const node = screen.getByTestId('energy');
        expect(node.props.role).toBe('progressbar');
        expect(node.props['aria-valuetext']).toBe('1050 / 2100 kcal');
        expect(screen.getByTestId('energy-value')).toHaveTextContent('50%');
    });

    it('fills exactly half its ticks at half the target', async () => {
        await renderWithI18n(
            <ProgressRing testID="energy" label="Energy" value={1050} target={2100} />,
        );

        expect(screen.getByTestId('energy-tick-11-on')).toBeTruthy();
        expect(screen.getByTestId('energy-tick-12-off')).toBeTruthy();
    });

    /**
     * A meter that fills "forwards" must fill the way the reader reads. Only the *sign* of the
     * rotation changes: the geometry, the ticks and the label are identical in both directions.
     */
    it('sweeps clockwise in English and anticlockwise in Arabic', async () => {
        await renderWithI18n(
            <ProgressRing testID="ltr" label="Energy" value={525} target={2100} />,
            'en',
        );
        expect(screen.getByTestId('ltr-sector-1').props.style).toMatchObject({
            transform: [{ rotate: '15deg' }],
        });

        await renderWithI18n(
            <ProgressRing testID="rtl" label="الطاقة" value={525} target={2100} />,
            'ar',
        );
        expect(screen.getByTestId('rtl-sector-1').props.style).toMatchObject({
            transform: [{ rotate: '-15deg' }],
        });
    });

    /*
     * The defect this pins: four lines of prose were centred inside the ring, in a box the width of
     * the ring's *square* rather than its *hole*, so "Outside the published range" laid out across
     * the ticks on both sides and the panel read as one thing printed over another.
     *
     * Two separate guarantees, because either alone would let it back:
     *  - the circle holds the figure and nothing else, so nothing prose-length is in there at all;
     *  - the figure is bounded by the clear space inside the ring, so even it cannot reach a tick.
     */
    it('keeps prose out of the circle and bounds the figure to its clear space', async () => {
        await renderWithI18n(
            <ProgressRing
                testID="energy"
                label="Energy"
                value={1000}
                target={2100}
                level="moderate"
                caption="of your energy target"
                levelLabel="Outside the published range"
            />,
        );

        const circle = screen.getByTestId('energy-sector-0').parent;
        const inside = (id: string) => {
            let node = screen.getByTestId(id).parent;
            while (node !== null) {
                if (node === circle) return true;
                node = node.parent;
            }
            return false;
        };

        expect(inside('energy-value')).toBe(true);
        expect(inside('energy-caption')).toBe(false);
        expect(inside('energy-level')).toBe(false);
        expect(inside('energy-pattern')).toBe(false);

        // `md` is 96 across with an 8 tick at each edge, so the hole is 80 — and the figure is
        // given less than that rather than the full square it used to spread across.
        const width = screen.getByTestId('energy-value').props.style.maxWidth as number;
        expect(width).toBeLessThan(96 - 8 * 2);
    });

    it('carries the nutrition pattern as well as the tone', async () => {
        await renderWithI18n(
            <ProgressRing
                testID="energy"
                label="Energy"
                value={1000}
                target={2100}
                level="moderate"
            />,
        );

        expect(screen.getByTestId('energy-pattern')).toHaveTextContent('▮▮▮');
    });

    it('uses no physical direction utility anywhere in its tree', async () => {
        await renderWithI18n(
            <ProgressRing testID="energy" label="الطاقة" value={900} target={2100} />,
            'ar',
        );
        assertSubtreeIsLogical(screen.getByTestId('energy'));
    });
});

describe('Rating', () => {
    it('always renders the figure, never only the glyphs', async () => {
        await renderWithI18n(
            <Rating testID="stars" label="Average kitchen rating" value={4.6} count={128} />,
        );

        expect(screen.getByTestId('stars-value')).toHaveTextContent('4.6 out of 5');
        expect(screen.getByTestId('stars-count')).toHaveTextContent('128 ratings');
    });

    it('hides the glyph row from assistive technology', async () => {
        await renderWithI18n(<Rating testID="stars" label="Rating" value={3} />);

        expect(screen.getByTestId('stars-glyphs').props['aria-hidden']).toBe(true);
    });

    it('clamps a value outside the scale', async () => {
        await renderWithI18n(<Rating testID="stars" label="Rating" value={9} max={5} />);
        expect(screen.getByTestId('stars-value')).toHaveTextContent('5.0 out of 5');
    });

    it('translates its summary', async () => {
        await renderWithI18n(<Rating testID="stars" label="التقييم" value={4} />, 'ar');
        expect(screen.getByTestId('stars-value')).toHaveTextContent('4.0 من 5');
    });

    it('draws one glyph and the bare value when compact, and still announces the scale', async () => {
        await renderWithI18n(
            <Rating testID="stars" label="Average kitchen rating" value={4.8} size="sm" compact />,
        );

        // The figure is still visible text — the glyph beside it is a mark, not the measurement.
        expect(screen.getByTestId('stars-value')).toHaveTextContent('4.8');
        expect(screen.getByTestId('stars').props.accessibilityLabel).toBe(
            'Average kitchen rating: 4.8 out of 5',
        );
    });

    it('is not pressable — rating submission is not built', async () => {
        await renderWithI18n(<Rating testID="stars" label="Rating" value={4} />);
        expect(screen.getByTestId('stars').props.onPress).toBeUndefined();
    });
});

describe('CalendarGrid', () => {
    const days: readonly CalendarDay[] = [
        { key: 'mon', label: 'Monday 3 August', shortLabel: 'Mon' },
        { key: 'tue', label: 'Tuesday 4 August', shortLabel: 'Tue', today: true },
    ];
    const slots: readonly CalendarSlot[] = [
        { key: 'breakfast', label: 'Breakfast' },
        { key: 'lunch', label: 'Lunch' },
    ];

    it('lays days out as flex-row columns in the order the caller supplied', async () => {
        await renderWithI18n(
            <CalendarGrid
                testID="week"
                label="Week of 3 August"
                days={days}
                slots={slots}
                renderCell={({ day, slot }) => (
                    <RNText testID={`entry-${day.key}-${slot?.key ?? 'none'}`}>entry</RNText>
                )}
            />,
        );

        expect(screen.getByTestId('week-day-mon').props.role).toBe('group');
        expect(screen.getByTestId('week-day-mon').props['aria-label']).toBe('Monday 3 August');
        expect(screen.getByTestId('week-day-mon').props.className).toContain('flex-1');
        expect(screen.getByTestId('entry-tue-lunch')).toBeTruthy();
    });

    it('renders one cell per day and slot', async () => {
        await renderWithI18n(
            <CalendarGrid
                testID="week"
                label="Week"
                days={days}
                slots={slots}
                renderCell={({ day, slot }) => (
                    <RNText testID={`entry-${day.key}-${slot?.key ?? 'none'}`}>entry</RNText>
                )}
            />,
        );

        expect(screen.getAllByText('entry')).toHaveLength(4);
    });

    it('works without slots at all', async () => {
        await renderWithI18n(
            <CalendarGrid
                testID="week"
                label="Week"
                days={days}
                renderCell={({ day }) => <RNText testID={`entry-${day.key}`}>entry</RNText>}
            />,
        );

        expect(screen.getByTestId('entry-mon')).toBeTruthy();
        expect(screen.queryByTestId('week-slot-legend')).toBeNull();
    });

    it('lets the caller own the day header entirely', async () => {
        await renderWithI18n(
            <CalendarGrid
                testID="week"
                label="Week"
                days={days}
                renderDayHeader={(day) => <RNText testID={`head-${day.key}`}>{day.label}</RNText>}
                renderCell={() => null}
            />,
        );

        expect(screen.getByTestId('head-mon')).toHaveTextContent('Monday 3 August');
    });

    /** No absolute positioning and no physical inset — the two ways a calendar breaks in Arabic. */
    it('uses no physical direction utility anywhere in its tree', async () => {
        await renderWithI18n(
            <CalendarGrid
                testID="week"
                label="أسبوع"
                days={days}
                slots={slots}
                renderCell={() => null}
            />,
            'ar',
        );
        assertSubtreeIsLogical(screen.getByTestId('week'));
    });
});
