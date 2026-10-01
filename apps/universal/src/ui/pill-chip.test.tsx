import { fireEvent, render, screen } from '@testing-library/react-native';

import { PillChip } from './pill-chip.tsx';

/**
 * The shared `chip()` pill. Its look is tokens and is not asserted here; what is defended is what
 * each screen used to say for itself before the five local copies were folded into this one — the
 * role a screen reader hears, the state it is told, and whether a press reaches the caller.
 */
describe('PillChip', () => {
    it('is a toggle button by default, announcing its state as pressed and selected', async () => {
        const onPress = jest.fn();
        await render(<PillChip testID="chip" label="Vegan" selected onPress={onPress} />);

        const chip = screen.getByTestId('chip');
        expect(chip).toHaveProp('role', 'button');
        expect(chip).toHaveProp('accessibilityRole', 'button');
        expect(chip).toHaveProp('aria-pressed', true);
        expect(chip.props.accessibilityState).toMatchObject({ selected: true, disabled: false });
        expect(chip).toHaveProp('accessibilityLabel', 'Vegan');
        expect(chip.props['aria-checked']).toBeUndefined();
    });

    it('is a radio in radio mode, announcing checked rather than pressed', async () => {
        await render(
            <PillChip
                testID="chip"
                mode="radio"
                label="Standard"
                selected={false}
                onPress={() => undefined}
            />,
        );

        const chip = screen.getByTestId('chip');
        expect(chip).toHaveProp('role', 'radio');
        expect(chip).toHaveProp('accessibilityRole', 'radio');
        // React Native folds `aria-checked` into `accessibilityState`, so that is where it is read.
        expect(chip.props.accessibilityState).toMatchObject({ checked: false, disabled: false });
        expect(chip.props.accessibilityState.selected).toBeUndefined();
        expect(chip.props['aria-pressed']).toBeUndefined();
    });

    it('hands the press to the caller, which owns the selection', async () => {
        const onPress = jest.fn();
        await render(<PillChip testID="chip" label="Vegan" selected={false} onPress={onPress} />);

        await fireEvent.press(screen.getByTestId('chip'));
        expect(onPress).toHaveBeenCalledTimes(1);
    });

    it('says it is disabled and ignores a press', async () => {
        const onPress = jest.fn();
        await render(<PillChip testID="chip" label="Vegan" disabled onPress={onPress} />);

        const chip = screen.getByTestId('chip');
        expect(chip.props.accessibilityState).toMatchObject({ disabled: true });
        expect(chip).toBeDisabled();

        await fireEvent.press(chip);
        expect(onPress).not.toHaveBeenCalled();
    });

    it('takes a fuller accessible name than its visible label when given one', async () => {
        await render(
            <PillChip
                testID="chip"
                label="Mon"
                accessibilityLabel="Monday"
                onPress={() => undefined}
            />,
        );

        expect(screen.getByTestId('chip')).toHaveProp('accessibilityLabel', 'Monday');
        expect(screen.getByText('Mon')).toBeTruthy();
    });

    it('without onPress is a statement, not a control: no role, no state', async () => {
        await render(<PillChip testID="chip" label="11:30–13:00" selected />);

        const chip = screen.getByTestId('chip');
        expect(chip.props.role).toBeUndefined();
        expect(chip.props.accessibilityRole).toBeUndefined();
        expect(chip.props['aria-pressed']).toBeUndefined();
        expect(screen.queryByRole('button')).toBeNull();
        expect(chip).toHaveTextContent('11:30–13:00');
    });
});
