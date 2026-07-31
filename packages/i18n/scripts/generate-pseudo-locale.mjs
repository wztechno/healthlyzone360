#!/usr/bin/env node
/**
 * Generates the `en-XA` pseudo-locale (`pnpm gen:pseudo-locale`).
 *
 * Three transformations, each catching a different class of bug:
 *   - accented substitutions surface hard-coded English and non-Unicode-safe rendering;
 *   - ~40 % expansion surfaces layouts that only fit English;
 *   - `[[ … ]]` brackets surface concatenated or truncated strings.
 *
 * `{{placeholders}}` and i18next plural suffixes are preserved exactly; a mangled placeholder would
 * make the pseudo-locale useless for the very screens it is meant to stress.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import {
    CATALOGUES_DIR,
    PSEUDO_LOCALE,
    REFERENCE_LOCALE,
    listNamespaces,
    readCatalogue,
} from './catalogue-utils.mjs';

const ACCENTS = {
    a: 'á',
    b: 'ƀ',
    c: 'ç',
    d: 'ð',
    e: 'é',
    f: 'ƒ',
    g: 'ĝ',
    h: 'ĥ',
    i: 'í',
    j: 'ĵ',
    k: 'ķ',
    l: 'ł',
    m: 'ɱ',
    n: 'ñ',
    o: 'ó',
    p: 'þ',
    q: 'ǫ',
    r: 'ŕ',
    s: 'š',
    t: 'ţ',
    u: 'ú',
    v: 'ṽ',
    w: 'ŵ',
    x: 'ẋ',
    y: 'ý',
    z: 'ž',
    A: 'Á',
    B: 'Ɓ',
    C: 'Ç',
    D: 'Ð',
    E: 'É',
    F: 'Ƒ',
    G: 'Ĝ',
    H: 'Ĥ',
    I: 'Í',
    J: 'Ĵ',
    K: 'Ķ',
    L: 'Ł',
    M: 'Ṁ',
    N: 'Ñ',
    O: 'Ó',
    P: 'Þ',
    Q: 'Ǫ',
    R: 'Ŕ',
    S: 'Š',
    T: 'Ţ',
    U: 'Ú',
    V: 'Ṽ',
    W: 'Ŵ',
    X: 'Ẋ',
    Y: 'Ý',
    Z: 'Ž',
};

/** Padding characters, cycled so the expansion is visible but deterministic. */
const PADDING = 'āēīōū';
const EXPANSION_RATIO = 0.4;

function accentuate(text) {
    let result = '';
    for (const character of text) {
        result += ACCENTS[character] ?? character;
    }
    return result;
}

function expand(text) {
    const extra = Math.ceil(text.length * EXPANSION_RATIO);
    if (extra === 0) return '';
    let padding = '';
    for (let index = 0; index < extra; index += 1) {
        padding += PADDING[index % PADDING.length];
    }
    return ` ${padding}`;
}

/** Splits on `{{…}}` so placeholders pass through untouched. */
function pseudo(value) {
    const segments = value.split(/(\{\{[^}]*\}\})/g);
    const transformed = segments
        .map((segment) => (segment.startsWith('{{') ? segment : accentuate(segment)))
        .join('');
    return `[[${transformed}${expand(value)}]]`;
}

function transform(node) {
    if (typeof node === 'string') return pseudo(node);
    if (Array.isArray(node)) return node.map(transform);
    const result = {};
    for (const [key, child] of Object.entries(node)) {
        result[key] = transform(child);
    }
    return result;
}

const outputDir = join(CATALOGUES_DIR, PSEUDO_LOCALE);
await mkdir(outputDir, { recursive: true });

const namespaces = await listNamespaces(REFERENCE_LOCALE);
for (const namespace of namespaces) {
    const source = await readCatalogue(REFERENCE_LOCALE, namespace);
    const contents = `${JSON.stringify(transform(source), null, 2)}\n`;
    await writeFile(join(outputDir, `${namespace}.json`), contents, 'utf8');
    console.log(`written    catalogues/${PSEUDO_LOCALE}/${namespace}.json`);
}

console.log(
    `\n${PSEUDO_LOCALE} regenerated from ${REFERENCE_LOCALE} (${namespaces.length} namespaces).`,
);
