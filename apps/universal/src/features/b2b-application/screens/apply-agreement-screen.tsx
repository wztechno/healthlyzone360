import { Callout, Heading, Stack } from '@healthy360/design-system';
import { Redirect, useRouter } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import {
    toFailure,
    useB2BAgreementQuery,
    useB2BApplicationQuery,
    useIssueSignatureChallengeMutation,
    useSignAgreementMutation,
} from '../../../data/b2b-application-hooks.ts';
import {
    useOtpChallengeQuery,
    useResendChallengeMutation,
    useVerifyChallengeMutation,
} from '../../../data/account-hooks.ts';
import { QueryStates } from '../../marketplace/query-states.tsx';
import { AgreementPanel } from '../agreement-panel.tsx';
import { awaitsSignature } from '../sections.ts';

/**
 * `/apply/agreement` — read the terms, step up, accept.
 *
 * ## The step-up is a `b2b_signatory` challenge, on the shared OTP surface
 *
 * The same framework J1 built, with a different purpose. That is the whole point of the purpose
 * field: the panel, the error matrix, the cooldown and the lockout are one implementation, and what
 * differs per journey is what a successful verification *buys*. Here it buys the token that opens
 * the acceptance control. The code is *raised* against the agreement
 * (`issueSignatureChallenge`), because the generic issue routes refuse a purpose that grants no
 * step-up; verifying and resending go through the shared routes like any other challenge.
 *
 * ## The token, honestly
 *
 * `OtpVerificationResult` carries a challenge identifier and a step-up window, not a bearer token.
 * `signAgreement` wants `<challengeId>:<code>` — the same pairing the wind-down sign-off sends — so
 * this screen keeps the code the person typed and packs the two once the code verifies. The sign
 * endpoint accepts a challenge the generic verify step has already spent, for a short window, so
 * verifying first (which is what opens the acceptance control) does not burn the token.
 *
 * ## The digest comes from the agreement read here
 *
 * `useB2BAgreementQuery` re-reads the agreement rather than using the copy carried on the
 * application, so the digest echoed back on acceptance is the one the server holds now. A document
 * that changed under the signatory is then refused rather than silently signed.
 */

const TEST_ID = 'b2b-apply-agreement';

export function ApplyAgreementScreen() {
    const { t } = useTranslation();
    const router = useRouter();

    const application = useB2BApplicationQuery();
    const current = application.data ?? null;
    const agreementQuery = useB2BAgreementQuery(current?.id ?? null);

    const issue = useIssueSignatureChallengeMutation();
    const verify = useVerifyChallengeMutation();
    const resend = useResendChallengeMutation();
    const sign = useSignAgreementMutation();

    /** The live challenge, and the verified challenge that unlocked the acceptance control. */
    const [challengeId, setChallengeId] = useState<string | null>(null);
    const [verificationToken, setVerificationToken] = useState<string | null>(null);

    const challenge = useOtpChallengeQuery(challengeId);
    const agreement = agreementQuery.data ?? null;

    const failure =
        toFailure(issue.error) ??
        toFailure(verify.error) ??
        toFailure(resend.error) ??
        toFailure(sign.error);

    return (
        <Stack space="lg" testID={TEST_ID}>
            <Heading level={1} testID={`${TEST_ID}-title`}>
                {t('b2bApplication:agreement.title')}
            </Heading>

            {failure === null || failure.code.startsWith('otp.') ? null : (
                <Callout
                    testID={`${TEST_ID}-error`}
                    role="alert"
                    tone="danger"
                    title={failure.message}
                />
            )}

            <QueryStates
                query={agreementQuery}
                isEmpty={false}
                emptyTitle={t('b2bApplication:agreement.title')}
                testID={TEST_ID}
            >
                {current === null ? (
                    <Redirect href={'/apply' as never} />
                ) : agreement === null ||
                  (!awaitsSignature(current) && agreement.signature === null) ? (
                    // Nothing to accept: no agreement drafted, or the application is not at a point
                    // where one is waiting. The status panel is the honest destination.
                    <Redirect href={'/apply/status' as never} />
                ) : (
                    <AgreementPanel
                        testID={`${TEST_ID}-panel`}
                        agreement={agreement}
                        challenge={challenge.data ?? null}
                        verificationToken={verificationToken}
                        issuing={issue.isPending}
                        verifying={verify.isPending}
                        resending={resend.isPending}
                        signing={sign.isPending}
                        failure={failure}
                        onRequestCode={() => {
                            issue.mutate(
                                { applicationId: current.id, agreementId: agreement.id },
                                {
                                    onSuccess: (issued) => {
                                        setChallengeId(issued.id);
                                    },
                                },
                            );
                        }}
                        onVerifyCode={(code) => {
                            if (challengeId === null) return;
                            verify.mutate(
                                { challengeId, code },
                                {
                                    onSuccess: (result) => {
                                        setVerificationToken(`${result.challengeId}:${code}`);
                                    },
                                },
                            );
                        }}
                        onResendCode={(channel) => {
                            if (challengeId === null) return;
                            resend.mutate(
                                { challengeId, channel },
                                {
                                    onSuccess: (next) => {
                                        setChallengeId(next.id);
                                    },
                                },
                            );
                        }}
                        onSign={({ typedName, signatoryTitle, authorityConfirmed }) => {
                            sign.mutate(
                                {
                                    agreementId: agreement.id,
                                    kind: 'typed_name',
                                    typedName,
                                    signatoryTitle,
                                    authorityConfirmed,
                                    documentSha256: agreement.documentSha256,
                                    verificationToken: verificationToken ?? '',
                                    lockVersion: agreement.lockVersion,
                                },
                                {
                                    onSuccess: () => {
                                        router.replace('/apply/provisioning' as never);
                                    },
                                },
                            );
                        }}
                    />
                )}
            </QueryStates>
        </Stack>
    );
}
