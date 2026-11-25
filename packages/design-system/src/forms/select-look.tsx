import { createContext, useContext } from 'react';
import type { ReactNode } from 'react';

/**
 * The look every `Select` under it takes when it names none — set once by an area's layout.
 *
 * The kitchen admin, the corporate admin and the platform admin set `card` (2026-11-26), so a page
 * there gets the admin dropdown without asking for it, and a new page cannot pick the old one by
 * forgetting a prop. The web shop sets nothing and keeps `field`. As `ToastLookScope` does for
 * toasts.
 */
const SelectLookContext = createContext<'field' | 'card'>('field');

export function SelectLookScope({
    look,
    children,
}: {
    readonly look: 'field' | 'card';
    readonly children: ReactNode;
}) {
    return <SelectLookContext.Provider value={look}>{children}</SelectLookContext.Provider>;
}

/** The look the nearest `SelectLookScope` asks for; `field` outside one. */
export function useSelectLook(): 'field' | 'card' {
    return useContext(SelectLookContext);
}
