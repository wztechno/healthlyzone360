import { LOCALES } from '@healthy360/domain-types';
import { describe, expect, it } from 'vitest';

import { TRANSLATION_KEYS, isTranslationKey } from './keys.generated.ts';
import type { TranslationKey } from './keys.generated.ts';
import { DEFAULT_NAMESPACE, TRANSLATION_NAMESPACES, resources } from './resources.ts';

const PLURAL_SUFFIX = /_(zero|one|two|few|many|other)$/;

function flatten(
    value: unknown,
    prefix = '',
    out = new Map<string, string>(),
): Map<string, string> {
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
        const path = prefix === '' ? key : `${prefix}.${key}`;
        if (child !== null && typeof child === 'object' && !Array.isArray(child)) {
            flatten(child, path, out);
        } else {
            out.set(path, String(child));
        }
    }
    return out;
}

function baseKeys(bundleNamespace: unknown): Set<string> {
    return new Set(
        [...flatten(bundleNamespace).keys()].map((key) => key.replace(PLURAL_SUFFIX, '')),
    );
}

function placeholders(value: string): string[] {
    return [
        ...new Set([...value.matchAll(/\{\{\s*([\w.-]+)\s*(?:,[^}]*)?\}\}/g)].map((m) => m[1]!)),
    ].sort();
}

describe('catalogue structure', () => {
    it('ships every declared namespace for every locale', () => {
        expect([...TRANSLATION_NAMESPACES]).toEqual([
            'common',
            'auth',
            'access',
            'errors',
            'designSystem',
            'marketplace',
            'catalogue',
            'onboarding',
            'nutrition',
            'planner',
            'commerce',
            'virtualDietitian',
            'professional',
            'business',
        ]);
        expect(DEFAULT_NAMESPACE).toBe('common');
        for (const locale of LOCALES) {
            expect(Object.keys(resources[locale]).sort()).toEqual(
                [...TRANSLATION_NAMESPACES].sort(),
            );
        }
    });

    it('contains no empty strings', () => {
        for (const locale of LOCALES) {
            for (const namespace of TRANSLATION_NAMESPACES) {
                for (const [key, value] of flatten(resources[locale][namespace])) {
                    expect(value.trim(), `${locale}/${namespace}:${key}`).not.toBe('');
                }
            }
        }
    });
});

describe('en ↔ ar key parity', () => {
    it.each(TRANSLATION_NAMESPACES)('%s has the same base keys in both locales', (namespace) => {
        const english = [...baseKeys(resources.en[namespace])].sort();
        const arabic = [...baseKeys(resources.ar[namespace])].sort();

        const missingInArabic = english.filter((key) => !arabic.includes(key));
        const extraInArabic = arabic.filter((key) => !english.includes(key));

        expect(missingInArabic, `missing from ar/${namespace}`).toEqual([]);
        expect(extraInArabic, `unknown keys in ar/${namespace}`).toEqual([]);
    });

    it.each(TRANSLATION_NAMESPACES)('%s interpolates the same placeholders', (namespace) => {
        const english = flatten(resources.en[namespace]);
        const arabic = flatten(resources.ar[namespace]);

        const byBase = (source: Map<string, string>) => {
            const grouped = new Map<string, Set<string>>();
            for (const [key, value] of source) {
                const base = key.replace(PLURAL_SUFFIX, '');
                const set = grouped.get(base) ?? new Set<string>();
                for (const name of placeholders(value)) set.add(name);
                grouped.set(base, set);
            }
            return grouped;
        };

        const englishGroups = byBase(english);
        const arabicGroups = byBase(arabic);

        for (const [base, expected] of englishGroups) {
            const actual = arabicGroups.get(base) ?? new Set<string>();
            expect([...actual].sort(), `${namespace}:${base}`).toEqual([...expected].sort());
        }
    });
});

describe('Arabic plural coverage', () => {
    it('supplies every CLDR category Arabic requires for each plural key', () => {
        const required = new Intl.PluralRules('ar').resolvedOptions().pluralCategories;

        for (const namespace of TRANSLATION_NAMESPACES) {
            const flat = flatten(resources.ar[namespace]);
            const pluralBases = new Map<string, Set<string>>();
            for (const key of flat.keys()) {
                const match = PLURAL_SUFFIX.exec(key);
                if (match === null) continue;
                const base = key.replace(PLURAL_SUFFIX, '');
                const set = pluralBases.get(base) ?? new Set<string>();
                set.add(match[1]!);
                pluralBases.set(base, set);
            }

            for (const [base, categories] of pluralBases) {
                for (const category of required) {
                    expect(
                        categories.has(category),
                        `ar/${namespace}:${base} is missing _${category}`,
                    ).toBe(true);
                }
            }
        }
    });
});

describe('generated key union', () => {
    it('is in sync with the English catalogue', () => {
        const expected = TRANSLATION_NAMESPACES.flatMap((namespace) =>
            [...baseKeys(resources.en[namespace])].map((key) => `${namespace}:${key}`),
        ).sort();

        expect([...TRANSLATION_KEYS].sort()).toEqual(expected);
    });

    it('recognises real keys and rejects invented ones', () => {
        expect(isTranslationKey('auth:login.title')).toBe(true);
        expect(isTranslationKey('access:denial.mode_excluded.title')).toBe(true);
        expect(isTranslationKey('auth:login.doesNotExist')).toBe(false);
        expect(isTranslationKey('login.title')).toBe(false);
        expect(isTranslationKey(42)).toBe(false);
    });

    it('collapses plural variants to their base key', () => {
        expect(isTranslationKey('common:notifications.count')).toBe(true);
        expect(isTranslationKey('common:notifications.count_other')).toBe(false);
    });

    it('types keys as literals rather than plain strings', () => {
        const key: TranslationKey = 'errors:validation.required';
        expect(TRANSLATION_KEYS).toContain(key);
        // @ts-expect-error not a declared key
        const invalid: TranslationKey = 'errors:validation.made_up';
        expect(isTranslationKey(invalid)).toBe(false);
    });
});

describe('validation message keys used by @healthy360/validation', () => {
    it.each([
        'errors:validation.required',
        'errors:validation.email',
        'errors:validation.min_length',
        'errors:validation.max_length',
        'errors:validation.password_min_length',
        'errors:validation.password_mismatch',
        'errors:validation.accept_terms',
        'errors:validation.accept_privacy',
        'errors:validation.identifier',
    ])('%s exists in both locales', (key) => {
        expect(isTranslationKey(key)).toBe(true);
    });
});

describe('gate denial keys used by @healthy360/permissions', () => {
    it.each([
        'mode_excluded',
        'unauthenticated',
        'email_unverified',
        'no_organisation_context',
        'no_branch_context',
        'entitlement_missing',
        'permission_missing',
    ])('access:denial.%s has a title and body in both locales', (reason) => {
        expect(isTranslationKey(`access:denial.${reason}.title`)).toBe(true);
        expect(isTranslationKey(`access:denial.${reason}.body`)).toBe(true);
    });
});
