import { isRateLimitFailure } from '@healthy360/api-client';
import { Badge, Button, Card, Heading, Inline, Stack, Text } from '@healthy360/design-system';
import { useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import {
    toFailure,
    useLogoutMutation,
    useRecheckVerificationMutation,
    useResendVerificationMutation,
} from '../data/hooks.ts';
import { useSession } from '../session/session-provider.tsx';

/**
 * Email verification status.
 *
 * The resend button enforces its own cooldown *client-side as well as server-side*: the server is
 * authoritative and returns `rate_limit.exceeded` with a wait, but a button that can be hammered
 * and only then reports "too many attempts" trains people to hammer it. The countdown is seeded
 * from whichever the server said.
 */
export function VerifyEmailScreen() {
    const { t } = useTranslation();
    const router = useRouter();
    const { me, refetch } = useSession();

    const resend = useResendVerificationMutation();
    const recheck = useRecheckVerificationMutation();
    const logout = useLogoutMutation();

    const [cooldown, setCooldown] = useState(0);
    const [notice, setNotice] = useState<string | null>(null);
    const [stillPending, setStillPending] = useState(false);

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

    const onResend = useCallback(() => {
        setNotice(null);
        setStillPending(false);
        resend.mutate(undefined, {
            onSuccess: (result) => {
                setCooldown(result.cooldownSeconds);
                setNotice(t('auth:verifyEmail.resent'));
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
    }, [resend, t]);

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

    if (verified) {
        return (
            <Stack testID="verify-email-screen" space="lg">
                <Badge testID="verify-email-verified" tone="success" label={t('auth:verifyEmail.verifiedTitle')} />
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

            <Inline space="sm">
                <Button
                    testID="verify-email-resend"
                    label={t('auth:verifyEmail.resend')}
                    loading={resend.isPending}
                    disabled={cooldown > 0}
                    onPress={onResend}
                />
                <Button
                    testID="verify-email-recheck"
                    variant="secondary"
                    label={t('auth:verifyEmail.checkAgain')}
                    loading={recheck.isPending}
                    onPress={onRecheck}
                />
            </Inline>

            {cooldown > 0 ? (
                <Text testID="verify-email-cooldown" variant="caption" tone="secondary">
                    {t('auth:verifyEmail.cooldown', { seconds: cooldown })}
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
