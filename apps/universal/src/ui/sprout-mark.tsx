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

/** One breath in and out for a leaf. Unhurried on purpose: this is a wait, not a warning. */
const BREATH_MS = 2400;

/** One full turn of the rosette. Slow enough to read as growing rather than as spinning. */
const TURN_MS = 9000;

/** How far behind the previous leaf each one breathes, so the four move as a plant, not a pulse. */
const STAGGER_MS = 300;

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
    const [breath] = useState(() => Array.from({ length: LEAVES }, () => new Animated.Value(0)));
    const [turn] = useState(() => new Animated.Value(0));

    useEffect(() => {
        if (!enabled) return;

        const timers: ReturnType<typeof setTimeout>[] = [];
        const loops = breath.map((value, index) => {
            const loop = Animated.loop(
                Animated.timing(value, {
                    toValue: 1,
                    duration: BREATH_MS,
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

        const rotation = Animated.loop(
            Animated.timing(turn, {
                toValue: 1,
                duration: TURN_MS,
                easing: Easing.linear,
                useNativeDriver: true,
            }),
        );
        rotation.start();

        return () => {
            for (const timer of timers) clearTimeout(timer);
            for (const loop of loops) loop.stop();
            rotation.stop();
            for (const value of breath) value.setValue(0);
            turn.setValue(0);
        };
    }, [enabled, breath, turn, easing]);

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
            {/*
             * The whole rosette turns, slowly, inside a view that carries no `className`.
             *
             * That absence is load-bearing rather than stylistic: NativeWind resolves the style of
             * any element it is given a class for, and resolving an `Animated.Interpolation` reads
             * it once — the view would then hold whatever number the interpolation had at frame
             * zero, for ever. So every animated view here is bare, and the colour goes on a child
             * that may safely carry a class.
             */}
            <Animated.View
                testID={testID === undefined ? undefined : `${testID}-rosette`}
                aria-hidden
                accessibilityElementsHidden
                importantForAccessibility="no-hide-descendants"
                style={{
                    position: 'absolute',
                    width: size,
                    height: size,
                    transform: [
                        {
                            rotate: enabled
                                ? turn.interpolate({
                                      inputRange: [0, 1],
                                      outputRange: ['0deg', '360deg'],
                                  })
                                : '0deg',
                        },
                    ],
                }}
            >
                {breath.map((value, index) => (
                    <Animated.View
                        key={index}
                        testID={
                            testID === undefined ? undefined : `${testID}-leaf-${String(index)}`
                        }
                        style={{
                            position: 'absolute',
                            // The pointed corner sits on the centre; the round half fans outward.
                            left: centre,
                            top: centre - leaf,
                            width: leaf,
                            height: leaf,
                            transformOrigin: '0% 100%',
                            transform: [
                                { rotate: `${String(45 + index * (360 / LEAVES))}deg` },
                                {
                                    /*
                                     * The leaf breathes between a little under and a little over
                                     * its own size — it never shrinks away. Every frame of this
                                     * animation, including the first, is the finished rosette,
                                     * which is what makes a splash that fails to animate look
                                     * merely still rather than broken. The first cut faded each
                                     * leaf from nothing and shipped as a single motionless dot the
                                     * moment the animation did not run.
                                     */
                                    scale: enabled
                                        ? value.interpolate({
                                              inputRange: [0, 0.5, 1],
                                              outputRange: [0.94, 1.06, 0.94],
                                          })
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
            </Animated.View>

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
