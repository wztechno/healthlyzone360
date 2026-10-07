import { fireEvent, screen } from '@testing-library/react-native';
import { useState } from 'react';

import { renderWithI18n } from '../testing/render.tsx';
import { TimeField } from './time-field.tsx';
import {
    hourHasRoom,
    isWithin,
    minuteOptions,
    parseTypedTime,
    stepTime,
} from './time-field-shared.ts';

describe('TimeField arithmetic', () => {
    it.each([
        ['930', '09:30'],
        ['9:30', '09:30'],
        ['0930', '09:30'],
        ['09:30', '09:30'],
        ['9', '09:00'],
        ['21h30', '21:30'],
        ['9.05', '09:05'],
        ['٩:٣٠', '09:30'],
        ['', ''],
        ['  ', ''],
    ])('reads %p as %p', (typed, iso) => {
        expect(parseTypedTime(typed)).toBe(iso);
    });

    it.each(['25:00', '12:60', '9:7', 'noon', '12345', '1:2:3'])('refuses %p', (typed) => {
        expect(parseTypedTime(typed)).toBeNull();
    });

    it('steps across midnight in both directions', () => {
        expect(stepTime('23:45', 15)).toBe('00:00');
        expect(stepTime('00:00', -15)).toBe('23:45');
        expect(stepTime('', 60)).toBe('01:00');
    });

    it('treats the bounds as inclusive and an absent bound as open', () => {
        expect(isWithin('09:00', '09:00', '17:00')).toBe(true);
        expect(isWithin('08:59', '09:00')).toBe(false);
        expect(isWithin('17:01', undefined, '17:00')).toBe(false);
        expect(isWithin('03:00', '', '')).toBe(true);
    });

    it('lists the minute column by its step and knows an hour with no room', () => {
        expect(minuteOptions(15)).toEqual([0, 15, 30, 45]);
        expect(minuteOptions(20)).toEqual([0, 20, 40]);
        expect(hourHasRoom(8, [0, 15, 30, 45], '09:00')).toBe(false);
        expect(hourHasRoom(9, [0, 15, 30, 45], '09:30')).toBe(true);
    });
});

function Harness({ initial = '', min }: { readonly initial?: string; readonly min?: string }) {
    const [value, setValue] = useState(initial);
    return <TimeField testID="time" label="Opens" value={value} onChange={setValue} min={min} />;
}

describe('TimeField', () => {
    it('opens a panel of hours and minutes from the clock button and picks a time', async () => {
        await renderWithI18n(<Harness />);
        expect(screen.queryByTestId('time-panel')).toBeNull();

        await fireEvent.press(screen.getByTestId('time-trigger'));
        expect(screen.getByTestId('time-hour-00')).toBeTruthy();
        expect(screen.getByTestId('time-hour-23')).toBeTruthy();
        expect(screen.getByTestId('time-minute-45')).toBeTruthy();

        // An hour keeps the panel open for the minute; the minute closes it.
        await fireEvent.press(screen.getByTestId('time-hour-09'));
        expect(screen.getByTestId('time-panel')).toBeTruthy();
        await fireEvent.press(screen.getByTestId('time-minute-30'));
        expect(screen.queryByTestId('time-panel')).toBeNull();
        expect(screen.getByTestId('time-input').props.value).toBe('09:30');
    });

    it('tidies a typed time when the field is left', async () => {
        await renderWithI18n(<Harness />);
        const input = screen.getByTestId('time-input');

        await fireEvent(input, 'focus');
        await fireEvent.changeText(input, '930');
        await fireEvent(input, 'blur');

        expect(screen.getByTestId('time-input').props.value).toBe('09:30');
    });

    it('marks text that is not a time once the field is left', async () => {
        await renderWithI18n(<Harness />);
        const input = screen.getByTestId('time-input');

        await fireEvent(input, 'focus');
        await fireEvent.changeText(input, '9:7');
        await fireEvent(input, 'blur');

        expect(screen.getByText(/Enter a time as HH:mm/)).toBeTruthy();
    });

    it('greys out the hours and minutes before its minimum', async () => {
        await renderWithI18n(<Harness initial="09:00" min="09:30" />);
        await fireEvent.press(screen.getByTestId('time-trigger'));

        expect(screen.getByTestId('time-hour-08').props.accessibilityState).toMatchObject({
            disabled: true,
        });
        expect(screen.getByTestId('time-minute-15').props.accessibilityState).toMatchObject({
            disabled: true,
        });
        expect(screen.getByTestId('time-minute-30').props.accessibilityState).toMatchObject({
            disabled: false,
        });
    });

    it('clears back to no time', async () => {
        await renderWithI18n(<Harness initial="18:00" />);
        await fireEvent.press(screen.getByTestId('time-trigger'));
        await fireEvent.press(screen.getByTestId('time-clear'));

        expect(screen.getByTestId('time-input').props.value).toBe('');
        expect(screen.queryByTestId('time-panel')).toBeNull();
    });
});
