import type { B2BDocumentKind } from './repositories-shim.ts';

/**
 * The closed lists the wizard's selects draw from.
 *
 * Mirrors of the contract's `as const` arrays rather than imports of them, for the same reason
 * `repositories-shim.ts` restates the types: `@healthy360/api-client/contracts` does not re-export
 * `b2b-application.ts` while the contract is unregistered. The integrator wave replaces this file
 * with the imports and nothing at any call site changes — the values are identical and the key
 * stems (`b2bApplication:businessTypes.<value>`) are derived from them.
 *
 * The **order is the display order**, and it is not alphabetical: a person picking a business type
 * is far more likely to be a restaurant than a gym, and a list sorted by likelihood is a list where
 * most people stop at the top. The vocabulary's own order comes from sheet-4.
 */
export const VOCABULARIES = {
    businessTypes: [
        'restaurant',
        'cafe',
        'hotel',
        'catering',
        'retail',
        'corporate_office',
        'school',
        'hospital',
        'gym',
        'other',
    ],
    paymentTerms: ['prepaid', 'net_15', 'net_30', 'net_60'],
    volumeBands: ['under_50', 'from_50_to_200', 'from_200_to_500', 'from_500_to_2000', 'over_2000'],
    orderFrequencies: ['daily', 'weekdays', 'weekly', 'fortnightly', 'monthly', 'ad_hoc'],
    productCategories: [
        'meals',
        'meal_plans',
        'bulk_catering',
        'snacks',
        'beverages',
        'ingredients',
    ],
    deliveryWindows: ['early_morning', 'morning', 'afternoon', 'evening'],
} as const satisfies Readonly<Record<string, readonly string[]>>;

export type VocabularyName = keyof typeof VOCABULARIES;

/**
 * Kinds an applicant may upload that the server does not require.
 *
 * Offered rather than demanded: a reviewer asks for insurance or food safety through the
 * information-request loop when a case calls for it, and demanding all eight up front would turn a
 * ten-minute form into a fortnight and produce worse documents rather than more (the backend's
 * `DocumentKind::requiredForB2bSubmission` says the same thing from the other side).
 *
 * `signed_agreement` is absent on purpose: it is produced by the signing flow, and accepting one
 * from a client would let an applicant supply their own idea of what they signed.
 */
export const OPTIONAL_DOCUMENT_KINDS: readonly B2BDocumentKind[] = [
    'trade_licence',
    'tax_certificate',
    'authorisation_letter',
    'proof_of_address',
    'food_safety_certificate',
    'insurance_certificate',
    'other',
];
