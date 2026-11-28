import { fireEvent, screen } from '@testing-library/react-native';
import { useState } from 'react';

import { renderWithI18n } from '../testing/render.tsx';
import { DatePicker } from './date-picker.tsx';
import type { DatePickerProps } from './date-picker.tsx';

type HarnessProps = Omit<DatePickerProps, 'value' | 'onChange' | 'label' | 'testID'> & {
    readonly initial?: string;
    readonly clearable?: boolean;
};

function Harness({ initial = '', clearable = false, ...rest }: HarnessProps) {
    const [value, setValue] = useState(initial);
    return (
        <DatePicker
            testID="date"
            label="From"
            today="2026-11-26"
            value={value}
            onChange={setValue}
            {...(clearable
                ? {
                      onClear: () => {
                          setValue('');
                      },
                  }
                : {})}
            {...rest}
        />
    );
}

describe('DatePicker', () => {
    it('opens the month on a pill, picks a day and closes', async () => {
        await renderWithI18n(<Harness trigger="pill" initial="2026-11-26" />);

        await fireEvent.press(screen.getByTestId('date-trigger'));
        await fireEvent.press(screen.getByTestId('date-day-2026-11-10'));

        expect(screen.queryByTestId('date-day-2026-11-10')).toBeNull();
        expect(screen.getByTestId('date-value')).toHaveTextContent(/10/);
    });

    it('names an empty pill by its label', async () => {
        await renderWithI18n(<Harness trigger="pill" />);
        expect(screen.getByTestId('date-value')).toHaveTextContent('From');
    });

    it('names an empty pill by its placeholder when it has one', async () => {
        await renderWithI18n(<Harness trigger="pill" placeholder="Any day" />);
        expect(screen.getByTestId('date-value')).toHaveTextContent('Any day');
    });

    it('keeps the days outside the bounds from being picked', async () => {
        await renderWithI18n(<Harness trigger="pill" initial="2026-11-20" min="2026-11-15" />);

        await fireEvent.press(screen.getByTestId('date-trigger'));
        await fireEvent.press(screen.getByTestId('date-day-2026-11-10'));

        expect(screen.getByTestId('date-day-2026-11-10')).toBeDisabled();
        expect(screen.getByTestId('date-day-2026-11-15')).not.toBeDisabled();
    });

    it('moves a month at a time', async () => {
        await renderWithI18n(<Harness trigger="pill" initial="2026-11-26" />);

        await fireEvent.press(screen.getByTestId('date-trigger'));
        await fireEvent.press(screen.getByTestId('date-next-month'));

        expect(screen.getByTestId('date-day-2026-12-31')).toBeOnTheScreen();
    });

    it('gives a field Today, and no Clear for a date that must be set', async () => {
        await renderWithI18n(<Harness initial="2026-11-02" />);

        await fireEvent.press(screen.getByTestId('date-trigger'));
        expect(screen.queryByTestId('date-clear')).toBeNull();
        await fireEvent.press(screen.getByTestId('date-today'));
        expect(screen.getByTestId('date-value')).toHaveTextContent(/26/);
    });

    it('clears a field that may be left empty', async () => {
        await renderWithI18n(<Harness initial="2026-11-02" clearable />);

        await fireEvent.press(screen.getByTestId('date-trigger'));
        await fireEvent.press(screen.getByTestId('date-clear'));
        expect(screen.getByTestId('date-value')).toHaveTextContent('Pick a day');
    });

    it('opens a field on the picker id the desk forms use', async () => {
        await renderWithI18n(<Harness initial="2026-11-02" />);

        await fireEvent.press(screen.getByTestId('date-trigger'));

        expect(screen.getByTestId('date-picker-day-2026-11-02')).toBeOnTheScreen();
    });
});
