import type { ApiFailure } from '@healthy360/api-client';
import { createI18n } from '@healthy360/i18n';
import { fireEvent, render, screen } from '@testing-library/react-native';
import { I18nextProvider } from 'react-i18next';

import { OtpChallengePanel } from './otp-challenge-panel.tsx';
import type { OtpChallengeView } from './otp-challenge-panel.tsx';
import { describeOtpFailure } from './otp-errors.ts';

/**
 * Verification groundwork.
 *
 * The matrix is tested as a **table** — it is a pure function, and a table is the honest way to
 * assert a table. The panel is then tested for the three things the table cannot say on its own:
 * that a lockout closes the field and promotes another channel, that a cooldown disables the resend
 * button rather than merely reporting it afterwards, and that the two live regions carry the right
 * halves of the message.
 */

const NOW = Date.parse('2026-08-02T10:00:00.000Z');

/** One instance for the file: a fresh one per render produces overlapping `act()` scopes. */
const i18n = createI18n({ locale: 'en' });

function base(
    code: ApiFailure['code'],
): Pick<ApiFailure, 'message' | 'correlationId' | 'retryable'> {
    return { message: `mock ${code}`, correlationId: null, retryable: false };
}

const INVALID: ApiFailure = { ...base('otp.invalid'), code: 'otp.invalid', attemptsRemaining: 2 };
const EXPIRED: ApiFailure = { ...base('otp.expired'), code: 'otp.expired' };
const COOLDOWN: ApiFailure = {
    ...base('otp.cooldown_active'),
    code: 'otp.cooldown_active',
    retryAfterSeconds: 30,
};
const LOCKED: ApiFailure = {
    ...base('otp.attempts_exceeded'),
    code: 'otp.attempts_exceeded',
    lockedUntil: '2026-08-02T10:05:00.000Z',
    availableChannels: ['email'],
};
const CHANNEL: ApiFailure = {
    ...base('otp.channel_unavailable'),
    code: 'otp.channel_unavailable',
};

describe('the OTP error matrix', () => {
    it.each([
        [INVALID, 'retry_code', true, false, false],
        [EXPIRED, 'request_new_code', true, true, false],
        [COOLDOWN, 'wait', false, false, true],
        [LOCKED, 'locked', true, true, true],
        [CHANNEL, 'drop_channel', false, false, false],
    ])(
        '%#: maps the failure to an effect and the three switches a panel needs',
        (failure, effect, clearCode, blocksEntry, blocksResend) => {
            const view = describeOtpFailure(failure as ApiFailure, NOW);
            expect(view?.effect).toBe(effect);
            expect(view?.clearCode).toBe(clearCode);
            expect(view?.blocksEntry).toBe(blocksEntry);
            expect(view?.blocksResend).toBe(blocksResend);
        },
    );

    /** The count belongs to the polite region, so it is reported apart from the message key. */
    it('reports the remaining attempts and the server-seeded waits, not its own numbers', () => {
        expect(describeOtpFailure(INVALID, NOW)?.attemptsRemaining).toBe(2);
        expect(describeOtpFailure(COOLDOWN, NOW)?.countdownSeconds).toBe(30);

        const locked = describeOtpFailure(LOCKED, NOW);
        expect(locked?.countdownSeconds).toBe(300);
        expect(locked?.lockoutMinutes).toBe(5);
        expect(locked?.promoteChannels).toEqual(['email']);
    });

    it('has no row for failures that are not the panel’s vocabulary', () => {
        expect(describeOtpFailure({ ...base('network'), code: 'network' }, NOW)).toBeNull();
    });
});

function challenge(overrides: Partial<OtpChallengeView> = {}): OtpChallengeView {
    return {
        id: 'challenge-1',
        channel: 'sms',
        maskedDestination: '+971 50 ••• 4567',
        codeLength: 6,
        // Relative to the real clock: the panel treats a challenge that has already expired as
        // expired, which is correct but would make every case here the expired one.
        expiresAt: new Date(Date.now() + 300_000).toISOString(),
        resendCooldownSeconds: 0,
        attemptsRemaining: 3,
        availableChannels: ['sms', 'whatsapp'],
        simulatedChannels: ['sms', 'whatsapp'],
        ...overrides,
    };
}

async function renderPanel(props: Partial<React.ComponentProps<typeof OtpChallengePanel>> = {}) {
    const onVerify = jest.fn();
    const onResend = jest.fn();
    await render(
        <I18nextProvider i18n={i18n}>
            <OtpChallengePanel
                challenge={challenge()}
                onVerify={onVerify}
                onResend={onResend}
                {...props}
            />
        </I18nextProvider>,
    );
    return { onVerify, onResend };
}

describe('OtpChallengePanel', () => {
    it('shows the server-authored destination and keeps the counts out of the alert region', async () => {
        await renderPanel();
        expect(screen.getByTestId('otp-panel-destination').props.children).toContain(
            '+971 50 ••• 4567',
        );
        // Nothing has happened yet, so the assertive region is present but silent.
        const alert = screen.getByTestId('otp-panel-alert');
        expect(alert.props['aria-live']).toBe('assertive');
        expect(alert.props.children).toBe('');
        expect(screen.getByTestId('otp-panel-status').props['aria-live']).toBe('polite');
    });

    it('announces a wrong code assertively and the remaining attempts politely', async () => {
        await renderPanel({ failure: INVALID });
        expect(screen.getByTestId('otp-panel-alert').props.children).toBe(
            'That code is not right. Check the message and try again.',
        );
        expect(screen.getByTestId('otp-panel-status')).toHaveTextContent(/2 attempts left\./);
    });

    it('disables the resend button while a cooldown is running', async () => {
        await renderPanel({ challenge: challenge({ resendCooldownSeconds: 45 }) });
        expect(screen.getByTestId('otp-panel-resend').props.accessibilityState.disabled).toBe(true);
        expect(screen.getByTestId('otp-panel-status')).toHaveTextContent(
            /You can ask for another code in 45 seconds\./,
        );
    });

    it('closes the field on a lockout and promotes the channels the server offered', async () => {
        const { onResend } = await renderPanel({ failure: LOCKED });

        expect(screen.getByTestId('otp-panel-locked')).toBeTruthy();
        expect(screen.getByTestId('otp-panel-code-input').props.editable).toBe(false);
        // The picker now shows only what the lockout named — not the challenge's own channels.
        expect(screen.queryByTestId('otp-panel-channels-whatsapp')).toBeNull();

        await fireEvent.press(screen.getByTestId('otp-panel-channels-email'));
        expect(onResend).toHaveBeenCalledWith('email');
    });

    /** A channel that does not really deliver says so, rather than claiming an SMS was sent. */
    it('badges simulated channels as undelivered', async () => {
        await renderPanel();
        expect(screen.getByTestId('otp-panel-channels-sms-simulated')).toHaveTextContent(
            /Not really sent/,
        );
    });

    it('flips to the expired state and refuses to submit a short code', async () => {
        const { onVerify } = await renderPanel({ failure: EXPIRED });
        expect(screen.getByTestId('otp-panel-expired')).toBeTruthy();

        const submit = screen.getByTestId('otp-panel-submit');
        expect(submit.props.accessibilityState.disabled).toBe(true);
        await fireEvent.press(submit);
        expect(onVerify).not.toHaveBeenCalled();
    });
});
