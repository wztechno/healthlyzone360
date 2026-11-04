import type { ContactPoint } from '@healthy360/api-client/contracts';
import { Icon, Select, useToast } from '@healthy360/design-system';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Text as RNText, View } from 'react-native';

import {
    toFailure,
    useAddContactPointMutation,
    useContactPointsQuery,
    useIssueChallengeMutation,
} from '../../../data/account-hooks.ts';
import { useReturnTo } from '../../../navigation/use-return-to.ts';
import { AuthError, AuthField, AuthNote, AuthTick } from '../../../ui/auth-form.tsx';
import { QueryStates } from '../../marketplace/query-states.tsx';
import { ExtraButton, ExtraCard, ExtraChip, ExtraPage } from '../account-extra.tsx';
import { PhoneChallenge } from '../phone-challenge.tsx';
import { DEFAULT_DIALING_CODE, DIALING_CODES, toE164, validatePhone } from '../phone.ts';

/**
 * `/customer/account/phone` — add a mobile number and confirm it, drawn as the accepted Mobile-number
 * board: the back pill, "Your mobile number" beside its phone tile, and one card for the state the
 * person is in — the number on file with its chip, the country and number with "Send me a code", the
 * code, or the tick and "Your number is confirmed".
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
 *
 * ## Confirming goes back to whoever sent the person here
 *
 * Opened from the checkout or the plan setup (`?returnTo=`), a confirmed number returns there at
 * once with a short toast — the person came to finish an order. Opened from the account, the
 * confirmation stays on screen with a way back. The challenge in flight is `?challenge=`, so a
 * refresh resumes the code that was sent instead of sending another.
 */

const TEST_ID = 'phone-screen';

export interface PhoneScreenProps {
    /** The route's `?returnTo=` — the page to go back to once the number is confirmed. */
    readonly returnTo?: string | undefined;
    /** The route's `?challenge=` — a code challenge already in flight. */
    readonly challengeId?: string | undefined;
}

/** The phone contact a person is working with: the confirmed one, else the most recent unconfirmed. */
function currentPhone(contacts: readonly ContactPoint[]): ContactPoint | null {
    const phones = contacts.filter((contact) => contact.kind === 'phone');
    return phones.find((contact) => contact.verified) ?? phones[phones.length - 1] ?? null;
}

export function PhoneScreen({ returnTo, challengeId: challengeParam }: PhoneScreenProps) {
    const { t } = useTranslation();
    const router = useRouter();
    const toast = useToast();
    const back = useReturnTo(returnTo, '/customer/account?section=profile');

    const contacts = useContactPointsQuery();
    const addContact = useAddContactPointMutation();
    const issue = useIssueChallengeMutation();

    const [dial, setDial] = useState<string>(DEFAULT_DIALING_CODE.dial);
    const [national, setNational] = useState('');
    const [submitted, setSubmitted] = useState(false);
    /**
     * The challenge this screen is currently driving. Mirrored into the URL so a refresh resumes
     * it; held here as well so the panel appears on the same render the challenge is issued.
     */
    const [issuedChallenge, setIssuedChallenge] = useState<string | null>(null);
    const challengeId =
        issuedChallenge ??
        (challengeParam === undefined || challengeParam === '' ? null : challengeParam);
    const setChallengeId = (id: string) => {
        setIssuedChallenge(id);
        router.setParams({ challenge: id } as never);
    };
    const [verified, setVerified] = useState(false);

    const onVerified = () => {
        if (back.returnTo === null) {
            setVerified(true);
            // The challenge is spent. Left in the URL, a refresh would reopen a code entry for it
            // instead of showing the confirmed number.
            router.setParams({ challenge: undefined } as never);
            return;
        }
        toast.show({
            testID: `${TEST_ID}-verified-toast`,
            tone: 'success',
            message: t('account:phone.verifiedToast'),
        });
        back.finish();
    };

    const backLabel =
        back.returnTo === null ? t('account:title') : t(`common:destination.${back.destination}`);

    const page = (testID: string, children: ReactNode) => (
        <ExtraPage
            testID={testID}
            backTestID={`${TEST_ID}-trail-up`}
            backLabel={backLabel}
            onBack={back.up}
            icon="smartphone"
            title={t('account:phone.title')}
            titleTestID={`${TEST_ID}-title`}
        >
            {children}
        </ExtraPage>
    );

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
        return page(
            `${TEST_ID}-verified`,
            <ExtraCard testID={`${TEST_ID}-verified-callout`}>
                <View role="status" className="flex-col items-center px-5 pb-2.5 pt-7">
                    <AuthTick />
                    <RNText className="mt-6 font-display text-2xl font-bold text-content-primary text-center">
                        {t('account:phone.verifiedTitle')}
                    </RNText>
                    <RNText className="mb-5 mt-1.5 max-w-[440px] text-base font-medium leading-6 text-content-secondary text-center">
                        {t('account:phone.verifiedBody')}
                    </RNText>
                    <ExtraButton
                        testID={`${TEST_ID}-back`}
                        label={t(`common:returnTo.${back.destination}`)}
                        onPress={() => {
                            back.finish();
                        }}
                    />
                </View>
            </ExtraCard>,
        );
    }

    return page(
        TEST_ID,
        <QueryStates
            query={contacts}
            isEmpty={false}
            emptyTitle={t('account:phone.title')}
            skeletonCount={1}
            testID={`${TEST_ID}-contacts`}
        >
            {phone !== null && phone.verified ? (
                <ExtraCard testID={`${TEST_ID}-existing`}>
                    <NumberRow
                        value={phone.maskedValue}
                        chip={
                            <ExtraChip
                                testID={`${TEST_ID}-existing-state`}
                                tone="ok"
                                label={t('account:contacts.verified')}
                            />
                        }
                    />
                </ExtraCard>
            ) : null}

            {/* An unconfirmed number already on file: offer it before offering the form. */}
            {challengeId === null && phone !== null && !phone.verified ? (
                <ExtraCard testID={`${TEST_ID}-pending`}>
                    <NumberRow
                        value={phone.maskedValue}
                        note={t('account:phone.pendingBody')}
                        chip={
                            <ExtraChip
                                testID={`${TEST_ID}-pending-state`}
                                tone="amber"
                                label={t('account:contacts.unverified')}
                            />
                        }
                    />
                    {issueFailure === null ? null : (
                        <View className="mt-3">
                            <AuthError
                                testID={`${TEST_ID}-issue-error`}
                                message={issueFailure.message}
                            />
                        </View>
                    )}
                    <View className="mt-5 flex-row flex-wrap gap-2.5">
                        <ExtraButton
                            testID={`${TEST_ID}-send`}
                            label={t('account:phone.sendCode')}
                            icon="send"
                            busy={issue.isPending}
                            onPress={() => {
                                startChallengeFor(phone.id);
                            }}
                        />
                    </View>
                </ExtraCard>
            ) : null}

            {challengeId === null ? (
                <ExtraCard testID={`${TEST_ID}-form`} title={t('account:phone.formTitle')}>
                    {duplicate ? (
                        <View className="mt-3">
                            <AuthNote testID={`${TEST_ID}-duplicate`} tone="warning">
                                {`${t('account:phone.duplicateTitle')} ${t('account:phone.duplicateBody')}`}
                            </AuthNote>
                        </View>
                    ) : null}

                    {addFailure !== null && !duplicate ? (
                        <View className="mt-3">
                            <AuthError
                                testID={`${TEST_ID}-add-error`}
                                message={addFailure.message}
                            />
                        </View>
                    ) : null}

                    <View className="mt-3.5 flex-col gap-3 md:flex-row">
                        <View className="md:w-[220px]">
                            <Select
                                testID={`${TEST_ID}-country`}
                                label={t('account:phone.countryLabel')}
                                searchable
                                value={dial}
                                options={DIALING_CODES.map((entry) => ({
                                    value: entry.dial,
                                    label: `${t(`account:phone.countries.${entry.country}`)} · ${entry.dial}`,
                                }))}
                                onChange={setDial}
                            />
                        </View>
                        <View className="min-w-0 md:flex-1">
                            <AuthField
                                testID={`${TEST_ID}-number`}
                                label={t('account:phone.numberLabel')}
                                prefix={dial}
                                placeholder={t('account:phone.numberPlaceholder')}
                                value={national}
                                inputMode="tel"
                                keyboardType="phone-pad"
                                autoComplete="tel-national"
                                onChangeText={setNational}
                                error={shownError}
                            />
                        </View>
                    </View>

                    <View className="mt-5 flex-row flex-wrap gap-2.5">
                        <ExtraButton
                            testID={`${TEST_ID}-submit`}
                            label={t('account:phone.submit')}
                            icon="send"
                            busy={addContact.isPending}
                            onPress={submit}
                        />
                    </View>
                </ExtraCard>
            ) : (
                <ExtraCard testID={`${TEST_ID}-challenge-card`}>
                    <PhoneChallenge
                        testID={`${TEST_ID}-challenge`}
                        challengeId={challengeId}
                        onVerified={onVerified}
                    />
                </ExtraCard>
            )}
        </QueryStates>,
    );
}

/** The boards' number row: a phone tile, the number large, a note under it, and its state chip. */
function NumberRow({
    value,
    note,
    chip,
}: {
    readonly value: string;
    readonly note?: string | undefined;
    readonly chip: ReactNode;
}) {
    return (
        <View className="flex-row items-center gap-3.5 rounded-[18px] bg-surface-base p-4">
            <View className="h-11 w-11 items-center justify-center rounded-[14px] bg-surface-brand-subtle">
                <Icon name="smartphone" size="md" className="text-content-on-brand-subtle" />
            </View>
            <View className="min-w-0 flex-1">
                <RNText className="font-display text-xl font-bold tracking-wide text-content-primary text-start">
                    {value}
                </RNText>
                {note === undefined ? null : (
                    <RNText className="text-sm font-semibold text-content-secondary text-start">
                        {note}
                    </RNText>
                )}
            </View>
            {chip}
        </View>
    );
}
