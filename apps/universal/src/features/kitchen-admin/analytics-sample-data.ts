/**
 * Deterministic sample analytics for the kitchen workspace dashboard.
 *
 * Seeded so the same window length + segment always yields the same figures (stable demos/tests),
 * while still looking like live kitchen ops data. Labeled as sample on the screen — not API truth.
 *
 * The window is a number of days — the screen's From–To window, both ends counted — so the Period
 * shortcuts and a custom window all draw from the one builder.
 */

import { palette } from '@healthy360/design-tokens';

export const ANALYTICS_SEGMENTS = ['all', 'meals', 'recipes', 'delivery', 'stock'] as const;
export type AnalyticsSegment = (typeof ANALYTICS_SEGMENTS)[number];

export interface AnalyticsKpi {
    readonly key: string;
    readonly labelKey: string;
    readonly value: number;
    readonly unit: 'count' | 'percent' | 'minutes';
    readonly deltaPercent: number;
    readonly higherIsBetter: boolean;
}

export interface AnalyticsPoint {
    readonly label: string;
    readonly value: number;
}

export interface AnalyticsSlice {
    readonly key: string;
    readonly labelKey: string;
    readonly value: number;
    readonly colorClass: string;
    readonly colorToken: string;
}

export interface AnalyticsTableRow {
    readonly id: string;
    readonly name: string;
    readonly segment: Exclude<AnalyticsSegment, 'all'>;
    readonly status: 'on_track' | 'watch' | 'blocked';
    readonly volume: number;
    readonly completionPercent: number;
    readonly avgMinutes: number;
    readonly updatedLabel: string;
    /** How long ago, in whole hours, `updatedLabel` says — what the Updated column sorts by. */
    readonly updatedHoursAgo: number;
}

export interface KitchenAnalyticsBundle {
    readonly kpis: readonly AnalyticsKpi[];
    readonly productionTrend: readonly AnalyticsPoint[];
    readonly channelVolume: readonly AnalyticsPoint[];
    readonly statusMix: readonly AnalyticsSlice[];
    readonly rows: readonly AnalyticsTableRow[];
}

function mulberry32(seed: number): () => number {
    let t = seed >>> 0;
    return () => {
        t += 0x6d2b79f5;
        let r = Math.imul(t ^ (t >>> 15), 1 | t);
        r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
        return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
    };
}

function hashSeed(days: number, segment: AnalyticsSegment): number {
    const text = `${String(days)}:${segment}`;
    let hash = 2166136261;
    for (let i = 0; i < text.length; i += 1) {
        hash ^= text.charCodeAt(i);
        hash = Math.imul(hash, 16777619);
    }
    return hash >>> 0;
}

function segmentMultiplier(segment: AnalyticsSegment): number {
    if (segment === 'meals') return 1.15;
    if (segment === 'recipes') return 0.85;
    if (segment === 'delivery') return 1.05;
    if (segment === 'stock') return 0.75;
    return 1;
}

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] as const;

/**
 * How many bars a window of `days` draws: one a day up to ten days, then ten, twelve or sixteen
 * runs of days as the window grows.
 */
export function trendBucketCount(days: number): number {
    if (days <= 10) return Math.max(1, days);
    if (days <= 31) return 10;
    if (days <= 90) return 12;
    return 16;
}

function trendLabels(days: number): string[] {
    const count = trendBucketCount(days);
    if (days <= 7) return Array.from({ length: count }, (_, index) => WEEKDAYS[index % 7]!);
    return Array.from({ length: count }, (_, index) => `P${index + 1}`);
}

const MEAL_NAMES = [
    'Mediterranean Bowl',
    'Grilled Salmon Plate',
    'Green Detox Smoothie',
    'Chicken Quinoa Salad',
    'Vegan Buddha Bowl',
    'Lean Beef Stir-fry',
    'Overnight Oats Cup',
    'Turkey Wrap Pack',
] as const;

const RECIPE_NAMES = [
    'Caesar Sauce v2',
    'Harissa Marinade',
    'Base Brown Rice',
    'Herb Labneh Dressing',
    'Roasted Veg Mix',
    'Chicken Stock Reduction',
] as const;

const DELIVERY_NAMES = [
    'Zone — Beirut Central',
    'Zone — Metn Hills',
    'Morning Window A',
    'Evening Window B',
    'Cut-off watch list',
] as const;

const STOCK_NAMES = [
    'Chicken breast — cold store',
    'Olive oil 5L',
    'Brown rice 25kg',
    'Fresh herbs crate',
    'Packaging — meal tray',
] as const;

function namesFor(segment: AnalyticsSegment): readonly string[] {
    if (segment === 'meals') return MEAL_NAMES;
    if (segment === 'recipes') return RECIPE_NAMES;
    if (segment === 'delivery') return DELIVERY_NAMES;
    if (segment === 'stock') return STOCK_NAMES;
    return [...MEAL_NAMES, ...RECIPE_NAMES.slice(0, 2), ...DELIVERY_NAMES.slice(0, 2)];
}

function pickStatus(rand: () => number): AnalyticsTableRow['status'] {
    const roll = rand();
    if (roll < 0.62) return 'on_track';
    if (roll < 0.88) return 'watch';
    return 'blocked';
}

/**
 * Build a full analytics bundle for the selected filters.
 */
export function buildKitchenAnalytics(
    days: number,
    segment: AnalyticsSegment,
): KitchenAnalyticsBundle {
    const rand = mulberry32(hashSeed(days, segment));
    const mult = segmentMultiplier(segment);
    const labels = trendLabels(days);

    const productionTrend = labels.map((label, index) => {
        const wave = Math.sin(index / 2.2) * 18 + Math.cos(index / 3.1) * 10;
        const base = 42 * mult + wave + rand() * 14;
        return { label, value: Math.max(8, Math.round(base)) };
    });

    const channelVolume: AnalyticsPoint[] = [
        { label: 'subscription', value: Math.round((180 + rand() * 40) * mult) },
        { label: 'aLaCarte', value: Math.round((120 + rand() * 35) * mult) },
        { label: 'b2b', value: Math.round((70 + rand() * 25) * mult) },
        { label: 'pos', value: Math.round((45 + rand() * 20) * mult) },
        { label: 'staff', value: Math.round((20 + rand() * 12) * mult) },
    ];

    const onTrack = Math.round(58 + rand() * 12);
    // Watch gives way so blocked keeps its 4% floor and the three still make 100.
    const watch = Math.min(Math.round(22 + rand() * 8), 96 - onTrack);
    const blocked = 100 - onTrack - watch;
    const statusMix: AnalyticsSlice[] = [
        {
            key: 'on_track',
            labelKey: 'kitchen:analytics.status.onTrack',
            value: onTrack,
            colorClass: 'bg-success',
            colorToken: palette.primary,
        },
        {
            key: 'watch',
            labelKey: 'kitchen:analytics.status.watch',
            value: watch,
            colorClass: 'bg-warning',
            colorToken: palette.warning,
        },
        {
            key: 'blocked',
            labelKey: 'kitchen:analytics.status.blocked',
            value: blocked,
            colorClass: 'bg-danger',
            colorToken: palette.error,
        },
    ];

    const mealsProduced = productionTrend.reduce((sum, point) => sum + point.value, 0);
    const avgPerBucket = Math.round(mealsProduced / Math.max(1, productionTrend.length));
    const reviewBacklog = Math.round((18 + rand() * 22) * (segment === 'stock' ? 0.4 : 1));
    const onTimePercent = Math.round(86 + rand() * 10);
    const avgPrep = Math.round(28 + rand() * 14);

    const kpis: AnalyticsKpi[] = [
        {
            key: 'produced',
            labelKey: 'kitchen:analytics.kpi.produced',
            value: mealsProduced,
            unit: 'count',
            deltaPercent: Math.round((-6 + rand() * 18) * 10) / 10,
            higherIsBetter: true,
        },
        {
            key: 'onTime',
            labelKey: 'kitchen:analytics.kpi.onTime',
            value: onTimePercent,
            unit: 'percent',
            deltaPercent: Math.round((-3 + rand() * 8) * 10) / 10,
            higherIsBetter: true,
        },
        {
            key: 'review',
            labelKey: 'kitchen:analytics.kpi.review',
            value: reviewBacklog,
            unit: 'count',
            deltaPercent: Math.round((-12 + rand() * 20) * 10) / 10,
            higherIsBetter: false,
        },
        {
            key: 'prep',
            labelKey: 'kitchen:analytics.kpi.prep',
            value: avgPrep,
            unit: 'minutes',
            deltaPercent: Math.round((-8 + rand() * 10) * 10) / 10,
            higherIsBetter: false,
        },
    ];

    const sourceNames = namesFor(segment);
    const rowCount = Math.min(12, Math.max(6, sourceNames.length));
    const rows: AnalyticsTableRow[] = Array.from({ length: rowCount }, (_, index) => {
        const name = sourceNames[index % sourceNames.length]!;
        const rowSegment: Exclude<AnalyticsSegment, 'all'> =
            segment === 'all'
                ? (['meals', 'recipes', 'delivery', 'stock'] as const)[index % 4]!
                : segment;
        const status = pickStatus(rand);
        const hoursAgo = Math.round(rand() * 48);
        return {
            id: `row-${segment}-${index}`,
            name,
            segment: rowSegment,
            status,
            volume: Math.round(avgPerBucket * (0.4 + rand()) + rand() * 20),
            completionPercent: Math.round(
                status === 'blocked'
                    ? 35 + rand() * 25
                    : status === 'watch'
                      ? 55 + rand() * 25
                      : 78 + rand() * 20,
            ),
            avgMinutes: Math.round(18 + rand() * 36),
            updatedLabel: hoursAgo < 1 ? 'Just now' : `${hoursAgo}h ago`,
            updatedHoursAgo: hoursAgo,
        };
    });

    return { kpis, productionTrend, channelVolume, statusMix, rows };
}
