import { expect, test } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';

import { signIn } from './helpers.ts';

/**
 * Reduced motion renders **final states**, not slower ones.
 *
 * ## The defect this exists to catch
 *
 * The classic reduced-motion bug is not a lingering animation. It is content that starts at
 * `opacity: 0` or off-screen, has its animation suppressed because motion is reduced, and is
 * therefore *never revealed at all*. The page looks empty, nothing is broken enough to throw, and no
 * functional test notices — every element is present, attached and, as far as Playwright's
 * visibility rules are concerned, visible, because `opacity: 0` is still visible.
 *
 * `FadeIn`, `SlideIn` and `PageTransition` each guard against it by rendering the literal final
 * style rather than an animated value parked at the end (see `packages/design-system/src/motion`).
 * This file asserts that from the outside, against the exported build, in the browser state that
 * actually triggers it.
 *
 * ## Why the sweep looks at inline styles
 *
 * Checking the two overlays by name would prove those two overlays. The sweep below asks a stronger
 * question of a settled page — *is anything at all parked mid-animation?* — and reports the offender
 * when the answer is yes.
 *
 * It reads **inline** `opacity` and `transform` rather than computed ones, which is both faster and
 * more precise. React Native Web compiles static styles to atomic classes and writes only *dynamic*
 * values inline, so an inline `opacity` is, in practice, an `Animated.View` reporting where it has
 * got to. Computed values would sweep in every deliberately-dimmed thing in the product — a disabled
 * control at `opacity-50`, the decorative pattern inside an `ImagePlaceholder` at `opacity-60`, an
 * overlay backdrop — none of which is an animation, and all of which would have to be excluded by
 * name. The inline filter excludes them by *kind*, which is the distinction that actually matters.
 */

test.use({ contextOptions: { reducedMotion: 'reduce' } });

/** Below this an element is not "faded slightly", it is being animated or hidden. */
const SETTLED_OPACITY = 0.99;

interface Unsettled {
    readonly description: string;
    readonly opacity: string;
    readonly transform: string;
}

/**
 * Elements that are still mid-entrance.
 *
 * Both halves of an entrance are looked for: a non-final opacity and a non-identity translation.
 * A rotation or a scale is left alone — those belong to icons and indicators that are stateful
 * rather than animated, and reduced motion has nothing to say about them.
 */
async function unsettledElements(scope: Locator): Promise<readonly Unsettled[]> {
    return scope.evaluate((root) => {
        const found: { description: string; opacity: string; transform: string }[] = [];

        const describe = (element: Element): string => {
            const testId = element.getAttribute('data-testid');
            if (testId !== null) return `[data-testid="${testId}"]`;
            const anchor = element.closest('[data-testid]');
            const inside =
                anchor === null
                    ? ''
                    : ` inside [data-testid="${anchor.getAttribute('data-testid') ?? ''}"]`;
            return `<${element.tagName.toLowerCase()}>${inside}`;
        };

        /** `matrix(a, b, c, d, tx, ty)` with a non-zero translation. */
        const isTranslated = (transform: string): boolean => {
            const numbers = transform.match(/-?[\d.]+/g);
            if (numbers === null || numbers.length < 6) return false;
            const [tx, ty] = numbers.slice(4, 6).map(Number);
            return (tx ?? 0) !== 0 || (ty ?? 0) !== 0;
        };

        const candidates: Element[] = [root, ...root.querySelectorAll('[style]')];
        for (const element of candidates) {
            if (!(element instanceof HTMLElement)) continue;
            if (element.style.opacity === '' && element.style.transform === '') continue;

            const style = window.getComputedStyle(element);
            const opacity = Number.parseFloat(style.opacity);

            if (
                (element.style.opacity !== '' && Number.isFinite(opacity) && opacity < 0.99) ||
                (element.style.transform !== '' && isTranslated(style.transform))
            ) {
                found.push({
                    description: describe(element),
                    opacity: style.opacity,
                    transform: style.transform,
                });
            }
        }

        return found;
    });
}

async function expectSettled(scope: Locator, where: string) {
    const unsettled = await unsettledElements(scope);
    expect(
        unsettled,
        `${where}: ${String(unsettled.length)} element(s) parked mid-animation — ` +
            unsettled
                .map(
                    (item) =>
                        `${item.description} opacity=${item.opacity} transform=${item.transform}`,
                )
                .join('; '),
    ).toEqual([]);
}

/**
 * The animation wrapper `FadeIn`/`SlideIn` puts around a panel.
 *
 * Both render an `Animated.View` whose only child is the panel, so the wrapper is the panel's
 * parent. Reading it directly is what distinguishes "the panel is settled" from "the panel is
 * inside something that is still travelling" — and the second is exactly what a reduced-motion
 * failure looks like.
 */
async function wrapperStyle(page: Page, panelTestId: string) {
    return page.evaluate((testId) => {
        const panel = document.querySelector(`[data-testid="${testId}"]`);
        const wrapper = panel?.parentElement ?? null;
        if (wrapper === null) return null;
        const style = window.getComputedStyle(wrapper);
        return { opacity: style.opacity, transform: style.transform };
    }, panelTestId);
}

function expectWrapperSettled(
    style: { readonly opacity: string; readonly transform: string } | null,
    where: string,
) {
    expect(style, `${where}: no animation wrapper found.`).not.toBeNull();
    if (style === null) return;

    expect(
        Number.parseFloat(style.opacity),
        `${where}: wrapper opacity is ${style.opacity}.`,
    ).toBeGreaterThanOrEqual(SETTLED_OPACITY);

    expect(
        style.transform === 'none' || style.transform === 'matrix(1, 0, 0, 1, 0, 0)',
        `${where}: wrapper transform is ${style.transform}.`,
    ).toBe(true);
}

test.describe('reduced motion renders final states', () => {
    test('a public page settles with nothing parked mid-entrance', async ({ page }) => {
        await page.goto('/');
        await expect(page.getByTestId('landing-screen')).toBeVisible();
        await expect(page.getByTestId('landing-featured-grid')).toBeVisible();

        await expectSettled(page.getByTestId('landing-screen'), 'landing');
    });

    test('a signed-in list settles with nothing parked mid-entrance', async ({ page }) => {
        await signIn(page);
        await expect(page.getByTestId('organisation-picker-screen')).toBeVisible();
        await page.goto('/customer/subscriptions');
        await expect(page.getByTestId('subscriptions-screen')).toBeVisible();

        // Every card is wrapped in a `FadeIn` with a staggered delay computed from its position,
        // which is where a suppressed animation would blank the most content.
        await expectSettled(page.getByTestId('subscriptions-screen'), 'subscriptions list');
    });

    test('a dialog is fully visible the moment it opens', async ({ page }) => {
        await page.goto('/for-business');
        await expect(page.getByTestId('for-business-screen')).toBeVisible();

        await page.getByTestId('for-business-request-quotation').click();
        await expect(page.getByTestId('for-business-enquiry')).toBeVisible();

        // Read immediately, with no settling wait: under reduced motion there is nothing to settle,
        // and if there were, this is the instant it would still be moving.
        expectWrapperSettled(await wrapperStyle(page, 'for-business-enquiry'), 'enquiry dialog');

        await expectSettled(page.getByTestId('for-business-enquiry'), 'enquiry dialog contents');
    });
});
