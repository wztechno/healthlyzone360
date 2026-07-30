import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

import { signIn } from './helpers.ts';

/**
 * The twenty-two step onboarding journey and the nutrition-target page it produces, in English.
 *
 * ## Which mock world this runs in, and why it is not `consumer-onboarding`
 *
 * The brief asks for this journey on the `consumer-onboarding` scenario. That world is reachable
 * from the development banner, but two of its properties make it unusable *in combination* here:
 * `selectScenario` clears the session token, so it must run before signing in; and the chosen world
 * is React state rather than storage, so it does not survive a document load. Every route into
 * `/customer/onboarding` from an anonymous marketplace page is a `page.goto`, which reloads and puts
 * the build's default world back, and there is no in-application link from the post-sign-in landing
 * to the wizard (the consumer navigation's nutrition entry is still marked `planned` and belongs to
 * another wave's file).
 *
 * Rather than fake the world, the journey runs on the default prototype world and reaches the wizard
 * by deep link. **Nothing about the twenty-two steps depends on the scenario**: the wizard's answers
 * are local state until the final save, so every step, every validation and the completion path are
 * exercised identically. The two things the scenario does change are covered where they can be
 * covered honestly — the empty nutrition page and the "no dietitian restriction" state are asserted
 * in the Jest suite, which can select a world directly (`src/features/nutrition/nutrition.test.tsx`,
 * `src/features/onboarding/onboarding.test.tsx`). The limitation is recorded in the wave report.
 */

const CONSUMER_ONBOARDING_START = '/customer/onboarding';

/** Every restriction kind the summary must render as its own group. */
const RESTRICTION_KINDS = [
    'allergy',
    'dietitian_enforced',
    'self_declared_medical',
    'intolerance',
    'religious',
    'preference',
    'dislike',
] as const;

async function chooseFromSelect(page: Page, field: string, value: string) {
    await page.getByTestId(`${field}-trigger`).click();
    await page.getByTestId(`${field}-option-${value}`).click();
}

async function next(page: Page) {
    await page.getByTestId('onboarding-next').click();
}

test.describe('customer onboarding (en)', () => {
    test('the wizard resumes at the first unanswered step and refuses a deep link past it', async ({
        page,
    }) => {
        await signIn(page);
        await expect(page.getByTestId('organisation-picker-screen')).toBeVisible();

        // The index resolves to wherever the person actually is — the beginning, here.
        await page.goto(CONSUMER_ONBOARDING_START);
        await expect(page.getByTestId('onboarding-step-introduction')).toBeVisible();
        await expect(page).toHaveURL(/\/customer\/onboarding\/introduction$/);

        // A deep link whose prerequisites are missing lands on the earliest incomplete step
        // rather than on a half-filled form or a not-found page.
        await page.goto('/customer/onboarding/budget');
        await expect(page.getByTestId('onboarding-step-introduction')).toBeVisible();

        // An unknown slug resolves to the beginning too, not to a 404.
        await page.goto('/customer/onboarding/not-a-real-step');
        await expect(page.getByTestId('onboarding-step-introduction')).toBeVisible();
    });

    test('a step refuses to advance until it validates, and says why', async ({ page }) => {
        await signIn(page);
        await expect(page.getByTestId('organisation-picker-screen')).toBeVisible();
        await page.goto(CONSUMER_ONBOARDING_START);

        await expect(page.getByTestId('onboarding-step-introduction')).toBeVisible();
        await page.getByTestId('onboarding-next').click();

        await expect(page.getByTestId('onboarding-introduction-acknowledge-error')).toBeVisible();
        await expect(page.getByTestId('onboarding-step-introduction')).toBeVisible();
    });

    test('the whole twenty-two step journey, ending on the nutrition page', async ({ page }) => {
        await signIn(page);
        await expect(page.getByTestId('organisation-picker-screen')).toBeVisible();
        await page.goto(CONSUMER_ONBOARDING_START);

        /* 1 — introduction: what happens with the data, plus the standing disclaimer. */
        await expect(page.getByTestId('onboarding-step-introduction')).toBeVisible();
        await expect(page.getByTestId('onboarding-introduction-promises')).toBeVisible();
        await expect(page.getByTestId('onboarding-introduction-notSaved')).toBeVisible();
        await expect(page.getByTestId('medical-disclaimer').first()).toBeVisible();
        await expect(page.getByTestId('onboarding-stepper-counter')).toContainText('1');
        await page.getByTestId('onboarding-introduction-acknowledge-control').click();
        await next(page);

        /* 2 — units. */
        await expect(page.getByTestId('onboarding-step-units')).toBeVisible();
        await expect(page.getByTestId('onboarding-units-note')).toBeVisible();
        await next(page);

        /* 3 — age. */
        await expect(page.getByTestId('onboarding-step-age')).toBeVisible();
        await page.getByTestId('onboarding-age-input').fill('34');
        await next(page);

        /* 4 — the sex-related calculation input, shown because Mifflin–St Jeor reads one. */
        await expect(page.getByTestId('onboarding-step-calculation-basis')).toBeVisible();
        await expect(page.getByTestId('onboarding-sex-why')).toBeVisible();
        await expect(page.getByTestId('onboarding-sex-section')).toBeVisible();

        // Choosing the equation that needs no biological parameter retires the question entirely.
        await page.getByTestId('onboarding-basis-body-composition').click();
        await expect(page.getByTestId('onboarding-basis-declined')).toBeVisible();
        await expect(page.getByTestId('onboarding-sex-section')).toHaveCount(0);

        await page.getByTestId('onboarding-basis-measurements').click();
        await page.getByTestId('onboarding-sex-female').click();
        await next(page);

        /* 5 — height. */
        await expect(page.getByTestId('onboarding-step-height')).toBeVisible();
        await page.getByTestId('onboarding-height-input').fill('165');
        await next(page);

        /* 6 — weight. */
        await expect(page.getByTestId('onboarding-step-weight')).toBeVisible();
        await page.getByTestId('onboarding-weight-input').fill('68');
        await next(page);

        /* 7 — optional body fat, skipped. */
        await expect(page.getByTestId('onboarding-step-body-fat')).toBeVisible();
        await expect(page.getByTestId('onboarding-body-fat-no-bands')).toBeVisible();
        await page.getByTestId('onboarding-skip').click();

        /* 8 — activity, with its plain-language guide rather than a bare multiplier. */
        await expect(page.getByTestId('onboarding-step-activity')).toBeVisible();
        await expect(page.getByTestId('onboarding-activity-guide-sedentary')).toBeVisible();
        await expect(page.getByTestId('onboarding-activity-guide-extra_active')).toBeVisible();
        await chooseFromSelect(page, 'onboarding-activity', 'moderately_active');
        await next(page);

        /* 9 — goal. */
        await expect(page.getByTestId('onboarding-step-goal')).toBeVisible();
        await chooseFromSelect(page, 'onboarding-goal', 'lose_weight');
        await next(page);

        /* 10 — pace, with the safety copy and the ambitious-path flag. */
        await expect(page.getByTestId('onboarding-step-pace')).toBeVisible();
        await expect(page.getByTestId('onboarding-pace-safety')).toBeVisible();
        await page.getByTestId('onboarding-pace-ambitious').click();
        await expect(page.getByTestId('onboarding-pace-flagged')).toBeVisible();
        await page.getByTestId('onboarding-pace-standard').click();
        await expect(page.getByTestId('onboarding-pace-flagged')).toHaveCount(0);
        await next(page);

        /* 11 — diet preference and observance, kept apart. */
        await expect(page.getByTestId('onboarding-step-diet')).toBeVisible();
        await expect(page.getByTestId('onboarding-diet-distinction')).toBeVisible();
        await chooseFromSelect(page, 'onboarding-diet', 'mediterranean');
        await page.getByTestId('onboarding-observances-no_pork').click();
        await next(page);

        /* 12 — allergies and intolerances, with the severity note. */
        await expect(page.getByTestId('onboarding-step-allergies')).toBeVisible();
        await expect(page.getByTestId('onboarding-allergies-severity')).toBeVisible();
        await expect(page.getByTestId('onboarding-intolerance-badge')).toBeVisible();
        await page.getByTestId('onboarding-allergies-tree_nut').click();
        await page.getByTestId('onboarding-intolerances-lactose').click();
        await next(page);

        /* 13 — self-declared medical against dietitian-enforced, one editable and one not. */
        await expect(page.getByTestId('onboarding-step-restrictions')).toBeVisible();
        await expect(page.getByTestId('onboarding-enforced-readonly')).toBeVisible();
        await expect(
            page
                .getByTestId('onboarding-enforced-list')
                .or(page.getByTestId('onboarding-enforced-empty')),
        ).toBeVisible();
        await page.getByTestId('onboarding-self-declared-sodium').click();
        await next(page);

        /* 14 — dislikes. */
        await expect(page.getByTestId('onboarding-step-dislikes')).toBeVisible();
        await expect(page.getByTestId('onboarding-dislikes-note')).toBeVisible();
        await page.getByTestId('onboarding-dislikes-aubergine').click();
        await next(page);

        /* 15 — cuisines. */
        await expect(page.getByTestId('onboarding-step-cuisines')).toBeVisible();
        await page.getByTestId('onboarding-cuisines-levantine').click();
        await next(page);

        /* 16 — budget, in AED. */
        await expect(page.getByTestId('onboarding-step-budget')).toBeVisible();
        await expect(page.getByTestId('onboarding-budget-unit')).toContainText('AED');
        await page.getByTestId('onboarding-budget-input').fill('450');
        await next(page);

        /* 17 — cooking time and confidence. */
        await expect(page.getByTestId('onboarding-step-cooking')).toBeVisible();
        await page.getByTestId('onboarding-cooking-minutes-input').fill('30');
        await page.getByTestId('onboarding-cooking-skill-confident').click();
        await next(page);

        /* 18 — meals and snacks. */
        await expect(page.getByTestId('onboarding-step-meals')).toBeVisible();
        await page.getByTestId('onboarding-meals-per-day-input').fill('3');
        await page.getByTestId('onboarding-snacks-per-day-input').fill('1');
        await next(page);

        /* 19 — meal times, one row per slot. */
        await expect(page.getByTestId('onboarding-step-meal-times')).toBeVisible();
        await expect(page.getByTestId('onboarding-meal-slot-meal-1-time')).toBeVisible();
        await expect(page.getByTestId('onboarding-meal-slot-snack-1-time')).toBeVisible();
        await next(page);

        /* 20 — who cooks. */
        await expect(page.getByTestId('onboarding-step-preparation')).toBeVisible();
        await page.getByTestId('onboarding-preparation-mixed').click();
        await next(page);

        /* 21 — the summary, with all seven restriction kinds as distinct groups. */
        await expect(page.getByTestId('onboarding-summary')).toBeVisible();
        await expect(page.getByTestId('onboarding-stepper-counter')).toContainText('21');
        await expect(page.getByTestId('onboarding-summary-preview-content')).toBeVisible();
        await expect(page.getByTestId('onboarding-summary-target')).toBeVisible();
        await expect(page.getByTestId('onboarding-summary-maintenance')).toBeVisible();

        for (const kind of RESTRICTION_KINDS) {
            await expect(page.getByTestId(`onboarding-restriction-group-${kind}`)).toBeVisible();
            await expect(page.getByTestId(`onboarding-restriction-badge-${kind}`)).toBeVisible();
        }
        // The dietitian's group is the only one nobody may edit here.
        await expect(
            page.getByTestId('onboarding-restriction-locked-dietitian_enforced'),
        ).toBeVisible();
        await expect(page.getByTestId('onboarding-restriction-edit-allergy')).toBeVisible();

        // An edit link really returns to the step that asked the question.
        await page.getByTestId('onboarding-summary-edit-age').click();
        await expect(page.getByTestId('onboarding-step-age')).toBeVisible();
        await page.goBack();
        await expect(page.getByTestId('onboarding-summary')).toBeVisible();

        await page.getByTestId('onboarding-summary-acknowledge-control').click();
        await next(page);

        /* 22 — the professional-review warning, because the answers raise a flag. */
        await expect(page.getByTestId('onboarding-review')).toBeVisible();
        await expect(page.getByTestId('onboarding-review-warning')).toBeVisible();
        await expect(page.getByTestId('onboarding-review-reasons')).toBeVisible();
        await expect(page.getByTestId('medical-disclaimer').first()).toBeVisible();

        await page.getByTestId('onboarding-review-request').click();
        await expect(page.getByTestId('onboarding-review-requested')).toBeVisible();

        await page.getByTestId('onboarding-review-acknowledge-control').click();
        await page.getByTestId('onboarding-review-continue').click();

        await expect(page.getByTestId('nutrition-target-screen')).toBeVisible();
        await expect(page.getByTestId('nutrition-target-content')).toBeVisible();
    });
});

test.describe('nutrition targets (en)', () => {
    test('separates maintenance from target, shows its working and marks its source', async ({
        page,
    }) => {
        await signIn(page);
        await expect(page.getByTestId('organisation-picker-screen')).toBeVisible();
        await page.goto('/customer/nutrition');

        await expect(page.getByTestId('nutrition-target-content')).toBeVisible();

        // The separation neither reference product makes.
        await expect(page.getByTestId('nutrition-maintenance-value')).toBeVisible();
        await expect(page.getByTestId('nutrition-target-energy-value')).toBeVisible();
        await expect(page.getByTestId('nutrition-energy-tolerance-value')).toBeVisible();
        await expect(page.getByTestId('nutrition-energy-ring')).toBeVisible();

        // Grams, percentages, energy and tolerance — and fibre alongside the three macros.
        await expect(page.getByTestId('nutrition-macro-table')).toBeVisible();
        await expect(page.getByTestId('nutrition-grams-protein')).toBeVisible();
        await expect(page.getByTestId('nutrition-grams-carbohydrate')).toBeVisible();
        await expect(page.getByTestId('nutrition-grams-fat')).toBeVisible();
        await expect(page.getByTestId('nutrition-grams-fibre')).toBeVisible();

        // Provenance: the engine names itself as a prototype rather than implying a clinical tool.
        await expect(page.getByTestId('nutrition-source-badge')).toBeVisible();
        await expect(page.getByTestId('nutrition-source-note')).toContainText(
            'MockNutritionTargetEngine',
        );
        await expect(page.getByTestId('nutrition-calculated-at')).toBeVisible();
        await expect(page.getByTestId('medical-disclaimer').first()).toBeVisible();

        // No professional has replaced a figure in this world, and the page says so.
        await expect(page.getByTestId('nutrition-override-absent')).toBeVisible();
    });

    test('"why this target?" walks the engine explanation with its citations', async ({ page }) => {
        await signIn(page);
        await expect(page.getByTestId('organisation-picker-screen')).toBeVisible();
        await page.goto('/customer/nutrition');
        await expect(page.getByTestId('nutrition-target-content')).toBeVisible();

        await page.getByTestId('nutrition-explanation-why').click();

        await expect(page.getByTestId('nutrition-explanation-step-bmr')).toBeVisible();
        await expect(page.getByTestId('nutrition-explanation-formula-bmr')).toBeVisible();
        // The citation is the published source, reproduced from the engine rather than paraphrased.
        await expect(page.getByTestId('nutrition-explanation-citation-bmr')).toContainText(
            'Mifflin',
        );
        await expect(page.getByTestId('nutrition-explanation-step-maintenance')).toBeVisible();
        await expect(page.getByTestId('nutrition-explanation-step-fibre')).toBeVisible();
    });

    test('recalculating and requesting a dietitian review are both real actions', async ({
        page,
    }) => {
        await signIn(page);
        await expect(page.getByTestId('organisation-picker-screen')).toBeVisible();
        await page.goto('/customer/nutrition');
        await expect(page.getByTestId('nutrition-target-content')).toBeVisible();

        // Recalculation re-runs the stored request; deterministic input, deterministic output.
        const before = await page.getByTestId('nutrition-target-energy-value').innerText();
        await page.getByTestId('nutrition-recalculate').click();
        await expect(page.getByTestId('nutrition-target-content')).toBeVisible();
        await expect(page.getByTestId('nutrition-target-energy-value')).toHaveText(before);
        await expect(page.getByTestId('nutrition-recalculate-error')).toHaveCount(0);

        // The review request reaches a pending state rather than a toast that says nothing.
        await page.getByTestId('nutrition-request-review').click();
        await expect(page.getByTestId('nutrition-review-pending')).toBeVisible();
        await expect(page.getByTestId('nutrition-request-review')).toBeDisabled();
    });

    test('offers a route back to the answers behind the figures', async ({ page }) => {
        await signIn(page);
        await expect(page.getByTestId('organisation-picker-screen')).toBeVisible();
        await page.goto('/customer/nutrition');
        await expect(page.getByTestId('nutrition-target-content')).toBeVisible();

        await page.getByTestId('nutrition-edit-answers').click();
        await expect(page.getByTestId('onboarding-step-introduction')).toBeVisible();
    });
});
