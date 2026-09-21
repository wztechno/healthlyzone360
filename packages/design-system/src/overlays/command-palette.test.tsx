import { act, fireEvent, screen } from '@testing-library/react-native';

import { renderWithI18n } from '../testing/render.tsx';
import { CommandPalette, filterCommandItems } from './command-palette.tsx';
import type { CommandPaletteItem } from './command-palette.tsx';

const noop = () => undefined;

const ITEMS: readonly CommandPaletteItem[] = [
    { key: 'overview', label: 'Overview', icon: 'dashboard', onSelect: noop },
    { key: 'ingredients', label: 'Ingredients', icon: 'wheat', group: 'Catalogue', onSelect: noop },
    { key: 'recipes', label: 'Recipes', icon: 'bookOpen', group: 'Catalogue', onSelect: noop },
    { key: 'orders', label: 'Orders', icon: 'receipt', group: 'Operations', onSelect: noop },
    {
        key: 'supply',
        label: 'Supply orders',
        group: 'Operations',
        keywords: ['purchase'],
        onSelect: noop,
    },
    { key: 'creme', label: 'Crème brûlée', group: 'Catalogue', onSelect: noop },
];

const keys = (items: readonly CommandPaletteItem[]) => items.map((item) => item.key);

describe('filterCommandItems', () => {
    it('returns everything, in order, for an empty query', () => {
        expect(keys(filterCommandItems(ITEMS, '  '))).toEqual(keys(ITEMS));
    });

    it('matches labels case-insensitively and ranks a label that starts with the query first', () => {
        expect(keys(filterCommandItems(ITEMS, 'ORDERS'))).toEqual(['orders', 'supply']);
    });

    it('matches the group and the keywords as well as the label', () => {
        expect(keys(filterCommandItems(ITEMS, 'catalogue rec'))).toEqual(['recipes']);
        expect(keys(filterCommandItems(ITEMS, 'purchase'))).toEqual(['supply']);
    });

    it('ignores accents', () => {
        expect(keys(filterCommandItems(ITEMS, 'creme brulee'))).toEqual(['creme']);
    });
});

describe('CommandPalette', () => {
    const hints = { move: 'to move', open: 'to open', close: 'to close' };

    it('lists the items under their groups and opens the highlighted one on Enter', async () => {
        const onSelect = jest.fn();
        const onClose = jest.fn();
        await renderWithI18n(
            <CommandPalette
                open
                onClose={onClose}
                items={ITEMS.map((item) =>
                    item.key === 'recipes' ? { ...item, onSelect } : item,
                )}
                label="Search pages"
                placeholder="Type to search pages…"
                emptyText={(query) => `Nothing for ${query}`}
                hints={hints}
            />,
        );

        expect(screen.getByText('Catalogue')).toBeTruthy();
        expect(screen.getByText('Operations')).toBeTruthy();

        await act(async () => {
            fireEvent.changeText(screen.getByTestId('command-palette-input'), 'rec');
        });
        expect(
            screen.getByTestId('command-palette-item-recipes').props.accessibilityState,
        ).toEqual(expect.objectContaining({ selected: true }));

        await act(async () => {
            fireEvent(screen.getByTestId('command-palette-input'), 'submitEditing');
        });
        expect(onClose).toHaveBeenCalled();
        expect(onSelect).toHaveBeenCalled();
    });

    it('moves the highlight with the arrow keys, wrapping at the ends', async () => {
        await renderWithI18n(
            <CommandPalette
                open
                onClose={noop}
                items={ITEMS}
                label="Search pages"
                placeholder="Type to search pages…"
                emptyText={(query) => `Nothing for ${query}`}
                hints={hints}
            />,
        );
        const input = screen.getByTestId('command-palette-input');
        const selected = (key: string) =>
            screen.getByTestId(`command-palette-item-${key}`).props.accessibilityState.selected;

        expect(selected('overview')).toBe(true);
        await act(async () => {
            fireEvent(input, 'keyPress', { nativeEvent: { key: 'ArrowDown' } });
        });
        expect(selected('ingredients')).toBe(true);
        await act(async () => {
            fireEvent(input, 'keyPress', { nativeEvent: { key: 'ArrowUp' } });
            fireEvent(input, 'keyPress', { nativeEvent: { key: 'ArrowUp' } });
        });
        expect(selected('supply')).toBe(true);
    });

    it('says so when nothing matches', async () => {
        await renderWithI18n(
            <CommandPalette
                open
                onClose={noop}
                items={ITEMS}
                label="Search pages"
                placeholder="Type to search pages…"
                emptyText={(query) => `Nothing for ${query}`}
                hints={hints}
            />,
        );
        await act(async () => {
            fireEvent.changeText(screen.getByTestId('command-palette-input'), 'zzz');
        });
        expect(screen.getByTestId('command-palette-empty')).toHaveTextContent('Nothing for zzz');
    });
});
