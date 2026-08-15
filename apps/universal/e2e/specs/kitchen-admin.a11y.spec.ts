import AxeBuilder from '@axe-core/playwright';
import type { Page } from '@playwright/test';
import { expect, test } from '@playwright/test';

import {
    KITCHEN_OWNER,
    probeStack,
    selectVerdantKitchenContext,
    signIn,
    skipUnlessStackIsUp,
} from './helpers.ts';
import type { StackStatus } from './helpers.ts';

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
 *
 * ## Every sweep here is read-only, and that is a constraint rather than a coincidence
 *
 * The mutating half of this workspace lives in `kitchen-admin.write.spec.ts`, which runs one worker
 * at a time. An axe sweep that created an ingredient to reach an editable editor, or saved a meal to
 * reach a publish dialog, would be writing to a shared database from a project that runs in
 * parallel with three others. So the states below are reached by *opening* seeded records and by
 * driving controls whose effect is local to the form — a dialog opened and not confirmed, a status
 * segment switched and not saved. The one state that genuinely needed a write, the editor of a
 * record this kitchen owns, is covered by the write spec's own journeys.
 *
 * The recipe sweeps are gone with the recipe journeys: `GET /catalogue/recipes` answers zero rows
 * for the demonstration kitchen, and an axe sweep of an empty table is a sweep of an empty state.
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

let stack: StackStatus;

test.beforeAll(async () => {
    stack = await probeStack();
});

test.beforeEach(() => {
    // Signing in is three chained round trips against the local Docker stack, and choosing an
    // organisation is three more; the project's 90 s default is a budget for one. `test.slow()`
    // triples it for the journeys that really do pay that cost, rather than raising the ceiling
    // for every test that reads a single endpoint.
    test.slow();
    skipUnlessStackIsUp(stack);
});

async function openKitchen(page: Page) {
    await signIn(page, KITCHEN_OWNER);
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

async function openProducts(page: Page) {
    await openKitchen(page);
    await page.getByTestId('kitchen-family-products-open').click();
    await expect(page.getByTestId('kitchen-products-table')).toBeVisible();
}

async function openFirstProduct(page: Page) {
    await openProducts(page);
    await page.locator('[data-testid^="kitchen-product-"][data-testid$="-open"]').first().click();
    await expect(page.getByTestId('kitchen-product-editor-screen')).toBeVisible();
}

async function openMeals(page: Page) {
    await openKitchen(page);
    await page.getByTestId('kitchen-family-meals-open').click();
    await expect(page.getByTestId('kitchen-meals-table')).toBeVisible();
}

async function openFirstMeal(page: Page) {
    await openMeals(page);
    await page.locator('[data-testid^="kitchen-meal-"][data-testid$="-open"]').first().click();
    await expect(page.getByTestId('kitchen-meal-editor-screen')).toBeVisible();
}

async function openPriceLists(page: Page) {
    await openKitchen(page);
    await page.getByTestId('kitchen-family-price-lists-open').click();
    await expect(page.getByTestId('kitchen-price-lists-table')).toBeVisible();
}

async function openFirstPriceList(page: Page) {
    await openPriceLists(page);
    await page
        .locator('[data-testid^="kitchen-price-list-"][data-testid$="-open"]')
        .first()
        .click();
    await expect(page.getByTestId('kitchen-price-list-editor-screen')).toBeVisible();
}

async function openPlans(page: Page) {
    await openKitchen(page);
    await page.getByTestId('kitchen-family-plans-open').click();
    await expect(page.getByTestId('kitchen-plans-table')).toBeVisible();
}

async function openZones(page: Page) {
    await openKitchen(page);
    await page.getByTestId('kitchen-family-delivery-zones-open').click();
    await expect(page.getByTestId('kitchen-zones-table')).toBeVisible();
}

async function openFirstZone(page: Page) {
    await openZones(page);
    await page.locator('[data-testid^="kitchen-zone-"][data-testid$="-open"]').first().click();
    await expect(page.getByTestId('kitchen-zone-editor-screen')).toBeVisible();
}

async function openBranchHours(page: Page) {
    await openKitchen(page);
    await page.getByTestId('kitchen-family-branch-operating-open').click();
    await expect(page.getByTestId('kitchen-branch-hours-screen')).toBeVisible();
}

async function openFirstPlan(page: Page) {
    await openPlans(page);
    await page.locator('[data-testid^="kitchen-plan-"][data-testid$="-open"]').first().click();
    await expect(page.getByTestId('kitchen-plan-editor-screen')).toBeVisible();
}

async function openReview(page: Page) {
    await openKitchen(page);
    await page.getByTestId('kitchen-family-review-open').click();
    await expect(page.getByTestId('kitchen-review-screen')).toBeVisible();
}

/**
 * The Order Desk queue.
 *
 * Anchored on the screen container rather than on the table, unlike every other helper here, and
 * deliberately: the queue is bounded by *what is due*, so on a shared database with no open orders
 * in today's window the honest landing state is the empty state and waiting for a table would turn
 * a correct screen into a timeout. Both states are worth sweeping — the toolbar, its segmented
 * control and its chip group are on screen either way.
 */
async function openOrderDesk(page: Page) {
    await openKitchen(page);
    await page.getByTestId('kitchen-family-order-desk-open').click();
    await expect(page.getByTestId('kitchen-order-desk-screen')).toBeVisible();
    await expect(page.getByTestId('kitchen-order-desk-toolbar')).toBeVisible();
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

    /**
     * The unsaved-changes dialog, reached from the *create* form rather than from a saved record.
     *
     * The dialog is the same component either way, and this route reaches it without writing a row:
     * typing into a form nobody has saved is exactly the state the guard exists for.
     */
    test('the unsaved-changes dialog', async ({ page }) => {
        await openIngredients(page);
        await page.getByTestId('kitchen-ingredients-toolbar-create').click();
        await expect(page.getByTestId('kitchen-ingredient-editor-screen')).toBeVisible();
        await page.getByTestId('kitchen-ingredient-name-en-input').fill('Half a thought');
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

    test('the product list', async ({ page }) => {
        await openProducts(page);
        await expectNoSeriousViolations(page, 'kitchen-products');
    });

    /**
     * The product editor is swept twice — as it lands, then with a pack row carrying a refusal.
     * The second state is where the risk is: a repeated row's error has to be associated with the
     * field inside *that* row rather than with the first one on the page, and an error attached to
     * the wrong control is invisible until it exists.
     */
    test('the product editor, and the editor after a duplicate pack code', async ({ page }) => {
        await openFirstProduct(page);
        await expectNoSeriousViolations(page, 'kitchen-product-editor');

        const existing = await page
            .locator(
                '[data-testid^="kitchen-product-pack-editor-row-"][data-testid$="-code-input"]',
            )
            .first()
            .inputValue();

        await page.getByTestId('kitchen-product-packs-add').click();
        const added = 'kitchen-product-pack-editor-row-pack-1';
        await page.getByTestId(`${added}-code`).locator('input').first().fill(existing);
        await expect(page.getByTestId(`${added}-code-error`)).toBeVisible();
        await expectNoSeriousViolations(page, 'kitchen-product-editor-refused');
    });

    test('the product archive confirmation', async ({ page }) => {
        await openFirstProduct(page);
        await page.getByTestId('kitchen-product-archive').click();
        await expect(page.getByTestId('kitchen-product-archive-dialog')).toBeVisible();
        await expectNoSeriousViolations(page, 'kitchen-product-archive-dialog');
    });

    test('the meal list', async ({ page }) => {
        await openMeals(page);
        await expectNoSeriousViolations(page, 'kitchen-meals');
    });

    /**
     * The meal editor carries two multi-select chip groups, a raised confidential panel and the
     * availability rows — each of which is a labelled control inside a repeated card, which is where
     * a name goes missing without anybody seeing it.
     */
    test('the meal editor, and the editor with an availability row open', async ({ page }) => {
        await openFirstMeal(page);
        await expectNoSeriousViolations(page, 'kitchen-meal-editor');

        await page.getByTestId('kitchen-meal-availability-add').click();
        await expect(page.getByTestId('kitchen-meal-availability-editor-row-day-1')).toBeVisible();
        await expectNoSeriousViolations(page, 'kitchen-meal-editor-availability');
    });

    /**
     * The publish confirmation, opened on a meal the seed already left in draft
     * (`chicken-freekeh-bowl`) rather than on one this sweep created. The dialog is opened and never
     * confirmed, so nothing is published.
     */
    test('the meal publish confirmation, where the consequence is stated before it is agreed', async ({
        page,
    }) => {
        await openMeals(page);
        await page.getByTestId('kitchen-meals-toolbar-status-draft').click();
        await page.locator('[data-testid^="kitchen-meal-"][data-testid$="-open"]').first().click();
        await expect(page.getByTestId('kitchen-meal-editor-screen')).toBeVisible();
        await expect(page.getByTestId('kitchen-meal-publish')).toBeVisible();

        await page.getByTestId('kitchen-meal-publish').click();
        await expect(page.getByTestId('kitchen-meal-publish-dialog')).toBeVisible();
        await expectNoSeriousViolations(page, 'kitchen-meal-publish-dialog');
    });

    test('the withdraw confirmation, which removes a meal from every consumer surface', async ({
        page,
    }) => {
        await openFirstMeal(page);
        await page.getByTestId('kitchen-meal-retire').click();
        await expect(page.getByTestId('kitchen-meal-retire-dialog')).toBeVisible();
        await expectNoSeriousViolations(page, 'kitchen-meal-retire-dialog');
    });

    test('the allergen class reference', async ({ page }) => {
        await openKitchen(page);
        await page.getByTestId('kitchen-family-allergen-classes-open').click();
        await expect(page.getByTestId('kitchen-allergen-classes-list')).toBeVisible();
        await expectNoSeriousViolations(page, 'kitchen-allergen-classes');
    });

    /* ── price lists (K1.5) ──────────────────────────────────────────────────────────────────── */

    test('the price-list list, including the confidential notice', async ({ page }) => {
        await openPriceLists(page);
        await expect(page.getByTestId('kitchen-price-lists-confidential')).toBeVisible();
        await expectNoSeriousViolations(page, 'kitchen-price-lists');
    });

    /**
     * The price editor is the densest repeated-row form in the workspace: two dependent selects, a
     * segmented control, an amount field and two date fields, per row. A control that loses its
     * label inside a repeated card, or a tablist without a name, is exactly the kind of thing that
     * is invisible until somebody using a screen reader meets it — so the editor is swept twice,
     * once as it lands and once with a row switched to a status that has no amount.
     *
     * That second sweep is the one that found something real: a `readOnly` `TextInput` at the design
     * system's disabled opacity contrasts 4.07:1 against the sunken surface, and `readonly` — unlike
     * `disabled` — is an active control that axe holds to 4.5:1. The editor now removes the field
     * rather than greying it, which is both accessible and more honest.
     */
    test('the price-list editor, and a row that can hold no amount', async ({ page }) => {
        await openFirstPriceList(page);
        await expect(page.getByTestId('kitchen-price-list-entries')).toBeVisible();
        await expectNoSeriousViolations(page, 'kitchen-price-list-editor');

        const label = page
            .locator(
                '[data-testid^="kitchen-price-list-entries-row-"][data-testid$="-status-label"]',
            )
            .first();
        const testId = await label.getAttribute('data-testid');
        if (testId === null) throw new Error('The entry row carries no test id.');
        const row = testId.slice(0, testId.length - '-status-label'.length);

        await page.getByTestId(`${row}-status-placeholder`).click();
        await expect(page.getByTestId(`${row}-no-amount`)).toBeVisible();
        await expectNoSeriousViolations(page, 'kitchen-price-list-editor-placeholder-row');
    });

    test('the publish confirmation, where what will not reach a customer is stated', async ({
        page,
    }) => {
        // A draft list: the seed publishes the menu lists, and a published one offers no publish.
        // Publication is one-way on a shared database, so the write spec may have consumed the one
        // draft tariff — in which case there is no dialog to sweep and saying so beats a red.
        await openPriceLists(page);
        await page.getByTestId('kitchen-price-lists-toolbar-status-draft').click();
        const drafts = page.locator('[data-testid^="kitchen-price-list-"][data-testid$="-open"]');
        test.skip(
            (await drafts.count()) === 0,
            'Every price list is published, so no publish dialog exists to sweep.',
        );
        await drafts.first().click();
        await expect(page.getByTestId('kitchen-price-list-editor-screen')).toBeVisible();

        await page.getByTestId('kitchen-price-list-publish').click();
        await expect(page.getByTestId('kitchen-price-list-publish-dialog')).toBeVisible();
        await expectNoSeriousViolations(page, 'kitchen-price-list-publish-dialog');
    });

    /* ── plans (K1.6) ────────────────────────────────────────────────────────────────────────── */

    test('the plan list', async ({ page }) => {
        await openPlans(page);
        await expectNoSeriousViolations(page, 'kitchen-plans');
    });

    /**
     * The plan editor is the most structurally demanding screen in the workspace, and the matrix is
     * why: a grid of checkboxes is meaningless to somebody who cannot see which row and which column
     * a cell is in. It is a real ARIA table — `columnheader` and `rowheader` cells, named by its
     * caption — and each cell additionally carries the whole sentence as its own accessible name, so
     * both readings work. This sweep is what holds that: a bare `View` grid would pass a glance and
     * fail here.
     */
    test('the plan editor, with its matrix, its rows and its duration cards', async ({ page }) => {
        await openFirstPlan(page);
        await expect(page.getByTestId('kitchen-plan-matrix-grid')).toBeVisible();
        await expect(page.getByTestId('kitchen-plan-duration-rows')).toBeVisible();
        await expectNoSeriousViolations(page, 'kitchen-plan-editor');
    });

    /**
     * The same editor with a one-off duration, where the day field is *removed* rather than greyed.
     *
     * That removal is not a style preference: a `readOnly` `TextInput` at the design system's
     * disabled opacity contrasts 4.07:1 against the sunken surface, and `readonly` — unlike
     * `disabled` — is an active control axe holds to 4.5:1. The price editor's amount field found
     * that first (K1.5); this is the same pattern, swept to keep it that way.
     */
    test('the plan editor with a one-off duration, whose day field is gone rather than greyed', async ({
        page,
    }) => {
        await openFirstPlan(page);
        const first = page
            .locator('[data-testid^="kitchen-plan-duration-rows-row-seed-duration-0-"]')
            .first();
        const testId = await first.getAttribute('data-testid');
        if (testId === null) throw new Error('The duration row carries no test id.');

        await page.getByTestId(`${testId}-kind-one_off`).click();
        await expect(page.getByTestId(`${testId}-days-absent`)).toBeVisible();
        await expectNoSeriousViolations(page, 'kitchen-plan-editor-one-off');
    });

    test('the same matrix on a phone, where the table becomes stacked cards', async ({ page }) => {
        await page.setViewportSize({ width: 390, height: 844 });
        await openFirstPlan(page);
        await expect(page.getByTestId('kitchen-plan-matrix-grid')).toBeVisible();
        await expectNoSeriousViolations(page, 'kitchen-plan-editor-narrow');
    });

    /**
     * The publish confirmation, opened on the plan the seed leaves in draft. Opened, never
     * confirmed — and it could not be confirmed anyway, which is the state being swept.
     */
    test('the plan publish confirmation, where every refusal is stated before it is agreed', async ({
        page,
    }) => {
        await openPlans(page);
        await page.getByTestId('kitchen-plans-toolbar-status-draft').click();
        await page.locator('[data-testid^="kitchen-plan-"][data-testid$="-open"]').first().click();
        await expect(page.getByTestId('kitchen-plan-editor-screen')).toBeVisible();
        await expect(page.getByTestId('kitchen-plan-publish')).toBeVisible();

        await page.getByTestId('kitchen-plan-publish').click();
        await expect(page.getByTestId('kitchen-plan-publish-dialog')).toBeVisible();
        await expectNoSeriousViolations(page, 'kitchen-plan-publish-dialog');
    });

    test('the delivery-zone list', async ({ page }) => {
        await openZones(page);
        await expectNoSeriousViolations(page, 'kitchen-zones');
    });

    /**
     * The zone editor carries the workspace's largest multi-select, and it is swept in the state
     * that matters: **with the option group populated and a selection made**.
     *
     * The picker is deliberately not a combobox (see `delivery-row-editors.tsx`) — a labelled search
     * field above an independently labelled checkbox group — and this is the sweep that keeps that
     * decision honest: a group with no accessible name, a checkbox with no label, or a live region
     * with no role are all serious findings and all invisible by eye.
     */
    test('the zone editor with its area picker populated and filtered', async ({ page }) => {
        await openFirstZone(page);
        await expect(page.getByTestId('kitchen-zone-area-picker-search')).toBeVisible();
        await expectNoSeriousViolations(page, 'kitchen-zone-editor');

        await page.getByTestId('kitchen-zone-area-picker-search-input').fill('a');
        await expect(page.getByTestId('kitchen-zone-area-picker-count')).toBeVisible();
        await expectNoSeriousViolations(page, 'kitchen-zone-editor-picker-filtered');

        const option = page
            .locator(
                '[data-testid^="kitchen-zone-area-picker-option-"][data-testid$="-control"][aria-checked="false"]',
            )
            .first();
        if ((await option.count()) > 0) {
            await option.click();
            await expect(
                page.locator('[data-testid^="kitchen-zone-area-picker-chip-"]').first(),
            ).toBeVisible();
            await expectNoSeriousViolations(page, 'kitchen-zone-editor-picker-selected');
        }
    });

    /**
     * The window editor with a refusal on one row: a repeated card whose error has to be associated
     * with the field inside *that* row rather than with the first one on the page.
     */
    test('the zone editor with a window row carrying a refusal', async ({ page }) => {
        await openFirstZone(page);
        await expect(page.getByTestId('kitchen-zone-window-rows')).toBeVisible();

        const row = page.locator('[data-testid^="kitchen-zone-window-rows-row-"]').first();
        const rowId = await row.getAttribute('data-testid');
        if (rowId === null) throw new Error('The window row carries no test id.');

        await page.getByTestId(`${rowId}-starts-input`).fill('22:00');
        await page.getByTestId(`${rowId}-ends-input`).fill('02:00');
        await expect(page.getByTestId(`${rowId}-error`)).toBeVisible();
        await expectNoSeriousViolations(page, 'kitchen-zone-editor-window-refused');
    });

    test('the zone archive confirmation, where the cost is counted before it is agreed', async ({
        page,
    }) => {
        await openFirstZone(page);
        await page.getByTestId('kitchen-zone-archive').click();
        await expect(page.getByTestId('kitchen-zone-archive-dialog')).toBeVisible();
        await expectNoSeriousViolations(page, 'kitchen-zone-archive-dialog');
    });

    /**
     * The trading week, swept in both of its states.
     *
     * A closed day *removes* three labelled fields and replaces them with a note, which is exactly
     * the kind of change that leaves an orphaned `aria-describedby` behind — and an error on one
     * weekday has to name that weekday's field rather than the first one on the page.
     */
    test('the branch operating week, with a closed day and a refused cut-off', async ({ page }) => {
        await openBranchHours(page);
        await expectNoSeriousViolations(page, 'kitchen-branch-hours');

        await page.getByTestId('kitchen-branch-hours-rows-day-2-closed-control').click();
        await expect(page.getByTestId('kitchen-branch-hours-rows-day-2-closed-note')).toBeVisible();
        await expectNoSeriousViolations(page, 'kitchen-branch-hours-closed-day');

        await page.getByTestId('kitchen-branch-hours-rows-day-1-closes-input').fill('17:00');
        await page.getByTestId('kitchen-branch-hours-rows-day-1-cut-off-input').fill('23:00');
        await expect(page.getByTestId('kitchen-branch-hours-rows-day-1-error')).toBeVisible();
        await expectNoSeriousViolations(page, 'kitchen-branch-hours-refused');
    });

    test('the same trading week on a phone', async ({ page }) => {
        await page.setViewportSize({ width: 390, height: 844 });
        await openBranchHours(page);
        await expectNoSeriousViolations(page, 'kitchen-branch-hours-narrow');
    });

    test('the zone list on a phone, where the table becomes stacked cards', async ({ page }) => {
        await page.setViewportSize({ width: 390, height: 844 });
        await openZones(page);
        await expectNoSeriousViolations(page, 'kitchen-zones-narrow');
    });

    /* ── the order desk queue ────────────────────────────────────────────────────────────────── */

    /**
     * The desk queue as it lands, with its two filter controls.
     *
     * The risk here is in the toolbar rather than in the table. A `tablist` without an accessible
     * name and a checkbox group whose chips have lost their label are both serious findings and both
     * invisible by eye — and this screen is the first in the workspace to put a segmented control
     * and a chip group in one panel with a search field.
     */
    test('the order desk queue, with its window and status filters', async ({ page }) => {
        await openOrderDesk(page);
        await expectNoSeriousViolations(page, 'kitchen-order-desk');
    });

    /**
     * The same queue at phone width, where `Table` stops being an ARIA table and becomes stacked
     * cards. Each row carries a due badge and a status badge whose meaning must survive the switch,
     * and the ingredient list already documents this as the width where the labelled-field
     * relationship goes missing unnoticed.
     */
    test('the same queue on a phone, where the table becomes stacked cards', async ({ page }) => {
        await page.setViewportSize({ width: 390, height: 844 });
        await openOrderDesk(page);
        await expectNoSeriousViolations(page, 'kitchen-order-desk-narrow');
    });

    /**
     * The queue narrowed to a window with nothing in it.
     *
     * Switching the window is local to this screen — it changes a query parameter, writes nothing —
     * so it is reachable from a project that runs in parallel with three others. `overdue` is the
     * window most likely to be empty on a demonstration database, which is the point: an empty state
     * that arrives *after* a filter change is a region that replaces a table, and a heading order or
     * a live region left behind by that swap is exactly what this sweep catches.
     */
    test('the queue after a window change, whichever of the two states it lands in', async ({
        page,
    }) => {
        await openOrderDesk(page);
        await page.getByTestId('kitchen-order-desk-window-overdue').click();
        await expect(
            page
                .getByTestId('kitchen-order-desk-table')
                .or(page.getByTestId('kitchen-order-desk-empty')),
        ).toBeVisible();
        await expectNoSeriousViolations(page, 'kitchen-order-desk-overdue');
    });

    /* ── the review queue (K1.8) ─────────────────────────────────────────────────────────────── */

    /**
     * The review queue, swept with rows in it.
     *
     * Two risks live here and nowhere else in this workspace. The summary is a `role="alert"`
     * callout that arrives *after* the data does — a live region announcing a food-safety blocker,
     * which has to have a name and a role rather than only a colour. And every row carries a stack
     * of reason badges whose meaning must not be colour alone: a red "quarantined" chip and an amber
     * "unverified" chip are the same shape to somebody who cannot tell them apart, which is why
     * `Badge` pairs every tone with a glyph and why this sweep keeps the pairing honest.
     */
    test('the review queue, with its summary and its reason chips', async ({ page }) => {
        await openReview(page);
        await expect(page.getByTestId('kitchen-review-sections')).toBeVisible();
        await expectNoSeriousViolations(page, 'kitchen-review');
    });

    /**
     * The same queue at phone width, where the row cards stack and the reason chips wrap.
     *
     * Wrapping is where a chip group most often loses its relationship to the row above it, and a
     * scrolling region with nothing focusable inside is the serious finding the allergen-class page
     * already documents — this screen's rows each carry a control, so the sweep proves it stays that
     * way at the width where the layout changes most.
     */
    test('the same queue on a phone', async ({ page }) => {
        await page.setViewportSize({ width: 390, height: 844 });
        await openReview(page);
        await expect(page.getByTestId('kitchen-review-sections')).toBeVisible();
        await expectNoSeriousViolations(page, 'kitchen-review-narrow');
    });

    /**
     * The ingredient editor reached *from* the queue, which is the state K1.8 added.
     *
     * The banner is a `role="alert"` that is present on first paint rather than announced by an
     * interaction, and the record beneath it is a full form. An alert rendered above a form is
     * exactly where a heading order or a landmark relationship goes wrong unnoticed.
     */
    test('the record editor a queue row opens, with its quarantine banner', async ({ page }) => {
        await openReview(page);
        await page
            .locator('[data-testid^="kitchen-review-ingredients-"][data-testid$="-open"]')
            .first()
            .click();
        await expect(page.getByTestId('kitchen-ingredient-quarantine')).toBeVisible();
        await expectNoSeriousViolations(page, 'kitchen-review-quarantined-editor');
    });
});
