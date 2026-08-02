import { describe, expect, it } from 'vitest';

import { asApiFailure } from '../../contracts/failure.ts';
import { contactPointIdAt } from './ids.ts';
import { createAccountMockRepositories } from './repositories.ts';
import {
    MOCK_OTP_CODE,
    OTP_EXPIRY_SECONDS,
    OTP_MAX_ATTEMPTS,
    OTP_RESEND_COOLDOWN_SECONDS,
} from './store.ts';

/**
 * The mock OTP mechanics.
 *
 * The code is fixed; nothing else is. These eight cases pin the five behaviours a panel cannot be
 * written against unless the mock actually has them: the cooldown on every read, the attempt
 * countdown, expiry, supersession-on-resend, and the lockout with an escape channel.
 *
 * Time is injected rather than faked globally — the store takes a clock, so a test moves the world
 * forward by reassigning a number instead of installing timers.
 */
function world() {
    let now = Date.parse('2026-07-30T09:00:00.000Z');
    const repositories = createAccountMockRepositories({ latencyMs: 0, now: () => now });
    return {
        ...repositories,
        advance(seconds: number) {
            now += seconds * 1000;
        },
    };
}

const EMAIL_CONTACT = contactPointIdAt(0);
const PHONE_CONTACT = contactPointIdAt(1);

async function issue(repositories: ReturnType<typeof world>, contactPointId = PHONE_CONTACT) {
    return repositories.verification.issueChallenge({
        purpose: 'contact_verification',
        contactPointId,
    });
}

async function failureOf(action: Promise<unknown>) {
    try {
        await action;
    } catch (error) {
        return asApiFailure(error);
    }
    throw new Error('expected a rejection');
}

describe('the mock OTP challenge world', () => {
    it('issues a challenge whose every field is server-authored', async () => {
        const repositories = world();
        const challenge = await issue(repositories);

        expect(challenge.channel).toBe('sms');
        expect(challenge.maskedDestination).toBe('+971 50 ••• 4567');
        expect(challenge.attemptsRemaining).toBe(OTP_MAX_ATTEMPTS);
        expect(challenge.resendCooldownSeconds).toBe(OTP_RESEND_COOLDOWN_SECONDS);
        // Shape 5: the mock world is non-production, so the two fake channels say so.
        expect([...challenge.simulatedChannels]).toEqual(['sms', 'whatsapp']);
    });

    /**
     * Shape 1. A person who reloads has not asked for a new code: the same challenge comes back
     * with *less* cooldown left, rather than a second challenge with a fresh 45 s.
     */
    it('carries the remaining cooldown on every read, not only after a resend', async () => {
        const repositories = world();
        const first = await issue(repositories);
        repositories.advance(20);

        const reread = await repositories.verification.getChallenge({ challengeId: first.id });
        expect(reread.id).toBe(first.id);
        expect(reread.resendCooldownSeconds).toBe(OTP_RESEND_COOLDOWN_SECONDS - 20);

        const reissued = await issue(repositories);
        expect(reissued.id).toBe(first.id);
    });

    it('accepts the published code and marks the contact verified', async () => {
        const repositories = world();
        const challenge = await issue(repositories);

        const result = await repositories.verification.verifyChallenge({
            challengeId: challenge.id,
            code: MOCK_OTP_CODE,
        });
        expect(result.contactPointId).toBe(PHONE_CONTACT);

        const contacts = await repositories.verification.listContactPoints();
        expect(contacts.find((contact) => contact.id === PHONE_CONTACT)?.verified).toBe(true);
    });

    it('counts attempts down on the rejection itself', async () => {
        const repositories = world();
        const challenge = await issue(repositories);

        const failure = await failureOf(
            repositories.verification.verifyChallenge({
                challengeId: challenge.id,
                code: '111111',
            }),
        );
        expect(failure?.code).toBe('otp.invalid');
        expect(failure).toMatchObject({ attemptsRemaining: OTP_MAX_ATTEMPTS - 1 });
    });

    /** Shape 3: the lockout has to say when it lifts *and* what to do instead of waiting. */
    it('locks out after the attempt budget and offers another channel', async () => {
        const repositories = world();
        const challenge = await issue(repositories);

        for (let attempt = 0; attempt < OTP_MAX_ATTEMPTS - 1; attempt += 1) {
            await failureOf(
                repositories.verification.verifyChallenge({
                    challengeId: challenge.id,
                    code: '111111',
                }),
            );
        }

        const failure = await failureOf(
            repositories.verification.verifyChallenge({
                challengeId: challenge.id,
                code: '111111',
            }),
        );
        expect(failure?.code).toBe('otp.attempts_exceeded');
        expect(failure).toMatchObject({
            lockedUntil: '2026-07-30T09:05:00.000Z',
            availableChannels: ['email', 'whatsapp'],
        });

        // The lockout is on the contact, so it survives asking for a fresh code.
        expect((await failureOf(issue(repositories)))?.code).toBe('otp.attempts_exceeded');
    });

    it('refuses a resend inside the cooldown and says how long is left', async () => {
        const repositories = world();
        const challenge = await issue(repositories);
        repositories.advance(10);

        const failure = await failureOf(
            repositories.verification.resendChallenge({ challengeId: challenge.id }),
        );
        expect(failure?.code).toBe('otp.cooldown_active');
        expect(failure).toMatchObject({ retryAfterSeconds: OTP_RESEND_COOLDOWN_SECONDS - 10 });
    });

    /**
     * A resend supersedes. The old identifier stops verifying, which is what stops a person
     * entering the code from the first message after asking for a second one.
     */
    it('invalidates the previous challenge when a code is resent', async () => {
        const repositories = world();
        const first = await issue(repositories);
        repositories.advance(OTP_RESEND_COOLDOWN_SECONDS);

        const second = await repositories.verification.resendChallenge({
            challengeId: first.id,
            channel: 'whatsapp',
        });
        expect(second.id).not.toBe(first.id);
        expect(second.channel).toBe('whatsapp');
        expect(second.resendsRemaining).toBe(first.resendsRemaining - 1);

        expect(
            (
                await failureOf(
                    repositories.verification.verifyChallenge({
                        challengeId: first.id,
                        code: MOCK_OTP_CODE,
                    }),
                )
            )?.code,
        ).toBe('otp.expired');
    });

    it('expires a challenge and refuses a channel the contact cannot reach', async () => {
        const repositories = world();
        const challenge = await issue(repositories);
        repositories.advance(OTP_EXPIRY_SECONDS);

        expect(
            (
                await failureOf(
                    repositories.verification.verifyChallenge({
                        challengeId: challenge.id,
                        code: MOCK_OTP_CODE,
                    }),
                )
            )?.code,
        ).toBe('otp.expired');

        expect(
            (
                await failureOf(
                    repositories.verification.issueChallenge({
                        purpose: 'contact_verification',
                        contactPointId: EMAIL_CONTACT,
                        channel: 'sms',
                    }),
                )
            )?.code,
        ).toBe('otp.channel_unavailable');
    });
});
