import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';

/**
 * What a customer reads for a consent, by its key (BUG-11).
 *
 * The server sends a consent's `code` and `purpose` and no wording, so the screens used to print
 * `platform_terms` as the title. Each known consent gets one plain first-person line here. Display
 * only: the key, the order and every rule about it stay what the data says.
 *
 * Keys arrive as `consent.terms` from the API and as the bare purpose (`platform_terms`) where the
 * wire carries that instead, so both spellings are listed.
 */
const LABELS: Readonly<Record<string, string>> = {
    terms: 'account:consents.items.terms',
    platform_terms: 'account:consents.items.terms',
    terms_of_service: 'account:consents.items.terms',
    privacy: 'account:consents.items.privacy',
    privacy_notice: 'account:consents.items.privacy',
    health_data_processing: 'account:consents.items.healthData',
    age_confirmation: 'account:consents.items.age',
    allergen_declaration_accuracy: 'account:consents.items.allergenAccuracy',
    marketing_email: 'account:consents.items.marketingEmail',
    marketing_whatsapp: 'account:consents.items.marketingWhatsapp',
};

const PREFIX = 'consent.';

/** The catalogue key for a consent, or `null` for one the app has no wording for. */
export function consentLabelKey(key: string): string | null {
    const bare = key.startsWith(PREFIX) ? key.slice(PREFIX.length) : key;
    return LABELS[bare] ?? null;
}

/** `marketing_sms` → `Marketing sms`: never the raw code, even for a consent added later. */
export function humaniseConsentKey(key: string): string {
    const bare = key.startsWith(PREFIX) ? key.slice(PREFIX.length) : key;
    const spaced = bare.replace(/[._-]+/g, ' ').trim();
    return spaced === '' ? key : spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

/** The label to show for a consent key. */
export function useConsentLabel(): (key: string) => string {
    const { t } = useTranslation();
    return useCallback(
        (key: string) => {
            const labelKey = consentLabelKey(key);
            return labelKey === null ? humaniseConsentKey(key) : t(labelKey);
        },
        [t],
    );
}
