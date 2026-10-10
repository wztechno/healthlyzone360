export { renderTokensCss } from './css.ts';
export { fontFaceEntries, renderFontManifest } from './fonts.ts';
export type { FontFaceEntry } from './fonts.ts';
export { renderTokensNative } from './native.ts';
export { renderTailwindPreset } from './tailwind-preset.ts';
export {
    CSS_VARIABLE_PREFIX,
    GENERATED_BANNER,
    kebab,
    themeColourVariables,
    toRgbTriplet,
    variableReference,
} from './shared.ts';
export type { ThemeColourVariable } from './shared.ts';

/** The committed artefacts, keyed by their path relative to the package root. */
export const GENERATED_FILES = {
    'generated/tailwind-preset.cjs': 'renderTailwindPreset',
    'generated/tokens.css': 'renderTokensCss',
    'generated/tokens.native.ts': 'renderTokensNative',
    'generated/fonts.ts': 'renderFontManifest',
} as const;
