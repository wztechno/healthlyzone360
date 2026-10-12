import { Text } from '@healthy360/design-system';
import type { ReactNode } from 'react';
import { Text as RNText, View } from 'react-native';
/**
 * One headline figure: micro label, large figure, its unit, one line of meaning (Workbench §2.3).
 *
 * ```
 * ┌ MARGIN · 2026-08 ─────────┐
 * │ 41 337.85  USD            │
 * │ after cost of goods       │
 * └───────────────────────────┘
 * ```
 *
 * Replaces `kpi-tile.tsx` on Cost report and Analytics, where the figures *are* the content and so
 * earn a tile rather than the Catalogue's one summary line. A hairline on the raised fill and the card
 * cast, the same card as the header's summary strip at a larger figure.
 *
 * `emphasis: 'brand'` is spent once per screen — on the margin, the figure a reader is looking for.
 * `trend` is Analytics' inline-end delta, which says its direction in words.
 */
export interface CostTileProps {
    readonly label: string;
    readonly value: string;
    /** The currency code, or the unit a KPI counts in. */
    readonly unit?: string | undefined;
    readonly hint?: string | undefined;
    readonly trend?: ReactNode | undefined;
    readonly emphasis?: 'brand' | undefined;
    readonly testID?: string | undefined;
}
export function CostTile({ label, value, unit, hint, trend, emphasis, testID }: CostTileProps) {
    return (
        <View
            testID={testID}
            className="flex-col gap-1 rounded-panel border border-stroke-subtle bg-surface-raised p-[18px] shadow-elevation-1"
        >
            <View className="flex-row items-baseline justify-between gap-tight">
                <RNText numberOfLines={1} className="text-xs text-content-secondary text-start">
                    {label}
                </RNText>
                {trend}
            </View>
            <View className="flex-row flex-wrap items-baseline gap-1">
                {/* `display` — the mood board's 25px KPI figure, tabular numerals built in. */}
                <Text
                    variant="display"
                    tone={emphasis === 'brand' ? 'brand' : 'primary'}
                    testID={testID === undefined ? undefined : `${testID}-value`}
                >
                    {value}
                </Text>
                {unit === undefined ? null : (
                    <Text variant="caption" tone="secondary">
                        {unit}
                    </Text>
                )}
            </View>
            {hint === undefined ? null : (
                // The mood board's KPI footer: the meaning as a small pill.
                <View className="flex-row pt-1.5">
                    <View className="rounded-full bg-surface-sunken px-2.5 py-1">
                        <RNText
                            numberOfLines={1}
                            className="text-role-micro text-content-secondary text-start"
                        >
                            {hint}
                        </RNText>
                    </View>
                </View>
            )}
        </View>
    );
}
/**
 * A row of tiles: `auto-fit, minmax(floor, 1fr)` capped at `maxWidth`, as a wrapping flex row.
 */
export function CostTileRow({
    children,
    floor,
    maxWidth,
    testID,
}: {
    readonly children: readonly ReactNode[];
    readonly floor: number;
    readonly maxWidth: number;
    readonly testID?: string | undefined;
}) {
    return (
        <View testID={testID} style={{ maxWidth }} className="flex-row flex-wrap gap-snug">
            {children.map((child, index) => (
                <View key={index} className="flex-1 flex-col" style={{ minWidth: floor }}>
                    {child}
                </View>
            ))}
        </View>
    );
}
