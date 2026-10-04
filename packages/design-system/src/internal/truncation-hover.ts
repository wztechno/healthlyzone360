import { Platform } from 'react-native';

import { showFloatingLabel } from '../actions/floating-label.ts';
import type { FloatingLabel } from '../actions/floating-label.ts';

/**
 * The whole value of a clipped table cell, shown on hover.
 *
 * A cell is one line (see `TableCellTextContext`), so a value longer than its column ends in an
 * ellipsis. The reader still has to be able to read it without opening the row: on the web, hovering
 * the text shows it in full in the same floating label an icon button's name uses — a fixed element
 * on `document.body`, so no row or header edge can clip it.
 *
 * Only when the text **is** clipped. A label repeating a value that is already on screen in full
 * would be noise on every row the pointer crosses, so the handler measures first: a single-line
 * value overflows sideways, a clamped one downward.
 *
 * Spread rather than declared, as `keyDownProps` is: React Native does not type mouse events, and
 * react-native-web forwards them to the DOM node. Native has no hover, and gets nothing.
 */

interface Overflowable {
    readonly scrollWidth: number;
    readonly clientWidth: number;
    readonly scrollHeight: number;
    readonly clientHeight: number;
    readonly textContent: string | null;
}

interface HoverEvent {
    readonly currentTarget: unknown;
}

/** One label at a time: entering a second cell before leaving the first must not leave a ghost. */
let shown: FloatingLabel | null = null;

function hide() {
    shown?.hide();
    shown = null;
}

/** True when the element's text does not fit its box. Exported for the unit test. */
export function isClipped(node: Overflowable): boolean {
    return node.scrollWidth > node.clientWidth + 1 || node.scrollHeight > node.clientHeight + 1;
}

const WEB_PROPS = {
    onMouseEnter: (event: HoverEvent) => {
        hide();
        const node = event.currentTarget as Overflowable | null;
        if (node === null || !isClipped(node)) return;
        const text = node.textContent?.trim() ?? '';
        if (text === '') return;
        shown = showFloatingLabel(node, text, 'table-cell-full-value', 'below', { wrap: true });
    },
    onMouseLeave: hide,
} as const;

export const truncationHoverProps: Readonly<Record<string, unknown>> =
    Platform.OS === 'web' ? WEB_PROPS : {};
