import { useTranslation } from 'react-i18next';
import { Pressable, Text as RNText, View } from 'react-native';

import { Icon } from '../icons/icon.tsx';
import type { IconName } from '../icons/icon.tsx';
import { cx } from '../internal/class-names.ts';

export const CHIP_TONES = ['neutral', 'brand', 'success', 'warning', 'danger', 'info'] as const;
export type ChipTone = (typeof CHIP_TONES)[number];

const TONE_CLASS: Readonly<Record<ChipTone, string>> = {
    neutral: 'bg-surface-sunken border-stroke-subtle',
    brand: 'bg-surface-brand-subtle border-transparent',
    success: 'bg-success-subtle border-success-border',
    warning: 'bg-warning-subtle border-warning-border',
    danger: 'bg-danger-subtle border-danger-border',
    info: 'bg-info-subtle border-info-border',
};

const TONE_TEXT_CLASS: Readonly<Record<ChipTone, string>> = {
    neutral: 'text-content-primary',
    brand: 'text-content-on-brand-subtle',
    success: 'text-success-on-subtle',
    warning: 'text-warning-on-subtle',
    danger: 'text-danger-on-subtle',
    info: 'text-info-on-subtle',
};

export interface ChipProps {
    readonly label: string;
    readonly tone?: ChipTone | undefined;
    readonly icon?: IconName | null | undefined;
    /** Makes the whole chip activatable. */
    readonly onPress?: (() => void) | undefined;
    /** Adds a dismiss control. Its accessible name is built from the chip's label. */
    readonly onRemove?: (() => void) | undefined;
    readonly disabled?: boolean | undefined;
    readonly className?: string | undefined;
    readonly testID?: string | undefined;
}

/**
 * Chip.
 *
 * Chips reflow by count and width while holding a constant height — a pattern the reference
 * research recorded and endorsed, with one correction: the constant height here is the **44 dp
 * touch minimum**, not the smaller height both references shipped
 * (`08-responsive-behaviour.md`, RSP-03 / RSP-08).
 *
 * A removable chip keeps the dismiss control as a *separate* button rather than making the chip
 * itself remove-on-press: one target that both selects and deletes is unrecoverable by accident,
 * and a nested pressable is what a keyboard user expects to be able to reach on its own.
 */
export function Chip({
    label,
    tone = 'neutral',
    icon,
    onPress,
    onRemove,
    disabled = false,
    className,
    testID,
}: ChipProps) {
    const { t } = useTranslation();

    const body = (
        <>
            {icon === undefined || icon === null ? null : (
                <Icon
                    name={icon}
                    size="sm"
                    className={TONE_TEXT_CLASS[tone]}
                    testID={testID === undefined ? undefined : `${testID}-icon`}
                />
            )}
            <RNText numberOfLines={1} className={cx('text-sm', TONE_TEXT_CLASS[tone])}>
                {label}
            </RNText>
        </>
    );

    const frame = cx(
        'min-h-touch flex-row items-center gap-1.5 self-start rounded-full border px-3 py-1.5',
        TONE_CLASS[tone],
        disabled ? 'opacity-50' : null,
        className,
    );

    if (onRemove !== undefined) {
        return (
            <View testID={testID} className={frame}>
                {onPress === undefined ? (
                    body
                ) : (
                    <Pressable
                        testID={testID === undefined ? undefined : `${testID}-activate`}
                        role="button"
                        accessibilityRole="button"
                        accessibilityLabel={label}
                        disabled={disabled}
                        focusable={!disabled}
                        onPress={disabled ? undefined : onPress}
                        className="min-h-touch flex-row items-center gap-1.5"
                    >
                        {body}
                    </Pressable>
                )}
                <Pressable
                    testID={testID === undefined ? undefined : `${testID}-remove`}
                    role="button"
                    accessibilityRole="button"
                    accessibilityLabel={t('designSystem:chip.remove', { label })}
                    aria-label={t('designSystem:chip.remove', { label })}
                    disabled={disabled}
                    focusable={!disabled}
                    onPress={disabled ? undefined : onRemove}
                    className="min-h-touch min-w-touch items-center justify-center"
                >
                    <Icon name="close" size="sm" className={TONE_TEXT_CLASS[tone]} />
                </Pressable>
            </View>
        );
    }

    if (onPress === undefined) {
        return (
            <View
                testID={testID}
                accessibilityRole="text"
                accessibilityLabel={label}
                className={frame}
            >
                {body}
            </View>
        );
    }

    return (
        <Pressable
            testID={testID}
            role="button"
            accessibilityRole="button"
            accessibilityLabel={label}
            accessibilityState={{ disabled }}
            aria-disabled={disabled}
            disabled={disabled}
            focusable={!disabled}
            onPress={onPress}
            className={frame}
        >
            {body}
        </Pressable>
    );
}

export interface FilterChipProps {
    readonly label: string;
    readonly selected: boolean;
    readonly onChange: (selected: boolean) => void;
    /** Result count shown after the label, e.g. the number of meals matching this filter. */
    readonly count?: number | undefined;
    readonly disabled?: boolean | undefined;
    readonly className?: string | undefined;
    readonly testID?: string | undefined;
}

/**
 * Filter chip — a toggle, not a link.
 *
 * Selection is announced twice on purpose, once per platform vocabulary: `aria-pressed` on the web
 * (a toggle button, which is valid ARIA on a button and which axe accepts, unlike `aria-selected`)
 * and `accessibilityState.selected` on native, which react-native-web ignores entirely. Neither
 * platform sees the other's attribute, and neither is left guessing.
 *
 * Selection is never carried by colour alone: a selected chip also gains a check mark.
 */
export function FilterChip({
    label,
    selected,
    onChange,
    count,
    disabled = false,
    className,
    testID,
}: FilterChipProps) {
    return (
        <Pressable
            testID={testID}
            role="button"
            accessibilityRole="button"
            accessibilityLabel={label}
            aria-pressed={selected}
            accessibilityState={{ selected, disabled }}
            aria-disabled={disabled}
            disabled={disabled}
            focusable={!disabled}
            onPress={() => {
                onChange(!selected);
            }}
            className={cx(
                'min-h-touch flex-row items-center gap-1.5 self-start rounded-full border px-3 py-1.5',
                selected
                    ? 'bg-surface-brand-subtle border-stroke-focus'
                    : 'bg-surface-base border-stroke',
                disabled ? 'opacity-50' : null,
                className,
            )}
        >
            {selected ? (
                <Icon
                    name="check"
                    size="sm"
                    className="text-content-on-brand-subtle"
                    testID={testID === undefined ? undefined : `${testID}-check`}
                />
            ) : null}
            <RNText
                numberOfLines={1}
                className={cx(
                    'text-sm',
                    selected ? 'font-medium text-content-on-brand-subtle' : 'text-content-primary',
                )}
            >
                {label}
            </RNText>
            {count === undefined ? null : (
                <RNText
                    testID={testID === undefined ? undefined : `${testID}-count`}
                    className="text-xs text-content-secondary"
                >
                    {String(count)}
                </RNText>
            )}
        </Pressable>
    );
}
