import {
    Button,
    Callout,
    Card,
    Checkbox,
    Heading,
    Inline,
    OtpInput,
    Stack,
    Text,
    TextInputField,
} from '@healthy360/design-system';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import {
    toFailure,
    useConfirmGuestDeletionMutation,
    useRequestGuestDeletionMutation,
} from '../../../data/guest-hooks.ts';

/**
 * `/privacy/delete-my-data` — erasure, for somebody who may never have had an account.
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

export function GuestDeletionScreen() {
    const { t } = useTranslation();

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

    if (phase === 'done') {
        return (
            <Stack space="lg" testID={`${TEST_ID}-done`}>
                <Heading level={1}>{t('guest:deletion.title')}</Heading>
                <Callout
                    testID={`${TEST_ID}-done-callout`}
                    role="status"
                    tone="success"
                    title={t('guest:deletion.doneTitle')}
                    body={t('guest:deletion.doneBody')}
                />
                {/* What survives, said plainly and on the success screen — not in a policy. */}
                <Text tone="secondary" variant="caption" testID={`${TEST_ID}-suppression-note`}>
                    {t('guest:deletion.suppressionNote')}
                </Text>
            </Stack>
        );
    }

    return (
        <Stack space="lg" testID={TEST_ID}>
            <Stack space="xs">
                <Heading level={1} testID={`${TEST_ID}-title`}>
                    {t('guest:deletion.title')}
                </Heading>
                <Text tone="secondary">{t('guest:deletion.subtitle')}</Text>
            </Stack>

            {phase === 'request' ? (
                <Card padding="md" testID={`${TEST_ID}-request-step`}>
                    <Stack space="md">
                        <TextInputField
                            testID={`${TEST_ID}-email`}
                            label={t('guest:deletion.email')}
                            hint={t('guest:deletion.emailHint')}
                            value={email}
                            onChangeText={setEmail}
                            keyboardType="email-address"
                            autoCapitalize="none"
                        />
                        <TextInputField
                            testID={`${TEST_ID}-mobile`}
                            label={t('guest:deletion.mobile')}
                            hint={t('guest:deletion.mobileHint')}
                            value={mobile}
                            onChangeText={setMobile}
                            keyboardType="phone-pad"
                            autoCapitalize="none"
                        />

                        {toFailure(request.error) === null ? null : (
                            <Callout
                                testID={`${TEST_ID}-request-error`}
                                role="alert"
                                tone="danger"
                                title={toFailure(request.error)?.message ?? ''}
                            />
                        )}

                        <Button
                            testID={`${TEST_ID}-request`}
                            label={t('guest:deletion.request')}
                            loading={request.isPending}
                            disabled={!hasIdentity}
                            onPress={() => {
                                request.mutate(identity, {
                                    // Always accepted. There is no branch here on whether the
                                    // address is known, because the answer does not carry one.
                                    onSuccess: (acknowledgement) => {
                                        setMasked(acknowledgement.destinationMasked);
                                        setPhase('confirm');
                                    },
                                });
                            }}
                        />
                    </Stack>
                </Card>
            ) : null}

            {phase === 'confirm' ? (
                <Card padding="md" testID={`${TEST_ID}-confirm-step`}>
                    <Stack space="md">
                        <Callout
                            testID={`${TEST_ID}-sent`}
                            role="status"
                            tone="info"
                            title={t('guest:deletion.sentTitle', { destination: masked })}
                            body={t('guest:deletion.sentBody')}
                        />

                        <OtpInput
                            testID={`${TEST_ID}-code`}
                            label={t('guest:deletion.code')}
                            value={code}
                            onChangeText={setCode}
                            length={6}
                        />

                        <Callout
                            testID={`${TEST_ID}-irreversible`}
                            role="alert"
                            tone="warning"
                            title={t('guest:deletion.confirmTitle')}
                            body={t('guest:deletion.confirmBody')}
                        />

                        {/* The second gate. Six digits is a muscle action; this is not reversible. */}
                        <Checkbox
                            testID={`${TEST_ID}-acknowledge`}
                            label={t('guest:deletion.confirmAcknowledge')}
                            checked={acknowledged}
                            onChange={setAcknowledged}
                        />

                        {toFailure(confirm.error) === null ? null : (
                            <Callout
                                testID={`${TEST_ID}-confirm-error`}
                                role="alert"
                                tone="danger"
                                title={t('guest:deletion.invalidCode')}
                            />
                        )}

                        <Inline space="sm">
                            <Button
                                testID={`${TEST_ID}-confirm`}
                                variant="danger"
                                label={t('guest:deletion.confirm')}
                                loading={confirm.isPending}
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
                            <Button
                                testID={`${TEST_ID}-cancel`}
                                variant="ghost"
                                label={t('guest:deletion.cancel')}
                                onPress={() => {
                                    setPhase('request');
                                    setCode('');
                                    setAcknowledged(false);
                                }}
                            />
                        </Inline>
                    </Stack>
                </Card>
            ) : null}
        </Stack>
    );
}
