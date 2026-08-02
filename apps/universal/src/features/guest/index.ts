/**
 * The guest journey (plan Phase G1) — ordering without an account, and leaving without one.
 *
 * Three screens over one contract: a four-step checkout, an order confirmation that carries the
 * conversion offer, and a **public** erasure page that is deliberately not behind the guest token.
 *
 * ## What is deliberately exported, and to whom
 *
 * * **The screens** through `./screens/index.ts`, so the routes share one chunk.
 * * **{@link GuestContactForm} and {@link ConversionPrompt}** here, because both are mounted from
 *   more than one place — the prompt will also appear on the order-lookup page a later slice adds.
 * * **`./contact.ts`** carries every rule worth testing without a rendered tree, which is the same
 *   split `features/commerce` and `features/account` use.
 * * **`./repositories-shim.ts` is not exported.** It is temporary scaffolding the integrator wave
 *   deletes, and nothing outside `data/guest-hooks.ts` should learn to depend on it.
 */

export { GuestContactForm } from './guest-contact-form.tsx';
export type { GuestContactFormProps } from './guest-contact-form.tsx';

export { GuestChallenge } from './guest-challenge.tsx';
export type { GuestChallengeProps } from './guest-challenge.tsx';

export { ConversionPrompt } from './conversion-prompt.tsx';
export type { ConversionPromptProps } from './conversion-prompt.tsx';

export {
    EMPTY_GUEST_CONTACT,
    GUEST_CONTACT_CHANNELS,
    GUEST_CONTACT_FIELDS,
    availableChannels,
    isGuestContactComplete,
    makeGuestContactSchema,
    resolveChannel,
    toContactRequest,
    validateGuestContact,
} from './contact.ts';
export type {
    GuestContactChannel,
    GuestContactErrors,
    GuestContactField,
    GuestContactValues,
} from './contact.ts';

export { GuestCheckoutScreen, GuestDeletionScreen, GuestOrderScreen } from './screens/index.ts';
export type { GuestOrderScreenProps } from './screens/index.ts';
