export { renderTokensCss } from './css.ts';
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

/** The three committed artefacts, keyed by their path relative to the package root. */
export const GENERATED_FILES = {
    'generated/tailwind-preset.cjs': 'renderTailwindPreset',
    'generated/tokens.css': 'renderTokensCss',
    'generated/tokens.native.ts': 'renderTokensNative',
} as const;
