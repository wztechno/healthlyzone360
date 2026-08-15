/**
 * Verification — the one-time-code surface (plan Phase J1).
 *
 * Groundwork only: the panel, the error matrix and the countdown. The screens and routes that mount
 * them, and the query hooks that feed them, arrive with the slice that registers
 * `VerificationRepository` in the repository bundle.
 */
export { ChannelPicker, OtpChallengePanel } from './otp-challenge-panel.tsx';
export type {
    ChannelPickerProps,
    OtpChallengePanelProps,
    OtpChallengeView,
} from './otp-challenge-panel.tsx';

export { OTP_ERROR_EFFECTS, describeOtpFailure } from './otp-errors.ts';
export type { OtpChannel, OtpErrorEffect, OtpErrorView } from './otp-errors.ts';

export { secondsUntil, useCountdown } from './use-countdown.ts';
export type { Countdown } from './use-countdown.ts';
