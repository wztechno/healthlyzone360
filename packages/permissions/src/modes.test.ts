import { APP_MODES, ROUTE_AREAS } from '@healthy360/domain-types';
import { describe, expect, it } from 'vitest';

import { MODE_ROUTE_AREAS, modeAllows, modesForArea } from './modes.ts';

describe('MODE_ROUTE_AREAS', () => {
    it('declares an entry for every build mode', () => {
        expect(Object.keys(MODE_ROUTE_AREAS).sort()).toEqual([...APP_MODES].sort());
    });

    it('only references areas from the registry and never repeats one', () => {
        for (const mode of APP_MODES) {
            const areas = MODE_ROUTE_AREAS[mode];
            expect(new Set(areas).size).toBe(areas.length);
            for (const area of areas) {
                expect(ROUTE_AREAS).toContain(area);
            }
        }
    });

    it('matches the plan §16 build families exactly', () => {
        expect([...MODE_ROUTE_AREAS.customer]).toEqual(['public', 'auth', 'customer', 'patient']);
        expect([...MODE_ROUTE_AREAS.staff]).toEqual([
            'auth',
            'dietitian',
            'clinic',
            'kitchen',
            'partner',
            'corporate',
            'insurance',
        ]);
        expect([...MODE_ROUTE_AREAS.kiosk]).toEqual(['auth', 'kds']);
        expect([...MODE_ROUTE_AREAS.driver]).toEqual(['auth', 'driver']);
    });

    it('gives all-dev every one of the thirteen areas, including platform-admin', () => {
        expect([...MODE_ROUTE_AREAS['all-dev']]).toEqual([...ROUTE_AREAS]);
        expect(MODE_ROUTE_AREAS['all-dev']).toContain('platform-admin');
        expect(MODE_ROUTE_AREAS['all-dev']).toHaveLength(13);
    });

    it('exposes platform-admin to all-dev only', () => {
        expect([...modesForArea('platform-admin')]).toEqual(['all-dev']);
    });

    it('exposes auth to every mode (every family needs a sign-in route)', () => {
        for (const mode of APP_MODES) {
            expect(modeAllows(mode, 'auth')).toBe(true);
        }
    });

    it('every area is reachable from at least one mode', () => {
        for (const area of ROUTE_AREAS) {
            expect(modesForArea(area).length).toBeGreaterThan(0);
        }
    });
});
