import { useSyncExternalStore } from 'react';

const subscribe = () => () => undefined;

/**
 * False while React is hydrating the static web export's HTML, true on every other render.
 *
 * The export is rendered once at build time, with no window, no cookie and no storage, so a value
 * read from any of those during hydration differs from what the HTML holds and React throws error
 * 418 and re-renders the whole tree. A hook that branches on such a value reads this first and
 * renders the build-time answer until it is true. React re-renders the component straight after
 * hydration because the client snapshot differs from the server one; on native and in tests there
 * is no hydration, so it is true from the first render.
 */
export function useHydrated(): boolean {
    return useSyncExternalStore(
        subscribe,
        () => true,
        () => false,
    );
}
