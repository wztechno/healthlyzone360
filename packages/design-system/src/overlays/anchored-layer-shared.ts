import type { ReactNode } from 'react';

import type { AnchorAlign, NodeRef } from './anchored-surface.ts';

export interface AnchoredLayerProps {
    /** The trigger's container — the box the panel hangs from. */
    readonly anchorRef: NodeRef;
    readonly align: AnchorAlign;
    readonly children: ReactNode;
}
