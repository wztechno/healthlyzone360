import { cx } from '@healthy360/design-system';
import { Text as RNText, View } from 'react-native';

import { DAYS_RING_BAND, DAYS_RING_SIZE } from './days-ring-shared.ts';
import type { DaysRingProps } from './days-ring-shared.ts';

/**
 * On a phone there is no conic gradient and no SVG library, so the ring is drawn whole — in the
 * brand fill while days remain, in the base when none do. The figure inside says the amount.
 */
export function DaysRing({ testID, value, label, share, accessibilityLabel }: DaysRingProps) {
    return (
        <View
            testID={testID}
            role="img"
            aria-label={accessibilityLabel}
            className={cx(
                'shrink-0 items-center justify-center rounded-full',
                share > 0 ? 'border-surface-brand' : 'border-surface-base',
            )}
            style={{ width: DAYS_RING_SIZE, height: DAYS_RING_SIZE, borderWidth: DAYS_RING_BAND }}
        >
            <RNText className="font-display text-4xl font-bold leading-none tabular-nums text-content-primary">
                {value}
            </RNText>
            <RNText className="mt-1 text-sm font-semibold text-content-secondary">{label}</RNText>
        </View>
    );
}
