import type { ApiFailure } from '@healthy360/api-client';
import { ErrorState, Skeleton, Stack } from '@healthy360/design-system';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import {
    toFailure,
    useGuestChallengeQuery,
    useResendGuestChallengeMutation,
} from '../../data/guest-hooks.ts';
import { OtpChallengePanel } from '../verification/index.ts';
import type { OtpChannel } from '../verification/index.ts';

/**
 * The one-time-code panel, wired to a live *guest* challenge.
 *
 * The same three facts `features/account/phone-challenge.tsx` owns — which challenge is live, which
 * rejection is the current one, what a successful verification does next — over the guest hooks
 * instead of the account ones. It is a second component rather than a parameter on the first
 * because the two differ in the only thing that matters: a guest has no `contactPointId` and no
 * account for the verification to mark, so the mutation, its invalidation and its success effect
 * are all different. Sharing the shell and not the wiring is what keeps both honest.
 *
 * Read the account version's header for the two mechanics reproduced here: a resend supersedes, so
 * the live id is state re-seeded from the prop; and two mutations can be in a failed state at once,
 * so the last action decides which error the panel is shown.
 */
export interface GuestChallengeProps {
    readonly challengeId: string;
    /**
     * The code the person entered, with the challenge it was entered against.
     *
     * The identifier is passed back rather than left for the caller to remember, because a resend
     * changes it *inside* this component — a caller holding the id it originally passed in would
     * verify against a challenge that has already been retired.
     */
    readonly onVerify: (code: string, challengeId: string) => void;
    readonly verifying?: boolean | undefined;
    /** The rejection from the caller's own verify mutation, if there is one. */
    readonly verifyFailure?: ApiFailure | null | undefined;
    readonly testID?: string | undefined;
}

interface LiveChallenge {
    readonly id: string;
    /** The prop this id was derived from, so a changed prop re-seeds without an effect. */
    readonly from: string;
}

export function GuestChallenge({
    challengeId,
    onVerify,
    verifying = false,
    verifyFailure = null,
    testID = 'guest-challenge',
}: GuestChallengeProps) {
    const { t } = useTranslation();

    const [live, setLive] = useState<LiveChallenge>(() => ({ id: challengeId, from: challengeId }));
    const currentId = live.from === challengeId ? live.id : challengeId;

    const [lastAction, setLastAction] = useState<'verify' | 'resend' | null>(null);

    const challenge = useGuestChallengeQuery(currentId);
    const resend = useResendGuestChallengeMutation();

    const failure = lastAction === 'resend' ? toFailure(resend.error) : (verifyFailure ?? null);

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
            fallbackMessage={t('guest:verify.otpFallback')}
            verifying={verifying}
            resending={resend.isPending}
            onVerify={(code) => {
                setLastAction('verify');
                onVerify(code, currentId);
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
