import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

import { selectCedarHamraContext, signIn } from './helpers.ts';

const ARABIC_SCRIPT = /[؀-ۿ]/;

test.beforeEach(async ({ context }) => {
    // The pre-hydration script in `+html.tsx` reads this cookie before any styles apply, so the
    // document is RTL from the first paint and no screen flashes left-to-right.
    await context.addCookies([{ name: 'h360_locale', value: 'ar', url: 'http://localhost:4173' }]);
});

/**
 * The dietitian's surfaces in Arabic.
 *
 * ## The disclaimer is the assertion that matters most
 *
 * A screen that shows a person's health information in Arabic and its safety notice in English has
 * not been translated; it has been half-translated, and the half that was skipped is the half that
 * carries the legal and clinical weight. So `medical-disclaimer` is checked for Arabic script on
 * every screen rather than merely for presence.
 *
 * ## The restriction taxonomy has to survive translation
 *
 * `dietitian_enforced` versus `self_declared_medical` versus `allergy` is a distinction about
 * *authority* — who may lift a restriction — and it is exactly the sort of nuance that collapses
 * when copy is translated in a hurry. Both blocks are asserted in Arabic, separately.
 */

const FIXTURE_WEEK = '2026-07-27';

async function openQueue(page: Page) {
    await signIn(page);
    await selectCedarHamraContext(page);
    await page.goto('/dietitian');
    await expect(page.getByTestId('review-queue-screen')).toBeVisible();
    await expect(page.getByTestId('review-queue-list')).toBeVisible();
}

test.describe('dietitian surfaces (ar, RTL)', () => {
    test('translates the queue, its disclaimer and its triage labels', async ({ page }) => {
        await openQueue(page);

        await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
        await expect(page.locator('html')).toHaveAttribute('lang', 'ar');

        await expect(page.getByTestId('review-queue-title')).toContainText(ARABIC_SCRIPT);
        await expect(page.getByTestId('medical-disclaimer').first()).toContainText(ARABIC_SCRIPT);

        const priority = page.locator('[data-testid^="review-row-"][data-testid$="-priority"]');
        await expect(priority.first()).toContainText(ARABIC_SCRIPT);
        const reasons = page.locator('[data-testid^="review-row-"][data-testid$="-reasons"]');
        await expect(reasons.first()).toContainText(ARABIC_SCRIPT);
    });

    test('translates both restriction blocks, keeping them apart', async ({ page }) => {
        await openQueue(page);
        await page.locator('[data-testid^="review-row-"][data-testid$="-open"]').first().click();

        await expect(page.getByTestId('review-detail-screen')).toBeVisible();
        await expect(page.getByTestId('review-detail-enforced')).toContainText(ARABIC_SCRIPT);
        await expect(page.getByTestId('review-detail-declared')).toContainText(ARABIC_SCRIPT);
        await expect(page.getByTestId('review-detail-context-1')).toBeVisible();
    });

    test('translates the approval dialog, including what approval means', async ({ page }) => {
        await openQueue(page);
        await page.locator('[data-testid^="review-row-"][data-testid$="-open"]').first().click();

        await page.getByTestId('review-approve').click();
        await expect(page.getByTestId('review-approve-dialog')).toBeVisible();
        await expect(page.getByTestId('review-approve-consequence')).toContainText(ARABIC_SCRIPT);
        await expect(page.getByTestId('review-approve-signature')).toContainText(ARABIC_SCRIPT);
    });

    test('translates the client week and announces its changes in Arabic', async ({ page }) => {
        await openQueue(page);
        await page.getByTestId('review-queue-subject-meal_plan').click();
        await page.locator('[data-testid^="review-row-"][data-testid$="-open"]').first().click();
        await page.getByTestId('review-detail-open-plan').click();

        await expect(page.getByTestId('client-plan-screen')).toBeVisible();
        await expect(page.getByTestId('client-plan-title')).toContainText(ARABIC_SCRIPT);
        await expect(page.getByTestId('medical-disclaimer').first()).toContainText(ARABIC_SCRIPT);
        await expect(page.getByTestId('client-plan-planned-note')).toContainText(ARABIC_SCRIPT);
        await expect(page.getByTestId(`client-plan-day-${FIXTURE_WEEK}`)).toBeVisible();

        await page
            .getByTestId('client-plan-note-input')
            .locator('textarea, input')
            .first()
            .fill('انتبهي لسقف الصوديوم في أيام وجبات المطبخ.');
        await page.getByTestId('client-plan-note-save').click();
        await expect(page.getByTestId('client-plan-announcer')).toContainText(ARABIC_SCRIPT);
    });

    test('fits a phone without pushing the document sideways', async ({ page }) => {
        await page.setViewportSize({ width: 390, height: 844 });
        await openQueue(page);

        const overflow = await page.evaluate(
            () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
        );
        expect(overflow).toBeLessThanOrEqual(1);
    });
});
