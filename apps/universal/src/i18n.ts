import { createI18n, normaliseLocale, readLocaleCookie } from '@healthy360/i18n';
import { getLocales } from 'expo-localization';

/**
 * The application's single i18next instance.
 *
 * Initial locale precedence: the persisted web cookie (which the pre-hydration script in
 * `+html.tsx` has already used to set `dir`/`lang`, so honouring it here avoids a mismatch between
 * the document and the React tree) → the device locale → English.
 *
 * Native persistence lands in Phase 5b alongside the reload flow; on native `readLocaleCookie`
 * returns null and the device locale wins.
 */
function resolveInitialLocale(): string {
    const persisted = readLocaleCookie();
    if (persisted !== null) return normaliseLocale(persisted);

    const device = getLocales()[0]?.languageTag;
    return normaliseLocale(device);
}

export const i18n = createI18n({ locale: resolveInitialLocale() });

export const initialLocale = i18n.resolvedLanguage ?? i18n.language;
