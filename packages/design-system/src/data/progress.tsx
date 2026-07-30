import { useIsRtl } from '@healthy360/i18n';
import type { NutritionLevel } from '@healthy360/design-tokens';
import { Text as RNText, View } from 'react-native';

import { cx } from '../internal/class-names.ts';
import {
    NUTRITION_SURFACE_CLASS,
    NUTRITION_TEXT_CLASS,
    nutritionMark,
} from '../internal/nutrition.ts';

/**
 * Progress against a nutrition target.
 *
 * Two rules govern both components in this file, and they are not stylistic.
 *
 * 1. **A numeric label is always rendered.** Not a tooltip, not an `aria-label`, not a hover
 *    affordance — visible text. "How close am I to my protein target" is the question these
 *    components exist to answer, and an answer that only a sighted mouse user can obtain is not an
 *    answer.
 * 2. **The five-stop scale never speaks through colour alone.** Every stop carries its ordinal
 *    marker from the token's `pattern` field alongside the fill, so the reading survives greyscale,
 *    monochrome displays and every form of colour blindness (WCAG 1.4.1).
 */

function percentOf(value: number, target: number): number {
    if (!Number.isFinite(target) || target <= 0) return 0;
    return Math.max(0, Math.min(100, (value / target) * 100));
}

export interface MeterBarProps {
    /** Visible name of the measure, e.g. "Protein". */
    readonly label: string;
    readonly value: number;
    readonly target: number;
    readonly unit?: string | undefined;
    /** Five-stop nutrition tone. Omitted, the bar uses the neutral brand fill. */
    readonly level?: NutritionLevel | undefined;
    /** Translated name of the level, shown next to the figures. Never the raw token name. */
    readonly levelLabel?: string | undefined;
    /** Pre-formatted figures, e.g. "96 / 120 g". Built from the raw numbers when omitted. */
    readonly valueText?: string | undefined;
    readonly className?: string | undefined;
    readonly testID?: string | undefined;
}

/** A horizontal meter: label, figures, fill. */
export function MeterBar({
    label,
    value,
    target,
    unit,
    level,
    levelLabel,
    valueText,
    className,
    testID,
}: MeterBarProps) {
    const percent = percentOf(value, target);
    const figures =
        valueText ?? `${String(value)} / ${String(target)}${unit === undefined ? '' : ` ${unit}`}`;

    return (
        <View
            testID={testID}
            role="progressbar"
            accessibilityRole="progressbar"
            aria-label={label}
            accessibilityLabel={label}
            aria-valuemin={0}
            aria-valuemax={target}
            aria-valuenow={value}
            aria-valuetext={figures}
            accessibilityValue={{ min: 0, max: target, now: value, text: figures }}
            className={cx('flex-col gap-1', className)}
        >
            <View className="flex-row items-baseline gap-2">
                <RNText className="flex-1 text-sm font-medium text-content-primary text-start">
                    {label}
                </RNText>
                {level === undefined ? null : (
                    <RNText
                        testID={testID === undefined ? undefined : `${testID}-pattern`}
                        aria-hidden
                        accessibilityElementsHidden
                        className={cx('text-xs tracking-wide', NUTRITION_TEXT_CLASS[level])}
                    >
                        {nutritionMark(level)}
                    </RNText>
                )}
                {levelLabel === undefined ? null : (
                    <RNText
                        testID={testID === undefined ? undefined : `${testID}-level`}
                        className="text-xs text-content-secondary"
                    >
                        {levelLabel}
                    </RNText>
                )}
                <RNText
                    testID={testID === undefined ? undefined : `${testID}-value`}
                    className="text-sm font-semibold text-content-primary"
                >
                    {figures}
                </RNText>
            </View>

            <View
                testID={testID === undefined ? undefined : `${testID}-track`}
                aria-hidden
                accessibilityElementsHidden
                importantForAccessibility="no-hide-descendants"
                className="h-2 flex-row overflow-hidden rounded-full bg-surface-sunken"
            >
                <View
                    testID={testID === undefined ? undefined : `${testID}-fill`}
                    className={cx(
                        'h-full rounded-full',
                        level === undefined ? 'bg-surface-brand' : NUTRITION_SURFACE_CLASS[level],
                    )}
                    style={{ width: `${percent}%` }}
                />
            </View>
        </View>
    );
}

export const PROGRESS_RING_SIZES = ['sm', 'md', 'lg'] as const;
export type ProgressRingSize = (typeof PROGRESS_RING_SIZES)[number];

const RING_GEOMETRY: Readonly<
    Record<ProgressRingSize, { readonly diameter: number; readonly tick: number }>
> = {
    sm: { diameter: 64, tick: 6 },
    md: { diameter: 96, tick: 8 },
    lg: { diameter: 128, tick: 10 },
};

const RING_LABEL_CLASS: Readonly<Record<ProgressRingSize, string>> = {
    sm: 'text-sm',
    md: 'text-base',
    lg: 'text-xl',
};

/** Number of ticks around the ring. 24 gives 15° resolution — one tick per 4 % of the target. */
const RING_TICKS = 24;

export interface ProgressRingProps {
    readonly label: string;
    readonly value: number;
    readonly target: number;
    readonly unit?: string | undefined;
    readonly level?: NutritionLevel | undefined;
    readonly levelLabel?: string | undefined;
    readonly valueText?: string | undefined;
    /** Short caption under the figure inside the ring, e.g. "kcal". */
    readonly caption?: string | undefined;
    readonly size?: ProgressRingSize | undefined;
    readonly className?: string | undefined;
    readonly testID?: string | undefined;
}

/**
 * A circular meter.
 *
 * Drawn as twenty-four rotated ticks rather than an SVG arc, because an SVG library is a *native*
 * module and this design system adds none — and because a tick ring is legible at 64 dp where a
 * 2 dp arc is not. Each tick is a small bar sitting at the top of a full-size container that is
 * rotated about its own centre, so the tick travels around the circle without a single absolute
 * offset and without any physical positioning.
 *
 * **The sweep direction follows the text direction.** In Arabic the ring fills anticlockwise: a
 * meter that fills "forwards" must fill the way the reader reads, and the sign of the rotation is
 * the only thing that changes.
 */
export function ProgressRing({
    label,
    value,
    target,
    unit,
    level,
    levelLabel,
    valueText,
    caption,
    size = 'md',
    className,
    testID,
}: ProgressRingProps) {
    const isRtl = useIsRtl();
    const geometry = RING_GEOMETRY[size];
    const percent = percentOf(value, target);
    const filled = Math.round((percent / 100) * RING_TICKS);
    const figures =
        valueText ?? `${String(value)} / ${String(target)}${unit === undefined ? '' : ` ${unit}`}`;
    const sign = isRtl ? -1 : 1;

    return (
        <View
            testID={testID}
            role="progressbar"
            accessibilityRole="progressbar"
            aria-label={label}
            accessibilityLabel={label}
            aria-valuemin={0}
            aria-valuemax={target}
            aria-valuenow={value}
            aria-valuetext={figures}
            accessibilityValue={{ min: 0, max: target, now: value, text: figures }}
            className={cx('items-center justify-center', className)}
            style={{ width: geometry.diameter, height: geometry.diameter }}
        >
            {Array.from({ length: RING_TICKS }, (_unused, index) => (
                <View
                    key={index}
                    testID={testID === undefined ? undefined : `${testID}-sector-${String(index)}`}
                    aria-hidden
                    accessibilityElementsHidden
                    importantForAccessibility="no-hide-descendants"
                    className="absolute inset-0 items-center"
                    style={{
                        transform: [{ rotate: `${String(sign * index * (360 / RING_TICKS))}deg` }],
                    }}
                >
                    <View
                        testID={
                            testID === undefined
                                ? undefined
                                : `${testID}-tick-${String(index)}-${index < filled ? 'on' : 'off'}`
                        }
                        className={cx(
                            index < filled
                                ? level === undefined
                                    ? 'bg-surface-brand'
                                    : NUTRITION_SURFACE_CLASS[level]
                                : 'bg-surface-sunken',
                        )}
                        style={{
                            width: Math.round(geometry.tick / 2),
                            height: geometry.tick,
                            borderRadius: geometry.tick,
                        }}
                    />
                </View>
            ))}

            <View className="items-center gap-0.5">
                <RNText
                    testID={testID === undefined ? undefined : `${testID}-value`}
                    className={cx(
                        'font-semibold text-content-primary text-center',
                        RING_LABEL_CLASS[size],
                    )}
                >
                    {`${String(Math.round(percent))}%`}
                </RNText>
                {caption === undefined ? null : (
                    <RNText
                        testID={testID === undefined ? undefined : `${testID}-caption`}
                        className="text-xs text-content-secondary text-center"
                    >
                        {caption}
                    </RNText>
                )}
                {levelLabel === undefined ? null : (
                    <RNText
                        testID={testID === undefined ? undefined : `${testID}-level`}
                        className="text-xs text-content-secondary text-center"
                    >
                        {levelLabel}
                    </RNText>
                )}
                {level === undefined ? null : (
                    <RNText
                        testID={testID === undefined ? undefined : `${testID}-pattern`}
                        aria-hidden
                        accessibilityElementsHidden
                        className={cx('text-xs tracking-wide', NUTRITION_TEXT_CLASS[level])}
                    >
                        {nutritionMark(level)}
                    </RNText>
                )}
            </View>
        </View>
    );
}
