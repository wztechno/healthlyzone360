import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

import {
    KITCHEN_OWNER,
    probeStack,
    selectVerdantKitchenContext,
    signIn,
    skipUnlessStackIsUp,
} from './helpers.ts';
import type { StackStatus } from './helpers.ts';

/**
 * The kitchen workspace, end to end, against the real API.
 *
 * ## Why the whole file is a write spec now
 *
 * A management workspace earns its keep by *changing something*, and every spine journey below does:
 * an ingredient is created and renamed, a pack is added to a product, a price is confirmed and its
 * list published, a plan cell is switched on, a zone gains a gazetteer area, a branch closes a day,
 * a meal is published onto the public menu. In the mock world all of that lived inside one page and
 * evaporated with it, so it was safe to run in parallel. Against PostgreSQL each one is a row that
 * outlives the test, so the whole file belongs to `web-write` — one worker, no retries.
 *
 * ## The persona is the kitchen's owner, and it has to be
 *
 * `owner@verdant.test` holds `organisation_owner` **and** `kitchen_manager` at Verdant Kitchen. The
 * account these journeys used in the mock world, `dietitian@cedar.test`, is a plain `member` there:
 * the catalogue endpoints answer `403` for it, which reads in a spec as a broken screen rather than
 * as the server being right.
 *
 * ## Recipes are absent, and that is the seed rather than the screen
 *
 * `GET /catalogue/recipes` answers `total_count: 0` for Verdant — no seeder writes one. The four
 * recipe journeys this file used to carry (list, draft-from-published, publish the successor,
 * withdraw) are therefore *deleted rather than skipped*: a recipe test against an empty recipe book
 * proves nothing, and a skipped one accumulates as noise. They come back with the seeder that gives
 * the demonstration kitchen a recipe book; `kitchen-admin-recipes.test.tsx` covers the editor's
 * behaviour in the meantime.
 *
 * ## Every record this file creates is uniquely named
 *
 * A slug is unique per organisation, so a second run that created "Charred aubergine bowl" again
 * would be refused by the server for a reason that has nothing to do with the journey. Names carry a
 * timestamp, which makes the suite re-runnable against one seeded world — the property that lets
 * `pnpm run e2e:write` be pressed twice without a `migrate:fresh` in between.
 */

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

/** A name nothing else in the database can already be using. */
function unique(prefix: string): string {
    return `${prefix} ${String(Date.now())}`;
}

async function openKitchen(page: Page) {
    await signIn(page, KITCHEN_OWNER);
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

/**
 * Create an ingredient this kitchen owns, and stay on its editor.
 *
 * Of the 218 ingredients Verdant can see, 213 belong to the shared platform library, whose name,
 * classification and aliases are read-only for everyone — `organisation_id === null` on the wire,
 * `isPlatformLibrary` in the editor. So a test that needs an editable record has to make one, and
 * that is also the honest shape of the journey: a kitchen edits what it created or forked, never the
 * platform's own row.
 *
 * The English name only, deliberately. The record then arrives carrying the missing-Arabic warning,
 * which is the state the bilingual test goes on to clear.
 */
async function createOwnIngredient(page: Page, nameEn: string) {
    await openIngredients(page);

    await page.getByTestId('kitchen-ingredients-toolbar-create').click();
    await expect(page.getByTestId('kitchen-ingredient-editor-screen-title')).toContainText(
        'New ingredient',
    );

    await page.getByTestId('kitchen-ingredient-name-en-input').fill(nameEn);
    await page.getByTestId('kitchen-ingredient-category-trigger').click();
    await page.locator('[data-testid^="kitchen-ingredient-category-option-"]').first().click();

    await page.getByTestId('kitchen-ingredient-editor-screen-save').click();
    await expect(page.getByTestId('kitchen-ingredient-created-toast')).toBeVisible();
    // The create landed on the record's own address; the mapping section only exists there.
    await expect(page.getByTestId('kitchen-ingredient-allergens')).toBeVisible();
}

/**
 * The `kitchen-ingredient-{id}` prefix of the one row matching a search.
 *
 * Searching rather than reading the first row, because a freshly created ingredient sorts last by
 * `created_at` and therefore lands on the ninth page of a 218-row library. Narrowing the list to it
 * is both shorter than paging to it and the thing a person would actually do.
 */
async function rowMatching(page: Page, query: string): Promise<string> {
    await page
        .getByTestId('kitchen-ingredients-toolbar-search')
        .locator('input')
        .first()
        .fill(query);

    const control = page
        .locator('[data-testid^="kitchen-ingredient-"][data-testid$="-open"]')
        .first();
    await expect(control).toBeVisible();
    const testId = await control.getAttribute('data-testid');
    if (testId === null) throw new Error('The ingredient row carries no test id.');
    return testId.slice(0, testId.length - '-open'.length);
}

async function openProducts(page: Page) {
    await openKitchen(page);
    await page.getByTestId('kitchen-family-products-open').click();
    await expect(page.getByTestId('kitchen-products-screen')).toBeVisible();
    await expect(page.getByTestId('kitchen-products-table')).toBeVisible();
}

/**
 * The `kitchen-product-{id}` prefix of a product that already carries at least one pack.
 *
 * Narrowed by search rather than taken from the top of the list: the first row alphabetically is a
 * draft with no packs at all, and two of the journeys below need an existing pack to read a code
 * off. `VerdantProductCatalogueSeeder` gives every production product a default pack variant.
 */
async function packedProductBase(page: Page, query = 'Marinated'): Promise<string> {
    await page.getByTestId('kitchen-products-toolbar-search').locator('input').first().fill(query);
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

/** The `kitchen-price-list-{id}` prefix of the first row. */
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
 * The `…-row-{key}` prefix of the first entry in an open editor.
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

async function openPlans(page: Page) {
    await openKitchen(page);
    await page.getByTestId('kitchen-family-plans-open').click();
    await expect(page.getByTestId('kitchen-plans-screen')).toBeVisible();
    await expect(page.getByTestId('kitchen-plans-table')).toBeVisible();
}

/** The `kitchen-plan-{id}` prefix of the first plan row. */
async function firstPlanBase(page: Page): Promise<string> {
    const control = page.locator('[data-testid^="kitchen-plan-"][data-testid$="-open"]').first();
    await expect(control).toBeVisible();
    const testId = await control.getAttribute('data-testid');
    if (testId === null) throw new Error('The plan row carries no test id.');
    return testId.slice(0, testId.length - '-open'.length);
}

async function openZones(page: Page) {
    await openKitchen(page);
    await page.getByTestId('kitchen-family-delivery-zones-open').click();
    await expect(page.getByTestId('kitchen-zones-screen')).toBeVisible();
    await expect(page.getByTestId('kitchen-zones-table')).toBeVisible();
}

/** The `kitchen-zone-{id}` prefix of the first delivery-zone row. */
async function firstZoneBase(page: Page): Promise<string> {
    const control = page.locator('[data-testid^="kitchen-zone-"][data-testid$="-open"]').first();
    await expect(control).toBeVisible();
    const testId = await control.getAttribute('data-testid');
    if (testId === null) throw new Error('The zone row carries no test id.');
    return testId.slice(0, testId.length - '-open'.length);
}

async function openReview(page: Page) {
    await openKitchen(page);
    await page.getByTestId('kitchen-family-review-open').click();
    await expect(page.getByTestId('kitchen-review-screen')).toBeVisible();
}

/** The first weekday row of the branch-hours editor that is currently open for trade. */
async function firstOpenDayRow(page: Page): Promise<string> {
    for (const weekday of [1, 2, 3, 4, 5, 6, 7]) {
        const row = `kitchen-branch-hours-rows-day-${String(weekday)}`;
        if ((await page.getByTestId(`${row}-opens-input`).count()) > 0) return row;
    }
    throw new Error('The seeded branch is closed every day.');
}

/** The test id of the duration row this session just added, whatever ordinal it took. */
async function addedDurationRow(page: Page): Promise<string> {
    const row = page
        .locator('[data-testid^="kitchen-plan-duration-rows-row-duration-"]')
        .filter({ hasNot: page.locator('[data-testid*="seed-duration"]') })
        .first();
    await expect(row).toBeVisible();
    const testId = await row.getAttribute('data-testid');
    if (testId === null) throw new Error('The duration row carries no test id.');
    return testId;
}

test.describe('kitchen workspace (en)', () => {
    test('shows only the families this role may open, with real counts', async ({ page }) => {
        await openKitchen(page);

        await expect(page.getByTestId('kitchen-ops-shell')).toBeVisible();
        await expect(page.getByTestId('kitchen-home-kpis')).toBeVisible();
        await expect(page.getByTestId('kitchen-home-grid')).toBeVisible();
        await expect(page.getByTestId('kitchen-home-section-catalogue')).toBeVisible();

        await expect(page.getByTestId('kitchen-family-review')).toBeVisible();
        await expect(page.getByTestId('kitchen-family-ingredients')).toBeVisible();
        await expect(page.getByTestId('kitchen-family-recipes')).toBeVisible();
        await expect(page.getByTestId('kitchen-family-products')).toBeVisible();
        await expect(page.getByTestId('kitchen-family-meals')).toBeVisible();
        await expect(page.getByTestId('kitchen-family-allergen-classes')).toBeVisible();

        // Every family with a publication state counts what a kitchen acts on: published,
        // drafts, quarantined — read from the API, per family, not shared.
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

    test('opens an ops panel that does not invent stock counts', async ({ page }) => {
        await openKitchen(page);
        await page.getByTestId('kitchen-family-stock-open').click();
        await expect(page.getByTestId('kitchen-stock-panel')).toBeVisible();

        // Each metric equals the number of rows the screen actually fetched.
        await expect(page.getByTestId('kitchen-stock-items-table')).toBeVisible();
        await expect(page.getByTestId('kitchen-stock-levels-table')).toBeVisible();

        const itemRows = page.locator('[data-testid^="kitchen-stock-item-"][data-testid$="-name"]');
        const levelRows = page.locator(
            '[data-testid^="kitchen-stock-level-"][data-testid$="-quantity"]',
        );

        await expect(page.getByTestId('kitchen-stock-panel-metric-items-value')).toHaveText(
            String(await itemRows.count()),
        );
        await expect(page.getByTestId('kitchen-stock-panel-metric-levels-value')).toHaveText(
            String(await levelRows.count()),
        );
        // A count, never a blank: an unread figure would render an em dash rather than a zero.
        await expect(page.getByTestId('kitchen-stock-panel-metric-outOfStock-value')).toHaveText(
            /^\d+$/,
        );
    });

    test('lists the platform library with its allergens, statuses and provenance', async ({
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

    test('pages through the library, and every page is a different set of rows', async ({
        page,
    }) => {
        await openIngredients(page);

        // The seeded library is 218 rows at 25 a page, so there are nine pages and the control has
        // somewhere to go. A one-page library would render no control at all, by design.
        const pager = page.getByTestId('kitchen-ingredients-pagination');
        await expect(pager).toBeVisible();
        await expect(pager.getByTestId('kitchen-ingredients-pagination-page-3')).toBeVisible();

        const nameCells = page.locator(
            '[data-testid^="kitchen-ingredient-"][data-testid$="-name"]',
        );
        const namesOn = async (): Promise<string[]> => nameCells.allInnerTexts();

        const first = await namesOn();
        expect(first).toHaveLength(25);

        await pager.getByTestId('kitchen-ingredients-pagination-page-2').click();
        // Waiting on the *rows*, not on the control: the control marks the new page the moment it
        // is pressed, while the previous page stays on screen until the next one lands — which is
        // the point of holding it, and a race for any assertion that reads the table.
        await expect(nameCells.first()).not.toHaveText(first[0]!);

        const second = await namesOn();
        // Offset pagination's whole failure mode is repeating and skipping rows, so the assertion
        // that matters is that the two pages share nothing.
        expect(second.filter((name) => first.includes(name))).toEqual([]);

        await pager.getByTestId('kitchen-ingredients-pagination-previous').click();
        await expect(nameCells.first()).toHaveText(first[0]!);
        expect(await namesOn()).toEqual(first);
    });

    test('returns to page 1 when the filter changes', async ({ page }) => {
        await openIngredients(page);

        const pager = page.getByTestId('kitchen-ingredients-pagination');
        await pager.getByTestId('kitchen-ingredients-pagination-page-3').click();
        await expect(pager.getByTestId('kitchen-ingredients-pagination-page-3')).toHaveAttribute(
            'aria-current',
            'page',
        );

        // Staying on page 3 while the filter narrows to one page asks the backend for a page that
        // no longer exists — a 400, shown to somebody who only typed into a search box.
        await page
            .getByTestId('kitchen-ingredients-toolbar-search')
            .locator('input')
            .first()
            .fill('chicken');

        await expect(page.getByTestId('kitchen-ingredients-table')).toBeVisible();
        await expect(page.getByTestId('kitchen-ingredients-error')).toHaveCount(0);
        // Few enough matches to fit one page, so the control removes itself rather than offering a
        // single disabled row of buttons.
        await expect(page.getByTestId('kitchen-ingredients-pagination')).toHaveCount(0);
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
        const name = unique('Chickpeas');
        await createOwnIngredient(page, name);

        // The editor states what the record is before it is edited.
        await expect(page.getByTestId('kitchen-ingredient-editor-screen-status')).toBeVisible();
        await expect(page.getByTestId('kitchen-ingredient-editor-screen-updated')).toBeVisible();

        const checked = `${name} checked`;
        await page.getByTestId('kitchen-ingredient-name-en-input').fill(checked);
        await page.getByTestId('kitchen-ingredient-name-ar-input').fill('حمّص مدقّق');

        // Editing arms the guard: the badge is the visible half of the unsaved-changes contract.
        await expect(page.getByTestId('kitchen-ingredient-editor-screen-dirty')).toBeVisible();

        await page.getByTestId('kitchen-ingredient-editor-screen-save').click();
        await expect(page.getByTestId('kitchen-ingredient-saved-toast')).toBeVisible();
        await expect(page.getByTestId('kitchen-ingredient-editor-screen-dirty')).toHaveCount(0);

        // Back to the list: the row reads what was just written, which is the server agreeing.
        await page.getByTestId('kitchen-ingredient-editor-screen-back').click();
        await expect(page.getByTestId('kitchen-ingredients-table')).toBeVisible();

        const base = await rowMatching(page, checked);
        await expect(page.getByTestId(`${base}-name`)).toContainText(checked);
        // The warning the record arrived with, now cleared — both halves are written.
        await expect(page.getByTestId(`${base}-missing-arabic`)).toHaveCount(0);
    });

    test('asks before throwing half-typed changes away', async ({ page }) => {
        await createOwnIngredient(page, unique('Half-typed sample'));

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
    });

    test('creates a draft ingredient rather than publishing one on sight', async ({ page }) => {
        await openIngredients(page);

        await page.getByTestId('kitchen-ingredients-toolbar-create').click();
        await expect(page.getByTestId('kitchen-ingredient-editor-screen-title')).toContainText(
            'New ingredient',
        );

        await page.getByTestId('kitchen-ingredient-name-en-input').fill(unique('Toasted burghul'));
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

    /**
     * Archives the row this test made, rather than whatever happens to sort first.
     *
     * The list is 213 platform rows and a handful the kitchen owns, and only the second kind may be
     * archived at all. Taking "the first archive control on the page" therefore meant archiving one
     * of five real seeded records — permanently, every run, until they ran out. Making one first is
     * both correct and self-cleaning.
     */
    test('archives a row behind a confirmation that says nothing is deleted', async ({ page }) => {
        const name = unique('Archivable sample');
        await createOwnIngredient(page, name);

        await page.getByTestId('kitchen-ingredient-editor-screen-back').click();
        await expect(page.getByTestId('kitchen-ingredients-table')).toBeVisible();
        const base = await rowMatching(page, name);

        await page.getByTestId(`${base}-archive`).click();

        await expect(page.getByTestId('kitchen-ingredients-archive-dialog')).toBeVisible();
        await expect(
            page.getByTestId('kitchen-ingredients-archive-dialog-description'),
        ).toContainText('Nothing is deleted');

        await page.getByTestId('kitchen-ingredients-archive-confirm').click();
        await expect(page.getByTestId('kitchen-ingredients-archived-toast')).toBeVisible();
    });

    test('lists products with their packs, channels and the archive that is not a delete', async ({
        page,
    }) => {
        await openProducts(page);

        const base = await packedProductBase(page);
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
     * list. Every step goes through `KitchenAdminRepository` onto the API; the list counting one
     * more pack at the end is PostgreSQL agreeing.
     */
    test('adds a pack to a product, saves it, and the list counts it', async ({ page }) => {
        await openProducts(page);

        const base = await packedProductBase(page);
        const before = (await page.getByTestId(`${base}-packs-count`).textContent()) ?? '';

        await page.getByTestId(`${base}-open`).click();
        await expect(page.getByTestId('kitchen-product-editor-screen')).toBeVisible();
        await expect(page.getByTestId('kitchen-product-editor-screen-status')).toBeVisible();

        await page.getByTestId('kitchen-product-packs-add').click();
        const added = 'kitchen-product-pack-editor-row-pack-1';
        await expect(page.getByTestId(added)).toBeVisible();

        // Editing arms the guard, which is the visible half of the unsaved-changes contract.
        await expect(page.getByTestId('kitchen-product-editor-screen-dirty')).toBeVisible();

        // A pack code is unique within its product, so it carries the run's timestamp too.
        await page
            .getByTestId(`${added}-code`)
            .locator('input')
            .first()
            .fill(`CASE${String(Date.now()).slice(-6)}`);
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

        const base = await packedProductBase(page);
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

        const base = await packedProductBase(page);
        await page.getByTestId(`${base}-open`).click();
        await expect(page.getByTestId('kitchen-product-channel-editor')).toBeVisible();

        // Every channel is a row, including the ones the product is not sold through.
        await page.getByTestId('kitchen-product-channel-editor-pos-toggle-control').click();
        await page.getByTestId('kitchen-product-channels-save').click();
        await expect(page.getByTestId('kitchen-product-channels-saved-toast')).toBeVisible();
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
     * The strongest claim this workspace can make: a meal created in the kitchen is invisible until
     * it is published, and the moment it is, the *public* marketplace answers for it.
     *
     * That used to be a claim about one in-page store. It is a claim about PostgreSQL now — a write
     * on `POST /catalogue/items/{item}/publish`, then a read on `GET /marketplace/meals` — which is
     * strictly the stronger version of the same sentence.
     */
    test('publishes a new meal and the public menu answers for it', async ({ page }) => {
        await openMeals(page);

        await page.getByTestId('kitchen-meals-toolbar-create').click();
        await expect(page.getByTestId('kitchen-meal-editor-screen-title')).toContainText(
            'New meal',
        );

        const name = unique('Charred aubergine bowl');
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

        await page.getByTestId('kitchen-meal-view-public').click();
        await expect(page.getByTestId('meal-detail-name')).toContainText(name);

        // …and it is in the public listing too, reached from the meal's own breadcrumb. The
        // listing is cursor-paginated over a catalogue of forty-odd, so it is searched rather than
        // scrolled — which also proves the new row is in the *query* and not merely addressable.
        await page.getByTestId('meal-detail-breadcrumbs').getByText('Meals').click();
        await expect(page.getByTestId('meals-grid')).toBeVisible();
        await page.getByTestId('meals-filter-search').locator('input').first().fill(name);
        await expect(page.getByTestId('meals-grid')).toContainText(name);
    });

    /**
     * Withdrawal, driven on a meal this test published a moment ago.
     *
     * Taking "the first retire control on the page" would withdraw a seeded marketplace meal from
     * the public catalogue every run, which every read-only project then reads a smaller world from.
     */
    test('withdraws a meal behind a confirmation that says nothing is deleted', async ({
        page,
    }) => {
        await openMeals(page);

        await page.getByTestId('kitchen-meals-toolbar-create').click();
        const name = unique('Withdrawable bowl');
        await page.getByTestId('kitchen-meal-name-en-input').fill(name);
        await page.getByTestId('kitchen-meal-editor-screen-save').click();
        await expect(page.getByTestId('kitchen-meal-publish')).toBeVisible();

        await page.getByTestId('kitchen-meal-publish').click();
        await page.getByTestId('kitchen-meal-publish-confirm').click();
        await expect(page.getByTestId('kitchen-meal-published-toast')).toBeVisible();

        await page.getByTestId('kitchen-meal-retire').click();
        await expect(page.getByTestId('kitchen-meal-retire-dialog')).toBeVisible();
        await expect(page.getByTestId('kitchen-meal-retire-consequence')).toBeVisible();
        await page.getByTestId('kitchen-meal-retire-confirm').click();
        await expect(page.getByTestId('kitchen-meal-retired-toast')).toBeVisible();
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
        // Fourteen classes, seeded by `KitchenReferenceSeeder`. The total *is* the point here: a
        // regulatory reference that quietly gained or lost a class is a finding.
        await expect(page.getByTestId('kitchen-allergen-classes-count')).toContainText('14');

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
     * The round trip this slice exists for: change one amount, save it, and read the entry split
     * back off the list screen.
     *
     * The publish half runs only while a draft list still exists. Publication is a **one-way**
     * transition on a shared database — the seed ships exactly one draft tariff (`verdant-web-usd`)
     * and once it is published no second run can publish it again. So the dialog's assertions,
     * including the negative one that matters most (a list is published with placeholder and
     * market-priced rows still in it, and the dialog has to say those never reach a customer), are
     * driven when the control is there and skipped with a sentence when a previous run already used
     * it up. A test that silently passed on a published list would be the most expensive
     * true-sounding green in this suite.
     */
    test('confirms a price, and states what will never reach a customer', async ({ page }) => {
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

        await page.getByTestId('kitchen-price-lists-toolbar-status-draft').click();
        const hasDraft =
            (await page
                .locator('[data-testid^="kitchen-price-list-"][data-testid$="-open"]')
                .count()) > 0;
        test.skip(
            !hasDraft,
            'Every seeded price list is already published — publication is one-way, so a previous ' +
                'run of this file consumed the one draft tariff. Reseed to drive the publish dialog.',
        );

        const base = await firstPriceListBase(page);
        await page.getByTestId(`${base}-open`).click();
        await expect(page.getByTestId('kitchen-price-list-editor-screen')).toBeVisible();

        // The currency is a fact rather than a field — there is no request that could change it.
        await expect(page.getByTestId('kitchen-price-list-currency')).toBeVisible();
        await expect(page.getByTestId('kitchen-price-list-readonly-note')).toContainText(
            'cannot be changed here',
        );

        const row = await firstEntryRow(page);

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
     * kept a stale figure is exactly the defect the NULL amount exists to prevent. Nothing is saved,
     * so the record is left as it was found.
     */
    test('clears the amount and takes the field away when a price stops being confirmed', async ({
        page,
    }) => {
        await openPriceLists(page);
        const base = await firstPriceListBase(page);
        await page.getByTestId(`${base}-open`).click();
        await expect(page.getByTestId('kitchen-price-list-entries')).toBeVisible();

        const row = await firstEntryRow(page);
        await page.getByTestId(`${row}-status-confirmed`).click();
        const confirmed = page.getByTestId(`${row}-amount`).locator('input').first();
        await confirmed.fill('9.00');

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

    /* ── plans (K1.6) ────────────────────────────────────────────────────────────────────────── */

    test('lists plans by how finished they are, not by how many there are', async ({ page }) => {
        await openPlans(page);

        const base = await firstPlanBase(page);
        // Coverage rather than a count: three configurations across a six-cell grid is not a
        // finished plan, and a column showing only "3" would say that it was.
        await expect(page.getByTestId(`${base}-variants-coverage`)).toContainText('cells sold');
        await expect(page.getByTestId(`${base}-durations-days`)).toBeVisible();
        // The price column is derived from the price lists, which is where a plan price lives.
        await expect(page.getByTestId(`${base}-prices-confirmed`)).toContainText('confirmed');
        await expect(page.getByTestId(`${base}-status`)).toBeVisible();
        await expect(page.getByTestId('kitchen-plans-toolbar-result-summary')).toContainText(
            'match',
        );
    });

    /**
     * The spine of the slice: switch a cell of the matrix on, add a 20-day commitment, save both,
     * and read the change back off the list.
     *
     * The 20 days are the point of the `duration_kind` model (plan §4.3) — the consumer contract's
     * `1w | 2w | 4w | 12w` union could not express them at all — and the cell is the point of the
     * matrix: a configuration that exists *is* the availability, so switching one on is the whole
     * write.
     */
    test('switches a cell on, adds a 20-day commitment, and the list reads both back', async ({
        page,
    }) => {
        await openPlans(page);

        const base = await firstPlanBase(page);
        await page.getByTestId(`${base}-open`).click();
        await expect(page.getByTestId('kitchen-plan-editor-screen')).toBeVisible();
        await expect(page.getByTestId('kitchen-plan-matrix-grid')).toBeVisible();

        const coverage = page.getByTestId('kitchen-plan-matrix-coverage');
        const before = (await coverage.textContent()) ?? '';

        // A cell nothing is sold in. The grid draws it precisely so it can be switched on.
        const empty = page
            .locator(
                '[data-testid^="kitchen-plan-matrix-grid-cell-"][data-testid$="-control"][aria-checked="false"]',
            )
            .first();
        await expect(empty).toBeVisible();
        await empty.click();

        await expect(coverage).not.toHaveText(before);
        // Editing arms the guard, which is the visible half of the unsaved-changes contract.
        await expect(page.getByTestId('kitchen-plan-editor-screen-dirty')).toBeVisible();

        await page.getByTestId('kitchen-plan-variants-save').click();
        await expect(page.getByTestId('kitchen-plan-variants-saved-toast')).toBeVisible();

        // …and the 20-day commitment, which is the duration model's whole reason for existing.
        await page.getByTestId('kitchen-plan-durations-add').click();
        const row = await addedDurationRow(page);
        await page.getByTestId(`${row}-days-input`).fill('20');
        // Its discount is undecided rather than zero, and the row says which of the two it is.
        await expect(page.getByTestId(`${row}-discount-state`)).toContainText('not as zero');

        await page.getByTestId('kitchen-plan-durations-save').click();
        await expect(page.getByTestId('kitchen-plan-durations-saved-toast')).toBeVisible();

        await page.getByTestId('kitchen-plan-editor-screen-back').click();
        await expect(page.getByTestId('kitchen-plans-table')).toBeVisible();
        await expect(page.getByTestId(`${base}-durations-days`)).toContainText('20');
        await expect(page.getByTestId(`${base}-variants-coverage`)).not.toHaveText(before);
    });

    /**
     * The `CHECK`, driven through the controls. Nothing is saved, so the plan is left as it was.
     */
    test('takes the day field away when a duration becomes a one-off', async ({ page }) => {
        await openPlans(page);
        const base = await firstPlanBase(page);
        await page.getByTestId(`${base}-open`).click();
        await expect(page.getByTestId('kitchen-plan-duration-rows')).toBeVisible();

        const first = page
            .locator('[data-testid^="kitchen-plan-duration-rows-row-seed-duration-0-"]')
            .first();
        const testId = await first.getAttribute('data-testid');
        if (testId === null) throw new Error('The duration row carries no test id.');

        await expect(page.getByTestId(`${testId}-days-input`)).not.toHaveValue('');

        await page.getByTestId(`${testId}-kind-one_off`).click();
        await expect(page.getByTestId(`${testId}-days-input`)).toHaveCount(0);
        await expect(page.getByTestId(`${testId}-days-absent`)).toContainText('not zero, none');

        await page.getByTestId(`${testId}-kind-fixed_days`).click();
        await expect(page.getByTestId(`${testId}-days-input`)).toHaveValue('');
        await expect(page.getByTestId('kitchen-plan-durations-save')).toBeDisabled();

        await page.getByTestId(`${testId}-days-input`).fill('40');
        await expect(page.getByTestId('kitchen-plan-durations-save')).toBeEnabled();
    });

    /**
     * A publish attempt on a plan that is not ready, which is the state every new plan lands in: no
     * configurations, no durations and no confirmed price. The dialog states each reason *before*
     * the button is pressed, from the same price lists the server checks.
     */
    test('refuses to publish a plan that sells nothing and is priced by nothing', async ({
        page,
    }) => {
        await openPlans(page);

        await page.getByTestId('kitchen-plans-toolbar-create').click();
        await expect(page.getByTestId('kitchen-plan-editor-screen-title')).toContainText(
            'New plan',
        );
        // Nothing below the details is offered until the record exists to hang a write on.
        await expect(page.getByTestId('kitchen-plan-matrix-unavailable')).toBeVisible();

        await page.getByTestId('kitchen-plan-name-en-input').fill(unique('Autumn reset'));
        await page.getByTestId('kitchen-plan-name-ar-input').fill('إعادة ضبط الخريف');
        await page.getByTestId('kitchen-plan-editor-screen-save').click();
        await expect(page.getByTestId('kitchen-plan-created-toast')).toContainText('draft');
        await expect(page.getByTestId('kitchen-plan-editor-screen-status')).toContainText('Draft');

        await page.getByTestId('kitchen-plan-publish').click();
        await expect(page.getByTestId('kitchen-plan-publish-dialog')).toBeVisible();
        await expect(page.getByTestId('kitchen-plan-publish-blocked')).toContainText('sells');
        await expect(page.getByTestId('kitchen-plan-publish-blocked')).toContainText(
            'confirmed price',
        );
        await expect(page.getByTestId('kitchen-plan-publish-confirm')).toBeDisabled();
    });

    /**
     * The delivery slice's spine: choose an area, save it, and read the coverage back off the list.
     *
     * `setZoneAreas` replaces the whole set, so this is the write that decides where a kitchen can
     * deliver at all — and the picker is the one control in this workspace that has to work over a
     * few hundred gazetteer rows, which is why the search box is driven here too.
     */
    test('adds a gazetteer area to a zone and the list reads the new coverage back', async ({
        page,
    }) => {
        await openZones(page);

        const base = await firstZoneBase(page);
        const before = (await page.getByTestId(`${base}-area-count`).textContent()) ?? '';

        await page.getByTestId(`${base}-open`).click();
        await expect(page.getByTestId('kitchen-zone-editor-screen')).toBeVisible();
        await expect(page.getByTestId('kitchen-zone-area-picker-search')).toBeVisible();

        // An area this zone does not already cover. The checkbox group is the picker's real
        // control; the chips above it are the summary of what it produced.
        const option = page
            .locator(
                '[data-testid^="kitchen-zone-area-picker-option-"][data-testid$="-control"][aria-checked="false"]',
            )
            .first();
        await expect(option).toBeVisible();
        await option.click();

        // Editing arms the guard, which is the visible half of the unsaved-changes contract.
        await expect(page.getByTestId('kitchen-zone-editor-screen-dirty')).toBeVisible();

        await page.getByTestId('kitchen-zone-areas-save').click();
        await expect(page.getByTestId('kitchen-zone-areas-saved-toast')).toBeVisible();

        await page.getByTestId('kitchen-zone-editor-screen-back').click();
        await expect(page.getByTestId('kitchen-zones-table')).toBeVisible();
        await expect(page.getByTestId(`${base}-area-count`)).not.toHaveText(before);
    });

    /**
     * The `null`-versus-zero distinction, driven through the field that carries it. Nothing is
     * saved: the caption under the field is the whole subject.
     */
    test('says whether an empty delivery fee means free or means undecided', async ({ page }) => {
        await openZones(page);
        const base = await firstZoneBase(page);
        await page.getByTestId(`${base}-open`).click();
        await expect(page.getByTestId('kitchen-zone-editor-screen')).toBeVisible();

        const fee = page.getByTestId('kitchen-zone-fee-input');
        await fee.fill('');
        await expect(page.getByTestId('kitchen-zone-fee-state')).toContainText(
            'not the same as free',
        );

        await fee.fill('0');
        await expect(page.getByTestId('kitchen-zone-fee-state')).toContainText('Free delivery');

        await fee.fill('12.50');
        await expect(page.getByTestId('kitchen-zone-fee-state')).toContainText('charge');

        // A figure with more decimals than the currency has is a typo, not half a fils, and it
        // blocks the save rather than being rounded into the column.
        await fee.fill('12.505');
        await expect(page.getByTestId('kitchen-zone-editor-screen-save')).toBeDisabled();
    });

    /* ── the review queue (K1.8) ─────────────────────────────────────────────────────────────── */

    /**
     * The queue, and the row it leads to.
     *
     * Two of the seeded platform ingredients carry `verification_status: requires_review`, which the
     * mapper turns into `review_required` and the queue reports as a quarantine. What is *not*
     * asserted any more is the reviewer's evidence — the mock seeded a note describing a
     * burghul/pita allergen contradiction, and the platform library ships no notes at all. Asserting
     * a note the seed does not write would be asserting the fixture that no longer exists.
     */
    test('surfaces the queue from the hub and follows a row into its editor', async ({ page }) => {
        await openKitchen(page);

        // The hub leads with the number, and separates "blocked" from "unfinished".
        await expect(page.getByTestId('kitchen-family-review-total')).toContainText('review');
        await expect(page.getByTestId('kitchen-family-review-blocked')).toContainText('blocked');

        await page.getByTestId('kitchen-family-review-open').click();
        await expect(page.getByTestId('kitchen-review-screen')).toBeVisible();
        await expect(page.getByTestId('kitchen-review-sections')).toBeVisible();

        // The ingredient section exists because something is in it; a family with nothing to
        // report gets no heading at all.
        await expect(page.getByTestId('kitchen-review-section-ingredients')).toBeVisible();
        await expect(page.getByTestId('kitchen-review-section-ingredients-count')).toContainText(
            'record',
        );

        const first = page
            .locator('[data-testid^="kitchen-review-ingredients-"][data-testid$="-open"]')
            .first();
        await expect(first).toBeVisible();
        await first.click();
        await expect(page.getByTestId('kitchen-ingredient-editor-screen')).toBeVisible();
    });

    /**
     * The queue states its own scope, which is the difference between a review screen and a claim.
     *
     * `KitchenAdminRepository` publishes no readiness verdict, so what "needs review" means here is
     * derived from what the contract does say — and three parts of the workspace genuinely cannot be
     * checked at all. Printing both lists is what makes a green queue trustworthy.
     */
    test('says what it checked and what it could not, rather than implying it checked everything', async ({
        page,
    }) => {
        await openReview(page);

        await expect(page.getByTestId('kitchen-review-scope')).toContainText(
            'allergen quarantines',
        );
        await expect(page.getByTestId('kitchen-review-not-checked')).toContainText(
            'delivery zones and opening hours',
        );
        // Nothing is written from this screen: the fix happens where the lock version lives.
        await expect(page.getByTestId('kitchen-review-publish')).toHaveCount(0);
        await expect(page.getByTestId('kitchen-review-resolve')).toHaveCount(0);
    });

    /**
     * A branch's trading week, end to end.
     *
     * Two claims are asserted where they are visible. Closing a day **removes** its three fields
     * rather than greying them, because a disabled field still holding `08:00` would show a time
     * that is not being saved. And the cut-off rule is enforced per row, before the save, with the
     * offending day named.
     *
     * The read-back is a genuine round trip now: leaving and returning re-fetches from the API, so
     * the assertion at the end is PostgreSQL agreeing rather than an in-page store remembering.
     */
    test('closes a day, copies the rest, and refuses a cut-off after closing time', async ({
        page,
    }) => {
        await openKitchen(page);
        await page.getByTestId('kitchen-family-branch-operating-open').click();
        await expect(page.getByTestId('kitchen-branch-hours-screen')).toBeVisible();

        // Seven rows, always. A closed day is a day somebody answered.
        for (const weekday of [1, 2, 3, 4, 5, 6, 7]) {
            await expect(
                page.getByTestId(`kitchen-branch-hours-rows-day-${String(weekday)}`),
            ).toBeVisible();
        }

        const row = await firstOpenDayRow(page);
        await page.getByTestId(`${row}-opens-input`).fill('09:15');
        await page.getByTestId(`${row}-closes-input`).fill('21:45');
        await page.getByTestId(`${row}-cut-off-input`).fill('17:30');

        // A cut-off after closing time is refused on its own row, before anything is sent.
        await page.getByTestId(`${row}-cut-off-input`).fill('23:00');
        await expect(page.getByTestId(`${row}-error`)).toContainText('cut-off');
        await expect(page.getByTestId('kitchen-branch-hours-screen-save')).toBeDisabled();
        await page.getByTestId(`${row}-cut-off-input`).fill('17:30');
        await expect(page.getByTestId(`${row}-error`)).toHaveCount(0);

        // Copy onto the open days, and say so — six rows changing below the fold is invisible
        // otherwise.
        await page.getByTestId(`${row}-copy`).click();
        await expect(page.getByTestId('kitchen-branch-hours-rows-announcer')).toContainText(
            'copied',
        );

        // Closing a day takes its fields away rather than disabling them. Never the row being
        // edited above, so the two assertions cannot collide.
        const target =
            row === 'kitchen-branch-hours-rows-day-3'
                ? 'kitchen-branch-hours-rows-day-4'
                : 'kitchen-branch-hours-rows-day-3';
        await page.getByTestId(`${target}-closed-control`).click();
        await expect(page.getByTestId(`${target}-opens-input`)).toHaveCount(0);
        await expect(page.getByTestId(`${target}-closed-note`)).toBeVisible();

        await page.getByTestId('kitchen-branch-hours-screen-save').click();
        await expect(page.getByTestId('kitchen-branch-hours-saved-toast')).toBeVisible();

        await page.getByTestId('kitchen-branch-hours-screen-back').click();
        await expect(page.getByTestId('kitchen-home-screen')).toBeVisible();
        await page.getByTestId('kitchen-family-branch-operating-open').click();
        await expect(page.getByTestId('kitchen-branch-hours-screen')).toBeVisible();
        await expect(page.getByTestId(`${target}-closed-note`)).toBeVisible();
        await expect(page.getByTestId(`${row}-cut-off-input`)).toHaveValue('17:30');

        // Put the closed day back: every read-only project reads this branch's week, and a Tuesday
        // that is shut because a test shut it is a world nobody seeded.
        await page.getByTestId(`${target}-closed-control`).click();
        await expect(page.getByTestId(`${target}-opens-input`)).toBeVisible();
        await page.getByTestId(`${target}-opens-input`).fill('08:00');
        await page.getByTestId(`${target}-closes-input`).fill('20:00');
        await page.getByTestId(`${target}-cut-off-input`).fill('18:00');
        await page.getByTestId('kitchen-branch-hours-screen-save').click();
        await expect(page.getByTestId('kitchen-branch-hours-saved-toast')).toBeVisible();
    });
});
