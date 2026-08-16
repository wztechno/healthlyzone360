import { useMotion } from '@healthy360/design-system';
import { useEffect, useState } from 'react';
import { Animated, View } from 'react-native';

/**
 * The mark that holds the pause while a session is restored.
 *
 * ## Why there are no words in it
 *
 * "Restoring your session…" appeared on nearly every cold load, which made a spinner and an
 * apology the first thing anyone saw of Healthy360. The sentence said nothing a person could act
 * on, and it said it in the place a product usually introduces itself. So the words are gone from
 * the screen and four leaves unfurl from a seed instead — growth being the plainest statement of
 * what the application is for.
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
 * ## Under reduced motion it stops, and that is the whole design
 *
 * The tokens define a reduced counterpart of exactly zero for every duration — reduced motion is
 * removal, not a slower version of the same sweep — so the resting frame has to be worth looking
 * at on its own. It is the open rosette: every leaf unfurled, nothing moving. `Shimmer` makes the
 * same call by not rendering its band at all.
 */
export interface SproutMarkProps {
    /** The accessible name. This is what a screen reader hears in place of the old sentence. */
    readonly label: string;
    /** Outer square, in units. The leaves and the seed scale with it. */
    readonly size?: number | undefined;
    readonly testID?: string | undefined;
}

const DEFAULT_SIZE = 96;

/** One full unfurl-and-fade, in milliseconds. Unhurried on purpose: this is a wait, not a warning. */
const CYCLE_MS = 2400;

/** How far behind the previous leaf each one starts, so the rosette opens rather than blinking. */
const STAGGER_MS = 160;

const LEAVES = 4;

/**
 * The leaf's share of the whole mark, and the seed's. Ratios rather than constants so a 24-unit
 * inline version and a 96-unit splash are the same drawing at two scales.
 */
const LEAF_RATIO = 0.36;
const SEED_RATIO = 0.1;

export function SproutMark({ label, size = DEFAULT_SIZE, testID }: SproutMarkProps) {
    const { enabled, easing } = useMotion();

    const leaf = Math.round(size * LEAF_RATIO);
    const seed = Math.round(size * SEED_RATIO);
    const centre = size / 2;

    /*
     * One value per leaf rather than one shared clock: a phase offset cannot be expressed as an
     * interpolation of a single looping value without a modulo, and `Animated.loop` resets to the
     * value it started from, which would shorten every offset leaf's first pass for ever after.
     *
     * Held in lazily-initialised state rather than in a ref, because these are read while
     * rendering — every leaf's style is derived from its value — and a ref read during render is
     * exactly what `react-hooks/refs` forbids. The initialiser runs once, so the values are as
     * stable as a ref's would have been.
     */
    const [progress] = useState(() => Array.from({ length: LEAVES }, () => new Animated.Value(0)));

    useEffect(() => {
        if (!enabled) return;

        const timers: ReturnType<typeof setTimeout>[] = [];
        const loops = progress.map((value, index) => {
            const loop = Animated.loop(
                Animated.timing(value, {
                    toValue: 1,
                    duration: CYCLE_MS,
                    easing: easing.standard,
                    useNativeDriver: true,
                }),
            );
            // The stagger is a delay before the loop starts, not a step inside it: a delay in the
            // sequence would be paid again on every iteration and the rosette would drift apart.
            timers.push(
                setTimeout(() => {
                    loop.start();
                }, index * STAGGER_MS),
            );
            return loop;
        });

        return () => {
            for (const timer of timers) clearTimeout(timer);
            for (const loop of loops) loop.stop();
            for (const value of progress) value.setValue(0);
        };
    }, [enabled, progress, easing]);

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
            {progress.map((value, index) => (
                <Animated.View
                    key={index}
                    testID={testID === undefined ? undefined : `${testID}-leaf-${String(index)}`}
                    aria-hidden
                    accessibilityElementsHidden
                    importantForAccessibility="no-hide-descendants"
                    className="absolute bg-surface-brand"
                    style={{
                        width: leaf,
                        height: leaf,
                        // The pointed corner sits on the centre; the round half fans outward.
                        left: centre,
                        top: centre - leaf,
                        borderTopLeftRadius: leaf,
                        borderBottomRightRadius: leaf,
                        transformOrigin: '0% 100%',
                        opacity: enabled
                            ? value.interpolate({
                                  inputRange: [0, 0.22, 0.55, 0.88, 1],
                                  outputRange: [0, 1, 1, 0, 0],
                              })
                            : 1,
                        transform: [
                            { rotate: `${String(45 + index * (360 / LEAVES))}deg` },
                            {
                                scale: enabled
                                    ? value.interpolate({
                                          inputRange: [0, 0.55, 1],
                                          outputRange: [0.15, 1, 1.1],
                                      })
                                    : 1,
                            },
                        ],
                    }}
                />
            ))}

            {/* The seed the leaves come out of. It breathes with them, and holds the centre when
                they are gone. */}
            <View
                aria-hidden
                accessibilityElementsHidden
                importantForAccessibility="no-hide-descendants"
                className="absolute bg-surface-brand"
                style={{
                    width: seed,
                    height: seed,
                    left: centre - seed / 2,
                    top: centre - seed / 2,
                    borderRadius: seed,
                    opacity: 0.9,
                }}
            />
        </View>
    );
}
