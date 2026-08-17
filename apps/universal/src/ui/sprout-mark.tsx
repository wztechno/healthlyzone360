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
 * the screen and a sprout grows there instead — growth being the plainest statement of what the
 * application is for. Four leaves come up out of a seed, each starting before the one before it has
 * finished opening, and fade the same way.
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
 * Each leaf is centred in the mark and turned about its own pointed corner, so the four corners meet
 * below and left of the middle while the seed stays in the middle — which is what tucks the seed
 * into the top-right of the rosette rather than burying it where the leaves cross.
 *
 * ## It is a transcription, not an interpretation
 *
 * Every number here is read off `splash-studies.html`, the five-option study this was chosen from:
 * the 2.4s cycle, the four keyframes of `unfurl`, the 0.16s between leaves, the 45° start and the
 * quarter turn between them, the `cubic-bezier(.22, .68, .3, 1)`, the leaf at 34/96 of the mark and
 * the seed at 9/96. Where an implementation detail differs — the ease baked into the curves rather
 * than applied to the clock, the cycle restarted by hand rather than by `Animated.loop` — it is
 * because the platform needs it to *stay* the same, never because a better idea turned up.
 *
 * That rule is written down because breaking it cost several rounds. A quarter-cycle stagger, a
 * recentred pivot and a clock that started mid-unfurl were all defensible in isolation and all
 * wrong: each one quietly replaced the thing that had been picked.
 *
 * ## Under reduced motion it stands still, fully grown
 *
 * The tokens define a reduced counterpart of exactly zero for every duration — removal, not a slower
 * sweep — so the resting frame is the open rosette, which is the one frame of this loop worth
 * holding.
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

/** The study's 0.16s delay between leaves, as a fraction of the cycle. */
const LEAF_STAGGER = 160 / CYCLE_MS;

/**
 * The study's timing function, applied *within each segment* of the curve — which is what CSS does
 * with `animation-timing-function`, and therefore what the study does.
 *
 * It is baked into the curves rather than applied to the clock. Easing the clock would squeeze and
 * stretch the gaps between the four leaves, so the 0.16s that separates them would not stay 0.16s;
 * a linear clock keeps the stagger exactly what the study set it to.
 */
const UNFURL_EASING = Easing.bezier(0.22, 0.68, 0.3, 1);

/** How many points each segment is resolved into when the easing is baked in. */
const EASING_STEPS = 8;

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

/**
 * The same curve with the timing function resolved into it, segment by segment.
 *
 * CSS eases *between keyframes*, not across the whole animation, so each pair of stops here gets
 * its own pass of the bezier. Once the shape of the ease lives in the curve, the clock underneath
 * can stay linear — which is what keeps the four leaves exactly 0.16s apart however far into the
 * loop they are.
 */
function eased(curve: Curve): Curve {
    const points: (readonly [number, number])[] = [];

    for (let index = 1; index < curve.length; index += 1) {
        const [from, fromValue] = curve[index - 1] as readonly [number, number];
        const [to, toValue] = curve[index] as readonly [number, number];

        for (let step = index === 1 ? 0 : 1; step <= EASING_STEPS; step += 1) {
            const progress = step / EASING_STEPS;
            points.push([
                from + (to - from) * progress,
                fromValue + (toValue - fromValue) * UNFURL_EASING(progress),
            ]);
        }
    }

    return points;
}

/** The two leaf curves with the study's timing function already resolved into them. */
const EASED_LEAF_OPACITY = eased(LEAF_OPACITY);
const EASED_LEAF_SCALE = eased(LEAF_SCALE);

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

        let cancelled = false;

        /*
         * The cycle restarts itself instead of using `Animated.loop`.
         *
         * `loop` shipped here first and stopped after a pass or two on the web, leaving a sprout
         * frozen mid-unfurl for the rest of the wait. Its contract is that one interrupted
         * iteration ends the whole loop — it hands the completion straight back and never restarts
         * — and on a splash there is plenty to interrupt it: the tree above re-renders as the
         * session resolves, and the tab is often still settling its first frames.
         *
         * Restarting by hand takes that decision back. An iteration that finishes starts the next
         * one; an iteration that is *interrupted* also starts the next one, because on a loading
         * mark "something disturbed the animation" is never a reason to stand still for the rest
         * of the wait. Only the effect's own teardown stops it, and that is what `cancelled` is
         * for.
         *
         * The clock carries the study's own easing. Warping a shared clock does warp each leaf's
         * phase — but the four sit a sixteenth of a cycle apart, so they are warped together and
         * stay in the same relation, and the alternative is a linear unfurl, which reads as
         * mechanical next to the thing that was chosen.
         */
        const runCycle = () => {
            if (cancelled) return;
            clock.setValue(0);
            Animated.timing(clock, {
                toValue: 1,
                duration: CYCLE_MS,
                easing: Easing.linear,
                useNativeDriver: true,
            }).start(() => {
                runCycle();
            });
        };

        runCycle();

        return () => {
            cancelled = true;
            clock.stopAnimation();
            clock.setValue(0);
        };
    }, [enabled, clock]);

    /*
     * `animation-delay: 0s, 0.16s, 0.32s, 0.48s` — the study's four leaves, and nothing else.
     *
     * A delay puts a leaf *behind* the clock, so leaf `n` reads the curve from `1 − n × stagger`.
     * The first leaf therefore begins the cycle at the very start of the unfurl, which is a bare
     * seed: the sprout grows out of nothing, one leaf at a time, each starting before the last has
     * finished, and fades the same way. That is the drawing that was chosen and it is not this
     * component's business to improve on it.
     *
     * Two "improvements" were made here and both were wrong. Spreading the four a quarter-cycle
     * apart stopped the mark ever emptying and turned a plant into four things chasing each other.
     * Starting the clock mid-unfurl kept the first frame full and quietly removed the moment the
     * whole thing grows from the seed.
     */
    const phaseOf = (index: number) => (1 - index * LEAF_STAGGER) % 1;

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
                        /*
                         * Centred in the mark and turned about its own pointed corner, exactly as
                         * the study has it. The four corners therefore meet *below and left* of
                         * the middle, while the seed stays in the middle — which is what tucks the
                         * seed into the top-right of the rosette instead of burying it under the
                         * point where the leaves cross.
                         *
                         * This was briefly "corrected" to put the meeting point in the middle. It
                         * is more symmetrical that way and it is not the drawing that was chosen.
                         */
                        left: centre - leaf / 2,
                        top: centre - leaf / 2,
                        width: leaf,
                        height: leaf,
                        transformOrigin: '0% 100%',
                        opacity: enabled
                            ? clock.interpolate(fromPhase(EASED_LEAF_OPACITY, phaseOf(index)))
                            : 1,
                        transform: [
                            { rotate: `${String(45 + index * (360 / LEAVES))}deg` },
                            {
                                scale: enabled
                                    ? clock.interpolate(fromPhase(EASED_LEAF_SCALE, phaseOf(index)))
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
