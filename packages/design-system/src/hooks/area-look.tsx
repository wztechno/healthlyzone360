import { createContext, useContext } from 'react';
import type { ReactNode } from 'react';

/**
 * The look of an area, set once by its layout — the one switch every part reads (2026-11-26).
 *
 * The kitchen, corporate and platform admin layouts set `desk`, and each part draws its admin look
 * under it without being asked: `Select` opens the card, `Button` and `IconButton` draw the canvas
 * pills, a toast is the desk card. A new page there cannot pick the old look by forgetting a prop,
 * and a new family of parts reads this same switch rather than adding one of its own.
 *
 * Outside a scope the look is `default` — the web shop and the public pages, unchanged.
 */
export type AreaLook = 'default' | 'desk';

const AreaLookContext = createContext<AreaLook>('default');

export function AreaLookScope({
    look,
    children,
}: {
    readonly look: AreaLook;
    readonly children: ReactNode;
}) {
    return <AreaLookContext.Provider value={look}>{children}</AreaLookContext.Provider>;
}

/** The look the nearest `AreaLookScope` sets; `default` outside one. */
export function useAreaLook(): AreaLook {
    return useContext(AreaLookContext);
}
