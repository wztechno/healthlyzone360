import { useEffect, useState } from 'react';

/**
 * A value that lags behind its source by `delayMs`.
 *
 * Two speeds, exactly as `useDebouncedRollupDraft` has: the first value lands immediately (there is
 * nothing to debounce about an empty basket becoming a basket), and every change after it waits. The
 * write happens in the timer callback, never in the effect body — the same rule
 * `online/online-status.tsx` follows.
 *
 * Shared by the sale wizard and the counter, both of which re-ask the quote endpoint on every change
 * to a basket: a stepper held down would otherwise be one `POST` per repeat.
 */
export function useDebouncedValue<T>(value: T, delayMs: number): T {
    const [settled, setSettled] = useState(value);

    useEffect(() => {
        if (Object.is(settled, value)) return;
        const timer = setTimeout(() => {
            setSettled(value);
        }, delayMs);
        return () => {
            clearTimeout(timer);
        };
    }, [value, delayMs, settled]);

    return settled;
}
