import { useEffect, useRef } from 'react';
import type { RefObject } from 'react';
import { Platform } from 'react-native';
import type { View } from 'react-native';

/**
 * Closes a panel hung from a button — Escape, or a press anywhere outside the returned ref's view —
 * as the shop design's dropdowns do. Web only: a phone opens these as drawers, which close
 * themselves.
 */
export function useOutsideDismiss(open: boolean, close: () => void): RefObject<View | null> {
    const root = useRef<View>(null);

    useEffect(() => {
        if (Platform.OS !== 'web' || !open || typeof document === 'undefined') return;
        const onKey = (event: KeyboardEvent) => {
            if (event.key === 'Escape') close();
        };
        const onPointer = (event: PointerEvent) => {
            const node = root.current as unknown as HTMLElement | null;
            if (node !== null && !node.contains(event.target as Node)) close();
        };
        document.addEventListener('keydown', onKey);
        document.addEventListener('pointerdown', onPointer);
        return () => {
            document.removeEventListener('keydown', onKey);
            document.removeEventListener('pointerdown', onPointer);
        };
    }, [close, open]);

    return root;
}
