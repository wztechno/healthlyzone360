import type { RouteArea } from '@healthy360/domain-types';

/**
 * The area this browser last opened from the workspace page, for its "Pick up where you left off"
 * card. A convenience, so it is local: a blocked store or a native build simply shows no card.
 */
const KEY = 'h360.last-area';

export interface LastArea {
    readonly area: RouteArea;
    readonly at: string;
}

function store(): Storage | null {
    try {
        return typeof localStorage === 'undefined' ? null : localStorage;
    } catch {
        return null;
    }
}

export function rememberLastArea(area: RouteArea, now: Date = new Date()): void {
    try {
        store()?.setItem(KEY, JSON.stringify({ area, at: now.toISOString() }));
    } catch {
        // Full or blocked: the card just does not appear.
    }
}

export function readLastArea(): LastArea | null {
    try {
        const raw = store()?.getItem(KEY);
        if (raw === null || raw === undefined) return null;
        const parsed = JSON.parse(raw) as Partial<LastArea>;
        return typeof parsed.area === 'string' && typeof parsed.at === 'string'
            ? { area: parsed.area, at: parsed.at }
            : null;
    } catch {
        return null;
    }
}
