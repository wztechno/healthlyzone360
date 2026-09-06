import { useState } from 'react';
import { neutral } from '@healthy360/design-tokens';
import { Pressable, TextInput as RNTextInput, View } from 'react-native';
import type { TextInputProps as RNTextInputProps } from 'react-native';
import { useTranslation } from 'react-i18next';

import { useDensity } from '../hooks/use-density.tsx';
import { Icon } from '../icons/icon.tsx';
import { cx } from '../internal/class-names.ts';
import { inputControlClass, inputFrameClassName } from './text-input.tsx';
import type { InputSize } from './text-input.tsx';

/**
 * SearchInput — the toolbar's filter box.
 *
 * Not a `TextInputField`, and the difference is the label. A form field's label sits above it and is
 * a permanent part of the layout; a toolbar search has no room for one and no need — the glyph and
 * the placeholder say what it is, in a row where every other control is also unlabelled. So this
 * draws the frame directly rather than going through `FormField`, and carries its accessible name
 * on the input itself.
 *
 * It is `role="searchbox"` on the web, which is what makes it announce as a search rather than as a
 * text field, and it states `type="search"` so a browser offers its own clear affordance next to
 * ours. The clear button is still drawn, because react-native-web strips the UA one on some
 * platforms and a search you cannot empty in one press is a search you retype.
 *
 * **It does not state a width.** The toolbar decides — the handoff's 240px is a toolbar decision
 * (§4.1), not a property of the control, and the same component sits inside a `SearchSelect` later
 * at whatever width that popover wants.
 */

export interface SearchInputProps extends Omit<
    RNTextInputProps,
    'className' | 'style' | 'value' | 'onChangeText' | 'accessibilityLabel'
> {
    readonly value: string;
    readonly onChangeText: (value: string) => void;
    /** Accessible name. Defaults to the generic "Search", which is right only for one search on a page. */
    readonly label?: string | undefined;
    readonly size?: InputSize | undefined;
    readonly disabled?: boolean | undefined;
    readonly className?: string | undefined;
    readonly testID?: string | undefined;
}

export function SearchInput({
    value,
    onChangeText,
    label,
    size = 'sm',
    disabled = false,
    className,
    testID,
    onFocus,
    onBlur,
    ...rest
}: SearchInputProps) {
    const { t } = useTranslation();
    const [focused, setFocused] = useState(false);
    const density = useDensity();
    const name = label ?? t('common:action.search');

    return (
        <View
            testID={testID}
            className={cx(
                inputFrameClassName({ invalid: false, focused, disabled, density, size }),
                className,
            )}
        >
            <Icon
                name="search"
                size="sm"
                // Decorative: the input already announces its own name and role, and a screen
                // reader that also reads the glyph says "search search".
                aria-hidden
                className="text-content-secondary"
            />

            <RNTextInput
                {...rest}
                testID={testID === undefined ? undefined : `${testID}-input`}
                value={value}
                onChangeText={onChangeText}
                editable={!disabled}
                role="searchbox"
                accessibilityRole="search"
                accessibilityLabel={name}
                aria-label={name}
                inputMode="search"
                returnKeyType="search"
                className={inputControlClass(density)}
                placeholderTextColor={neutral[600]}
                style={{ textAlign: 'auto' }}
                onFocus={(event) => {
                    setFocused(true);
                    onFocus?.(event);
                }}
                onBlur={(event) => {
                    setFocused(false);
                    onBlur?.(event);
                }}
            />

            {value.length === 0 ? null : (
                <Pressable
                    testID={testID === undefined ? undefined : `${testID}-clear`}
                    role="button"
                    accessibilityRole="button"
                    accessibilityLabel={t('common:action.clear')}
                    disabled={disabled}
                    onPress={() => {
                        onChangeText('');
                    }}
                >
                    <Icon name="close" size="sm" className="text-content-secondary" />
                </Pressable>
            )}
        </View>
    );
}
