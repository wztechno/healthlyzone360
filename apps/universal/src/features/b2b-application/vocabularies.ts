import {
    B2B_BUSINESS_TYPES,
    B2B_DELIVERY_WINDOWS,
    B2B_ORDER_FREQUENCIES,
    B2B_PAYMENT_TERMS,
    B2B_PRODUCT_CATEGORIES,
    B2B_VOLUME_BANDS,
} from '@healthy360/api-client/contracts';
import type { B2BDocumentKind } from '@healthy360/api-client/contracts';

/**
 * The closed lists the wizard's selects draw from, gathered under the names its field table uses.
 *
 * The arrays themselves are the contract's. This module mirrored them by hand for as long as
 * `b2b-application.ts` was a standalone contract the application could not import from, and the
 * mirrors are gone rather than kept: a select whose options are a private copy is a select free to
 * offer a value the server has since retired, and that failure lands on the applicant as a rejected
 * save with nothing on screen to explain it.
 *
 * What stays here is the **grouping and its names**. `businessTypes`, `paymentTerms` and the rest
 * are what the step definitions and the translation stems (`b2bApplication:businessTypes.<value>`)
 * are written against, and a field table should not have to know that the business-type list is
 * spelled `B2B_BUSINESS_TYPES` upstream.
 *
 * The **order is the display order**, and it is not alphabetical: a person picking a business type
 * is far more likely to be a restaurant than a gym, and a list sorted by likelihood is a list where
 * most people stop at the top. That order is the contract's own, from sheet-4 — which is the second
 * reason to take the arrays rather than re-type them.
 */
export const VOCABULARIES = {
    businessTypes: B2B_BUSINESS_TYPES,
    paymentTerms: B2B_PAYMENT_TERMS,
    volumeBands: B2B_VOLUME_BANDS,
    orderFrequencies: B2B_ORDER_FREQUENCIES,
    productCategories: B2B_PRODUCT_CATEGORIES,
    deliveryWindows: B2B_DELIVERY_WINDOWS,
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
