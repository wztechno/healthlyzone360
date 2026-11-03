import { Text } from '@healthy360/design-system';
import { View } from 'react-native';

/**
 * One bar cut into shares — a price ladder, the split of a food's energy. The shares are weights,
 * not percentages: the bar divides itself, so a page passes the figures it already has.
 *
 * The bar is a picture of figures printed beside it ({@link SegmentKey}), never the only place a
 * number lives: it is one `img` with the whole reading as its name, and the key carries each part
 * in words, so no part is told apart by colour alone.
 */

export type SegmentTone = 'deep' | 'brand' | 'warning' | 'info';

/** Theme roles, so the bar flips with the page: the deep stop is dark ink in light, mint in dark. */
const TONE_CLASS: Readonly<Record<SegmentTone, string>> = {
    deep: 'bg-content-on-brand-subtle',
    brand: 'bg-surface-brand',
    warning: 'bg-warning',
    info: 'bg-info',
};

export interface Segment {
    readonly key: string;
    /** A weight. Zero or less is not drawn. */
    readonly share: number;
    readonly tone: SegmentTone;
}

export interface SegmentBarProps {
    /** Translated. The whole reading, in words. */
    readonly label: string;
    readonly segments: readonly Segment[];
    readonly testID: string;
}

export function SegmentBar({ label, segments, testID }: SegmentBarProps) {
    const drawn = segments.filter((segment) => segment.share > 0);

    return (
        <View
            testID={testID}
            role="img"
            aria-label={label}
            accessibilityLabel={label}
            className="h-3 flex-row gap-0.5 overflow-hidden rounded-full bg-surface-sunken"
        >
            {drawn.map((segment) => (
                <View
                    key={segment.key}
                    testID={`${testID}-${segment.key}`}
                    className={`h-full ${TONE_CLASS[segment.tone]}`}
                    style={{ flex: segment.share }}
                />
            ))}
        </View>
    );
}

/** The dot and name that tie a figure to its part of a {@link SegmentBar}. */
export function SegmentKey({
    tone,
    label,
}: {
    readonly tone: SegmentTone;
    readonly label: string;
}) {
    return (
        <View className="flex-row items-center gap-1.5">
            <View aria-hidden className={`h-2 w-2 rounded-full ${TONE_CLASS[tone]}`} />
            <Text variant="label" tone="secondary">
                {label}
            </Text>
        </View>
    );
}
