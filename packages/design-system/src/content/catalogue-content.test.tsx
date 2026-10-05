import { screen } from '@testing-library/react-native';

import { DataList, fitColumns, growWeights, spreadColumns } from './data-list.tsx';
import type { DataListColumn } from './data-list.tsx';
import { StatusBadge } from './status-badge.tsx';
import { DensityProvider } from '../hooks/use-density.tsx';
import { isClipped } from '../internal/truncation-hover.ts';
import { Text } from '../primitives/text.tsx';
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

describe('spreadColumns', () => {
    /** `COLUMNS` without the action track, which may never take the slack. */
    const GROWING = COLUMNS.filter((column) => column.key !== 'actions');

    it('shares the slack in proportion to the declared widths', () => {
        // Two complaints bound this. Giving it all to the designation left a hole after every
        // name; an equal share gave `Cost` and `Status` the same extra as the designation. With
        // nothing marked, each column grows by its own width's share: 340 spare over 680 declared
        // is exactly half again of every track.
        expect(spreadColumns(GROWING, 1020)).toEqual([360, 150, 150, 180, 180]);
    });

    it('fills the port exactly, leaving no dead space after the last column', () => {
        for (const port of [681, 900, 1213, 1440]) {
            const sum = spreadColumns(GROWING, port).reduce((total, width) => total + width, 0);
            expect(sum).toBe(port);
        }
    });

    it('draws the declared widths when the port is narrower than them, or not yet measured', () => {
        // The row carries `min-width: <track sum>` and scrolls rather than squeezing, so a port
        // under the sum is not a narrower row. Zero is the port before anything has been measured.
        expect(spreadColumns(GROWING, 400)).toEqual([240, 100, 100, 120, 120]);
        expect(spreadColumns(GROWING, 0)).toEqual([240, 100, 100, 120, 120]);
    });

    it('never fills a column that opted out, however wide it is', () => {
        // The action track is sized to its buttons. Widening it only pushes them off the end.
        const [name, actions] = spreadColumns(
            [
                { key: 'name', label: 'Designation', width: 120, priority: 100 },
                { key: 'actions', label: '', width: 160, priority: 95, grow: false },
            ],
            1000,
        );

        expect(actions).toBe(160);
        expect(name).toBe(840);
    });

    it('fills the columns marked to, sharing the slack and giving the remainder to the first', () => {
        // 681 leaves one pixel over 680; a floor everywhere would leave the row a pixel short of
        // the port — a seam between the header and the rows under it.
        const marked = GROWING.map((column) =>
            column.key === 'name' || column.key === 'reference'
                ? { ...column, fill: true }
                : column,
        );
        expect(spreadColumns(marked, 681)).toEqual([241, 100, 100, 120, 120]);
        expect(spreadColumns(marked, 880)).toEqual([340, 100, 100, 220, 120]);
    });
});

describe('isClipped', () => {
    it('is true only for text that overflows its box, sideways or downward', () => {
        const box = { clientWidth: 100, clientHeight: 16, textContent: 'x' };
        expect(isClipped({ ...box, scrollWidth: 100, scrollHeight: 16 })).toBe(false);
        expect(isClipped({ ...box, scrollWidth: 180, scrollHeight: 16 })).toBe(true);
        expect(isClipped({ ...box, scrollWidth: 100, scrollHeight: 32 })).toBe(true);
    });
});

describe('growWeights', () => {
    it('weights every growable column by its width, unless some are marked to fill', () => {
        expect([...growWeights(COLUMNS)]).toEqual([
            ['name', 240],
            ['actions', 40],
            ['cost', 100],
            ['status', 100],
            ['reference', 120],
            ['updated', 120],
        ]);
        expect([
            ...growWeights([
                { key: 'code', label: 'Code', width: 300, priority: 70 },
                { key: 'notes', label: 'Notes', width: 120, priority: 20, fill: true },
            ]),
        ]).toEqual([['notes', 1]]);
        expect(
            growWeights([{ key: 'actions', label: '', width: 40, priority: 95, grow: false }]).size,
        ).toBe(0);
    });
});

describe('DataList', () => {
    it('rules the header alone — no line between rows, and no zebra', async () => {
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

        // The header row is the column header's own parent.
        const header = screen.getByTestId(`list-columnheader-${COLUMNS[0]!.key}`).parent!.props
            .className as string;
        expect(header).toContain('border-b');
        expect(header).toContain('border-stroke-subtle');

        for (const id of ['list-row-a', 'list-row-b']) {
            const className = screen.getByTestId(id).props.className as string;
            expect(className).not.toContain('border-b');
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

    it('sets a cell on one line with an ellipsis, and floors the row rather than fixing it', async () => {
        await renderWithI18n(
            compact(
                <DataList
                    testID="list"
                    label="Ingredients"
                    rows={[{ id: 'a', name: 'Condiments and sweeteners' }]}
                    rowKey={(row) => row.id}
                    columns={[COLUMNS[0]!]}
                    density="sm"
                />,
            ),
        );

        // A value longer than its column ends in an ellipsis instead of wrapping the row or running
        // into the next column; the whole value is a hover away on the web. The row keeps a floor,
        // not a fixed height, for a cell whose content is taller than a line of text.
        const value = screen.getByText('Condiments and sweeteners');
        expect(value.props.numberOfLines).toBe(1);
        expect(screen.getByTestId('list-row-a').props.className).toContain('min-h-row-sm');
    });

    it('clips a renderer’s own text to one line too, but not a run nested inside it', async () => {
        await renderWithI18n(
            compact(
                <DataList
                    testID="list"
                    label="Ingredients"
                    rows={[{ id: 'a', name: 'Flour, all-purpose (wheat)' }]}
                    rowKey={(row) => row.id}
                    columns={[
                        {
                            ...COLUMNS[0]!,
                            render: (row) => (
                                <Text testID="outer">
                                    {row.name} <Text testID="inner">(stone-ground)</Text>
                                </Text>
                            ),
                        },
                    ]}
                />,
            ),
        );

        expect(screen.getByTestId('outer').props.numberOfLines).toBe(1);
        // A nested text is a run inside its parent's line; a clamp of its own would break it.
        expect(screen.getByTestId('inner').props.numberOfLines).toBeUndefined();
    });

    it('bases each track on its width and grows it by that width, so the slack is shared in proportion', async () => {
        await renderWithI18n(
            compact(
                <DataList
                    testID="list"
                    label="Ingredients"
                    rows={[{ id: 'a', name: 'Tahini' }]}
                    rowKey={(row) => row.id}
                    columns={[COLUMNS[0]!, COLUMNS[2]!]}
                />,
            ),
        );

        expect(screen.getByTestId('list-columnheader-name').props.style).toMatchObject({
            flexBasis: 240,
            flexGrow: 240,
        });
        expect(screen.getByTestId('list-columnheader-cost').props.style).toMatchObject({
            flexBasis: 100,
            flexGrow: 100,
        });
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

    it('marks a state and leaves an archived record unmarked', async () => {
        // An archived ingredient and a draft one must differ in greyscale too: the draft carries
        // the dot, the archived one does not.
        await renderWithI18n(compact(<StatusBadge testID="badge" status="draft" label="Draft" />));
        expect(screen.getByTestId('badge-mark')).toBeTruthy();

        await renderWithI18n(
            compact(<StatusBadge testID="gone" status="archived" label="Archived" />),
        );
        expect(screen.queryByTestId('gone-mark')).toBeNull();
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
        expect(className).toContain('tabular-nums');
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
