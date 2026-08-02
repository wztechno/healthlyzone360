import { ErrorState, Skeleton, Stack } from '@healthy360/design-system';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import {
    toFailure,
    useOtpChallengeQuery,
    useResendChallengeMutation,
    useVerifyChallengeMutation,
} from '../../data/account-hooks.ts';
import { OtpChallengePanel } from '../verification/index.ts';
import type { OtpChannel } from '../verification/index.ts';

/**
 * The one-time-code panel, wired to a live challenge.
 *
 * `OtpChallengePanel` is deliberately dumb — it draws a challenge and reports two intentions — so
 * something has to own the three facts a wired panel needs: which challenge is live, which
 * rejection is the current one, and what a successful verification does next. That is this
 * component, and it exists once rather than twice because `/customer/account/phone` and
 * `/verify-phone` differ only in how a person arrived.
 *
 * ## A resend replaces the challenge, so the id is state
 *
 * The answer to a resend carries a **new** identifier and the previous challenge stops verifying
 * (`contracts/verification.ts`). The live id is therefore held here and re-seeded whenever the
 * *prop* changes, using the same derive-don't-effect shape the panel itself uses: an effect that
 * re-synced the id would fire again on the render after a resend and throw the new challenge away.
 *
 * ## Which failure is "the" failure
 *
 * Two mutations can be in a failed state at once — a wrong code, then a resend refused by the
 * cooldown — and TanStack keeps each error until that mutation runs again. Showing whichever one
 * happens to be non-null would tell somebody their code was wrong when what actually just happened
 * is that they asked for a new one too soon. So the last action is recorded on the way in and the
 * matching error is the one the panel is given.
 */
export interface PhoneChallengeProps {
    readonly challengeId: string;
    readonly onVerified: () => void;
    readonly testID?: string | undefined;
}

interface LiveChallenge {
    readonly id: string;
    /** The prop this id was derived from, so a changed prop re-seeds without an effect. */
    readonly from: string;
}

export function PhoneChallenge({
    challengeId,
    onVerified,
    testID = 'phone-challenge',
}: PhoneChallengeProps) {
    const { t } = useTranslation();

    const [live, setLive] = useState<LiveChallenge>(() => ({ id: challengeId, from: challengeId }));
    const currentId = live.from === challengeId ? live.id : challengeId;

    const [lastAction, setLastAction] = useState<'verify' | 'resend' | null>(null);

    const challenge = useOtpChallengeQuery(currentId);
    const verify = useVerifyChallengeMutation();
    const resend = useResendChallengeMutation();

    const failure =
        lastAction === 'verify'
            ? toFailure(verify.error)
            : lastAction === 'resend'
              ? toFailure(resend.error)
              : null;

    if (challenge.isPending) {
        return (
            <Stack space="sm" testID={`${testID}-loading`}>
                <Skeleton testID={`${testID}-skeleton`} heightClassName="h-24" />
                <Skeleton heightClassName="h-10" widthClassName="w-1/2" />
            </Stack>
        );
    }

    const readFailure = toFailure(challenge.error);
    if (readFailure !== null) {
        return (
            <ErrorState
                testID={`${testID}-error`}
                failure={readFailure}
                onRetry={() => {
                    void challenge.refetch();
                }}
                retrying={challenge.isFetching}
            />
        );
    }

    // Neither pending nor failed and still no data is a state TanStack does not produce; rendering
    // nothing is the honest answer rather than fabricating an `ApiFailure` to show an error for.
    if (challenge.data === undefined) return null;

    return (
        <OtpChallengePanel
            testID={testID}
            challenge={challenge.data}
            failure={failure}
            fallbackMessage={t('account:phone.otpFallback')}
            verifying={verify.isPending}
            resending={resend.isPending}
            onVerify={(code) => {
                setLastAction('verify');
                verify.mutate(
                    { challengeId: currentId, code },
                    {
                        onSuccess: () => {
                            onVerified();
                        },
                    },
                );
            }}
            onResend={(channel: OtpChannel) => {
                setLastAction('resend');
                resend.mutate(
                    { challengeId: currentId, channel },
                    {
                        onSuccess: (next) => {
                            setLive({ id: next.id, from: challengeId });
                        },
                    },
                );
            }}
        />
    );
}
