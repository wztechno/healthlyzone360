import type { AnchoredLayerProps } from './anchored-layer-shared.ts';

/**
 * Where an open anchored panel is mounted — native.
 *
 * On native the panel stays in place, hanging from its trigger's container by the absolute
 * positioning {@link anchoredPanelClass} gives it: there is no document to lift it into and no
 * `z-index: 0` on every view to trap it. The web build (`anchored-layer.web.tsx`) is where the panel
 * leaves the tree it was declared in.
 */

/** Whether the panel is lifted out of its trigger's tree, and so positions itself. */
export const PANEL_IS_LIFTED = false;

export function AnchoredLayer({ children }: AnchoredLayerProps) {
    return <>{children}</>;
}
