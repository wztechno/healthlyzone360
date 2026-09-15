import { Text } from '@healthy360/design-system';
import { View } from 'react-native';
/**
 * A day or month column chart, drawn as boxes (Workbench handoff §2.3, §3.3).
 *
 * Boxes, not SVG, on purpose: they take the theme from tokens with nothing to keep in step, a test
 * can read them from the tree, and there is no raster step. Each column prints its figure above the
 * bar and carries it as an accessible label *and* a web `title` — the bar's height is never the only
 * place the number lives, because the chart has no Y axis.
 *
 * Heights are a percentage of the largest value, as a style: a computed share has no class.
 */
export interface TrendBarsProps {
    readonly values: readonly number[];
    /** Draw a tick label under every Nth column. 1 labels every column. */
    readonly tickEvery: number;
    readonly tickFor: (index: number) => string;
    /** The figure printed above each bar, already formatted. */
    readonly valueFor: (index: number) => string;
    /** Translated, per column — "Sep 1 – Sep 3 · 48 units". */
    readonly titleFor: (index: number) => string;
    readonly testID?: string | undefined;
}
/** The chart's height — the design's 120px. There is no chart-height token. */
const CHART_HEIGHT = 120;
export function TrendBars({
    values,
    tickEvery,
    tickFor,
    valueFor,
    titleFor,
    testID,
}: TrendBarsProps) {
    const max = Math.max(1, ...values);
    return (
        <View
            testID={testID}
            // `pt-4` is the room the tallest bar's figure needs above it.
            className="flex-row items-end gap-1.5 pt-4"
            style={{ height: CHART_HEIGHT }}
        >
            {values.map((value, index) => (
                <View
                    key={index}
                    testID={testID === undefined ? undefined : `${testID}-bar-${String(index)}`}
                    accessible
                    accessibilityLabel={titleFor(index)}
                    {...({ title: titleFor(index) } as object)}
                    className="h-full min-w-0 flex-1 flex-col justify-end gap-hair"
                >
                    {/* The bar's own area, so the tallest bar stops above the tick label rather
                        than pushing the column past the chart's top. */}
                    <View className="min-h-0 flex-1 justify-end">
                        <View
                            className="relative rounded-t-sm bg-surface-brand"
                            style={{ height: `${Math.round((value / max) * 100)}%` as const }}
                        >
                            <View className="absolute inset-x-0 bottom-full items-center">
                                <Text
                                    variant="micro"
                                    tone="primary"
                                    align="center"
                                    numberOfLines={1}
                                    className="tabular-nums"
                                    testID={
                                        testID === undefined
                                            ? undefined
                                            : `${testID}-value-${String(index)}`
                                    }
                                >
                                    {valueFor(index)}
                                </Text>
                            </View>
                        </View>
                    </View>
                    <Text
                        variant="micro"
                        tone="secondary"
                        align="center"
                        numberOfLines={1}
                        className="font-normal tabular-nums"
                    >
                        {index % tickEvery === 0 ? tickFor(index) : ' '}
                    </Text>
                </View>
            ))}
        </View>
    );
}
