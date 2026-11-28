import { fireEvent, screen } from '@testing-library/react-native';
import type { ReactNode } from 'react';

import { Badge } from '../content/badge.tsx';
import { FilterChip } from '../content/chip.tsx';
import { AreaLookScope } from '../hooks/area-look.tsx';
import { renderWithI18n } from '../testing/render.tsx';
import { Checkbox } from './checkbox.tsx';
import { ChoiceChips } from './choice-chips.tsx';
import { ChoiceRow, initialsOf } from './choice-row.tsx';

/**
 * The labels, tick boxes and choices family under the admin look (2026-11-26): the parts the old
 * `DeskChip`, `DeskCheckbox`, `DeskToggleTile` and `DeskChoiceChips` drew, now drawn by the design
 * system's own parts under `AreaLookScope look="desk"`.
 */
const desk = (node: ReactNode) => <AreaLookScope look="desk">{node}</AreaLookScope>;
const classes = (testID: string) => String(screen.getByTestId(testID).props.className);

describe('Badge — the admin pill', () => {
    it('is a full pill with no dot, sized by `size`', async () => {
        await renderWithI18n(
            desk(
                <>
                    <Badge testID="md" tone="warning" label="To confirm" />
                    <Badge testID="lg" tone="warning" size="lg" label="3 to confirm" />
                </>,
            ),
        );
        expect(classes('md')).toContain('rounded-full');
        expect(classes('md')).toContain('h-[22px]');
        expect(classes('lg')).toContain('h-[30px]');
        expect(screen.queryByTestId('md-mark')).toBeNull();
    });

    it('keeps the dotted pill outside the admin', async () => {
        await renderWithI18n(<Badge testID="b" tone="warning" label="Low" />);
        expect(screen.getByTestId('b-mark')).toBeTruthy();
    });
});

describe('Checkbox — the admin tick', () => {
    it('draws a table tick on a 32px target and reports the next state', async () => {
        const onChange = jest.fn();
        await renderWithI18n(
            desk(
                <Checkbox
                    testID="row"
                    labelHidden
                    label="Order Tahini"
                    checked={false}
                    onChange={onChange}
                />,
            ),
        );
        expect(classes('row-control')).toContain('h-8');
        fireEvent.press(screen.getByTestId('row-control'));
        expect(onChange).toHaveBeenCalledWith(true);
    });

    it('announces some-ticked as mixed and ticks the rest on a press', async () => {
        const onChange = jest.fn();
        await renderWithI18n(
            desk(
                <Checkbox
                    testID="all"
                    labelHidden
                    label="Order every item"
                    checked={false}
                    mixed
                    onChange={onChange}
                />,
            ),
        );
        expect(screen.getByTestId('all-control').props.accessibilityState).toMatchObject({
            checked: 'mixed',
        });
        fireEvent.press(screen.getByTestId('all-control'));
        expect(onChange).toHaveBeenCalledWith(true);
    });

    it('draws a card whose fill is the ticked state, with its description under the name', async () => {
        await renderWithI18n(
            <>
                <Checkbox
                    testID="on"
                    shape="card"
                    label="Households"
                    description="Consumer"
                    checked
                    onChange={jest.fn()}
                />
                <Checkbox
                    testID="off"
                    shape="card"
                    label="Vegan"
                    checked={false}
                    onChange={jest.fn()}
                />
            </>,
        );
        expect(classes('on-control')).toContain('bg-surface-brand-subtle');
        expect(classes('off-control')).toContain('bg-surface-raised');
        expect(screen.getByText('Consumer')).toBeTruthy();
    });
});

describe('ChoiceChips and ChoiceRow', () => {
    it('picks one chip and keeps the old per-chip ids', async () => {
        const onChange = jest.fn();
        await renderWithI18n(
            desk(
                <ChoiceChips
                    testID="day"
                    label="Delivery day"
                    value="thu"
                    onChange={onChange}
                    items={[
                        { key: 'wed', label: 'Wed 11' },
                        { key: 'thu', label: 'Thu 12' },
                    ]}
                />,
            ),
        );
        expect(screen.getByTestId('day-thu').props.accessibilityState).toMatchObject({
            selected: true,
        });
        expect(classes('day-thu')).toContain('border-surface-brand');
        fireEvent.press(screen.getByTestId('day-wed'));
        expect(onChange).toHaveBeenCalledWith('wed');
    });

    it('draws the admin chip for a lone FilterChip too', async () => {
        await renderWithI18n(
            desk(<FilterChip testID="f" label="2×" selected onChange={jest.fn()} />),
        );
        expect(classes('f')).toContain('h-8');
    });

    it('announces a row as a radio and only picks', async () => {
        const onPress = jest.fn();
        await renderWithI18n(
            <ChoiceRow
                testID="r"
                mark="avatar"
                initials={initialsOf('Hadi Rizk')}
                label="Hadi Rizk"
                selected={false}
                onPress={onPress}
            />,
        );
        expect(screen.getByText('HR')).toBeTruthy();
        expect(screen.getByTestId('r').props.accessibilityRole).toBe('radio');
        fireEvent.press(screen.getByTestId('r'));
        expect(onPress).toHaveBeenCalledTimes(1);
    });
});
