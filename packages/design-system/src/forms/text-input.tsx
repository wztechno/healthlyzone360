import { useState } from 'react';
import type { ReactNode } from 'react';
import { TextInput as RNTextInput, View } from 'react-native';
import type { TextInputProps as RNTextInputProps } from 'react-native';

import { neutral } from '@healthy360/design-tokens';

import { useDensity } from '../hooks/use-density.tsx';
import type { Density } from '../hooks/use-density.tsx';
import { cx } from '../internal/class-names.ts';
import { FormField } from './form-field.tsx';
import type { FieldControlProps } from './form-field.tsx';
import type { GridSpanProps } from '../primitives/grid-shared.ts';

/**
 * Text input.
 *
 * `textAlign="auto"` is React Native's *logical* alignment: the caret and the text follow the
 * writing direction instead of being pinned to a physical side. It is one of the few places an
 * inline style prop is correct — there is no Tailwind utility for it on a `TextInput`.
 *
 * Under `compact` the frame takes its height from `controlHeight` and its inset from
 * `controlPaddingX`, at a 4px corner; under `comfortable` it keeps the 44px floor and the 12px
 * corner the customer app ships. **The frame never states a width** — a field is 280px because
 * `FormGrid` says so, not because the input decided.
 */

/**
 * `xs` is the 24px step, and it exists for one shape: a cell input inside a dense line table.
 *
 * The Catalogue's recipe editor draws its raw-material rows at 32px with the Qty and Unit price
 * boxes inset inside them, which is the one place on the admin where a field is *not* the page's
 * ordinary control. Everywhere else `sm` is the floor. On the comfortable ladder it resolves to the
 * same 44px touch minimum as every other size, because a customer surface has no dense table to put
 * it in.
 */
export const INPUT_SIZES = ['xs', 'sm', 'md', 'lg'] as const;
export type InputSize = (typeof INPUT_SIZES)[number];

export interface TextInputFieldProps
    extends
        Omit<
            RNTextInputProps,
            'className' | 'style' | 'editable' | 'accessibilityLabel' | 'nativeID' | 'onChange'
        >,
        GridSpanProps {
    readonly label: string;
    /** See `FormField`'s `labelHidden` — for a control named by a column header. */
    readonly labelHidden?: boolean | undefined;
    readonly hint?: string | undefined;
    readonly error?: string | undefined;
    readonly required?: boolean | undefined;
    readonly disabled?: boolean | undefined;
    readonly size?: InputSize | undefined;
    readonly id?: string | undefined;
    /** Rendered inside the input frame on the trailing edge — reveal toggles, unit suffixes. */
    readonly trailing?: ReactNode | undefined;
    readonly className?: string | undefined;
    readonly testID?: string | undefined;
}

const COMFORTABLE_FRAME_SIZE: Readonly<Record<InputSize, string>> = {
    xs: 'min-h-touch gap-2 rounded-lg px-3',
    sm: 'min-h-touch gap-2 rounded-lg px-3',
    md: 'min-h-touch gap-2 rounded-lg px-3',
    lg: 'min-h-touch gap-2 rounded-lg px-3',
};

const COMPACT_FRAME_SIZE: Readonly<Record<InputSize, string>> = {
    xs: 'h-control-xs gap-control-xs rounded-sm px-control-xs',
    sm: 'h-control-sm gap-control-sm rounded-sm px-control-sm',
    md: 'h-control-md gap-control-md rounded-sm px-control-md',
    lg: 'h-control-lg gap-control-lg rounded-sm px-control-lg',
};

const FRAME_SIZE: Readonly<Record<Density, Readonly<Record<InputSize, string>>>> = {
    comfortable: COMFORTABLE_FRAME_SIZE,
    compact: COMPACT_FRAME_SIZE,
};

/**
 * The same frames, with the height released.
 *
 * A `multiline` field is a `<textarea>` on the web and a growing box on native, and the compact
 * ladder's `h-control-*` is a *fixed* height — so a three-row paragraph rendered into it overflowed
 * its own frame in both directions, which is how a description ended up drawn on top of its label.
 * `min-h-*` keeps the empty field the same size as its single-line neighbours and lets the filled
 * one grow; the vertical padding replaces the centring that `items-center` was doing.
 */
const COMFORTABLE_MULTILINE_FRAME_SIZE: Readonly<Record<InputSize, string>> = {
    xs: 'min-h-touch gap-2 rounded-lg px-3 py-2',
    sm: 'min-h-touch gap-2 rounded-lg px-3 py-2',
    md: 'min-h-touch gap-2 rounded-lg px-3 py-2',
    lg: 'min-h-touch gap-2 rounded-lg px-3 py-2',
};

const COMPACT_MULTILINE_FRAME_SIZE: Readonly<Record<InputSize, string>> = {
    xs: 'min-h-control-xs gap-control-xs rounded-sm px-control-xs py-2',
    sm: 'min-h-control-sm gap-control-sm rounded-sm px-control-sm py-2',
    md: 'min-h-control-md gap-control-md rounded-sm px-control-md py-2',
    lg: 'min-h-control-lg gap-control-lg rounded-sm px-control-lg py-2',
};

const MULTILINE_FRAME_SIZE: Readonly<Record<Density, Readonly<Record<InputSize, string>>>> = {
    comfortable: COMFORTABLE_MULTILINE_FRAME_SIZE,
    compact: COMPACT_MULTILINE_FRAME_SIZE,
};

export function inputFrameClassName(options: {
    readonly invalid: boolean;
    readonly focused: boolean;
    readonly disabled: boolean;
    /**
     * Optional so the call sites that predate the ladder keep the geometry they shipped with —
     * `marketplace-shell.tsx`'s search field is a customer control and stays a customer control.
     */
    readonly density?: Density | undefined;
    readonly size?: InputSize | undefined;
    /** Releases the fixed height so a paragraph field grows instead of overflowing its frame. */
    readonly multiline?: boolean | undefined;
}): string {
    const density = options.density ?? 'comfortable';
    const size = options.size ?? 'md';
    const multiline = options.multiline ?? false;

    return cx(
        // `surfaceRaised`, not `surfaceBase`. The handoff's own role mapping puts *cards and
        // inputs* on `#ffffff` and reserves `#f7fcf9` for the page canvas, and a field the same
        // colour as the paper behind it is a field whose edges are doing all the work — on a
        // Catalogue form of twelve of them the eye has nothing to land on. The sunken fill for a
        // disabled or derived value is set below and still wins, because it is stated after.
        // `items-stretch` for a paragraph field: `items-center` is what pushed an over-tall
        // textarea equally above and below the frame instead of letting the frame follow it.
        'flex-row border bg-surface-raised',
        multiline ? 'items-stretch' : 'items-center',
        (multiline ? MULTILINE_FRAME_SIZE : FRAME_SIZE)[density][size],
        options.invalid ? 'border-danger-border' : 'border-stroke',
        // A visible focus ring is a WCAG 2.4.7 requirement, and on native there is no browser
        // default to fall back on, so it is drawn explicitly.
        options.focused ? 'border-stroke-focus border-focus' : null,
        // Recessed fill and a lighter border — deliberately *not* an opacity.
        //
        // `opacity-60` here dimmed the value along with the frame, which put the text at 3.97:1
        // against its own background: below the 4.5 floor, on a value the reader opened the record
        // to read. A platform-library ingredient's name is the clearest case — it cannot be edited
        // and it still has to be legible.
        //
        // Nor is this a rule axe is being fussy about. React Native Web renders a disabled
        // `TextInput` as `readonly`, not `disabled`, so the contrast exemption for inactive
        // controls does not apply to it — and that is the correct outcome, because a readonly
        // field's content is still content.
        options.disabled ? 'bg-surface-sunken border-stroke-subtle' : null,
    );
}

/**
 * Styles for the native control *inside* {@link inputFrameClassName}.
 *
 * On web, `TextInput` becomes a real `<input>` and the UA stylesheet draws its own border and
 * focus outline. Leaving those on produces a black rectangle nested inside the green frame ring —
 * the frame already owns focus indication, so the inner control must be borderless and transparent.
 */
export const inputControlClassName =
    'flex-1 border-0 bg-transparent text-base text-content-primary outline-none';

/**
 * The same styles at a stated density. A separate function rather than a `cx` on the constant:
 * two competing `text-*` utilities resolve by stylesheet order, not attribute order, so the size
 * has to be chosen once rather than layered.
 */
export function inputControlClass(density: Density): string {
    if (density !== 'compact') return inputControlClassName;
    return 'flex-1 border-0 bg-transparent text-role-body text-content-primary outline-none';
}

export function TextInputField({
    label,
    labelHidden = false,
    hint,
    error,
    required = false,
    disabled = false,
    size = 'md',
    id,
    trailing,
    className,
    testID,
    onFocus,
    onBlur,
    // Read by `FormGrid` off this element's props, never by the control. Destructured here so it
    // stops travelling: `...rest` lands on the `TextInput`, which on the web is a real `<input>`
    // and would carry `span="2"` into the DOM as an unknown attribute.
    span: _span,
    fullWidth: _fullWidth,
    ...rest
}: TextInputFieldProps) {
    const [focused, setFocused] = useState(false);
    const density = useDensity();

    return (
        <FormField
            label={label}
            labelHidden={labelHidden}
            hint={hint}
            error={error}
            required={required}
            disabled={disabled}
            id={id}
            className={className}
            testID={testID}
        >
            {(control: FieldControlProps) => (
                <View
                    className={inputFrameClassName({
                        invalid: error !== undefined,
                        focused,
                        disabled,
                        density,
                        size,
                        // Read rather than destructured: the control needs it too.
                        multiline: rest.multiline ?? false,
                    })}
                >
                    <RNTextInput
                        {...rest}
                        {...control}
                        testID={testID === undefined ? undefined : `${testID}-input`}
                        editable={!disabled}
                        className={inputControlClass(density)}
                        // neutral.600: placeholder text is still text to WCAG - neutral.500 sits
                        // just below the 4.5:1 AA threshold on the base surface (axe caught it).
                        placeholderTextColor={neutral[600]}
                        // `textAlignVertical` only matters once the box is taller than one line,
                        // and without it Android centres a paragraph inside its own frame.
                        style={{
                            textAlign: 'auto',
                            ...(rest.multiline === true
                                ? { textAlignVertical: 'top' as const }
                                : {}),
                        }}
                        onFocus={(event) => {
                            setFocused(true);
                            onFocus?.(event);
                        }}
                        onBlur={(event) => {
                            setFocused(false);
                            onBlur?.(event);
                        }}
                    />
                    {trailing}
                </View>
            )}
        </FormField>
    );
}
