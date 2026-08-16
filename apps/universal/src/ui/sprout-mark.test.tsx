import { createI18n } from '@healthy360/i18n';
import { render, screen } from '@testing-library/react-native';
import { I18nextProvider } from 'react-i18next';

import { SproutMark } from './sprout-mark.tsx';

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

    it('hides its leaves from assistive technology, which hears the mark itself instead', async () => {
        await renderMark();

        const leaves = screen.getAllByTestId(/^splash-leaf-/, HIDDEN);
        expect(leaves).toHaveLength(4);
        for (const leaf of leaves) {
            expect(leaf.props['aria-hidden']).toBe(true);
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

    it('is one drawing at any size, so the splash and an inline version cannot drift apart', async () => {
        await renderMark(48);

        const [leaf] = screen.getAllByTestId(/^splash-leaf-/, HIDDEN);
        const style = flatten(leaf?.props.style);

        // 48 × 0.36, and the corner radius is the leaf's own side — which is what makes the shape a
        // leaf rather than a rounded square.
        expect(style.width).toBe(17);
        expect(style.height).toBe(17);
        expect(style.borderTopLeftRadius).toBe(17);
        expect(style.borderBottomRightRadius).toBe(17);
    });
});
