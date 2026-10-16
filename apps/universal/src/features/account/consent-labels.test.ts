import { consentLabelKey, humaniseConsentKey } from './consent-labels.ts';

describe('consent labels', () => {
    it('finds the wording for the API key and for the bare purpose alike', () => {
        expect(consentLabelKey('consent.terms')).toBe('account:consents.items.terms');
        expect(consentLabelKey('platform_terms')).toBe('account:consents.items.terms');
        expect(consentLabelKey('consent.health_data_processing')).toBe(
            'account:consents.items.healthData',
        );
    });

    it('never shows a raw code for a consent it has no wording for', () => {
        expect(consentLabelKey('consent.marketing_sms')).toBeNull();
        expect(humaniseConsentKey('consent.marketing_sms')).toBe('Marketing sms');
        expect(humaniseConsentKey('marketing_updates')).toBe('Marketing updates');
    });
});
