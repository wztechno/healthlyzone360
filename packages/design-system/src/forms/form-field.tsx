import { useId } from 'react';
import type { ReactNode } from 'react';
import { Text as RNText, View } from 'react-native';

import { Icon } from '../icons/icon.tsx';
import { useDensity } from '../hooks/use-density.tsx';
import { cx } from '../internal/class-names.ts';
import { FieldLabel } from './field-label';
import type { GridSpanProps } from '../primitives/grid-shared.ts';

/**
 * The accessibility props a `FormField` hands to whatever control it wraps.
 *
 * Both spellings are supplied on purpose: `aria-describedby` builds the id chain the web platform
 * (and axe) requires, while `accessibilityHint` carries the same text on native, which has no id
 * graph. Keeping them in one object is what stops a hint from existing on one platform only.
 */
export interface FieldControlProps {
    readonly nativeID: string;
    readonly 'aria-labelledby': string;
    readonly accessibilityLabel: string;
    readonly 'aria-describedby'?: string | undefined;
    readonly accessibilityHint?: string | undefined;
    readonly 'aria-invalid': boolean;
    readonly 'aria-required': boolean;
    readonly accessibilityState: { readonly disabled?: boolean };
}

/**
 * `span` and `fullWidth` are declared here and *used* by `FormGrid`, not by this component.
 *
 * That reads backwards until you notice where the knowledge lives. How wide a textarea should be is
 * the field author's judgement; how many columns exist at this viewport is the grid's. So the field
 * states an intent and the grid clamps it — `span={3}` in a one-column phone layout resolves to one
 * column rather than overflowing by two. See `primitives/grid-shared.ts`.
 *
 * They are the **only** routes to a field wider than 280px. That is the no-stretch rule (§2): a
 * width that emerges from the container is how a two-character unit field ends up 900px wide.
 */
export interface FormFieldProps extends GridSpanProps {
    readonly label: string;
    /** Supporting copy shown under the label and referenced by `aria-describedby`. */
    readonly hint?: string | undefined;
    /** Validation message. Its presence is what marks the control invalid. */
    readonly error?: string | undefined;
    readonly required?: boolean | undefined;
    readonly disabled?: boolean | undefined;
    /** Stable id root. Generated when omitted, which is fine for everything except tests. */
    readonly id?: string | undefined;
    readonly className?: string | undefined;
    readonly testID?: string | undefined;
    readonly children: (control: FieldControlProps) => ReactNode;
}

/** Marks a required field for sighted users; `aria-required` covers assistive technology. */
export const REQUIRED_MARK = '*';

export function FormField({
    label,
    hint,
    error,
    required = false,
    disabled = false,
    id,
    className,
    testID,
    children,
}: FormFieldProps) {
    const generated = useId();
    const density = useDensity();
    const base = id ?? `field-${generated.replace(/:/g, '')}`;

    const labelId = `${base}-label`;
    const hintId = hint === undefined ? undefined : `${base}-hint`;
    const errorId = error === undefined ? undefined : `${base}-error`;
    const described = [hintId, errorId].filter((value): value is string => value !== undefined);

    const control: FieldControlProps = {
        nativeID: base,
        'aria-labelledby': labelId,
        accessibilityLabel: required ? `${label} ${REQUIRED_MARK}` : label,
        ...(described.length > 0 ? { 'aria-describedby': described.join(' ') } : {}),
        ...((error ?? hint) ? { accessibilityHint: error ?? hint } : {}),
        'aria-invalid': error !== undefined,
        'aria-required': required,
        accessibilityState: { disabled },
    };

    // Helper and error copy drop to the `caption` step in the admin — 11px against the label's 12
    // — so the supporting line reads as support rather than as a second label. The 4px gap is the
    // same on both ladders: §4.4's "labels above 28px controls at 4px gap" is already `gap-hair`.
    const supportClass =
        density === 'compact' ? 'text-role-caption font-admin' : 'text-xs';

    return (
        /*
         * `z-auto` is load-bearing, not tidying.
         *
         * React Native Web's base `View` style carries `position: relative; z-index: 0`, so **every
         * View is a stacking context** — and a field wrapper that is one traps any anchored panel
         * opened inside it at z-0, however high the panel's own z-index goes. A `Select`'s dropdown
         * was painting *under* the next section of the form for exactly this reason. A layout
         * container has no business ordering anything, so it opts out and lets the panel compete
         * where it should: against its ancestors' siblings.
         */
        <View testID={testID} className={cx('z-auto flex-col gap-hair', className)}>
            {/*
             * The label is an element in its own right, and on the web it is a real `<label
             * for="…">`. `aria-labelledby` alone reads as "labelled by a hidden thing" to axe the
             * moment the label scrolls out of view, which is how a correctly labelled field ends up
             * reported as `label-title-only`.
             */}
            <FieldLabel
                id={labelId}
                htmlFor={base}
                text={label}
                disabled={disabled}
                {...(required ? { requiredMark: REQUIRED_MARK } : {})}
                {...(testID === undefined ? {} : { testID: `${testID}-label` })}
            />

            {hint === undefined ? null : (
                <RNText
                    nativeID={hintId}
                    testID={testID === undefined ? undefined : `${testID}-hint`}
                    className={cx(supportClass, 'text-content-secondary text-start')}
                >
                    {hint}
                </RNText>
            )}

            {children(control)}

            {error === undefined ? null : (
                <View className="flex-row items-center gap-1">
                    {/* An error is never signalled by colour alone: the icon carries it too. */}
                    <Icon name="warning" size="sm" className="text-danger-strong" />
                    <RNText
                        nativeID={errorId}
                        testID={testID === undefined ? undefined : `${testID}-error`}
                        role="alert"
                        accessibilityRole="alert"
                        aria-live="polite"
                        className={cx(supportClass, 'flex-1 text-danger-strong text-start')}
                    >
                        {error}
                    </RNText>
                </View>
            )}
        </View>
    );
}
