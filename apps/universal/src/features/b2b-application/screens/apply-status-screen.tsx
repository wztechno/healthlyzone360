import { Button, Callout, Dialog, Heading, Stack, Text } from '@healthy360/design-system';
import { Redirect, useRouter } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import {
    toFailure,
    useB2BApplicationQuery,
    useWithdrawB2BApplicationMutation,
} from '../../../data/b2b-application-hooks.ts';
import { QueryStates } from '../../marketplace/query-states.tsx';
import { StatusPanel } from '../status-panel.tsx';

/**
 * `/apply/status` — where it stands, in every state.
 *
 * The screen is thin on purpose: {@link StatusPanel} owns the eleven states, and this is the route
 * that gives it data and the two actions that belong to a *page* rather than to a panel — going
 * somewhere, and withdrawing.
 *
 * ## Withdrawing asks first, and says what withdrawing does
 *
 * It is the applicant's exit and it is not reversible: the application becomes terminal, and the
 * documents are on a retention schedule rather than kept indefinitely. So the confirmation says both
 * of those things rather than asking "are you sure?" about an unnamed consequence.
 */

const TEST_ID = 'b2b-apply-status';

export function ApplyStatusScreen() {
    const { t } = useTranslation();
    const router = useRouter();

    const application = useB2BApplicationQuery();
    const withdraw = useWithdrawB2BApplicationMutation();

    const [confirming, setConfirming] = useState(false);

    const current = application.data ?? null;
    const withdrawFailure = toFailure(withdraw.error);

    return (
        <Stack space="lg" testID={TEST_ID}>
            <Heading level={1} testID={`${TEST_ID}-title`}>
                {t('b2bApplication:status.title')}
            </Heading>

            {withdrawFailure === null ? null : (
                <Callout
                    testID={`${TEST_ID}-withdraw-error`}
                    role="alert"
                    tone="danger"
                    title={withdrawFailure.message}
                />
            )}

            <QueryStates
                query={application}
                isEmpty={false}
                emptyTitle={t('b2bApplication:status.title')}
                testID={TEST_ID}
            >
                {current === null ? (
                    // No application to have a status. The entry screen is the honest destination.
                    <Redirect href={'/apply' as never} />
                ) : (
                    <Stack space="lg">
                        <StatusPanel
                            application={current}
                            testID={`${TEST_ID}-panel`}
                            onOpenStep={(slug) => {
                                router.push(`/apply/${slug}` as never);
                            }}
                            onOpenAgreement={() => {
                                router.push('/apply/agreement' as never);
                            }}
                            onOpenProvisioning={() => {
                                router.push('/apply/provisioning' as never);
                            }}
                        />

                        {current.state === 'draft' ||
                        current.state === 'submitted' ||
                        current.state === 'in_review' ||
                        current.state === 'info_requested' ? (
                            <Button
                                testID={`${TEST_ID}-withdraw`}
                                variant="ghost"
                                label={t('b2bApplication:review.withdraw')}
                                onPress={() => {
                                    setConfirming(true);
                                }}
                            />
                        ) : null}

                        <Dialog
                            testID={`${TEST_ID}-withdraw-dialog`}
                            open={confirming}
                            title={t('b2bApplication:review.withdraw')}
                            onClose={() => {
                                setConfirming(false);
                            }}
                            actions={
                                <Button
                                    testID={`${TEST_ID}-withdraw-confirm`}
                                    variant="danger"
                                    label={t('b2bApplication:review.withdraw')}
                                    loading={withdraw.isPending}
                                    onPress={() => {
                                        withdraw.mutate(
                                            {
                                                applicationId: current.id,
                                                lockVersion: current.lockVersion,
                                            },
                                            {
                                                onSettled: () => {
                                                    setConfirming(false);
                                                },
                                            },
                                        );
                                    }}
                                />
                            }
                        >
                            <Text>{t('b2bApplication:review.withdrawConfirm')}</Text>
                        </Dialog>
                    </Stack>
                )}
            </QueryStates>
        </Stack>
    );
}
