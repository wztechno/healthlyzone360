#!/usr/bin/env node
/**
 * Catalogue parity check (`pnpm i18n:check`).
 *
 * Fails when a translated locale disagrees with English on:
 *   1. which keys exist (plural variants compared by base key, since CLDR categories differ);
 *   2. which `{{placeholders}}` a string interpolates — a dropped placeholder is a silent bug;
 *   3. the CLDR plural categories the language requires (Arabic needs all six).
 *
 * It also warns about empty strings and about English text left verbatim in a translated locale,
 * which is the usual signature of an untranslated key.
 */
import {
    PSEUDO_LOCALE,
    REFERENCE_LOCALE,
    flatten,
    listLocales,
    listNamespaces,
    placeholdersIn,
    pluralSuffixOf,
    readCatalogue,
    requiredPluralCategories,
    stripPluralSuffix,
} from './catalogue-utils.mjs';

const errors = [];
const warnings = [];

const namespaces = await listNamespaces(REFERENCE_LOCALE);
const locales = (await listLocales()).filter(
    (locale) => locale !== REFERENCE_LOCALE && locale !== PSEUDO_LOCALE,
);

console.log(
    `Reference locale: ${REFERENCE_LOCALE}; namespaces: ${namespaces.join(', ')}; checking: ${
        locales.join(', ') || '(none)'
    }`,
);

/** base key -> { placeholders, suffixes } for one locale/namespace. */
function summarise(catalogue) {
    const flat = flatten(catalogue);
    const bases = new Map();
    for (const [key, value] of flat) {
        const base = stripPluralSuffix(key);
        const suffix = pluralSuffixOf(key);
        const entry = bases.get(base) ?? {
            placeholders: new Set(),
            suffixes: new Set(),
            values: [],
        };
        for (const placeholder of placeholdersIn(value)) entry.placeholders.add(placeholder);
        if (suffix !== null) entry.suffixes.add(suffix);
        entry.values.push(value);
        bases.set(base, entry);
    }
    return bases;
}

for (const namespace of namespaces) {
    const reference = summarise(await readCatalogue(REFERENCE_LOCALE, namespace));

    for (const locale of locales) {
        let target;
        try {
            target = summarise(await readCatalogue(locale, namespace));
        } catch {
            errors.push(`${locale}: missing namespace file "${namespace}.json"`);
            continue;
        }

        for (const [base, referenceEntry] of reference) {
            const entry = target.get(base);
            if (entry === undefined) {
                errors.push(`${locale}/${namespace}: missing key "${base}"`);
                continue;
            }

            const missingPlaceholders = [...referenceEntry.placeholders].filter(
                (name) => !entry.placeholders.has(name),
            );
            if (missingPlaceholders.length > 0) {
                errors.push(
                    `${locale}/${namespace}: "${base}" drops placeholder(s) ${missingPlaceholders
                        .map((name) => `{{${name}}}`)
                        .join(', ')}`,
                );
            }

            const extraPlaceholders = [...entry.placeholders].filter(
                (name) => !referenceEntry.placeholders.has(name),
            );
            if (extraPlaceholders.length > 0) {
                errors.push(
                    `${locale}/${namespace}: "${base}" introduces unknown placeholder(s) ${extraPlaceholders
                        .map((name) => `{{${name}}}`)
                        .join(', ')}`,
                );
            }

            // Plural keys must cover every category the target language requires.
            if (referenceEntry.suffixes.size > 0) {
                const required = requiredPluralCategories(locale);
                const missingCategories = [...required].filter(
                    (category) => !entry.suffixes.has(category),
                );
                if (missingCategories.length > 0) {
                    errors.push(
                        `${locale}/${namespace}: plural key "${base}" is missing CLDR categor${
                            missingCategories.length === 1 ? 'y' : 'ies'
                        } ${missingCategories.map((c) => `_${c}`).join(', ')}`,
                    );
                }
            }

            for (const value of entry.values) {
                if (value.trim().length === 0) {
                    errors.push(`${locale}/${namespace}: "${base}" is empty`);
                }
            }

            // Identical strings are legitimate for proper nouns and sample text; flag, do not fail.
            if (
                referenceEntry.values.length === entry.values.length &&
                referenceEntry.values.every((value, index) => value === entry.values[index]) &&
                /[A-Za-z]{4,}/.test(referenceEntry.values.join(' '))
            ) {
                warnings.push(
                    `${locale}/${namespace}: "${base}" is identical to ${REFERENCE_LOCALE}`,
                );
            }
        }

        for (const base of target.keys()) {
            if (!reference.has(base)) {
                errors.push(
                    `${locale}/${namespace}: unknown key "${base}" (not present in ${REFERENCE_LOCALE})`,
                );
            }
        }
    }
}

// The reference locale must itself satisfy its own plural requirements.
for (const namespace of namespaces) {
    const reference = summarise(await readCatalogue(REFERENCE_LOCALE, namespace));
    const required = requiredPluralCategories(REFERENCE_LOCALE);
    for (const [base, entry] of reference) {
        if (entry.suffixes.size === 0) continue;
        const missing = [...required].filter((category) => !entry.suffixes.has(category));
        if (missing.length > 0) {
            errors.push(
                `${REFERENCE_LOCALE}/${namespace}: plural key "${base}" is missing ${missing
                    .map((c) => `_${c}`)
                    .join(', ')}`,
            );
        }
    }
}

for (const warning of warnings) console.warn(`warn   ${warning}`);
for (const error of errors) console.error(`error  ${error}`);

if (errors.length > 0) {
    console.error(`\n${errors.length} catalogue error(s).`);
    process.exit(1);
}

console.log(`\nCatalogues are consistent (${warnings.length} warning(s)).`);
