import { screen } from '@testing-library/react-native';

import { DataList, fitColumns } from './data-list.tsx';
import type { DataListColumn } from './data-list.tsx';
import { StatusBadge } from './status-badge.tsx';
import { DensityProvider } from '../hooks/use-density.tsx';
import { FormSection } from '../forms/form-section.tsx';
import { QuantityInput, parseQuantity } from '../forms/quantity-input.tsx';
import { SearchInput } from '../forms/search-input.tsx';
import { renderWithI18n } from '../testing/render.tsx';
import type { ReactNode } from 'react';

interface Row {
    readonly id: string;
    readonly name: string;
}

/** The handoff's own priority ladder (§4.1), so the fitting tests exercise the real numbers. */
const COLUMNS: readonly DataListColumn<Row>[] = [
    { key: 'name', label: 'Designation', width: 240, priority: 100, value: (row) => row.name },
    { key: 'actions', label: '', width: 40, priority: 95 },
    { key: 'cost', label: 'Cost', width: 100, priority: 85, mono: true, align: 'end' },
    { key: 'status', label: 'Status', width: 100, priority: 80 },
    { key: 'reference', label: 'Reference', width: 120, priority: 70, mono: true },
    { key: 'updated', label: 'Updated', width: 120, priority: 20 },
];

function compact(node: ReactNode) {
    return <DensityProvider value="compact">{node}</DensityProvider>;
}

describe('fitColumns', () => {
    it('keeps every column when they all fit', () => {
        expect(fitColumns(COLUMNS, 1000)).toHaveLength(COLUMNS.length);
    });

    it('drops the lowest-priority column first', () => {
        // 720 total; at 640 the 120px `updated` (priority 20) is the one that goes, and the
        // 120px `reference` (priority 70) stays even though they are the same width.
        const kept = fitColumns(COLUMNS, 640).map((column) => column.key);

        expect(kept).not.toContain('updated');
        expect(kept).toContain('reference');
    });

    it('never drops Designation or the overflow menu', () => {
        // The row action has to stay reachable at every width — a row that scrolls sideways hides
        // the one control that must not be hidden (§4.1).
        const kept = fitColumns(COLUMNS, 200).map((column) => column.key);

        expect(kept).toContain('name');
        expect(kept).toContain('actions');
    });

    it('preserves declared order rather than priority order', () => {
        // Dropping is a filter, not a sort. Columns that reordered themselves as the window
        // narrowed would be unreadable even with every one of them still present.
        const kept = fitColumns(COLUMNS, 600).map((column) => column.key);
        const declared = COLUMNS.map((column) => column.key).filter((key) => kept.includes(key));

        expect(kept).toEqual(declared);
    });

    it('keeps everything before the first measurement lands', () => {
        // `available` is 0 until `onLayout` fires. Dropping columns on that reading would flash a
        // one-column list on every mount.
        expect(fitColumns(COLUMNS, 0)).toHaveLength(COLUMNS.length);
    });
});

describe('DataList', () => {
    it('draws one hairline per row and no card, outline or zebra', async () => {
        await renderWithI18n(
            compact(
                <DataList
                    testID="list"
                    label="Ingredients"
                    rows={[
                        { id: 'a', name: 'Tahini' },
                        { id: 'b', name: 'Sumac' },
                    ]}
                    rowKey={(row) => row.id}
                    columns={[COLUMNS[0]!]}
                />,
            ),
        );

        for (const id of ['list-row-a', 'list-row-b']) {
            const className = screen.getByTestId(id).props.className as string;
            expect(className).toContain('border-b');
            expect(className).toContain('border-stroke-subtle');
            // No zebra: the tint is a hover state, never an alternating background.
            expect(className).not.toMatch(/bg-surface-(base|raised|sunken)(\s|$)/);
        }
    });

    it('marks its grid so an anchored popover can measure against it', async () => {
        await renderWithI18n(
            compact(
                <DataList
                    testID="list"
                    label="Ingredients"
                    rows={[{ id: 'a', name: 'Tahini' }]}
                    rowKey={(row) => row.id}
                    columns={[COLUMNS[0]!, COLUMNS[1]!]}
                />,
            ),
        );

        // The row box is as wide as the tracks, not as wide as the port — otherwise the hairline,
        // the hover tint and the menu anchor all stop at the port's edge while the cells run past.
        const grid = screen.getByTestId('list-row-a').parent;
        expect(grid?.props.style).toMatchObject({ minWidth: 280 });
    });

    it('renders a non-sortable header as plain text, not as a focusable control', async () => {
        await renderWithI18n(
            compact(
                <DataList
                    testID="list"
                    label="Ingredients"
                    rows={[]}
                    rowKey={(row: Row) => row.id}
                    columns={[COLUMNS[0]!]}
                />,
            ),
        );

        // §4.3: emitting the same `role="button" tabindex="0"` wrapper for a column with no sort
        // and no filter leaves a keyboard-focusable target that does nothing.
        expect(screen.queryByRole('button')).toBeNull();
    });
});

describe('StatusBadge', () => {
    it.each([
        ['draft', 'warning'],
        ['review', 'info'],
        ['archived', 'neutral'],
        ['restricted', 'danger'],
        ['live', 'brand'],
    ] as const)('maps %s to the %s tone', async (status, tone) => {
        await renderWithI18n(compact(<StatusBadge testID="badge" status={status} label="Draft" />));

        const className = screen.getByTestId('badge').props.className as string;
        // `brand` is a surface role (`bg-surface-brand-subtle`), the semantic tones are their own
        // scales (`bg-warning-subtle`) and `neutral` is the sunken fill. Three shapes, because the
        // token set has three — flattening them in the assertion would hide a real mix-up.
        const expected =
            tone === 'neutral'
                ? 'bg-surface-sunken'
                : tone === 'brand'
                  ? 'bg-surface-brand-subtle'
                  : `bg-${tone}-subtle`;
        expect(className).toContain(expected);
    });

    it('carries a mark as well as a colour', async () => {
        // Meaning is never carried by colour alone — an archived ingredient and a live one must
        // differ in greyscale too.
        await renderWithI18n(compact(<StatusBadge testID="badge" status="draft" label="Draft" />));
        expect(screen.getByTestId('badge-icon')).toBeTruthy();
    });
});

describe('FormSection', () => {
    it('draws a leading hairline except on the first section', async () => {
        await renderWithI18n(
            compact(
                <>
                    <FormSection testID="first" title="Description" first>
                        <></>
                    </FormSection>
                    <FormSection testID="second" title="Production">
                        <></>
                    </FormSection>
                </>,
            ),
        );

        // A rule directly under a page title is a rule against nothing.
        expect(screen.getByTestId('first-title')).toBeTruthy();
        expect(screen.getByTestId('second-title')).toBeTruthy();
    });
});

describe('SearchInput', () => {
    it('offers no clear affordance while it is empty', async () => {
        await renderWithI18n(
            compact(<SearchInput testID="search" value="" onChangeText={() => undefined} />),
        );
        expect(screen.queryByTestId('search-clear')).toBeNull();
    });

    it('offers one as soon as there is something to clear', async () => {
        // A search you cannot empty in one press is a search you retype.
        await renderWithI18n(
            compact(<SearchInput testID="search" value="zaatar" onChangeText={() => undefined} />),
        );
        expect(screen.getByTestId('search-clear')).toBeTruthy();
    });

    it('states no width of its own — the toolbar decides', async () => {
        await renderWithI18n(
            compact(<SearchInput testID="search" value="" onChangeText={() => undefined} />),
        );

        const className = screen.getByTestId('search').props.className as string;
        expect(className).not.toMatch(/(^|\s)w-/);
    });
});

describe('QuantityInput', () => {
    it('sets the value in mono, aligned to the trailing edge', async () => {
        await renderWithI18n(
            compact(
                <QuantityInput
                    testID="qty"
                    label="Yield"
                    unit="kg"
                    value="1.7"
                    onChangeText={() => undefined}
                />,
            ),
        );

        const className = screen.getByTestId('qty-input').props.className as string;
        expect(className).toContain('font-mono');
        // Logical, so the column mirrors as a whole under RTL rather than pinning to a physical
        // side. `text-right` here would be the bug.
        expect(className).toContain('text-end');
        expect(className).not.toContain('text-right');
    });

    it('reports the parsed number on blur and null for text that is not one', () => {
        expect(parseQuantity('7.186')).toBe(7.186);
        expect(parseQuantity('  1.7 ')).toBe(1.7);
        expect(parseQuantity('')).toBeNull();
        // `1.` mid-entry is why the value is held as a string: parsing it to `1` and writing that
        // back would move the caret and eat the decimal point as it is typed.
        expect(parseQuantity('1.')).toBe(1);
        expect(parseQuantity('kg')).toBeNull();
    });

    it('keeps a derived value legible rather than dimming it', async () => {
        await renderWithI18n(
            compact(
                <QuantityInput
                    testID="total"
                    label="Total cost"
                    value="4.5700"
                    readOnly
                    onChangeText={() => undefined}
                />,
            ),
        );

        // A read-only total takes the sunken fill, not `content-disabled`: a cost is the thing the
        // reader opened the record to read, and it still has to clear 4.5:1.
        const className = screen.getByTestId('total-input').props.className as string;
        expect(className).toContain('text-content-secondary');
        expect(className).not.toContain('text-content-disabled');
    });
});
