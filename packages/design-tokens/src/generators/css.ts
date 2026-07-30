import { ELEVATION_LEVELS, elevation } from '../elevation.ts';
import { breakpoints, focusRing, MIN_TOUCH_TARGET, radius, spacing } from '../layout.ts';
import { DURATION_NAMES, durations, easings, reducedDurations } from '../motion.ts';
import { FONT_SIZE_NAMES, fontFamilies, fontSizes, lineHeights } from '../typography.ts';
import { CSS_VARIABLE_PREFIX, GENERATED_BANNER, kebab, themeColourVariables } from './shared.ts';

function declarations(entries: ReadonlyArray<readonly [string, string]>, indent = '  '): string {
    return entries.map(([name, value]) => `${indent}${name}: ${value};`).join('\n');
}

/**
 * Emits `tokens.css`: a `:root` block with the light theme plus every theme-independent token, and
 * a `.dark` block that overrides only the colours that change.
 *
 * The dark block is emitted for the *class* strategy (`darkMode: 'class'`) and mirrored under
 * `prefers-color-scheme` so a web visitor with a dark system preference gets dark styling before
 * any JavaScript has run — the same reason `+html.tsx` sets `dir`/`lang` pre-hydration.
 */
export function renderTokensCss(): string {
    const variables = themeColourVariables();

    const lightColours = variables.map((item) => [item.name, item.values.light] as const);
    const darkColours = variables.map((item) => [item.name, item.values.dark] as const);

    const staticTokens: Array<readonly [string, string]> = [];
    for (const [step, value] of Object.entries(spacing)) {
        staticTokens.push([`${CSS_VARIABLE_PREFIX}-space-${step.replace('.', '_')}`, `${value}px`]);
    }
    for (const [name, value] of Object.entries(radius)) {
        staticTokens.push([`${CSS_VARIABLE_PREFIX}-radius-${name}`, `${value}px`]);
    }
    for (const name of FONT_SIZE_NAMES) {
        staticTokens.push([`${CSS_VARIABLE_PREFIX}-font-size-${name}`, `${fontSizes[name]}px`]);
        staticTokens.push([
            `${CSS_VARIABLE_PREFIX}-line-height-latin-${name}`,
            `${lineHeights.latin[name]}px`,
        ]);
        staticTokens.push([
            `${CSS_VARIABLE_PREFIX}-line-height-arabic-${name}`,
            `${lineHeights.arabic[name]}px`,
        ]);
    }
    staticTokens.push([`${CSS_VARIABLE_PREFIX}-font-family-latin`, fontFamilies.latin.stack]);
    staticTokens.push([`${CSS_VARIABLE_PREFIX}-font-family-arabic`, fontFamilies.arabic.stack]);
    for (const level of ELEVATION_LEVELS) {
        staticTokens.push([`${CSS_VARIABLE_PREFIX}-elevation-${level}`, elevation[level].web]);
    }
    for (const name of DURATION_NAMES) {
        staticTokens.push([`${CSS_VARIABLE_PREFIX}-duration-${name}`, `${durations[name]}ms`]);
    }
    for (const [name, token] of Object.entries(easings)) {
        staticTokens.push([`${CSS_VARIABLE_PREFIX}-easing-${kebab(name)}`, token.css]);
    }
    for (const [name, value] of Object.entries(breakpoints)) {
        staticTokens.push([`${CSS_VARIABLE_PREFIX}-breakpoint-${name}`, `${value}px`]);
    }
    staticTokens.push([`${CSS_VARIABLE_PREFIX}-focus-ring-width`, `${focusRing.width}px`]);
    staticTokens.push([`${CSS_VARIABLE_PREFIX}-focus-ring-offset`, `${focusRing.offset}px`]);
    staticTokens.push([`${CSS_VARIABLE_PREFIX}-min-touch-target`, `${MIN_TOUCH_TARGET}px`]);

    const reducedMotion = DURATION_NAMES.map(
        (name) =>
            [`${CSS_VARIABLE_PREFIX}-duration-${name}`, `${reducedDurations[name]}ms`] as const,
    );

    return `${GENERATED_BANNER}

:root {
${declarations(lightColours)}

${declarations(staticTokens)}
}

.dark {
${declarations(darkColours)}
}

@media (prefers-color-scheme: dark) {
  :root:not(.light) {
${declarations(darkColours, '    ')}
  }
}

@media (prefers-reduced-motion: reduce) {
  :root {
${declarations(reducedMotion, '    ')}
  }
}
`;
}
