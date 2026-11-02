import { periodOf, periodWindows } from './period-scope.tsx';

describe('the Period shortcut’s windows', () => {
    it('reads month shortcuts as whole months, crossing the year where it must', () => {
        const windows = periodWindows('2026-01-15');

        expect(windows.month).toEqual({ from: '2026-01-01', to: '2026-01-15' });
        expect(windows.lastMonth).toEqual({ from: '2025-12-01', to: '2025-12-31' });
        expect(windows.quarter).toEqual({ from: '2025-11-01', to: '2026-01-15' });
        expect(windows.year).toEqual({ from: '2026-01-01', to: '2026-01-15' });
    });

    it('names a window by the shortcuts of its own unit only', () => {
        const today = '2026-08-29';
        const day = { from: today, to: today };

        expect(periodOf(day, today)).toBe('today');
        // A monthly report has no Today: the same window is a custom one there.
        expect(periodOf(day, today, false, 'month')).toBe('custom');
        expect(periodOf(periodWindows(today).quarter, today, false, 'month')).toBe('quarter');
    });
});
