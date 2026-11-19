import { useEffect, useRef } from 'react';
import type { RefObject } from 'react';
import { Platform } from 'react-native';
import type { View } from 'react-native';

/**
 * Closes a panel hung from a button — Escape, or a press anywhere outside the returned ref's view —
 * as the shop design's dropdowns do. Web only: a phone opens these as drawers, which close
 * themselves.
 *
 * Pass `panel` when the panel is lifted out of the root's tree (`AnchoredLayer` portals it onto
 * `body` on the web): a press inside it is then not inside `root`, and must still not count as
 * outside.
 */
export function useOutsideDismiss(
    open: boolean,
    close: () => void,
    panel?: RefObject<View | null>,
): RefObject<View | null> {
    const root = useRef<View>(null);

    useEffect(() => {
        if (Platform.OS !== 'web' || !open || typeof document === 'undefined') return;
        const onKey = (event: KeyboardEvent) => {
            if (event.key === 'Escape') close();
        };
        const onPointer = (event: PointerEvent) => {
            const target = event.target as Node;
            const node = root.current as unknown as HTMLElement | null;
            const lifted = (panel?.current ?? null) as unknown as HTMLElement | null;
            if (lifted?.contains(target) === true) return;
            if (node !== null && !node.contains(target)) close();
        };
        document.addEventListener('keydown', onKey);
        document.addEventListener('pointerdown', onPointer);
        return () => {
            document.removeEventListener('keydown', onKey);
            document.removeEventListener('pointerdown', onPointer);
        };
    }, [close, open, panel]);

    return root;
}
