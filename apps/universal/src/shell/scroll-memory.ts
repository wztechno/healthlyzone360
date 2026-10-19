/**
 * Where the reader was on each page they have seen, and the decision of where a page opens
 * (browse-04).
 *
 * ## Why the chrome has to do this
 *
 * The web document never scrolls: `body` is `overflow: hidden`, and the shell's content
 * `ScrollView` is the scroll port for every page in its group. The shell stays mounted while the
 * group's `<Slot/>` swaps one page for the next, so the port simply kept its offset: a meal opened
 * from far down the menu opened far down the meal page — its photograph, name and Add out of
 * view — and Back to the menu remounted the grid at whatever offset the meal page had reached. The
 * browser's own scroll restoration cannot help, because it restores the document, which never moved.
 *
 * ## The rule
 *
 * Keyed by **history entry**, not by path: the navigator gives every entry its own key, a push
 * makes a new one, Back returns to the old one, and `setParams` keeps it. So:
 *
 * - a page arrived at by going forward — a new key — opens at the top;
 * - a page returned to — a key seen before — opens where the reader left it;
 * - a choice made on the page (a filter, a tab, a shelf) is no navigation at all, and the reader
 *   stays exactly where they are while the grid under them changes.
 *
 * A wizard step is a push (`?step=next`), so the next step of the plan setup opens at its top and
 * Back to the previous step returns to where that step was left — nothing on those pages has to ask.
 *
 * ## Restoring waits for the page to be tall enough
 *
 * A remounted list renders from the query cache in one or two commits, and the port cannot be put
 * at 2,400px while its content is 900px tall — the browser clamps the offset. So a restore is
 * *pending* until a scroll report confirms the port arrived, and it is re-applied each time the
 * content grows in the meantime. While it is pending the port's own reports are not recorded: they
 * are the clamped positions of a page still filling in, not where the reader chose to be. A restore
 * that cannot complete — the page came back shorter than it was — gives up after
 * `RESTORE_WINDOW_MS`, rather than holding the reader's next scroll hostage.
 *
 * Module memory on purpose, shared by both chromes (the marketplace group and the customer area
 * each mount their own shell, and the root stack keeps the one underneath mounted but hidden). A
 * fresh tab starts with nothing remembered, which is right: its history is fresh too.
 */

/** How long a restore keeps trying to reach its offset while the page fills in. */
export const RESTORE_WINDOW_MS = 1500;

/** Within this many points of the target, the port has arrived. */
const ARRIVED_TOLERANCE = 2;

/** The port, as the memory moves it. */
export interface ScrollPort {
    readonly scrollTo: (y: number) => void;
}

export interface ScrollMemory {
    /**
     * The page in view is now `key` — `null` when this chrome is not the one on screen. A key equal
     * to the current one is no navigation and changes nothing.
     */
    readonly enter: (key: string | null, port: ScrollPort | null) => void;
    /** The port reported where it is. */
    readonly scrolled: (y: number) => void;
    /** The content or the port changed size; a pending restore tries again. */
    readonly measured: (port: ScrollPort | null) => void;
    /** The offset remembered for an entry — what a return to it would restore. */
    readonly offsetOf: (key: string) => number | undefined;
}

export interface ScrollMemoryOptions {
    /** Where the offsets live. Defaults to a private map; the shell passes the shared one. */
    readonly offsets?: Map<string, number> | undefined;
    /** The clock. A seam for the suites. */
    readonly now?: (() => number) | undefined;
}

interface Pending {
    readonly y: number;
    readonly until: number;
}

export function createScrollMemory(options: ScrollMemoryOptions = {}): ScrollMemory {
    const offsets = options.offsets ?? new Map<string, number>();
    const now = options.now ?? Date.now;
    let current: string | null = null;
    let pending: Pending | null = null;

    /** The pending restore, unless it has run out of time. */
    const live = (): Pending | null => {
        if (pending !== null && now() > pending.until) pending = null;
        return pending;
    };

    const settle = (port: ScrollPort | null) => {
        const target = live();
        if (target === null || port === null) return;
        port.scrollTo(target.y);
    };

    return {
        enter: (key, port) => {
            if (key === current) return;
            current = key;
            pending = null;
            if (key === null) return;
            const saved = offsets.get(key) ?? 0;
            if (saved <= 0) {
                // Forward to a new page: the top, at once — an animation would show the old page's
                // offset sliding away under the new content.
                port?.scrollTo(0);
                return;
            }
            pending = { y: saved, until: now() + RESTORE_WINDOW_MS };
            settle(port);
        },
        scrolled: (y) => {
            if (current === null) return;
            const target = live();
            if (target !== null) {
                // Still on its way: a clamped offset of a page filling in, not the reader's choice.
                if (Math.abs(y - target.y) > ARRIVED_TOLERANCE) return;
                pending = null;
            }
            offsets.set(current, Math.max(0, y));
        },
        measured: (port) => {
            settle(port);
        },
        offsetOf: (key) => offsets.get(key),
    };
}

/** The one map both marketplace chromes keep their offsets in. */
export const sharedScrollOffsets = new Map<string, number>();

/** Shape of a navigator state, as far as finding the entry on screen needs it. */
export interface RouteStateLike {
    readonly index?: number | undefined;
    readonly routes?:
        | readonly {
              readonly key?: string | undefined;
              readonly state?: RouteStateLike | undefined;
          }[]
        | undefined;
}

/**
 * The key of the history entry on screen below `state`: the focused route, followed down through
 * every nested navigator to the page itself. `null` when there is no state to read.
 */
export function focusedRouteKey(state: RouteStateLike | undefined): string | null {
    let routes = state?.routes;
    let index = state?.index ?? 0;
    let key: string | null = null;
    while (routes !== undefined) {
        const route = routes[index];
        if (route === undefined) break;
        if (route.key !== undefined) key = route.key;
        routes = route.state?.routes;
        index = route.state?.index ?? 0;
    }
    return key;
}
