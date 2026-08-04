/**
 * Lightweight kitchen analytics charts — View bars everywhere; SVG line/donut on web.
 *
 * No `react-native-svg` dependency (design-system glyph policy). Native gets a stacked/arc
 * approximation that still communicates the same figures.
 */

import { Text, useTheme } from '@healthy360/design-system';
import { brand } from '@healthy360/design-tokens';
import { createElement, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { Platform, Pressable, View } from 'react-native';

import type { AnalyticsPoint, AnalyticsSlice } from './analytics-sample-data.ts';

export interface ChartFrameProps {
    readonly testID: string;
    readonly title: string;
    readonly children: ReactNode;
}

export function ChartFrame({ testID, title, children }: ChartFrameProps) {
    return (
        <View
            testID={testID}
            className="min-h-[280px] flex-1 basis-[280px] rounded-[14px] border border-brand-100 bg-surface-raised p-4 shadow-elevation-1"
        >
            <Text className="mb-3 font-display text-base font-bold text-content-primary">{title}</Text>
            {children}
        </View>
    );
}

function TooltipBubble({
    testID,
    label,
    value,
}: {
    readonly testID: string;
    readonly label: string;
    readonly value: string;
}) {
    return (
        <View
            testID={testID}
            className="absolute end-3 top-0 z-10 max-w-[70%] rounded-lg border border-stroke bg-surface-base px-3 py-2 shadow-elevation-2"
        >
            <Text tone="secondary" variant="caption">
                {label}
            </Text>
            <Text className="font-display text-sm font-bold text-content-primary">{value}</Text>
        </View>
    );
}

export interface BarChartProps {
    readonly testID: string;
    readonly points: readonly AnalyticsPoint[];
    readonly valueSuffix?: string | undefined;
}

export function BarChart({ testID, points, valueSuffix = '' }: BarChartProps) {
    const [active, setActive] = useState<number | null>(null);
    const max = Math.max(1, ...points.map((point) => point.value));

    return (
        <View testID={testID} className="relative flex-1">
            {active === null ? null : (
                <TooltipBubble
                    testID={`${testID}-tooltip`}
                    label={points[active]!.label}
                    value={`${points[active]!.value}${valueSuffix}`}
                />
            )}
            <View className="mt-6 min-h-[180px] flex-1 flex-row items-end gap-2">
                {points.map((point, index) => {
                    const isActive = active === index;
                    return (
                        <Pressable
                            key={point.label}
                            testID={`${testID}-bar-${index}`}
                            accessibilityRole="button"
                            accessibilityLabel={`${point.label}: ${point.value}${valueSuffix}`}
                            onHoverIn={() => setActive(index)}
                            onHoverOut={() => setActive(null)}
                            onPress={() => setActive((current) => (current === index ? null : index))}
                            className="min-w-0 flex-1 items-center gap-1"
                        >
                            <View
                                className="w-full overflow-hidden rounded-t-md"
                                style={{
                                    height: Math.max(12, Math.round((point.value / max) * 160)),
                                    backgroundColor: isActive ? brand[600] : brand[400],
                                    opacity: active === null || isActive ? 1 : 0.45,
                                }}
                            />
                            <Text
                                numberOfLines={1}
                                tone="secondary"
                                variant="caption"
                                className="w-full text-center text-[10px]"
                            >
                                {point.label}
                            </Text>
                        </Pressable>
                    );
                })}
            </View>
        </View>
    );
}

export interface LineChartProps {
    readonly testID: string;
    readonly points: readonly AnalyticsPoint[];
}

export function LineChart({ testID, points }: LineChartProps) {
    const { isDark } = useTheme();
    const [active, setActive] = useState<number | null>(null);
    const width = 320;
    const height = 160;
    const padX = 12;
    const padY = 16;
    const max = Math.max(1, ...points.map((point) => point.value));
    const min = Math.min(...points.map((point) => point.value));
    const span = Math.max(1, max - min);

    const coords = useMemo(
        () =>
            points.map((point, index) => {
                const x =
                    points.length === 1
                        ? width / 2
                        : padX + (index / (points.length - 1)) * (width - padX * 2);
                const y = height - padY - ((point.value - min) / span) * (height - padY * 2);
                return { x, y, ...point };
            }),
        [points, min, span],
    );

    const path = coords.map((c, i) => `${i === 0 ? 'M' : 'L'} ${c.x.toFixed(1)} ${c.y.toFixed(1)}`).join(' ');
    const areaPath = `${path} L ${coords[coords.length - 1]!.x.toFixed(1)} ${height - padY} L ${coords[0]!.x.toFixed(1)} ${height - padY} Z`;
    const stroke = brand[500];
    const fill = isDark ? 'rgba(22, 163, 74, 0.22)' : 'rgba(22, 163, 74, 0.14)';
    const grid = isDark ? 'rgba(255,255,255,0.08)' : 'rgba(15, 23, 42, 0.08)';

    if (Platform.OS === 'web') {
        return (
            <View testID={testID} className="relative flex-1">
                {active === null ? null : (
                    <TooltipBubble
                        testID={`${testID}-tooltip`}
                        label={coords[active]!.label}
                        value={String(coords[active]!.value)}
                    />
                )}
                <View className="mt-4 overflow-hidden rounded-lg">
                    {createElement(
                        'svg',
                        {
                            viewBox: `0 0 ${width} ${height}`,
                            width: '100%',
                            height: 180,
                            role: 'img',
                            'aria-label': 'Production trend',
                            style: { display: 'block' },
                        },
                        createElement('line', {
                            x1: padX,
                            x2: width - padX,
                            y1: height / 2,
                            y2: height / 2,
                            stroke: grid,
                            strokeWidth: 1,
                        }),
                        createElement('path', {
                            d: areaPath,
                            fill,
                        }),
                        createElement('path', {
                            d: path,
                            fill: 'none',
                            stroke,
                            strokeWidth: 2.5,
                            strokeLinecap: 'round',
                            strokeLinejoin: 'round',
                        }),
                        ...coords.map((point, index) =>
                            createElement('circle', {
                                key: point.label,
                                cx: point.x,
                                cy: point.y,
                                r: active === index ? 5.5 : 3.5,
                                fill: active === index ? brand[700] : stroke,
                                style: { cursor: 'pointer' },
                                onMouseEnter: () => setActive(index),
                                onMouseLeave: () => setActive(null),
                                onClick: () => setActive((current) => (current === index ? null : index)),
                            }),
                        ),
                    )}
                </View>
                <View className="mt-2 flex-row justify-between px-1">
                    {points.map((point) => (
                        <Text key={point.label} tone="secondary" variant="caption" className="text-[10px]">
                            {point.label}
                        </Text>
                    ))}
                </View>
            </View>
        );
    }

    // Native fallback: sparkline bars that still track the series.
    return (
        <BarChart testID={testID} points={points} />
    );
}

export interface DonutChartProps {
    readonly testID: string;
    readonly slices: readonly AnalyticsSlice[];
    readonly centerLabel: string;
    readonly sliceLabel: (slice: AnalyticsSlice) => string;
}

export function DonutChart({ testID, slices, centerLabel, sliceLabel }: DonutChartProps) {
    const [active, setActive] = useState<number | null>(null);
    const total = Math.max(1, slices.reduce((sum, slice) => sum + slice.value, 0));
    const size = 168;
    const strokeWidth = 22;
    const radius = (size - strokeWidth) / 2;
    const circumference = 2 * Math.PI * radius;

    let offset = 0;
    const arcs = slices.map((slice) => {
        const length = (slice.value / total) * circumference;
        const start = offset;
        offset += length;
        return { slice, length, start };
    });

    if (Platform.OS === 'web') {
        return (
            <View testID={testID} className="relative flex-1 flex-row flex-wrap items-center gap-4">
                <View className="relative items-center justify-center" style={{ width: size, height: size }}>
                    {createElement(
                        'svg',
                        {
                            width: size,
                            height: size,
                            viewBox: `0 0 ${size} ${size}`,
                            role: 'img',
                            'aria-label': centerLabel,
                        },
                        createElement('circle', {
                            cx: size / 2,
                            cy: size / 2,
                            r: radius,
                            fill: 'none',
                            stroke: 'rgba(148, 163, 184, 0.25)',
                            strokeWidth,
                        }),
                        ...arcs.map((arc, index) =>
                            createElement('circle', {
                                key: arc.slice.key,
                                cx: size / 2,
                                cy: size / 2,
                                r: radius,
                                fill: 'none',
                                stroke: arc.slice.colorToken,
                                strokeWidth: active === index ? strokeWidth + 4 : strokeWidth,
                                strokeDasharray: `${arc.length} ${circumference - arc.length}`,
                                strokeDashoffset: -arc.start,
                                strokeLinecap: 'butt',
                                transform: `rotate(-90 ${size / 2} ${size / 2})`,
                                style: {
                                    cursor: 'pointer',
                                    opacity: active === null || active === index ? 1 : 0.4,
                                },
                                onMouseEnter: () => setActive(index),
                                onMouseLeave: () => setActive(null),
                                onClick: () => setActive((current) => (current === index ? null : index)),
                            }),
                        ),
                    )}
                    <View className="absolute inset-0 items-center justify-center px-6">
                        <Text className="font-display text-xl font-bold text-content-primary">
                            {active === null ? `${total}%` : `${arcs[active]!.slice.value}%`}
                        </Text>
                        <Text tone="secondary" variant="caption" className="text-center">
                            {active === null ? centerLabel : sliceLabel(arcs[active]!.slice)}
                        </Text>
                    </View>
                </View>
                <View className="min-w-[140px] flex-1 gap-2">
                    {slices.map((slice, index) => (
                        <Pressable
                            key={slice.key}
                            testID={`${testID}-legend-${slice.key}`}
                            onHoverIn={() => setActive(index)}
                            onHoverOut={() => setActive(null)}
                            onPress={() => setActive((current) => (current === index ? null : index))}
                            className="flex-row items-center gap-2"
                        >
                            <View
                                className="h-2.5 w-2.5 rounded-full"
                                style={{ backgroundColor: slice.colorToken }}
                            />
                            <Text className="flex-1 text-sm text-content-primary">{sliceLabel(slice)}</Text>
                            <Text className="font-display text-sm font-bold text-content-primary">
                                {slice.value}%
                            </Text>
                        </Pressable>
                    ))}
                </View>
            </View>
        );
    }

    return (
        <View testID={testID} className="flex-1 gap-3">
            <View className="h-4 flex-row overflow-hidden rounded-full bg-surface-sunken">
                {slices.map((slice) => (
                    <View
                        key={slice.key}
                        className="h-full"
                        style={{
                            width: `${Math.max(1, Math.round((slice.value / total) * 100))}%`,
                            backgroundColor: slice.colorToken,
                        }}
                    />
                ))}
            </View>
            {slices.map((slice) => (
                <View key={slice.key} className="flex-row items-center gap-2">
                    <View
                        className="h-2.5 w-2.5 rounded-full"
                        style={{ backgroundColor: slice.colorToken }}
                    />
                    <Text className="flex-1 text-sm">{sliceLabel(slice)}</Text>
                    <Text className="font-display font-bold">{slice.value}%</Text>
                </View>
            ))}
        </View>
    );
}
