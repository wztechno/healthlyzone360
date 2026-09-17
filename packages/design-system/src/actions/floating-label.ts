/**
 * The hover label an icon-only control shows on the web, drawn on `document.body`.
 *
 * ## Why it is not a child of the control
 *
 * It used to be an absolutely positioned `View` inside the button. React Native Web gives every
 * `View` `position: relative; z-index: 0`, so every ancestor is a stacking context and many clip:
 * the first row's label slid under the table's header edge, and the top bar's theme toggle drew its
 * label over the bar's own border. Nothing inside the tree can out-rank or out-draw an ancestor, so
 * the label leaves the tree: a fixed element on the body, placed from the control's viewport rect.
 *
 * ## Placement
 *
 * `below` (the default): under the control, centred on it, and flipped above only when below would
 * leave the window. `end`: beside it, at its inline end — the right in a left-to-right page, the left
 * in Arabic — vertically centred; the module rail's placement, where a label below would sit on the
 * next icon. Either is clamped to the window so a control at an edge keeps its label on screen.
 *
 * Colours are the theme's own CSS variables, so the label follows light and dark without asking.
 * It is `aria-hidden` and ignores the pointer: the control's accessible name already says this, and
 * a label that could be hovered would flicker the moment the pointer reached it.
 */

/** Clear of the control and of the hairline a bar or table row draws under it. */
const GAP = 10;
const EDGE = 4;

export interface FloatingLabel {
    readonly hide: () => void;
}

interface Measurable {
    readonly getBoundingClientRect?: () => {
        readonly top: number;
        readonly bottom: number;
        readonly left: number;
        readonly right: number;
        readonly width: number;
        readonly height: number;
    };
}

export function showFloatingLabel(
    target: unknown,
    text: string,
    testID?: string | undefined,
    placement: 'below' | 'end' = 'below',
): FloatingLabel | null {
    if (typeof document === 'undefined' || typeof window === 'undefined') return null;
    const rect = (target as Measurable | null)?.getBoundingClientRect?.();
    if (rect === undefined) return null;

    const label = document.createElement('div');
    label.textContent = text;
    label.setAttribute('aria-hidden', 'true');
    label.setAttribute('role', 'presentation');
    if (testID !== undefined) label.setAttribute('data-testid', testID);

    const font = target instanceof Element ? window.getComputedStyle(target).fontFamily : 'inherit';
    Object.assign(label.style, {
        position: 'fixed',
        top: '0px',
        left: '0px',
        zIndex: '2147483000',
        pointerEvents: 'none',
        whiteSpace: 'nowrap',
        padding: '4px 8px',
        borderRadius: '4px',
        fontFamily: font,
        fontSize: '12px',
        lineHeight: '16px',
        fontWeight: '500',
        background: 'rgb(var(--h360-color-brand-surface))',
        color: 'rgb(var(--h360-color-text-on-brand))',
        boxShadow: '0 2px 6px rgb(0 0 0 / 0.18)',
    });
    document.body.appendChild(label);

    const width = label.offsetWidth;
    const height = label.offsetHeight;
    let top: number;
    let left: number;
    if (placement === 'end') {
        const rtl =
            target instanceof Element && window.getComputedStyle(target).direction === 'rtl';
        top = rect.top + rect.height / 2 - height / 2;
        left = rtl ? rect.left - GAP - width : rect.right + GAP;
    } else {
        const below = rect.bottom + GAP;
        top = below + height > window.innerHeight - EDGE ? rect.top - GAP - height : below;
        left = rect.left + rect.width / 2 - width / 2;
    }
    top = Math.max(EDGE, Math.min(top, window.innerHeight - height - EDGE));
    left = Math.max(EDGE, Math.min(left, window.innerWidth - width - EDGE));
    label.style.top = `${String(Math.round(top))}px`;
    label.style.left = `${String(Math.round(left))}px`;

    return {
        hide: () => {
            label.remove();
        },
    };
}
