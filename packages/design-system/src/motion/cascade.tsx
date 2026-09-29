import {
    Children,
    Fragment,
    cloneElement,
    isValidElement,
    useEffect,
    useRef,
    useState,
} from 'react';
import type { ReactNode } from 'react';
import { Animated } from 'react-native';

import { AnimatedView } from '../internal/animated-view.ts';
import { cx } from '../internal/class-names.ts';
import { Stack } from '../primitives/stack.tsx';
import type { StackProps } from '../primitives/stack.tsx';
import { startAfterPaint } from './start-after-paint.ts';
import { useMotion } from './use-motion.ts';
import type { DurationName, MotionDistanceName } from './use-motion.ts';

/**
 * A page arriving: its bands rise into place one after another, top to bottom.
 *
 * `Cascade` is a `Stack` — same spacing, same props — whose direct children each enter through a
 * {@link CascadeItem}: a short rise and a fade, 40ms behind the band above it, capped by `stagger`
 * so a long page never queues. Swapping a screen's root `Stack` for a `Cascade` is the whole
 * change a page needs to arrive this way.
 *
 * ## An item settles into nothing
 *
 * While it moves, an item is an animated box with a transform. Once it has arrived it is drawn with
 * no style of its own — no transform, no opacity — and `z-auto`, exactly like the `Stack` it sits
 * in. That matters more than it looks. A transform makes a stacking context, and a `DatePicker`'s
 * or a `Popover`'s panel is drawn inline, escaping its band only because every box above it opts out
 * of depth (`Stack`'s `LAYER_CLASS`). An item that kept `translateY(0)` after arriving would trap
 * those panels under the next band down for as long as the page was open.
 *
 * ## What is not a band
 *
 * `null` and `false` children are dropped and a fragment's children are cascaded one by one, so a
 * conditional band or a grouped pair behaves exactly as it did in the `Stack`. A child that renders
 * nothing in place — a `Dialog`, whose surface is portalled — leaves its item empty, and an empty
 * item is hidden on the web so it takes no gap. (On native the empty item still takes one gap; the
 * surfaces that cascade are desk pages.)
 *
 * A band that has to fill the page's height is not a band: the item is a plain column, so a child
 * with `flex-1` will not grow through it. Use a `Stack` for that layout.
 */
export interface CascadeProps extends StackProps {
    /**
     * The first child's place in an enclosing cascade, so a nested list continues the page's count
     * rather than starting its own at zero and arriving alongside the page's first band. A
     * `Cascade` placed directly in another is given this automatically.
     */
    readonly startIndex?: number | undefined;
    readonly children?: ReactNode;
}

export function Cascade({ startIndex = 0, children, ...stack }: CascadeProps) {
    const bands = flatten(children);

    /*
     * The stagger orders the page's first arrival and nothing after it. A band that mounts later —
     * a callout once a save lands, the next step's section — is answering something the reader
     * just did, and holding it back behind a delay meant for the eighth band of a page load would
     * read as lag. It still rises in, but at once. Set after the first commit, so a render that is
     * thrown away before it commits still counts as the first arrival.
     */
    const arrived = useRef(false);
    useEffect(() => {
        arrived.current = true;
    }, []);
    const place = (index: number) => (arrived.current ? 0 : startIndex + index);

    return (
        <Stack {...stack}>
            {bands.map(({ key, node }, index) => {
                /*
                 * A cascade inside a cascade is not a band of its own. Wrapped, it would rise
                 * once as a whole and again item by item, and its first item would arrive twice
                 * as far and half as fast as everything around it. Unwrapped, its items simply
                 * continue this one's count.
                 */
                if (isValidElement<CascadeProps>(node) && node.type === Cascade) {
                    return cloneElement(node, { key, startIndex: place(index) });
                }
                /*
                 * A band that needs its box styled — a panel kept mounted but hidden, whose
                 * `display: none` has to be on the box the gap is counted against — is passed as a
                 * `CascadeItem` of its own. It keeps its props and takes its place in the count.
                 */
                if (isValidElement<CascadeItemProps>(node) && node.type === CascadeItem) {
                    return cloneElement(node, { key, index: place(index) });
                }
                return (
                    <CascadeItem key={key} index={place(index)} className="web:empty:hidden">
                        {node}
                    </CascadeItem>
                );
            })}
        </Stack>
    );
}

interface Band {
    /** Unique among the cascade's bands, however deep in fragments the band was written. */
    readonly key: string;
    readonly node: ReactNode;
}

/**
 * The children as bands: `null`/`false` dropped, fragments opened.
 *
 * `Children.toArray` keys each level from `.0` again, so a fragment's first child and the
 * cascade's own first child would both be `.0` — two bands React could not tell apart, which it
 * reports and then reconciles unpredictably. A fragment's children are keyed under the fragment's
 * own key instead, so every band's key is its path.
 */
function flatten(children: ReactNode, prefix = ''): Band[] {
    return Children.toArray(children).flatMap((child, index) => {
        const key = `${prefix}${isValidElement(child) && child.key !== null ? child.key : String(index)}`;
        return isValidElement<{ readonly children?: ReactNode }>(child) && child.type === Fragment
            ? flatten(child.props.children, `${key}/`)
            : [{ key, node: child }];
    });
}

export interface CascadeItemProps {
    /**
     * The item's place in the cascade. Read once, when it mounts — see below. Inside a `Cascade`
     * the cascade assigns it, so a screen passing its own item can give any number.
     */
    readonly index: number;
    readonly distance?: MotionDistanceName | undefined;
    readonly duration?: DurationName | undefined;
    readonly className?: string | undefined;
    readonly testID?: string | undefined;
    readonly children?: ReactNode;
}

/**
 * One step of a cascade: rises `distance` and fades in, `stagger(index)` after the cascade starts.
 *
 * The delay is taken once, at mount. An index moves whenever something above the item appears or
 * goes — a banner once the data lands, a row when the list is re-sorted — and an entrance keyed on
 * the live index would send every item below that change back through its arrival. An item that is
 * already on the page has already arrived.
 *
 * Under reduced motion the item is settled from its first frame: drawn in place, fully opaque, with
 * no transform, and nothing can leave it invisible.
 */
export function CascadeItem({
    index,
    distance = 'small',
    duration = 'slow',
    className,
    testID,
    children,
}: CascadeItemProps) {
    const { enabled, durations, distances, easing, stagger } = useMotion();
    const [delayMs] = useState(() => stagger(index));
    const progress = useRef(new Animated.Value(0)).current;
    const [settled, setSettled] = useState(false);
    const settledRef = useRef(false);
    const travel = distances[distance];

    useEffect(() => {
        if (settledRef.current) return undefined;
        const settle = () => {
            settledRef.current = true;
            setSettled(true);
        };
        if (!enabled) {
            settle();
            return undefined;
        }

        progress.setValue(0);
        return startAfterPaint(
            Animated.timing(progress, {
                toValue: 1,
                duration: durations[duration],
                delay: delayMs,
                easing: easing.decelerate,
                useNativeDriver: true,
            }),
            settle,
        );
    }, [enabled, progress, durations, duration, delayMs, easing]);

    const moving = enabled && !settled;

    return (
        <AnimatedView
            testID={testID}
            className={cx('z-auto flex-col', className)}
            style={
                moving
                    ? {
                          opacity: progress,
                          transform: [
                              {
                                  translateY: progress.interpolate({
                                      inputRange: [0, 1],
                                      outputRange: [travel, 0],
                                  }),
                              },
                          ],
                      }
                    : undefined
            }
        >
            {children}
        </AnimatedView>
    );
}
