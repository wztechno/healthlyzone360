import type { Locale } from '@healthy360/domain-types';

import arAccess from '../catalogues/ar/access.json';
import arAccount from '../catalogues/ar/account.json';
import arAuth from '../catalogues/ar/auth.json';
import arB2bApplication from '../catalogues/ar/b2bApplication.json';
import arBusiness from '../catalogues/ar/business.json';
import arCatalogue from '../catalogues/ar/catalogue.json';
import arCommerce from '../catalogues/ar/commerce.json';
import arCommon from '../catalogues/ar/common.json';
import arDesignSystem from '../catalogues/ar/designSystem.json';
import arErrors from '../catalogues/ar/errors.json';
import arGuest from '../catalogues/ar/guest.json';
import arInvitations from '../catalogues/ar/invitations.json';
import arKitchen from '../catalogues/ar/kitchen.json';
import arMarketplace from '../catalogues/ar/marketplace.json';
import arNutrition from '../catalogues/ar/nutrition.json';
import arOnboarding from '../catalogues/ar/onboarding.json';
import arPlanner from '../catalogues/ar/planner.json';
import arPlatformAdmin from '../catalogues/ar/platformAdmin.json';
import arProfessional from '../catalogues/ar/professional.json';
import arVirtualDietitian from '../catalogues/ar/virtualDietitian.json';
import enAccess from '../catalogues/en/access.json';
import enAccount from '../catalogues/en/account.json';
import enAuth from '../catalogues/en/auth.json';
import enB2bApplication from '../catalogues/en/b2bApplication.json';
import enBusiness from '../catalogues/en/business.json';
import enCatalogue from '../catalogues/en/catalogue.json';
import enCommerce from '../catalogues/en/commerce.json';
import enCommon from '../catalogues/en/common.json';
import enDesignSystem from '../catalogues/en/designSystem.json';
import enErrors from '../catalogues/en/errors.json';
import enGuest from '../catalogues/en/guest.json';
import enInvitations from '../catalogues/en/invitations.json';
import enKitchen from '../catalogues/en/kitchen.json';
import enMarketplace from '../catalogues/en/marketplace.json';
import enNutrition from '../catalogues/en/nutrition.json';
import enOnboarding from '../catalogues/en/onboarding.json';
import enPlanner from '../catalogues/en/planner.json';
import enPlatformAdmin from '../catalogues/en/platformAdmin.json';
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
 * `platformAdmin` is the nineteenth, added by PA1. It is its own namespace rather than a branch of
 * `kitchen` because the two speak to opposite people about the same word: `kitchen` is a kitchen
 * addressing itself, and this is the platform addressing a kitchen it may be about to suspend. The
 * register is different, the vocabulary is different, and a shared namespace would have produced
 * two meanings for `status`.
 *
 * `invitations` is the twentieth, added by PA1's acceptance screen. Its own namespace rather than a
 * branch of `platformAdmin` for the reason that runs through this whole slice: `platformAdmin` is
 * the operator *issuing* an invitation from inside a console, and this is the person who received
 * one, who may not have an account and may not be signed in. The two never appear on the same
 * screen and share no vocabulary — "revoke" is a verb in one and a terminal state in the other.
 *
 * `guest` is the seventeenth, added by G1. It is its own namespace rather than a branch of
 * `commerce` because the whole point of the guest journey is that it belongs to somebody who has
 * *no* account and may never have one: the checkout copy, the conversion prompt and the public
 * "delete my data" page share a voice with each other and with nothing else, and the deletion page
 * is reachable by a person who never ordered at all.
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
    'guest',
    'b2bApplication',
    'platformAdmin',
    'invitations',
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
    guest: enGuest,
    b2bApplication: enB2bApplication,
    platformAdmin: enPlatformAdmin,
    invitations: enInvitations,
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
    guest: arGuest,
    b2bApplication: arB2bApplication,
    platformAdmin: arPlatformAdmin,
    invitations: arInvitations,
} as const;

export const resources: Readonly<Record<Locale, CatalogueBundle>> = {
    en: enResources,
    ar: arResources,
};

/** Shape of the English catalogue — the reference every other locale is checked against. */
export type EnglishResources = typeof enResources;
