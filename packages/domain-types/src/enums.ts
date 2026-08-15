/**
 * Closed unions the platform is built around. All are declared as `const` tuples first so that
 * runtime code can iterate them (guards, table-driven tests, select options) and the type is
 * derived from the single source of truth.
 */

/** Build-time application modes (plan §16). */
export const APP_MODES = ['customer', 'staff', 'kiosk', 'driver', 'all-dev'] as const;
export type AppMode = (typeof APP_MODES)[number];

/** Modes that have a production-ready build configuration in Phase 1 (plan §16). */
export const PRODUCTION_READY_APP_MODES = ['customer', 'staff', 'all-dev'] as const;
export type ProductionReadyAppMode = (typeof PRODUCTION_READY_APP_MODES)[number];

/** The thirteen route areas recognised by the route registry (05-universal-frontend.md §3). */
export const ROUTE_AREAS = [
    'public',
    'auth',
    'customer',
    'patient',
    'dietitian',
    'clinic',
    'kitchen',
    'kds',
    'driver',
    'partner',
    'corporate',
    'insurance',
    'platform-admin',
] as const;
export type RouteArea = (typeof ROUTE_AREAS)[number];

/** Lifecycle of an `organisation_memberships` row (plan §7, §10). */
export const MEMBERSHIP_STATUSES = [
    'pending',
    'active',
    'suspended',
    'expired',
    'revoked',
] as const;
export type MembershipStatus = (typeof MEMBERSHIP_STATUSES)[number];

export const TEXT_DIRECTIONS = ['ltr', 'rtl'] as const;
export type TextDirection = (typeof TEXT_DIRECTIONS)[number];

/** Product locales for Phase 1 (plan §20). The pseudo-locale is a development artefact only. */
export const LOCALES = ['en', 'ar'] as const;
export type Locale = (typeof LOCALES)[number];

/** Development-only expansion/RTL stress locale; never offered to end users. */
export const PSEUDO_LOCALE = 'en-XA';
export type PseudoLocale = typeof PSEUDO_LOCALE;
export type DevelopmentLocale = Locale | PseudoLocale;

export const LOCALE_DIRECTION: Readonly<Record<Locale, TextDirection>> = {
    en: 'ltr',
    ar: 'rtl',
};

/** Session lifecycle as seen by the client (see `@healthy360/permissions`). */
export const SESSION_STATES = ['restoring', 'anonymous', 'authenticated'] as const;
export type SessionState = (typeof SESSION_STATES)[number];

function memberOf<T extends readonly string[]>(values: T) {
    const set: ReadonlySet<string> = new Set<string>(values);
    return (value: unknown): value is T[number] => typeof value === 'string' && set.has(value);
}

export const isAppMode = memberOf(APP_MODES);
export const isRouteArea = memberOf(ROUTE_AREAS);
export const isMembershipStatus = memberOf(MEMBERSHIP_STATUSES);
export const isTextDirection = memberOf(TEXT_DIRECTIONS);
export const isLocale = memberOf(LOCALES);
export const isSessionState = memberOf(SESSION_STATES);

/** A membership only confers access while it is `active` (plan §10 step 2). */
export function isUsableMembershipStatus(status: MembershipStatus): boolean {
    return status === 'active';
}

export function directionForLocale(locale: string): TextDirection {
    if (isLocale(locale)) return LOCALE_DIRECTION[locale];
    // The pseudo-locale is rendered right-to-left so RTL regressions surface in development.
    if (locale === PSEUDO_LOCALE) return 'rtl';
    const language = locale.split('-')[0]?.toLowerCase() ?? '';
    return language === 'ar' ? 'rtl' : 'ltr';
}
