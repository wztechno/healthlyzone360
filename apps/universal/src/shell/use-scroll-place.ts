import { useNavigation } from 'expo-router';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { RefObject } from 'react';
import type {
    LayoutChangeEvent,
    NativeScrollEvent,
    NativeSyntheticEvent,
    ScrollView,
} from 'react-native';

import { createScrollMemory, focusedRouteKey, sharedScrollOffsets } from './scroll-memory.ts';
import type { RouteStateLike, ScrollPort } from './scroll-memory.ts';

/**
 * The marketplace chrome's half of `scroll-memory.ts`: which history entry is on screen, and the
 * content port's ref and events to hand `AppShell`.
 *
 * ## Which entry is on screen
 *
 * The chrome is rendered by its group's layout, so `useNavigation()` here is the layout's own
 * route in the root stack. Its navigator's state holds every nested navigator's state below it,
 * and the focused route followed all the way down is the page — whose key is the history entry.
 *
 * It is read on every render (a navigation re-renders the chrome through the pathname) **and** on
 * every `state` event of that navigator. The second is not belt and braces. On a cold start the
 * group's routes arrive from the URL without keys and are given theirs when the `<Slot/>` first
 * mounts, a moment after the chrome has rendered — with nothing about the URL changing, so nothing
 * re-renders the chrome. Read once, the first page of every visit would have been remembered under
 * its group's key and never found again on the way back to it.
 *
 * The root stack keeps the other group's chrome mounted underneath, hidden (`display: none` on the
 * web). That chrome is not on screen and reports `null`, so it neither moves its port nor records
 * the visible page's offsets as its own.
 *
 * With no navigator state to read — a suite's mock — the pathname stands in for the entry.
 */
interface NavigationLike {
    readonly getState?: (() => RouteStateLike | undefined) | undefined;
    readonly isFocused?: (() => boolean) | undefined;
    readonly addListener?: ((event: 'state', listener: () => void) => () => void) | undefined;
}

export interface ScrollPlace {
    readonly contentRef: RefObject<ScrollView | null>;
    readonly onContentScroll: (event: NativeSyntheticEvent<NativeScrollEvent>) => void;
    readonly onContentSizeChange: (width: number, height: number) => void;
    readonly onContentLayout: (event: LayoutChangeEvent) => void;
}

export function useScrollPlace(pathname: string): ScrollPlace {
    const navigation = useNavigation() as unknown as NavigationLike;

    const readKey = useCallback((): string | null => {
        if (navigation.isFocused?.() === false) return null;
        return focusedRouteKey(navigation.getState?.()) ?? pathname;
    }, [navigation, pathname]);

    const [entry, setEntry] = useState<string | null>(readKey);
    // Adjusted during render, so the port is told in the same commit the new page paints in.
    const latest = readKey();
    if (latest !== entry) setEntry(latest);

    const readKeyRef = useRef(readKey);
    useLayoutEffect(() => {
        readKeyRef.current = readKey;
    }, [readKey]);
    useEffect(
        () =>
            navigation.addListener?.('state', () => {
                setEntry(readKeyRef.current());
            }),
        [navigation],
    );

    const contentRef = useRef<ScrollView | null>(null);
    const [memory] = useState(() => createScrollMemory({ offsets: sharedScrollOffsets }));
    const port = useMemo<ScrollPort>(
        () => ({
            scrollTo: (y) => {
                contentRef.current?.scrollTo({ y, animated: false });
            },
        }),
        [],
    );

    // A layout effect: the new page is in the tree but not yet painted, so a reset to the top is
    // never seen as a jump.
    useLayoutEffect(() => {
        memory.enter(entry, port);
    }, [entry, memory, port]);

    const onContentScroll = useCallback(
        (event: NativeSyntheticEvent<NativeScrollEvent>) => {
            memory.scrolled(event.nativeEvent.contentOffset.y);
        },
        [memory],
    );
    const onMeasured = useCallback(() => {
        memory.measured(port);
    }, [memory, port]);

    return {
        contentRef,
        onContentScroll,
        onContentSizeChange: onMeasured,
        onContentLayout: onMeasured,
    };
}
