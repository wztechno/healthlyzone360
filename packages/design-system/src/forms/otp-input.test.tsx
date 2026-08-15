import { fireEvent, screen } from '@testing-library/react-native';

import { flattenStyle, renderWithI18n } from '../testing/render.tsx';
import { OtpInput, normaliseOtpDigits } from './otp-input.tsx';

/**
 * The two claims the component exists to make: an Arabic keyboard produces a usable code, and the
 * field cannot hold more digits than the challenge has. Both are the difference between a person
 * getting in and a person burning one of three attempts on a code they typed correctly.
 */
describe('OtpInput', () => {
    it('maps both Arabic-Indic digit families to ASCII and drops everything else', () => {
        expect(normaliseOtpDigits('٤٢٤٢٤٢')).toBe('424242');
        expect(normaliseOtpDigits('۴۲۴۲۴۲')).toBe('424242');
        expect(normaliseOtpDigits(' 42-42 42 ')).toBe('424242');
        expect(normaliseOtpDigits('abc')).toBe('');
    });

    it('hands the field only normalised digits, capped at the challenge length', async () => {
        const changes: string[] = [];
        await renderWithI18n(
            <OtpInput
                testID="otp"
                id="otp"
                label="Verification code"
                value=""
                length={6}
                onChangeText={(next) => changes.push(next)}
            />,
        );

        const input = screen.getByTestId('otp-input');
        await fireEvent.changeText(input, '٤٢٤٢٤٢');
        await fireEvent.changeText(input, '42424242');

        expect(changes).toEqual(['424242', '424242']);
        expect(input.props.maxLength).toBe(6);
    });

    it('is one autofillable numeric field, centred and pinned left-to-right', async () => {
        await renderWithI18n(
            <OtpInput
                testID="otp"
                id="otp"
                label="Verification code"
                value="4242"
                length={6}
                onChangeText={() => undefined}
            />,
        );

        const input = await screen.findByTestId('otp-input');
        expect(input.props.inputMode).toBe('numeric');
        expect(input.props.autoComplete).toBe('one-time-code');

        const style = flattenStyle(input.props.style);
        expect(style['textAlign']).toBe('center');
        expect(style['writingDirection']).toBe('ltr');
        expect(style['letterSpacing']).toBe(8);
    });
});
