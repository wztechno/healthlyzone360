import { APP_MODES, ROUTE_AREAS } from '@healthy360/domain-types';
import type { AppMode, RouteArea } from '@healthy360/domain-types';

/**
 * Which route areas each build family compiles and enables (plan §16, 05-universal-frontend.md §2).
 * `all-dev` enables every registry area; the shipping families deliberately exclude the rest so a
 * mis-linked route fails loudly at the first gate instead of rendering an empty shell.
 */
export const MODE_ROUTE_AREAS: Readonly<Record<AppMode, readonly RouteArea[]>> = {
    customer: ['public', 'auth', 'customer', 'patient'],
    staff: ['auth', 'dietitian', 'clinic', 'kitchen', 'partner', 'corporate', 'insurance'],
    kiosk: ['auth', 'kds'],
    driver: ['auth', 'driver'],
    'all-dev': [...ROUTE_AREAS],
};

/** Membership lookups, written out per mode so the map stays exhaustive by type-checking. */
const MODE_ROUTE_AREA_SETS: Readonly<Record<AppMode, ReadonlySet<RouteArea>>> = {
    customer: new Set(MODE_ROUTE_AREAS.customer),
    staff: new Set(MODE_ROUTE_AREAS.staff),
    kiosk: new Set(MODE_ROUTE_AREAS.kiosk),
    driver: new Set(MODE_ROUTE_AREAS.driver),
    'all-dev': new Set(MODE_ROUTE_AREAS['all-dev']),
};

/** Gate 1: is this route area part of the current build family at all? */
export function modeAllows(mode: AppMode, area: RouteArea): boolean {
    return MODE_ROUTE_AREA_SETS[mode].has(area);
}

/** Every mode that enables the given area — used by the route registry's development tooling. */
export function modesForArea(area: RouteArea): readonly AppMode[] {
    return APP_MODES.filter((mode) => modeAllows(mode, area));
}
