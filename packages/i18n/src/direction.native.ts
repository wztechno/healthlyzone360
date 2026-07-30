import { directionForLocale } from '@healthy360/domain-types';
import type { TextDirection } from '@healthy360/domain-types';
// This import is the single sanctioned I18nManager boundary in the codebase. The root ESLint config
// bans `I18nManager` everywhere except `packages/i18n`, which is why no disable comment is needed.
import { I18nManager } from 'react-native';

import type { ApplyLocaleResult, DirectionAdapter } from './direction.ts';

export type { ApplyLocaleResult, DirectionAdapter, DirectionPlatform } from './direction.ts';
export { LOCALE_COOKIE_MAX_AGE_SECONDS, LOCALE_COOKIE_NAME } from './direction.ts';

/**
 * Native direction adapter — the one place in the codebase permitted to import `I18nManager`
 * (enforced by `no-restricted-imports` in the root ESLint config).
 *
 * React Native resolves layout direction once, at startup. `forceRTL` records the preference but the
 * running tree keeps its old direction, so this adapter reports `needsReload` rather than pretending
 * the switch happened; the reload prompt itself is wired up in Phase 5b (plan §20).
 */
export const directionAdapter: DirectionAdapter = {
    platform: 'native',

    getDirection(): TextDirection {
        return I18nManager.isRTL ? 'rtl' : 'ltr';
    },

    applyLocale(locale: string): ApplyLocaleResult {
        const direction = directionForLocale(locale);
        const wantsRtl = direction === 'rtl';
        const isRtl = I18nManager.isRTL;

        // Must be allowed before it can be forced; safe to call repeatedly.
        I18nManager.allowRTL(true);

        if (wantsRtl === isRtl) {
            return { locale, direction, changed: false, needsReload: false };
        }

        I18nManager.forceRTL(wantsRtl);

        return { locale, direction, changed: true, needsReload: true };
    },
};

export const getDirection = (): TextDirection => directionAdapter.getDirection();
export const applyLocaleDirection = (locale: string): ApplyLocaleResult =>
    directionAdapter.applyLocale(locale);

/** Cookies do not exist on native; locale persistence uses secure storage in the app layer. */
export function readLocaleCookie(): string | null {
    return null;
}

export function writeLocaleCookie(): void {
    /* no-op on native */
}
