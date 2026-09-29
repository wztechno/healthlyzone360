import {
    TYPEFACE_ROLES,
    typefaceKey,
    typefacePackage,
    typefaceWeightPath,
    typefaces,
} from '../typography.ts';
import type { FontWeightValue } from '../typography.ts';
import { GENERATED_BANNER } from './shared.ts';

/** One file the app loads: which family it is, at which weight, under which loader key. */
export interface FontFaceEntry {
    readonly family: string;
    readonly weight: FontWeightValue;
    readonly key: string;
    /** The package subpath the file is imported from — `'@expo-google-fonts/inter/400Regular'`. */
    readonly module: string;
}

/** Every face {@link typefaces} declares, each once, in declaration order. */
export function fontFaceEntries(): readonly FontFaceEntry[] {
    const seen = new Set<string>();
    const entries: FontFaceEntry[] = [];
    for (const role of TYPEFACE_ROLES) {
        const typeface = typefaces[role];
        for (const weight of typeface.weights) {
            const key = typefaceKey(typeface, weight);
            if (seen.has(key)) continue;
            seen.add(key);
            entries.push({
                family: typeface.family,
                weight,
                key,
                module: `${typefacePackage(typeface)}/${typefaceWeightPath(weight)}`,
            });
        }
    }
    return entries;
}

/**
 * Emits `fonts.ts`: the font files, as static imports the bundler can see, derived from
 * {@link typefaces}.
 *
 * Generated rather than hand-written because a bundler needs a literal `import` per file, and a
 * hand-kept list is a second place a font has to be changed — which is exactly the drift this
 * package exists to prevent. Imported by subpath (`…/400Regular`), never from a package root: a root
 * barrel re-exports every weight and italic, and the bundler would ship all of them.
 */
export function renderFontManifest(): string {
    const entries = fontFaceEntries();
    const imports = entries.map((entry) => `import { ${entry.key} } from '${entry.module}';`);
    const rows = entries.map(
        (entry) =>
            `    { family: '${entry.family}', weight: '${entry.weight}', key: '${entry.key}', source: ${entry.key} },`,
    );

    return `${GENERATED_BANNER}

${imports.join('\n')}

export interface BundledFontFace {
    /** The CSS family name the web registers the file under. */
    readonly family: string;
    /** The CSS weight it is registered at. */
    readonly weight: string;
    /** The expo-font key React Native addresses it by. */
    readonly key: string;
    /** The bundled font file. */
    readonly source: number;
}

export const fontFaces: readonly BundledFontFace[] = [
${rows.join('\n')}
];
`;
}
