import { useCallback, useEffect, useRef, useState } from 'react';
import { Platform } from 'react-native';
import type { LayoutChangeEvent, View } from 'react-native';

/**
 * Measures a table's scroll port, so `DataTable` fits its columns to the width it really has.
 *
 * A `ResizeObserver` alone did not re-fire reliably while the shell's page panel slid, which left
 * nine columns in a 713px port holding 884px of content and a horizontally scrolling row — the one
 * failure the column fitting is built to avoid, since a scrolling row hides its `⋯`. So the web
 * branch holds the node and reads it on demand: when it mounts, and on the one `resize` the shell
 * announces once its panel has settled. Native's `onLayout` already fires with the settled width.
 */
export interface TablePort {
    /** The measured port width in dp. `0` until the first measurement lands. */
    readonly width: number;
    /** Native's measurement. Pass to the port `View`'s `onLayout`. */
    readonly onLayout: (event: LayoutChangeEvent) => void;
    /** Web's measurement. Pass as the port `View`'s `ref`. */
    readonly ref: (node: View | null) => void;
}

export function useTablePort(): TablePort {
    const [width, setWidth] = useState(0);
    const node = useRef<View | null>(null);

    const measure = useCallback(() => {
        const current = node.current as unknown as {
            getBoundingClientRect?: () => { width: number };
        } | null;
        const rect = current?.getBoundingClientRect?.();
        if (rect === undefined) return;
        setWidth(rect.width);
    }, []);

    useEffect(() => {
        if (Platform.OS !== 'web' || typeof window === 'undefined') return undefined;
        window.addEventListener('resize', measure);
        return () => {
            window.removeEventListener('resize', measure);
        };
    }, [measure]);

    const ref = useCallback(
        (next: View | null) => {
            node.current = next;
            if (Platform.OS === 'web' && next !== null) measure();
        },
        [measure],
    );

    const onLayout = useCallback((event: LayoutChangeEvent) => {
        setWidth(event.nativeEvent.layout.width);
    }, []);

    return { width, onLayout, ref };
}
