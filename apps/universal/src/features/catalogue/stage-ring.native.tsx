import { cx } from '@healthy360/design-system';
import { Text as RNText, View } from 'react-native';

import { RING_BAND, RING_SIZE } from './stage-ring-shared.ts';
import type { StageRingProps } from './stage-ring-shared.ts';

/** The ink as a border, written out whole so Tailwind finds each. */
const RING_BORDER = {
    orange: 'border-stage-orange',
    green: 'border-stage-green',
    blue: 'border-stage-blue',
    yellow: 'border-stage-yellow',
} as const;

/**
 * On a phone there is no conic gradient and no SVG library, so the ring is drawn whole in its ink
 * when the figure is published and faint when it is not — the figure inside says the amount.
 */
export function StageRing({
    testID,
    value,
    label,
    share,
    ink,
    accessibilityLabel,
}: StageRingProps) {
    return (
        <View
            testID={testID}
            role="img"
            aria-label={accessibilityLabel}
            className="flex-col items-center gap-1 rounded-[18px] bg-content-on-canopy/10 px-1 pb-2 pt-2.5"
        >
            <View
                className={cx(
                    'items-center justify-center rounded-full',
                    share > 0 ? RING_BORDER[ink] : 'border-content-on-canopy/20',
                )}
                style={{ width: RING_SIZE, height: RING_SIZE, borderWidth: RING_BAND }}
            >
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
