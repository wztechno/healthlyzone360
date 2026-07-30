/**
 * WCAG 2.2 relative luminance and contrast ratio.
 *
 * Implemented here rather than pulled from a dependency so the accessibility budget is enforced by
 * code this repository owns and can test, and so the same function is available at runtime for
 * tooling (the design-system showcase reports contrast alongside each swatch).
 *
 * Reference: WCAG 2.2 "relative luminance" and "contrast ratio" definitions.
 */

export interface Rgb {
    readonly r: number;
    readonly g: number;
    readonly b: number;
}

const HEX_PATTERN = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i;

export function isHexColour(value: string): boolean {
    return HEX_PATTERN.test(value);
}

export function hexToRgb(hex: string): Rgb {
    if (!isHexColour(hex)) {
        throw new Error(`Not a hex colour: ${hex}`);
    }
    const body = hex.slice(1);
    const full =
        body.length === 3
            ? body
                  .split('')
                  .map((char) => char + char)
                  .join('')
            : body;

    return {
        r: Number.parseInt(full.slice(0, 2), 16),
        g: Number.parseInt(full.slice(2, 4), 16),
        b: Number.parseInt(full.slice(4, 6), 16),
    };
}

function channelLuminance(value8Bit: number): number {
    const channel = value8Bit / 255;
    return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
}

/** WCAG relative luminance, 0 (black) to 1 (white). */
export function relativeLuminance(hex: string): number {
    const { r, g, b } = hexToRgb(hex);
    return (
        0.2126 * channelLuminance(r) + 0.7152 * channelLuminance(g) + 0.0722 * channelLuminance(b)
    );
}

/** WCAG contrast ratio, 1 (identical) to 21 (black on white). Order-independent. */
export function contrastRatio(foreground: string, background: string): number {
    const a = relativeLuminance(foreground);
    const b = relativeLuminance(background);
    const lighter = Math.max(a, b);
    const darker = Math.min(a, b);
    return (lighter + 0.05) / (darker + 0.05);
}

export const WCAG_AA_NORMAL_TEXT = 4.5;
export const WCAG_AA_LARGE_TEXT = 3;
export const WCAG_AA_NON_TEXT = 3;

export function meetsAaNormalText(foreground: string, background: string): boolean {
    return contrastRatio(foreground, background) >= WCAG_AA_NORMAL_TEXT;
}

/** Rounds to two decimals so assertion messages and generated docs stay readable. */
export function formatContrast(ratio: number): string {
    return `${Math.round(ratio * 100) / 100}:1`;
}
