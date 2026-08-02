import type { ConsentState } from './repositories-shim.ts';

/**
 * Consent presentation rules, as functions.
 *
 * The consent screen's whole difficulty is that "not agreed" is four different situations, and
 * telling a person the wrong one is a compliance problem rather than a cosmetic one. Working that
 * out inside JSX would bury it; here it is one function with the reasoning attached.
 */

/** The consent whose absence blocks every other agreement on the screen. */
export const AGE_CONFIRMATION_KEY = 'age_confirmation';

export const CONSENT_STATUSES = ['granted', 'reconsent', 'withdrawn', 'never'] as const;
export type ConsentStatus = (typeof CONSENT_STATUSES)[number];

/**
 * Which of the four a consent is in.
 *
 * The interesting one is `reconsent`. `ConsentState` carries no `grantedVersion`, so the client
 * cannot compare "which version did they agree to" against `definition.version` directly — but it
 * does not need to. When the server publishes a new version it clears `granted` while leaving
 * `grantedAt` in place and setting no `withdrawnAt`, because nobody withdrew anything: the text
 * changed. That combination — *agreed once, not agreed now, never withdrew* — is re-consent, and it
 * is distinguishable from both a person who withdrew and a person who never agreed.
 *
 * Telling those three apart matters. "You withdrew this" accuses somebody of a decision they did
 * not make; "you have never agreed to this" is false and makes a returning customer feel like a
 * stranger; and neither explains why an account that worked yesterday is now blocked.
 *
 * **Contract gap.** The derivation is sound but indirect. A `grantedVersion` on `ConsentState`
 * would let the screen say *which* version was agreed and what changed, which is what a person
 * actually wants to know before agreeing again. Recorded rather than worked around further.
 */
export function consentStatus(consent: ConsentState): ConsentStatus {
    if (consent.granted) return 'granted';
    if (consent.grantedAt === null) return 'never';
    return consent.withdrawnAt === null ? 'reconsent' : 'withdrawn';
}

/** Required consents that are not currently agreed — what stands between an account and activation. */
export function outstandingRequired(consents: readonly ConsentState[]): readonly ConsentState[] {
    return consents.filter((consent) => consent.definition.required && !consent.granted);
}

/**
 * Whether the age confirmation is in place.
 *
 * Read rather than assumed, and read by key: it is the one consent that gates the others, so the
 * screen needs to know its state before it can decide what the rest of the page may do.
 */
export function ageConfirmed(consents: readonly ConsentState[]): boolean {
    return consents.some(
        (consent) => consent.definition.key === AGE_CONFIRMATION_KEY && consent.granted,
    );
}

/**
 * Consents shown in the main list — everything except the age confirmation.
 *
 * The age confirmation is drawn separately, above, as a single blocking checkbox. Leaving it in the
 * list as one row among seven would make a legally load-bearing gate look like a preference.
 */
export function listableConsents(consents: readonly ConsentState[]): readonly ConsentState[] {
    return consents.filter((consent) => consent.definition.key !== AGE_CONFIRMATION_KEY);
}
