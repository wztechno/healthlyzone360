/**
 * Deterministic sample analytics for the kitchen workspace dashboard.
 *
 * Seeded so the same date-range + segment always yields the same figures (stable demos/tests),
 * while still looking like live kitchen ops data. Labeled as sample on the screen — not API truth.
 */

export const ANALYTICS_DATE_RANGES = ['7d', '30d', '90d', 'ytd'] as const;
export type AnalyticsDateRange = (typeof ANALYTICS_DATE_RANGES)[number];

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

function hashSeed(range: AnalyticsDateRange, segment: AnalyticsSegment): number {
    const text = `${range}:${segment}`;
    let hash = 2166136261;
    for (let i = 0; i < text.length; i += 1) {
        hash ^= text.charCodeAt(i);
        hash = Math.imul(hash, 16777619);
    }
    return hash >>> 0;
}

function dayCount(range: AnalyticsDateRange): number {
    if (range === '7d') return 7;
    if (range === '30d') return 30;
    if (range === '90d') return 90;
    return 120;
}

function segmentMultiplier(segment: AnalyticsSegment): number {
    if (segment === 'meals') return 1.15;
    if (segment === 'recipes') return 0.85;
    if (segment === 'delivery') return 1.05;
    if (segment === 'stock') return 0.75;
    return 1;
}

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] as const;

function trendLabels(range: AnalyticsDateRange, rand: () => number): string[] {
    const days = dayCount(range);
    if (days <= 7) return [...WEEKDAYS];
    if (days <= 30) {
        return Array.from({ length: 10 }, (_, index) => `W${index + 1}`);
    }
    const buckets = days <= 90 ? 12 : 16;
    return Array.from({ length: buckets }, (_, index) => {
        void rand;
        return `P${index + 1}`;
    });
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
    range: AnalyticsDateRange,
    segment: AnalyticsSegment,
): KitchenAnalyticsBundle {
    const rand = mulberry32(hashSeed(range, segment));
    const mult = segmentMultiplier(segment);
    const labels = trendLabels(range, rand);

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
    const watch = Math.round(22 + rand() * 8);
    const blocked = Math.max(4, 100 - onTrack - watch);
    const statusMix: AnalyticsSlice[] = [
        {
            key: 'on_track',
            labelKey: 'kitchen:analytics.status.onTrack',
            value: onTrack,
            colorClass: 'bg-success',
            colorToken: '#16a34a',
        },
        {
            key: 'watch',
            labelKey: 'kitchen:analytics.status.watch',
            value: watch,
            colorClass: 'bg-warning',
            colorToken: '#f59e0b',
        },
        {
            key: 'blocked',
            labelKey: 'kitchen:analytics.status.blocked',
            value: blocked,
            colorClass: 'bg-danger',
            colorToken: '#ef4444',
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
            id: `row-${range}-${segment}-${index}`,
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
        };
    });

    return { kpis, productionTrend, channelVolume, statusMix, rows };
}
