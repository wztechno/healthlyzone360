import {
    Badge,
    Button,
    Callout,
    Card,
    Heading,
    Inline,
    Stack,
    Text,
} from '@healthy360/design-system';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import {
    toFailure,
    useContactPointsQuery,
    useIssueChallengeMutation,
} from '../../../data/account-hooks.ts';
import { QueryStates } from '../../marketplace/query-states.tsx';
import { PhoneChallenge } from '../phone-challenge.tsx';

/**
 * `/verify-phone` — confirming a mobile number, on its own page.
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
 * It sits in the `(auth)` group and inherits that group's chrome for the same reason
 * `/verify-email` does: somebody confirming a contact is mid-way into the product, not browsing it,
 * and a sidebar full of meal plans is noise at that moment.
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
}

export function VerifyPhoneScreen({ challengeId }: VerifyPhoneScreenProps) {
    const { t } = useTranslation();
    const router = useRouter();

    const contacts = useContactPointsQuery();
    const issue = useIssueChallengeMutation();

    const [issued, setIssued] = useState<string | null>(null);
    const [verified, setVerified] = useState(false);

    const live = challengeId ?? issued;
    const phone = (contacts.data ?? []).find(
        (contact) => contact.kind === 'phone' && !contact.verified,
    );
    const issueFailure = toFailure(issue.error);

    if (verified) {
        return (
            <Stack space="lg" testID={`${TEST_ID}-verified`}>
                <Heading level={1}>{t('account:phone.title')}</Heading>
                <Callout
                    testID={`${TEST_ID}-verified-callout`}
                    role="status"
                    tone="success"
                    title={t('account:phone.verifiedTitle')}
                    body={t('account:phone.verifiedBody')}
                    actions={
                        <Button
                            testID={`${TEST_ID}-continue`}
                            label={t('account:phone.backToAccount')}
                            onPress={() => {
                                router.push('/customer/account' as never);
                            }}
                        />
                    }
                />
            </Stack>
        );
    }

    return (
        <Stack space="lg" testID={TEST_ID}>
            <Stack space="xs">
                <Heading level={1} testID={`${TEST_ID}-title`}>
                    {t('account:phone.title')}
                </Heading>
                <Text tone="secondary">{t('account:phone.subtitle')}</Text>
            </Stack>

            {live !== null ? (
                <Card padding="md">
                    <PhoneChallenge
                        testID={`${TEST_ID}-challenge`}
                        challengeId={live}
                        onVerified={() => {
                            setVerified(true);
                        }}
                    />
                </Card>
            ) : (
                <QueryStates
                    query={contacts}
                    isEmpty={phone === undefined}
                    emptyTitle={t('account:phone.noNumberTitle')}
                    emptyBody={t('account:phone.noNumberBody')}
                    emptyActions={
                        <Button
                            testID={`${TEST_ID}-add`}
                            label={t('account:phone.addNumber')}
                            onPress={() => {
                                router.push('/customer/account/phone' as never);
                            }}
                        />
                    }
                    skeletonCount={1}
                    testID={`${TEST_ID}-contacts`}
                >
                    <Card testID={`${TEST_ID}-pending`} padding="md">
                        <Stack space="sm">
                            <Inline space="sm" align="center" justify="between">
                                <Text variant="bodyStrong">{phone?.maskedValue ?? ''}</Text>
                                <Badge
                                    testID={`${TEST_ID}-pending-state`}
                                    tone="warning"
                                    label={t('account:contacts.unverified')}
                                />
                            </Inline>
                            <Text tone="secondary">{t('account:phone.pendingBody')}</Text>

                            {issueFailure === null ? null : (
                                <Callout
                                    testID={`${TEST_ID}-issue-error`}
                                    role="alert"
                                    tone="danger"
                                    title={issueFailure.message}
                                />
                            )}

                            <Inline space="sm">
                                <Button
                                    testID={`${TEST_ID}-send`}
                                    label={t('account:phone.sendCode')}
                                    loading={issue.isPending}
                                    onPress={() => {
                                        if (phone === undefined) return;
                                        issue.mutate(
                                            {
                                                purpose: 'contact_verification',
                                                contactPointId: phone.id,
                                            },
                                            {
                                                onSuccess: (challenge) => {
                                                    setIssued(challenge.id);
                                                },
                                            },
                                        );
                                    }}
                                />
                            </Inline>
                        </Stack>
                    </Card>
                </QueryStates>
            )}
        </Stack>
    );
}
