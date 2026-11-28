import { fireEvent, screen } from '@testing-library/react-native';

import { renderWithI18n } from '../testing/render.tsx';
import { SEARCH_THRESHOLD, resolveNarrow, resolveSearchable } from './select-shared.ts';
import { Select } from './select.web.tsx';

/**
 * The admin's one dropdown (2026-11-26): `Select`'s web half in the `card` look, opened from a field
 * or a toolbar pill, with the filter box turning itself on for a long list.
 */

const units = [
    { value: 'kg', label: 'kg' },
    { value: 'l', label: 'L' },
    { value: 'pc', label: 'Pc' },
];

const cheeses = Array.from({ length: SEARCH_THRESHOLD + 1 }, (_, index) => ({
    value: `cheese-${String(index)}`,
    label: `Cheese ${String(index)}`,
    description: 'Dairy',
    section: 'Raw materials',
}));

describe('resolveSearchable', () => {
    it('turns the filter on past the threshold in the card look', () => {
        expect(resolveSearchable(undefined, 'card', SEARCH_THRESHOLD)).toBe(false);
        expect(resolveSearchable(undefined, 'card', SEARCH_THRESHOLD + 1)).toBe(true);
    });

    it('keeps the field look off unless asked, so the shop is unchanged', () => {
        expect(resolveSearchable(undefined, 'field', 50)).toBe(false);
        expect(resolveSearchable('auto', 'field', 50)).toBe(true);
    });

    it('always shows the box on a list that adds what was typed', () => {
        expect(resolveSearchable(undefined, 'card', 2, true)).toBe(true);
        expect(resolveSearchable(false, 'card', 2, true)).toBe(false);
    });

    it('lets a page force either answer', () => {
        expect(resolveSearchable(true, 'card', 2)).toBe(true);
        expect(resolveSearchable(false, 'card', 50)).toBe(false);
    });
});

describe('resolveNarrow', () => {
    const named = [{ value: 'a', label: 'Al Quoz Fresh Produce' }];

    it('narrows a field whose options are all a few letters', () => {
        expect(resolveNarrow(undefined, units)).toBe(true);
        expect(resolveNarrow(undefined, named)).toBe(false);
    });

    it('lets a page force either answer', () => {
        expect(resolveNarrow('fill', units)).toBe(false);
        expect(resolveNarrow('narrow', named)).toBe(true);
    });
});

describe('Select — the admin dropdown', () => {
    it('has no filter box for a short list', async () => {
        await renderWithI18n(
            <Select
                testID="unit"
                label="Unit"
                look="card"
                options={units}
                value="kg"
                onChange={jest.fn()}
            />,
        );
        expect(String(screen.getByTestId('unit').props.className)).toContain('w-32');
        await fireEvent.press(screen.getByTestId('unit-trigger'));
        expect(screen.getByTestId('unit-option-l')).toBeTruthy();
        expect(screen.queryByTestId('unit-search-input')).toBeNull();
    });

    it('adds the filter box by itself for a long list, and filters with it', async () => {
        await renderWithI18n(
            <Select
                testID="item"
                label="Item"
                look="card"
                options={cheeses}
                value={null}
                onChange={jest.fn()}
            />,
        );
        await fireEvent.press(screen.getByTestId('item-trigger'));
        expect(screen.getByTestId('item-section-0')).toHaveTextContent('Raw materials');

        await fireEvent.changeText(screen.getByTestId('item-search-input'), 'Cheese 3');
        expect(screen.getByTestId('item-option-cheese-3')).toBeTruthy();
        expect(screen.queryByTestId('item-option-cheese-4')).toBeNull();
    });

    it('as an action pill, shows what it adds and reports the pick', async () => {
        const onChange = jest.fn();
        await renderWithI18n(
            <Select
                testID="add"
                trigger="pill"
                label="Add an ingredient"
                placeholder="Add an ingredient…"
                options={cheeses}
                value={null}
                onChange={onChange}
            />,
        );
        const trigger = screen.getByTestId('add-trigger');
        expect(screen.getByTestId('add-value')).toHaveTextContent('Add an ingredient…');
        expect(trigger.props.accessibilityLabel).toBe('Add an ingredient');

        await fireEvent.press(trigger);
        expect(screen.getByTestId('add-search-input')).toBeTruthy();
        await fireEvent.press(screen.getByTestId('add-option-cheese-2'));
        expect(onChange).toHaveBeenCalledWith('cheese-2');
    });

    it('as a scope pill, names its value and fills once narrowed', async () => {
        const slots = [
            { value: 'all', label: 'All' },
            { value: 'lunch', label: 'Lunch' },
        ];
        await renderWithI18n(
            <>
                <Select
                    testID="slot"
                    trigger="pill"
                    label="Slot"
                    options={slots}
                    value="all"
                    onChange={jest.fn()}
                />
                <Select
                    testID="lunch"
                    trigger="pill"
                    label="Slot"
                    options={slots}
                    value="lunch"
                    onChange={jest.fn()}
                />
            </>,
        );
        const quiet = screen.getByTestId('slot-trigger');
        expect(quiet.props.accessibilityLabel).toBe('Slot: All');
        expect(String(quiet.props.className)).toContain('bg-surface-raised');

        expect(screen.getByTestId('lunch-value')).toHaveTextContent('Lunch');
        const narrowed = String(screen.getByTestId('lunch-trigger').props.className);
        expect(narrowed).toContain('bg-surface-brand-subtle');
        expect(narrowed).not.toContain('bg-surface-raised');
    });
});
