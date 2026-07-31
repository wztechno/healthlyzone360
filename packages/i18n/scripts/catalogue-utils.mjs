/**
 * Shared helpers for the catalogue scripts.
 *
 * These deliberately read the JSON files straight off disk instead of importing the TypeScript
 * resource module: the scripts must keep working when the source does not compile, which is exactly
 * when a translator or a CI failure needs them most.
 */
import { readdir, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const PACKAGE_ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
export const CATALOGUES_DIR = join(PACKAGE_ROOT, 'catalogues');

export const REFERENCE_LOCALE = 'en';
export const PSEUDO_LOCALE = 'en-XA';

/** CLDR plural categories i18next appends to a key. */
export const PLURAL_SUFFIXES = ['zero', 'one', 'two', 'few', 'many', 'other'];

const PLURAL_SUFFIX_PATTERN = new RegExp(`_(${PLURAL_SUFFIXES.join('|')})$`);

export function stripPluralSuffix(key) {
    return key.replace(PLURAL_SUFFIX_PATTERN, '');
}

export function pluralSuffixOf(key) {
    const match = PLURAL_SUFFIX_PATTERN.exec(key);
    return match === null ? null : match[1];
}

export async function listNamespaces(locale = REFERENCE_LOCALE) {
    const entries = await readdir(join(CATALOGUES_DIR, locale));
    return entries
        .filter((name) => name.endsWith('.json'))
        .map((name) => name.replace(/\.json$/, ''))
        .sort();
}

export async function listLocales() {
    const entries = await readdir(CATALOGUES_DIR, { withFileTypes: true });
    return entries
        .filter((entry) => entry.isDirectory())
        .map((entry) => entry.name)
        .sort();
}

export async function readCatalogue(locale, namespace) {
    const raw = await readFile(join(CATALOGUES_DIR, locale, `${namespace}.json`), 'utf8');
    return JSON.parse(raw);
}

/** Flattens nested catalogue objects into `a.b.c` → string entries. */
export function flatten(value, prefix = '', out = new Map()) {
    for (const [key, child] of Object.entries(value)) {
        const path = prefix === '' ? key : `${prefix}.${key}`;
        if (child !== null && typeof child === 'object' && !Array.isArray(child)) {
            flatten(child, path, out);
        } else {
            out.set(path, String(child));
        }
    }
    return out;
}

/** `{{name}}` placeholders present in a string, sorted and de-duplicated. */
export function placeholdersIn(value) {
    const found = new Set();
    for (const match of value.matchAll(/\{\{\s*([\w.-]+)\s*(?:,[^}]*)?\}\}/g)) {
        found.add(match[1]);
    }
    return [...found].sort();
}

/** The plural categories a language actually requires, straight from CLDR via Intl. */
export function requiredPluralCategories(locale) {
    return new Set(new Intl.PluralRules(locale).resolvedOptions().pluralCategories);
}
