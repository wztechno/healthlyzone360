import { useTranslation } from 'react-i18next';

import { addDays, isoWeekday } from '../../commerce/dates.ts';
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
 */

const PRESETS = ['today', 'yesterday', 'week', 'month'] as const;
type Preset = (typeof PRESETS)[number];
export type Period = Preset | 'all' | 'custom';

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
    custom: 'kitchen:lens.period.custom',
} as const satisfies Record<Period, string>;

/**
 * The window each shortcut stands for, ending today. The week starts on Monday, as every weekday
 * row in the workspace does; the month on the first.
 */
export function periodWindows(today: string): Record<Preset, PeriodWindow> {
    const yesterday = addDays(today, -1) ?? today;
    const monday = addDays(today, 1 - (isoWeekday(today) ?? 1)) ?? today;
    return {
        today: { from: today, to: today },
        yesterday: { from: yesterday, to: yesterday },
        week: { from: monday, to: today },
        month: { from: `${today.slice(0, 8)}01`, to: today },
    };
}

/** Which shortcut a window is, or `custom` when it is none of them. */
export function periodOf(window: PeriodWindow, today: string, allowAll = false): Period {
    if (allowAll && window.from === '' && window.to === '') return 'all';
    const windows = periodWindows(today);
    return (
        PRESETS.find((key) => windows[key].from === window.from && windows[key].to === window.to) ??
        'custom'
    );
}

export function PeriodScope({
    testID,
    today,
    value,
    onChange,
    allowAll = false,
}: {
    readonly testID: string;
    /** `YYYY-MM-DD` — held by the screen, so the shortcuts do not move under a reader at midnight. */
    readonly today: string;
    readonly value: PeriodWindow;
    /** Called with both days of the picked shortcut. Custom calls nothing: it is a window, not a pick. */
    readonly onChange: (window: PeriodWindow) => void;
    readonly allowAll?: boolean | undefined;
}) {
    const { t } = useTranslation();
    const windows = periodWindows(today);
    const periods: readonly Period[] = [
        ...(allowAll ? ['all' as const] : []),
        ...PRESETS,
        'custom',
    ];

    return (
        <LensScope<Period>
            testID={testID}
            label={t('kitchen:lens.periodLabel')}
            value={periodOf(value, today, allowAll)}
            onChange={(next) => {
                if (next === 'custom') return;
                onChange(next === 'all' ? { from: '', to: '' } : windows[next]);
            }}
            options={periods.map((key) => ({
                value: key,
                label: t(PERIOD_LABELS[key]),
                testID: `${testID}-${key}`,
            }))}
        />
    );
}
