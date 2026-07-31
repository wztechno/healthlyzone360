import AxeBuilder from '@axe-core/playwright';
import type { Page } from '@playwright/test';
import { expect, test } from '@playwright/test';

import { selectCedarHamraContext, signIn } from './helpers.ts';

/**
 * The accessibility gate for the dietitian's surfaces: zero serious or critical axe violations.
 *
 * Same threshold as every other sweep in this suite — moderate findings go to the risk register
 * rather than blocking here.
 *
 * The four dialogs are swept open rather than closed. A decision dialog is the highest-stakes
 * overlay in the application: it is where a professional signs their name against somebody's health
 * information, and an unlabelled dialog or a focus trap that never engaged is precisely the failure
 * that would not be noticed by a sighted reviewer.
 */
async function expectNoSeriousViolations(page: Page, screen: string) {
    const results = await new AxeBuilder({ page }).analyze();
    const blocking = results.violations.filter(
        (violation) => violation.impact === 'serious' || violation.impact === 'critical',
    );
    expect(
        blocking,
        `${screen}: ${blocking.map((v) => `${v.id} (${v.impact}): ${v.help}`).join('; ')}`,
    ).toEqual([]);
}

async function openQueue(page: Page) {
    await signIn(page);
    await selectCedarHamraContext(page);
    await page.goto('/dietitian');
    await expect(page.getByTestId('review-queue-screen')).toBeVisible();
    await expect(page.getByTestId('review-queue-list')).toBeVisible();
}

async function openFirstReview(page: Page) {
    await openQueue(page);
    await page.locator('[data-testid^="review-row-"][data-testid$="-open"]').first().click();
    await expect(page.getByTestId('review-detail-screen')).toBeVisible();
}

/**
 * Opens the first review whose subject badge reads `subject`.
 *
 * Chosen over "press a filter chip, then click the first row" deliberately: pressing a filter and
 * immediately clicking is a race against the refetch, and the row that answers is sometimes the one
 * the filter was about to remove.
 */
async function openReviewForSubject(page: Page, subject: string) {
    await openQueue(page);
    const badge = page
        .locator('[data-testid^="review-row-"][data-testid$="-subject"]')
        .filter({ hasText: subject })
        .first();
    await expect(badge).toBeVisible();
    const testId = await badge.getAttribute('data-testid');
    if (testId === null) throw new Error('The subject badge carries no test id.');
    const base = testId.slice(0, testId.length - '-subject'.length);
    await page.getByTestId(`${base}-open`).click();
    await expect(page.getByTestId('review-detail-screen')).toBeVisible();
}

test.describe('professional accessibility (axe)', () => {
    test('the review queue, with its filters', async ({ page }) => {
        await openQueue(page);
        await expectNoSeriousViolations(page, 'review-queue');
    });

    test('the review queue on a phone', async ({ page }) => {
        await page.setViewportSize({ width: 390, height: 844 });
        await openQueue(page);
        await expectNoSeriousViolations(page, 'review-queue-narrow');
    });

    test('the queue empty state, which is a screen in its own right', async ({ page }) => {
        await openQueue(page);
        await page.getByTestId('review-queue-state-decided').click();
        await page.getByTestId('review-queue-subject-virtual_dietitian').click();

        await expect(page.getByTestId('review-queue-empty')).toBeVisible();
        await expectNoSeriousViolations(page, 'review-queue-empty');
    });

    test('the review detail, including its macro table', async ({ page }) => {
        await openReviewForSubject(page, 'Nutrition target');

        await expect(page.getByTestId('review-detail-macros')).toBeVisible();
        await expectNoSeriousViolations(page, 'review-detail');
    });

    test('the approval dialog, open', async ({ page }) => {
        await openFirstReview(page);
        await page.getByTestId('review-approve').click();
        await expect(page.getByTestId('review-approve-dialog')).toBeVisible();
        await expectNoSeriousViolations(page, 'review-approve-dialog');
    });

    test('the request-changes dialog, open', async ({ page }) => {
        await openFirstReview(page);
        await page.getByTestId('review-request-changes').click();
        await expect(page.getByTestId('review-changes-dialog')).toBeVisible();
        await expectNoSeriousViolations(page, 'review-changes-dialog');
    });

    test('the override dialog, open', async ({ page }) => {
        await openReviewForSubject(page, 'Nutrition target');

        await page.getByTestId('review-set-override').click();
        await expect(page.getByTestId('review-override-dialog')).toBeVisible();
        await expectNoSeriousViolations(page, 'review-override-dialog');
    });

    test('the client plan and its note field', async ({ page }) => {
        await openReviewForSubject(page, 'Meal plan');
        await page.getByTestId('review-detail-open-plan').click();

        await expect(page.getByTestId('client-plan-days')).toBeVisible();
        await expectNoSeriousViolations(page, 'client-plan');
    });

    test('the client-plan not-found state', async ({ page }) => {
        await signIn(page);
        await selectCedarHamraContext(page);
        await page.goto('/dietitian/clients/not-a-client/not-a-plan/last-week');

        await expect(page.getByTestId('client-plan-not-found')).toBeVisible();
        await expectNoSeriousViolations(page, 'client-plan-not-found');
    });
});
