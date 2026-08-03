import type { ContactPoint } from '@healthy360/api-client/contracts';
import {
    Badge,
    Button,
    Callout,
    Card,
    Heading,
    Inline,
    Select,
    Stack,
    Text,
    TextInputField,
} from '@healthy360/design-system';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import {
    toFailure,
    useAddContactPointMutation,
    useContactPointsQuery,
    useIssueChallengeMutation,
} from '../../../data/account-hooks.ts';
import { QueryStates } from '../../marketplace/query-states.tsx';
import { PhoneChallenge } from '../phone-challenge.tsx';
import { DEFAULT_DIALING_CODE, DIALING_CODES, toE164, validatePhone } from '../phone.ts';

/**
 * `/customer/account/phone` — add a mobile number and confirm it.
 *
 * ## Three states, and the screen picks between them from the contact list
 *
 * A person arrives here in one of three situations, and asking them which is not acceptable:
 *
 * * **A confirmed number already.** The screen says so and offers nothing to do. Re-verifying a
 *   confirmed number is not a feature; changing it is, and that starts by adding the new one.
 * * **A number added but not confirmed.** This is the common case — registration collects a number
 *   and stops. The screen offers to send a code to *that* number rather than making them type it
 *   again, because typing it again is how a person ends up with two numbers on their account, one
 *   of which is a typo.
 * * **No number at all.** The entry form.
 *
 * ## Entry is two fields for one string
 *
 * `ContactPoint.value` is E.164 and the composition lives in `../phone.ts` — see that module for
 * why a single free-text field is a reliable way to collect three different renderings of the same
 * number. The country list is closed and short; the default is the head of the list and is a
 * fixture default rather than a detection, which that module records.
 *
 * ## The duplicate is a real answer, not an error to hide
 *
 * Adding a number that is already on the account is refused with `resource.conflict`. The generic
 * conflict copy ("somebody else changed this while you were editing it") is *wrong* here — nobody
 * changed anything — so the screen says what actually happened and points at the thing they already
 * have. That is the difference between an error message and an answer.
 */

const TEST_ID = 'phone-screen';

/** The phone contact a person is working with: the confirmed one, else the most recent unconfirmed. */
function currentPhone(contacts: readonly ContactPoint[]): ContactPoint | null {
    const phones = contacts.filter((contact) => contact.kind === 'phone');
    return phones.find((contact) => contact.verified) ?? phones[phones.length - 1] ?? null;
}

export function PhoneScreen() {
    const { t } = useTranslation();
    const router = useRouter();

    const contacts = useContactPointsQuery();
    const addContact = useAddContactPointMutation();
    const issue = useIssueChallengeMutation();

    const [dial, setDial] = useState<string>(DEFAULT_DIALING_CODE.dial);
    const [national, setNational] = useState('');
    const [submitted, setSubmitted] = useState(false);
    /** The challenge this screen is currently driving. `null` until one is issued or resumed. */
    const [challengeId, setChallengeId] = useState<string | null>(null);
    const [verified, setVerified] = useState(false);

    const phone = currentPhone(contacts.data ?? []);
    const errorKey = validatePhone(dial, national);
    // Errors appear on submit, not on the first keystroke: telling somebody their number is too
    // short while they are still typing it is technically true and useless.
    const shownError = submitted && errorKey !== null ? t(errorKey) : undefined;

    const addFailure = toFailure(addContact.error);
    const issueFailure = toFailure(issue.error);
    const duplicate = addFailure?.code === 'resource.conflict';

    const startChallengeFor = (contactPointId: string) => {
        issue.mutate(
            { purpose: 'contact_verification', contactPointId },
            {
                onSuccess: (challenge) => {
                    setChallengeId(challenge.id);
                },
            },
        );
    };

    const submit = () => {
        setSubmitted(true);
        if (errorKey !== null) return;
        const value = toE164(dial, national);
        if (value === null) return;

        addContact.mutate(
            { kind: 'phone', value, verifyNow: true },
            {
                onSuccess: (added) => {
                    if (added.challenge !== null) setChallengeId(added.challenge.id);
                },
            },
        );
    };

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
                            testID={`${TEST_ID}-back`}
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

            <QueryStates
                query={contacts}
                isEmpty={false}
                emptyTitle={t('account:phone.title')}
                skeletonCount={1}
                testID={`${TEST_ID}-contacts`}
            >
                <Stack space="lg">
                    {phone !== null && phone.verified ? (
                        <Card testID={`${TEST_ID}-existing`} padding="md">
                            <Inline space="sm" align="center" justify="between">
                                <Text variant="bodyStrong">{phone.maskedValue}</Text>
                                <Badge
                                    testID={`${TEST_ID}-existing-state`}
                                    tone="success"
                                    label={t('account:contacts.verified')}
                                />
                            </Inline>
                        </Card>
                    ) : null}

                    {/* An unconfirmed number already on file: offer it before offering the form. */}
                    {challengeId === null && phone !== null && !phone.verified ? (
                        <Card testID={`${TEST_ID}-pending`} padding="md">
                            <Stack space="sm">
                                <Inline space="sm" align="center" justify="between">
                                    <Text variant="bodyStrong">{phone.maskedValue}</Text>
                                    <Badge
                                        testID={`${TEST_ID}-pending-state`}
                                        tone="warning"
                                        label={t('account:contacts.unverified')}
                                    />
                                </Inline>
                                <Text tone="secondary">{t('account:phone.pendingBody')}</Text>
                                <Inline space="sm">
                                    <Button
                                        testID={`${TEST_ID}-send`}
                                        label={t('account:phone.sendCode')}
                                        loading={issue.isPending}
                                        onPress={() => {
                                            startChallengeFor(phone.id);
                                        }}
                                    />
                                </Inline>
                                {issueFailure === null ? null : (
                                    <Callout
                                        testID={`${TEST_ID}-issue-error`}
                                        role="alert"
                                        tone="danger"
                                        title={issueFailure.message}
                                    />
                                )}
                            </Stack>
                        </Card>
                    ) : null}

                    {challengeId === null ? (
                        <Card testID={`${TEST_ID}-form`} padding="md">
                            <Stack space="sm">
                                <Heading level={2}>{t('account:phone.formTitle')}</Heading>

                                {duplicate ? (
                                    <Callout
                                        testID={`${TEST_ID}-duplicate`}
                                        role="alert"
                                        tone="warning"
                                        title={t('account:phone.duplicateTitle')}
                                        body={t('account:phone.duplicateBody')}
                                    />
                                ) : null}

                                {addFailure !== null && !duplicate ? (
                                    <Callout
                                        testID={`${TEST_ID}-add-error`}
                                        role="alert"
                                        tone="danger"
                                        title={addFailure.message}
                                    />
                                ) : null}

                                <Select
                                    testID={`${TEST_ID}-country`}
                                    label={t('account:phone.countryLabel')}
                                    hint={t('account:phone.countryHint')}
                                    searchable
                                    value={dial}
                                    options={DIALING_CODES.map((entry) => ({
                                        value: entry.dial,
                                        label: `${t(`account:phone.countries.${entry.country}`)} ${entry.dial}`,
                                    }))}
                                    onChange={setDial}
                                />

                                <TextInputField
                                    testID={`${TEST_ID}-number`}
                                    label={t('account:phone.numberLabel')}
                                    hint={t('account:phone.numberHint')}
                                    value={national}
                                    required
                                    inputMode="tel"
                                    keyboardType="phone-pad"
                                    autoComplete="tel-national"
                                    onChangeText={setNational}
                                    {...(shownError === undefined ? {} : { error: shownError })}
                                />

                                <Inline space="sm">
                                    <Button
                                        testID={`${TEST_ID}-submit`}
                                        label={t('account:phone.submit')}
                                        loading={addContact.isPending}
                                        onPress={submit}
                                    />
                                </Inline>
                            </Stack>
                        </Card>
                    ) : (
                        <Card testID={`${TEST_ID}-challenge-card`} padding="md">
                            <PhoneChallenge
                                testID={`${TEST_ID}-challenge`}
                                challengeId={challengeId}
                                onVerified={() => {
                                    setVerified(true);
                                }}
                            />
                        </Card>
                    )}
                </Stack>
            </QueryStates>
        </Stack>
    );
}
