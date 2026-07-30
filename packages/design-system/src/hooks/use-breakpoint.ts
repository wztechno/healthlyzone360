import { BREAKPOINT_NAMES, breakpoints } from '@healthy360/design-tokens';
import type { BreakpointName } from '@healthy360/design-tokens';
import { useMemo } from 'react';
import { useWindowDimensions } from 'react-native';

/**
 * The token scale already has a zero-width stop (`xs`), so there is no synthetic "base" here — one
 * vocabulary, shared with the Tailwind preset, is what keeps a class variant and a JavaScript
 * branch from disagreeing about where a layout changes.
 */
export type Breakpoint = BreakpointName;

export const BREAKPOINT_ORDER: readonly Breakpoint[] = [...BREAKPOINT_NAMES];

export interface UseBreakpointResult {
    readonly width: number;
    readonly breakpoint: Breakpoint;
    /** True when the viewport is at least as wide as the named breakpoint. */
    readonly atLeast: (name: Breakpoint) => boolean;
    readonly isBelow: (name: Breakpoint) => boolean;
}

function resolveBreakpoint(width: number): Breakpoint {
    let current: Breakpoint = BREAKPOINT_NAMES[0];
    for (const name of BREAKPOINT_NAMES) {
        if (width >= breakpoints[name]) current = name;
    }
    return current;
}

/**
 * Reads the current breakpoint from the *window*, not from a media query.
 *
 * Responsive class variants (`lg:flex-row`) handle most layout, but the application shell has to
 * make a structural choice — a persistent sidebar versus a drawer — and rendering both and hiding
 * one would put an off-screen navigation tree in the accessibility tree, which axe flags and screen
 * reader users trip over. So the shell branches in JavaScript, and this is where it reads from.
 */
export function useBreakpoint(): UseBreakpointResult {
    const { width } = useWindowDimensions();

    return useMemo(() => {
        const breakpoint = resolveBreakpoint(width);
        const index = (name: Breakpoint) => BREAKPOINT_ORDER.indexOf(name);
        return {
            width,
            breakpoint,
            atLeast: (name: Breakpoint) => index(breakpoint) >= index(name),
            isBelow: (name: Breakpoint) => index(breakpoint) < index(name),
        };
    }, [width]);
}
