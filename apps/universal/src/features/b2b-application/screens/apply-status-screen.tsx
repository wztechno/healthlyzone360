import { Button, Dialog, Text } from '@healthy360/design-system';
import { Redirect, useRouter } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import {
    toFailure,
    useB2BApplicationQuery,
    useWithdrawB2BApplicationMutation,
} from '../../../data/b2b-application-hooks.ts';
import { ExtraButton, ExtraLink, ExtraNote, ExtraPage } from '../../account/account-extra.tsx';
import { QueryStates } from '../../marketplace/query-states.tsx';
import { StageRail, StatusPanel } from '../status-panel.tsx';

/**
 * `/apply/status` — where it stands, in every state.
 *
 * The screen is thin on purpose: {@link StatusPanel} owns the eleven states, and this is the route
 * that gives it data and the two actions that belong to a *page* rather than to a panel — going
 * somewhere, and withdrawing.
 *
 * ## It keeps itself current while the platform has the next move
 *
 * From `submitted` to `provisioning` nothing the applicant does changes the state, so the read polls
 * every thirty seconds there (`useB2BApplicationQuery`'s `pollMs`) and stops on its own once the
 * application is back with them or done. Once it is `provisioned`, the way on is the workspace.
 *
 * ## Withdrawing asks first, and says what withdrawing does
 *
 * It is the applicant's exit and it is not reversible: the application becomes terminal, and the
 * documents are on a retention schedule rather than kept indefinitely. So the confirmation says both
 * of those things rather than asking "are you sure?" about an unnamed consequence.
 */

const TEST_ID = 'b2b-apply-status';
const POLL_MS = 30_000;

export function ApplyStatusScreen() {
    const { t } = useTranslation();
    const router = useRouter();

    const application = useB2BApplicationQuery(true, POLL_MS);
    const withdraw = useWithdrawB2BApplicationMutation();

    const [confirming, setConfirming] = useState(false);

    const current = application.data ?? null;
    const withdrawFailure = toFailure(withdraw.error);

    return (
        <ExtraPage
            wide
            testID={TEST_ID}
            backTestID={`${TEST_ID}-back`}
            backLabel={t('marketplace:nav.business')}
            onBack={() => {
                router.push('/for-business' as never);
            }}
            icon="clock"
            title={t('b2bApplication:status.title')}
            titleTestID={`${TEST_ID}-title`}
        >
            {withdrawFailure === null ? null : (
                <View className="mt-[18px]">
                    <ExtraNote
                        testID={`${TEST_ID}-withdraw-error`}
                        role="alert"
                        tone="bad"
                        icon="warning"
                        title={withdrawFailure.message}
                    />
                </View>
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
                    <View className="mt-[18px] flex-col gap-6 lg:flex-row lg:items-start">
                        <View className="min-w-0 flex-1">
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

                            {current.state === 'provisioned' ? (
                                <View className="mt-3 flex-row">
                                    <ExtraButton
                                        testID={`${TEST_ID}-workspace`}
                                        label={t('b2bApplication:provisioning.goToWorkspace')}
                                        icon="arrowForward"
                                        onPress={() => {
                                            router.push('/corporate' as never);
                                        }}
                                    />
                                </View>
                            ) : null}

                            {current.state === 'draft' ||
                            current.state === 'submitted' ||
                            current.state === 'in_review' ||
                            current.state === 'info_requested' ? (
                                <ExtraLink
                                    testID={`${TEST_ID}-withdraw`}
                                    label={t('b2bApplication:review.withdraw')}
                                    onPress={() => {
                                        setConfirming(true);
                                    }}
                                />
                            ) : null}
                        </View>
                        <View className="w-full lg:w-[340px]">
                            <StageRail state={current.state} testID={`${TEST_ID}-stages`} />
                        </View>

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
                    </View>
                )}
            </QueryStates>
        </ExtraPage>
    );
}
