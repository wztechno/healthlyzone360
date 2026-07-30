import { directionForLocale } from '@healthy360/domain-types';
import type { TextDirection } from '@healthy360/domain-types';

/**
 * Web direction adapter — and the module TypeScript, Vitest and Node resolve.
 *
 * Metro's platform extensions pick `direction.native.ts` on iOS and Android and `direction.web.ts`
 * (which simply re-exports this file) on the web, so `export * from './direction'` in `index.ts`
 * resolves per platform without either implementation leaking into the other's bundle. This is the
 * one place in the package that imports without an explicit `.ts` extension, precisely so that
 * resolution can happen.
 */

export type DirectionPlatform = 'web' | 'native';

export interface ApplyLocaleResult {
    readonly locale: string;
    readonly direction: TextDirection;
    /** True when the platform's layout direction actually changed. */
    readonly changed: boolean;
    /**
     * True when the change cannot take effect until the application restarts. Always false on the
     * web; on native this is what drives the user-facing reload prompt (plan §20).
     */
    readonly needsReload: boolean;
}

export interface DirectionAdapter {
    readonly platform: DirectionPlatform;
    /** The direction currently in force. */
    getDirection(): TextDirection;
    /** Applies the locale's direction, reporting whether a restart is required. */
    applyLocale(locale: string): ApplyLocaleResult;
}

/** Cookie the pre-hydration script in `+html.tsx` reads to set `dir`/`lang` before first paint. */
export const LOCALE_COOKIE_NAME = 'h360_locale';
export const LOCALE_COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 365;

function hasDocument(): boolean {
    return typeof document !== 'undefined' && document.documentElement != null;
}

export function readLocaleCookie(cookieString?: string): string | null {
    const source = cookieString ?? (typeof document === 'undefined' ? '' : document.cookie);
    if (!source) return null;
    for (const part of source.split(';')) {
        const [name, ...rest] = part.trim().split('=');
        if (name === LOCALE_COOKIE_NAME) {
            const value = rest.join('=');
            return value.length > 0 ? decodeURIComponent(value) : null;
        }
    }
    return null;
}

export function writeLocaleCookie(locale: string): void {
    if (typeof document === 'undefined') return;
    document.cookie = `${LOCALE_COOKIE_NAME}=${encodeURIComponent(locale)}; path=/; max-age=${LOCALE_COOKIE_MAX_AGE_SECONDS}; samesite=lax`;
}

export const directionAdapter: DirectionAdapter = {
    platform: 'web',

    getDirection(): TextDirection {
        if (!hasDocument()) return 'ltr';
        return document.documentElement.getAttribute('dir') === 'rtl' ? 'rtl' : 'ltr';
    },

    applyLocale(locale: string): ApplyLocaleResult {
        const direction = directionForLocale(locale);
        if (!hasDocument()) {
            return { locale, direction, changed: false, needsReload: false };
        }

        const root = document.documentElement;
        const changed =
            root.getAttribute('dir') !== direction || root.getAttribute('lang') !== locale;

        root.setAttribute('dir', direction);
        root.setAttribute('lang', locale);
        writeLocaleCookie(locale);

        // The web re-lays out immediately; nothing to restart.
        return { locale, direction, changed, needsReload: false };
    },
};

export const getDirection = (): TextDirection => directionAdapter.getDirection();
export const applyLocaleDirection = (locale: string): ApplyLocaleResult =>
    directionAdapter.applyLocale(locale);
