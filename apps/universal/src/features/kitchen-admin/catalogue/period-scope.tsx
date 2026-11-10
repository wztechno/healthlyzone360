import { useTranslation } from 'react-i18next';

import { addDays, isoWeekday } from '../../commerce/dates.ts';
import { DeskSelect } from '../desk-kit/desk-select.tsx';
import { LensScope } from './lens-bar.tsx';

/**
 * The Period shortcut that sits before a From–To window in the Lens bar — Today, Yesterday, This
 * week, This month, and Custom for anything else.
 *
 * The period is **derived** from the two days rather than stored beside them: picking a shortcut
 * writes both days, and editing either by hand reads back as Custom. Nothing can disagree.
 *
 * `allowAll` adds an **All** shortcut for a window whose ends may both be open (`''`), as a list
 * filter's are; a report that always needs a window leaves it off.
 *
 * `unit="month"` is for a report that reads whole months (the cost report): Today and Yesterday
 * would all land on the same month there, so its shortcuts are This month, Last month, Last 3 months
 * and This year instead. The window is still two days; the report reads the months they fall in.
 */

const DAY_PRESETS = ['today', 'yesterday', 'week', 'month'] as const;
const MONTH_PRESETS = ['month', 'lastMonth', 'quarter', 'year'] as const;
type Preset = (typeof DAY_PRESETS)[number] | (typeof MONTH_PRESETS)[number];
export type Period = Preset | 'all' | 'custom';
export type PeriodUnit = 'day' | 'month';

const PRESETS: Readonly<Record<PeriodUnit, readonly Preset[]>> = {
    day: DAY_PRESETS,
    month: MONTH_PRESETS,
};

export interface PeriodWindow {
    readonly from: string;
    readonly to: string;
}

const PERIOD_LABELS = {
    all: 'kitchen:lens.period.all',
    today: 'kitchen:lens.period.today',
    yesterday: 'kitchen:lens.period.yesterday',
    week: 'kitchen:lens.period.week',
    month: 'kitchen:lens.period.month',
    lastMonth: 'kitchen:lens.period.lastMonth',
    quarter: 'kitchen:lens.period.quarter',
    year: 'kitchen:lens.period.year',
    custom: 'kitchen:lens.period.custom',
} as const satisfies Record<Period, string>;

/** The first of the month `months` before (negative) or after `today`'s, `YYYY-MM-01`. */
function firstOfMonth(today: string, months: number): string {
    const index = Number(today.slice(0, 4)) * 12 + Number(today.slice(5, 7)) - 1 + months;
    const year = String(Math.floor(index / 12)).padStart(4, '0');
    const month = String((index % 12) + 1).padStart(2, '0');
    return `${year}-${month}-01`;
}

/**
 * The window each shortcut stands for, ending today. The week starts on Monday, as every weekday
 * row in the workspace does; the month on the first. Last month is the whole of it.
 */
export function periodWindows(today: string): Record<Preset, PeriodWindow> {
    const yesterday = addDays(today, -1) ?? today;
    const monday = addDays(today, 1 - (isoWeekday(today) ?? 1)) ?? today;
    const thisMonth = firstOfMonth(today, 0);
    return {
        today: { from: today, to: today },
        yesterday: { from: yesterday, to: yesterday },
        week: { from: monday, to: today },
        month: { from: thisMonth, to: today },
        lastMonth: { from: firstOfMonth(today, -1), to: addDays(thisMonth, -1) ?? today },
        quarter: { from: firstOfMonth(today, -2), to: today },
        year: { from: `${today.slice(0, 4)}-01-01`, to: today },
    };
}

/** Which shortcut a window is, or `custom` when it is none of them. */
export function periodOf(
    window: PeriodWindow,
    today: string,
    allowAll = false,
    unit: PeriodUnit = 'day',
): Period {
    if (allowAll && window.from === '' && window.to === '') return 'all';
    const windows = periodWindows(today);
    return (
        PRESETS[unit].find(
            (key) => windows[key].from === window.from && windows[key].to === window.to,
        ) ?? 'custom'
    );
}

export function PeriodScope({
    testID,
    today,
    value,
    onChange,
    allowAll = false,
    unit = 'day',
    look = 'lens',
}: {
    readonly testID: string;
    /** `YYYY-MM-DD` — held by the screen, so the shortcuts do not move under a reader at midnight. */
    readonly today: string;
    readonly value: PeriodWindow;
    /** Called with both days of the picked shortcut. Custom calls nothing: it is a window, not a pick. */
    readonly onChange: (window: PeriodWindow) => void;
    readonly allowAll?: boolean | undefined;
    readonly unit?: PeriodUnit | undefined;
    /** `desk`: the desk kit's dropdown pill and card (`DeskSelect`), as on the order desk. */
    readonly look?: 'lens' | 'desk' | undefined;
}) {
    const { t } = useTranslation();
    const windows = periodWindows(today);
    const periods: readonly Period[] = [
        ...(allowAll ? ['all' as const] : []),
        ...PRESETS[unit],
        'custom',
    ];

    const props = {
        testID,
        label: t('kitchen:lens.periodLabel'),
        value: periodOf(value, today, allowAll, unit),
        onChange: (next: Period) => {
            if (next === 'custom') return;
            onChange(next === 'all' ? { from: '', to: '' } : windows[next]);
        },
        options: periods.map((key) => ({
            value: key,
            label: t(PERIOD_LABELS[key]),
            testID: `${testID}-${key}`,
        })),
    };
    return look === 'desk' ? <DeskSelect<Period> {...props} /> : <LensScope<Period> {...props} />;
}
