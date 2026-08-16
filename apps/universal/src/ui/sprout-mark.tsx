import { useMotion } from '@healthy360/design-system';
import { useEffect, useState } from 'react';
import { Animated, Easing, View } from 'react-native';

/**
 * The mark that holds the pause while a session is restored.
 *
 * ## Why there are no words in it
 *
 * "Restoring your session…" appeared on nearly every cold load, which made a spinner and an
 * apology the first thing anyone saw of Healthy360. The sentence said nothing a person could act
 * on, and it said it in the place a product usually introduces itself. So the words are gone from
 * the screen and a four-leaf sprout stands there instead — growth being the plainest statement of
 * what the application is for. It turns slowly, and each leaf breathes a little behind the last.
 *
 * **The words are not gone from the page.** Dropping visible text is a visual decision, never an
 * accessibility one: this carries `role="progressbar"`, `aria-busy` and the same accessible name
 * the sentence used to be, so anyone listening still hears that the session is being restored.
 *
 * ## Why it is built from four rounded views
 *
 * A leaf here is one view with two opposite corners fully rounded — the same trick that draws a
 * leaf in a stylesheet, and the reason this needs no drawing library. That constraint is the design
 * system's, not a shortcut: `ProgressRing` draws its arc as twenty-four rotated views precisely
 * because an SVG library would be a *native* dependency. Anything in this position has to be
 * buildable the same way, and this is.
 *
 * Each leaf is placed with its pointed corner on the centre and rotated about that corner, so the
 * four of them fan out of one seed rather than orbiting a hole.
 *
 * ## Every frame is the finished drawing, and that is the point
 *
 * The first cut of this faded each leaf up from nothing, which meant frame zero was four invisible
 * leaves over one small seed. It shipped, the animation did not run on the web, and what people got
 * was a motionless green dot — a splash that looked broken rather than merely still.
 *
 * So the motion is now *modulation of a finished mark* rather than construction of one: the rosette
 * is whole at every instant, turning slowly, its leaves breathing between a little under and a
 * little over their own size. Stop the clock anywhere, including before the first tick, and what
 * remains is the sprout. That is also exactly what reduced motion gets — the tokens define a
 * reduced counterpart of exactly zero for every duration, so the still frame is not a fallback but
 * the design itself.
 */
export interface SproutMarkProps {
    /** The accessible name. This is what a screen reader hears in place of the old sentence. */
    readonly label: string;
    /** Outer square, in units. The leaves and the seed scale with it. */
    readonly size?: number | undefined;
    readonly testID?: string | undefined;
}

const DEFAULT_SIZE = 96;

/** One unfurl, in milliseconds. Unhurried on purpose: this is a wait, not a warning. */
const CYCLE_MS = 2400;

const LEAVES = 4;

/**
 * The leaf's share of the whole mark, and the seed's. Ratios rather than constants so a 24-unit
 * inline version and a 96-unit splash are the same drawing at two scales.
 */
const LEAF_RATIO = 0.354;
const SEED_RATIO = 0.094;

/** A piecewise-linear curve over one cycle, as `[position, value]` pairs in ascending position. */
type Curve = readonly (readonly [number, number])[];

/**
 * A leaf's life, and the seed's, over one cycle — the two curves the study settled on.
 *
 * The leaf comes up from almost nothing, holds open through the middle third, then fades as it
 * drifts a little past its own size. Its scale jumps back down at the wrap, which is invisible
 * because the opacity is zero on both sides of that seam.
 */
const LEAF_OPACITY: Curve = [
    [0, 0],
    [0.22, 1],
    [0.55, 1],
    [0.88, 0],
    [1, 0],
];
const LEAF_SCALE: Curve = [
    [0, 0.15],
    [0.55, 1],
    [1, 1.1],
];
const SEED_SCALE: Curve = [
    [0, 0.7],
    [0.5, 1.15],
    [1, 0.7],
];

/** The value of a piecewise-linear curve at `at`, which must lie in `[0, 1]`. */
function sample(curve: Curve, at: number): number {
    for (let index = 1; index < curve.length; index += 1) {
        const [from, fromValue] = curve[index - 1] as readonly [number, number];
        const [to, toValue] = curve[index] as readonly [number, number];
        if (at <= to) {
            const span = to - from;
            return span === 0 ? toValue : fromValue + ((at - from) / span) * (toValue - fromValue);
        }
    }
    return (curve[curve.length - 1] as readonly [number, number])[1];
}

/**
 * The same curve, played from `phase` instead of from zero.
 *
 * Four leaves have to be at four different points of one unfurl, and a phase offset cannot be
 * expressed as a delay: `Animated.loop` restarts from the value it began at, so a leaf started late
 * would run a shorter cycle for ever after. One clock drives everything instead, and each leaf reads
 * it through a curve that has been rotated by its own phase — which is also what keeps the four
 * exactly a quarter-cycle apart however long the animation runs.
 *
 * The wrap is cut at both ends with the curve's value *at* the phase, so no segment ever spans the
 * seam and the loop closes on itself seamlessly.
 */
function fromPhase(curve: Curve, phase: number) {
    const points = new Map<number, number>();
    const at = sample(curve, phase);
    points.set(0, at);
    points.set(1, at);
    for (const [stop, value] of curve) {
        points.set(Math.round(((stop - phase + 1) % 1) * 10000) / 10000, value);
    }

    const sorted = [...points.entries()].sort(([a], [b]) => a - b);
    return {
        inputRange: sorted.map(([position]) => position),
        outputRange: sorted.map(([, value]) => value),
    };
}

export function SproutMark({ label, size = DEFAULT_SIZE, testID }: SproutMarkProps) {
    const { enabled } = useMotion();

    const leaf = Math.round(size * LEAF_RATIO);
    const seed = Math.round(size * SEED_RATIO);
    const centre = size / 2;

    /*
     * One clock for the whole mark, read at four different phases.
     *
     * Held in lazily-initialised state rather than in a ref, because it is read while rendering —
     * every leaf's style is derived from it — and a ref read during render is exactly what
     * `react-hooks/refs` forbids. The initialiser runs once, so the value is as stable as a ref's.
     */
    const [clock] = useState(() => new Animated.Value(0));

    useEffect(() => {
        if (!enabled) return;

        /*
         * Linear, and deliberately so. The easing lives in the *curves* instead: warping one shared
         * clock would warp each leaf's phase differently and the four would stop being a quarter of
         * a cycle apart.
         */
        const loop = Animated.loop(
            Animated.timing(clock, {
                toValue: 1,
                duration: CYCLE_MS,
                easing: Easing.linear,
                useNativeDriver: true,
            }),
        );
        loop.start();

        return () => {
            loop.stop();
            clock.setValue(0);
        };
    }, [enabled, clock]);

    /*
     * A quarter of a cycle between leaves, which is what stops the mark ever emptying.
     *
     * The study staggered the four by a sixth of a second, so they were effectively in step and the
     * whole sprout blinked out together once a cycle. That is fine to watch on a page and wrong for
     * a splash: a session restores in a couple of hundred milliseconds, and landing in the blink
     * shows a bare seed — the green dot this arrived as. Spread evenly, the fade of one leaf is
     * always the unfurling of another, and no instant of the loop is blank.
     */
    const phaseOf = (index: number) => index / LEAVES;

    return (
        <View
            testID={testID}
            role="progressbar"
            accessibilityRole="progressbar"
            accessibilityLabel={label}
            aria-label={label}
            aria-busy
            aria-live="polite"
            style={{ width: size, height: size }}
        >
            {Array.from({ length: LEAVES }, (_unused, index) => (
                /*
                 * The animated view carries no `className`, and that absence is load-bearing rather
                 * than stylistic: NativeWind resolves the style of any element it is given a class
                 * for, and resolving an interpolation reads it once — the view would then hold
                 * whatever number that interpolation had at frame zero, for ever. So every animated
                 * view here is bare and the colour goes on a child that may safely carry a class.
                 */
                <Animated.View
                    key={index}
                    testID={testID === undefined ? undefined : `${testID}-leaf-${String(index)}`}
                    aria-hidden
                    accessibilityElementsHidden
                    importantForAccessibility="no-hide-descendants"
                    style={{
                        position: 'absolute',
                        // Centred in the box and turned about its own pointed corner, so the four
                        // sweep out of the seed rather than pivoting on the middle of the mark.
                        left: centre - leaf / 2,
                        top: centre - leaf / 2,
                        width: leaf,
                        height: leaf,
                        transformOrigin: '0% 100%',
                        opacity: enabled
                            ? clock.interpolate(fromPhase(LEAF_OPACITY, phaseOf(index)))
                            : 1,
                        transform: [
                            { rotate: `${String(45 + index * (360 / LEAVES))}deg` },
                            {
                                scale: enabled
                                    ? clock.interpolate(fromPhase(LEAF_SCALE, phaseOf(index)))
                                    : 1,
                            },
                        ],
                    }}
                >
                    <View
                        className="bg-surface-brand"
                        style={{
                            width: leaf,
                            height: leaf,
                            borderTopLeftRadius: leaf,
                            borderBottomRightRadius: leaf,
                        }}
                    />
                </Animated.View>
            ))}

            {/* The seed the leaves come out of. It breathes with them, and holds the centre. */}
            <Animated.View
                testID={testID === undefined ? undefined : `${testID}-seed`}
                aria-hidden
                accessibilityElementsHidden
                importantForAccessibility="no-hide-descendants"
                style={{
                    position: 'absolute',
                    width: seed,
                    height: seed,
                    left: centre - seed / 2,
                    top: centre - seed / 2,
                    opacity: 0.9,
                    transform: [
                        { scale: enabled ? clock.interpolate(fromPhase(SEED_SCALE, 0)) : 1 },
                    ],
                }}
            >
                <View
                    className="bg-surface-brand"
                    style={{ width: seed, height: seed, borderRadius: seed }}
                />
            </Animated.View>
        </View>
    );
}
