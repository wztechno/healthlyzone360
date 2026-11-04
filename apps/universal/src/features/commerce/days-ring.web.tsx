import { Text as RNText, View } from 'react-native';

import { DAYS_RING_BAND, DAYS_RING_SIZE } from './days-ring-shared.ts';
import type { DaysRingProps } from './days-ring-shared.ts';

/**
 * The subscription's balance ring, on the web: a conic gradient masked to a band — the browser's
 * own drawing, so no SVG library. The arc is the brand fill, the remainder the page's base.
 */
export function DaysRing({ testID, value, label, share, accessibilityLabel }: DaysRingProps) {
    const degrees = Math.max(0, Math.min(1, share)) * 360;
    const colour = 'rgb(var(--h360-color-brand-surface))';
    const track = 'rgb(var(--h360-color-surface-base))';
    const mask = `radial-gradient(farthest-side, transparent calc(100% - ${String(DAYS_RING_BAND)}px), black calc(100% - ${String(DAYS_RING_BAND)}px))`;

    return (
        <View
            testID={testID}
            role="img"
            aria-label={accessibilityLabel}
            className="shrink-0 items-center justify-center"
            style={{ width: DAYS_RING_SIZE, height: DAYS_RING_SIZE }}
        >
            <div
                aria-hidden
                style={{
                    position: 'absolute',
                    width: DAYS_RING_SIZE,
                    height: DAYS_RING_SIZE,
                    borderRadius: 999,
                    background: `conic-gradient(${colour} ${String(degrees)}deg, ${track} ${String(degrees)}deg)`,
                    WebkitMask: mask,
                    mask,
                }}
            />
            <RNText className="font-display text-4xl font-bold leading-none tabular-nums text-content-primary">
                {value}
            </RNText>
            <RNText className="mt-1 text-sm font-semibold text-content-secondary">{label}</RNText>
        </View>
    );
}
