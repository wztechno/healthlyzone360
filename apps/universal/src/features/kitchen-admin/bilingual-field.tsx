import type { LocalisedText } from '@healthy360/api-client/contracts';
import {
    Badge,
    Button,
    FormField,
    Inline,
    Stack,
    Text,
    cx,
    inputControlClass,
    inputFrameClassName,
    useDensity,
} from '@healthy360/design-system';
import type { FieldControlProps, GridSpanProps } from '@healthy360/design-system';
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
    /** Omitted by the `row` layout, which draws the two labels and nothing else. */
    readonly hint?: string | undefined;
    readonly value: string;
    readonly onChangeText: (value: string) => void;
    readonly direction: BilingualDirection;
    readonly placeholder?: string | undefined;
    readonly error?: string | undefined;
    readonly required?: boolean | undefined;
    readonly disabled?: boolean | undefined;
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
    disabled = false,
    multiline = false,
}: HalfProps) {
    const [focused, setFocused] = useState(false);
    /*
     * The frame and the value follow the density ladder, exactly as `TextInputField` does.
     *
     * Omitting them was the bug behind "the designation fields are a different size": with no
     * density stated, `inputFrameClassName` falls back to the *customer* ladder and its 44px touch
     * floor, so under `DensityProvider value="compact"` these two boxes came out 44px tall in a row
     * of 28px ones — the only pair on the form that did. The size is not this component's to choose;
     * it is the surface's, and the surface already said.
     */
    const density = useDensity();

    return (
        <FormField
            testID={testID}
            id={testID}
            label={label}
            {...(hint === undefined ? {} : { hint })}
            required={required}
            disabled={disabled}
            {...(error === undefined ? {} : { error })}
        >
            {(control: FieldControlProps) => (
                <View
                    className={inputFrameClassName({
                        invalid: error !== undefined,
                        focused,
                        disabled,
                        density,
                        size: density === 'compact' ? 'sm' : 'md',
                    })}
                >
                    <TextInput
                        {...control}
                        testID={`${testID}-input`}
                        value={value}
                        onChangeText={onChangeText}
                        editable={!disabled}
                        {...(placeholder === undefined ? {} : { placeholder })}
                        {...(multiline ? { multiline: true, numberOfLines: 3 } : {})}
                        autoCapitalize="none"
                        autoCorrect={false}
                        className={cx(inputControlClass(density), 'text-content-primary')}
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

export interface BilingualFieldProps extends GridSpanProps {
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
    /** Locks both halves — used for platform-library rows a kitchen may read but not rename. */
    readonly disabled?: boolean | undefined;
    /**
     * `row` is the Catalogue presentation: two 280px fields side by side, and nothing else.
     *
     * The layout is the smaller half of it. `stacked` also carries a per-language hint under each
     * label, a `No Arabic yet` badge, a copy-across button and a footnote about publication — four
     * pieces of scaffolding for someone filling in a bilingual record for the first time. The
     * Catalogue draws none of them, and on a desk surface used forty times a day they are four
     * lines of furniture around two inputs whose labels already say `(EN)` and `(AR)`.
     *
     * What is *lost* with them is the missing-translation marker, and that is a real cost rather
     * than a tidy-up: an Arabic name is required to publish and this was where a reader found out
     * it was absent. The readiness evaluator still refuses the publication (plan §4.7), so nothing
     * ships half-translated — the warning simply arrives later, at the gate rather than in the
     * field. `stacked` stays the default so every other editor keeps the marker.
     *
     * It wraps rather than overflowing below `md`, where one 280px column cannot hold two.
     */
    readonly layout?: 'stacked' | 'row' | undefined;
    readonly testID: string;
}

export function BilingualField({
    fieldLabel,
    value,
    onChange,
    requiredEnglish = false,
    englishError,
    multiline = false,
    disabled = false,
    layout = 'stacked',
    testID,
}: BilingualFieldProps) {
    const { t } = useTranslation();
    const arabicMissing = value.ar.trim() === '';
    const row = layout === 'row';

    if (row) {
        return (
            /*
             * A wrapping flex row of two fixed fields, not a nested `FormGrid`.
             *
             * The grid was the first attempt and it does not compose: an inner grid resolves its own
             * column count from the viewport while the outer one resolves the span, so the pair
             * rendered stacked inside a two-track cell — one field wide, one column empty. Two
             * `w-field` boxes in a `flex-wrap` row are the same 280px tracks with the same 16px gap
             * and no second opinion about how many fit.
             */
            <View testID={testID} className="flex-row flex-wrap gap-base">
                <View className="w-field">
                    <BilingualHalf
                        testID={`${testID}-en`}
                        label={t('kitchen:bilingual.englishShort', { field: fieldLabel })}
                        value={value.en}
                        onChangeText={(next) => {
                            onChange({ ...value, en: next });
                        }}
                        direction="ltr"
                        required={requiredEnglish}
                        multiline={multiline}
                        disabled={disabled}
                        {...(englishError === undefined ? {} : { error: englishError })}
                    />
                </View>
                <View className="w-field">
                    <BilingualHalf
                        testID={`${testID}-ar`}
                        label={t('kitchen:bilingual.arabicShort', { field: fieldLabel })}
                        value={value.ar}
                        onChangeText={(next) => {
                            onChange({ ...value, ar: next });
                        }}
                        direction="rtl"
                        multiline={multiline}
                        disabled={disabled}
                    />
                </View>
            </View>
        );
    }

    const halves = (
        <>
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
                disabled={disabled}
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
                disabled={disabled}
            />
        </>
    );

    return (
        <Stack space="sm" testID={testID}>
            {halves}

            <Inline space="sm" align="center" wrap>
                {arabicMissing ? (
                    <Badge
                        testID={`${testID}-missing-arabic`}
                        tone="warning"
                        icon="warning"
                        label={t('kitchen:bilingual.missingArabic')}
                    />
                ) : null}
                {disabled ? null : (
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
                )}
            </Inline>

            {arabicMissing ? (
                <Text testID={`${testID}-missing-arabic-hint`} variant="caption" tone="secondary">
                    {t('kitchen:bilingual.missingArabicHint')}
                </Text>
            ) : null}
        </Stack>
    );
}
