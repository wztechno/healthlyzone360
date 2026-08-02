import type { LocalisedText } from '@healthy360/api-client/contracts';
import {
    Badge,
    Button,
    FormField,
    Inline,
    Stack,
    Text,
    inputFrameClassName,
} from '@healthy360/design-system';
import type { FieldControlProps } from '@healthy360/design-system';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { TextInput, View } from 'react-native';

/**
 * The two halves of a bilingual entity name, each written in its own direction.
 *
 * ## Why the direction is per field rather than per interface
 *
 * An admin record carries both languages because the person editing it is responsible for both
 * (plan §4.18). That means an English-reading kitchen manager types Arabic into this form and an
 * Arabic-reading one types English — so binding the fields to the *interface* direction would put a
 * right-to-left caret in the English field for half the staff and a left-to-right one in the Arabic
 * field for the other half. Each input therefore pins `writingDirection` to the language it holds,
 * in both interface directions, and the surrounding labels and layout keep following the interface.
 *
 * ## Why it composes `FormField` instead of using `TextInputField`
 *
 * `TextInputField` deliberately omits `style` from its props, so there is no way to hand it a
 * `writingDirection`. Rather than widen a shared component for one screen, this composes the two
 * pieces the design system exports for exactly this purpose — `FormField` for the label, hint,
 * error and the `aria-describedby` chain, and `inputFrameClassName` for the frame and focus ring —
 * which is the same composition `Select` uses internally. No new design-system component, and the
 * field is indistinguishable from every other one on the page.
 *
 * ## A missing Arabic side marks, and blocks nothing
 *
 * Saving a draft with no Arabic is legitimate and common: the name arrives from an import in one
 * language and somebody translates it later. What is *not* legitimate is publishing it, and the
 * readiness evaluator refuses that (plan §4.7). So the marker here is a badge and a hint, never a
 * validation error — an editor that refused to save half a translation would simply lose the half
 * it had.
 */

export type BilingualDirection = 'ltr' | 'rtl';

interface HalfProps {
    readonly testID: string;
    readonly label: string;
    readonly hint: string;
    readonly value: string;
    readonly onChangeText: (value: string) => void;
    readonly direction: BilingualDirection;
    readonly placeholder?: string | undefined;
    readonly error?: string | undefined;
    readonly required?: boolean | undefined;
    /** Renders a paragraph field instead of a single line. See the note on `BilingualFieldProps`. */
    readonly multiline?: boolean | undefined;
}

function BilingualHalf({
    testID,
    label,
    hint,
    value,
    onChangeText,
    direction,
    placeholder,
    error,
    required = false,
    multiline = false,
}: HalfProps) {
    const [focused, setFocused] = useState(false);

    return (
        <FormField
            testID={testID}
            id={testID}
            label={label}
            hint={hint}
            required={required}
            {...(error === undefined ? {} : { error })}
        >
            {(control: FieldControlProps) => (
                <View
                    className={inputFrameClassName({
                        invalid: error !== undefined,
                        focused,
                        disabled: false,
                    })}
                >
                    <TextInput
                        {...control}
                        testID={`${testID}-input`}
                        value={value}
                        onChangeText={onChangeText}
                        {...(placeholder === undefined ? {} : { placeholder })}
                        {...(multiline ? { multiline: true, numberOfLines: 3 } : {})}
                        autoCapitalize="none"
                        autoCorrect={false}
                        className="flex-1 text-base text-content-primary"
                        // `textAlign: 'auto'` keeps the text on the side the *writing direction*
                        // says, and `writingDirection` is what fixes that direction to the field's
                        // own language rather than the interface's. `textAlignVertical` only
                        // matters once the box is taller than one line, and without it Android
                        // centres a paragraph inside its own frame.
                        style={{
                            textAlign: 'auto',
                            writingDirection: direction,
                            ...(multiline ? { textAlignVertical: 'top' as const } : {}),
                        }}
                        onFocus={() => {
                            setFocused(true);
                        }}
                        onBlur={() => {
                            setFocused(false);
                        }}
                    />
                </View>
            )}
        </FormField>
    );
}

export interface BilingualFieldProps {
    /** Name of the thing being written, e.g. "Name". Both labels are built from it. */
    readonly fieldLabel: string;
    readonly value: LocalisedText;
    readonly onChange: (value: LocalisedText) => void;
    /** Marks the English half required. The Arabic half never is — see the note above. */
    readonly requiredEnglish?: boolean | undefined;
    readonly englishError?: string | undefined;
    /**
     * Renders both halves as paragraph fields.
     *
     * A recipe step is a sentence or three, not a name, and typing one into a single-line box means
     * scrolling a caret sideways through it. It is a variant rather than a second component because
     * everything else about the field — the per-language writing direction, the missing-translation
     * marker, the copy-across control — is identical, and a fork would eventually get one of those
     * wrong on one of the two.
     */
    readonly multiline?: boolean | undefined;
    readonly testID: string;
}

export function BilingualField({
    fieldLabel,
    value,
    onChange,
    requiredEnglish = false,
    englishError,
    multiline = false,
    testID,
}: BilingualFieldProps) {
    const { t } = useTranslation();
    const arabicMissing = value.ar.trim() === '';

    return (
        <Stack space="sm" testID={testID}>
            <BilingualHalf
                testID={`${testID}-en`}
                label={t('kitchen:bilingual.englishLabel', { field: fieldLabel })}
                hint={t('kitchen:bilingual.englishHint')}
                value={value.en}
                onChangeText={(next) => {
                    onChange({ ...value, en: next });
                }}
                direction="ltr"
                required={requiredEnglish}
                multiline={multiline}
                {...(englishError === undefined ? {} : { error: englishError })}
            />

            <BilingualHalf
                testID={`${testID}-ar`}
                label={t('kitchen:bilingual.arabicLabel', { field: fieldLabel })}
                hint={t('kitchen:bilingual.arabicHint')}
                value={value.ar}
                onChangeText={(next) => {
                    onChange({ ...value, ar: next });
                }}
                direction="rtl"
                multiline={multiline}
            />

            <Inline space="sm" align="center" wrap>
                {arabicMissing ? (
                    <Badge
                        testID={`${testID}-missing-arabic`}
                        tone="warning"
                        icon="warning"
                        label={t('kitchen:bilingual.missingArabic')}
                    />
                ) : null}
                <Button
                    testID={`${testID}-copy-english`}
                    size="sm"
                    variant="ghost"
                    label={t('kitchen:bilingual.copyFromEnglish')}
                    disabled={value.en.trim() === ''}
                    onPress={() => {
                        onChange({ ...value, ar: value.en });
                    }}
                />
            </Inline>

            {arabicMissing ? (
                <Text testID={`${testID}-missing-arabic-hint`} variant="caption" tone="secondary">
                    {t('kitchen:bilingual.missingArabicHint')}
                </Text>
            ) : null}
        </Stack>
    );
}
