import { useId } from 'react';
import type { ReactNode } from 'react';
import { Text as RNText, View } from 'react-native';

import { Icon } from '../icons/icon.tsx';
import { useDensity } from '../hooks/use-density.tsx';
import { cx } from '../internal/class-names.ts';
import { FieldLabel } from './field-label';
import { useFieldSummarised } from './form-issue-scope.tsx';
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
    /** Absent when the label is hidden — `accessibilityLabel` is then the accessible name. */
    readonly 'aria-labelledby'?: string | undefined;
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
    /**
     * Drops the visible label, keeping it as the control's accessible name.
     *
     * For a control whose label is drawn once as a **column header** above a stack of rows — the
     * meal editor's service days are the reference use. Repeating "Date" beside twenty date inputs
     * is what makes a compact table impossible; dropping the name altogether is what makes it
     * unusable with a screen reader. So the element goes and the name stays, moving from
     * `aria-labelledby` (which would point at nothing) to `aria-label`, via `accessibilityLabel`.
     *
     * Never reach for it to tighten a normal form. A field whose only label is elsewhere on the
     * page is a field a sighted reader has to hold in their head too.
     */
    readonly labelHidden?: boolean | undefined;
    /** Supporting copy shown under the label and referenced by `aria-describedby`. */
    readonly hint?: string | undefined;
    /**
     * Validation message. Its presence is what marks the control invalid.
     *
     * Drawn under the control — unless a `FormIssueBanner` in scope names this field (its chip's
     * `fieldId` is this field's `id`). The banner has said it once; the field then keeps its red
     * edge and keeps the message only for assistive technology, as the control's description.
     */
    readonly error?: string | undefined;
    /**
     * A caution that does not block — `Above 10%` under a waste rate. Drawn under the control with
     * the warning mark, and never `aria-invalid`: the value is legal, it is only unusual. Ignored
     * while `error` is set, because a field states one problem at a time.
     */
    readonly warning?: string | undefined;
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
    labelHidden = false,
    hint,
    error,
    warning,
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
    const summarised = useFieldSummarised(base);

    // One message under the control: an error outranks a warning on the same field.
    const caution = error === undefined ? warning : undefined;

    const labelId = `${base}-label`;
    const hintId = hint === undefined ? undefined : `${base}-hint`;
    const errorId = error === undefined ? undefined : `${base}-error`;
    const warningId = caution === undefined ? undefined : `${base}-warning`;
    const described = [hintId, errorId, warningId].filter(
        (value): value is string => value !== undefined,
    );

    const control: FieldControlProps = {
        nativeID: base,
        ...(labelHidden ? {} : { 'aria-labelledby': labelId }),
        accessibilityLabel: required ? `${label} ${REQUIRED_MARK}` : label,
        ...(described.length > 0 ? { 'aria-describedby': described.join(' ') } : {}),
        ...((error ?? caution ?? hint) ? { accessibilityHint: error ?? caution ?? hint } : {}),
        'aria-invalid': error !== undefined,
        'aria-required': required,
        accessibilityState: { disabled },
    };

    // Helper and error copy drop to the `caption` step in the admin — 11px against the label's 12
    // — so the supporting line reads as support rather than as a second label. The 4px gap is the
    // same on both ladders: §4.4's "labels above 28px controls at 4px gap" is already `gap-hair`.
    const supportClass = density === 'compact' ? 'text-role-caption' : 'text-xs';

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
            {labelHidden ? null : (
                <FieldLabel
                    id={labelId}
                    htmlFor={base}
                    text={label}
                    disabled={disabled}
                    {...(required ? { requiredMark: REQUIRED_MARK } : {})}
                    {...(testID === undefined ? {} : { testID: `${testID}-label` })}
                />
            )}

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

            {/*
             * A message the banner already names stays in the tree — it is still what
             * `aria-describedby` points at, so a screen reader landing here from the chip hears why
             * — but takes no room and draws nothing. It stops being a live region too: the banner is
             * the announcement, and two alerts for one refused save is how a reader learns to stop
             * listening.
             */}
            {summarised && (error ?? caution) !== undefined ? (
                <RNText
                    nativeID={errorId ?? warningId}
                    testID={
                        testID === undefined
                            ? undefined
                            : `${testID}-${error === undefined ? 'warning' : 'error'}`
                    }
                    className="absolute h-px w-px overflow-hidden opacity-0"
                >
                    {error ?? caution}
                </RNText>
            ) : null}

            {error === undefined || summarised ? null : (
                <View className="flex-row items-center gap-1">
                    {/*
                     * An error is never signalled by colour alone: the icon carries it too. The
                     * cross, not the triangle — the triangle is the warning's, and a field that can
                     * carry either needs the two to differ in shape as well as ink.
                     */}
                    <Icon name="circleX" size="sm" className="text-danger-strong" />
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

            {caution === undefined || summarised ? null : (
                <View className="flex-row items-center gap-1">
                    <Icon name="alert" size="sm" className="text-warning-strong" />
                    {/* `status`, not `alert`: a caution is news, not an interruption. */}
                    <RNText
                        nativeID={warningId}
                        testID={testID === undefined ? undefined : `${testID}-warning`}
                        role="status"
                        aria-live="polite"
                        className={cx(supportClass, 'flex-1 text-warning-strong text-start')}
                    >
                        {caution}
                    </RNText>
                </View>
            )}
        </View>
    );
}
