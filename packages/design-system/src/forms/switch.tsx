import { useId } from 'react';
import { Pressable, Text as RNText, View } from 'react-native';

import { useDensity } from '../hooks/use-density.tsx';
import { descriptionProps } from '../internal/a11y.ts';
import { cx } from '../internal/class-names.ts';

/**
 * Switch — a setting that takes effect where it stands.
 *
 * ```
 * ●━━━○  Available for sale   On — pricing required
 * ```
 *
 * ## Why this is not {@link Checkbox}
 *
 * A checkbox is a value you are *composing* — one of several answers collected on a form and
 * committed together when you press Save. A switch is a state you are *setting*: it reads as
 * already-applied, and the control's whole job is to say which of two states the thing is in right
 * now. The Catalogue's "Available for sale" is the second kind. It also gates two fields below it,
 * so a reader has to be able to tell at a glance which way it is set from across the row — and a
 * 20px box with a tick is a worse answer to that than a track whose knob is on one side or the
 * other.
 *
 * The two are not interchangeable to assistive technology either: `role="switch"` announces "on"
 * and "off", `role="checkbox"` announces "checked" and "not checked". Both are `aria-checked`
 * underneath, which is why this is a small component rather than a large one.
 *
 * ## The state label is beside it, not under it
 *
 * `Checkbox` puts its `description` under the label, which is right for consent wording that runs
 * to a sentence. A switch's supporting copy is three words naming the state it is in — "On —
 * pricing required" — and that belongs on the same baseline, where it reads as a continuation of
 * the label rather than as a second paragraph. It is also the affordance's own redundancy: the
 * knob's position says the state in geometry, the label says it in words, and neither is colour.
 *
 * ## Geometry
 *
 * A 34×20 track with a 14px knob and a 2px inset, which is the design's. The knob moves on
 * `inset-inline-start` rather than a transform, so it travels toward the *trailing* edge in both
 * writing directions with no `rtl:` variant and no second code path — the same reason
 * `QuantityInput` aligns with `text-end` instead of an inline `textAlign`.
 *
 * The row, not the track, is the hit target: 32px under `compact` (`controlHeight.md`, the ladder's
 * default) and the 44px touch floor on the customer surfaces. The track keeps its size in both —
 * it is the target that changes, never the mark.
 */

export interface SwitchProps {
    readonly checked: boolean;
    readonly onChange: (checked: boolean) => void;
    readonly label: string;
    /**
     * Drops the visible label, keeping it as the switch's accessible name.
     *
     * Same contract and same reason as `FormField`'s `labelHidden`: for a switch in a table column
     * whose header already names it. `stateLabel` is then the only text drawn, which is what a
     * one-line row has room for.
     */
    readonly labelHidden?: boolean | undefined;
    /**
     * Names the state the switch is in — "On — pricing required". Sits beside the label.
     *
     * Not a description of the setting: that is what the label is for. A switch whose supporting
     * copy explains the feature rather than reporting the state leaves the reader working out which
     * way it is set from the knob alone.
     */
    readonly stateLabel?: string | undefined;
    readonly error?: string | undefined;
    readonly disabled?: boolean | undefined;
    readonly id?: string | undefined;
    readonly className?: string | undefined;
    readonly testID?: string | undefined;
}

export function Switch({
    checked,
    onChange,
    label,
    labelHidden = false,
    stateLabel,
    error,
    disabled = false,
    id,
    className,
    testID,
}: SwitchProps) {
    const density = useDensity();
    const generated = useId();
    const base = id ?? `switch-${generated.replace(/:/g, '')}`;
    const stateId = stateLabel === undefined ? undefined : `${base}-state`;
    const errorId = error === undefined ? undefined : `${base}-error`;

    return (
        <View className={cx('flex-col gap-hair', className)} testID={testID}>
            <Pressable
                testID={testID === undefined ? undefined : `${testID}-control`}
                nativeID={base}
                role="switch"
                accessibilityRole="switch"
                accessibilityLabel={label}
                aria-label={label}
                accessibilityState={{ checked, disabled }}
                aria-checked={checked}
                aria-disabled={disabled}
                {...descriptionProps([stateId, errorId], stateLabel ?? error)}
                disabled={disabled}
                onPress={() => {
                    if (!disabled) onChange(!checked);
                }}
                className={cx(
                    'flex-row items-center self-start',
                    density === 'compact' ? 'h-control-md gap-control-sm' : 'min-h-touch gap-3',
                    disabled ? 'opacity-50' : null,
                )}
            >
                <View
                    testID={testID === undefined ? undefined : `${testID}-track`}
                    className={cx(
                        'h-5 w-[34px] rounded-full border',
                        checked
                            ? 'bg-surface-brand border-transparent'
                            : 'bg-surface-sunken border-stroke-strong',
                    )}
                >
                    {/*
                     * `inset-inline-start`, not a transform. The knob's travel is the one piece of
                     * geometry in this component that has to mirror, and a logical inset mirrors
                     * itself — `translateX` would need an `rtl:` variant, which the root ESLint
                     * config bans, or a runtime direction read, which is a second code path for a
                     * 16px slide.
                     */}
                    <View
                        testID={testID === undefined ? undefined : `${testID}-knob`}
                        className={cx(
                            'absolute top-0.5 size-3.5 rounded-full',
                            checked ? 'start-4 bg-surface-raised' : 'start-0.5 bg-surface-raised',
                        )}
                    />
                </View>

                {labelHidden ? null : (
                    <RNText
                        className={cx(
                            'text-content-primary text-start',
                            density === 'compact'
                                ? 'text-role-label font-admin'
                                : 'text-sm font-medium',
                        )}
                    >
                        {label}
                    </RNText>
                )}

                {stateLabel === undefined ? null : (
                    <RNText
                        nativeID={stateId}
                        testID={testID === undefined ? undefined : `${testID}-state`}
                        className={cx(
                            'text-content-secondary text-start',
                            density === 'compact' ? 'text-role-caption font-admin' : 'text-xs',
                        )}
                    >
                        {stateLabel}
                    </RNText>
                )}
            </Pressable>

            {error === undefined ? null : (
                <RNText
                    nativeID={errorId}
                    testID={testID === undefined ? undefined : `${testID}-error`}
                    role="alert"
                    accessibilityRole="alert"
                    className={cx(
                        'text-danger-strong text-start',
                        density === 'compact' ? 'text-role-caption font-admin' : 'text-xs',
                    )}
                >
                    {error}
                </RNText>
            )}
        </View>
    );
}
