import { Breadcrumbs, DensityProvider } from '@healthy360/design-system';
import type { BreadcrumbItem } from '@healthy360/design-system';
import {
    createContext,
    useContext,
    useEffect,
    useLayoutEffect,
    useMemo,
    useRef,
    useState,
} from 'react';
import type { ReactNode } from 'react';

/**
 * The area-agnostic half of a desk area's breadcrumb trail: the leaf a screen names, and the bar's
 * compact rendering of the crumbs.
 *
 * Which crumbs sit above the leaf is the area's own business — the kitchen derives them from its
 * entity registry (`kitchen-ops-shell.tsx`), the corporate area from its programmes
 * (`features/business/corporate-chrome.tsx`). What a screen contributes is the same in both: the
 * record it loaded, and, where the record opened *inside* a list rather than on a route of its own,
 * the callback that closes it. That is this file, so a view page written for one area names its
 * crumb in any area whose layout mounts a {@link TrailLeafProvider}.
 */

export interface TrailLeaf {
    /** The record's display name. `null` while it has not loaded, and on a list page. */
    readonly leaf: string | null;
    /**
     * Closes the open record, where the record is not a route of its own. `null` on a real route,
     * where the crumb above navigates instead.
     */
    readonly back: (() => void) | null;
}

interface TrailLeafState extends TrailLeaf {
    readonly setTrail: (next: TrailLeaf) => void;
}

const TrailLeafContext = createContext<TrailLeafState | undefined>(undefined);

/** Holds the trail's leaf for everything under an area layout — the top bar and the page. */
export function TrailLeafProvider({ children }: { readonly children: ReactNode }) {
    const [state, setTrail] = useState<TrailLeaf>({ leaf: null, back: null });
    const trail = useMemo<TrailLeafState>(
        () => ({ leaf: state.leaf, back: state.back, setTrail }),
        [state],
    );

    return <TrailLeafContext.Provider value={trail}>{children}</TrailLeafContext.Provider>;
}

/**
 * Names the trail's last crumb from inside a screen.
 *
 * Pass the record's display name once it has loaded, and `null` while it has not. Outside a
 * provider it does nothing rather than throwing: screens render in unit tests with no shell around
 * them, and a screen that will not mount is a worse failure than a trail that is not there.
 */
export function useTrailLeaf(leaf: string | null, onBack?: (() => void) | undefined): void {
    const trail = useContext(TrailLeafContext);
    const setTrail = trail?.setTrail;

    /*
     * The callback is held in a ref and the trail is handed a stable wrapper around it. Callers
     * pass inline closures; putting one in the effect's dependencies would re-register the trail on
     * every render, which re-renders the provider, which re-renders the caller — a loop. Only
     * *whether* there is a way back is a dependency; *which* function it calls is read at press time.
     */
    const backRef = useRef(onBack);
    useLayoutEffect(() => {
        backRef.current = onBack;
    });
    const hasBack = onBack !== undefined;

    useEffect(() => {
        if (setTrail === undefined) return undefined;
        setTrail({
            leaf,
            back: hasBack
                ? () => {
                      backRef.current?.();
                  }
                : null,
        });
        return () => {
            setTrail({ leaf: null, back: null });
        };
    }, [setTrail, leaf, hasBack]);
}

/** The leaf the current screen has named — read by an area's crumb builder. */
export function useTrailLeafState(): TrailLeaf {
    const context = useContext(TrailLeafContext);
    return { leaf: context?.leaf ?? null, back: context?.back ?? null };
}

/**
 * The trail as a top bar draws it. It keeps a compact provider of its own because the bar sits
 * outside the content's density provider.
 */
export function AreaTrail({
    crumbs,
    testID,
}: {
    readonly crumbs: readonly BreadcrumbItem[];
    readonly testID: string;
}) {
    return (
        <DensityProvider value="compact">
            <Breadcrumbs testID={testID} items={crumbs} />
        </DensityProvider>
    );
}
