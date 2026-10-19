import { useEffect, useEffectEvent } from 'react';

/**
 * "Put the cursor in the menu's search field" — asked by the header's search button, honoured by
 * the catalogue.
 *
 * Between `md` and `xl` the header has no room for its own search field, so its search button opens
 * the catalogue, whose field is on the page (browse-06). Opening a page with a search field and
 * leaving the person to find it is not what a button labelled "Search the menu" promised, so the
 * button asks for focus and the field takes it once it is there — at once when the catalogue is
 * already open, or on mount when the press is what opened it.
 *
 * A one-shot flag rather than a `?focus=` param: focus is not a place, and a param would be copied
 * into every remembered listing query and every return path, re-focusing the field on each Back.
 */
let requested = false;
const listeners = new Set<() => void>();

export function requestMenuSearchFocus(): void {
    requested = true;
    for (const listener of listeners) listener();
}

/** Takes a pending request, if any. Exported for the suites. */
export function takeMenuSearchFocus(): boolean {
    const was = requested;
    requested = false;
    return was;
}

/** Calls `focus` whenever focus is asked for while the caller is mounted, or was asked for before. */
export function useMenuSearchFocus(focus: () => void): void {
    const onRequest = useEffectEvent(() => {
        if (takeMenuSearchFocus()) focus();
    });
    useEffect(() => {
        const listener = () => {
            onRequest();
        };
        listener();
        listeners.add(listener);
        return () => {
            listeners.delete(listener);
        };
    }, []);
}
