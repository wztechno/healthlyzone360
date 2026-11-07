import { cx } from '@healthy360/design-system';
import { Text as RNText, View } from 'react-native';

import { RING_BAND, RING_SIZE, SMALL_RING_BAND, SMALL_RING_SIZE } from './stage-ring-shared.ts';
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
    small = false,
}: StageRingProps) {
    const size = small ? SMALL_RING_SIZE : RING_SIZE;
    const band = small ? SMALL_RING_BAND : RING_BAND;
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
            <View
                className={cx(
                    'items-center justify-center rounded-full',
                    share > 0 ? RING_BORDER[ink] : 'border-content-on-canopy/20',
                )}
                style={{ width: size, height: size, borderWidth: band }}
            >
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
