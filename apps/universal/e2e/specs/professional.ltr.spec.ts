import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

import { selectCedarHamraContext, signIn } from './helpers.ts';

/**
 * The dietitian's surfaces, end to end, in English.
 *
 * ## What this journey is really checking
 *
 * The review queue is where the product's safety claims are paid for. Every
 * `requiresProfessionalReview` flag the target engine raises, every Virtual Dietitian session that
 * hit a restriction conflict and every week somebody asked a human to check arrives here; if the
 * queue does not exist, those flags are decoration. So this journey follows one item all the way
 * from the queue to a recorded decision, and asserts the two things that make the decision real:
 *
 * 1. **A signature is collected, not defaulted.** `ApproveReviewRequest.signature` is recorded
 *    against the professional's registration and shown to the client, so approval stays disabled
 *    until it is typed.
 * 2. **The state actually moves.** After approving, the queue shows the item as approved — the store
 *    honoured the decision rather than the screen pretending it did.
 *
 * The other assertion that matters is a separation: what a dietitian enforced is shown apart from
 * what the client declared, because only the practice may lift the first and the client may change
 * the second.
 *
 * ## The disclaimer
 *
 * `medical-disclaimer` is mandatory on every screen here — all three show a named person's health
 * information — and is asserted on each rather than left to reviewer memory.
 */

/** Monday of the fixture week. Pinned in `mock/prototype/constants.ts`. */
const FIXTURE_WEEK = '2026-07-27';

async function openQueue(page: Page) {
    await signIn(page);
    await selectCedarHamraContext(page);
    await page.goto('/dietitian');
    await expect(page.getByTestId('review-queue-screen')).toBeVisible();
    await expect(page.getByTestId('review-queue-list')).toBeVisible();
}

/** The `review-row-{id}` prefix of the first row on screen. */
async function firstRowBase(page: Page): Promise<string> {
    const control = page.locator('[data-testid^="review-row-"][data-testid$="-open"]').first();
    await expect(control).toBeVisible();
    const testId = await control.getAttribute('data-testid');
    if (testId === null) throw new Error('The queue row carries no test id.');
    return testId.slice(0, testId.length - '-open'.length);
}

/**
 * The `review-row-{id}` prefix of the first row whose subject badge reads `subject`.
 *
 * Chosen over "filter the queue, then take the first row" deliberately: pressing a filter chip and
 * immediately reading the list is a race against the refetch, and the row that answers is sometimes
 * the one the filter was about to remove.
 */
async function rowBaseForSubject(page: Page, subject: string): Promise<string> {
    const badge = page
        .locator('[data-testid^="review-row-"][data-testid$="-subject"]')
        .filter({ hasText: subject })
        .first();
    await expect(badge).toBeVisible();
    const testId = await badge.getAttribute('data-testid');
    if (testId === null) throw new Error('The subject badge carries no test id.');
    return testId.slice(0, testId.length - '-subject'.length);
}

test.describe('dietitian review queue (en)', () => {
    test('shows why each item is waiting, and for whom', async ({ page }) => {
        await openQueue(page);

        await expect(page.getByTestId('medical-disclaimer').first()).toBeVisible();

        const base = await firstRowBase(page);
        await expect(page.getByTestId(`${base}-client`)).toBeVisible();
        await expect(page.getByTestId(`${base}-priority`)).toBeVisible();
        await expect(page.getByTestId(`${base}-subject`)).toBeVisible();
        await expect(page.getByTestId(`${base}-state`)).toBeVisible();
        // The reasons are on the row, not one level down: they are what triage is done on.
        await expect(page.getByTestId(`${base}-reasons`)).not.toBeEmpty();
    });

    test('narrows the queue and offers a way back out of an empty result', async ({ page }) => {
        await openQueue(page);

        await page.getByTestId('review-queue-state-decided').click();
        await page.getByTestId('review-queue-subject-virtual_dietitian').click();

        await expect(page.getByTestId('review-queue-empty')).toBeVisible();
        await page.getByTestId('review-queue-clear').click();
        await expect(page.getByTestId('review-queue-list')).toBeVisible();
    });

    test('shows everything a professional needs before deciding', async ({ page }) => {
        await openQueue(page);
        await page.locator('[data-testid^="review-row-"][data-testid$="-open"]').first().click();

        await expect(page.getByTestId('review-detail-screen')).toBeVisible();
        await expect(page.getByTestId('medical-disclaimer').first()).toBeVisible();

        await expect(page.getByTestId('review-detail-reasons')).toBeVisible();
        await expect(page.getByTestId('review-detail-context-1')).toBeVisible();
        await expect(page.getByTestId('review-detail-client-note')).toBeVisible();

        // What a dietitian set is shown apart from what the client recorded.
        await expect(page.getByTestId('review-detail-enforced')).toContainText(
            'Only the practice that set these may lift them',
        );
        await expect(page.getByTestId('review-detail-declared')).toBeVisible();
    });

    test('states the provenance of the figures it is asking a professional to judge', async ({
        page,
    }) => {
        await openQueue(page);
        const base = await rowBaseForSubject(page, 'Nutrition target');
        await page.getByTestId(`${base}-open`).click();

        await expect(page.getByTestId('review-detail-target')).toBeVisible();
        await expect(page.getByTestId('review-detail-maintenance')).toBeVisible();
        await expect(page.getByTestId('review-detail-target-energy')).toBeVisible();
        await expect(page.getByTestId('review-detail-macros')).toBeVisible();
        await expect(page.getByTestId('review-detail-prototype-engine')).toContainText(
            'not a clinical assessment',
        );
        await expect(page.getByTestId('review-detail-method')).toBeVisible();
    });

    test('will not approve without a signature, then records the approval', async ({ page }) => {
        await openQueue(page);
        const base = await rowBaseForSubject(page, 'Nutrition target');
        const reviewId = base.slice('review-row-'.length);
        await page.getByTestId(`${base}-open`).click();
        await expect(page.getByTestId('review-detail-screen')).toBeVisible();

        await page.getByTestId('review-approve').click();
        await expect(page.getByTestId('review-approve-dialog')).toBeVisible();
        await expect(page.getByTestId('review-approve-consequence')).toBeVisible();
        await expect(page.getByTestId('review-approve-confirm')).toBeDisabled();

        await page
            .getByTestId('review-approve-signature')
            .locator('input')
            .first()
            .fill('Layla Haddad, RD');
        await page.getByTestId('review-approve-confirm').click();

        await expect(page.getByTestId('review-announcer')).toContainText('approved');

        // The decision really moved the item, not just the screen that made it.
        await page.getByTestId('review-detail-back').click();
        await expect(page.getByTestId('review-queue-screen')).toBeVisible();
        await expect(page.getByTestId(`review-row-${reviewId}-state`)).toContainText('Approved');
    });

    test('requests changes with a note and a priority, and the queue moves', async ({ page }) => {
        await openQueue(page);
        const base = await rowBaseForSubject(page, 'Meal plan');
        const reviewId = base.slice('review-row-'.length);
        await page.getByTestId(`${base}-open`).click();
        await expect(page.getByTestId('review-detail-screen')).toBeVisible();

        await page.getByTestId('review-request-changes').click();
        await expect(page.getByTestId('review-changes-dialog')).toBeVisible();
        await page
            .getByTestId('review-changes-note')
            .locator('textarea, input')
            .first()
            .fill('Please swap Friday dinner for something lower in sodium.');
        await page.getByTestId('review-changes-priority-urgent').click();
        await page.getByTestId('review-changes-confirm').click();

        await expect(page.getByTestId('review-announcer')).toContainText('Changes requested');

        // Going back re-mounts the queue with its filters reset, so the row is in the full list.
        await page.getByTestId('review-detail-back').click();
        await expect(page.getByTestId('review-queue-list')).toBeVisible();
        await expect(page.getByTestId(`review-row-${reviewId}-state`)).toContainText(
            'Changes requested',
        );
    });

    test('records a professional override with the reason it was made for', async ({ page }) => {
        await openQueue(page);
        const base = await rowBaseForSubject(page, 'Nutrition target');
        await page.getByTestId(`${base}-open`).click();

        await page.getByTestId('review-set-override').click();
        await expect(page.getByTestId('review-override-dialog')).toBeVisible();
        await expect(page.getByTestId('review-override-confirm')).toBeDisabled();

        await page.getByTestId('review-override-energy-increment').click();
        await page
            .getByTestId('review-override-reason')
            .locator('textarea, input')
            .first()
            .fill('Training load is higher than the questionnaire assumed.');
        await page.getByTestId('review-override-confirm').click();

        await expect(page.getByTestId('review-announcer')).toContainText('Override saved');
        await expect(page.getByTestId('review-detail-override')).toContainText('Training load');
    });

    test('opens the client week behind a plan review and leaves a note on it', async ({ page }) => {
        await openQueue(page);
        const base = await rowBaseForSubject(page, 'Meal plan');
        await page.getByTestId(`${base}-open`).click();

        await expect(page.getByTestId('review-detail-plan')).toBeVisible();
        await expect(page.getByTestId('review-detail-plan-entries')).toBeVisible();
        await page.getByTestId('review-detail-open-plan').click();

        await expect(page.getByTestId('client-plan-screen')).toBeVisible();
        await expect(page.getByTestId('medical-disclaimer').first()).toBeVisible();
        await expect(page.getByTestId(`client-plan-day-${FIXTURE_WEEK}`)).toBeVisible();
        await expect(page.getByTestId('client-plan-planned-note')).toContainText(
            'Nothing here records what the client actually ate',
        );

        await page
            .getByTestId('client-plan-note-input')
            .locator('textarea, input')
            .first()
            .fill('Keep the sodium ceiling in view on kitchen-meal days.');
        await page.getByTestId('client-plan-note-save').click();
        await expect(page.getByTestId('client-plan-announcer')).toContainText('Note saved');
    });

    test('answers a malformed client-plan address with a not-found rather than a failure', async ({
        page,
    }) => {
        await signIn(page);
        await selectCedarHamraContext(page);
        await page.goto('/dietitian/clients/not-a-client/not-a-plan/last-week');

        await expect(page.getByTestId('client-plan-not-found')).toBeVisible();
    });

    test('is operable from the keyboard alone, including its dialogs', async ({ page }) => {
        await openQueue(page);
        const base = await firstRowBase(page);

        await page.getByTestId(`${base}-open`).focus();
        await page.keyboard.press('Enter');
        await expect(page.getByTestId('review-detail-screen')).toBeVisible();

        await page.getByTestId('review-request-changes').focus();
        await page.keyboard.press('Enter');
        await expect(page.getByTestId('review-changes-dialog')).toBeVisible();

        // Escape closes it, which is the other half of a keyboard-operable overlay.
        await page.keyboard.press('Escape');
        await expect(page.getByTestId('review-changes-dialog')).toBeHidden();
    });
});
