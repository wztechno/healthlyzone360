import {
    CONTROL_SIZES,
    ROW_DENSITIES,
    cardWidth,
    controlGap,
    controlHeight,
    controlPaddingX,
    fieldWidth,
    iconSize,
    rowHeight,
} from '../control.ts';
import { ELEVATION_LEVELS, NAMED_ELEVATIONS, elevation, namedElevation } from '../elevation.ts';
import { breakpoints, focusRing, radius, spacing, spacingAliases } from '../layout.ts';
import { DURATION_NAMES, durations, easings, reducedDurations } from '../motion.ts';
import {
    FONT_SIZE_NAMES,
    SCRIPTS,
    TEXT_ROLE_NAMES,
    adminFamilies,
    displayLetterSpacing,
    fontFamilies,
    fontSizes,
    lineHeights,
    monoFamilies,
    textRoleLetterSpacing,
    textRoleLineHeight,
    textRoles,
} from '../typography.ts';
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
    // Aliases share the `space` namespace because they *are* steps of it under another name.
    for (const [name, value] of Object.entries(spacingAliases)) {
        staticTokens.push([`${CSS_VARIABLE_PREFIX}-space-${name}`, `${value}px`]);
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
    // Declared, and bound to nothing. `global.css` applies the two families above to `html`; these
    // two are opted into by the surfaces that want them — the admin family by the Catalogue, the
    // mono family by anything that has to line a column of numbers up. Binding either one globally
    // would reflow the customer app, which is not what a token file gets to decide.
    staticTokens.push([`${CSS_VARIABLE_PREFIX}-font-family-admin`, adminFamilies.latin.stack]);
    staticTokens.push([`${CSS_VARIABLE_PREFIX}-font-family-mono`, monoFamilies.latin.stack]);
    staticTokens.push([`${CSS_VARIABLE_PREFIX}-tracking-display`, displayLetterSpacing]);
    // The Catalogue ramp. Emitted per script for the same reason the size scale is: a role's Latin
    // leading is hand-tuned, its Arabic leading comes from the multiplier, and its tracking is
    // dropped to zero in a cursive script rather than carried across.
    for (const role of TEXT_ROLE_NAMES) {
        const prefix = `${CSS_VARIABLE_PREFIX}-text-${role}`;
        staticTokens.push([`${prefix}-size`, `${textRoles[role].size}px`]);
        staticTokens.push([`${prefix}-weight`, textRoles[role].weight]);
        for (const script of SCRIPTS) {
            staticTokens.push([
                `${prefix}-line-height-${script}`,
                `${textRoleLineHeight(role, script)}px`,
            ]);
            staticTokens.push([
                `${prefix}-tracking-${script}`,
                `${textRoleLetterSpacing(role, script)}px`,
            ]);
        }
    }
    for (const size of CONTROL_SIZES) {
        staticTokens.push([`${CSS_VARIABLE_PREFIX}-control-height-${size}`, `${controlHeight[size]}px`]);
        staticTokens.push([
            `${CSS_VARIABLE_PREFIX}-control-padding-x-${size}`,
            `${controlPaddingX[size]}px`,
        ]);
        staticTokens.push([`${CSS_VARIABLE_PREFIX}-control-gap-${size}`, `${controlGap[size]}px`]);
        staticTokens.push([`${CSS_VARIABLE_PREFIX}-icon-size-${size}`, `${iconSize[size]}px`]);
    }
    for (const density of ROW_DENSITIES) {
        staticTokens.push([
            `${CSS_VARIABLE_PREFIX}-row-height-${density}`,
            `${rowHeight[density]}px`,
        ]);
    }
    staticTokens.push([`${CSS_VARIABLE_PREFIX}-field-width`, `${fieldWidth}px`]);
    staticTokens.push([`${CSS_VARIABLE_PREFIX}-card-width-min`, `${cardWidth.min}px`]);
    staticTokens.push([`${CSS_VARIABLE_PREFIX}-card-width-max`, `${cardWidth.max}px`]);
    for (const level of ELEVATION_LEVELS) {
        staticTokens.push([`${CSS_VARIABLE_PREFIX}-elevation-${level}`, elevation[level].web]);
    }
    for (const name of NAMED_ELEVATIONS) {
        staticTokens.push([`${CSS_VARIABLE_PREFIX}-elevation-${name}`, namedElevation[name].web]);
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
