import { createContext, useContext, useMemo } from 'react';
import type { ReactNode } from 'react';
import { useWindowDimensions } from 'react-native';

/**
 * How much room the page actually has — the shell's content column, not the window.
 *
 * ## Why the window is the wrong measure on a desk
 *
 * From `lg` up the workspace shell spends a fixed 344px on chrome: the 56px module rail, the page
 * panel and the content padding. A `lg:` or `xl:` variant reads the *window*, so on a 1280px laptop
 * (a 1920×1080 panel at 150% scaling) it believes it has 1280px when the page has nearer 920 — and
 * between 768 and 1023, where the panel becomes a drawer, the page is actually *wider* than at
 * 1024. A layout that splits on the window splits exactly when the room shrinks.
 *
 * ## Computed, not measured
 *
 * The shell knows every term — window, rail, panel (from the panel's *target* state, so the value
 * is right the moment the panel is toggled rather than after its slide), padding — so the width is
 * arithmetic, available on the first render, with no `onLayout` round trip and no first frame laid
 * out for the wrong width. It works under Jest from the window dimensions alone.
 *
 * It does not subtract a scrollbar, because the shell cannot know whether one is showing or how
 * wide the platform draws it. Thresholds compared against it leave ~20px of slack for that.
 *
 * A component that needs its *own* width — a list fitting columns, the sale screen cutting tiles —
 * still measures its node. This is for page structure: one column or two, how many cards a row.
 */

export interface ContentWidth {
    /** The content column's width in dp, padding excluded. */
    readonly width: number;
    /** True when the content column is at least `px` wide. */
    readonly atLeast: (px: number) => boolean;
}

/** What the shell subtracts from the window. Provided by `AppShell`; nothing else should need it. */
export interface ContentInset {
    /** Chrome beside the content column — rail plus panel — in dp. */
    readonly chrome: number;
    /** Padding on each inline side of the content column, in dp. */
    readonly padding: number;
}

const ContentInsetContext = createContext<ContentInset | null>(null);

export interface ContentWidthProviderProps {
    readonly value: ContentInset;
    readonly children: ReactNode;
}

export function ContentWidthProvider({ value, children }: ContentWidthProviderProps) {
    const { chrome, padding } = value;
    const inset = useMemo(() => ({ chrome, padding }), [chrome, padding]);
    return <ContentInsetContext.Provider value={inset}>{children}</ContentInsetContext.Provider>;
}

/**
 * A column docked beside the page — the issue tray, from `lg` — takes `width` from the content
 * column, so what is under it lays out for the room that is left. `0` when nothing is docked: the
 * provider stays, so the page under it is never remounted when the column comes and goes.
 */
export function ContentWidthBeside({
    width,
    children,
}: {
    readonly width: number;
    readonly children: ReactNode;
}) {
    const outer = useContext(ContentInsetContext);
    const inset = useMemo(
        () =>
            width === 0
                ? outer
                : { chrome: (outer?.chrome ?? 0) + width, padding: outer?.padding ?? 0 },
        [outer, width],
    );
    return <ContentInsetContext.Provider value={inset}>{children}</ContentInsetContext.Provider>;
}

/** The arithmetic, exported for the shell's tests and for anything that has to reason ahead. */
export function contentWidthFor(windowWidth: number, inset: ContentInset | null): number {
    if (inset === null) return windowWidth;
    return Math.max(0, windowWidth - inset.chrome - inset.padding * 2);
}

/**
 * The content column's width. Outside a shell — the showcase, a unit test that renders a screen
 * bare — it is the window's, which is what such a render has.
 */
export function useContentWidth(): ContentWidth {
    const { width: windowWidth } = useWindowDimensions();
    const inset = useContext(ContentInsetContext);
    return useMemo(() => {
        const width = contentWidthFor(windowWidth, inset);
        return { width, atLeast: (px: number) => width >= px };
    }, [windowWidth, inset]);
}
