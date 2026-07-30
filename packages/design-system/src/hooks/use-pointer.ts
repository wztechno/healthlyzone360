import { useEffect, useState } from 'react';
import { Platform } from 'react-native';

export const POINTER_KINDS = ['fine', 'coarse'] as const;
export type PointerKind = (typeof POINTER_KINDS)[number];

const FINE_POINTER_QUERY = '(pointer: fine)';

/**
 * Whether the primary pointer is fine (mouse, trackpad, stylus) or coarse (finger).
 *
 * This is the guard that keeps hover-only affordances off touch devices. A touch screen has no
 * hover state, so a popover that only opens on hover is simply unreachable there — the reference
 * research records exactly this hazard (07-animation-and-motion-inventory.md, CST-03). Native is
 * always coarse; on the web the answer comes from the pointer media query and is re-read when it
 * changes, because a tablet with a keyboard case changes its answer while the app is running.
 */
export function usePointerKind(): PointerKind {
    const [kind, setKind] = useState<PointerKind>(Platform.OS === 'web' ? 'fine' : 'coarse');

    useEffect(() => {
        if (Platform.OS !== 'web') {
            setKind('coarse');
            return;
        }
        if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;

        const query = window.matchMedia(FINE_POINTER_QUERY);
        const apply = (matches: boolean) => {
            setKind(matches ? 'fine' : 'coarse');
        };
        apply(query.matches);

        const listener = (event: MediaQueryListEvent) => {
            apply(event.matches);
        };
        query.addEventListener('change', listener);
        return () => {
            query.removeEventListener('change', listener);
        };
    }, []);

    return kind;
}

/** Convenience: true when hover is not a usable interaction on this device. */
export function useIsCoarsePointer(): boolean {
    return usePointerKind() === 'coarse';
}
