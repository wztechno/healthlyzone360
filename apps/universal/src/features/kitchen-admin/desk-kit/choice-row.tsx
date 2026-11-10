import { Icon } from '@healthy360/design-system';
import type { ReactNode } from 'react';
import { Pressable, Text as RNText, View } from 'react-native';

/**
 * One choice of several in a desk dialog, as a whole row (Orders canvas, 2026-11-10).
 *
 * ```
 * mark="avatar"  `.drv`   (HR)  Hadi Rizk                       2 runs today   <- chosen: soft green,
 * mark="radio"   `.cb`    ( )   The customer asked to cancel                      the mark filled
 * mark="none"             ↗     Hand it to a courier company       Ready now
 * mark="check"            [✓]   Leave out onions                  <- one of many: a checkbox
 * ```
 *
 * Choosing is not doing: the row only picks, and the dialog's footer button acts — so one mis-tap
 * never sends a run to the wrong person or cancels for the wrong reason.
 */
export function ChoiceRow({
    label,
    meta,
    mark = 'radio',
    initials,
    leading,
    selected,
    onPress,
    accessibilityLabel,
    testID,
}: {
    /** Translated. */
    readonly label: string;
    /** Translated — quiet words at the row's end. */
    readonly meta?: string | undefined;
    /** `check`: one of several that may all be on — announced as a checkbox, drawn as a square. */
    readonly mark?: 'radio' | 'check' | 'avatar' | 'none' | undefined;
    /** For `mark="avatar"`: up to two letters. */
    readonly initials?: string | undefined;
    /** For `mark="none"`: a glyph of the caller's. */
    readonly leading?: ReactNode;
    readonly selected: boolean;
    readonly onPress: () => void;
    readonly accessibilityLabel?: string | undefined;
    readonly testID?: string | undefined;
}) {
    const role = mark === 'check' ? 'checkbox' : 'radio';
    return (
        <Pressable
            testID={testID}
            role={role}
            accessibilityRole={role}
            accessibilityLabel={accessibilityLabel ?? label}
            accessibilityState={{ checked: selected }}
            aria-checked={selected}
            onPress={onPress}
            className={`flex-row items-center gap-2.5 rounded-xl ps-2.5 pe-2 web:transition-colors ${
                mark === 'avatar' ? 'min-h-[46px]' : 'min-h-10'
            } ${selected ? 'bg-surface-brand-subtle' : 'hover:bg-surface-sunken'}`}
        >
            {mark === 'avatar' ? (
                <View
                    aria-hidden
                    className={`h-[30px] w-[30px] items-center justify-center rounded-full ${
                        selected ? 'bg-surface-brand' : 'bg-surface-sunken'
                    }`}
                >
                    <RNText
                        className={`text-xs font-bold ${
                            selected ? 'text-content-on-brand' : 'text-content-secondary'
                        }`}
                    >
                        {initials ?? ''}
                    </RNText>
                </View>
            ) : mark === 'check' ? (
                <View
                    aria-hidden
                    className={`h-5 w-5 items-center justify-center rounded-md border-[1.5px] ${
                        selected
                            ? 'border-surface-brand bg-surface-brand'
                            : 'border-stroke bg-surface-raised'
                    }`}
                >
                    {selected ? (
                        <Icon name="check" size="sm" className="text-content-on-brand" />
                    ) : null}
                </View>
            ) : mark === 'radio' ? (
                <View
                    aria-hidden
                    className={`h-5 w-5 rounded-full bg-surface-raised ${
                        selected
                            ? 'border-[5px] border-surface-brand'
                            : 'border-[1.5px] border-stroke'
                    }`}
                />
            ) : (
                <View aria-hidden className="w-[30px] items-center">
                    {leading}
                </View>
            )}
            <RNText
                numberOfLines={2}
                className={`min-w-0 flex-1 text-sm font-semibold ${
                    selected ? 'text-content-on-brand-subtle' : 'text-content-primary'
                }`}
            >
                {label}
            </RNText>
            {meta === undefined ? null : (
                <RNText className="text-role-strong tabular-nums text-content-secondary">
                    {meta}
                </RNText>
            )}
        </Pressable>
    );
}

/** "Hadi Rizk" → "HR"; one word → its first two letters. */
export function initialsOf(name: string | null): string {
    if (name === null || name.trim() === '') return '·';
    const words = name.trim().split(/\s+/u);
    const letters =
        words.length === 1
            ? Array.from(words[0] ?? '').slice(0, 2)
            : [Array.from(words[0] ?? '')[0], Array.from(words[words.length - 1] ?? '')[0]];
    return letters.join('').toLocaleUpperCase();
}
