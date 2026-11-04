import { ErrorState, Icon, Skeleton, useToast } from '@healthy360/design-system';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Text as RNText, View } from 'react-native';

import { useReturnTo } from '../../../navigation/use-return-to.ts';

import {
    toFailure,
    useContactPointsQuery,
    useIssueChallengeMutation,
} from '../../../data/account-hooks.ts';
import { AuthBadge, AuthSubmit, AuthText, AuthTick, AuthTitle } from '../../../ui/auth-form.tsx';
import { ExtraChip, ExtraNote } from '../account-extra.tsx';
import { PhoneChallenge } from '../phone-challenge.tsx';

/**
 * `/verify-phone` — confirming a mobile number, on its own page, drawn as the Explorations board in
 * the sign-in frame: the phone badge and "Your mobile number", the number with its "Not confirmed"
 * chip and Send me a code; once a code is out, the six boxes, Confirm, and the other channels behind
 * "Send the code another way"; then the tick.
 *
 * ## Why this exists next to `/customer/account/phone`
 *
 * The two are not duplicates. `/customer/account/phone` is a *management* screen inside the
 * consumer chrome: it changes a number, and confirming is the last step of doing so. This one is a
 * **destination**: it is where a link in a message, a redirect after registration, or a resumed
 * session lands, and it carries a challenge identifier in the URL so that a page load recovers the
 * live challenge — with its cooldown intact — rather than issuing a second code (journey-forced
 * shape 1, `contracts/verification.ts`).
 *
 * It sits in the `(auth)` group and is one of its board pages, in the frame `/verify-email` uses:
 * somebody confirming a contact is mid-way into the product, not browsing it.
 *
 * ## Arriving with nothing does not silently send a code
 *
 * With no `challenge` parameter the screen shows the unconfirmed number and a button. Issuing on
 * mount would be tidier and would mean a refresh, a back-navigation or a double-mount each burned a
 * message and a slot in somebody's resend budget without them asking for anything.
 */

const TEST_ID = 'verify-phone-screen';

export interface VerifyPhoneScreenProps {
    /** `?challenge=` — a live challenge to resume. Absent when the page was opened cold. */
    readonly challengeId?: string | undefined;
    /** `?returnTo=` — where to go once the number is confirmed. */
    readonly returnTo?: string | undefined;
}

export function VerifyPhoneScreen({ challengeId, returnTo }: VerifyPhoneScreenProps) {
    const { t } = useTranslation();
    const router = useRouter();
    const toast = useToast();
    const back = useReturnTo(returnTo, '/customer/account?section=profile');

    const contacts = useContactPointsQuery();
    const issue = useIssueChallengeMutation();

    const [issued, setIssued] = useState<string | null>(null);
    const [verified, setVerified] = useState(false);

    // Sent somewhere by a step, go straight back there; otherwise say so here, with a way on.
    const onVerified = () => {
        if (back.returnTo === null) {
            setVerified(true);
            return;
        }
        toast.show({
            testID: `${TEST_ID}-verified-toast`,
            tone: 'success',
            message: t('account:phone.verifiedToast'),
        });
        back.finish();
    };

    /*
     * A challenge issued here goes into the URL as well, the same `?challenge=` a link arrives
     * with — so a refresh resumes this code, cooldown and all, rather than offering to send
     * another and spending the resend allowance.
     */
    const startChallenge = (id: string) => {
        setIssued(id);
        router.setParams({ challenge: id } as never);
    };

    const live = challengeId ?? issued;
    const phone = (contacts.data ?? []).find(
        (contact) => contact.kind === 'phone' && !contact.verified,
    );
    const issueFailure = toFailure(issue.error);

    if (verified) {
        return (
            <View testID={`${TEST_ID}-verified`} className="flex-col items-center gap-3.5">
                <AuthTick />
                <View testID={`${TEST_ID}-verified-callout`} role="status" className="w-full">
                    <AuthTitle centred>{t('account:phone.verifiedTitle')}</AuthTitle>
                    <View className="mt-2">
                        <AuthText centred>{t('account:phone.verifiedBody')}</AuthText>
                    </View>
                </View>
                <View className="mt-2 w-full">
                    <AuthSubmit
                        testID={`${TEST_ID}-continue`}
                        label={t(`common:returnTo.${back.destination}`)}
                        onPress={() => {
                            back.finish();
                        }}
                    />
                </View>
            </View>
        );
    }

    const opening = (
        <>
            <AuthBadge icon="smartphone" />
            <AuthTitle testID={`${TEST_ID}-title`}>{t('account:phone.title')}</AuthTitle>
        </>
    );

    if (live !== null) {
        return (
            <View testID={TEST_ID} className="flex-col gap-3.5">
                {opening}
                <PhoneChallenge
                    testID={`${TEST_ID}-challenge`}
                    look="auth"
                    challengeId={live}
                    onVerified={onVerified}
                />
            </View>
        );
    }

    const readFailure = toFailure(contacts.error);

    return (
        <View testID={TEST_ID} className="flex-col gap-3.5">
            {opening}
            <AuthText>{t('account:phone.subtitle')}</AuthText>

            {contacts.isPending ? (
                <View testID={`${TEST_ID}-contacts-loading`} className="flex-col gap-3">
                    <Skeleton heightClassName="h-20" />
                    <Skeleton heightClassName="h-[54px]" />
                </View>
            ) : readFailure !== null ? (
                <ErrorState
                    testID={`${TEST_ID}-contacts-error`}
                    failure={readFailure}
                    onRetry={() => {
                        void contacts.refetch();
                    }}
                    retrying={contacts.isFetching}
                />
            ) : phone === undefined ? (
                <View testID={`${TEST_ID}-contacts-empty`} className="flex-col gap-3.5">
                    <ExtraNote
                        icon="smartphone"
                        title={t('account:phone.noNumberTitle')}
                        body={t('account:phone.noNumberBody')}
                    />
                    <AuthSubmit
                        testID={`${TEST_ID}-add`}
                        label={t('account:phone.addNumber')}
                        onPress={() => {
                            router.push(back.carry('/customer/account/phone') as never);
                        }}
                    />
                </View>
            ) : (
                <View testID={`${TEST_ID}-pending`} className="flex-col gap-3.5">
                    <View className="flex-row items-center gap-3.5 rounded-[18px] bg-surface-sunken p-4">
                        <View className="h-11 w-11 items-center justify-center rounded-[14px] bg-surface-brand-subtle">
                            <Icon
                                name="smartphone"
                                size="md"
                                className="text-content-on-brand-subtle"
                            />
                        </View>
                        <View className="min-w-0 flex-1">
                            <RNText className="font-display text-xl font-bold tracking-wide text-content-primary text-start">
                                {phone.maskedValue}
                            </RNText>
                            <RNText className="mt-0.5 text-sm font-medium text-content-secondary text-start">
                                {t('account:phone.pendingBody')}
                            </RNText>
                        </View>
                        <ExtraChip
                            testID={`${TEST_ID}-pending-state`}
                            tone="amber"
                            label={t('account:contacts.unverified')}
                        />
                    </View>

                    {issueFailure === null ? null : (
                        <ExtraNote
                            testID={`${TEST_ID}-issue-error`}
                            role="alert"
                            tone="bad"
                            icon="warning"
                            title={issueFailure.message}
                        />
                    )}

                    <AuthSubmit
                        testID={`${TEST_ID}-send`}
                        label={t('account:phone.sendCode')}
                        busy={issue.isPending}
                        onPress={() => {
                            issue.mutate(
                                {
                                    purpose: 'contact_verification',
                                    contactPointId: phone.id,
                                },
                                {
                                    onSuccess: (challenge) => {
                                        startChallenge(challenge.id);
                                    },
                                },
                            );
                        }}
                    />
                </View>
            )}
        </View>
    );
}
