import { Icon, cx } from '@healthy360/design-system';
import { useRouter } from 'expo-router';
import { Fragment, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Text as RNText, View } from 'react-native';

import {
    toFailure,
    useConfirmGuestDeletionMutation,
    useRequestGuestDeletionMutation,
} from '../../../data/guest-hooks.ts';
import {
    ExtraButton,
    ExtraCard,
    ExtraLink,
    ExtraNote,
    ExtraPage,
} from '../../account/account-extra.tsx';
import { AuthCheck, AuthField, AuthTick } from '../../../ui/auth-form.tsx';
import { CodeBoxes } from '../../../ui/code-boxes.tsx';

/**
 * `/privacy/delete-my-data` — erasure, for somebody who may never have had an account. Drawn as the
 * Explorations board: the red bin tile over the three steps (ask, confirm, deleted), one card per
 * step, and the tick with what is kept on purpose.
 *
 * ## It is public, and it is not behind the guest token
 *
 * Deliberately. The people most likely to need this page are the ones least likely to still hold a
 * credential: they ordered once, months ago, from a browser they have since cleared. Gating erasure
 * on a token would deny the right to exactly those people, and would make it available only to
 * somebody whose data is already in front of them.
 *
 * ## The screen tells the same story whether or not we hold anything
 *
 * `requestDeletion` is always accepted and its answer is built entirely from what was just typed —
 * there is no challenge identifier, because a nullable identifier is a boolean in disguise and that
 * boolean is "this address is known to us" (`contracts/guest.ts`). So this screen says *if* we hold
 * anything, a code is on its way, and then asks for it. An address we hold nothing for receives no
 * message, and every code entered against it fails the way a wrong code fails. The copy says so
 * out loud rather than leaving somebody to conclude we are broken.
 *
 * ## The irreversible step has its own gate
 *
 * Entering a correct code is not the confirmation. A separate acknowledgement — a checkbox that
 * starts unticked, next to a plain statement of what is destroyed — sits between the code and the
 * button, because "type six digits" is a muscle action and this is not a reversible one.
 *
 * ## And it says what survives
 *
 * A one-way fingerprint of the address is kept, so that "never contact me again" outlives the
 * deletion of everything else. Claiming total erasure while keeping a record would be a lie, and
 * the record exists in the person's own interest — so it is stated on the success screen rather
 * than buried in a policy.
 */

const TEST_ID = 'guest-deletion';

type Phase = 'request' | 'confirm' | 'done';

const PHASES: readonly Phase[] = ['request', 'confirm', 'done'];

export function GuestDeletionScreen() {
    const { t } = useTranslation();
    const router = useRouter();

    const [email, setEmail] = useState('');
    const [mobile, setMobile] = useState('');
    const [code, setCode] = useState('');
    const [acknowledged, setAcknowledged] = useState(false);
    const [phase, setPhase] = useState<Phase>('request');
    const [masked, setMasked] = useState('');

    const request = useRequestGuestDeletionMutation();
    const confirm = useConfirmGuestDeletionMutation();

    const identity = {
        ...(email.trim().length === 0 ? {} : { email: email.trim() }),
        ...(mobile.trim().length === 0 ? {} : { mobile: mobile.trim() }),
    };
    const hasIdentity = Object.keys(identity).length > 0;
    const requestFailure = toFailure(request.error);

    const sendRequest = () => {
        if (!hasIdentity) return;
        request.mutate(identity, {
            // Always accepted. There is no branch here on whether the address is known, because
            // the answer does not carry one.
            onSuccess: (acknowledgement) => {
                setMasked(acknowledgement.destinationMasked);
                setPhase('confirm');
            },
        });
    };

    const toShop = () => {
        router.push('/discover');
    };

    return (
        <ExtraPage
            testID={phase === 'done' ? `${TEST_ID}-done` : TEST_ID}
            backTestID={`${TEST_ID}-back`}
            backLabel={t('auth:frame.backToShop')}
            onBack={toShop}
            icon="ban"
            tone="danger"
            title={t('guest:deletion.title')}
            titleTestID={`${TEST_ID}-title`}
            lede={t('guest:deletion.subtitle')}
        >
            <Progress phase={phase} />

            {phase === 'request' ? (
                <ExtraCard
                    testID={`${TEST_ID}-request-step`}
                    title={t('guest:deletion.requestTitle')}
                >
                    <RNText className="text-sm font-medium leading-[21px] text-content-secondary text-start">
                        {t('guest:deletion.requestBody')}
                    </RNText>
                    <View className="mt-4 flex-col gap-3.5 md:flex-row md:items-start">
                        <View className="min-w-0 md:flex-1">
                            <AuthField
                                testID={`${TEST_ID}-email`}
                                icon="send"
                                label={t('guest:deletion.email')}
                                placeholder={t('auth:login.emailPlaceholder')}
                                hint={t('guest:deletion.emailHint')}
                                value={email}
                                onChangeText={setEmail}
                                keyboardType="email-address"
                                autoComplete="email"
                                autoCapitalize="none"
                                onSubmitEditing={sendRequest}
                            />
                        </View>
                        <View className="items-center justify-center md:h-[82px] md:pt-[26px]">
                            <RNText className="text-xs font-bold uppercase tracking-widest text-content-secondary">
                                {t('guest:deletion.or')}
                            </RNText>
                        </View>
                        <View className="min-w-0 md:flex-1">
                            <AuthField
                                testID={`${TEST_ID}-mobile`}
                                icon="smartphone"
                                label={t('guest:deletion.mobile')}
                                placeholder={t('guest:deletion.mobilePlaceholder')}
                                hint={t('guest:deletion.mobileHint')}
                                value={mobile}
                                onChangeText={setMobile}
                                keyboardType="phone-pad"
                                inputMode="tel"
                                autoComplete="tel"
                                autoCapitalize="none"
                                onSubmitEditing={sendRequest}
                            />
                        </View>
                    </View>

                    {requestFailure === null ? null : (
                        <View className="mt-4">
                            <ExtraNote
                                testID={`${TEST_ID}-request-error`}
                                role="alert"
                                tone="bad"
                                icon="warning"
                                title={requestFailure.message}
                            />
                        </View>
                    )}

                    <View className="mt-5 flex-row flex-wrap gap-2.5">
                        <ExtraButton
                            testID={`${TEST_ID}-request`}
                            label={t('guest:deletion.request')}
                            icon="chevronForward"
                            busy={request.isPending}
                            disabled={!hasIdentity}
                            onPress={sendRequest}
                        />
                    </View>
                </ExtraCard>
            ) : null}

            {phase === 'confirm' ? (
                <ExtraCard
                    testID={`${TEST_ID}-confirm-step`}
                    title={t('guest:deletion.confirmCardTitle')}
                >
                    <View className="mt-3">
                        <ExtraNote
                            testID={`${TEST_ID}-sent`}
                            icon="send"
                            title={t('guest:deletion.sentTitle', { destination: masked })}
                            body={t('guest:deletion.sentBody')}
                        />
                    </View>

                    <View className="mt-[18px]">
                        <CodeBoxes
                            testID={`${TEST_ID}-code`}
                            size="lg"
                            align="start"
                            label={t('guest:deletion.code')}
                            value={code}
                            onChangeText={setCode}
                            length={6}
                        />
                    </View>

                    <View className="mt-[18px]">
                        <ExtraNote
                            testID={`${TEST_ID}-irreversible`}
                            role="alert"
                            tone="bad"
                            icon="warning"
                            title={t('guest:deletion.confirmTitle')}
                            body={t('guest:deletion.confirmBody')}
                        />
                    </View>

                    {/* The second gate. Six digits is a muscle action; this is not reversible. */}
                    <View testID={`${TEST_ID}-acknowledge`} className="mt-3">
                        <AuthCheck
                            testID={`${TEST_ID}-acknowledge`}
                            label={t('guest:deletion.confirmAcknowledge')}
                            checked={acknowledged}
                            onChange={setAcknowledged}
                        />
                    </View>

                    {toFailure(confirm.error) === null ? null : (
                        <View className="mt-3">
                            <ExtraNote
                                testID={`${TEST_ID}-confirm-error`}
                                role="alert"
                                tone="bad"
                                icon="warning"
                                title={t('guest:deletion.invalidCode')}
                            />
                        </View>
                    )}

                    <View className="mt-5 flex-row flex-wrap items-center gap-2.5">
                        <ExtraButton
                            testID={`${TEST_ID}-confirm`}
                            tone="danger"
                            label={t('guest:deletion.confirm')}
                            busy={confirm.isPending}
                            disabled={!acknowledged || code.length === 0}
                            onPress={() => {
                                confirm.mutate(
                                    { ...identity, code },
                                    {
                                        onSuccess: () => {
                                            setPhase('done');
                                        },
                                    },
                                );
                            }}
                        />
                        <ExtraLink
                            testID={`${TEST_ID}-cancel`}
                            label={t('guest:deletion.cancel')}
                            onPress={() => {
                                setPhase('request');
                                setCode('');
                                setAcknowledged(false);
                            }}
                        />
                    </View>
                </ExtraCard>
            ) : null}

            {phase === 'done' ? (
                <ExtraCard className="items-center">
                    <View className="w-full flex-col items-center pt-4">
                        <AuthTick />
                        <View
                            testID={`${TEST_ID}-done-callout`}
                            role="status"
                            className="items-center"
                        >
                            <RNText
                                accessibilityRole="header"
                                aria-level={2}
                                className="mt-6 font-display text-2xl font-bold text-content-primary text-center"
                            >
                                {t('guest:deletion.doneTitle')}
                            </RNText>
                            <RNText className="mt-1.5 max-w-[460px] text-base font-medium leading-6 text-content-secondary text-center">
                                {t('guest:deletion.doneBody')}
                            </RNText>
                        </View>
                        {/* What survives, said plainly and on the success screen — not in a policy. */}
                        <View className="mt-5 w-full max-w-[560px]">
                            <ExtraNote
                                testID={`${TEST_ID}-suppression-note`}
                                icon="shield"
                                body={t('guest:deletion.suppressionNote')}
                            />
                        </View>
                        <View className="mt-5">
                            <ExtraButton
                                testID={`${TEST_ID}-to-shop`}
                                label={t('auth:frame.backToShop')}
                                onPress={toShop}
                            />
                        </View>
                    </View>
                </ExtraCard>
            ) : null}
        </ExtraPage>
    );
}

/** The board's three numbered steps, joined by short rules: done in brand, the current one red. */
function Progress({ phase }: { readonly phase: Phase }) {
    const { t } = useTranslation();
    const at = PHASES.indexOf(phase);
    const labels: Readonly<Record<Phase, string>> = {
        request: t('guest:deletion.stepAsk'),
        confirm: t('guest:deletion.stepConfirm'),
        done: t('guest:deletion.stepDone'),
    };
    return (
        <View
            testID={`${TEST_ID}-progress`}
            role="list"
            aria-label={t('guest:deletion.progress')}
            className="mt-[22px] flex-row flex-wrap items-center gap-2.5"
        >
            {PHASES.map((step, index) => {
                const done = index < at || phase === 'done';
                const now = index === at && phase !== 'done';
                return (
                    <Fragment key={step}>
                        {index === 0 ? null : (
                            <View
                                aria-hidden
                                className="h-0.5 w-12 rounded-full bg-stroke-subtle"
                            />
                        )}
                        <View
                            role="listitem"
                            aria-current={now ? 'step' : undefined}
                            className="flex-row items-center gap-2"
                        >
                            <View
                                className={cx(
                                    'h-7 w-7 items-center justify-center rounded-full border-2',
                                    done
                                        ? 'border-surface-brand bg-surface-brand'
                                        : now
                                          ? 'border-danger bg-surface-raised'
                                          : 'border-stroke bg-surface-raised',
                                )}
                            >
                                {done ? (
                                    <Icon
                                        name="check"
                                        size="sm"
                                        className="text-content-on-brand"
                                    />
                                ) : (
                                    <RNText
                                        className={cx(
                                            'text-xs font-bold',
                                            now
                                                ? 'text-danger-on-subtle'
                                                : 'text-content-secondary',
                                        )}
                                    >
                                        {String(index + 1)}
                                    </RNText>
                                )}
                            </View>
                            <RNText
                                className={cx(
                                    'text-sm font-semibold',
                                    now || done ? 'text-content-primary' : 'text-content-secondary',
                                )}
                            >
                                {labels[step]}
                            </RNText>
                        </View>
                    </Fragment>
                );
            })}
        </View>
    );
}
