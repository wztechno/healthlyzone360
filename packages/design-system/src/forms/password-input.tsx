import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { Icon } from '../icons/icon.tsx';
import { IconButton } from '../actions/button.tsx';
import { TextInputField } from './text-input.tsx';
import type { TextInputFieldProps } from './text-input.tsx';

export interface PasswordInputProps extends Omit<
    TextInputFieldProps,
    'secureTextEntry' | 'trailing'
> {
    /** Offer the reveal toggle. Off for step-up prompts on shared screens. */
    readonly revealable?: boolean | undefined;
}

/**
 * Password input with a reveal toggle.
 *
 * The toggle is a real button with a changing accessible name ("Show password" / "Hide password")
 * rather than a pressable icon with a static label, so a screen reader user knows both what it does
 * and what state it is in. `autoComplete`/`textContentType` are left to the caller: sign-in wants
 * `current-password` and registration wants `new-password`, and guessing wrong makes password
 * managers offer the wrong entry.
 */
export function PasswordInput({ revealable = true, testID, ...rest }: PasswordInputProps) {
    const { t } = useTranslation();
    const [revealed, setRevealed] = useState(false);

    return (
        <TextInputField
            {...rest}
            testID={testID}
            secureTextEntry={!revealed}
            autoCapitalize="none"
            autoCorrect={false}
            spellCheck={false}
            trailing={
                revealable ? (
                    <IconButton
                        testID={testID === undefined ? undefined : `${testID}-reveal`}
                        size="sm"
                        variant="ghost"
                        label={
                            revealed
                                ? t('designSystem:passwordInput.hide')
                                : t('designSystem:passwordInput.show')
                        }
                        icon={<Icon name={revealed ? 'eyeOff' : 'eye'} size="md" />}
                        onPress={() => {
                            setRevealed((current) => !current);
                        }}
                    />
                ) : undefined
            }
        />
    );
}
