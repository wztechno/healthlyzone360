import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

import { selectVerdantKitchenContext, signIn } from './helpers.ts';

/**
 * The kitchen workspace, end to end, in English.
 *
 * ## What this journey is really checking
 *
 * A management prototype earns its keep by *changing something*. So the spine of this spec is one
 * uninterrupted act: sign in as the kitchen manager, open the ingredient library, open a record,
 * rewrite both halves of its bilingual name, save it, and read the change back off the list. Every
 * step of that goes through `KitchenAdminRepository` into the mutable store, and the row showing the
 * new text is the store agreeing.
 *
 * Around it are the two claims the workspace makes about safety, each asserted where it is visible:
 * the allergen section warns *before* an edit that changing a mapping changes a published label, and
 * the allergen classes page offers no control at all, because class governance is platform-level
 * (decision D-041).
 *
 * ## The optimistic-locking conflict is not driven from here, on purpose
 *
 * A `resource.conflict` needs a second writer moving the same row while an editor holds it. In mock
 * mode the store lives inside the page, so a second browser tab gets a *different* world and could
 * never collide with the first; and the one-tab routes to a stale version all invalidate the query
 * cache on the way, which is precisely the bug the conflict dialog exists to prevent. Driving it
 * would therefore mean reaching into the store from the page, which asserts the harness rather than
 * the product. The path is covered where the second writer is real —
 * `src/features/kitchen-admin/kitchen-admin.test.tsx`, "offers reload-or-keep when somebody else has
 * moved the record on" — including the dialog's copy and both of its answers.
 */

async function openKitchen(page: Page) {
    await signIn(page);
    await selectVerdantKitchenContext(page);
    await page.goto('/kitchen');
    await expect(page.getByTestId('kitchen-home-screen')).toBeVisible();
}

async function openIngredients(page: Page) {
    await openKitchen(page);
    await page.getByTestId('kitchen-family-ingredients-open').click();
    await expect(page.getByTestId('kitchen-ingredients-screen')).toBeVisible();
    await expect(page.getByTestId('kitchen-ingredients-table')).toBeVisible();
}

/** The `kitchen-ingredient-{id}` prefix of the first row that offers an open control. */
async function firstRowBase(page: Page): Promise<string> {
    const control = page
        .locator('[data-testid^="kitchen-ingredient-"][data-testid$="-open"]')
        .first();
    await expect(control).toBeVisible();
    const testId = await control.getAttribute('data-testid');
    if (testId === null) throw new Error('The ingredient row carries no test id.');
    return testId.slice(0, testId.length - '-open'.length);
}

async function openRecipes(page: Page) {
    await openKitchen(page);
    await page.getByTestId('kitchen-family-recipes-open').click();
    await expect(page.getByTestId('kitchen-recipes-screen')).toBeVisible();
    await expect(page.getByTestId('kitchen-recipes-table')).toBeVisible();
}

/** The `kitchen-recipe-{id}` prefix of the first recipe row. */
async function firstRecipeBase(page: Page): Promise<string> {
    const control = page.locator('[data-testid^="kitchen-recipe-"][data-testid$="-open"]').first();
    await expect(control).toBeVisible();
    const testId = await control.getAttribute('data-testid');
    if (testId === null) throw new Error('The recipe row carries no test id.');
    return testId.slice(0, testId.length - '-open'.length);
}

async function openProducts(page: Page) {
    await openKitchen(page);
    await page.getByTestId('kitchen-family-products-open').click();
    await expect(page.getByTestId('kitchen-products-screen')).toBeVisible();
    await expect(page.getByTestId('kitchen-products-table')).toBeVisible();
}

/** The `kitchen-product-{id}` prefix of the first product row. */
async function firstProductBase(page: Page): Promise<string> {
    const control = page.locator('[data-testid^="kitchen-product-"][data-testid$="-open"]').first();
    await expect(control).toBeVisible();
    const testId = await control.getAttribute('data-testid');
    if (testId === null) throw new Error('The product row carries no test id.');
    return testId.slice(0, testId.length - '-open'.length);
}

async function openMeals(page: Page) {
    await openKitchen(page);
    await page.getByTestId('kitchen-family-meals-open').click();
    await expect(page.getByTestId('kitchen-meals-screen')).toBeVisible();
    await expect(page.getByTestId('kitchen-meals-table')).toBeVisible();
}

async function openPriceLists(page: Page) {
    await openKitchen(page);
    await page.getByTestId('kitchen-family-price-lists-open').click();
    await expect(page.getByTestId('kitchen-price-lists-screen')).toBeVisible();
    await expect(page.getByTestId('kitchen-price-lists-table')).toBeVisible();
}

/** The `kitchen-price-list-{id}` prefix of the first row that carries a confirmed price. */
async function firstPriceListBase(page: Page): Promise<string> {
    const control = page
        .locator('[data-testid^="kitchen-price-list-"][data-testid$="-open"]')
        .first();
    await expect(control).toBeVisible();
    const testId = await control.getAttribute('data-testid');
    if (testId === null) throw new Error('The price-list row carries no test id.');
    return testId.slice(0, testId.length - '-open'.length);
}

/**
 * The `…-row-seed-0-{itemKey}` prefix of the first entry in an open editor.
 *
 * Anchored on the status label rather than on the amount field, because the amount field is only
 * rendered for a confirmed price — a row awaiting one has no such control at all.
 */
async function firstEntryRow(page: Page): Promise<string> {
    const control = page
        .locator('[data-testid^="kitchen-price-list-entries-row-"][data-testid$="-status-label"]')
        .first();
    await expect(control).toBeVisible();
    const testId = await control.getAttribute('data-testid');
    if (testId === null) throw new Error('The entry row carries no test id.');
    return testId.slice(0, testId.length - '-status-label'.length);
}

test.describe('kitchen workspace (en)', () => {
    test('shows only the families this role may open, with real counts', async ({ page }) => {
        await openKitchen(page);

        await expect(page.getByTestId('kitchen-family-ingredients')).toBeVisible();
        await expect(page.getByTestId('kitchen-family-recipes')).toBeVisible();
        await expect(page.getByTestId('kitchen-family-products')).toBeVisible();
        await expect(page.getByTestId('kitchen-family-meals')).toBeVisible();
        await expect(page.getByTestId('kitchen-family-allergen-classes')).toBeVisible();

        // Every family with a publication state counts what a kitchen acts on: published,
        // drafts, quarantined — read from the repository, per family, not shared.
        await expect(page.getByTestId('kitchen-family-recipes-published')).toContainText(
            'published',
        );
        await expect(page.getByTestId('kitchen-family-products-published')).toContainText(
            'published',
        );
        await expect(page.getByTestId('kitchen-family-meals-published')).toContainText('published');

        // Counts come from the repository, not from a constant on the card.
        await expect(page.getByTestId('kitchen-family-ingredients-total')).toContainText('records');
        // A reference family says what it is instead of inventing a draft count.
        await expect(page.getByTestId('kitchen-family-allergen-classes-reference')).toContainText(
            'Reference',
        );
        await expect(page.getByTestId('kitchen-family-allergen-classes-drafts')).toHaveCount(0);
    });

    test('lists the seeded library with its allergens, statuses and provenance', async ({
        page,
    }) => {
        await openIngredients(page);

        const base = await firstRowBase(page);
        await expect(page.getByTestId(`${base}-name`)).toBeVisible();
        await expect(page.getByTestId(`${base}-category`)).toBeVisible();
        await expect(page.getByTestId(`${base}-status`)).toBeVisible();
        await expect(page.getByTestId(`${base}-updated`)).toBeVisible();

        // The allergen chips are codes rather than prose: a label is read against a regulatory
        // identity, and translating one into a row's own language would break that reading.
        await expect(
            page.locator('[data-testid^="kitchen-ingredient-"][data-testid$="-allergens"]').first(),
        ).toBeVisible();

        await expect(page.getByTestId('kitchen-ingredients-toolbar-result-summary')).toContainText(
            'matches',
        );
    });

    test('narrows the list, and says so when nothing matches', async ({ page }) => {
        await openIngredients(page);

        await page
            .getByTestId('kitchen-ingredients-toolbar-search')
            .locator('input')
            .first()
            .fill('nothing-like-this-exists');

        await expect(page.getByTestId('kitchen-ingredients-empty')).toBeVisible();

        await page.getByTestId('kitchen-ingredients-clear').click();
        await expect(page.getByTestId('kitchen-ingredients-table')).toBeVisible();
    });

    test('rewrites both halves of a bilingual name, and the list shows the change', async ({
        page,
    }) => {
        await openIngredients(page);

        const base = await firstRowBase(page);
        await page.getByTestId(`${base}-open`).click();
        await expect(page.getByTestId('kitchen-ingredient-editor-screen')).toBeVisible();

        // The editor states what the record is before it is edited.
        await expect(page.getByTestId('kitchen-ingredient-editor-screen-status')).toBeVisible();
        await expect(page.getByTestId('kitchen-ingredient-editor-screen-updated')).toBeVisible();

        await page.getByTestId('kitchen-ingredient-name-en-input').fill('Chickpeas, checked');
        await page.getByTestId('kitchen-ingredient-name-ar-input').fill('حمّص مدقّق');

        // Editing arms the guard: the badge is the visible half of the unsaved-changes contract.
        await expect(page.getByTestId('kitchen-ingredient-editor-screen-dirty')).toBeVisible();

        await page.getByTestId('kitchen-ingredient-editor-screen-save').click();
        await expect(page.getByTestId('kitchen-ingredient-saved-toast')).toBeVisible();
        await expect(page.getByTestId('kitchen-ingredient-editor-screen-dirty')).toHaveCount(0);

        // Back to the list: the row reads what was just written, which is the store agreeing.
        await page.getByTestId('kitchen-ingredient-editor-screen-back').click();
        await expect(page.getByTestId('kitchen-ingredients-table')).toBeVisible();
        await expect(page.getByTestId(`${base}-name`)).toContainText('Chickpeas, checked');
        await expect(page.getByTestId(`${base}-missing-arabic`)).toHaveCount(0);
    });

    test('asks before throwing half-typed changes away', async ({ page }) => {
        await openIngredients(page);

        const base = await firstRowBase(page);
        await page.getByTestId(`${base}-open`).click();
        await expect(page.getByTestId('kitchen-ingredient-editor-screen')).toBeVisible();

        await page.getByTestId('kitchen-ingredient-notes-input').fill('Half a thought.');
        await page.getByTestId('kitchen-ingredient-editor-screen-back').click();

        await expect(
            page.getByTestId('kitchen-ingredient-editor-screen-unsaved-dialog'),
        ).toBeVisible();
        await page.getByTestId('kitchen-ingredient-editor-screen-unsaved-keep').click();
        await expect(page.getByTestId('kitchen-ingredient-editor-screen')).toBeVisible();

        await page.getByTestId('kitchen-ingredient-editor-screen-back').click();
        await page.getByTestId('kitchen-ingredient-editor-screen-unsaved-discard').click();
        await expect(page.getByTestId('kitchen-ingredients-table')).toBeVisible();
    });

    test('states the food-safety consequence before an allergen mapping is touched', async ({
        page,
    }) => {
        await openIngredients(page);

        const base = await firstRowBase(page);
        await page.getByTestId(`${base}-open`).click();
        await expect(page.getByTestId('kitchen-ingredient-allergens')).toBeVisible();

        await expect(page.getByTestId('kitchen-ingredient-allergen-safety')).toContainText(
            'published label',
        );
        await expect(page.getByTestId('kitchen-ingredient-mapping-add')).toBeVisible();
        await expect(page.getByTestId('kitchen-ingredient-mapping-save')).toBeVisible();
    });

    test('creates a draft ingredient rather than publishing one on sight', async ({ page }) => {
        await openIngredients(page);

        await page.getByTestId('kitchen-ingredients-toolbar-create').click();
        await expect(page.getByTestId('kitchen-ingredient-editor-screen-title')).toContainText(
            'New ingredient',
        );

        await page.getByTestId('kitchen-ingredient-name-en-input').fill('Toasted burghul');
        await page.getByTestId('kitchen-ingredient-category-trigger').click();
        await page.locator('[data-testid^="kitchen-ingredient-category-option-"]').first().click();

        await page.getByTestId('kitchen-ingredient-editor-screen-save').click();
        await expect(page.getByTestId('kitchen-ingredient-created-toast')).toContainText('draft');

        // The create landed on the record's own address, with the mapping section now available.
        await expect(page.getByTestId('kitchen-ingredient-allergens')).toBeVisible();
        await expect(page.getByTestId('kitchen-ingredient-editor-screen-status')).toContainText(
            'Draft',
        );
    });

    test('archives a row behind a confirmation that says nothing is deleted', async ({ page }) => {
        await openIngredients(page);

        const control = page
            .locator('[data-testid^="kitchen-ingredient-"][data-testid$="-archive"]')
            .first();
        await expect(control).toBeVisible();
        await control.click();

        await expect(page.getByTestId('kitchen-ingredients-archive-dialog')).toBeVisible();
        await expect(
            page.getByTestId('kitchen-ingredients-archive-dialog-description'),
        ).toContainText('Nothing is deleted');

        await page.getByTestId('kitchen-ingredients-archive-confirm').click();
        await expect(page.getByTestId('kitchen-ingredients-archived-toast')).toBeVisible();
    });

    test('lists the recipe book with each version’s state and derived label', async ({ page }) => {
        await openRecipes(page);

        const base = await firstRecipeBase(page);
        await expect(page.getByTestId(`${base}-name`)).toBeVisible();
        await expect(page.getByTestId(`${base}-version`)).toContainText('Version');
        // The version's own state and the label it carries are read per row; both must arrive.
        await expect(page.getByTestId(`${base}-version-status`)).toBeVisible();
        await expect(page.getByTestId(`${base}-updated`)).toBeVisible();
        await expect(page.getByTestId('kitchen-recipes-toolbar-result-summary')).toContainText(
            'match',
        );
    });

    /**
     * The spine of the slice: a published version is immutable, so changing it means opening its
     * successor, editing that, watching the figures follow, and publishing it in turn. Every step
     * goes through `KitchenAdminRepository` into the mutable store, and the list showing version two
     * at the end is the store agreeing.
     */
    test('opens a draft from a published version, edits it, and publishes the successor', async ({
        page,
    }) => {
        await openRecipes(page);

        const base = await firstRecipeBase(page);
        await page.getByTestId(`${base}-open`).click();
        await expect(page.getByTestId('kitchen-recipe-editor-screen')).toBeVisible();

        // Read-only: the published version offers no way to add a line, only its successor.
        await expect(page.getByTestId('kitchen-recipe-immutable')).toBeVisible();
        await expect(page.getByTestId('kitchen-recipe-lines-add')).toHaveCount(0);

        await page.getByTestId('kitchen-recipe-new-draft').click();
        await expect(page.getByTestId('kitchen-recipe-lines-add')).toBeVisible();

        // The preview is populated before the edit, so a change to it is observable.
        await expect(page.getByTestId('kitchen-recipe-rollup-figures')).toBeVisible();
        const energy = page.getByTestId('kitchen-recipe-rollup-facts-amount-energy');
        await expect(energy).toBeVisible();
        const before = (await energy.textContent()) ?? '';

        const quantity = page
            .getByTestId('kitchen-recipe-lines-row-line-1-quantity')
            .locator('input')
            .first();
        await quantity.fill('900');

        // The figures follow the lines. The allergen list is never blanked while they do.
        await expect(page.getByTestId('kitchen-recipe-rollup-allergens')).toBeVisible();
        await expect(energy).not.toHaveText(before, { timeout: 15_000 });

        await page.getByTestId('kitchen-recipe-editor-screen-save').click();
        await expect(page.getByTestId('kitchen-recipe-saved-toast')).toBeVisible();

        await page.getByTestId('kitchen-recipe-publish').click();
        await expect(page.getByTestId('kitchen-recipe-publish-dialog')).toBeVisible();
        // The dialog states what becomes visible before it asks.
        await expect(page.getByTestId('kitchen-recipe-publish-consequence')).toContainText('menu');
        await expect(page.getByTestId('kitchen-recipe-publish-allergens')).toBeVisible();

        await page.getByTestId('kitchen-recipe-publish-confirm').click();
        await expect(page.getByTestId('kitchen-recipe-published-toast')).toBeVisible();

        await page.getByTestId('kitchen-recipe-editor-screen-back').click();
        await expect(page.getByTestId('kitchen-recipes-table')).toBeVisible();
        await expect(page.getByTestId(`${base}-version`)).toContainText('Version 2');
        await expect(page.getByTestId(`${base}-version-status`)).toContainText('Published');
    });

    test('withdraws a recipe behind a confirmation that says nothing is deleted', async ({
        page,
    }) => {
        await openRecipes(page);

        const control = page
            .locator('[data-testid^="kitchen-recipe-"][data-testid$="-archive"]')
            .first();
        await expect(control).toBeVisible();
        await control.click();

        await expect(page.getByTestId('kitchen-recipes-archive-dialog')).toBeVisible();
        await expect(page.getByTestId('kitchen-recipes-archive-dialog-description')).toContainText(
            'Nothing is deleted',
        );

        await page.getByTestId('kitchen-recipes-archive-confirm').click();
        await expect(page.getByTestId('kitchen-recipes-archived-toast')).toBeVisible();
    });

    test('lists products with their packs, channels and the archive that is not a delete', async ({
        page,
    }) => {
        await openProducts(page);

        const base = await firstProductBase(page);
        await expect(page.getByTestId(`${base}-name`)).toBeVisible();
        await expect(page.getByTestId(`${base}-category`)).toBeVisible();
        await expect(page.getByTestId(`${base}-packs`)).toBeVisible();
        await expect(page.getByTestId(`${base}-packs-count`)).toContainText('pack');
        await expect(page.getByTestId(`${base}-channels`)).toBeVisible();
        await expect(page.getByTestId(`${base}-status`)).toBeVisible();

        // A product has no publish action on this contract, so no row offers one.
        await expect(page.getByTestId(`${base}-publish`)).toHaveCount(0);
        await expect(page.getByTestId(`${base}-archive`)).toBeVisible();
        await expect(page.getByTestId('kitchen-products-toolbar-result-summary')).toContainText(
            'match',
        );
    });

    /**
     * The product round trip: open a record, add a pack, save, and read the new pack back off the
     * list. Every step goes through `KitchenAdminRepository` into the mutable store; the list column
     * counting one more pack at the end is the store agreeing.
     */
    test('adds a pack to a product, saves it, and the list counts it', async ({ page }) => {
        await openProducts(page);

        const base = await firstProductBase(page);
        const before = (await page.getByTestId(`${base}-packs-count`).textContent()) ?? '';

        await page.getByTestId(`${base}-open`).click();
        await expect(page.getByTestId('kitchen-product-editor-screen')).toBeVisible();
        await expect(page.getByTestId('kitchen-product-editor-screen-status')).toBeVisible();

        await page.getByTestId('kitchen-product-packs-add').click();
        const added = 'kitchen-product-pack-editor-row-pack-1';
        await expect(page.getByTestId(added)).toBeVisible();

        // Editing arms the guard, which is the visible half of the unsaved-changes contract.
        await expect(page.getByTestId('kitchen-product-editor-screen-dirty')).toBeVisible();

        await page.getByTestId(`${added}-code`).locator('input').first().fill('CASE24');
        await page.getByTestId(`${added}-quantity`).locator('input').first().fill('6000');
        await page.getByTestId(`${added}-units-per-pack`).locator('input').first().fill('24');

        await page.getByTestId('kitchen-product-editor-screen-save').click();
        await expect(page.getByTestId('kitchen-product-saved-toast')).toBeVisible();
        await expect(page.getByTestId('kitchen-product-editor-screen-dirty')).toHaveCount(0);

        await page.getByTestId('kitchen-product-editor-screen-back').click();
        await expect(page.getByTestId('kitchen-products-table')).toBeVisible();
        await expect(page.getByTestId(`${base}-packs-count`)).not.toHaveText(before);
    });

    test('refuses a duplicate pack code rather than orphaning a price', async ({ page }) => {
        await openProducts(page);

        const base = await firstProductBase(page);
        await page.getByTestId(`${base}-open`).click();
        await expect(page.getByTestId('kitchen-product-packs-add')).toBeVisible();

        const first = page
            .locator('[data-testid^="kitchen-product-pack-editor-row-"][data-testid$="-code"]')
            .first();
        const existing = await first.locator('input').first().inputValue();

        await page.getByTestId('kitchen-product-packs-add').click();
        const added = 'kitchen-product-pack-editor-row-pack-1';
        await page.getByTestId(`${added}-code`).locator('input').first().fill(existing);

        // The reason sits on the offending row, and the save is refused while it is there.
        await expect(page.getByTestId(`${added}-code-error`)).toContainText('code');
        await expect(page.getByTestId('kitchen-product-editor-screen-save')).toBeDisabled();
    });

    test('switches a product onto a sales channel through its own save', async ({ page }) => {
        await openProducts(page);

        const base = await firstProductBase(page);
        await page.getByTestId(`${base}-open`).click();
        await expect(page.getByTestId('kitchen-product-channel-editor')).toBeVisible();

        // Every channel is a row, including the ones the product is not sold through.
        await page.getByTestId('kitchen-product-channel-editor-pos-toggle-control').click();
        await page.getByTestId('kitchen-product-channels-save').click();
        await expect(page.getByTestId('kitchen-product-channels-saved-toast')).toBeVisible();

        await page.getByTestId('kitchen-product-editor-screen-back').click();
        await expect(page.getByTestId(`${base}-channels`)).toContainText('Over the counter');
    });

    test('lists meals with the label they carry and what publication means', async ({ page }) => {
        await openMeals(page);

        const row = page.locator('[data-testid^="kitchen-meal-"][data-testid$="-status"]').first();
        await expect(row).toBeVisible();
        await expect(page.getByTestId('kitchen-meals-toolbar-result-summary')).toContainText(
            'match',
        );

        // A published meal says what publication *means* rather than leaving a badge to imply it.
        await expect(
            page.locator('[data-testid^="kitchen-meal-"][data-testid$="-visible"]').first(),
        ).toContainText('customers');
    });

    /**
     * The strongest claim this world can make, and the point of the whole slice: a meal created in
     * the kitchen is invisible until it is published, and the moment it is, the *public* marketplace
     * — the same store, the same session, no reload — answers for it.
     */
    test('publishes a new meal and it appears on the public menu in the same session', async ({
        page,
    }) => {
        await openMeals(page);

        await page.getByTestId('kitchen-meals-toolbar-create').click();
        await expect(page.getByTestId('kitchen-meal-editor-screen-title')).toContainText(
            'New meal',
        );

        const name = 'Charred aubergine bowl';
        await page.getByTestId('kitchen-meal-name-en-input').fill(name);
        await page.getByTestId('kitchen-meal-name-ar-input').fill('وعاء الباذنجان المشوي');
        await page.getByTestId('kitchen-meal-description-en-input').fill('Smoked, with tahini.');
        await page.getByTestId('kitchen-meal-description-ar-input').fill('مدخّن، مع طحينة.');
        await page.getByTestId('kitchen-meal-type-lunch').click();

        await page.getByTestId('kitchen-meal-editor-screen-save').click();
        await expect(page.getByTestId('kitchen-meal-created-toast')).toContainText('draft');
        await expect(page.getByTestId('kitchen-meal-editor-screen-status')).toContainText('Draft');

        // A draft carries no "on the public menu" notice, because it is not on it.
        await expect(page.getByTestId('kitchen-meal-published')).toHaveCount(0);

        await page.getByTestId('kitchen-meal-publish').click();
        await expect(page.getByTestId('kitchen-meal-publish-dialog')).toBeVisible();
        // The dialog states the consequence and the label before it asks.
        await expect(page.getByTestId('kitchen-meal-publish-consequence')).toContainText('menu');
        await expect(page.getByTestId('kitchen-meal-publish-allergens')).toBeVisible();

        await page.getByTestId('kitchen-meal-publish-confirm').click();
        await expect(page.getByTestId('kitchen-meal-published-toast')).toBeVisible();
        await expect(page.getByTestId('kitchen-meal-published')).toBeVisible();

        // Client-side navigation, so the in-page store survives: this is the same world.
        await page.getByTestId('kitchen-meal-view-public').click();
        await expect(page.getByTestId('meal-detail-name')).toContainText(name);

        // …and it is in the public listing too, reached from the meal's own breadcrumb. The
        // listing is cursor-paginated over a catalogue of forty, so it is searched rather than
        // scrolled — which also proves the new row is in the *query* and not merely addressable.
        await page.getByTestId('meal-detail-breadcrumbs').getByText('Meals').click();
        await expect(page.getByTestId('meals-grid')).toBeVisible();
        await page.getByTestId('meals-filter-search').locator('input').first().fill(name);
        await expect(page.getByTestId('meals-grid')).toContainText(name);
    });

    test('withdraws a meal behind a confirmation that says nothing is deleted', async ({
        page,
    }) => {
        await openMeals(page);

        const control = page
            .locator('[data-testid^="kitchen-meal-"][data-testid$="-retire"]')
            .first();
        await expect(control).toBeVisible();
        await control.click();

        await expect(page.getByTestId('kitchen-meals-retire-dialog')).toBeVisible();
        await expect(page.getByTestId('kitchen-meals-retire-dialog-description')).toContainText(
            'Nothing is deleted',
        );

        await page.getByTestId('kitchen-meals-retire-confirm').click();
        await expect(page.getByTestId('kitchen-meals-retired-toast')).toBeVisible();
    });

    test('shows the confidential margin in the kitchen and nowhere a customer looks', async ({
        page,
    }) => {
        await openMeals(page);
        await page.locator('[data-testid^="kitchen-meal-"][data-testid$="-open"]').first().click();
        await expect(page.getByTestId('kitchen-meal-editor-screen')).toBeVisible();

        await expect(page.getByTestId('kitchen-meal-confidential')).toBeVisible();
        await expect(page.getByTestId('kitchen-meal-confidential-badge')).toContainText(
            'Confidential',
        );
        // Either a figure or the honest refusal to state one — never a fabricated zero.
        await expect(
            page
                .getByTestId('kitchen-meal-margin')
                .or(page.getByTestId('kitchen-meal-margin-unknown')),
        ).toBeVisible();

        // The consumer meal page has no margin to render, because the shape has no field for one.
        await page.goto('/meals');
        await expect(page.getByTestId('meals-grid')).toBeVisible();
        await expect(page.getByText(/gross margin/i)).toHaveCount(0);
    });

    test('publishes the allergen reference as reference, with no way to change it', async ({
        page,
    }) => {
        await openKitchen(page);
        await page.getByTestId('kitchen-family-allergen-classes-open').click();

        await expect(page.getByTestId('kitchen-allergen-classes-screen')).toBeVisible();
        await expect(page.getByTestId('kitchen-allergen-classes-governance')).toContainText(
            'managed by the platform',
        );
        await expect(page.getByTestId('kitchen-allergen-classes-count')).toContainText('14');

        const card = page.locator('[data-testid^="kitchen-allergen-class-"]').first();
        await expect(card).toBeVisible();
        await expect(
            page
                .locator('[data-testid^="kitchen-allergen-class-"][data-testid$="-threshold"]')
                .first(),
        ).toBeVisible();
        await expect(
            page
                .locator('[data-testid^="kitchen-allergen-class-"][data-testid$="-reference"]')
                .first(),
        ).toBeVisible();
    });

    /* ── price lists (K1.5) ──────────────────────────────────────────────────────────────────── */

    /**
     * The round trip this slice exists for: change one amount, save it, publish the list, and read
     * the entry split back off the list screen.
     *
     * The assertion that matters most is the *negative* one in the publish dialog — a list is
     * published with placeholder and market-priced rows still in it, and the dialog has to say those
     * never reach a customer. A publish confirmation that only counted rows would be the most
     * expensive true-sounding sentence in this programme (plan §2.4).
     */
    test('confirms a price, publishes the list, and states what will never reach a customer', async ({
        page,
    }) => {
        await openPriceLists(page);

        // The list answers "how many of these prices are real?", not only "how many are there?".
        const anyBase = await firstPriceListBase(page);
        await expect(page.getByTestId(`${anyBase}-currency`)).toBeVisible();
        await expect(page.getByTestId(`${anyBase}-entries-confirmed`)).toContainText('confirmed');
        await expect(page.getByTestId(`${anyBase}-entries-placeholder`)).toBeVisible();
        await expect(page.getByTestId(`${anyBase}-entries-market`)).toBeVisible();

        // No create control anywhere: the contract publishes no `createPriceList`.
        await expect(page.getByTestId('kitchen-price-lists-toolbar-create')).toHaveCount(0);
        // …and no publish from a row: the consequence needs the editor's context.
        await expect(page.getByTestId(`${anyBase}-publish`)).toHaveCount(0);

        // The retail-pack lists are the ones the seed leaves in draft, precisely because not one
        // entry in them carries a confirmed amount. That is what this journey goes and fixes.
        await page.getByTestId('kitchen-price-lists-toolbar-status-draft').click();
        const base = await firstPriceListBase(page);
        await page.getByTestId(`${base}-open`).click();
        await expect(page.getByTestId('kitchen-price-list-editor-screen')).toBeVisible();

        // The currency is a fact rather than a field — there is no request that could change it.
        await expect(page.getByTestId('kitchen-price-list-currency')).toBeVisible();
        await expect(page.getByTestId('kitchen-price-list-readonly-note')).toContainText(
            'cannot be changed here',
        );

        const row = await firstEntryRow(page);

        // It starts as a row with no number and an honest reason for that — and with no amount
        // field at all, because a row in this state cannot hold one.
        await expect(page.getByTestId(`${row}-amount-absent`)).toBeVisible();
        await expect(page.getByTestId(`${row}-amount`)).toHaveCount(0);

        await page.getByTestId(`${row}-status-confirmed`).click();
        const amount = page.getByTestId(`${row}-amount`).locator('input').first();
        await expect(amount).toBeEditable();

        await amount.fill('5.50');
        await expect(page.getByTestId('kitchen-price-list-editor-screen-dirty')).toBeVisible();

        await page.getByTestId('kitchen-price-list-editor-screen-save').click();
        await expect(page.getByTestId('kitchen-price-list-saved-toast')).toBeVisible();
        // The figure survives the round trip through integer minor units unchanged.
        await expect(page.getByTestId(`${row}-amount`).locator('input').first()).toHaveValue(
            '5.50',
        );

        await page.getByTestId('kitchen-price-list-publish').click();
        await expect(page.getByTestId('kitchen-price-list-publish-dialog')).toBeVisible();
        await expect(page.getByTestId('kitchen-price-list-publish-consequence')).toContainText(
            'chargeable',
        );
        await expect(page.getByTestId('kitchen-price-list-publish-excluded')).toContainText(
            'excluded from every customer-facing price',
        );

        await page.getByTestId('kitchen-price-list-publish-confirm').click();
        await expect(page.getByTestId('kitchen-price-list-published-toast')).toBeVisible();
        await expect(page.getByTestId('kitchen-price-list-published')).toBeVisible();
        // A published list offers no second publish.
        await expect(page.getByTestId('kitchen-price-list-publish')).toHaveCount(0);
    });

    /**
     * The `CHECK`, driven through the controls rather than through the pure function.
     *
     * Switching a row away from `confirmed` has to clear the amount *and take the field away* in one
     * gesture, and switching back has to block the save until a number exists. A placeholder that
     * kept a stale figure is exactly the defect the NULL amount exists to prevent.
     */
    test('clears the amount and takes the field away when a price stops being confirmed', async ({
        page,
    }) => {
        await openPriceLists(page);
        const base = await firstPriceListBase(page);
        await page.getByTestId(`${base}-open`).click();
        await expect(page.getByTestId('kitchen-price-list-entries')).toBeVisible();

        const row = await firstEntryRow(page);
        await expect(page.getByTestId(`${row}-amount`).locator('input').first()).not.toHaveValue(
            '',
        );

        await page.getByTestId(`${row}-status-placeholder`).click();
        await expect(page.getByTestId(`${row}-amount`)).toHaveCount(0);
        await expect(page.getByTestId(`${row}-amount-absent`)).toBeVisible();
        await expect(page.getByTestId(`${row}-no-amount`)).toContainText(
            'never reaches a customer',
        );
        await expect(page.getByTestId(`${row}-badge`)).toContainText('Pending price');

        await page.getByTestId(`${row}-status-market_priced`).click();
        await expect(page.getByTestId(`${row}-badge`)).toContainText('Priced daily');

        // Confirmed again, and empty: the save is refused until a number is typed.
        await page.getByTestId(`${row}-status-confirmed`).click();
        const amount = page.getByTestId(`${row}-amount`).locator('input').first();
        await expect(amount).toHaveValue('');
        await expect(page.getByTestId('kitchen-price-list-editor-screen-save')).toBeDisabled();

        await amount.fill('7.25');
        await expect(page.getByTestId('kitchen-price-list-editor-screen-save')).toBeEnabled();
    });

    test('marks the agreement-scoped list, and says what confidential means', async ({ page }) => {
        await openPriceLists(page);

        await expect(page.getByTestId('kitchen-price-lists-confidential')).toContainText(
            'never shown outside it',
        );
        const badge = page
            .locator('[data-testid^="kitchen-price-list-"][data-testid$="-agreement"]')
            .first();
        await expect(badge).toBeVisible();
        await expect(badge).toContainText('Agreement');
    });
});
