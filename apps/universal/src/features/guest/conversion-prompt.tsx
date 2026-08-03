import type { GuestConversionPrefill } from '@healthy360/api-client/contracts';
import {
    Button,
    Callout,
    Card,
    Checkbox,
    Heading,
    Inline,
    Stack,
    Text,
    TextInputField,
} from '@healthy360/design-system';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { toFailure, useConvertGuestMutation } from '../../data/guest-hooks.ts';

/**
 * "Keep this order in an account?" — offered after the order is placed, and refusable.
 *
 * ## Three properties this component exists to hold
 *
 * 1. **Pre-filled.** Everything an account needs is already known: the name, the contact, and — if
 *    a passcode was entered — the proof that the contact is real. Asking for it again is asking
 *    somebody to prove they meant it, and it is the step where most people stop.
 * 2. **The refusal is a visible button, not an X in a corner.** A conversion prompt with no obvious
 *    way past it is a registration wall wearing a different hat, and the guest journey exists
 *    precisely so that there is not one. "No thanks" is rendered at the same size and in the same
 *    row as the accept, and pressing it says so and leaves the order alone.
 * 3. **Marketing is asked again.** The checkout opt-in was about one order. Carrying it silently
 *    onto a standing account would be a consent nobody gave, so the box starts off here too — even
 *    for somebody who ticked it two screens ago.
 *
 * ## It shows only after the order exists
 *
 * The prompt is mounted by the confirmation screen, never by the checkout. Offered before the order
 * is placed it becomes a condition of placing it, which is the thing being avoided.
 */
export interface ConversionPromptProps {
    readonly prefill: GuestConversionPrefill;
    /** Called once an account exists, so the host can move the person into it. */
    readonly onConverted: (orderReferences: readonly string[]) => void;
    readonly testID?: string | undefined;
}

export function ConversionPrompt({
    prefill,
    onConverted,
    testID = 'guest-conversion',
}: ConversionPromptProps) {
    const { t } = useTranslation();

    const [fullName, setFullName] = useState(prefill.fullName);
    const [password, setPassword] = useState('');
    // Off, and asked again. See the header.
    const [marketingOptIn, setMarketingOptIn] = useState(false);
    const [declined, setDeclined] = useState(false);

    const convert = useConvertGuestMutation();
    const failure = toFailure(convert.error);

    if (declined) {
        return (
            <Callout
                testID={`${testID}-declined`}
                role="status"
                tone="info"
                title={t('guest:convert.declined')}
            />
        );
    }

    if (convert.isSuccess) {
        return (
            <Callout
                testID={`${testID}-done`}
                role="status"
                tone="success"
                title={t('guest:convert.doneTitle')}
                body={t('guest:convert.doneBody')}
            />
        );
    }

    return (
        <Card padding="md" testID={testID}>
            <Stack space="md">
                <Stack space="xs">
                    <Heading level={2} testID={`${testID}-title`}>
                        {t('guest:convert.title')}
                    </Heading>
                    <Text tone="secondary">{t('guest:convert.body')}</Text>
                </Stack>

                {prefill.contactVerified ? (
                    <Text tone="secondary" variant="caption" testID={`${testID}-verified-note`}>
                        {t('guest:convert.verifiedNote')}
                    </Text>
                ) : null}

                <TextInputField
                    testID={`${testID}-full-name`}
                    label={t('guest:convert.fullName')}
                    value={fullName}
                    onChangeText={setFullName}
                    required
                    autoCapitalize="words"
                />

                <TextInputField
                    testID={`${testID}-password`}
                    label={t('guest:convert.password')}
                    hint={t('guest:convert.passwordHint')}
                    value={password}
                    onChangeText={setPassword}
                    required
                    secureTextEntry
                    autoCapitalize="none"
                />

                <Checkbox
                    testID={`${testID}-marketing`}
                    label={t('guest:convert.marketing')}
                    description={t('guest:convert.marketingHint')}
                    checked={marketingOptIn}
                    onChange={setMarketingOptIn}
                />

                {failure === null ? null : (
                    <Callout
                        testID={`${testID}-error`}
                        role="alert"
                        tone="danger"
                        title={failure.message}
                    />
                )}

                <Inline space="sm">
                    <Button
                        testID={`${testID}-submit`}
                        label={t('guest:convert.submit')}
                        loading={convert.isPending}
                        onPress={() => {
                            convert.mutate(
                                { password, fullName, marketingOptIn },
                                {
                                    onSuccess: (result) => {
                                        onConverted(result.orderReferences);
                                    },
                                },
                            );
                        }}
                    />
                    {/* Same row, same weight of affordance. Refusing is not a hidden escape. */}
                    <Button
                        testID={`${testID}-decline`}
                        variant="ghost"
                        label={t('guest:convert.noThanks')}
                        onPress={() => {
                            setDeclined(true);
                        }}
                    />
                </Inline>
            </Stack>
        </Card>
    );
}
