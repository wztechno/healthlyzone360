import { useLayoutEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';

import type { AnchoredLayerProps } from './anchored-layer-shared.ts';

/**
 * Where an open anchored panel is mounted — web: on `document.body`, at the trigger's screen box.
 *
 * ## Why a panel cannot simply out-rank the page
 *
 * react-native-web renders most `View`s with `position: relative; z-index: 0`, and a positioned box
 * with a z-index *is* a stacking context. So every view is one, and a z-index only ever orders an
 * element against its siblings inside its parent. `Dropdown` used to raise its own container to
 * `z-tooltip` while open, which beat the siblings in the same row — and nothing else: the toolbar
 * the trigger sat in was still `z-index: 0`, and the table painted after it covered the panel. Every
 * dropdown on every page had the same ceiling, set by whichever ancestor it happened to be inside.
 * Scroll ports and `overflow-hidden` cards clipped it on top of that.
 *
 * Lifting the panel out of the tree is the fix that does not depend on the ancestors. A portal keeps
 * it in the React tree — context, density, i18n and synthetic events all still flow from the
 * trigger — while the DOM node sits on `body`, above everything the page draws.
 *
 * ## Placement
 *
 * Fixed, from the trigger's `getBoundingClientRect`: under it by default, above it when there is no
 * room below and there is room above. `start` hangs from the trigger's leading edge (left in LTR,
 * right in RTL) and `end` from its trailing edge, the same meaning `anchoredPanelClass` gives them in
 * place. It is re-placed on any scroll — captured, because the page scrolls inside the shell's
 * `ScrollView` rather than the window — on resize, and when the panel's own size changes.
 *
 * Theme and direction need nothing: both are set on `<html>`, which `body` sits inside.
 */

export const PANEL_IS_LIFTED = true;

/** The 4px gap between trigger and panel — `mt-1`, which the in-place panel uses. */
const GAP = 4;

interface Placement {
    readonly top: number;
    readonly left?: number;
    readonly right?: number;
    readonly direction: 'ltr' | 'rtl';
}

interface ReactDomPortal {
    readonly createPortal: (children: ReactNode, container: Element) => ReactNode;
}

// `react-dom` is what react-native-web renders through, so it is always present on the web; its
// types are not installed, and this is the one function the package needs from it.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { createPortal } = require('react-dom') as ReactDomPortal;

export function AnchoredLayer({ anchorRef, align, children }: AnchoredLayerProps) {
    const layerRef = useRef<HTMLDivElement | null>(null);
    const [placement, setPlacement] = useState<Placement | null>(null);

    useLayoutEffect(() => {
        const place = () => {
            const anchor = anchorRef.current as HTMLElement | null;
            const layer = layerRef.current;
            if (anchor === null) return;

            const rect = anchor.getBoundingClientRect();
            const viewportWidth = document.documentElement.clientWidth;
            const viewportHeight = window.innerHeight;
            const direction = getComputedStyle(anchor).direction === 'rtl' ? 'rtl' : 'ltr';

            const height = layer?.offsetHeight ?? 0;
            const below = rect.bottom + GAP;
            const above = rect.top - GAP - height;
            const top = below + height > viewportHeight && above >= 0 ? above : below;

            // `start` is the leading edge: left in LTR, right in RTL.
            const fromLeft = (align === 'start') === (direction === 'ltr');
            setPlacement(
                fromLeft
                    ? { top, left: rect.left, direction }
                    : { top, right: viewportWidth - rect.right, direction },
            );
        };

        place();
        window.addEventListener('scroll', place, true);
        window.addEventListener('resize', place);
        const observer =
            typeof ResizeObserver === 'undefined' || layerRef.current === null
                ? null
                : new ResizeObserver(place);
        if (observer !== null && layerRef.current !== null) observer.observe(layerRef.current);

        return () => {
            window.removeEventListener('scroll', place, true);
            window.removeEventListener('resize', place);
            observer?.disconnect();
        };
    }, [anchorRef, align]);

    if (typeof document === 'undefined') return <>{children}</>;

    return createPortal(
        <div
            ref={layerRef}
            dir={placement?.direction}
            className="fixed z-tooltip flex flex-col"
            style={{
                top: placement?.top ?? 0,
                left: placement?.left,
                right: placement?.right,
                // Measured before it is shown, so the first frame is never at the page's corner.
                visibility: placement === null ? 'hidden' : 'visible',
            }}
        >
            {children}
        </div>,
        document.body,
    );
}
