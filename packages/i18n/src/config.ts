import { LOCALES, PSEUDO_LOCALE, isLocale } from '@healthy360/domain-types';
import type { DevelopmentLocale, Locale } from '@healthy360/domain-types';
import { createInstance } from 'i18next';
import type { i18n as I18nInstance, Resource } from 'i18next';
import { initReactI18next } from 'react-i18next';

import { DEFAULT_NAMESPACE, TRANSLATION_NAMESPACES, resources } from './resources.ts';
import type { TranslationNamespace } from './resources.ts';

export const DEFAULT_LOCALE: Locale = 'en';

export interface CreateI18nOptions {
    /** Initial locale. Anything unrecognised falls back to `DEFAULT_LOCALE`. */
    readonly locale?: string | undefined;
    readonly fallbackLocale?: Locale | undefined;
    /** Extra or replacement catalogues, merged over the committed ones (tests, pseudo-locale). */
    readonly resources?: Resource | undefined;
    readonly debug?: boolean | undefined;
    /** Wire up react-i18next. Off for pure-logic tests that do not render. */
    readonly react?: boolean | undefined;
}

/** Narrows an arbitrary tag to a supported locale, tolerating regional forms such as `ar-SA`. */
export function normaliseLocale(candidate: string | null | undefined): DevelopmentLocale {
    if (candidate == null || candidate.length === 0) return DEFAULT_LOCALE;
    if (candidate === PSEUDO_LOCALE) return PSEUDO_LOCALE;
    if (isLocale(candidate)) return candidate;
    const language = candidate.split('-')[0]?.toLowerCase() ?? '';
    return isLocale(language) ? language : DEFAULT_LOCALE;
}

/**
 * Builds a configured i18next instance from the committed catalogues.
 *
 * Resources are bundled rather than fetched: the foundation catalogues are small, and a missing
 * network must never leave a screen showing raw keys. Plurals use i18next's JSON v4 format, which
 * delegates to `Intl.PluralRules` — that is what gives Arabic its six categories for free.
 */
export function createI18n(options: CreateI18nOptions = {}): I18nInstance {
    const instance = createInstance();
    const locale = normaliseLocale(options.locale);
    const fallback = options.fallbackLocale ?? DEFAULT_LOCALE;

    if (options.react !== false) {
        instance.use(initReactI18next);
    }

    void instance.init({
        lng: locale,
        fallbackLng: fallback,
        supportedLngs: [...LOCALES, PSEUDO_LOCALE],
        // `ar-SA` should load the `ar` catalogue rather than falling through to English.
        nonExplicitSupportedLngs: true,
        load: 'languageOnly',
        ns: [...TRANSLATION_NAMESPACES],
        defaultNS: DEFAULT_NAMESPACE,
        resources: { ...(resources as unknown as Resource), ...(options.resources ?? {}) },
        debug: options.debug ?? false,
        returnNull: false,
        interpolation: {
            // React and React Native escape rendered text already; double-escaping mangles Arabic
            // punctuation and apostrophes in English copy.
            escapeValue: false,
        },
        react: { useSuspense: false },
    });

    return instance;
}

export type { I18nInstance, TranslationNamespace };
