import { describe, expect, it } from 'vitest';

import { createI18n } from './config.ts';

/**
 * Arabic has six CLDR plural categories. i18next 26 resolves them through `Intl.PluralRules`, so
 * these assertions are really checking two things at once: that the catalogue supplies every form,
 * and that the i18next configuration has not silently fallen back to English's two-form model.
 */
describe('Arabic plurals', () => {
    const i18n = createI18n({ locale: 'ar', react: false });

    it('exposes all six CLDR categories for Arabic', () => {
        expect(new Intl.PluralRules('ar').resolvedOptions().pluralCategories.sort()).toEqual([
            'few',
            'many',
            'one',
            'other',
            'two',
            'zero',
        ]);
    });

    it.each([
        [0, 'zero', 'ليس لديك إشعارات غير مقروءة'],
        [1, 'one', 'لديك إشعار واحد غير مقروء'],
        [2, 'two', 'لديك إشعاران غير مقروءين'],
        [3, 'few', 'لديك 3 إشعارات غير مقروءة'],
        [10, 'few', 'لديك 10 إشعارات غير مقروءة'],
        [11, 'many', 'لديك 11 إشعارًا غير مقروء'],
        [99, 'many', 'لديك 99 إشعارًا غير مقروء'],
        [100, 'other', 'لديك 100 إشعار غير مقروء'],
    ])('count=%i selects the %s form', (count, category, expected) => {
        expect(new Intl.PluralRules('ar').select(count)).toBe(category);
        expect(i18n.t('notifications.count', { count })).toBe(expected);
    });

    it('resolves ar-SA to the ar catalogue rather than falling back to English', () => {
        const regional = createI18n({ locale: 'ar-SA', react: false });
        expect(regional.resolvedLanguage).toBe('ar');
        expect(regional.t('notifications.count', { count: 2 })).toBe('لديك إشعاران غير مقروءين');
    });

    it('pluralises the branch count in the organisation picker', () => {
        expect(i18n.t('auth:organisationPicker.branchCount', { count: 1 })).toBe('فرع واحد');
        expect(i18n.t('auth:organisationPicker.branchCount', { count: 2 })).toBe('فرعان');
        expect(i18n.t('auth:organisationPicker.branchCount', { count: 5 })).toBe('5 فروع');
    });
});

describe('English plurals', () => {
    const i18n = createI18n({ locale: 'en', react: false });

    it('uses the two-form model', () => {
        expect(new Intl.PluralRules('en').resolvedOptions().pluralCategories.sort()).toEqual([
            'one',
            'other',
        ]);
        expect(i18n.t('notifications.count', { count: 1 })).toBe(
            'You have one unread notification',
        );
        expect(i18n.t('notifications.count', { count: 0 })).toBe('You have 0 unread notifications');
        expect(i18n.t('notifications.count', { count: 7 })).toBe('You have 7 unread notifications');
    });
});

describe('interpolation', () => {
    it('does not HTML-escape values — React and React Native escape on render', () => {
        const i18n = createI18n({ locale: 'en', react: false });
        expect(i18n.t('auth:verifyEmail.body', { email: 'a&b@example.com' })).toContain(
            'a&b@example.com',
        );
    });

    it('renders Arabic copy with its own punctuation intact', () => {
        const i18n = createI18n({ locale: 'ar', react: false });
        expect(i18n.t('auth:login.forgotLink')).toBe('هل نسيت كلمة المرور؟');
    });
});
