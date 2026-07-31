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
 * Visual regression — Arabic, right-to-left, five pages at two sizes.
 *
 * Ten of the thirty-eight committed baselines, and the ones that matter most: RTL is where a layout
 * built with physical insets rather than logical ones falls apart, and it does so *silently* — the
 * page still renders, the tests still pass, and the drawer opens from the wrong edge. A pixel
 * comparison is the only cheap way to notice.
 *
 * ## Which pages, and why only two sizes
 *
 * The five carry every mirrored construct the product has: the marketing chrome with its brand and
 * footer (landing), a horizontally scanned directory (discover), a two-column record with a media
 * rail (kitchen profile), a priced comparison table (plan detail) and the planner, whose week grid
 * is the single densest piece of directional layout in the application. Each is captured at the
 * phone size — where the marketplace chrome collapses to a drawer and the planner to an agenda —
 * and at the desktop size, where both are in their wide form. The tablet size is covered in English
 * only: it changes the *shell*, and the shell's mirroring is already proven at the two extremes.
 */
const RTL_PAGES = [
    'landing',
    'discover',
    'kitchen-profile',
    'plan-detail',
    'planner-week',
] as const;

const RTL_VIEWPORTS = [VISUAL_VIEWPORTS.mobile, VISUAL_VIEWPORTS.desktop] as const;

test.describe('visual regression (ar, RTL)', () => {
    for (const key of RTL_PAGES) {
        const target = visualPage(key);
        for (const viewport of RTL_VIEWPORTS) {
            test(`${target.key} at ${viewport.key}`, async ({ page }) => {
                test.skip(!visualEnabled, VISUAL_SKIP_REASON);

                await preparePage(page, viewport, { arabic: true });
                await openAndSettle(page, target);

                // The shot is worthless unless the document really is right-to-left: a missed
                // cookie would produce a perfectly stable English baseline under an Arabic name.
                await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');

                await expect(page).toHaveScreenshot(snapshotName(target, viewport));
            });
        }
    }
});
