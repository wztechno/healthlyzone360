import { resources } from '@healthy360/i18n';
import pseudoCommerce from '@healthy360/i18n/catalogues/en-XA/commerce.json';
import pseudoErrors from '@healthy360/i18n/catalogues/en-XA/errors.json';
import pseudoKitchen from '@healthy360/i18n/catalogues/en-XA/kitchen.json';

import {
    CHECKOUT_ITEM_NOT_ASSESSED,
    CHECKOUT_TIMING_WARNINGS,
    displayableWarnings,
    isCriticalWarning,
    isKnownWarning,
    warningMessageKey,
} from './warnings.ts';

/** The refusal each new server rule sends, as `order.placement_refused` reasons and quote refusals. */
const NEW_REFUSALS = [
    'kitchen_closed',
    'window_ended',
    'lead_time_not_met',
    'below_zone_minimum',
    'item_unavailable_on_date',
    'item_not_assessed',
] as const;

type Catalogue = Record<string, Record<string, unknown>>;

/** `en-XA` is a development locale, so it is read from its files rather than `resources`. */
const BUNDLES = {
    en: resources.en,
    ar: resources.ar,
    'en-XA': { commerce: pseudoCommerce, errors: pseudoErrors, kitchen: pseudoKitchen },
};

function copyAt(bundle: unknown, section: string, key: string): unknown {
    return (bundle as Catalogue)[section]?.[key];
}

describe.each(['en', 'ar', 'en-XA'] as const)('impossible orders are worded in %s', (locale) => {
    const bundle = BUNDLES[locale];

    it.each(CHECKOUT_TIMING_WARNINGS)('warns about %s at checkout', (code) => {
        expect(isKnownWarning(code)).toBe(true);
        expect(isCriticalWarning(code)).toBe(false);
        expect(displayableWarnings([code])).toEqual([code]);

        const key = warningMessageKey(code).replace('commerce:warnings.', '');
        expect(copyAt(bundle.commerce, 'warnings', key)).toEqual(expect.any(String));
    });

    it('warns about a dish nobody has assessed at checkout', () => {
        expect(isKnownWarning(CHECKOUT_ITEM_NOT_ASSESSED)).toBe(true);
        expect(isCriticalWarning(CHECKOUT_ITEM_NOT_ASSESSED)).toBe(false);

        const key = warningMessageKey(CHECKOUT_ITEM_NOT_ASSESSED).replace('commerce:warnings.', '');
        expect(copyAt(bundle.commerce, 'warnings', key)).toEqual(expect.any(String));
    });

    it.each(NEW_REFUSALS)('refuses %s at checkout', (reason) => {
        expect(copyAt(bundle.errors, 'orderRefusal', reason)).toEqual(expect.any(String));
    });

    it.each([...NEW_REFUSALS, 'closed'])('refuses %s at the desk', (reason) => {
        const desk = (bundle.kitchen as Catalogue)['desk'];
        expect(copyAt(desk, 'refusal', reason)).toEqual(expect.any(String));
    });
});

describe('the Arabic copy', () => {
    it.each(NEW_REFUSALS)('is Arabic for %s, not English', (reason) => {
        const copy = copyAt(resources.ar.errors, 'orderRefusal', reason);
        expect(copy).toMatch(/[؀-ۿ]/);
        expect(copy).not.toEqual(copyAt(resources.en.errors, 'orderRefusal', reason));
    });
});
