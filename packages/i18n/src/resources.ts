import type { Locale } from '@healthy360/domain-types';

import arAccess from '../catalogues/ar/access.json';
import arAccount from '../catalogues/ar/account.json';
import arAuth from '../catalogues/ar/auth.json';
import arBusiness from '../catalogues/ar/business.json';
import arCatalogue from '../catalogues/ar/catalogue.json';
import arCommerce from '../catalogues/ar/commerce.json';
import arCommon from '../catalogues/ar/common.json';
import arDesignSystem from '../catalogues/ar/designSystem.json';
import arErrors from '../catalogues/ar/errors.json';
import arKitchen from '../catalogues/ar/kitchen.json';
import arMarketplace from '../catalogues/ar/marketplace.json';
import arNutrition from '../catalogues/ar/nutrition.json';
import arOnboarding from '../catalogues/ar/onboarding.json';
import arPlanner from '../catalogues/ar/planner.json';
import arProfessional from '../catalogues/ar/professional.json';
import arVirtualDietitian from '../catalogues/ar/virtualDietitian.json';
import enAccess from '../catalogues/en/access.json';
import enAccount from '../catalogues/en/account.json';
import enAuth from '../catalogues/en/auth.json';
import enBusiness from '../catalogues/en/business.json';
import enCatalogue from '../catalogues/en/catalogue.json';
import enCommerce from '../catalogues/en/commerce.json';
import enCommon from '../catalogues/en/common.json';
import enDesignSystem from '../catalogues/en/designSystem.json';
import enErrors from '../catalogues/en/errors.json';
import enKitchen from '../catalogues/en/kitchen.json';
import enMarketplace from '../catalogues/en/marketplace.json';
import enNutrition from '../catalogues/en/nutrition.json';
import enOnboarding from '../catalogues/en/onboarding.json';
import enPlanner from '../catalogues/en/planner.json';
import enProfessional from '../catalogues/en/professional.json';
import enVirtualDietitian from '../catalogues/en/virtualDietitian.json';

/**
 * The translation namespaces. `common` is the default so unqualified keys resolve there; everything
 * else is addressed as `namespace:key`, which is also the form the generated key union uses.
 *
 * The first five are the platform foundation. The nine that follow are the Prompt 2 prototype
 * areas, registered here **before** any of their screens exist. That is deliberate: this file is a
 * chokepoint that several parallel workstreams would otherwise all need to edit, and reserving the
 * namespaces up front is what stops nine simultaneous edits to one import block. Each new
 * catalogue currently holds a single `title` key; the wave that builds the screens fills it in.
 *
 * `kitchen` is the fifteenth, reserved by K1 on exactly the same terms: the kitchen workspace is
 * several slices, each of which would otherwise add its own import line here.
 *
 * `account` is the sixteenth, reserved by J1. The D2C account area is a checklist, contacts,
 * addresses, an allergy declaration and a consent list — five slices that would otherwise queue up
 * to edit this one file. The one-time-code copy is deliberately *not* here: it lives in `auth`,
 * because the same panel serves the guest and B2B journeys that have no account at all.
 *
 * **Adding a namespace** is four edits and two commands: create `catalogues/en/<name>.json` and
 * `catalogues/ar/<name>.json`, add the two imports above, add the name to the list below *and* to
 * both resource maps, then run `pnpm gen:i18n-keys` and `pnpm gen:pseudo-locale`. `pnpm i18n:check`
 * discovers namespaces from the English directory, so a file added without a registration here is
 * checked but unreachable — and `catalogues.test.ts` pins the list so that cannot pass unnoticed.
 */
export const TRANSLATION_NAMESPACES = [
    'common',
    'auth',
    'access',
    'errors',
    'designSystem',
    'marketplace',
    'catalogue',
    'onboarding',
    'nutrition',
    'planner',
    'commerce',
    'virtualDietitian',
    'professional',
    'business',
    'kitchen',
    'account',
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
    marketplace: enMarketplace,
    catalogue: enCatalogue,
    onboarding: enOnboarding,
    nutrition: enNutrition,
    planner: enPlanner,
    commerce: enCommerce,
    virtualDietitian: enVirtualDietitian,
    professional: enProfessional,
    business: enBusiness,
    kitchen: enKitchen,
    account: enAccount,
} as const;

export const arResources = {
    common: arCommon,
    auth: arAuth,
    access: arAccess,
    errors: arErrors,
    designSystem: arDesignSystem,
    marketplace: arMarketplace,
    catalogue: arCatalogue,
    onboarding: arOnboarding,
    nutrition: arNutrition,
    planner: arPlanner,
    commerce: arCommerce,
    virtualDietitian: arVirtualDietitian,
    professional: arProfessional,
    business: arBusiness,
    kitchen: arKitchen,
    account: arAccount,
} as const;

export const resources: Readonly<Record<Locale, CatalogueBundle>> = {
    en: enResources,
    ar: arResources,
};

/** Shape of the English catalogue — the reference every other locale is checked against. */
export type EnglishResources = typeof enResources;
