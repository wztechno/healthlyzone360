import { Stack, Text, TextInputField } from '@healthy360/design-system';
import { useTranslation } from 'react-i18next';

import { ADDRESS_FIELDS, REQUIRED_ADDRESS_FIELDS } from './address.ts';
import type { AddressErrors, AddressField, AddressValues } from './address.ts';

/**
 * The delivery-address form.
 *
 * One component for all three places an address is entered — one-off checkout, the subscription
 * configurator and the change-address dialog — because three copies of seven fields is three places
 * for a required marker to go missing.
 *
 * **It stores nothing and claims nothing.** There is no "save this address" checkbox, because
 * `CommerceRepository` has no operation that would honour it. The caption says so in the person's
 * own language rather than leaving them to discover it next time.
 */
export interface AddressFormProps {
    readonly values: AddressValues;
    readonly errors: AddressErrors;
    readonly onChange: (field: AddressField, value: string) => void;
    readonly disabled?: boolean | undefined;
    readonly testID: string;
}

/** Fields that take a longer, free-form answer and get a multi-line control. */
const MULTILINE: readonly AddressField[] = ['instructions'];

export function AddressForm({ values, errors, onChange, disabled, testID }: AddressFormProps) {
    const { t } = useTranslation();

    return (
        <Stack space="sm" testID={testID}>
            {ADDRESS_FIELDS.map((field) => {
                const error = errors[field];
                const multiline = MULTILINE.includes(field);
                return (
                    <TextInputField
                        key={field}
                        testID={`${testID}-${field}`}
                        label={t(`commerce:address.${field}`)}
                        hint={t(`commerce:address.${field}Hint`)}
                        value={values[field]}
                        onChangeText={(next: string) => {
                            onChange(field, next);
                        }}
                        required={REQUIRED_ADDRESS_FIELDS.includes(field)}
                        multiline={multiline}
                        autoCapitalize={field === 'countryCode' ? 'characters' : 'words'}
                        {...(error === undefined ? {} : { error })}
                        {...(disabled === undefined ? {} : { disabled })}
                    />
                );
            })}
            <Text tone="secondary" variant="caption" testID={`${testID}-storage-note`}>
                {t('commerce:address.notStored')}
            </Text>
        </Stack>
    );
}
