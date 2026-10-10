import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Platform } from 'react-native';
import type { LayoutChangeEvent } from 'react-native';

export interface UsePortWidthOptions {
    /**
     * Collapses widths that draw the same thing — a grid's track count, a list's set of fitting
     * columns. A new width in the same bucket as the stored one is not stored, so a width transition
     * re-renders only when the bucket changes.
     */
    readonly bucket?: ((width: number) => unknown) | undefined;
}

export interface UsePortWidthResult {
    /** The measured width, in dp. `0` until the first measurement. */
    readonly width: number;
    /** Web: attach to the measured node. */
    readonly ref: (node: unknown) => void;
    /** Native: attach to the measured view. */
    readonly onLayout: (event: LayoutChangeEvent) => void;
}

/**
 * The width of the box a component is actually given, not the window's.
 *
 * Extracted from `DataList`, which learned it first: a kitchen screen's content area differs from
 * the window by the shell's nav (a 56px module rail plus a 232px panel, itself collapsible), so a
 * breakpoint is the wrong question for anything that has to fit its own box.
 *
 * **Native** measures with `onLayout` — the real layout system there, firing on mount, rotation and
 * split view.
 *
 * **Web** reads the node rather than waiting for `onLayout`. react-native-web implements that as a
 * `ResizeObserver` that, inside the shell, never delivered a usable observation, and fires on every
 * frame of a width transition when it does. So the node is read on demand at the two moments the
 * port can change: after every commit of the caller (mount, and the shell re-renders across the
 * panel's slide) and on window `resize` — which `AppShell` also dispatches once the panel has
 * finished sliding. An unchanged width is not stored, so a layout effect with no dependency list
 * settles after one pass instead of looping.
 *
 * A zero is never a port: it is what a node reports before it has been laid out.
 */
export function usePortWidth(options: UsePortWidthOptions = {}): UsePortWidthResult {
    const [width, setWidth] = useState(0);

    // Read through a ref so the callbacks below never change identity.
    const bucketRef = useRef(options.bucket);
    bucketRef.current = options.bucket;

    const measure = useCallback((next: number) => {
        if (next <= 0) return;
        setWidth((current) => {
            if (current === next) return current;
            const bucket = bucketRef.current;
            // The first measurement always lands: 0 means "unmeasured", not a bucket.
            if (current > 0 && bucket !== undefined && bucket(current) === bucket(next)) {
                return current;
            }
            return next;
        });
    }, []);

    const node = useRef<{ getBoundingClientRect?: () => { width: number } } | null>(null);

    const ref = useCallback((next: unknown) => {
        node.current = next as typeof node.current;
    }, []);

    const readPort = useCallback(() => {
        const rect = node.current?.getBoundingClientRect?.();
        if (rect !== undefined) measure(rect.width);
    }, [measure]);

    useLayoutEffect(() => {
        if (Platform.OS === 'web') readPort();
    });

    useEffect(() => {
        if (Platform.OS !== 'web' || typeof window === 'undefined') return undefined;
        window.addEventListener('resize', readPort);
        return () => {
            window.removeEventListener('resize', readPort);
        };
    }, [readPort]);

    const onLayout = useCallback(
        (event: LayoutChangeEvent) => {
            measure(event.nativeEvent.layout.width);
        },
        [measure],
    );

    return { width, ref, onLayout };
}
