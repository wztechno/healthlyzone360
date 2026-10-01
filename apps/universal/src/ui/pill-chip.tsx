import { cx, useIsCoarsePointer } from '@healthy360/design-system';
import { Pressable, Text as RNText, View } from 'react-native';

/**
 * HealthZone's `chip()` — the customer pages' selectable pill — and its `tabBtn()` sibling, drawn
 * once from tokens.
 *
 * **On** is the brand-subtle fill inside a brand border, **off** the raised surface inside the
 * strong hairline: a change of fill *and* of stroke, never of hue alone. That is not `FilterChip`,
 * whose lit state is the ink inversion — the admin's reading of a chip, not the customer page's.
 *
 * ## Semantics
 *
 * - `mode="toggle"` (the default) is a toggle button: `aria-pressed` on the web,
 *   `accessibilityState.selected` on native, because neither platform reads the other's.
 * - `mode="radio"` is one option of a single-choice group: `role="radio"` with `aria-checked` /
 *   `accessibilityState.checked`. The caller wraps the set in a `radiogroup`.
 * - Without `onPress` it is a pill that states something rather than a control — a storefront's
 *   delivery windows. It is then a plain element with no role, so it is never announced as a
 *   button that does nothing, and it takes no touch floor.
 *
 * ## The 44px floor
 *
 * The customer surfaces keep the `min-h-touch` floor; `floor` says where it sits.
 *
 * - `target` (default): on the press target, with the design's own pill drawn inside it at its
 *   own height — the full target at every pointer without a 44px-tall pill.
 * - `pill`: the pill itself is 44px tall at every pointer.
 * - `coarse`: the pill grows to 44px under a finger only; a mouse gets the design's bare pill.
 */
export type PillChipMode = 'toggle' | 'radio';

export interface PillChipProps {
    readonly label: string;
    readonly selected?: boolean | undefined;
    readonly onPress?: (() => void) | undefined;
    readonly mode?: PillChipMode | undefined;
    readonly disabled?: boolean | undefined;
    /** Defaults to `label`; give a fuller name when the visible one leans on its context. */
    readonly accessibilityLabel?: string | undefined;
    /**
     * `md` is `text-sm`; `sm` is the design's 12.5px snapped to `text-xs`; `xs` is `sm` with a
     * tighter inset, the design's in-row variant (the plan calculator's "Skip week").
     */
    readonly size?: 'xs' | 'sm' | 'md' | undefined;
    /** `pill` is the design's `chip()`; `tab` its 8px-radius `tabBtn()`. */
    readonly shape?: 'pill' | 'tab' | undefined;
    readonly floor?: 'target' | 'pill' | 'coarse' | undefined;
    /** Layout for the outer element (alignment, a minimum width) — never the pill's look. */
    readonly className?: string | undefined;
    readonly testID?: string | undefined;
}

export function PillChip({
    label,
    selected = false,
    onPress,
    mode = 'toggle',
    disabled = false,
    accessibilityLabel,
    size = 'md',
    shape = 'pill',
    floor = 'target',
    className,
    testID,
}: PillChipProps) {
    const coarse = useIsCoarsePointer();
    const pressable = onPress !== undefined;
    const pillFloor = pressable && (floor === 'pill' || (floor === 'coarse' && coarse));

    const pill = cx(
        'flex-row items-center justify-center border py-1.5',
        size === 'xs' ? 'px-2.5' : 'px-3',
        shape === 'pill' ? 'rounded-full' : 'rounded',
        pillFloor ? 'min-h-touch' : null,
        selected
            ? 'border-surface-brand bg-surface-brand-subtle'
            : 'border-stroke-strong bg-surface-raised',
        pressable && !disabled && !selected ? 'hover:bg-surface-sunken' : null,
        disabled ? 'opacity-50' : null,
    );
    const text = (
        <RNText
            numberOfLines={1}
            className={cx(
                'font-medium tabular-nums',
                size === 'md' ? 'text-sm' : 'text-xs',
                selected ? 'text-content-on-brand-subtle' : 'text-content-primary',
            )}
        >
            {label}
        </RNText>
    );

    if (!pressable) {
        return (
            <View testID={testID} className={cx(pill, className)}>
                {text}
            </View>
        );
    }

    const semantics =
        mode === 'radio'
            ? ({
                  role: 'radio',
                  accessibilityRole: 'radio',
                  'aria-checked': selected,
                  accessibilityState: { checked: selected, disabled },
              } as const)
            : ({
                  role: 'button',
                  accessibilityRole: 'button',
                  'aria-pressed': selected,
                  accessibilityState: { selected, disabled },
              } as const);

    return (
        <Pressable
            testID={testID}
            {...semantics}
            accessibilityLabel={accessibilityLabel ?? label}
            aria-disabled={disabled}
            disabled={disabled}
            onPress={onPress}
            className={cx(floor === 'target' ? 'min-h-touch justify-center' : null, className)}
        >
            <View className={pill}>{text}</View>
        </Pressable>
    );
}
