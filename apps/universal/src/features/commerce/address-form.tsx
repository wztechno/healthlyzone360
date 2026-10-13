import { TextInputField } from '@healthy360/design-system';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

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
 * `CommerceRepository` has no operation that would honour it.
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
        // Two to a row where there is room — a 280px floor each, so a phone stacks them — and the
        // free-text instructions across the whole width.
        <View testID={testID} className="flex-row flex-wrap gap-x-4 gap-y-3">
            {ADDRESS_FIELDS.map((field) => {
                const error = errors[field];
                const multiline = MULTILINE.includes(field);
                return (
                    <View
                        key={field}
                        className={multiline ? 'w-full' : 'min-w-[240px] grow basis-[280px]'}
                    >
                        <TextInputField
                            testID={`${testID}-${field}`}
                            label={t(`commerce:address.${field}`)}
                            placeholder={t(`commerce:address.${field}Placeholder`)}
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
                    </View>
                );
            })}
        </View>
    );
}
