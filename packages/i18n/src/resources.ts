import type { Locale } from '@healthy360/domain-types';

import arAccess from '../catalogues/ar/access.json';
import arAuth from '../catalogues/ar/auth.json';
import arCommon from '../catalogues/ar/common.json';
import arDesignSystem from '../catalogues/ar/designSystem.json';
import arErrors from '../catalogues/ar/errors.json';
import enAccess from '../catalogues/en/access.json';
import enAuth from '../catalogues/en/auth.json';
import enCommon from '../catalogues/en/common.json';
import enDesignSystem from '../catalogues/en/designSystem.json';
import enErrors from '../catalogues/en/errors.json';

/**
 * The five namespaces. `common` is the default so unqualified keys resolve there; everything else is
 * addressed as `namespace:key`, which is also the form the generated key union uses.
 */
export const TRANSLATION_NAMESPACES = [
    'common',
    'auth',
    'access',
    'errors',
    'designSystem',
] as const;
export type TranslationNamespace = (typeof TRANSLATION_NAMESPACES)[number];

export const DEFAULT_NAMESPACE: TranslationNamespace = 'common';

export type CatalogueBundle = Readonly<Record<TranslationNamespace, unknown>>;

export const enResources = {
    common: enCommon,
    auth: enAuth,
    access: enAccess,
    errors: enErrors,
    designSystem: enDesignSystem,
} as const;

export const arResources = {
    common: arCommon,
    auth: arAuth,
    access: arAccess,
    errors: arErrors,
    designSystem: arDesignSystem,
} as const;

export const resources: Readonly<Record<Locale, CatalogueBundle>> = {
    en: enResources,
    ar: arResources,
};

/** Shape of the English catalogue — the reference every other locale is checked against. */
export type EnglishResources = typeof enResources;
