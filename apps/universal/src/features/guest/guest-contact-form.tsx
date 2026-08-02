import { SegmentedControl, Stack, Text, TextInputField } from '@healthy360/design-system';
import { useTranslation } from 'react-i18next';

import { availableChannels } from './contact.ts';
import type { GuestContactErrors, GuestContactField, GuestContactValues } from './contact.ts';

/**
 * The guest's contact details.
 *
 * ## Both fields are optional and neither is
 *
 * Email and mobile are each shown without a required marker, because either one on its own is
 * enough — marking both required would be false, and marking one required would pick a channel on
 * the person's behalf. What carries the actual rule is the shared error message: when neither is
 * filled in, `contact.ts` puts the same sentence under both fields, so the requirement is visible
 * exactly where a person is deciding which box to use.
 *
 * ## The channel picker appears only when there is a choice
 *
 * Offering "SMS" to somebody who has given only an email address is offering a message that cannot
 * be sent. The options are derived from what has been typed, and with fewer than two of them the
 * control is not rendered at all — a segmented control with one segment is a label pretending to be
 * a choice.
 */
export interface GuestContactFormProps {
    readonly values: GuestContactValues;
    readonly errors: GuestContactErrors;
    readonly onChange: (field: GuestContactField, value: string) => void;
    readonly disabled?: boolean | undefined;
    readonly testID: string;
}

export function GuestContactForm({
    values,
    errors,
    onChange,
    disabled,
    testID,
}: GuestContactFormProps) {
    const { t } = useTranslation();
    const channels = availableChannels(values);

    return (
        <Stack space="sm" testID={testID}>
            <TextInputField
                testID={`${testID}-fullName`}
                label={t('guest:contact.fullName')}
                hint={t('guest:contact.fullNameHint')}
                value={values.fullName}
                onChangeText={(next: string) => {
                    onChange('fullName', next);
                }}
                required
                autoCapitalize="words"
                {...(errors.fullName === undefined ? {} : { error: errors.fullName })}
                {...(disabled === undefined ? {} : { disabled })}
            />

            <TextInputField
                testID={`${testID}-email`}
                label={t('guest:contact.email')}
                hint={t('guest:contact.emailHint')}
                value={values.email}
                onChangeText={(next: string) => {
                    onChange('email', next);
                }}
                keyboardType="email-address"
                autoCapitalize="none"
                {...(errors.email === undefined ? {} : { error: errors.email })}
                {...(disabled === undefined ? {} : { disabled })}
            />

            <TextInputField
                testID={`${testID}-mobile`}
                label={t('guest:contact.mobile')}
                hint={t('guest:contact.mobileHint')}
                value={values.mobile}
                onChangeText={(next: string) => {
                    onChange('mobile', next);
                }}
                keyboardType="phone-pad"
                autoCapitalize="none"
                {...(errors.mobile === undefined ? {} : { error: errors.mobile })}
                {...(disabled === undefined ? {} : { disabled })}
            />

            {channels.length < 2 ? null : (
                <Stack space="xs" testID={`${testID}-channel`}>
                    <Text variant="bodyStrong">{t('guest:contact.channel')}</Text>
                    <SegmentedControl
                        testID={`${testID}-channel-control`}
                        label={t('guest:contact.channel')}
                        block
                        items={channels.map((channel) => ({
                            value: channel,
                            label: t(
                                channel === 'email'
                                    ? 'guest:contact.channelEmail'
                                    : channel === 'sms'
                                      ? 'guest:contact.channelSms'
                                      : 'guest:contact.channelWhatsapp',
                            ),
                            ...(disabled === undefined ? {} : { disabled }),
                        }))}
                        value={values.channel}
                        onChange={(next) => {
                            onChange('channel', next);
                        }}
                    />
                </Stack>
            )}
        </Stack>
    );
}
