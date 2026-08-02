/**
 * The account area, as one lazily-loaded chunk.
 *
 * Every route under `/customer/account` (and `/verify-phone`) imports *this* barrel rather than its
 * own screen module, so Metro emits one chunk for the whole area — see `shell/lazy-screen.tsx` for
 * why one chunk per area beats one per screen. A person moving from the checklist to their
 * addresses to the editor pays one fetch instead of three on the critical path of a tap.
 */
export { AccountScreen } from './account-screen.tsx';
export { AddressEditorScreen, NEW_ADDRESS_PARAM } from './address-editor-screen.tsx';
export type { AddressEditorScreenProps } from './address-editor-screen.tsx';
export { AddressesScreen } from './addresses-screen.tsx';
export { AllergiesScreen } from './allergies-screen.tsx';
export { ConsentsScreen } from './consents-screen.tsx';
export { PhoneScreen } from './phone-screen.tsx';
export { VerifyPhoneScreen } from './verify-phone-screen.tsx';
export type { VerifyPhoneScreenProps } from './verify-phone-screen.tsx';
