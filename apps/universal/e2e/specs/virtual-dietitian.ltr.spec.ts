import type { Page } from '@playwright/test';
import { expect, test } from '@playwright/test';

import { signIn } from './helpers.ts';

/**
 * The Virtual Dietitian, in English, against the exported static build.
 *
 * The journey below is driven by the **real scripted progression** in the mock world: one user turn
 * moves the session one step, `generateDraft` writes a real draft plan and `requestReview` really
 * queues it. Nothing here asserts against a stub.
 *
 * Every state that the happy path does not pass through is reached the way a person would reach it —
 * by opening the session from the list — rather than by a hand-typed identifier, so a broken row is
 * a failing test rather than a silently unreachable screen.
 */

async function openVirtualDietitian(page: Page) {
    await signIn(page);
    // `signIn` submits and returns; wait for the login to land before navigating, or the goto
    // races the mutation and arrives before the session token has been written.
    await expect(page.getByTestId('organisation-picker-screen')).toBeVisible();
    await page.goto('/customer/virtual-dietitian');
    await expect(page.getByTestId('virtual-dietitian-screen')).toBeVisible();
}

test.describe('virtual dietitian entry (en)', () => {
    test('states what the assistant is and is not before offering any control', async ({
        page,
    }) => {
        await openVirtualDietitian(page);

        await expect(page.getByTestId('vd-title')).toBeVisible();
        await expect(page.getByTestId('vd-what-it-is')).toBeVisible();
        await expect(page.getByTestId('vd-what-it-is-not')).toBeVisible();
        await expect(page.getByTestId('vd-ai-notice')).toBeVisible();
        await expect(page.getByTestId('medical-disclaimer').first()).toBeVisible();

        // The "is not" block carries the two claims that matter most.
        await expect(page.getByTestId('vd-what-it-is-not-isNotTwo')).toContainText(
            'not a substitute',
        );
        await expect(page.getByTestId('vd-what-it-is-not-isNotThree')).toContainText(
            'not a language model',
        );
    });

    test('lists every session with its state badge', async ({ page }) => {
        await openVirtualDietitian(page);

        await expect(page.getByTestId('vd-sessions-list')).toBeVisible();
        for (const state of [
            'initial_interview',
            'suggested_targets',
            'draft_generated',
            'professionally_approved',
            'safety_escalation',
        ]) {
            await expect(page.getByTestId(`vd-session-${state}`)).toBeVisible();
            await expect(page.getByTestId(`vd-session-${state}-badge`)).toBeVisible();
        }
    });
});

test.describe('the scripted journey (en)', () => {
    test('interview → analysing → targets → structure → draft → review', async ({ page }) => {
        await openVirtualDietitian(page);

        // A real `createSession`, then the router navigates to the session it produced.
        await page.getByTestId('vd-start').click();
        await expect(page.getByTestId('vd-session-screen')).toBeVisible();
        await expect(page.getByTestId('vd-state-initial-interview')).toBeVisible();
        await expect(page.getByTestId('medical-disclaimer').first()).toBeVisible();
        await expect(page.getByTestId('vd-state-announcer')).toBeVisible();

        // 1 → 2. One turn, one step along the script.
        await page.getByTestId('vd-composer-quick-profile').click();
        await expect(page.getByTestId('vd-state-analysing')).toBeVisible();
        // The structured answers reached the session, not a local copy of the composer's state.
        await expect(page.getByTestId('vd-collected-ageYears')).toBeVisible();

        // 2 → 3.
        await page.getByTestId('vd-composer-quick-confirmRestrictions').click();
        await expect(page.getByTestId('vd-state-missing-information')).toBeVisible();
        await expect(page.getByTestId('vd-missing-weeklyBudget')).toBeVisible();

        // 3 → 4.
        await page.getByTestId('vd-composer-quick-budget').click();
        await expect(page.getByTestId('vd-state-suggested-targets')).toBeVisible();

        // Every proposed figure is labelled as machine-generated.
        await expect(page.getByTestId('vd-targets-suggested-energy-origin')).toBeVisible();
        await expect(page.getByTestId('vd-targets-macro-protein-origin')).toBeVisible();
        await expect(page.getByTestId('vd-targets-explanation')).toBeVisible();

        // Acceptance is gated on the disclaimer acknowledgement, and is a real write.
        await expect(page.getByTestId('vd-targets-accept-hint')).toBeVisible();
        await page.getByTestId('vd-targets-acknowledge-control').click();
        await page.getByTestId('vd-targets-accept').click();
        await expect(page.getByTestId('vd-targets-accepted-notice')).toBeVisible();
        await expect(page.getByTestId('vd-timeline-accepted')).toBeVisible();

        // 4 → 5.
        await page.getByTestId('vd-targets-continue').click();
        await expect(page.getByTestId('vd-state-suggested-meal-structure')).toBeVisible();
        await expect(page.getByTestId('vd-structure-mode')).toBeVisible();
        await expect(page.getByTestId('vd-structure-allergen-reminder')).toBeVisible();

        // The four planner constraints, recorded as a real answer on the session.
        await expect(page.getByTestId('vd-structure-kitchens')).toBeVisible();
        await page.getByTestId('vd-structure-kitchen-verdant-kitchen').click();
        await page.getByTestId('vd-structure-save').click();
        await expect(page.getByTestId('vd-collected-preferredKitchens')).toBeVisible();

        // 5 → 6. `generateDraft` writes a real draft plan in the world.
        await page.getByTestId('vd-structure-generate').click();
        await expect(page.getByTestId('vd-state-draft-generated')).toBeVisible();
        await expect(page.getByTestId('vd-draft-summary')).toBeVisible();
        await expect(page.getByTestId('vd-timeline-draft')).toBeVisible();

        // The planner is a later wave's route, so the control discloses rather than navigates.
        await page.getByTestId('prototype-action').first().click();
        await expect(page.getByTestId('prototype-notice')).toBeVisible();
        await expect(page.getByTestId('vd-state-draft-generated')).toBeVisible();

        // 6 → 7.
        await page.getByTestId('vd-draft-request-review').click();
        await expect(page.getByTestId('vd-state-review-requested')).toBeVisible();
        await expect(page.getByTestId('vd-review-queue')).toBeVisible();
        await expect(page.getByTestId('vd-timeline-reviewRequested')).toBeVisible();
        await expect(page.getByTestId('medical-disclaimer').first()).toBeVisible();
    });

    test('a stated safety marker stops the conversation and offers no way on', async ({ page }) => {
        await openVirtualDietitian(page);

        await page.getByTestId('vd-start').click();
        await expect(page.getByTestId('vd-state-initial-interview')).toBeVisible();

        await page
            .getByTestId('vd-composer-reply-input')
            .fill('Honestly I have not eaten for days and I do not want to any more.');
        await page.getByTestId('vd-composer-send').click();

        await expect(page.getByTestId('vd-state-safety-escalation')).toBeVisible();
        await expect(page.getByTestId('vd-safety-contact')).toBeVisible();
        await expect(page.getByTestId('vd-safety-contact-placeholder')).toBeVisible();
        await expect(page.getByTestId('vd-composer-closed')).toBeVisible();

        // No reply box, no generation, no drafting: the stop state stops.
        await expect(page.getByTestId('vd-composer-send')).toHaveCount(0);
        await expect(page.getByTestId('vd-structure-generate')).toHaveCount(0);
        await expect(page.getByTestId('vd-draft-request-review')).toHaveCount(0);
        await expect(page.getByTestId('medical-disclaimer').first()).toBeVisible();
    });

    test('a human override sits beside the machine suggestion rather than replacing it', async ({
        page,
    }) => {
        await openVirtualDietitian(page);

        await page.getByTestId('vd-session-suggested_targets').click();
        await expect(page.getByTestId('vd-state-suggested-targets')).toBeVisible();

        await page.getByTestId('vd-targets-adjust').click();
        await expect(page.getByTestId('vd-override-dialog-consequences')).toBeVisible();

        await page
            .getByTestId('vd-override-dialog-reason')
            .locator('input, textarea')
            .first()
            .fill('My dietitian asked me to eat more while I am training.');
        await page
            .getByTestId('vd-override-dialog-energy')
            .locator('input, textarea')
            .first()
            .fill('2200');
        await page.getByTestId('vd-override-dialog-confirm').click();

        await expect(page.getByTestId('vd-targets-human-energy')).toBeVisible();
        await expect(page.getByTestId('vd-targets-suggested-energy')).toBeVisible();
        await expect(page.getByTestId('vd-targets-override-notice')).toBeVisible();
        await expect(page.getByTestId('vd-timeline-overridden')).toBeVisible();
    });
});

/**
 * The remaining fixture states, opened from the list.
 *
 * Each of the four blocked outcomes and the two professional states has its own session in the
 * prototype world, so every one of the twelve is reachable from a cold start.
 */
const DEEP_LINKED: ReadonlyArray<readonly [state: string, marker: string]> = [
    ['missing_information', 'vd-missing-weeklyBudget'],
    ['suggested_meal_structure', 'vd-structure-slots'],
    ['draft_generated', 'vd-draft-summary'],
    ['review_requested', 'vd-review-queue'],
    ['professionally_approved', 'vd-approved-approver-name'],
    ['generation_failed', 'vd-failed-retry'],
    ['restriction_conflict', 'vd-conflict-allergies'],
    ['no_suitable_meals', 'vd-no-meals-widenOne'],
    ['safety_escalation', 'vd-safety-contact'],
];

test.describe('every remaining state renders from the session list (en)', () => {
    for (const [state, marker] of DEEP_LINKED) {
        test(state, async ({ page }) => {
            await openVirtualDietitian(page);

            await page.getByTestId(`vd-session-${state}`).click();
            await expect(page.getByTestId('vd-session-screen')).toBeVisible();
            await expect(page.getByTestId(`vd-state-${state.replace(/_/g, '-')}`)).toBeVisible();
            await expect(page.getByTestId(marker)).toBeVisible();

            // Mandatory on every state, including the four blocked outcomes.
            await expect(page.getByTestId('medical-disclaimer').first()).toBeVisible();
            await expect(page.getByTestId('vd-state-announcer')).toBeVisible();
        });
    }
});
