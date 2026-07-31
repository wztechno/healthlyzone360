import { expect, test } from '@playwright/test';

import {
    openAndSettle,
    preparePage,
    snapshotName,
    VISUAL_PAGES,
    VISUAL_SKIP_REASON,
    VISUAL_VIEWPORTS,
    visualEnabled,
} from './visual-pages.ts';

/**
 * Visual regression — English, light appearance, eight pages at three sizes.
 *
 * Twenty-four of the thirty-eight committed baselines. The other two projects cover Arabic
 * (`*.visual-rtl.spec.ts`) and the dark appearance (`*.visual-dark.spec.ts`); together they are the
 * "screenshot-based visual regression tests" the prompt asks for.
 *
 * ## What a baseline here actually promises
 *
 * That the *composition* of a page has not moved: chrome, hierarchy, card geometry, the point at
 * which the shell changes shape. It is not a promise about content below the fold — the exported
 * application disables document scrolling (`ScrollViewStyleReset` in `+html.tsx`) and scrolls inside
 * a `ScrollView`, so `fullPage` would capture exactly the viewport anyway. Saying that out loud is
 * better than a `fullPage: true` that quietly does nothing.
 *
 * ## Tolerance
 *
 * `maxDiffPixelRatio: 0.01` is set once in `playwright.config.ts` and applies to all three projects.
 * One per cent of a 1440×900 shot is roughly thirteen thousand pixels — enough to absorb a subpixel
 * difference in glyph rasterisation between two container runs, and nowhere near enough to absorb a
 * moved card, a changed spacing step or a lost badge.
 *
 * Baselines are captured and verified **only** inside `mcr.microsoft.com/playwright:v1.62.0-noble`.
 * Elsewhere every test below skips with {@link VISUAL_SKIP_REASON} rather than failing.
 */
test.describe('visual regression (en, light)', () => {
    for (const target of VISUAL_PAGES) {
        for (const viewport of Object.values(VISUAL_VIEWPORTS)) {
            test(`${target.key} at ${viewport.key}`, async ({ page }) => {
                test.skip(!visualEnabled, VISUAL_SKIP_REASON);

                await preparePage(page, viewport);
                await openAndSettle(page, target);

                await expect(page).toHaveScreenshot(snapshotName(target, viewport));
            });
        }
    }
});
