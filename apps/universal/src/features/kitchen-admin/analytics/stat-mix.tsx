import { Text } from '@healthy360/design-system';
import { View } from 'react-native';

import { LegendKey } from './paired-bars.tsx';

/**
 * One share strip and a keyed legend (Workbench handoff §2.3).
 *
 * **Every segment's label is in the legend**, with its percentage in words, so the strip is never the
 * only carrier of meaning — a reader in greyscale, or a screen reader, gets the whole mix from the
 * legend alone. The strip itself is hidden from assistive technology for that reason.
 */
export const STAT_MIX_TONES = ['success', 'warning', 'danger'] as const;
export type StatMixTone = (typeof STAT_MIX_TONES)[number];

/**
 * The solid fills, as the design's `TONE_SOLID`: brand for on-track, the control outline for watch,
 * the danger border for blocked. Solid rather than subtle so three adjacent segments stay apart.
 */
const SWATCH: Readonly<Record<StatMixTone, string>> = {
    success: 'bg-surface-brand',
    warning: 'bg-stroke',
    danger: 'bg-danger-border',
};

export interface StatMixProps {
    readonly segments: readonly {
        readonly key: string;
        readonly label: string;
        /** 0–100. */
        readonly pct: number;
        readonly tone: StatMixTone;
    }[];
    /** Formats a percentage in the reader's numbering system. */
    readonly formatPercent: (pct: number) => string;
    readonly testID?: string | undefined;
}

/** The strip's cap — the design's 560px. */
const STRIP_MAX_WIDTH = 560;

export function StatMix({ segments, formatPercent, testID }: StatMixProps) {
    return (
        <View testID={testID} className="flex-col gap-tight">
            <View
                aria-hidden
                accessibilityElementsHidden
                importantForAccessibility="no-hide-descendants"
                className="h-3.5 flex-row overflow-hidden rounded-sm"
                style={{ maxWidth: STRIP_MAX_WIDTH }}
            >
                {segments.map((segment) => (
                    <View
                        key={segment.key}
                        className={SWATCH[segment.tone]}
                        style={{ width: `${segment.pct}%` as const }}
                    />
                ))}
            </View>
            <View className="flex-row flex-wrap gap-3.5">
                {segments.map((segment) => (
                    <View
                        key={segment.key}
                        testID={testID === undefined ? undefined : `${testID}-${segment.key}`}
                        className="flex-row items-center gap-1.5"
                    >
                        <LegendKey swatch={SWATCH[segment.tone]} label={segment.label} />
                        <Text variant="mono">{formatPercent(segment.pct)}</Text>
                    </View>
                ))}
            </View>
        </View>
    );
}
