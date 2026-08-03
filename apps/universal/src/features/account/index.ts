/**
 * The D2C account area (plan Phase J1).
 *
 * Five screens over two contracts — a setup checklist, contact verification, delivery addresses, the
 * allergy declaration and the consent record — plus the two pickers the onboarding wizard will
 * adopt.
 *
 * ## What is deliberately exported, and to whom
 *
 * * **The screens** are exported through `./screens/index.ts` so the routes share one chunk.
 * * **{@link AllergyPicker} and {@link DietaryTagsPicker}** are exported here for the *wizard*.
 *   `DietaryProfile` is the store of record for what a person cannot eat, so the controls that edit
 *   it belong beside it and the other surfaces import them. J1 does not modify the 22-step wizard —
 *   see the TODO on `AllergyPicker` for what the pre-fill wave does with them.
 * * **The pure modules** (`./dietary.ts`, `./consents.ts`, `./phone.ts`) carry every rule worth
 *   testing without a rendered tree, which is the same split `features/commerce` uses.
 * * **No repositories, and no contract types.** The account and verification contracts are members
 *   of the `Repositories` bundle, so a consumer reaches them through `data/account-hooks.ts` and
 *   takes their types from `@healthy360/api-client/contracts` directly. This module re-exporting
 *   them would put a second name on one contract and invite a screen to import the feature when
 *   what it wanted was the package.
 */

export { AllergyPicker } from './allergy-picker.tsx';
export type { AllergyPickerProps } from './allergy-picker.tsx';
export { DietaryTagsPicker } from './dietary-tags-picker.tsx';
export type { DietaryTagsPickerProps } from './dietary-tags-picker.tsx';

export { PhoneChallenge } from './phone-challenge.tsx';
export type { PhoneChallengeProps } from './phone-challenge.tsx';

export {
    ALLERGEN_SEVERITIES,
    declarationsFor,
    hasAnsweredAllergyQuestion,
    initialAllergyAnswer,
    isHardExclusion,
} from './dietary.ts';

export {
    AGE_CONFIRMATION_KEY,
    CONSENT_STATUSES,
    ageConfirmed,
    consentStatus,
    listableConsents,
    outstandingRequired,
} from './consents.ts';
export type { ConsentStatus } from './consents.ts';

export {
    DEFAULT_DIALING_CODE,
    DIALING_CODES,
    PHONE_ERROR_KEYS,
    nationalDigits,
    toE164,
    validatePhone,
    withoutTrunkPrefix,
} from './phone.ts';
export type { DialingCode, PhoneErrorKey } from './phone.ts';

export {
    AccountScreen,
    AddressEditorScreen,
    AddressesScreen,
    AllergiesScreen,
    ConsentsScreen,
    NEW_ADDRESS_PARAM,
    PhoneScreen,
    VerifyPhoneScreen,
} from './screens/index.ts';
export type { AddressEditorScreenProps, VerifyPhoneScreenProps } from './screens/index.ts';
