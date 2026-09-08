import { useCallback, useEffect, useId, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { View } from 'react-native';

import { cx } from '../internal/class-names.ts';
import { webRole } from '../internal/web-props.ts';
import {
    anchoredPanelClass,
    useAnchorFlip,
    useDismiss,
    usePointerSwallow,
} from './anchored-surface.ts';
import type { AnchorAlign } from './anchored-surface.ts';

/**
 * Dropdown — an anchored panel, and the mechanism `Menu` and (later) `SearchSelect` are built from.
 *
 * It is deliberately *only* the mechanism: anchoring, dismissal, the `pointerdown` swallow and the
 * edge flip. It has no opinion about what is inside it, which is what lets a menu of row actions, a
 * column's filter list and a search result list share one implementation of the two bugs in §4.3
 * rather than three near-copies that each fix one of them.
 *
 * ## Why the trigger is a render prop
 *
 * The triggers are not a family. A row's overflow is an icon button; a column header is a label
 * that turns brand-coloured and grows a `▽` when a filter is active; a `SearchSelect`'s is a text
 * input. Enumerating those as variants would put presentation this component cannot see inside it.
 * So the caller draws the trigger and this component hands back the state and the ARIA wiring it
 * must carry — `aria-expanded` and `aria-controls` in particular, which is the pair a hand-rolled
 * trigger always forgets.
 *
 * Contrast with `Popover`, which owns its trigger because it has exactly two of them and they are
 * both text. Neither component is the other's replacement: `Popover` is a footnote, `Dropdown` is a
 * control that leads somewhere.
 */

/** The ARIA wiring a hand-drawn trigger must carry, handed back so it cannot be forgotten. */
export interface DropdownTriggerProps {
    readonly 'aria-expanded': boolean;
    readonly 'aria-controls': string;
    readonly 'aria-haspopup': 'menu' | 'listbox' | 'dialog';
    readonly accessibilityState: { readonly expanded: boolean };
}

export interface DropdownRenderState {
    readonly open: boolean;
    readonly triggerProps: DropdownTriggerProps;
    readonly toggle: () => void;
    readonly close: () => void;
}

export interface DropdownProps {
    /** Draws the trigger. Spread `triggerProps` onto whatever element it returns. */
    readonly trigger: (state: DropdownRenderState) => ReactNode;
    /** The panel's contents. Rendered only while open — a closed panel is not in the tree at all. */
    readonly children: ReactNode | ((state: DropdownRenderState) => ReactNode);
    /**
     * Which edge to hang from *when it fits*. `start` (the default) is measured and flipped to
     * `end` when the panel would run past the reference box; a stated `end` is honoured as-is.
     */
    readonly align?: AnchorAlign | undefined;
    /** What the panel is, for assistive technology. `menu` for `Menu`, `listbox` for a result list. */
    readonly role?: 'menu' | 'listbox' | 'dialog' | undefined;
    readonly label: string;
    /**
     * Told when the panel opens or closes, whatever moved it — the trigger, an outside press,
     * Escape or the panel's own `close`.
     *
     * A trigger that keeps state of its own has no other way to learn this. `Select`'s search
     * trigger is the case: it holds a query that must not outlive the panel, and the routes that
     * close a `Dropdown` do not all blur the input, so there is no event of its own to hang the
     * reset on. Deriving it inside the trigger render prop is not the alternative it looks like —
     * that render runs inside *this* component's render, so writing trigger state there is a
     * cross-component update during render, which is the warning this callback exists to avoid.
     *
     * Fired after commit and only on a real change, so it is safe to set state from.
     */
    readonly onOpenChange?: ((open: boolean) => void) | undefined;
    readonly panelClassName?: string | undefined;
    readonly className?: string | undefined;
    readonly testID?: string | undefined;
}

export function Dropdown({
    trigger,
    children,
    align = 'start',
    role = 'menu',
    label,
    onOpenChange,
    panelClassName,
    className,
    testID,
}: DropdownProps) {
    const generated = useId();
    const base = testID ?? `dropdown-${generated.replace(/:/g, '')}`;
    const panelId = `${base}-panel`;

    const [open, setOpen] = useState(false);
    const containerRef = useRef<View | null>(null);
    const panelRef = useRef<View | null>(null);

    const close = useCallback(() => {
        setOpen(false);
    }, []);
    const toggle = useCallback(() => {
        setOpen((current) => !current);
    }, []);

    // Guarded on the previous value rather than fired bare, so mounting closed is not reported as
    // a close and an inline `onOpenChange` re-running the effect is not reported as anything.
    const previousOpen = useRef(open);
    useEffect(() => {
        if (previousOpen.current === open) return;
        previousOpen.current = open;
        onOpenChange?.(open);
    }, [open, onOpenChange]);

    useDismiss({ open, onClose: close, containerRef });
    const resolvedAlign = useAnchorFlip({ open, anchorRef: containerRef, panelRef, preferred: align });
    const swallow = usePointerSwallow();

    const state: DropdownRenderState = {
        open,
        triggerProps: {
            'aria-expanded': open,
            'aria-controls': panelId,
            'aria-haspopup': role,
            accessibilityState: { expanded: open },
        },
        toggle,
        close,
    };

    return (
        /*
         * The container takes the stacking context while open, not just the panel.
         *
         * `z-tooltip` on an absolutely positioned panel only orders it against *its own* stacking
         * context. Its ancestors have none, so a section further down the form — a later sibling,
         * painted later — covered the panel regardless of how high its own z-index went. The fix is
         * to raise the whole subtree the panel hangs from; `z-base` when closed so a form of twelve
         * fields is not twelve competing layers.
         */
        <View
            ref={containerRef}
            testID={testID}
            className={cx('flex-col', open ? 'z-tooltip' : 'z-base', className)}
        >
            {trigger(state)}

            {open ? (
                <View
                    ref={panelRef}
                    testID={panelId}
                    nativeID={panelId}
                    // `listbox` is outside React Native's `Role` union and this panel is a real
                    // `<div role="listbox">` on the web, where a result list has to announce as
                    // one. `webRole` is where that mismatch is reconciled.
                    {...webRole(role)}
                    accessibilityRole={role === 'menu' ? 'menu' : 'none'}
                    aria-label={label}
                    accessibilityLabel={label}
                    // The swallow is the whole reason this component exists rather than each call
                    // site composing `Popover` with a list. See `anchored-surface.ts`.
                    {...swallow}
                    className={cx(anchoredPanelClass(resolvedAlign), panelClassName)}
                >
                    {typeof children === 'function' ? children(state) : children}
                </View>
            ) : null}
        </View>
    );
}
