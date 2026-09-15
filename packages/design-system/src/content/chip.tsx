import { useTranslation } from 'react-i18next';
import { Pressable, Text as RNText, View } from 'react-native';

import { useDensity } from '../hooks/use-density.tsx';
import { useIsCoarsePointer } from '../hooks/use-pointer.ts';
import { Icon } from '../icons/icon.tsx';
import type { IconName } from '../icons/icon.tsx';
import { cx } from '../internal/class-names.ts';
import { Tag } from './tag.tsx';

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

/**
 * `neutral` reads as secondary on purpose: it is the tone with nothing to say, worn by tags that
 * sit beside a title rather than competing with it (HealthZone sets its card tags in `--muted`).
 * `textSecondary` is contrast-tested against every surface in both themes, so this stays AA
 * wherever a chip lands.
 */
const TONE_TEXT_CLASS: Readonly<Record<ChipTone, string>> = {
    neutral: 'text-content-secondary',
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
 * research recorded and endorsed (`08-responsive-behaviour.md`, RSP-03 / RSP-08) — at the **44 dp
 * touch minimum**, which is the correction this component made to both of them.
 *
 * **A chip that cannot be pressed is a {@link Tag}, and renders as one.** Not a smaller chip: the
 * same component, so the ~50 call sites that write `<Chip>` for a label on a card get HealthZone's
 * `3px 9px` pill and the two shapes cannot drift apart. Nothing about a 44 dp floor applies to
 * something with no target in it, and holding a row of tags at button height was what made a card's
 * tags read as a row of dead buttons and pushed a three-tag kitchen onto two lines of a grid cell.
 * New code should say `Tag` outright; this branch is what keeps the existing code honest meanwhile.
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
            <Tag
                testID={testID}
                label={label}
                tone={tone}
                {...(icon === undefined ? {} : { icon })}
                {...(disabled ? { className: cx('opacity-50', className) } : { className })}
            />
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
    /**
     * `sm` is the admin step: the same chip at the `xs` type size and half the vertical inset.
     *
     * A row of four closed-enum toggles inside a form section is not the page's primary filter bar,
     * and at the default size four of them out-weigh the section heading above them. On a coarse
     * pointer the 44px touch floor still applies and the chip grows back — the size sets type and
     * inset, never the hit target.
     */
    readonly size?: 'sm' | 'md' | undefined;
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
 * ## Selection is an inversion, not a tint and a tick
 *
 * HealthZone draws a lit chip as the ink surface carrying its inverse text — the `chip()` helper in
 * `HealthZone.dc.html` — and an unlit one as the card surface inside a strong hairline. So the
 * selected state is a *luminance* inversion of about 14:1 against its neighbours, which survives
 * greyscale, every colour-vision deficiency and a bright screen outdoors. That is what replaced the
 * check mark this chip used to add; the standing rule is that meaning is never carried by **colour**
 * alone, and a near-black pill in a row of white ones is not a hue difference. `textInverse` on
 * `surfaceInverse` is a pair `colour.test.ts` already contrast-tests in both themes.
 *
 * ## The 44px floor follows the pointer
 *
 * A finger needs a 44dp target and gets one. A mouse does not: the design draws these at 34px, and
 * holding a desktop filter row at 44 made every chip row in the product read as a stack of buttons
 * rather than as a line of labels. `useIsCoarsePointer` is what decides — the same hook, and the
 * same reasoning, as `Popover`'s hover trigger — so the floor is present exactly where touching
 * happens rather than everywhere or nowhere. A tablet with a keyboard case re-answers while the
 * app is running.
 */
export function FilterChip({
    label,
    selected,
    onChange,
    count,
    size = 'md',
    disabled = false,
    className,
    testID,
}: FilterChipProps) {
    const coarse = useIsCoarsePointer();
    const density = useDensity();

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
                'flex-row items-center justify-center gap-1.5 self-start rounded-full border',
                size === 'sm' ? 'px-2.5 py-0.5' : 'px-3.5 py-1.5',
                coarse ? 'min-h-touch' : null,
                selected
                    ? 'border-surface-inverse bg-surface-inverse'
                    : 'border-stroke-strong bg-surface-raised',
                disabled ? 'opacity-50' : null,
                className,
            )}
        >
            <RNText
                numberOfLines={1}
                className={cx(
                    // The admin reads on the `label` step in its own face. Without this the chip
                    // was one of the components that never asked which surface it was on, so a
                    // filter row in the Catalogue came out in Inter beside a toolbar in Schibsted.
                    density === 'compact'
                        ? 'text-role-label'
                        : size === 'sm'
                          ? 'text-xs font-medium'
                          : 'text-sm font-medium',
                    selected ? 'text-content-inverse' : 'text-content-primary',
                )}
            >
                {label}
            </RNText>
            {count === undefined ? null : (
                <RNText
                    testID={testID === undefined ? undefined : `${testID}-count`}
                    className={cx(
                        density === 'compact' ? 'text-role-caption tabular-nums' : 'text-xs',
                        selected ? 'text-content-inverse' : 'text-content-secondary',
                    )}
                >
                    {String(count)}
                </RNText>
            )}
        </Pressable>
    );
}
