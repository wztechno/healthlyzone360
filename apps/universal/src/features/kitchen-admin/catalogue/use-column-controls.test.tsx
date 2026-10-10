import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { Text, View } from 'react-native';

import { compareDisplayed, leadingNumber, useColumnControls } from './use-column-controls.tsx';
import type { ColumnControlsOptions, ControlledColumn } from './use-column-controls.tsx';

/**
 * The column controls' default: every column of an in-memory table sorts, whether it says how or
 * not — the rule that keeps a newly added column from shipping without an arrow, the way Quantity
 * and Line total on the purchases ledger did.
 */

interface Line {
    readonly id: string;
    readonly name: string;
    readonly total: string;
    readonly note: string;
}

const LINES: readonly Line[] = [
    { id: 'a', name: 'Flour', total: '999.00 USD', note: 'kept' },
    { id: 'b', name: 'Butter', total: '1,234.50 USD', note: 'kept' },
    { id: 'c', name: 'Salt', total: '—', note: 'kept' },
    { id: 'd', name: 'Eggs', total: '12.00 USD', note: 'kept' },
];

const COLUMNS: readonly ControlledColumn<Line>[] = [
    { key: 'name', label: 'Item', width: 200, priority: 100, value: (row) => row.name },
    { key: 'total', label: 'Total', width: 120, priority: 90, value: (row) => row.total },
    {
        key: 'note',
        label: 'Note',
        width: 120,
        priority: 80,
        value: (row) => row.note,
        sort: false,
    },
];

function Harness({ options }: { readonly options?: ColumnControlsOptions }) {
    const controls = useColumnControls(LINES, COLUMNS, 'lines', options);
    return (
        <View>
            {controls.columns.map((column) => (
                <View key={column.key}>{column.renderHeader?.() ?? null}</View>
            ))}
            <Text testID="order">{controls.rows.map((row) => row.id).join(',')}</Text>
        </View>
    );
}

describe('every column of an in-memory table sorts', () => {
    it('sorts a column that states only its value, numbers as numbers and blanks last', async () => {
        await render(<Harness />);

        // No comparator anywhere on these columns, and both still sort.
        expect(screen.getByTestId('lines-column-name-trigger')).toBeTruthy();
        await act(async () => {
            fireEvent.press(screen.getByTestId('lines-column-total-trigger'));
        });
        // 12 < 999 < 1,234.50 — a text sort would put "1,234.50" first — and the dash last.
        expect(screen.getByTestId('order')).toHaveTextContent('d,a,b,c');

        await act(async () => {
            fireEvent.press(screen.getByTestId('lines-column-total-trigger'));
        });
        expect(screen.getByTestId('order')).toHaveTextContent('b,a,d,c');
    });

    it('leaves a column that opts out, and a server-sorted table, without an arrow', async () => {
        await render(<Harness />);
        expect(screen.queryByTestId('lines-column-note-trigger')).toBeNull();

        await render(
            <Harness options={{ sort: { key: null, direction: 'asc', onChange: jest.fn() } }} />,
        );
        // The server owns the order there, and only the screen knows what it can order by.
        expect(screen.queryByTestId('lines-column-total-trigger')).toBeNull();
    });
});

describe('compareDisplayed', () => {
    it('reads the leading figure in either script, past grouping and a unit', () => {
        expect(leadingNumber('1,234.50 USD')).toBe(1234.5);
        expect(leadingNumber('١٬٢٣٤٫٥ USD')).toBe(1234.5);
        expect(leadingNumber('Kg')).toBeNull();
        expect(compareDisplayed('9 kg', '10 kg', 'asc')).toBeLessThan(0);
        expect(compareDisplayed('Butter', 'flour', 'asc')).toBeLessThan(0);
        expect(compareDisplayed('—', '1', 'asc')).toBeGreaterThan(0);
        expect(compareDisplayed('—', '1', 'desc')).toBeGreaterThan(0);
    });
});
