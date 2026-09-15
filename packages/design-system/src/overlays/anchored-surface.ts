import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Platform } from 'react-native';

import { KEYS } from '../internal/web-props.ts';

/**
 * The two things every anchored popover in this system has to get right, in one place.
 *
 * Both were paid for in debugging time in the mock (handoff §4.3), and both are the kind of bug a
 * call site cannot be trusted to remember — so `Dropdown` and `Menu` own them and nothing else has
 * to know they exist.
 *
 * 1. **Swallow `pointerdown`.** The document-level outside-press closer fires on `pointerdown`,
 *    which unmounts the panel before the item under the cursor ever receives its `click`. The
 *    action becomes unreachable — the menu opens, you press an item, and nothing happens. The panel
 *    therefore stops the event from reaching the document.
 * 2. **Flip against the narrower of the scroll port and the grid's `max-content` width.** A
 *    fixed-width panel anchored to a right-hand column's start edge runs off the port and takes the
 *    `Clear` link with it. Measuring against the port *alone* is the fix that does not work: the
 *    row grids carry `min-width: max-content`, so a panel that overflows the **grid** still grows
 *    `scrollWidth` while looking comfortably inside the port — that is the phantom 44px scrollbar.
 */

/** Marks the element whose `max-content` width bounds a popover. `DataList` sets it on its grid. */
export const GRID_CONTENT_ATTR = 'data-grid-content';

export const ANCHOR_ALIGNS = ['start', 'end'] as const;
export type AnchorAlign = (typeof ANCHOR_ALIGNS)[number];

interface DomRect {
    readonly left: number;
    readonly right: number;
}

interface DomNode {
    readonly parentElement?: DomNode | null;
    readonly clientWidth?: number;
    readonly scrollWidth?: number;
    readonly getBoundingClientRect?: () => DomRect;
    readonly getAttribute?: (name: string) => string | null;
    readonly contains?: (target: unknown) => boolean;
}

export interface NodeRef {
    current: unknown;
}

function asNode(ref: NodeRef): DomNode | null {
    return (ref.current ?? null) as DomNode | null;
}

function isRtl(node: DomNode): boolean {
    if (typeof window === 'undefined') return false;
    const view = window as unknown as {
        readonly getComputedStyle?: (element: unknown) => { readonly direction?: string };
    };
    return view.getComputedStyle?.(node)?.direction === 'rtl';
}

interface ReferenceBox {
    readonly portWidth: number;
    readonly gridWidth: number;
    /** The inline extent the flip compares against — the narrower of the two, for the edge maths. */
    readonly width: number;
    readonly left: number;
    readonly right: number;
}

/**
 * Walks up for the box the panel must stay inside.
 *
 * Two candidates, and the answer is whichever is narrower. The scroll port is the visible window;
 * the `max-content` grid is the wider content the port scrolls over. A panel that sits inside the
 * port but past the grid's own inline-end edge is still an overflow — it is precisely what extends
 * `scrollWidth`, and measuring the port alone is what left the phantom 44px scrollbar in the mock.
 */
function referenceBox(from: DomNode): ReferenceBox | null {
    let port: DomNode | null = null;
    let grid: DomNode | null = null;

    let node: DomNode | null = from.parentElement ?? null;
    while (node !== null) {
        const marker = node.getAttribute?.(GRID_CONTENT_ATTR);
        if (grid === null && marker !== null && marker !== undefined) grid = node;

        const client = node.clientWidth ?? 0;
        const scroll = node.scrollWidth ?? 0;
        if (port === null && client > 0 && scroll > client) port = node;

        node = node.parentElement ?? null;
    }

    const anchorBox = port ?? grid;
    if (anchorBox === null) return null;

    const rect = anchorBox.getBoundingClientRect?.();
    if (rect === undefined) return null;

    // The port's *client* width excludes its scrollbar where its rect does not, so the edges come
    // from the rect and the extent from the measured widths. Whichever of the two is narrower wins.
    const portWidth = port === null ? Number.POSITIVE_INFINITY : (port.clientWidth ?? 0);
    const gridWidth = grid === null ? Number.POSITIVE_INFINITY : (grid.scrollWidth ?? 0);
    const width = Math.min(portWidth, gridWidth);
    if (!Number.isFinite(width) || width <= 0) return null;

    return { portWidth, gridWidth, width, left: rect.left, right: rect.left + width };
}

export interface FlipInput {
    /** The trigger's offset from the reference box's inline start. */
    readonly anchorInlineStart: number;
    readonly panelWidth: number;
    /** The visible scroll port's width, or `Infinity` when nothing above the anchor scrolls. */
    readonly portWidth: number;
    /** The `max-content` width of the grid the anchor sits in, or `Infinity` when there is none. */
    readonly gridWidth: number;
}

/**
 * The flip decision, as arithmetic — no DOM, no React.
 *
 * Pulled out because it is the half that was wrong twice in the mock and the half a renderer cannot
 * exercise: jsdom reports every rect as zero, so a test driving this through a real popover would
 * assert on nothing. Here the exact failing case is one call.
 *
 * The reference width is the **narrower** of the two boxes. Measuring the port alone is the fix
 * that does not work: because the row grids carry `min-width: max-content`, a panel can sit
 * comfortably inside the port and still hang past the grid's own inline-end edge — and it is the
 * grid, not the port, that `scrollWidth` is measured from. That overhang is the phantom 44px
 * scrollbar.
 */
export function resolveFlip({
    anchorInlineStart,
    panelWidth,
    portWidth,
    gridWidth,
}: FlipInput): AnchorAlign {
    const reference = Math.min(portWidth, gridWidth);
    if (!Number.isFinite(reference) || reference <= 0) return 'start';
    return anchorInlineStart + panelWidth > reference ? 'end' : 'start';
}

export interface UseAnchorFlipOptions {
    readonly open: boolean;
    /** The trigger's container. Its inline offset inside the reference box is the flip's input. */
    readonly anchorRef: NodeRef;
    readonly panelRef: NodeRef;
    /** The alignment the caller asked for. A stated `end` is honoured and never flipped back. */
    readonly preferred: AnchorAlign;
}

/**
 * Resolves which edge the panel hangs from — measured, not guessed.
 *
 * Everything below is expressed in *inline* coordinates: distance from the reference box's inline
 * start. That is what makes RTL the same arithmetic rather than a mirrored branch. It matters
 * because under RTL both the inset properties and the direction the overflow happens in flip, so a
 * comparison written against a hard-coded right edge gets it exactly backwards — the panel flips
 * away from the edge it was about to run off.
 */
export function useAnchorFlip({
    open,
    anchorRef,
    panelRef,
    preferred,
}: UseAnchorFlipOptions): AnchorAlign {
    const [align, setAlign] = useState<AnchorAlign>(preferred);

    useLayoutEffect(() => {
        if (!open) {
            setAlign(preferred);
            return;
        }
        // Native has no scroll port to overflow and no `max-content` grid to overflow inside one;
        // the panel is laid out by the same flex pass as everything else. The prop is still
        // accepted so a call site reads identically on both platforms.
        if (Platform.OS !== 'web') return;
        // A stated `end` is an author's decision, not a fallback. Re-measuring it could only flip
        // it back to `start`, undoing the thing they asked for.
        if (preferred === 'end') return;

        const anchor = asNode(anchorRef);
        const panel = asNode(panelRef);
        if (anchor === null || panel === null) return;

        const reference = referenceBox(anchor);
        const anchorRect = anchor.getBoundingClientRect?.();
        const panelRect = panel.getBoundingClientRect?.();
        if (reference === null || anchorRect === undefined || panelRect === undefined) return;

        const panelWidth = panelRect.right - panelRect.left;
        const rtl = isRtl(anchor);
        const anchorInlineStart = rtl
            ? reference.right - anchorRect.right
            : anchorRect.left - reference.left;

        setAlign(
            resolveFlip({
                anchorInlineStart,
                panelWidth,
                portWidth: reference.portWidth,
                gridWidth: reference.gridWidth,
            }),
        );
    }, [open, preferred, anchorRef, panelRef]);

    return align;
}

export interface UseDismissOptions {
    readonly open: boolean;
    readonly onClose: () => void;
    readonly containerRef: NodeRef;
}

/** Escape from anywhere, plus the outside-press half of the same contract. */
export function useDismiss({ open, onClose, containerRef }: UseDismissOptions): void {
    const closeRef = useRef(onClose);
    closeRef.current = onClose;

    useEffect(() => {
        if (Platform.OS !== 'web' || !open) return;
        if (typeof document === 'undefined') return;

        const onKey = (event: KeyboardEvent) => {
            if (event.key === KEYS.escape) closeRef.current();
        };
        const onPointerDown = (event: Event) => {
            const node = asNode(containerRef);
            if (node?.contains?.(event.target) === true) return;
            closeRef.current();
        };

        document.addEventListener('keydown', onKey);
        document.addEventListener('pointerdown', onPointerDown);
        return () => {
            document.removeEventListener('keydown', onKey);
            document.removeEventListener('pointerdown', onPointerDown);
        };
    }, [open, containerRef]);
}

export interface SwallowedPointerEvent {
    readonly stopPropagation: () => void;
}

export interface PointerSwallowProps {
    readonly onPointerDown?: ((event: SwallowedPointerEvent) => void) | undefined;
}

/**
 * Spreadable on the panel: real on the web, empty on native — the same shape, and the same reason,
 * as `keyDownProps`.
 *
 * Without it the outside-press listener above unmounts the panel on `pointerdown` and the item
 * never receives its `click`. `stopPropagation` and deliberately not `preventDefault`: the press
 * must still reach the item, it must only not reach the document.
 */
export function usePointerSwallow(): PointerSwallowProps {
    const swallow = useCallback((event: SwallowedPointerEvent) => {
        event.stopPropagation();
    }, []);

    if (Platform.OS !== 'web') return {};
    return { onPointerDown: swallow };
}

/**
 * The panel frame every anchored surface shares, at the one popover elevation §1.3 allows.
 *
 * `end-0` is the logical opt-in the flip resolves to; the `start` case states no inset at all,
 * because an absolutely positioned box with neither edge set already resolves to its static
 * position — the anchor's leading edge — in both writing directions, with no utility that could be
 * got the wrong way round. `Popover` documents the same reasoning at length.
 */
export function anchoredPanelClass(align: AnchorAlign): string {
    return align === 'end'
        ? 'absolute top-full z-tooltip mt-1 end-0 flex-col rounded-md border border-stroke-subtle bg-surface-raised shadow-elevation-3'
        : 'absolute top-full z-tooltip mt-1 flex-col rounded-md border border-stroke-subtle bg-surface-raised shadow-elevation-3';
}
