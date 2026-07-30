import { useEffect, useState } from 'react';

/**
 * True only once `active` has stayed true across a task-queue tick.
 *
 * Client-side redirects that depend on session state must not fire on the first render after a
 * navigation: `router.replace` renders the new route synchronously, while TanStack Query delivers
 * cache updates through a batched notification — so the destination's first frame can read a
 * context that is one update behind (this produced a picker → picker bounce loop). Deferring the
 * decision by a single tick lets every pending store notification flush; a condition that still
 * holds after that genuinely reflects the session and may redirect.
 */
export function useSettledCondition(active: boolean): boolean {
    const [settled, setSettled] = useState(false);
    const [previousActive, setPreviousActive] = useState(active);

    // Render-time derived-state reset (the React-sanctioned alternative to a setState-in-effect):
    // the moment the condition stops holding, "settled" is cleared in the same render pass.
    if (previousActive !== active) {
        setPreviousActive(active);
        if (!active) {
            setSettled(false);
        }
    }

    useEffect(() => {
        if (!active) {
            return undefined;
        }
        const timer = setTimeout(() => {
            setSettled(true);
        }, 0);
        return () => {
            clearTimeout(timer);
        };
    }, [active]);

    return active && settled;
}
