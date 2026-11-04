import { Text as RNText, View } from 'react-native';

import { RING_BAND, RING_SIZE, STAGE_INK_VAR } from './stage-ring-shared.ts';
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
}: StageRingProps) {
    const degrees = Math.max(0, Math.min(1, share)) * 360;
    const colour = `rgb(var(${STAGE_INK_VAR[ink]}))`;
    const track = 'rgb(var(--h360-color-on-canopy) / 0.16)';
    const mask = `radial-gradient(farthest-side, transparent calc(100% - ${String(RING_BAND)}px), black calc(100% - ${String(RING_BAND)}px))`;

    return (
        <View
            testID={testID}
            role="img"
            aria-label={accessibilityLabel}
            className="flex-col items-center gap-1 rounded-[18px] bg-content-on-canopy/10 px-1 pb-2 pt-2.5"
        >
            <View
                className="items-center justify-center"
                style={{ width: RING_SIZE, height: RING_SIZE }}
            >
                <div
                    aria-hidden
                    style={{
                        position: 'absolute',
                        width: RING_SIZE,
                        height: RING_SIZE,
                        borderRadius: 999,
                        background: `conic-gradient(${colour} ${String(degrees)}deg, ${track} ${String(degrees)}deg)`,
                        WebkitMask: mask,
                        mask,
                    }}
                />
                <RNText className="font-display text-lg font-bold tabular-nums text-content-on-canopy">
                    {value}
                </RNText>
            </View>
            <RNText className="text-xs font-semibold uppercase tracking-wider text-content-on-canopy-muted">
                {label}
            </RNText>
        </View>
    );
}
