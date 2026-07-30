export { DEFAULT_LOCALE, createI18n, normaliseLocale } from './config.ts';
export type { CreateI18nOptions, I18nInstance } from './config.ts';

export {
    DEFAULT_NAMESPACE,
    TRANSLATION_NAMESPACES,
    arResources,
    enResources,
    resources,
} from './resources.ts';
export type { CatalogueBundle, EnglishResources, TranslationNamespace } from './resources.ts';

/**
 * Platform-resolved: Metro picks `direction.native.ts` on iOS/Android and `direction.web.ts` on the
 * web; TypeScript, Vitest and Node see `direction.ts` (the DOM implementation).
 */
export {
    LOCALE_COOKIE_MAX_AGE_SECONDS,
    LOCALE_COOKIE_NAME,
    applyLocaleDirection,
    directionAdapter,
    getDirection,
    readLocaleCookie,
    writeLocaleCookie,
} from './direction';
export type { ApplyLocaleResult, DirectionAdapter, DirectionPlatform } from './direction';

export { DEFAULT_NUMBERING_SYSTEM, createFormatter, withNumberingSystem } from './format.ts';
export type { Formatter, FormatterOptions, NumberingSystem } from './format.ts';

export { setLocale, useDirection, useFormatter, useIsRtl, useLocale } from './hooks.ts';
export type { UseLocaleResult } from './hooks.ts';

export { PLURAL_SUFFIXES, TRANSLATION_KEYS, isTranslationKey } from './keys.generated.ts';
export type { NamespaceKeys, TranslationKey } from './keys.generated.ts';
