import { Icon, IconButton } from '@healthy360/design-system';
import {
    createContext,
    useCallback,
    useContext,
    useEffect,
    useLayoutEffect,
    useMemo,
    useRef,
    useState,
} from 'react';
import type { ReactNode } from 'react';
import { Platform } from 'react-native';
import type { LayoutChangeEvent, View } from 'react-native';

/**
 * The collapsible navigation — handoff §4.2.
 *
 * The rail collapses to zero width behind a `menu` toggle placed first on the breadcrumb line of
 * **every** Catalogue screen, list and editors alike, so the control is never orphaned on a screen
 * that has no rail visible. The open state lives here rather than in a screen because it has to
 * survive navigation between screens: collapsing the rail on the ingredients list and finding it
 * back on the recipe editor is the behaviour of two independent booleans, not of one nav.
 *
 * ## Why this file measures anything at all
 *
 * Because the rail's width is subtracted from the list's scroll port, and the column fitting in
 * §4.1 reads that port. The handoff's warning is specific and was paid for in debugging: **a
 * `ResizeObserver` alone did not re-fire reliably while the nav animated**, which left nine columns
 * in a 713px port holding 884px of content and a horizontally scrolling row — the one failure mode
 * §4.1 is built to avoid, since a scrolling row hides its overflow menu.
 *
 * So the port is measured three times over, on purpose:
 *
 * 1. **When the toggle commits.** The handoff says "in the toggle's `setState` callback". React 18
 *    function components have no `setState` callback, so the equivalent is a layout effect keyed on
 *    `open`: it runs synchronously after the commit and before paint, which is the same moment.
 * 2. **Again after the transition duration.** The measurement above reads the port at its *old*
 *    width, because the animation has not run yet. This one reads it settled.
 * 3. **On window resize**, for the width changes the nav had nothing to do with.
 *
 * On native there is no width transition to wait out and no window to listen to, so `onLayout` is
 * the whole story — it fires with the settled width and nothing else is needed. `useCataloguePort`
 * returns both paths and the caller wires whichever its platform hands it.
 *
 * ## The toggle is inert until the shell reads it
 *
 * Nothing here changes the rail's rendered width yet. `AppShell` owns `sidebarWidth` and
 * `app/kitchen/_layout.tsx` passes it, and both are outside this directory — that wiring is the
 * shell pass. The state and the measurement are complete and correct now, so that pass is a prop,
 * not a rebuild.
 */

/** Matches the 160ms the handoff specifies for the width / flex-basis transition. */
export const CATALOGUE_NAV_TRANSITION_MS = 160;

type Measurer = () => void;

export interface CatalogueNavState {
    readonly open: boolean;
    readonly toggle: () => void;
    readonly setOpen: (open: boolean) => void;
    /**
     * Registers a port measurer. Returns its unsubscribe. Called by `useCataloguePort`; a screen
     * should not need it directly.
     */
    readonly subscribe: (measure: Measurer) => () => void;
    /** Re-runs every registered measurer. Exposed for the rare caller that resizes its own port. */
    readonly remeasure: () => void;
}

const CatalogueNavContext = createContext<CatalogueNavState | undefined>(undefined);

export interface CatalogueNavProviderProps {
    readonly children: ReactNode;
    readonly initialOpen?: boolean | undefined;
}

export function CatalogueNavProvider({ children, initialOpen = true }: CatalogueNavProviderProps) {
    const [open, setOpen] = useState(initialOpen);
    const measurers = useRef(new Set<Measurer>());

    const remeasure = useCallback(() => {
        for (const measure of measurers.current) measure();
    }, []);

    const subscribe = useCallback((measure: Measurer) => {
        measurers.current.add(measure);
        // Measure once on registration: a list that mounts while the nav is already collapsed has
        // no toggle commit of its own to learn the port from.
        measure();
        return () => {
            measurers.current.delete(measure);
        };
    }, []);

    // (1) the commit, and (2) the settled width one transition later. Both, not either: the first
    // is too early by exactly the animation and the second is too late to keep the row from
    // reflowing visibly, so the list takes the early answer and then corrects it.
    useLayoutEffect(() => {
        remeasure();
        const timer = setTimeout(remeasure, CATALOGUE_NAV_TRANSITION_MS);
        return () => {
            clearTimeout(timer);
        };
    }, [open, remeasure]);

    // (3) resize. Web only — `window` is the web's port, and native's `onLayout` already covers
    // rotation and split view.
    useEffect(() => {
        if (Platform.OS !== 'web' || typeof window === 'undefined') return undefined;
        window.addEventListener('resize', remeasure);
        return () => {
            window.removeEventListener('resize', remeasure);
        };
    }, [remeasure]);

    const value = useMemo<CatalogueNavState>(
        () => ({
            open,
            toggle: () => {
                setOpen((current) => !current);
            },
            setOpen,
            subscribe,
            remeasure,
        }),
        [open, subscribe, remeasure],
    );

    return <CatalogueNavContext.Provider value={value}>{children}</CatalogueNavContext.Provider>;
}

/**
 * The nav state, or `undefined` outside a provider.
 *
 * Optional rather than throwing because the components below render on the showcase and in unit
 * tests without a shell around them, and a header that cannot draw its own toggle is a better
 * failure than a screen that will not mount.
 */
export function useCatalogueNav(): CatalogueNavState | undefined {
    return useContext(CatalogueNavContext);
}

export interface CataloguePort {
    /** The measured port width in dp. `0` until the first measurement lands. */
    readonly width: number;
    /** Native's measurement. Pass to the port `View`'s `onLayout`. */
    readonly onLayout: (event: LayoutChangeEvent) => void;
    /** Web's measurement. Pass as the port `View`'s `ref`. */
    readonly ref: (node: View | null) => void;
}

/**
 * Measures a scroll port across the nav's width transition.
 *
 * The web branch holds the node and reads it on demand, because *when* to read is the whole
 * problem here (see the three moments above) and a `ResizeObserver` decides that for itself. The
 * native branch is `onLayout` and needs none of it.
 */
export function useCataloguePort(): CataloguePort {
    const [width, setWidth] = useState(0);
    const node = useRef<View | null>(null);
    const nav = useCatalogueNav();
    const subscribe = nav?.subscribe;

    const measure = useCallback(() => {
        const current = node.current as unknown as {
            getBoundingClientRect?: () => { width: number };
        } | null;
        const rect = current?.getBoundingClientRect?.();
        if (rect === undefined) return;
        setWidth(rect.width);
    }, []);

    useEffect(() => {
        if (Platform.OS !== 'web' || subscribe === undefined) return undefined;
        return subscribe(measure);
    }, [subscribe, measure]);

    const ref = useCallback(
        (next: View | null) => {
            node.current = next;
            if (Platform.OS === 'web' && next !== null) measure();
        },
        [measure],
    );

    const onLayout = useCallback((event: LayoutChangeEvent) => {
        setWidth(event.nativeEvent.layout.width);
    }, []);

    return { width, onLayout, ref };
}

export interface CatalogueNavToggleProps {
    /** Translated. Describes the action, not the state — "Show or hide the navigation". */
    readonly label: string;
    readonly testID?: string | undefined;
}

/**
 * The ☰ that collapses the rail. First on the breadcrumb line of every Catalogue screen.
 *
 * Renders nothing outside a `CatalogueNavProvider`: a toggle with no state behind it is a control
 * that does nothing, which §4.3 argues against for column headers on exactly the same grounds.
 */
export function CatalogueNavToggle({ label, testID }: CatalogueNavToggleProps) {
    const nav = useCatalogueNav();
    if (nav === undefined) return null;

    return (
        <IconButton
            label={label}
            variant="ghost"
            size="sm"
            icon={<Icon name="menu" size="sm" />}
            onPress={nav.toggle}
            aria-expanded={nav.open}
            testID={testID}
        />
    );
}
