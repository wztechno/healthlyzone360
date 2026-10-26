import { Platform } from 'react-native';

/** How long the ring takes to bloom and fade: long enough to find, short enough not to nag. */
export const SPOTLIGHT_DURATION_MS = 1600;

/** How far up from a bare control the spotlight looks for the frame the reader actually sees. */
const FRAME_SEARCH_DEPTH = 4;

const RING = 'rgb(var(--h360-color-focus-ring) /';

/**
 * Points at the element with this id: a ring that blooms around it, holds, and fades.
 *
 * What a tray card's Fix does after it has opened the right tab and scrolled the field into view —
 * the scroll alone leaves the reader hunting for which of a dozen fields it meant. Web only: on
 * native there is no element to find by id, and the focus the caller gives the field is the cue.
 *
 * ## The frame, not the control
 *
 * A field's id is on its `<input>`, which sits *inside* the bordered frame the reader sees — 18px of
 * text box in a 28px frame. A ring on the input reads as a grey smudge inside the field (measured
 * 2026-10-26). So for a control, or for an anchor with no size of its own, the ring goes on the
 * nearest ancestor that draws a border: the field's frame, or the section card around an anchor.
 *
 * ## How it is drawn
 *
 * With the Web Animations API rather than a class, so it needs no stylesheet rule (and no dev-server
 * restart), cannot collide with the element's own classes, and removes itself. A firm 2px ring with
 * a soft halo outside it, in the focus-ring token read through its CSS variable, so it follows the
 * theme. Under `prefers-reduced-motion` it does nothing: the focus ring the field already gets is
 * the cue.
 */
export function spotlightElement(id: string): void {
    if (Platform.OS !== 'web' || typeof document === 'undefined') return;
    if (
        typeof window !== 'undefined' &&
        window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    )
        return;

    const element = document.getElementById(id);
    if (element === null) return;
    const target = spotlightTarget(element);
    if (typeof target.animate !== 'function') return;

    target.animate(
        [
            { boxShadow: `0 0 0 0 ${RING} 0), 0 0 0 0 ${RING} 0)` },
            { boxShadow: `0 0 0 2px ${RING} 0.9), 0 0 0 7px ${RING} 0.22)`, offset: 0.2 },
            { boxShadow: `0 0 0 2px ${RING} 0.7), 0 0 0 7px ${RING} 0.14)`, offset: 0.7 },
            { boxShadow: `0 0 0 0 ${RING} 0), 0 0 0 0 ${RING} 0)` },
        ],
        { duration: SPOTLIGHT_DURATION_MS, easing: 'ease-out' },
    );
}

/** The element the reader sees: itself, or for a bare control or an empty anchor, its frame. */
function spotlightTarget(element: HTMLElement): HTMLElement {
    const control = /^(INPUT|TEXTAREA|SELECT)$/.test(element.tagName);
    const box = element.getBoundingClientRect();
    if (!control && box.width > 0 && box.height > 0) return element;

    let node = element.parentElement;
    for (let depth = 0; node !== null && depth < FRAME_SEARCH_DEPTH; depth += 1) {
        if (Number.parseFloat(getComputedStyle(node).borderTopWidth) > 0) return node;
        node = node.parentElement;
    }
    return element;
}
