import { Text } from '@healthy360/design-system';
import { View } from 'react-native';
/**
 * Two series per tick, side by side on one shared scale — revenue against COGS (Workbench §2.3).
 *
 * The shared max is the point: each series scaled to its own maximum would draw COGS as tall as
 * revenue and hide the margin, which is the one thing a reader is looking at. The legend names both
 * series in words, so the colour is never the only carrier.
 */
export interface PairedBarsProps {
    readonly series: readonly {
        readonly tick: string;
        readonly a: number;
        readonly b: number;
        /** Translated per-column label, e.g. "2026-06 revenue 71 350.00 USD". */
        readonly aTitle: string;
        readonly bTitle: string;
    }[];
    readonly aLabel: string;
    readonly bLabel: string;
    readonly testID?: string | undefined;
}
const CHART_HEIGHT = 130;
export function PairedBars({ series, aLabel, bLabel, testID }: PairedBarsProps) {
    const max = Math.max(1, ...series.flatMap((point) => [point.a, point.b]));
    const share = (value: number) => `${Math.round((Math.max(0, value) / max) * 100)}%` as const;
    return (
        <View testID={testID} className="flex-col gap-tight">
            <View className="flex-row items-end gap-2.5" style={{ height: CHART_HEIGHT }}>
                {series.map((point) => (
                    <View
                        key={point.tick}
                        className="h-full min-w-0 flex-1 flex-col justify-end gap-hair"
                    >
                        <View className="flex-1 flex-row items-end gap-0.5">
                            <View
                                accessible
                                accessibilityLabel={point.aTitle}
                                {...({ title: point.aTitle } as object)}
                                className="flex-1 rounded-t-sm bg-surface-brand"
                                style={{ height: share(point.a) }}
                            />
                            <View
                                accessible
                                accessibilityLabel={point.bTitle}
                                {...({ title: point.bTitle } as object)}
                                className="flex-1 rounded-t-sm bg-stroke"
                                style={{ height: share(point.b) }}
                            />
                        </View>
                        <Text
                            variant="micro"
                            tone="secondary"
                            align="center"
                            className="font-normal tabular-nums"
                        >
                            {point.tick}
                        </Text>
                    </View>
                ))}
            </View>
            <View className="flex-row flex-wrap gap-3.5">
                <LegendKey swatch="bg-surface-brand" label={aLabel} />
                <LegendKey swatch="bg-stroke" label={bLabel} />
            </View>
        </View>
    );
}
export function LegendKey({ swatch, label }: { readonly swatch: string; readonly label: string }) {
    return (
        <View className="flex-row items-center gap-1.5">
            <View aria-hidden className={`h-2 w-2 rounded-xs ${swatch}`} />
            <Text variant="caption" tone="secondary">
                {label}
            </Text>
        </View>
    );
}
