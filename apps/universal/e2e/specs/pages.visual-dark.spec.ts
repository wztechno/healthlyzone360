import { expect, test } from '@playwright/test';

import {
    openAndSettle,
    preparePage,
    snapshotName,
    VISUAL_SKIP_REASON,
    VISUAL_VIEWPORTS,
    visualEnabled,
    visualPage,
} from './visual-pages.ts';

/**
 * Visual regression — dark appearance, four pages at the desktop size.
 *
 * The last four of the thirty-eight committed baselines.
 *
 * ## Why so few, and why desktop only
 *
 * Dark styling in this application is not a second design. `packages/design-tokens` emits one set of
 * semantic custom properties and re-declares their *values* inside a `@media (prefers-color-scheme:
 * dark)` block, so nothing about layout, spacing or composition can differ between the two — only
 * colour can. Capturing eight pages at three sizes again would therefore re-prove the light
 * project's twenty-four geometric claims and add nothing.
 *
 * What dark *can* break is a surface that reads correctly on white because something was hard-coded
 * rather than taken from a token: a badge, a chart band, a meter track, a callout. So the four pages
 * are the ones carrying the most non-text colour — the marketing hero (landing), a nutrition-fact
 * panel (meal detail), the macro rings and tolerance bands (nutrition targets), and the planner
 * week's per-day grid with its warning and kept-meal states.
 *
 * The project sets `colorScheme: 'dark'`, which is all that is needed: the appearance is driven
 * entirely by the media query, with no in-application toggle to drive instead.
 */
const DARK_PAGES = ['landing', 'meal-detail'] as const;

test.describe('visual regression (en, dark)', () => {
    for (const key of DARK_PAGES) {
        const target = visualPage(key);
        test(`${target.key} at desktop`, async ({ page }) => {
            test.skip(!visualEnabled, VISUAL_SKIP_REASON);

            await preparePage(page, VISUAL_VIEWPORTS.desktop);
            await openAndSettle(page, target);

            await expect(page).toHaveScreenshot(snapshotName(target, VISUAL_VIEWPORTS.desktop));
        });
    }
});
