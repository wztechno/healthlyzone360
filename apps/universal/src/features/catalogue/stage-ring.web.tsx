import { cx } from '@healthy360/design-system';
import { Text as RNText, View } from 'react-native';

import {
    RING_BAND,
    RING_SIZE,
    SMALL_RING_BAND,
    SMALL_RING_SIZE,
    STAGE_INK_VAR,
} from './stage-ring-shared.ts';
import type { StageRingProps } from './stage-ring-shared.ts';

/**
 * One of the meal stage's four rings, on the web: a conic gradient masked to a band, so the arc is
 * the browser's own drawing and needs no SVG library. The ink is a token variable; the unfilled
 * remainder is the canopy's own ink, faint.
 */
export function StageRing({
    testID,
    value,
    label,
    share,
    ink,
    accessibilityLabel,
    small = false,
}: StageRingProps) {
    const size = small ? SMALL_RING_SIZE : RING_SIZE;
    const band = small ? SMALL_RING_BAND : RING_BAND;
    const degrees = Math.max(0, Math.min(1, share)) * 360;
    const colour = `rgb(var(${STAGE_INK_VAR[ink]}))`;
    const track = 'rgb(var(--h360-color-on-canopy) / 0.16)';
    const mask = `radial-gradient(farthest-side, transparent calc(100% - ${String(band)}px), black calc(100% - ${String(band)}px))`;

    return (
        <View
            testID={testID}
            role="img"
            aria-label={accessibilityLabel}
            className={cx(
                'flex-col items-center bg-content-on-canopy/10',
                small
                    ? 'gap-0.5 rounded-2xl px-0.5 pb-[7px] pt-2'
                    : 'gap-1 rounded-[18px] px-1 pb-2 pt-2.5',
            )}
        >
            <View className="items-center justify-center" style={{ width: size, height: size }}>
                <div
                    aria-hidden
                    style={{
                        position: 'absolute',
                        width: size,
                        height: size,
                        borderRadius: 999,
                        background: `conic-gradient(${colour} ${String(degrees)}deg, ${track} ${String(degrees)}deg)`,
                        WebkitMask: mask,
                        mask,
                    }}
                />
                <RNText
                    className={cx(
                        'font-display font-bold tabular-nums text-content-on-canopy',
                        small ? 'text-base' : 'text-lg',
                    )}
                >
                    {value}
                </RNText>
            </View>
            <RNText
                className={cx(
                    'text-xs font-semibold uppercase text-content-on-canopy-muted',
                    small ? 'tracking-wide' : 'tracking-wider',
                )}
            >
                {label}
            </RNText>
        </View>
    );
}
