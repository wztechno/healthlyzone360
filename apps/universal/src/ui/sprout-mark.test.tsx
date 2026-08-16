import { createI18n } from '@healthy360/i18n';
import { render, screen } from '@testing-library/react-native';
import { act } from 'react';
import { I18nextProvider } from 'react-i18next';
import { Animated } from 'react-native';

import { SproutMark } from './sprout-mark.tsx';

/** One full cycle of the mark, mirrored from the component so the timing test can outrun it. */
const CYCLE_MS = 2400;

/**
 * The splash mark.
 *
 * What is *not* asserted here is the animation. A timing curve is a judgement rather than a fact,
 * and freezing one in a test only preserves today's taste at the cost of tomorrow's tuning.
 *
 * What is defended is everything the sentence used to do for people who cannot see it. This mark
 * replaced visible words, so if its accessible name, its role or its busy state ever went the same
 * way, a screen reader user would meet a silent, nameless pause on nearly every cold load — and
 * nothing on screen would look wrong to anybody else.
 */

/** One instance for the file: a fresh one per render produces overlapping `act()` scopes. */
const i18n = createI18n({ locale: 'en' });

async function renderMark(size?: number) {
    return render(
        <I18nextProvider i18n={i18n}>
            <SproutMark
                testID="splash"
                label="Restoring your session"
                {...(size === undefined ? {} : { size })}
            />
        </I18nextProvider>,
    );
}

/**
 * The leaves are hidden from assistive technology on purpose — the mark itself carries the name —
 * and React Native Testing Library leaves hidden elements out of its queries by default. Asking for
 * them explicitly is what lets the drawing be asserted without weakening the accessibility of it.
 */
const HIDDEN = { includeHiddenElements: true } as const;

/** Flattens React Native's possibly-nested `style` prop into one object. */
function flatten(style: unknown): Record<string, unknown> {
    if (Array.isArray(style))
        return Object.assign({}, ...style.map(flatten)) as Record<string, unknown>;
    return (style ?? {}) as Record<string, unknown>;
}

describe('SproutMark', () => {
    it('says what it is doing without showing a word of it', async () => {
        await renderMark();

        const mark = screen.getByTestId('splash');
        expect(mark.props.accessibilityLabel).toBe('Restoring your session');
        expect(mark.props['aria-busy']).toBe(true);
        expect(mark.props.accessibilityRole).toBe('progressbar');

        // Nothing inside it is text. This is the point of the change, and it is the assertion that
        // fails if somebody "helpfully" puts the sentence back on screen.
        expect(screen.queryByText(/restoring/i)).toBeNull();
    });

    it('hides the drawing from assistive technology, which hears the mark itself instead', async () => {
        await renderMark();

        const parts = [
            ...screen.getAllByTestId(/^splash-leaf-/, HIDDEN),
            screen.getByTestId('splash-seed', HIDDEN),
        ];
        expect(parts).toHaveLength(5);
        for (const part of parts) {
            expect(part.props['aria-hidden']).toBe(true);
            expect(part.props.importantForAccessibility).toBe('no-hide-descendants');
        }
    });

    it('turns each leaf a quarter further round, so the four open as a rosette', async () => {
        await renderMark();

        const angles = screen
            .getAllByTestId(/^splash-leaf-/, HIDDEN)
            .map((leaf) => flatten(leaf.props.style).transform)
            .map((transform) => (transform as { rotate?: string }[])[0]?.rotate);

        expect(angles).toEqual(['45deg', '135deg', '225deg', '315deg']);
    });

    it('begins the cycle at the seed and lets the four leaves come up out of step', async () => {
        await renderMark();

        /*
         * The study's choreography, and the one thing about this mark that kept getting redesigned
         * on its behalf. `animation-delay: 0s, .16s, .32s, .48s` over a 2.4s `unfurl` means the
         * cycle opens on a bare seed and the leaves grow one after another, each starting before the
         * one before it has finished — then fade the same way.
         *
         * Two properties say that and nothing about taste: the first frame is closed, and the four
         * leaves are at four *different* points of the unfurl. A quarter-cycle stagger passes the
         * second and fails the first; leaves in lockstep pass the first and fail the second.
         *
         * Being out of step is read off scale rather than opacity, because three of the four are
         * legitimately at opacity zero here — the curve is flat across the seam — while no two of
         * them are ever the same size.
         */
        const leaves = screen.getAllByTestId(/^splash-leaf-/, HIDDEN).map((leaf) => {
            const style = flatten(leaf.props.style);
            return {
                opacity: (style.opacity as number | undefined) ?? 1,
                scale: (style.transform as { scale?: number }[])[1]?.scale ?? 1,
            };
        });

        expect(Math.max(...leaves.map((leaf) => leaf.opacity))).toBeLessThan(0.5);
        expect(new Set(leaves.map((leaf) => leaf.scale.toFixed(3))).size).toBe(leaves.length);
    });

    it('starts the next cycle every time one ends, however it ended', async () => {
        /*
         * The bug this exists for: the mark ran a pass or two and then held still for the rest of
         * the wait, because `Animated.loop` ends the whole loop the first time an iteration is
         * interrupted — and a splash, sitting under a tree that re-renders as the session resolves,
         * gets interrupted. Counting the timings started over several cycles is the only honest way
         * to assert "it keeps going", short of watching it.
         */
        jest.useFakeTimers();
        const timing = jest.spyOn(Animated, 'timing');

        try {
            await renderMark();
            const started = timing.mock.calls.length;

            await act(async () => {
                jest.advanceTimersByTime(CYCLE_MS * 3);
            });

            expect(timing.mock.calls.length).toBeGreaterThan(started);
        } finally {
            timing.mockRestore();
            jest.useRealTimers();
        }
    });

    it('is one drawing at any size, so the splash and an inline version cannot drift apart', async () => {
        await renderMark(48);

        const [leaf] = screen.getAllByTestId(/^splash-leaf-/, HIDDEN);
        const style = flatten(leaf?.props.style);

        // 48 × 0.36. The animated view holds the box; the coloured child inside it holds the shape,
        // because a class and an animated style cannot share an element here.
        expect(style.width).toBe(17);
        expect(style.height).toBe(17);

        const shape = flatten(leaf?.props.children?.props?.style);

        // The corner radius is the leaf's own side, which is what makes the shape a leaf rather
        // than a rounded square.
        expect(shape.borderTopLeftRadius).toBe(17);
        expect(shape.borderBottomRightRadius).toBe(17);
    });
});
