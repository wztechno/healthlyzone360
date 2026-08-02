import type { ApiFailure } from '@healthy360/api-client';

import { secondsUntil } from './use-countdown.ts';

/**
 * The channel vocabulary, read off the failure union rather than imported.
 *
 * `VerificationRepository` is not a member of the exported `Repositories` bundle yet, so
 * `contracts/index.ts` does not re-export `OtpChannel` and the package's `exports` map has no deep
 * path to reach it by. The lockout failure carries the list, so the union is derivable from what
 * *is* exported — and derived rather than restated, so it cannot drift from the contract.
 */
export type OtpChannel = Extract<
    ApiFailure,
    { code: 'otp.attempts_exceeded' }
>['availableChannels'][number];

/**
 * The one-time-code error matrix.
 *
 * A pure function over the failure union, deliberately separated from the panel that renders it.
 * Five rejections each have to change four different things — what is said, whether the code field
 * still accepts input, whether the resend button is live, and whether another channel should be
 * pushed forward — and a component that worked all of that out inline would be a component nobody
 * could test without mounting it. Here the whole matrix is a table, and the panel just draws it.
 *
 * Non-OTP failures return `null`: they are not this panel's vocabulary, and the caller falls back to
 * the generic failure copy rather than this file inventing a row for `network`.
 */

/** What the panel should do about the failure. */
export const OTP_ERROR_EFFECTS = [
    /** Wrong code. The field is cleared and stays usable. */
    'retry_code',
    /** The challenge is dead. Only "send a new code" is left. */
    'request_new_code',
    /** A resend arrived too early. Count down; do not shout. */
    'wait',
    /** The attempt budget is gone. Entry is closed and another channel is offered. */
    'locked',
    /** This channel cannot carry a code. Take it off the picker. */
    'drop_channel',
] as const;
export type OtpErrorEffect = (typeof OTP_ERROR_EFFECTS)[number];

export interface OtpErrorView {
    readonly code: ApiFailure['code'];
    readonly effect: OtpErrorEffect;
    /** The assertive message. Says what happened, never how many tries are left — see below. */
    readonly messageKey: string;
    /**
     * Seconds the panel should count down, or `null`.
     *
     * Seeded from the server in both cases that have one: the cooldown's `retryAfterSeconds` and the
     * lockout's `lockedUntil`. The client never picks the number.
     */
    readonly countdownSeconds: number | null;
    /** Minutes to quote in the lockout copy. `null` for every other row. */
    readonly lockoutMinutes: number | null;
    /**
     * Attempts left after this rejection, or `null`.
     *
     * Reported separately from `messageKey` on purpose: the count belongs in the panel's **polite**
     * region, which tracks state, not in the assertive one, which announces events. A screen reader
     * user who mistypes a code should hear "That code is not right" once — not have the running
     * total interrupt them every time it changes.
     */
    readonly attemptsRemaining: number | null;
    /** Empty the code field — true wherever the entered code is now certainly useless. */
    readonly clearCode: boolean;
    /** Close the code field. */
    readonly blocksEntry: boolean;
    /** Disable the resend button until the countdown ends. */
    readonly blocksResend: boolean;
    /** Channels to promote as a way out. Non-empty only on a lockout, and possibly empty even then. */
    readonly promoteChannels: readonly OtpChannel[];
}

const BASE = {
    countdownSeconds: null,
    lockoutMinutes: null,
    attemptsRemaining: null,
    clearCode: false,
    blocksEntry: false,
    blocksResend: false,
    promoteChannels: [] as readonly OtpChannel[],
} as const;

export function describeOtpFailure(
    failure: ApiFailure,
    now: number = Date.now(),
): OtpErrorView | null {
    switch (failure.code) {
        case 'otp.invalid':
            return {
                ...BASE,
                code: failure.code,
                effect: 'retry_code',
                messageKey: 'auth:otp.errors.invalid',
                attemptsRemaining: failure.attemptsRemaining,
                clearCode: true,
            };

        case 'otp.expired':
            return {
                ...BASE,
                code: failure.code,
                effect: 'request_new_code',
                messageKey: 'auth:otp.errors.expired',
                clearCode: true,
                blocksEntry: true,
            };

        case 'otp.cooldown_active':
            return {
                ...BASE,
                code: failure.code,
                effect: 'wait',
                messageKey: 'auth:otp.errors.cooldown',
                countdownSeconds: failure.retryAfterSeconds,
                blocksResend: true,
            };

        case 'otp.attempts_exceeded': {
            const seconds = secondsUntil(failure.lockedUntil, now);
            return {
                ...BASE,
                code: failure.code,
                effect: 'locked',
                messageKey: 'auth:otp.errors.locked',
                countdownSeconds: seconds,
                // Rounded up and floored at one: "try again in 0 minutes" is not an instruction.
                lockoutMinutes: Math.max(1, Math.ceil(seconds / 60)),
                clearCode: true,
                blocksEntry: true,
                blocksResend: true,
                promoteChannels: failure.availableChannels,
            };
        }

        case 'otp.channel_unavailable':
            return {
                ...BASE,
                code: failure.code,
                effect: 'drop_channel',
                messageKey: 'auth:otp.errors.channelUnavailable',
            };

        default:
            return null;
    }
}
