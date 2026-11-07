import { DEFAULT_LOCALE, createI18n, normaliseLocale, readLocaleCookie } from '@healthy360/i18n';
import { getLocales } from 'expo-localization';
import { Platform } from 'react-native';

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

const isBuild = Platform.OS === 'web' && typeof document === 'undefined';

/**
 * True when the browser is hydrating the static web export's HTML. Expo Router writes
 * `__EXPO_ROUTER_HYDRATE__ = true` into every exported page.
 */
const hydratesStaticHtml =
    Platform.OS === 'web' &&
    !isBuild &&
    (globalThis as { __EXPO_ROUTER_HYDRATE__?: unknown }).__EXPO_ROUTER_HYDRATE__ === true;

/** The build has no cookie and no visitor, so its HTML is always in `DEFAULT_LOCALE`. */
export const i18n = createI18n({ locale: isBuild ? DEFAULT_LOCALE : resolveInitialLocale() });

/**
 * The instance the browser hydrates the static HTML with, in the build's language, or null when
 * there is no static HTML to hydrate. Hydrating that HTML in the visitor's language would be React
 * error 418.
 *
 * `AppProviders` provides it through context and swaps in {@link i18n} after its first commit. A
 * context change, not `changeLanguage`, because Expo Router's Suspense boundaries hydrate after the
 * root has committed, and React hydrates every boundary that a context change reaches with the old
 * value before it applies the change. That swap is also how `AppProviders` knows hydration is over.
 */
export const hydrationI18n = hydratesStaticHtml
    ? createI18n({ locale: DEFAULT_LOCALE, react: false })
    : null;
