import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

import { signIn } from './helpers.ts';

/**
 * Onboarding and the nutrition-target page in Arabic, right to left.
 *
 * Two representative steps and the nutrition page, rather than all twenty-two: the English journey
 * already proves the wizard works, and what this has to prove is different — that the copy is really
 * translated, that the document is right-to-left from the first paint, and that the two layout
 * decisions most likely to be wrong in Arabic are not.
 */

const ARABIC_SCRIPT = /[؀-ۿ]/;

async function next(page: Page) {
    await page.getByTestId('onboarding-next').click();
}

async function chooseFromSelect(page: Page, field: string, value: string) {
    await page.getByTestId(`${field}-trigger`).click();
    await page.getByTestId(`${field}-option-${value}`).click();
}

test.beforeEach(async ({ context }) => {
    // Read by the pre-hydration script in `+html.tsx` before any styles apply, so the document is
    // RTL from the first paint rather than flashing left-to-right.
    await context.addCookies([{ name: 'h360_locale', value: 'ar', url: 'http://localhost:4173' }]);
});

test.describe('customer onboarding (ar, RTL)', () => {
    test('the introduction step is translated and lays out right to left', async ({ page }) => {
        await signIn(page);
        await expect(page.getByTestId('organisation-picker-screen')).toBeVisible();
        await page.goto('/customer/onboarding');

        await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
        await expect(page.locator('html')).toHaveAttribute('lang', 'ar');

        await expect(page.getByTestId('onboarding-step-introduction-title')).toContainText(
            ARABIC_SCRIPT,
        );
        await expect(page.getByTestId('onboarding-introduction-promises')).toContainText(
            ARABIC_SCRIPT,
        );
        // The standing disclaimer is translated too — an untranslated safety notice is worse than
        // none, because it looks like it was considered.
        await expect(page.getByTestId('medical-disclaimer').first()).toContainText(ARABIC_SCRIPT);
        await expect(page.getByTestId('onboarding-next')).toContainText(ARABIC_SCRIPT);

        /*
         * The progress bar fills from the leading edge, which in Arabic is the right. The fill is
         * simply the first child of a `flex-row`, so the row mirrors and the fill hugs the right
         * with no direction-specific style anywhere — that is what is being checked.
         */
        const geometry = await page
            .getByTestId('onboarding-stepper-track')
            .evaluate((track: Element) => {
                const fill = track.firstElementChild;
                const trackRect = track.getBoundingClientRect();
                const fillRect = fill?.getBoundingClientRect() ?? trackRect;
                return { trackRight: trackRect.right, fillRight: fillRect.right };
            });
        expect(Math.abs(geometry.fillRight - geometry.trackRight)).toBeLessThan(2);
    });

    test('the allergies step keeps its seven-kind vocabulary in Arabic', async ({ page }) => {
        await signIn(page);
        await expect(page.getByTestId('organisation-picker-screen')).toBeVisible();
        await page.goto('/customer/onboarding');

        /*
         * Walk to the allergies step, answering as briefly as the wizard allows.
         *
         * Each step is asserted before it is acted on. `onboarding-next` exists on every step, so
         * a click issued before the new step has rendered would land on the previous one's button
         * and silently desynchronise the whole walk.
         */
        await page.getByTestId('onboarding-introduction-acknowledge-control').click();
        await next(page);

        await expect(page.getByTestId('onboarding-step-units')).toBeVisible();
        await next(page);

        await expect(page.getByTestId('onboarding-step-age')).toBeVisible();
        await page.getByTestId('onboarding-age-input').fill('34');
        await next(page);

        await expect(page.getByTestId('onboarding-step-calculation-basis')).toBeVisible();
        await page.getByTestId('onboarding-sex-female').click();
        await next(page);

        await expect(page.getByTestId('onboarding-step-height')).toBeVisible();
        await page.getByTestId('onboarding-height-input').fill('165');
        await next(page);

        await expect(page.getByTestId('onboarding-step-weight')).toBeVisible();
        await page.getByTestId('onboarding-weight-input').fill('68');
        await next(page);

        await expect(page.getByTestId('onboarding-step-body-fat')).toBeVisible();
        await page.getByTestId('onboarding-skip').click();

        await expect(page.getByTestId('onboarding-step-activity')).toBeVisible();
        await chooseFromSelect(page, 'onboarding-activity', 'moderately_active');
        await next(page);

        await expect(page.getByTestId('onboarding-step-goal')).toBeVisible();
        await chooseFromSelect(page, 'onboarding-goal', 'maintain');
        await next(page);

        await expect(page.getByTestId('onboarding-step-pace')).toBeVisible();
        await page.getByTestId('onboarding-pace-standard').click();
        await next(page);

        await expect(page.getByTestId('onboarding-step-diet')).toBeVisible();
        await chooseFromSelect(page, 'onboarding-diet', 'mediterranean');
        await next(page);

        await expect(page.getByTestId('onboarding-step-allergies')).toBeVisible();
        await expect(page.getByTestId('onboarding-step-allergies-title')).toContainText(
            ARABIC_SCRIPT,
        );
        // The allergy warning and the intolerance explainer are the two pieces of copy that carry
        // the distinction, so both have to survive translation.
        await expect(page.getByTestId('onboarding-allergies-severity')).toContainText(
            ARABIC_SCRIPT,
        );
        await expect(page.getByTestId('onboarding-intolerance-badge')).toContainText(ARABIC_SCRIPT);
        await expect(page.getByTestId('onboarding-allergies-tree_nut')).toContainText(
            ARABIC_SCRIPT,
        );
    });
});

test.describe('nutrition targets (ar, RTL)', () => {
    test('renders the target, its working and its provenance in Arabic', async ({ page }) => {
        await signIn(page);
        await expect(page.getByTestId('organisation-picker-screen')).toBeVisible();
        await page.goto('/customer/nutrition');

        await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
        await expect(page.getByTestId('nutrition-target-content')).toBeVisible();

        await expect(page.getByTestId('nutrition-title')).toContainText(ARABIC_SCRIPT);
        await expect(page.getByTestId('nutrition-maintenance')).toContainText(ARABIC_SCRIPT);
        await expect(page.getByTestId('nutrition-target-energy')).toContainText(ARABIC_SCRIPT);
        await expect(page.getByTestId('nutrition-macro-table')).toContainText(ARABIC_SCRIPT);
        await expect(page.getByTestId('medical-disclaimer').first()).toContainText(ARABIC_SCRIPT);

        // The engine's own name stays Latin inside an Arabic document, exactly as a brand mark does:
        // it identifies a piece of software, and translating it would make the provenance unusable.
        await expect(page.getByTestId('nutrition-source-note')).toContainText(
            'MockNutritionTargetEngine',
        );

        // The explanation opens and its steps are translated, while the published citations stay in
        // the language they were published in.
        await page.getByTestId('nutrition-explanation-why').click();
        await expect(page.getByTestId('nutrition-explanation-step-bmr')).toBeVisible();
        await expect(page.getByTestId('nutrition-explanation-citation-bmr')).toContainText(
            'Mifflin',
        );

        // The page must not scroll sideways in Arabic; a wide table scrolls inside its own box.
        const overflow = await page.evaluate(() => ({
            scrollWidth: document.documentElement.scrollWidth,
            clientWidth: document.documentElement.clientWidth,
        }));
        expect(overflow.scrollWidth).toBeLessThanOrEqual(overflow.clientWidth + 1);
    });
});
