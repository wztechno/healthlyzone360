import AxeBuilder from '@axe-core/playwright';
import type { Page } from '@playwright/test';
import { expect, test } from '@playwright/test';

import { signIn } from './helpers.ts';

/**
 * The accessibility gate for onboarding and the nutrition-target page: zero serious or critical axe
 * violations. Moderate findings are recorded in the risk register rather than blocked on here,
 * which matches the marketplace and screen sweeps.
 *
 * Six of the seven screens swept below need prerequisites, so each test walks the wizard to the step
 * it is auditing. That is slower than seeding state would be, and it is the honest version: a step
 * reached the way a person reaches it is a step in the state a person will actually meet.
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

async function next(page: Page) {
    await page.getByTestId('onboarding-next').click();
}

async function chooseFromSelect(page: Page, field: string, value: string) {
    await page.getByTestId(`${field}-trigger`).click();
    await page.getByTestId(`${field}-option-${value}`).click();
}

/** Signs in and opens the wizard at its first step. */
async function openWizard(page: Page) {
    await signIn(page);
    await expect(page.getByTestId('organisation-picker-screen')).toBeVisible();
    await page.goto('/customer/onboarding');
    await expect(page.getByTestId('onboarding-step-introduction')).toBeVisible();
}

/** Answers steps 1 to 11, leaving the wizard on the allergies step. */
async function walkToAllergies(page: Page) {
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

    await chooseFromSelect(page, 'onboarding-activity', 'moderately_active');
    await next(page);

    await chooseFromSelect(page, 'onboarding-goal', 'lose_weight');
    await next(page);

    await page.getByTestId('onboarding-pace-ambitious').click();
    await next(page);

    await chooseFromSelect(page, 'onboarding-diet', 'mediterranean');
    await next(page);

    await expect(page.getByTestId('onboarding-step-allergies')).toBeVisible();
}

/** Continues from the allergies step to the summary. */
async function walkToSummary(page: Page) {
    await page.getByTestId('onboarding-allergies-tree_nut').click();
    await next(page);

    await expect(page.getByTestId('onboarding-step-restrictions')).toBeVisible();
    await page.getByTestId('onboarding-self-declared-sodium').click();
    await next(page);

    // Nothing to record is a real answer to each of these, but the step still has to arrive
    // before the next click: clicking a control that has not re-rendered yet is the classic way
    // a wizard walk skips a step and fails three assertions later.
    await expect(page.getByTestId('onboarding-step-dislikes')).toBeVisible();
    await next(page);

    await expect(page.getByTestId('onboarding-step-cuisines')).toBeVisible();
    await next(page);

    await expect(page.getByTestId('onboarding-step-budget')).toBeVisible();
    await page.getByTestId('onboarding-budget-input').fill('450');
    await next(page);

    await expect(page.getByTestId('onboarding-step-cooking')).toBeVisible();
    await page.getByTestId('onboarding-cooking-minutes-input').fill('30');
    await page.getByTestId('onboarding-cooking-skill-confident').click();
    await next(page);

    await expect(page.getByTestId('onboarding-step-meals')).toBeVisible();
    await page.getByTestId('onboarding-meals-per-day-input').fill('3');
    await page.getByTestId('onboarding-snacks-per-day-input').fill('1');
    await next(page);

    await expect(page.getByTestId('onboarding-meal-slots')).toBeVisible();
    await next(page);

    await expect(page.getByTestId('onboarding-step-preparation')).toBeVisible();
    await page.getByTestId('onboarding-preparation-mixed').click();
    await next(page);

    await expect(page.getByTestId('onboarding-summary')).toBeVisible();
}

test.describe('onboarding accessibility (axe)', () => {
    test('introduction', async ({ page }) => {
        await openWizard(page);
        await expectNoSeriousViolations(page, 'onboarding-introduction');
    });

    test('units', async ({ page }) => {
        await openWizard(page);
        await page.getByTestId('onboarding-introduction-acknowledge-control').click();
        await next(page);
        await expect(page.getByTestId('onboarding-step-units')).toBeVisible();
        await expectNoSeriousViolations(page, 'onboarding-units');
    });

    test('allergies', async ({ page }) => {
        await openWizard(page);
        await walkToAllergies(page);
        await expectNoSeriousViolations(page, 'onboarding-allergies');
    });

    test('medical and dietitian restrictions', async ({ page }) => {
        await openWizard(page);
        await walkToAllergies(page);
        await next(page);
        await expect(page.getByTestId('onboarding-step-restrictions')).toBeVisible();
        await expect(page.getByTestId('onboarding-enforced-readonly')).toBeVisible();
        await expectNoSeriousViolations(page, 'onboarding-restrictions');
    });

    test('summary, including the seven restriction groups', async ({ page }) => {
        await openWizard(page);
        await walkToAllergies(page);
        await walkToSummary(page);
        await expect(page.getByTestId('onboarding-summary-preview-content')).toBeVisible();
        await expectNoSeriousViolations(page, 'onboarding-summary');
    });

    test('professional-review warning', async ({ page }) => {
        await openWizard(page);
        await walkToAllergies(page);
        await walkToSummary(page);

        await page.getByTestId('onboarding-summary-acknowledge-control').click();
        await next(page);

        await expect(page.getByTestId('onboarding-review-warning')).toBeVisible();
        await expectNoSeriousViolations(page, 'onboarding-review');
    });
});

test.describe('nutrition-target accessibility (axe)', () => {
    test('nutrition targets, closed and with the explanation open', async ({ page }) => {
        await signIn(page);
        await expect(page.getByTestId('organisation-picker-screen')).toBeVisible();
        await page.goto('/customer/nutrition');
        await expect(page.getByTestId('nutrition-target-content')).toBeVisible();

        await expectNoSeriousViolations(page, 'nutrition-targets');

        // The accordion's expanded panel is a different tree, so it gets its own sweep.
        await page.getByTestId('nutrition-explanation-why').click();
        await expect(page.getByTestId('nutrition-explanation-step-bmr')).toBeVisible();
        await expectNoSeriousViolations(page, 'nutrition-targets-explanation-open');
    });
});
