import { PASSCODE_LENGTH, isRateLimitFailure } from '@healthy360/api-client';
import {
    Badge,
    Button,
    Card,
    Heading,
    Inline,
    OtpInput,
    Stack,
    Text,
} from '@healthy360/design-system';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import {
    useSendEmailPasscodeMutation,
    useVerifyEmailPasscodeMutation,
} from '../data/account-hooks.ts';
import { toFailure, useLogoutMutation, useRecheckVerificationMutation } from '../data/hooks.ts';
import { useSession } from '../session/session-provider.tsx';

/**
 * Email verification status.
 *
 * ## The code, not the link
 *
 * The verification mail carries both (D-036), and this screen is where the six digits are typed.
 * A link opens a browser, and the round trip back into the app loses the session often enough to
 * be the most common place an onboarding is abandoned; somebody already looking at this screen can
 * finish on it. `POST /verification/email/verify` names no challenge — the server holds the only
 * live one — so there is nothing for the screen to carry between the mail and the field.
 *
 * "Send a new code" replaced the old "send the link again": both send a message to the same
 * address, and two buttons that differ only in which half of one mail they re-send is a choice
 * nobody has a reason to make.
 *
 * The send button enforces its cooldown *client-side as well as server-side*: the server is
 * authoritative and refuses an early resend, but a button that can be hammered and only then
 * reports "too many attempts" trains people to hammer it. The countdown is seeded from whichever
 * the server said — the challenge's own cooldown, or the wait a rate limit came back with.
 */
export function VerifyEmailScreen() {
    const { t } = useTranslation();
    const router = useRouter();
    const { verified: verifiedFromLink } = useLocalSearchParams<{ verified?: string }>();
    const { me, refetch } = useSession();

    const sendCode = useSendEmailPasscodeMutation();
    const verifyCode = useVerifyEmailPasscodeMutation();
    const recheck = useRecheckVerificationMutation();
    const logout = useLogoutMutation();

    const [code, setCode] = useState('');
    const [cooldown, setCooldown] = useState(0);
    const [notice, setNotice] = useState<string | null>(null);
    const [stillPending, setStillPending] = useState(false);

    const onRecheck = useCallback(() => {
        setNotice(null);
        recheck.mutate(undefined, {
            onSuccess: (status) => {
                if (status.verified) {
                    refetch();
                    return;
                }
                setStillPending(true);
            },
        });
    }, [recheck, refetch]);

    /*
     * Following the signed link in a mail client lands on the API, which redirects here with
     * `verified=1` after marking the address. Re-read `/me` so the screen flips without making the
     * person paste a code.
     *
     * Scheduled after paint rather than run in the effect body. `onRecheck` clears the notice and
     * starts a mutation, and doing that synchronously during commit is a cascading render — the
     * screen would paint, immediately re-render with the notice cleared, and only then show the
     * pending state. One tick later it paints once and then updates, which is also the order a
     * person perceives as "it checked".
     */
    useEffect(() => {
        if (verifiedFromLink !== '1') return undefined;
        const timer = setTimeout(onRecheck, 0);
        return () => {
            clearTimeout(timer);
        };
    }, [verifiedFromLink, onRecheck]);

    useEffect(() => {
        if (cooldown <= 0) return;
        const timer = setTimeout(() => {
            setCooldown((current) => Math.max(0, current - 1));
        }, 1000);
        return () => {
            clearTimeout(timer);
        };
    }, [cooldown]);

    const email = me?.user.email ?? '';
    const verified = me?.user.emailVerifiedAt != null;

    const onSendCode = useCallback(() => {
        setNotice(null);
        setStillPending(false);
        // The rejection on the field belonged to the code that is being replaced.
        verifyCode.reset();
        sendCode.mutate(undefined, {
            onSuccess: (challenge) => {
                setCode('');
                setCooldown(challenge.resendCooldownSeconds);
                setNotice(t('auth:otp.resent'));
            },
            onError: (error: unknown) => {
                const failure = toFailure(error);
                if (failure !== null && isRateLimitFailure(failure)) {
                    setCooldown(failure.retryAfterSeconds);
                    return;
                }
                setNotice(failure?.message ?? null);
            },
        });
    }, [sendCode, verifyCode, t]);

    const onSubmitCode = useCallback(() => {
        setNotice(null);
        setStillPending(false);
        verifyCode.mutate(
            { code },
            {
                onSuccess: () => {
                    // The address is proven on the server; the session is what says so here.
                    refetch();
                },
            },
        );
    }, [code, refetch, verifyCode]);

    if (verified) {
        return (
            <Stack testID="verify-email-screen" space="lg">
                <Badge
                    testID="verify-email-verified"
                    tone="success"
                    label={t('auth:verifyEmail.verifiedTitle')}
                />
                <Heading level={1}>{t('auth:verifyEmail.verifiedTitle')}</Heading>
                <Text tone="secondary">{t('auth:verifyEmail.verifiedBody')}</Text>
                <Button
                    testID="verify-email-continue"
                    block
                    label={t('auth:verifyEmail.continue')}
                    onPress={() => {
                        router.replace('/');
                    }}
                />
            </Stack>
        );
    }

    return (
        <Stack testID="verify-email-screen" space="lg">
            <Stack space="xs">
                <Heading level={1} testID="verify-email-title">
                    {t('auth:verifyEmail.title')}
                </Heading>
                <Text testID="verify-email-body" tone="secondary">
                    {t('auth:verifyEmail.body', { email })}
                </Text>
            </Stack>

            {notice === null ? null : (
                <Card tone="brand" padding="sm">
                    <Text testID="verify-email-notice" role="status" aria-live="polite">
                        {notice}
                    </Text>
                </Card>
            )}

            {stillPending ? (
                <Card tone="default" padding="sm">
                    <Stack space="xs">
                        <Text testID="verify-email-pending-title" variant="bodyStrong">
                            {t('auth:verifyEmail.pendingTitle')}
                        </Text>
                        <Text tone="secondary">{t('auth:verifyEmail.pendingBody')}</Text>
                    </Stack>
                </Card>
            ) : null}

            <OtpInput
                testID="verify-email-code"
                id="verify-email-code"
                label={t('auth:otp.codeLabel')}
                hint={t('auth:otp.codeHint')}
                value={code}
                length={PASSCODE_LENGTH}
                disabled={verifyCode.isPending}
                // The server's own sentence: it is the one that knows whether the code was wrong,
                // expired or spent, and each has a different remedy.
                error={toFailure(verifyCode.error)?.message}
                onChangeText={setCode}
            />

            <Inline space="sm">
                <Button
                    testID="verify-email-submit"
                    label={t('auth:otp.submit')}
                    loading={verifyCode.isPending}
                    disabled={code.length < PASSCODE_LENGTH}
                    onPress={onSubmitCode}
                />
                <Button
                    testID="verify-email-resend"
                    variant="secondary"
                    label={t('auth:otp.resend')}
                    loading={sendCode.isPending}
                    disabled={cooldown > 0}
                    onPress={onSendCode}
                />
                <Button
                    testID="verify-email-recheck"
                    variant="ghost"
                    label={t('auth:verifyEmail.checkAgain')}
                    loading={recheck.isPending}
                    onPress={onRecheck}
                />
            </Inline>

            {cooldown > 0 ? (
                <Text testID="verify-email-cooldown" variant="caption" tone="secondary">
                    {t('auth:otp.resendIn', { count: cooldown })}
                </Text>
            ) : null}

            <Button
                testID="verify-email-sign-out"
                variant="ghost"
                size="sm"
                label={t('auth:verifyEmail.wrongAddress')}
                onPress={() => {
                    logout.mutate(undefined, {
                        onSuccess: () => {
                            router.replace('/sign-in');
                        },
                    });
                }}
            />
        </Stack>
    );
}
