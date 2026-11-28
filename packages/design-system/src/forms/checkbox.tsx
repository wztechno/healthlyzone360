import { useId } from 'react';
import type { ReactNode } from 'react';
import { Pressable, Text as RNText, View } from 'react-native';

import { useAreaLook } from '../hooks/area-look.tsx';
import { useDensity } from '../hooks/use-density.tsx';
import { Icon } from '../icons/icon.tsx';
import { cx } from '../internal/class-names.ts';
import { descriptionProps } from '../internal/a11y.ts';

export interface CheckboxProps {
    readonly checked: boolean;
    readonly onChange: (checked: boolean) => void;
    readonly label: string;
    /**
     * Keeps `label` as the accessible name and draws only the box — a row's selection in a table,
     * where the row beside it already says what the box selects and a second copy of the name
     * would only push the row's own cells along.
     */
    readonly labelHidden?: boolean | undefined;
    /**
     * Some of what the box stands for is ticked and some is not — the select-all box over a list
     * that is partly selected. Draws a dash and announces `mixed`; a press reports `!checked`, so
     * the caller decides whether a mixed box selects the rest or clears it.
     */
    readonly mixed?: boolean | undefined;
    /** Extra copy under the label — used for consent wording that is too long for a label. */
    readonly description?: string | undefined;
    readonly error?: string | undefined;
    readonly required?: boolean | undefined;
    readonly disabled?: boolean | undefined;
    readonly id?: string | undefined;
    readonly className?: string | undefined;
    readonly testID?: string | undefined;
    /** Replaces the plain-text label — for consents that embed a link. */
    readonly labelSlot?: ReactNode | undefined;
    /**
     * `card` draws the whole choice as a bordered tile, its fill the ticked state — one of a set the
     * reader ticks any number of: a plan's diet classifications, a product's sales channels (the
     * old `DeskToggleTile`). 44px tall and 184px wide, so a row of them lines up as a grid however
     * many wrap; `description` becomes the tile's second line. `plain` (the default) is the box and
     * its words.
     */
    readonly shape?: 'plain' | 'card' | undefined;
}

/**
 * Checkbox.
 *
 * The whole row is the hit target, which is what gets a 44 px touch area without stretching the box
 * itself — on the customer surfaces. Under `compact` the row drops to `controlHeight.sm`, because a
 * Catalogue filter list of fifteen allergen classes at 44px a row is a scrollbar rather than a
 * filter, and the admin is driven with a mouse. The box itself is unchanged in both: it is the
 * *target* that differs, not the mark. `accessibilityRole="checkbox"` plus `accessibilityState.checked` is the pair
 * react-native-web turns into `role="checkbox"` + `aria-checked`; omitting the state leaves axe
 * reporting a checkbox with no checked state, which is a serious violation rather than a nicety.
 */
export function Checkbox({
    checked,
    onChange,
    label,
    labelHidden = false,
    mixed = false,
    description,
    error,
    required = false,
    disabled = false,
    id,
    className,
    testID,
    labelSlot,
    shape = 'plain',
}: CheckboxProps) {
    const density = useDensity();
    // The admin's tick (the old `DeskCheckbox`): a 20px box with a firm edge on the raised ground,
    // and in a table cell a 32px target that lights under the pointer.
    const desk = useAreaLook() === 'desk';
    const card = shape === 'card';
    const generated = useId();
    const base = id ?? `checkbox-${generated.replace(/:/g, '')}`;
    const descriptionId = description === undefined ? undefined : `${base}-description`;
    const errorId = error === undefined ? undefined : `${base}-error`;
    // A mixed box is neither state, and says so: `aria-checked="mixed"` is the ARIA value for it.
    const state = mixed && !checked ? 'mixed' : checked;
    const filled = checked || mixed;

    return (
        <View className={cx('flex-col gap-1', className)} testID={testID}>
            <Pressable
                testID={testID === undefined ? undefined : `${testID}-control`}
                nativeID={base}
                role="checkbox"
                accessibilityRole="checkbox"
                accessibilityLabel={label}
                aria-label={label}
                accessibilityState={{ checked: state, disabled }}
                aria-checked={state}
                aria-disabled={disabled}
                aria-required={required}
                {...descriptionProps([descriptionId, errorId], description ?? error)}
                disabled={disabled}
                onPress={() => {
                    if (!disabled) onChange(!checked);
                }}
                className={cx(
                    card
                        ? cx(
                              'min-h-11 w-[184px] flex-row items-center gap-2.5 rounded-xl border px-3 py-1 web:transition-colors',
                              filled
                                  ? 'border-surface-brand bg-surface-brand-subtle'
                                  : 'border-stroke bg-surface-raised',
                              disabled || filled
                                  ? null
                                  : 'hover:border-surface-brand hover:bg-surface-sunken',
                          )
                        : desk && labelHidden
                          ? 'h-8 w-8 items-center justify-center rounded-lg'
                          : desk
                            ? cx(
                                  'flex-row gap-2 py-hair',
                                  description === undefined ? 'items-center' : 'items-start',
                              )
                            : cx(
                                  'flex-row items-start',
                                  labelHidden
                                      ? null
                                      : density === 'compact'
                                        ? 'gap-control-sm py-hair'
                                        : 'min-h-touch gap-3 py-1',
                              ),
                    desk && labelHidden && !disabled ? 'hover:bg-surface-sunken' : null,
                    disabled ? 'opacity-50' : null,
                )}
            >
                {/*
                 * Centred on the label's first line, not its top: `items-start` keeps a wrapped
                 * label hanging from the box, so the offset is what does the centring. Compact is a
                 * 16px box one pixel down beside the 18px `role-body` line — the 20px box used to
                 * sit three pixels low of the words and stand taller than them. Touch density keeps
                 * its 20px box beside the 21px `text-sm` line.
                 *
                 * `shrink-0`, because the label beside it is `flex-1`: in a narrow cell a long label
                 * could otherwise squeeze the box to nothing, and the box is the one thing that says
                 * the row can be ticked.
                 */}
                <View
                    testID={testID === undefined ? undefined : `${testID}-box`}
                    className={
                        desk || card
                            ? cx(
                                  'h-5 w-5 shrink-0 items-center justify-center rounded-md border-[1.5px]',
                                  description !== undefined && !card ? 'mt-px' : null,
                                  filled
                                      ? 'border-surface-brand bg-surface-brand'
                                      : error === undefined
                                        ? 'border-stroke bg-surface-raised'
                                        : 'border-danger-border bg-surface-raised',
                              )
                            : cx(
                                  density === 'compact' ? 'mt-px h-4 w-4' : 'mt-0.5 size-5',
                                  'shrink-0 items-center justify-center rounded-sm border',
                                  filled
                                      ? 'bg-surface-brand border-transparent'
                                      : 'bg-surface-base',
                                  error === undefined
                                      ? 'border-stroke-strong'
                                      : 'border-danger-border',
                              )
                    }
                >
                    {filled ? (
                        <Icon
                            name={checked ? 'check' : 'minus'}
                            size="sm"
                            className="text-content-on-brand"
                        />
                    ) : null}
                </View>

                {labelHidden && description === undefined ? null : (
                    <View className={card ? 'min-w-0 flex-1 flex-col' : 'flex-1 flex-col gap-0.5'}>
                        {labelHidden
                            ? null
                            : (labelSlot ?? (
                                  <RNText
                                      numberOfLines={card ? 1 : undefined}
                                      className={cx(
                                          'text-start',
                                          card
                                              ? cx(
                                                    'text-sm font-semibold',
                                                    filled
                                                        ? 'text-content-on-brand-subtle'
                                                        : 'text-content-primary',
                                                )
                                              : cx(
                                                    'text-content-primary',
                                                    density === 'compact'
                                                        ? 'text-role-body'
                                                        : 'text-sm',
                                                ),
                                      )}
                                  >
                                      {label}
                                      {required ? (
                                          <RNText className="text-danger-strong">{' *'}</RNText>
                                      ) : null}
                                  </RNText>
                              ))}
                        {description === undefined ? null : (
                            <RNText
                                nativeID={descriptionId}
                                className={cx(
                                    'text-content-secondary text-start',
                                    density === 'compact' ? 'text-role-caption' : 'text-xs',
                                )}
                            >
                                {description}
                            </RNText>
                        )}
                    </View>
                )}
            </Pressable>

            {error === undefined ? null : (
                <View className="flex-row items-center gap-1">
                    <Icon name="warning" size="sm" className="text-danger-strong" />
                    <RNText
                        nativeID={errorId}
                        testID={testID === undefined ? undefined : `${testID}-error`}
                        role="alert"
                        accessibilityRole="alert"
                        className={cx(
                            'flex-1 text-danger-strong text-start',
                            density === 'compact' ? 'text-role-caption' : 'text-xs',
                        )}
                    >
                        {error}
                    </RNText>
                </View>
            )}
        </View>
    );
}
