import { createContext, useContext, useEffect } from 'react';
import type { ReactNode } from 'react';
import { Platform } from 'react-native';

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
    useDocumentLook(look);
    return <AreaLookContext.Provider value={look}>{children}</AreaLookContext.Provider>;
}

/** How many desk scopes are mounted — a layout and a showcase can overlap for a frame. */
let deskScopes = 0;

/**
 * On the web, `<html data-look="desk">` while a desk area is open, so `global.css` can set the admin's
 * one face (Inter) on its titles and figures too — including pop-ups, which render outside the page.
 * The shop never mounts a desk scope, so its titles keep the display face.
 */
function useDocumentLook(look: AreaLook): void {
    useEffect(() => {
        if (look !== 'desk' || Platform.OS !== 'web' || typeof document === 'undefined') return;
        deskScopes += 1;
        document.documentElement.dataset.look = 'desk';
        return () => {
            deskScopes -= 1;
            if (deskScopes === 0) delete document.documentElement.dataset.look;
        };
    }, [look]);
}

/** The look the nearest `AreaLookScope` sets; `default` outside one. */
export function useAreaLook(): AreaLook {
    return useContext(AreaLookContext);
}
