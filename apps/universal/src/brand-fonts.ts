import { fontFaces } from '@healthy360/design-tokens/fonts';
import { Asset } from 'expo-asset';
import { useFonts } from 'expo-font';
import { useEffect } from 'react';
import { Platform } from 'react-native';

const NATIVE_FONTS: Record<string, number> = Object.fromEntries(
    fontFaces.map((face) => [face.key, face.source]),
);

/** Once per document: strict mode runs effects twice, and a second set of faces is pure waste. */
let registered = false;

function registerWebFontFaces(): void {
    if (registered || typeof document === 'undefined' || typeof FontFace === 'undefined') return;
    registered = true;
    for (const face of fontFaces) {
        const url = Asset.fromModule(face.source).uri;
        // Added, not loaded: the browser fetches a cut the first time text asks for it, so a
        // weight no screen uses costs nothing.
        document.fonts.add(
            new FontFace(face.family, `url(${JSON.stringify(url)})`, {
                weight: face.weight,
                style: 'normal',
                display: 'swap',
            }),
        );
    }
}

/**
 * Loads the product's typefaces from the manifest `pnpm build:tokens` generates out of `typefaces`
 * in `packages/design-tokens/src/typography.ts`. Nothing here names a font: change the typeface
 * there and this follows.
 *
 * ## Why the web does not go through `useFonts`
 *
 * expo-font registers each file as a family of its own, named by its loader key —
 * `@font-face { font-family: Inter_700Bold }`, with no weight. React Native needs exactly that: it
 * addresses one file per family name. The web's stylesheets ask for `'Inter'` at a weight, which no
 * such face answers, so the browser fell back to the system font on every screen. On the web each
 * file is registered instead under its real family name at its real weight, and `font-weight` picks
 * the cut the way CSS intends.
 *
 * Nothing gates first paint on a download — one frame of the fallback face beats a blank screen,
 * and the line heights come from tokens, so the layout does not jump when the family arrives.
 */
export function useBrandFonts(): void {
    useFonts(Platform.OS === 'web' ? {} : NATIVE_FONTS);

    useEffect(() => {
        if (Platform.OS === 'web') registerWebFontFaces();
    }, []);
}
