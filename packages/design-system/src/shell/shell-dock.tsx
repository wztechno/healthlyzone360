import { createContext, useContext, useEffect } from 'react';
import type { ReactNode } from 'react';

import { DensityProvider, useDensity } from '../hooks/use-density.tsx';

type SetDock = (node: ReactNode) => void;

const ShellDockContext = createContext<SetDock | null>(null);

/** Provided by `AppShell`: the setter for the bar it draws on its content column's bottom edge. */
export const ShellDockHost = ShellDockContext.Provider;

/** Whether a shell is around to dock into. `false` in a screen rendered on its own — a test. */
export function useShellDockAvailable(): boolean {
    return useContext(ShellDockContext) !== null;
}

/**
 * Draws `children` on the shell's bottom edge, outside the scroll port, instead of where it is
 * rendered.
 *
 * A `position: sticky` footer cannot do this: it is confined to its own parent, so it rides up with
 * the end of the form and under a short one it sits wherever the last field ends. A bar docked to
 * the shell is a sibling of the scroll port — the port gets shorter by the bar's height, nothing
 * scrolls under it, and it does not move. The multi-step form's `FormNavigation` is the user.
 *
 * The node is handed up on every render, so its handlers are always the latest; the shell
 * re-renders to draw it but its `children` element is unchanged, so the page itself does not.
 * Density is carried across, because the dock renders above the page's `DensityProvider`. With no
 * shell around — a screen in a unit test — `children` render in place.
 *
 * One dock at a time: the last one rendered wins, and unmounting clears it.
 */
export function ShellDock({ children }: { readonly children: ReactNode }) {
    const setDock = useContext(ShellDockContext);
    const density = useDensity();

    useEffect(() => {
        if (setDock === null) return undefined;
        setDock(<DensityProvider value={density}>{children}</DensityProvider>);
        return () => {
            setDock(null);
        };
    }, [setDock, density, children]);

    return setDock === null ? <>{children}</> : null;
}
