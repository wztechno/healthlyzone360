import { describe, expect, it } from 'vitest';

import {
    APP_MODES,
    LOCALES,
    LOCALE_DIRECTION,
    MEMBERSHIP_STATUSES,
    PRODUCTION_READY_APP_MODES,
    PSEUDO_LOCALE,
    ROUTE_AREAS,
    SESSION_STATES,
    directionForLocale,
    isAppMode,
    isLocale,
    isMembershipStatus,
    isRouteArea,
    isSessionState,
    isTextDirection,
    isUsableMembershipStatus,
} from './enums.ts';

describe('closed unions', () => {
    it('declares exactly the five build modes from plan §16', () => {
        expect([...APP_MODES]).toEqual(['customer', 'staff', 'kiosk', 'driver', 'all-dev']);
    });

    it('declares exactly the fourteen route areas from 05-universal-frontend.md §3', () => {
        expect(ROUTE_AREAS).toHaveLength(14);
        expect([...ROUTE_AREAS]).toEqual([
            'public',
            'auth',
            'customer',
            'patient',
            'dietitian',
            'clinic',
            'kitchen',
            'pos',
            'kds',
            'driver',
            'partner',
            'corporate',
            'insurance',
            'platform-admin',
        ]);
    });

    it('has no duplicate members', () => {
        for (const values of [
            APP_MODES,
            ROUTE_AREAS,
            MEMBERSHIP_STATUSES,
            LOCALES,
            SESSION_STATES,
        ]) {
            expect(new Set(values).size).toBe(values.length);
        }
    });

    it('marks only customer, staff and all-dev as production-ready modes', () => {
        expect([...PRODUCTION_READY_APP_MODES]).toEqual(['customer', 'staff', 'all-dev']);
        for (const mode of PRODUCTION_READY_APP_MODES) {
            expect(isAppMode(mode)).toBe(true);
        }
    });
});

describe('guards', () => {
    const cases = [
        ['isAppMode', isAppMode, APP_MODES],
        ['isRouteArea', isRouteArea, ROUTE_AREAS],
        ['isMembershipStatus', isMembershipStatus, MEMBERSHIP_STATUSES],
        ['isLocale', isLocale, LOCALES],
        ['isSessionState', isSessionState, SESSION_STATES],
    ] as const;

    it.each(cases)('%s accepts every declared member', (_name, guard, values) => {
        for (const value of values) {
            expect(guard(value)).toBe(true);
        }
    });

    it.each(cases)('%s rejects unknown and non-string values', (_name, guard) => {
        expect(guard('definitely-not-a-member')).toBe(false);
        expect(guard('')).toBe(false);
        expect(guard(null)).toBe(false);
        expect(guard(undefined)).toBe(false);
        expect(guard(0)).toBe(false);
    });

    it('isTextDirection behaves the same way', () => {
        expect(isTextDirection('rtl')).toBe(true);
        expect(isTextDirection('sideways')).toBe(false);
    });
});

describe('membership status', () => {
    it('treats only active memberships as usable', () => {
        for (const status of MEMBERSHIP_STATUSES) {
            expect(isUsableMembershipStatus(status)).toBe(status === 'active');
        }
    });
});

describe('direction', () => {
    it('maps product locales to their script direction', () => {
        expect(LOCALE_DIRECTION).toEqual({ en: 'ltr', ar: 'rtl' });
    });

    it.each([
        ['en', 'ltr'],
        ['ar', 'rtl'],
        ['ar-SA', 'rtl'],
        ['AR-EG', 'rtl'],
        ['en-GB', 'ltr'],
        [PSEUDO_LOCALE, 'rtl'],
        ['', 'ltr'],
    ] as const)('directionForLocale(%s) === %s', (locale, expected) => {
        expect(directionForLocale(locale)).toBe(expected);
    });
});
