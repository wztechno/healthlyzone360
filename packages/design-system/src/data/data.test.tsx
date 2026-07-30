import { screen } from '@testing-library/react-native';
import { Text as RNText, useWindowDimensions } from 'react-native';

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
