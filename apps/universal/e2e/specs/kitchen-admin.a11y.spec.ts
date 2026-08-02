import AxeBuilder from '@axe-core/playwright';
import type { Page } from '@playwright/test';
import { expect, test } from '@playwright/test';

import { selectVerdantKitchenContext, signIn } from './helpers.ts';

/**
 * The accessibility gate for the kitchen workspace: zero serious or critical axe violations.
 *
 * Same threshold as the marketplace, catalogue, planner, commerce and B2B sweeps — moderate findings
 * go to the risk register rather than blocking here.
 *
 * Three surfaces are swept in an *interactive* state rather than only as they land, because that is
 * where an admin form's failures are: the record editor after a per-row allergen refusal, since an
 * error associated with the wrong field is invisible until it exists; the two dialogs, which are the
 * one place a name or a focus trap goes missing unnoticed; and the ingredient table at phone width,
 * where `Table` switches from an ARIA table to stacked cards and the labelled-field relationship has
 * to survive the switch.
 *
 * The project runs English only, matching every other `*.a11y.spec.ts` here — the axe rules this
 * gate enforces (names, roles, contrast, labelling) are direction-independent, and the Arabic build
 * is asserted for structure by `kitchen-admin.rtl.spec.ts`.
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

async function openKitchen(page: Page) {
    await signIn(page);
    await selectVerdantKitchenContext(page);
    await page.goto('/kitchen');
    await expect(page.getByTestId('kitchen-home-screen')).toBeVisible();
}

async function openIngredients(page: Page) {
    await openKitchen(page);
    await page.getByTestId('kitchen-family-ingredients-open').click();
    await expect(page.getByTestId('kitchen-ingredients-table')).toBeVisible();
}

async function openFirstIngredient(page: Page) {
    await openIngredients(page);
    await page
        .locator('[data-testid^="kitchen-ingredient-"][data-testid$="-open"]')
        .first()
        .click();
    await expect(page.getByTestId('kitchen-ingredient-editor-screen')).toBeVisible();
}

async function openRecipes(page: Page) {
    await openKitchen(page);
    await page.getByTestId('kitchen-family-recipes-open').click();
    await expect(page.getByTestId('kitchen-recipes-table')).toBeVisible();
}

async function openFirstRecipe(page: Page) {
    await openRecipes(page);
    await page.locator('[data-testid^="kitchen-recipe-"][data-testid$="-open"]').first().click();
    await expect(page.getByTestId('kitchen-recipe-editor-screen')).toBeVisible();
}

test.describe('kitchen workspace accessibility (axe)', () => {
    test('the workspace hub', async ({ page }) => {
        await openKitchen(page);
        await expect(page.getByTestId('kitchen-home-grid')).toBeVisible();
        await expectNoSeriousViolations(page, 'kitchen-home');
    });

    test('the ingredient list, with its filters', async ({ page }) => {
        await openIngredients(page);
        await expectNoSeriousViolations(page, 'kitchen-ingredients');
    });

    test('the same list on a phone, where the table becomes stacked cards', async ({ page }) => {
        await page.setViewportSize({ width: 390, height: 844 });
        await openIngredients(page);
        await expectNoSeriousViolations(page, 'kitchen-ingredients-narrow');
    });

    test('the ingredient list with its searchable category filter open', async ({ page }) => {
        await openIngredients(page);
        await page.getByTestId('kitchen-ingredients-toolbar-category-trigger').click();
        await expect(page.getByTestId('kitchen-ingredients-toolbar-category-list')).toBeVisible();
        await expectNoSeriousViolations(page, 'kitchen-ingredients-category-select');
    });

    test('the archive confirmation, which is a dialog in its own right', async ({ page }) => {
        await openIngredients(page);
        await page
            .locator('[data-testid^="kitchen-ingredient-"][data-testid$="-archive"]')
            .first()
            .click();
        await expect(page.getByTestId('kitchen-ingredients-archive-dialog')).toBeVisible();
        await expectNoSeriousViolations(page, 'kitchen-ingredients-archive-dialog');
    });

    test('the record editor, and the editor after a per-row allergen refusal', async ({ page }) => {
        await openFirstIngredient(page);
        await expectNoSeriousViolations(page, 'kitchen-ingredient-editor');

        // The seeded determination is `contains`; asking for `may_contain` weakens a platform
        // baseline and is refused, which is when the per-row error first exists.
        const weaken = page
            .locator(
                '[data-testid^="kitchen-ingredient-mapping-baseline-"][data-testid$="-containment-may_contain"]',
            )
            .first();
        if ((await weaken.count()) > 0) {
            await weaken.click();
            await expect(page.getByTestId('kitchen-ingredient-mapping-blocked')).toBeVisible();
            await expectNoSeriousViolations(page, 'kitchen-ingredient-editor-refused');
        }
    });

    test('the unsaved-changes dialog', async ({ page }) => {
        await openFirstIngredient(page);
        await page.getByTestId('kitchen-ingredient-notes-input').fill('Half a thought.');
        await page.getByTestId('kitchen-ingredient-editor-screen-back').click();
        await expect(
            page.getByTestId('kitchen-ingredient-editor-screen-unsaved-dialog'),
        ).toBeVisible();
        await expectNoSeriousViolations(page, 'kitchen-ingredient-unsaved-dialog');
    });

    test('the create form, before anything has been answered', async ({ page }) => {
        await openIngredients(page);
        await page.getByTestId('kitchen-ingredients-toolbar-create').click();
        await expect(page.getByTestId('kitchen-ingredient-editor-screen')).toBeVisible();
        await expectNoSeriousViolations(page, 'kitchen-ingredient-create');
    });

    test('the recipe list', async ({ page }) => {
        await openRecipes(page);
        await expectNoSeriousViolations(page, 'kitchen-recipes');
    });

    /**
     * The recipe editor is swept twice — read-only, then with the draft's line editor and the
     * roll-up pane beside it. The second state is the one with the risk: a live region, an
     * `aria-busy` container holding stale figures, expandable provenance chips and three ordered-row
     * editors' worth of move buttons, none of which exist in the first.
     */
    test('the recipe editor, read-only and then with its draft open', async ({ page }) => {
        await openFirstRecipe(page);
        await expect(page.getByTestId('kitchen-recipe-rollup')).toBeVisible();
        await expectNoSeriousViolations(page, 'kitchen-recipe-editor-readonly');

        await page.getByTestId('kitchen-recipe-new-draft').click();
        await expect(page.getByTestId('kitchen-recipe-lines-add')).toBeVisible();
        await expect(page.getByTestId('kitchen-recipe-rollup-figures')).toBeVisible();
        await expectNoSeriousViolations(page, 'kitchen-recipe-editor-draft');
    });

    test('the publish confirmation, where the label about to go public is stated', async ({
        page,
    }) => {
        await openFirstRecipe(page);
        await page.getByTestId('kitchen-recipe-new-draft').click();
        await expect(page.getByTestId('kitchen-recipe-publish')).toBeVisible();

        await page.getByTestId('kitchen-recipe-publish').click();
        await expect(page.getByTestId('kitchen-recipe-publish-dialog')).toBeVisible();
        await expectNoSeriousViolations(page, 'kitchen-recipe-publish-dialog');
    });

    test('the allergen class reference', async ({ page }) => {
        await openKitchen(page);
        await page.getByTestId('kitchen-family-allergen-classes-open').click();
        await expect(page.getByTestId('kitchen-allergen-classes-list')).toBeVisible();
        await expectNoSeriousViolations(page, 'kitchen-allergen-classes');
    });
});
