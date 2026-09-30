import type { Animated } from 'react-native';

/**
 * Starts an entrance once the frame that mounted it has been painted, and returns its cleanup.
 *
 * An entrance is started from an effect, as its component commits — before the browser has laid out
 * and painted what was just mounted. A page commit is the heaviest frame there is: on the web the
 * Ingredients list took ~150ms to lay out and paint in development, and an entrance whose clock
 * started before that frame was most of the way through its curve by the time its first frame was
 * drawn. So the first band popped in rather than rising, and the bands behind it — whose 40ms and
 * 80ms delays expired during the same stall — then started together, turning a cascade into a pop
 * followed by a pair.
 *
 * Two frames, not one. The first `requestAnimationFrame` callback runs *before* the mounting frame's
 * layout and paint, so a clock started there still pays for them; the second runs once that frame
 * is on screen, and every step of the curve after it is drawn. The cost is two frames of the
 * content's first state — which for an entrance is invisible, so nothing is shown late.
 *
 * `onFinish` runs when the animation completes, and not when it is stopped by the cleanup.
 */
export function startAfterPaint(
    animation: Animated.CompositeAnimation,
    onFinish?: () => void,
): () => void {
    let second: number | null = null;
    const first = requestAnimationFrame(() => {
        second = requestAnimationFrame(() => {
            second = null;
            animation.start(({ finished }) => {
                if (finished) onFinish?.();
            });
        });
    });

    return () => {
        cancelAnimationFrame(first);
        if (second !== null) cancelAnimationFrame(second);
        animation.stop();
    };
}
