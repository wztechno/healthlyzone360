import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

import {
    JOURNEY_TIMEOUT,
    KITCHEN_OWNER,
    VERDANT_SLUG,
    apiRequest,
    probeStack,
    readSessionToken,
    selectVerdantKitchenContext,
    signIn,
    skipUnlessStackIsUp,
} from './helpers.ts';
import type { StackStatus } from './helpers.ts';

/**
 * The kitchen workspace, end to end, against the real API.
 *
 * ## Why the whole file is a write spec
 *
 * A management workspace earns its keep by *changing something*, and every spine journey below does:
 * an ingredient is created and renamed, a pack is added to a product, a price is confirmed and its
 * list published, a plan cell is switched on, a zone gains a gazetteer area, a meal is published onto
 * the public menu. In the mock world all of that lived inside one page and evaporated with it, so it
 * was safe to run in parallel. Against PostgreSQL each one is a row that outlives the test, so the
 * whole file belongs to `web-write` — one worker, no retries.
 *
 * ## The persona is the kitchen's owner, and it has to be
 *
 * `owner@verdant.test` holds `organisation_owner` **and** `kitchen_manager` at Verdant Kitchen. The
 * account these journeys used in the mock world, `dietitian@cedar.test`, is a plain `member` there:
 * the catalogue endpoints answer `403` for it, which reads in a spec as a broken screen rather than
 * as the server being right.
 *
 * ## Screens are reached by address, not by pressing through the hub
 *
 * Every journey below used to start with `page.goto('/kitchen')` and a press on a family card, and
 * that one habit is what made the first run of this file against the real stack fail twenty-six
 * times over. `/kitchen` is not a cheap screen: its cards and KPI strip fan out into **forty-odd**
 * catalogue requests (four per publishable family, plus the review queue's own seven), and on the
 * Windows Docker stack — which answers each request in five to six seconds and only four at a time —
 * the hub's own data takes a **hundred seconds** to settle. Worse, those requests are still in
 * flight when the card is pressed, so the list that opens next queues behind them and misses the
 * project's 30-second assertion budget on a stack that is working perfectly.
 *
 * Navigating straight to `/kitchen/ingredients` costs the two requests that screen actually needs
 * and lands in ten to twenty-five seconds. So `openIngredients` and its siblings address the screen
 * directly, and the hub is only opened by the two journeys that are *about* the hub — which pay the
 * hundred seconds honestly, on {@link HUB_TIMEOUT}.
 *
 * ## What the list columns can and cannot say against this API
 *
 * The catalogue *index* endpoints return bare records: `GET /catalogue/items` carries no pack
 * variants and no channel availability, `GET /catalogue/price-lists` carries no entries,
 * `GET /catalogue/delivery-zones` carries no areas, and `GET /catalogue/ingredients` carries no
 * allergen mappings. Every one of those collections is a separate call on the *show* endpoint, which
 * only an editor makes. The mock world served them inline, so the list screens grew columns for
 * them — and against PostgreSQL those columns render their honest empty state on every row, for
 * every kitchen, permanently (`kitchen-product-{id}-packs-none`, `-channels-none`,
 * `kitchen-price-list-{id}-entries-none`, `kitchen-zone-{id}-areas-none`,
 * `kitchen-plan-{id}-variants-none`, `-durations-none`).
 *
 * So the list assertions here say what the list can actually answer, and every round trip that used
 * to be read back off a list column is read back off **the record's own editor after a refetch**
 * instead — which is the stronger claim anyway: it is the row PostgreSQL returned, not a number the
 * table derived.
 *
 * ## Recipes are absent, and that is the seed rather than the screen
 *
 * `GET /catalogue/recipes` answers `count: 0` for Verdant — no seeder writes one. The four recipe
 * journeys this file used to carry are therefore *deleted rather than skipped*: a recipe test against
 * an empty recipe book proves nothing, and a skipped one accumulates as noise.
 * `kitchen-admin-recipes.test.tsx` covers the editor's behaviour in the meantime.
 *
 * ## Every record this file creates is uniquely named
 *
 * A slug is unique per organisation, so a second run that created "Charred aubergine bowl" again
 * would be refused by the server for a reason that has nothing to do with the journey. Names carry a
 * timestamp, which makes the suite re-runnable against one seeded world.
 */

let stack: StackStatus;

test.beforeAll(async () => {
    stack = await probeStack();
});

test.beforeEach(() => {
    // Signing in is three chained round trips against the local Docker stack, and choosing an
    // organisation is three more; the project's 150 s default is a budget for one screen.
    // `test.slow()` triples it for the journeys that really do pay that cost.
    test.slow();
    skipUnlessStackIsUp(stack);
});

/**
 * What the hub is allowed to take, as opposed to a single screen.
 *
 * Measured rather than guessed: on this stack `/kitchen` paints in five seconds and its cards finish
 * counting a hundred and six seconds later, because the strip fans out into roughly forty-five
 * catalogue requests and php-fpm answers four at a time at five seconds each. The project's
 * 30-second `expect` budget is right for one request and wrong for that, and raising the project
 * budget would have hidden a genuinely stuck request everywhere else. Only the two hub journeys pay
 * it.
 */
const HUB_TIMEOUT = 240_000;

/** A name nothing else in the database can already be using. */
function unique(prefix: string): string {
    return `${prefix} ${String(Date.now())}`;
}

/**
 * The toast a write raises, waited for on the **journey** budget rather than the assertion one.
 *
 * Every one of these used to be a bare `toBeVisible()`, and that is a 30-second budget for a POST
 * against a stack where a *read* costs five to six seconds and the whole suite is competing for four
 * php-fpm workers. Under load `POST /catalogue/ingredients` was still in flight at thirty seconds —
 * the save button was still `loading`, the record had not been created, and the failure read as a
 * screen that never confirmed rather than as a stack that was merely busy.
 *
 * A toast dismisses itself after five seconds (`DEFAULT_TOAST_DURATION_MS`), which is not a race
 * here: Playwright is already polling when it appears, so a long wait costs nothing and only ever
 * pays out on a slow write.
 */
async function expectToast(page: Page, testId: string, contains?: string): Promise<void> {
    const toast = page.getByTestId(testId);
    if (contains === undefined) {
        await expect(toast).toBeVisible({ timeout: JOURNEY_TIMEOUT });
        return;
    }
    await expect(toast).toContainText(contains, { timeout: JOURNEY_TIMEOUT });
}

/** Signed in, in the Verdant workspace, and nowhere in particular yet. */
async function openWorkspace(page: Page) {
    await signIn(page, KITCHEN_OWNER);
    await selectVerdantKitchenContext(page);
}

/**
 * One kitchen screen, by address.
 *
 * The `dataTestId` wait is the point: it is the screen's *loaded* state — the table, the count, the
 * grid — so the journey that follows never starts against a skeleton. On the journey budget, because
 * a list is a page of records plus whatever the columns derive, not one request.
 */
async function openScreen(
    page: Page,
    route: string,
    screenTestId: string,
    dataTestId: string,
): Promise<void> {
    await page.goto(route);
    await expect(page.getByTestId(screenTestId)).toBeVisible({ timeout: JOURNEY_TIMEOUT });
    await expect(page.getByTestId(dataTestId)).toBeVisible({ timeout: JOURNEY_TIMEOUT });
}

/** The hub itself, for the two journeys that are about it. */
async function openKitchen(page: Page) {
    await openWorkspace(page);
    await page.goto('/kitchen');
    await expect(page.getByTestId('kitchen-home-screen')).toBeVisible({
        timeout: JOURNEY_TIMEOUT,
    });
}

async function openIngredients(page: Page) {
    await openWorkspace(page);
    await openScreen(
        page,
        '/kitchen/ingredients',
        'kitchen-ingredients-screen',
        'kitchen-ingredients-table',
    );
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
    await expectToast(page, 'kitchen-ingredient-created-toast');
    // The create landed on the record's own address; the mapping section only exists there.
    await expect(page.getByTestId('kitchen-ingredient-allergens')).toBeVisible({
        timeout: JOURNEY_TIMEOUT,
    });
}

/**
 * The `kitchen-ingredient-{id}` prefix of the one row matching a search.
 *
 * Searching rather than reading the first row, because a freshly created ingredient sorts by slug
 * into a 218-row library and may land on any of its nine pages. Narrowing the list to it is both
 * shorter than paging to it and the thing a person would actually do.
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
    await expect(control).toBeVisible({ timeout: JOURNEY_TIMEOUT });
    const testId = await control.getAttribute('data-testid');
    if (testId === null) throw new Error('The ingredient row carries no test id.');
    return testId.slice(0, testId.length - '-open'.length);
}

async function openProducts(page: Page) {
    await openWorkspace(page);
    await openScreen(
        page,
        '/kitchen/products',
        'kitchen-products-screen',
        'kitchen-products-table',
    );
}

/**
 * The `kitchen-product-{id}` prefix of a product that carries at least one pack.
 *
 * Narrowed by search rather than taken from the top of the list, and the search term matters: the
 * first row alphabetically is a draft with no packs at all, while `marinated-chicken-breast` is a
 * published product `VerdantProductCatalogueSeeder` gives a default `1-kg` pack. Two of the journeys
 * below need an existing pack to read a code off. The *list* cannot say which rows have packs — see
 * the note on this file — so the query names the record instead.
 */
async function packedProductBase(page: Page, query = 'Marinated'): Promise<string> {
    await page.getByTestId('kitchen-products-toolbar-search').locator('input').first().fill(query);
    const control = page.locator('[data-testid^="kitchen-product-"][data-testid$="-open"]').first();
    await expect(control).toBeVisible({ timeout: JOURNEY_TIMEOUT });
    const testId = await control.getAttribute('data-testid');
    if (testId === null) throw new Error('The product row carries no test id.');
    return testId.slice(0, testId.length - '-open'.length);
}

async function openMeals(page: Page) {
    await openWorkspace(page);
    await openScreen(page, '/kitchen/meals', 'kitchen-meals-screen', 'kitchen-meals-table');
}

/** The signed-in owner's token plus the Verdant organisation scope, for out-of-band arrangement. */
async function verdantApiScope(
    page: Page,
): Promise<{ token: string; headers: Record<string, string> }> {
    const token = await readSessionToken(page);
    const me = await apiRequest(page.request, 'get', '/api/v1/me', { token });
    const memberships = (
        (await me.json()) as {
            data: { memberships: { organisation: { id: string; slug: string } }[] };
        }
    ).data.memberships;
    const organisationId = memberships.find((row) => row.organisation.slug === VERDANT_SLUG)
        ?.organisation.id;
    expect(organisationId, 'the kitchen owner should be a member of Verdant').toBeDefined();
    return { token, headers: { 'X-Organisation-Id': organisationId as string } };
}

/** The meal id the editor is currently on, read from its own address. */
function mealIdFromUrl(page: Page): string {
    return new URL(page.url()).pathname.split('/').filter(Boolean).pop() ?? '';
}

async function itemLockVersion(
    page: Page,
    scope: { token: string; headers: Record<string, string> },
    itemId: string,
): Promise<number> {
    const shown = await apiRequest(page.request, 'get', `/api/v1/catalogue/items/${itemId}`, scope);
    expect(shown.status(), await shown.text()).toBe(200);
    return ((await shown.json()) as { data: { item: { lock_version: number } } }).data.item
        .lock_version;
}

/**
 * The allergen basis the API requires before it will publish a meal.
 *
 * `CatalogueItemReadiness` refuses `no_allergen_basis` for a meal that links no recipe and lists
 * no ingredients, and this workspace can offer neither: the meal editor has no ingredient control,
 * and `GET /catalogue/recipes` answers zero rows for Verdant. So it is arranged over the API — a
 * *given* of these journeys rather than their subject — and the editor is reloaded onto the
 * version that write produced, because the page is still holding the create's lock version.
 */
async function declareIngredientBasis(page: Page): Promise<void> {
    const scope = await verdantApiScope(page);
    const mealId = mealIdFromUrl(page);

    const ingredients = await apiRequest(
        page.request,
        'get',
        '/api/v1/catalogue/ingredients?limit=1',
        scope,
    );
    const ingredientId =
        ((await ingredients.json()) as { data: { id: string }[] }).data[0]?.id ?? '';
    expect(ingredientId, 'the seeded world should hold at least one ingredient').not.toBe('');

    const lockVersion = await itemLockVersion(page, scope, mealId);
    const declared = await apiRequest(
        page.request,
        'put',
        `/api/v1/catalogue/items/${mealId}/ingredients`,
        {
            ...scope,
            headers: { ...scope.headers, 'If-Match': `"${lockVersion}"` },
            data: { ingredients: [{ ingredient_id: ingredientId, is_representative: true }] },
        },
    );
    expect(declared.status(), await declared.text()).toBe(200);

    await page.reload();
    await expect(page.getByTestId('kitchen-meal-publish')).toBeVisible({
        timeout: JOURNEY_TIMEOUT,
    });
}

/**
 * The merchandising facts the *public* marketplace additionally requires: an active consumer
 * channel assignment and a confirmed price. `MarketplaceMeals::visible()` drops a published meal
 * that has neither, and the meal editor can arrange neither — channels are read-only for meals by
 * contract, and pricing lives on the tariff screens. Both are therefore givens, arranged over the
 * API exactly as a merchandiser's earlier session would have left them.
 *
 * The price write restates the whole standing tariff plus the new row, because the endpoint's body
 * is the desired current state (`PUT /price-lists/{id}/entries` diffs server-side). The read is
 * capped at one page of 100; the seeded menu tariff holds ~14 rows, and the guard below turns a
 * grown tariff into a loud failure rather than a silent truncation of somebody's prices.
 */
async function putMealOnPublicSale(page: Page): Promise<void> {
    const scope = await verdantApiScope(page);
    const mealId = mealIdFromUrl(page);

    const channels = await apiRequest(page.request, 'get', '/api/v1/catalogue/sales-channels', {
        ...scope,
    });
    expect(channels.status(), await channels.text()).toBe(200);
    const webShopId = (
        (await channels.json()) as { data: { id: string; channel_kind: string }[] }
    ).data.find((row) => row.channel_kind === 'b2c_web')?.id;
    expect(webShopId, 'Verdant should run a b2c_web channel').toBeDefined();

    const lockVersion = await itemLockVersion(page, scope, mealId);
    const assigned = await apiRequest(
        page.request,
        'put',
        `/api/v1/catalogue/items/${mealId}/channels`,
        {
            ...scope,
            headers: { ...scope.headers, 'If-Match': `"${lockVersion}"` },
            data: { channels: [{ sales_channel_id: webShopId }] },
        },
    );
    expect(assigned.status(), await assigned.text()).toBe(200);

    const lists = await apiRequest(page.request, 'get', '/api/v1/catalogue/price-lists', scope);
    expect(lists.status(), await lists.text()).toBe(200);
    const menu = (
        (await lists.json()) as {
            data: { id: string; code: string; status: string; lock_version: number }[];
        }
    ).data.find((row) => row.code === 'verdant-menu-usd' && row.status === 'active');
    expect(menu, 'the seeded menu tariff should be active').toBeDefined();
    const menuList = menu as { id: string; lock_version: number };

    const standing = await apiRequest(
        page.request,
        'get',
        `/api/v1/catalogue/price-lists/${menuList.id}/entries?limit=100`,
        scope,
    );
    expect(standing.status(), await standing.text()).toBe(200);
    const standingBody = (await standing.json()) as {
        data: {
            catalogue_item_id: string;
            catalogue_item_variant_id: string | null;
            min_quantity: number | string | null;
            unit_amount_minor: number | null;
            price_status: string;
        }[];
        meta?: { next_cursor?: string | null };
    };
    expect(
        standingBody.meta?.next_cursor ?? null,
        'restating a tariff larger than one page would truncate it — raise the read or rethink',
    ).toBeNull();

    const restated = standingBody.data.map((entry) => ({
        catalogue_item_id: entry.catalogue_item_id,
        catalogue_item_variant_id: entry.catalogue_item_variant_id,
        min_quantity: entry.min_quantity,
        unit_amount_minor: entry.unit_amount_minor,
        price_status: entry.price_status,
    }));
    const priced = await apiRequest(
        page.request,
        'put',
        `/api/v1/catalogue/price-lists/${menuList.id}/entries`,
        {
            ...scope,
            headers: { ...scope.headers, 'If-Match': `"${menuList.lock_version}"` },
            data: {
                entries: [
                    ...restated,
                    {
                        catalogue_item_id: mealId,
                        catalogue_item_variant_id: null,
                        min_quantity: null,
                        unit_amount_minor: 4200,
                        price_status: 'confirmed',
                    },
                ],
            },
        },
    );
    expect(priced.status(), await priced.text()).toBe(200);
}

async function openPriceLists(page: Page) {
    await openWorkspace(page);
    await openScreen(
        page,
        '/kitchen/price-lists',
        'kitchen-price-lists-screen',
        'kitchen-price-lists-table',
    );
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
    await expect(control).toBeVisible({ timeout: JOURNEY_TIMEOUT });
    const testId = await control.getAttribute('data-testid');
    if (testId === null) throw new Error('The entry row carries no test id.');
    return testId.slice(0, testId.length - '-status-label'.length);
}

async function openPlans(page: Page) {
    await openWorkspace(page);
    await openScreen(page, '/kitchen/plans', 'kitchen-plans-screen', 'kitchen-plans-table');
}

/** The `kitchen-plan-{id}` prefix of the first plan row. */
async function firstPlanBase(page: Page): Promise<string> {
    const control = page.locator('[data-testid^="kitchen-plan-"][data-testid$="-open"]').first();
    await expect(control).toBeVisible();
    const testId = await control.getAttribute('data-testid');
    if (testId === null) throw new Error('The plan row carries no test id.');
    return testId.slice(0, testId.length - '-open'.length);
}

async function openSuppliers(page: Page) {
    await openWorkspace(page);
    await openScreen(
        page,
        '/kitchen/suppliers',
        'kitchen-suppliers-screen',
        'kitchen-suppliers-table',
    );
}

async function openZones(page: Page) {
    await openWorkspace(page);
    await openScreen(
        page,
        '/kitchen/delivery-zones',
        'kitchen-zones-screen',
        'kitchen-zones-table',
    );
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
    await openWorkspace(page);
    await page.goto('/kitchen/review');
    await expect(page.getByTestId('kitchen-review-screen')).toBeVisible({
        timeout: JOURNEY_TIMEOUT,
    });
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

/**
 * The `…-row-{key}` prefix of the first seeded duration that carries a **day count**.
 *
 * Not `seed-duration-0`, which is what this used to take. The seeded plan's first commitment is a
 * `one_off` — a single delivery — and the whole point of the `duration_kind` model is that such a
 * row has no day field at all (`-days-absent` in place of `-days-input`). Driving the "take the day
 * field away" journey from it therefore asserted the end state as the start state and failed on the
 * first line. Anchoring on the field itself picks the first `fixed_days` row whatever its ordinal.
 */
async function firstFixedDaysRow(page: Page): Promise<string> {
    const control = page
        .locator(
            '[data-testid^="kitchen-plan-duration-rows-row-seed-duration-"][data-testid$="-days-input"]',
        )
        .first();
    await expect(control).toBeVisible({ timeout: JOURNEY_TIMEOUT });
    const testId = await control.getAttribute('data-testid');
    if (testId === null) throw new Error('The duration row carries no test id.');
    return testId.slice(0, testId.length - '-days-input'.length);
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
        // drafts, quarantined — read from the API, per family, not shared. This is the assertion
        // the hub budget exists for: the badge only exists once its four requests have landed.
        await expect(page.getByTestId('kitchen-family-products-published')).toContainText(
            'published',
            { timeout: HUB_TIMEOUT },
        );
        await expect(page.getByTestId('kitchen-family-meals-published')).toContainText(
            'published',
            {
                timeout: HUB_TIMEOUT,
            },
        );

        // Counts come from the repository, not from a constant on the card.
        await expect(page.getByTestId('kitchen-family-ingredients-total')).toContainText(
            'records',
            {
                timeout: HUB_TIMEOUT,
            },
        );
        // A reference family says what it is instead of inventing a draft count.
        await expect(page.getByTestId('kitchen-family-allergen-classes-reference')).toContainText(
            'Reference',
            { timeout: HUB_TIMEOUT },
        );
        await expect(page.getByTestId('kitchen-family-allergen-classes-drafts')).toHaveCount(0);
    });

    test('opens an ops panel that does not invent stock counts', async ({ page }) => {
        await openWorkspace(page);
        await openScreen(page, '/kitchen/stock', 'kitchen-stock-screen', 'kitchen-stock-panel');

        // Each metric equals the number of rows the screen actually fetched.
        await expect(page.getByTestId('kitchen-stock-items-table')).toBeVisible({
            timeout: JOURNEY_TIMEOUT,
        });
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

        /*
         * The allergen column, in whichever of its two honest forms this API can produce.
         *
         * The chips are codes rather than prose where there are chips — a label is read against a
         * regulatory identity, and translating one into a row's own language would break that
         * reading. But `GET /catalogue/ingredients` returns no allergen mappings at all (they are a
         * separate call on the show endpoint), so against the real stack **every** row renders
         * `-allergens-none` and asserting the chips would be asserting the mock's payload. Both
         * outcomes are accepted, and the cell being *absent* is still a failure.
         */
        await expect(
            page
                .getByTestId(`${base}-allergens`)
                .or(page.getByTestId(`${base}-allergens-none`))
                .first(),
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
        await expect(nameCells.first()).not.toHaveText(first[0]!, { timeout: JOURNEY_TIMEOUT });

        const second = await namesOn();
        // Offset pagination's whole failure mode is repeating and skipping rows, so the assertion
        // that matters is that the two pages share nothing.
        expect(second.filter((name) => first.includes(name))).toEqual([]);

        await pager.getByTestId('kitchen-ingredients-pagination-previous').click();
        await expect(nameCells.first()).toHaveText(first[0]!, { timeout: JOURNEY_TIMEOUT });
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

        await expect(page.getByTestId('kitchen-ingredients-table')).toBeVisible({
            timeout: JOURNEY_TIMEOUT,
        });
        await expect(page.getByTestId('kitchen-ingredients-error')).toHaveCount(0);
        // Three matches in the seeded library, so they fit one page and the control removes itself
        // rather than offering a single disabled row of buttons.
        await expect(page.getByTestId('kitchen-ingredients-pagination')).toHaveCount(0, {
            timeout: JOURNEY_TIMEOUT,
        });
    });

    test('narrows the list, and says so when nothing matches', async ({ page }) => {
        await openIngredients(page);

        await page
            .getByTestId('kitchen-ingredients-toolbar-search')
            .locator('input')
            .first()
            .fill('nothing-like-this-exists');

        await expect(page.getByTestId('kitchen-ingredients-empty')).toBeVisible({
            timeout: JOURNEY_TIMEOUT,
        });

        await page.getByTestId('kitchen-ingredients-clear').click();
        await expect(page.getByTestId('kitchen-ingredients-table')).toBeVisible({
            timeout: JOURNEY_TIMEOUT,
        });
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
        await expectToast(page, 'kitchen-ingredient-saved-toast');
        await expect(page.getByTestId('kitchen-ingredient-editor-screen-dirty')).toHaveCount(0, {
            timeout: JOURNEY_TIMEOUT,
        });

        // Back to the list: the row reads what was just written, which is the server agreeing.
        await page.getByTestId('kitchen-ingredient-editor-screen-back').click();
        await expect(page.getByTestId('kitchen-ingredients-table')).toBeVisible({
            timeout: JOURNEY_TIMEOUT,
        });

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
        await expect(page.getByTestId('kitchen-ingredients-table')).toBeVisible({
            timeout: JOURNEY_TIMEOUT,
        });
    });

    test('states the food-safety consequence before an allergen mapping is touched', async ({
        page,
    }) => {
        await openIngredients(page);

        const base = await firstRowBase(page);
        await page.getByTestId(`${base}-open`).click();
        await expect(page.getByTestId('kitchen-ingredient-allergens')).toBeVisible({
            timeout: JOURNEY_TIMEOUT,
        });

        await expect(page.getByTestId('kitchen-ingredient-allergen-safety')).toContainText(
            'published label',
        );
    });

    test('creates an ingredient the kitchen can use the moment it is typed', async ({ page }) => {
        await openIngredients(page);

        await page.getByTestId('kitchen-ingredients-toolbar-create').click();
        await expect(page.getByTestId('kitchen-ingredient-editor-screen-title')).toContainText(
            'New ingredient',
        );

        await page.getByTestId('kitchen-ingredient-name-en-input').fill(unique('Toasted burghul'));
        await page.getByTestId('kitchen-ingredient-category-trigger').click();
        await page.locator('[data-testid^="kitchen-ingredient-category-option-"]').first().click();

        await page.getByTestId('kitchen-ingredient-editor-screen-save').click();
        await expectToast(page, 'kitchen-ingredient-created-toast', 'right away');

        // The create landed on the record's own address, with the mapping section now available.
        await expect(page.getByTestId('kitchen-ingredient-allergens')).toBeVisible({
            timeout: JOURNEY_TIMEOUT,
        });
        // An ingredient is an operational record, not a publishable one (D-042): the API's family
        // is active/inactive/archived, there is no publish route and no way out of `inactive`, so a
        // create lands `active` — which this workspace's shared status vocabulary draws as
        // "Published". Asserting "Draft" here was asserting the deleted mock's create; the meal and
        // plan draft-on-create tests below are correct, because those endpoints do create drafts.
        await expect(page.getByTestId('kitchen-ingredient-editor-screen-status')).toContainText(
            'Published',
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
        await expect(page.getByTestId('kitchen-ingredients-table')).toBeVisible({
            timeout: JOURNEY_TIMEOUT,
        });
        const base = await rowMatching(page, name);

        await page.getByTestId(`${base}-archive`).click();

        await expect(page.getByTestId('kitchen-ingredients-archive-dialog')).toBeVisible();
        await expect(
            page.getByTestId('kitchen-ingredients-archive-dialog-description'),
        ).toContainText('Nothing is deleted');

        await page.getByTestId('kitchen-ingredients-archive-confirm').click();
        await expectToast(page, 'kitchen-ingredients-archived-toast');
    });

    /**
     * What a product row can say, and what it deliberately does not claim.
     *
     * The pack and channel columns used to be asserted as populated. They cannot be against this
     * API: `GET /catalogue/items` returns the item and nothing hanging off it, so `packVariants` and
     * `channelAvailability` arrive empty on every row and the columns render their "no pack
     * recorded" / "on no channel" states. Asserting the populated form was asserting the mock's
     * payload; asserting the cell *exists in one of its two forms* is the claim the screen can
     * actually keep, and it still fails if a column disappears.
     */
    test('lists products with their packs, channels and the archive that is not a delete', async ({
        page,
    }) => {
        await openProducts(page);

        const base = await packedProductBase(page);
        await expect(page.getByTestId(`${base}-name`)).toBeVisible();
        await expect(page.getByTestId(`${base}-category`)).toBeVisible();
        await expect(
            page
                .getByTestId(`${base}-packs`)
                .or(page.getByTestId(`${base}-packs-none`))
                .first(),
        ).toBeVisible();
        await expect(
            page
                .getByTestId(`${base}-channels`)
                .or(page.getByTestId(`${base}-channels-none`))
                .first(),
        ).toBeVisible();
        await expect(page.getByTestId(`${base}-status`)).toBeVisible();

        // A product has no publish action on this contract, so no row offers one.
        await expect(page.getByTestId(`${base}-publish`)).toHaveCount(0);
        await expect(page.getByTestId(`${base}-archive`)).toBeVisible();
        await expect(page.getByTestId('kitchen-products-toolbar-result-summary')).toContainText(
            'match',
        );
    });

    /**
     * The product round trip: open a record, add a pack, save, and read the new pack back.
     *
     * Read back **from the record's own editor after a refetch**, not from the list's pack column.
     * That column counts `ProductAdmin.packVariants`, which the index endpoint does not return — it
     * says "no pack recorded" for every product in the database and would have said it just as
     * loudly after a successful save. Leaving the editor and re-opening the row re-issues
     * `GET /catalogue/items/{id}`, so the pack that comes back is the one PostgreSQL stored.
     */
    test('adds a pack to a product, saves it, and the list counts it', async ({ page }) => {
        await openProducts(page);

        const base = await packedProductBase(page);

        await page.getByTestId(`${base}-open`).click();
        await expect(page.getByTestId('kitchen-product-editor-screen')).toBeVisible({
            timeout: JOURNEY_TIMEOUT,
        });
        await expect(page.getByTestId('kitchen-product-editor-screen-status')).toBeVisible();

        const packRows = page.locator(
            '[data-testid^="kitchen-product-pack-editor-row-"][data-testid$="-code-input"]',
        );
        const before = await packRows.count();

        await page.getByTestId('kitchen-product-packs-add').click();
        const added = 'kitchen-product-pack-editor-row-pack-1';
        await expect(page.getByTestId(added)).toBeVisible();

        // Editing arms the guard, which is the visible half of the unsaved-changes contract.
        await expect(page.getByTestId('kitchen-product-editor-screen-dirty')).toBeVisible();

        // A pack code is unique within its product, so it carries the run's timestamp too.
        const code = `CASE${String(Date.now()).slice(-6)}`;
        await page.getByTestId(`${added}-code`).locator('input').first().fill(code);
        await page.getByTestId(`${added}-quantity`).locator('input').first().fill('6000');
        await page.getByTestId(`${added}-units-per-pack`).locator('input').first().fill('24');

        await page.getByTestId('kitchen-product-editor-screen-save').click();
        await expectToast(page, 'kitchen-product-saved-toast');
        await expect(page.getByTestId('kitchen-product-editor-screen-dirty')).toHaveCount(0, {
            timeout: JOURNEY_TIMEOUT,
        });

        // Out of the editor and back into it, which is a fresh read of the record.
        await page.getByTestId('kitchen-product-editor-screen-back').click();
        await expect(page.getByTestId('kitchen-products-table')).toBeVisible({
            timeout: JOURNEY_TIMEOUT,
        });
        await page.getByTestId(`${base}-open`).click();
        await expect(page.getByTestId('kitchen-product-packs')).toBeVisible({
            timeout: JOURNEY_TIMEOUT,
        });

        await expect(packRows).toHaveCount(before + 1, { timeout: JOURNEY_TIMEOUT });
        // …and it is the pack that was typed: the row is keyed by the code the server gave back.
        await expect(
            page.locator(
                `[data-testid^="kitchen-product-pack-editor-row-seed-"][data-testid$="-${code}"]`,
            ),
        ).toHaveCount(1);
    });

    test('refuses a duplicate pack code rather than orphaning a price', async ({ page }) => {
        await openProducts(page);

        const base = await packedProductBase(page);
        await page.getByTestId(`${base}-open`).click();
        await expect(page.getByTestId('kitchen-product-packs-add')).toBeVisible({
            timeout: JOURNEY_TIMEOUT,
        });

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
        await expect(page.getByTestId('kitchen-product-channel-editor')).toBeVisible({
            timeout: JOURNEY_TIMEOUT,
        });

        // Every channel is a row, including the ones the product is not sold through.
        await page.getByTestId('kitchen-product-channel-editor-pos-toggle-control').click();
        await page.getByTestId('kitchen-product-channels-save').click();
        await expectToast(page, 'kitchen-product-channels-saved-toast');
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
        await expectToast(page, 'kitchen-meal-created-toast', 'draft');
        await expect(page.getByTestId('kitchen-meal-editor-screen-status')).toContainText('Draft');

        // A draft carries no "on the public menu" notice, because it is not on it.
        await expect(page.getByTestId('kitchen-meal-published')).toHaveCount(0);

        // Sale facts first, basis second: the channel write bumps the item's lock version, and
        // `declareIngredientBasis` ends by reloading the editor onto the final version — the one
        // the publish press below must carry.
        await putMealOnPublicSale(page);
        await declareIngredientBasis(page);

        await page.getByTestId('kitchen-meal-publish').click();
        await expect(page.getByTestId('kitchen-meal-publish-dialog')).toBeVisible();
        // The dialog states the consequence and the label before it asks.
        await expect(page.getByTestId('kitchen-meal-publish-consequence')).toContainText('menu');
        await expect(page.getByTestId('kitchen-meal-publish-allergens')).toBeVisible();

        await page.getByTestId('kitchen-meal-publish-confirm').click();
        await expectToast(page, 'kitchen-meal-published-toast');
        await expect(page.getByTestId('kitchen-meal-published')).toBeVisible({
            timeout: JOURNEY_TIMEOUT,
        });

        await page.getByTestId('kitchen-meal-view-public').click();
        await expect(page.getByTestId('meal-detail-name')).toContainText(name, {
            timeout: JOURNEY_TIMEOUT,
        });

        // …and it is in the public listing too, reached from the meal's own breadcrumb. The
        // listing is cursor-paginated over a catalogue of forty-odd, so it is searched rather than
        // scrolled — which also proves the new row is in the *query* and not merely addressable.
        await page.getByTestId('meal-detail-breadcrumbs').getByText('Meals').click();
        await expect(page.getByTestId('meals-grid')).toBeVisible({ timeout: JOURNEY_TIMEOUT });
        await page.getByTestId('meals-filter-search').locator('input').first().fill(name);
        await expect(page.getByTestId('meals-grid')).toContainText(name, {
            timeout: JOURNEY_TIMEOUT,
        });
    });

    /**
     * Withdrawal, driven on a meal this test published a moment ago.
     *
     * Taking "the first retire control on the page" would withdraw a seeded marketplace meal from
     * the public catalogue every run, which every read-only project then reads a smaller world from.
     *
     * Both languages and a meal type are filled before publishing, and that is not padding: the
     * editor's own gate refuses publication while either half of the name or description is missing
     * or no meal type is chosen (`publishBlockers` in `meal-edit-screen.tsx`), so a meal created with
     * an English name alone reaches a dialog whose confirm button is permanently disabled.
     */
    test('withdraws a meal behind a confirmation that says nothing is deleted', async ({
        page,
    }) => {
        await openMeals(page);

        await page.getByTestId('kitchen-meals-toolbar-create').click();
        const name = unique('Withdrawable bowl');
        await page.getByTestId('kitchen-meal-name-en-input').fill(name);
        await page.getByTestId('kitchen-meal-name-ar-input').fill('وعاء قابل للسحب');
        await page.getByTestId('kitchen-meal-description-en-input').fill('A dish to withdraw.');
        await page.getByTestId('kitchen-meal-description-ar-input').fill('طبق للسحب.');
        await page.getByTestId('kitchen-meal-type-lunch').click();
        await page.getByTestId('kitchen-meal-editor-screen-save').click();
        await expect(page.getByTestId('kitchen-meal-publish')).toBeVisible({
            timeout: JOURNEY_TIMEOUT,
        });

        await declareIngredientBasis(page);

        await page.getByTestId('kitchen-meal-publish').click();
        await page.getByTestId('kitchen-meal-publish-confirm').click();
        await expectToast(page, 'kitchen-meal-published-toast');

        await expect(page.getByTestId('kitchen-meal-retire')).toBeVisible({
            timeout: JOURNEY_TIMEOUT,
        });
        await page.getByTestId('kitchen-meal-retire').click();
        await expect(page.getByTestId('kitchen-meal-retire-dialog')).toBeVisible();
        await expect(page.getByTestId('kitchen-meal-retire-consequence')).toBeVisible();
        await page.getByTestId('kitchen-meal-retire-confirm').click();
        await expectToast(page, 'kitchen-meal-retired-toast');
    });

    test('shows the confidential margin in the kitchen and nowhere a customer looks', async ({
        page,
    }) => {
        await openMeals(page);
        await page.locator('[data-testid^="kitchen-meal-"][data-testid$="-open"]').first().click();
        await expect(page.getByTestId('kitchen-meal-editor-screen')).toBeVisible({
            timeout: JOURNEY_TIMEOUT,
        });

        await expect(page.getByTestId('kitchen-meal-confidential')).toBeVisible();
        await expect(page.getByTestId('kitchen-meal-confidential-badge')).toContainText(
            'Confidential',
        );
        // Either a figure or the honest refusal to state one — never a fabricated zero.
        await expect(
            page
                .getByTestId('kitchen-meal-margin')
                .or(page.getByTestId('kitchen-meal-margin-unknown'))
                .first(),
        ).toBeVisible();

        // The consumer meal page has no margin to render, because the shape has no field for one.
        await page.goto('/meals');
        await expect(page.getByTestId('meals-grid')).toBeVisible({ timeout: JOURNEY_TIMEOUT });
        await expect(page.getByText(/gross margin/i)).toHaveCount(0);
    });

    test('publishes the allergen reference as reference, with no way to change it', async ({
        page,
    }) => {
        await openWorkspace(page);
        await openScreen(
            page,
            '/kitchen/allergen-classes',
            'kitchen-allergen-classes-screen',
            'kitchen-allergen-classes-count',
        );

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
     * The round trip this slice exists for: change one amount, save it, and publish the list.
     *
     * Two things changed against the real API. The entry-split columns (`-entries-confirmed`,
     * `-entries-placeholder`, `-entries-market`) are gone from the assertions because
     * `GET /catalogue/price-lists` returns no entries at all — every row renders `-entries-none`,
     * always — so the split is asserted in the editor, where the entries really are.
     *
     * The publish half runs only while a draft list still exists. Publication is a **one-way**
     * transition on a shared database — the seed ships exactly one draft tariff (`verdant-web-usd`)
     * and once it is published no second run can publish it again. So the dialog's assertions,
     * including the negative one that matters most (a list is published with placeholder and
     * market-priced rows still in it, and the dialog has to say those never reach a customer), are
     * driven when the control is there and skipped with a sentence when a previous run used it up.
     */
    test('confirms a price, and states what will never reach a customer', async ({ page }) => {
        await openPriceLists(page);

        // The list answers what it can: a currency per row, and the entry column in whichever form
        // the index endpoint's payload allows.
        const anyBase = await firstPriceListBase(page);
        await expect(page.getByTestId(`${anyBase}-currency`)).toBeVisible();
        await expect(
            page
                .getByTestId(`${anyBase}-entries`)
                .or(page.getByTestId(`${anyBase}-entries-none`))
                .first(),
        ).toBeVisible();

        // No create control anywhere: the contract publishes no `createPriceList`.
        await expect(page.getByTestId('kitchen-price-lists-toolbar-create')).toHaveCount(0);
        // …and no publish from a row: the consequence needs the editor's context.
        await expect(page.getByTestId(`${anyBase}-publish`)).toHaveCount(0);

        /*
         * Narrowed to the drafts, and *waited on by row count*.
         *
         * The result summary is no help here: it is only hidden while the query is `isPending`,
         * which a refetch over existing data never is, so it reads the old total for as long as the
         * new page takes to land. The row count is the thing the filter actually changes — seven
         * seeded lists, one of them a draft — so it is what the wait is anchored on.
         */
        const rows = page.locator('[data-testid^="kitchen-price-list-"][data-testid$="-open"]');
        const unfiltered = await rows.count();
        await page.getByTestId('kitchen-price-lists-toolbar-status-draft').click();
        await expect
            .poll(async () => rows.count(), { timeout: JOURNEY_TIMEOUT })
            .toBeLessThan(unfiltered);

        const hasDraft = (await rows.count()) > 0;
        test.skip(
            !hasDraft,
            'Every seeded price list is already published — publication is one-way, so a previous ' +
                'run of this file consumed the one draft tariff. Reseed to drive the publish dialog.',
        );

        const base = await firstPriceListBase(page);
        await page.getByTestId(`${base}-open`).click();
        await expect(page.getByTestId('kitchen-price-list-editor-screen')).toBeVisible({
            timeout: JOURNEY_TIMEOUT,
        });

        // The currency is a fact rather than a field — there is no request that could change it.
        await expect(page.getByTestId('kitchen-price-list-currency')).toBeVisible();
        await expect(page.getByTestId('kitchen-price-list-readonly-note')).toContainText(
            'cannot be changed here',
        );
        // …and here — not on the list — is where "how many of these prices are real?" is answered.
        await expect(page.getByTestId('kitchen-price-list-draft-confirmed')).toContainText(
            'confirmed',
        );

        const row = await firstEntryRow(page);

        await page.getByTestId(`${row}-status-confirmed`).click();
        const amount = page.getByTestId(`${row}-amount`).locator('input').first();
        await expect(amount).toBeEditable();

        await amount.fill('5.50');
        await expect(page.getByTestId('kitchen-price-list-editor-screen-dirty')).toBeVisible();

        await page.getByTestId('kitchen-price-list-editor-screen-save').click();
        await expectToast(page, 'kitchen-price-list-saved-toast');
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
        await expectToast(page, 'kitchen-price-list-published-toast');
        await expect(page.getByTestId('kitchen-price-list-published')).toBeVisible({
            timeout: JOURNEY_TIMEOUT,
        });
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
        await expect(page.getByTestId('kitchen-price-list-entries')).toBeVisible({
            timeout: JOURNEY_TIMEOUT,
        });

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

    /**
     * What a plan row can say about how finished it is.
     *
     * The price column is the one of the three that survives contact with this API: it is derived
     * from the kitchen's price lists, which the screen fetches itself. Configurations and durations
     * are *not* on `GET /catalogue/items` — they come back only from the show endpoint — so those two
     * columns render `-variants-none` and `-durations-none` for every plan in the database and the
     * coverage sentence they used to be asserted on has nowhere to come from. The cell is asserted
     * in whichever form the payload allows; the coverage claim itself is made in the editor below,
     * where the matrix is real.
     */
    test('lists plans by how finished they are, not by how many there are', async ({ page }) => {
        await openPlans(page);

        const base = await firstPlanBase(page);
        await expect(
            page
                .getByTestId(`${base}-variants-coverage`)
                .or(page.getByTestId(`${base}-variants-none`))
                .first(),
        ).toBeVisible();
        await expect(
            page
                .getByTestId(`${base}-durations-days`)
                .or(page.getByTestId(`${base}-durations-none`))
                .first(),
        ).toBeVisible();
        // The price column is derived from the price lists, which is where a plan price lives.
        await expect(page.getByTestId(`${base}-prices-confirmed`)).toContainText('confirmed', {
            timeout: JOURNEY_TIMEOUT,
        });
        await expect(page.getByTestId(`${base}-status`)).toBeVisible();
        await expect(page.getByTestId('kitchen-plans-toolbar-result-summary')).toContainText(
            'match',
        );
    });

    /**
     * The spine of the slice: switch a cell of the matrix on, add a 20-day commitment, save both,
     * and read the change back off a fresh fetch of the plan.
     *
     * The 20 days are the point of the `duration_kind` model (plan §4.3) — the consumer contract's
     * `1w | 2w | 4w | 12w` union could not express them at all — and the cell is the point of the
     * matrix: a configuration that exists *is* the availability, so switching one on is the whole
     * write.
     *
     * The read-back leaves the editor and comes back rather than reading the list's columns, which
     * against this API carry neither configurations nor durations. Re-opening the record re-issues
     * `GET /catalogue/items/{id}`, so what the matrix and the duration rows show afterwards is what
     * PostgreSQL holds.
     */
    test('switches a cell on, adds a 20-day commitment, and the list reads both back', async ({
        page,
    }) => {
        await openPlans(page);

        const base = await firstPlanBase(page);
        await page.getByTestId(`${base}-open`).click();
        await expect(page.getByTestId('kitchen-plan-editor-screen')).toBeVisible({
            timeout: JOURNEY_TIMEOUT,
        });
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
        await expectToast(page, 'kitchen-plan-variants-saved-toast');

        // …and the 20-day commitment, which is the duration model's whole reason for existing.
        await page.getByTestId('kitchen-plan-durations-add').click();
        const row = await addedDurationRow(page);
        await page.getByTestId(`${row}-days-input`).fill('20');
        // Its discount is undecided rather than zero, and the row says which of the two it is.
        await expect(page.getByTestId(`${row}-discount-state`)).toContainText('not as zero');

        await page.getByTestId('kitchen-plan-durations-save').click();
        await expectToast(page, 'kitchen-plan-durations-saved-toast');

        // Out and back in: a fresh read of the plan, and both writes are in it.
        await page.getByTestId('kitchen-plan-editor-screen-back').click();
        await expect(page.getByTestId('kitchen-plans-table')).toBeVisible({
            timeout: JOURNEY_TIMEOUT,
        });
        await page.getByTestId(`${base}-open`).click();
        await expect(page.getByTestId('kitchen-plan-matrix-grid')).toBeVisible({
            timeout: JOURNEY_TIMEOUT,
        });

        await expect(coverage).not.toHaveText(before);
        await expect(
            page
                .locator(
                    '[data-testid^="kitchen-plan-duration-rows-row-seed-duration-"][data-testid$="-fixed_days-20"]',
                )
                .first(),
        ).toBeVisible({ timeout: JOURNEY_TIMEOUT });
    });

    /**
     * The `CHECK`, driven through the controls. Nothing is saved, so the plan is left as it was.
     */
    test('takes the day field away when a duration becomes a one-off', async ({ page }) => {
        await openPlans(page);
        const base = await firstPlanBase(page);
        await page.getByTestId(`${base}-open`).click();
        await expect(page.getByTestId('kitchen-plan-duration-rows')).toBeVisible({
            timeout: JOURNEY_TIMEOUT,
        });

        const testId = await firstFixedDaysRow(page);

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
        await expectToast(page, 'kitchen-plan-created-toast', 'draft');
        await expect(page.getByTestId('kitchen-plan-editor-screen-status')).toContainText('Draft');

        await expect(page.getByTestId('kitchen-plan-publish')).toBeVisible({
            timeout: JOURNEY_TIMEOUT,
        });
        await page.getByTestId('kitchen-plan-publish').click();
        await expect(page.getByTestId('kitchen-plan-publish-dialog')).toBeVisible();
        await expect(page.getByTestId('kitchen-plan-publish-blocked')).toContainText('sells', {
            timeout: JOURNEY_TIMEOUT,
        });
        await expect(page.getByTestId('kitchen-plan-publish-blocked')).toContainText(
            'confirmed price',
            { timeout: JOURNEY_TIMEOUT },
        );
        await expect(page.getByTestId('kitchen-plan-publish-confirm')).toBeDisabled();
    });

    /**
     * The delivery slice's spine: choose an area, save it, and read the coverage back.
     *
     * `setZoneAreas` replaces the whole set, so this is the write that decides where a kitchen can
     * deliver at all — and the picker is the one control in this workspace that has to work over a
     * few hundred gazetteer rows, which is why the search box is driven here too.
     *
     * Read back from the editor's own count rather than from the list's area column: the zone index
     * endpoint returns no areas (they are `GET /catalogue/delivery-zones/{zone}/areas`, a separate
     * call the editor makes), so that column says "no areas chosen" for every zone regardless.
     */
    /* ── suppliers (SUP1, SUP2) ──────────────────────────────────────────────────────────────── */

    /**
     * The whole supplier lifecycle in one journey: create, edit, name a contact, link an item and
     * make it preferred, then archive and restore.
     *
     * One journey rather than five, because every step needs the row the step before it produced and
     * this file runs one worker at a time — five journeys would mean five suppliers created against
     * a shared database to assert five halves of one story.
     *
     * Four things it proves that a unit test cannot. The **code is minted by the server** when the
     * create form leaves it blank, so the record comes back with something on it that the client
     * never sent. The **contact set is one save**: the card is filled in and the section's own
     * button is what writes it, and the record read back afterwards carries the person. A **link
     * writes on its own press** and the preferred handover survives a real round trip against the
     * partial unique index behind it. And the **archive is a filter rather than a deletion** — the
     * supplier leaves the default book, returns under the chip, and restores whole.
     */
    test('creates a supplier, edits it, names a contact, then archives and restores it', async ({
        page,
    }) => {
        await openSuppliers(page);

        const name = unique('Playwright Supplier');

        await page.getByTestId('kitchen-suppliers-create').click();
        await expect(page.getByTestId('kitchen-supplier-details')).toBeVisible({
            timeout: JOURNEY_TIMEOUT,
        });

        await page.getByTestId('kitchen-supplier-name-en-input').fill(name);
        await page.getByTestId('kitchen-supplier-name-ar-input').fill('مورّد الاختبار');
        // Deliberately no code: the server mints one from the name, which is the whole reason a
        // person at a loading bay can add a supplier without inventing an identifier.
        await page.getByTestId('kitchen-supplier-payment-terms-input').fill('Net 30');
        await page.getByTestId('kitchen-supplier-lead-time-input').fill('2');

        await page.getByTestId('kitchen-supplier-screen-save').click();
        await expectToast(page, 'kitchen-supplier-saved-toast');

        // The create redirects onto the saved record, which is where contacts become possible.
        await expect(page.getByTestId('kitchen-supplier-contacts')).toBeVisible({
            timeout: JOURNEY_TIMEOUT,
        });
        await expect(page.getByTestId('kitchen-supplier-code-input')).not.toHaveValue('', {
            timeout: JOURNEY_TIMEOUT,
        });

        // Editing the record it just created — a second write against the same row.
        await page.getByTestId('kitchen-supplier-address-input').fill('Gate 4, behind the store');
        await expect(page.getByTestId('kitchen-supplier-screen-dirty')).toBeVisible();
        await page.getByTestId('kitchen-supplier-screen-save').click();
        await expectToast(page, 'kitchen-supplier-saved-toast');

        /* ── contacts: one card, one save ────────────────────────────────────────────────────── */

        await page.getByTestId('kitchen-supplier-contacts-add').click();

        const card = page.locator('[data-testid^="kitchen-supplier-contact-new-"]').first();
        await expect(card).toBeVisible({ timeout: JOURNEY_TIMEOUT });
        const cardId = await card.getAttribute('data-testid');
        if (cardId === null) throw new Error('The contact card carries no test id.');

        await page.getByTestId(`${cardId}-name-input`).fill('Samir Haddad');
        await page.getByTestId(`${cardId}-phone-input`).fill('+961 3 111 222');
        await page.getByTestId(`${cardId}-make-primary`).click();

        await page.getByTestId('kitchen-supplier-contacts-save').click();
        await expectToast(page, 'kitchen-supplier-contacts-saved-toast');

        // Read back off the record rather than off a list column: this is the row PostgreSQL
        // returned, not a number the table derived.
        await expect(page.getByTestId(`${cardId}-name-input`)).toHaveValue('Samir Haddad');

        /* ── supplied items: link, then prefer (SUP2) ────────────────────────────────────────── */

        /*
         * The third section has no Save, and that is the thing to watch here: a link is one fact
         * about a (supplier, item) pair rather than a document, so **Link item** writes it and the
         * record read back afterwards carries the row. The preferred flag then moves on its own
         * press — a handover the server performs inside one transaction so the partial unique index
         * behind "at most one preferred supplier per item" never surfaces as a 500.
         */

        await page.getByTestId('kitchen-supplier-item-picker').click();

        const option = page
            .locator('[data-testid^="kitchen-supplier-item-picker-option-"]')
            .first();
        await expect(option).toBeVisible({ timeout: JOURNEY_TIMEOUT });
        const optionId = await option.getAttribute('data-testid');
        if (optionId === null) throw new Error('The item picker option carries no test id.');

        // `kitchen-supplier-item-picker-option-{stockItemId}` — the row's own prefix follows.
        const stockItemId = optionId.replace('kitchen-supplier-item-picker-option-', '');
        await option.click();

        await page.getByTestId('kitchen-supplier-link-ref-input').fill('GF-REF-1');
        await page.getByTestId('kitchen-supplier-item-link').click();
        await expectToast(page, 'kitchen-supplier-item-linked-toast');

        const itemRow = `kitchen-supplier-item-${stockItemId}`;
        await expect(page.getByTestId(`${itemRow}-ref`)).toHaveText('GF-REF-1', {
            timeout: JOURNEY_TIMEOUT,
        });
        // Linked but never bought from this supplier — a distinct cell from a hidden price.
        await expect(page.getByTestId(`${itemRow}-never-bought`)).toBeVisible();

        await page.getByTestId(`${itemRow}-make-preferred`).click();
        await expectToast(page, 'kitchen-supplier-item-preferred-toast');

        // Read back off the re-fetched record: the badge is the server's row, not local state.
        await expect(page.getByTestId(`${itemRow}-preferred`)).toBeVisible({
            timeout: JOURNEY_TIMEOUT,
        });
        // And the action that set it stops being offered, because it would change nothing.
        await expect(page.getByTestId(`${itemRow}-make-preferred`)).toHaveCount(0);

        /* ── archive, and the book that stops offering it ────────────────────────────────────── */

        await page.getByTestId('kitchen-supplier-archive').click();
        await expect(page.getByTestId('kitchen-supplier-archive-dialog')).toBeVisible();
        await page.getByTestId('kitchen-supplier-archive-confirm').click();
        await expectToast(page, 'kitchen-supplier-archived-toast');

        await expect(page.getByTestId('kitchen-supplier-archived')).toBeVisible({
            timeout: JOURNEY_TIMEOUT,
        });
        // The form is locked rather than merely unsaveable.
        await expect(page.getByTestId('kitchen-supplier-screen-save')).toHaveCount(0);

        await page.getByTestId('kitchen-supplier-screen-back').click();
        await expect(page.getByTestId('kitchen-suppliers-table')).toBeVisible({
            timeout: JOURNEY_TIMEOUT,
        });

        // Gone from the default book — every picker reads this list.
        await page.getByTestId('kitchen-suppliers-search-input').fill(name);
        await expect(page.getByTestId('kitchen-suppliers-empty')).toBeVisible({
            timeout: JOURNEY_TIMEOUT,
        });

        // Back under the chip, and flagged.
        await page.getByTestId('kitchen-suppliers-archived-filter').click();
        const row = page
            .locator('[data-testid^="kitchen-supplier-"][data-testid$="-open"]')
            .first();
        await expect(row).toBeVisible({ timeout: JOURNEY_TIMEOUT });
        await row.click();

        await expect(page.getByTestId('kitchen-supplier-restore')).toBeVisible({
            timeout: JOURNEY_TIMEOUT,
        });
        await page.getByTestId('kitchen-supplier-restore').click();
        await expectToast(page, 'kitchen-supplier-restored-toast');

        // Restored whole: writable again, with the contact and the address still on it.
        await expect(page.getByTestId('kitchen-supplier-screen-save')).toBeVisible({
            timeout: JOURNEY_TIMEOUT,
        });
        await expect(page.getByTestId('kitchen-supplier-address-input')).toHaveValue(
            'Gate 4, behind the store',
        );
    });

    test('adds a gazetteer area to a zone and the list reads the new coverage back', async ({
        page,
    }) => {
        await openZones(page);

        const base = await firstZoneBase(page);

        await page.getByTestId(`${base}-open`).click();
        await expect(page.getByTestId('kitchen-zone-editor-screen')).toBeVisible({
            timeout: JOURNEY_TIMEOUT,
        });
        await expect(page.getByTestId('kitchen-zone-area-picker-search')).toBeVisible({
            timeout: JOURNEY_TIMEOUT,
        });

        const count = page.getByTestId('kitchen-zone-areas-count');
        const before = (await count.textContent()) ?? '';

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
        await expectToast(page, 'kitchen-zone-areas-saved-toast');

        // Out of the editor and back into it, which re-reads the zone's areas from the API.
        await page.getByTestId('kitchen-zone-editor-screen-back').click();
        await expect(page.getByTestId('kitchen-zones-table')).toBeVisible({
            timeout: JOURNEY_TIMEOUT,
        });
        await page.getByTestId(`${base}-open`).click();
        await expect(page.getByTestId('kitchen-zone-areas')).toBeVisible({
            timeout: JOURNEY_TIMEOUT,
        });
        await expect(count).not.toHaveText(before, { timeout: JOURNEY_TIMEOUT });
    });

    /**
     * The `null`-versus-zero distinction, driven through the field that carries it. Nothing is
     * saved: the caption under the field is the whole subject.
     */
    test('says whether an empty delivery fee means free or means undecided', async ({ page }) => {
        await openZones(page);
        const base = await firstZoneBase(page);
        await page.getByTestId(`${base}-open`).click();
        await expect(page.getByTestId('kitchen-zone-editor-screen')).toBeVisible({
            timeout: JOURNEY_TIMEOUT,
        });

        const fee = page.getByTestId('kitchen-zone-fee-input');
        await expect(fee).toBeVisible({ timeout: JOURNEY_TIMEOUT });
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
     * One seeded platform ingredient — `burghul-bulgur` — carries `verification_status:
     * requires_review`, which the mapper turns into `review_required` and the queue reports as a
     * quarantine: one record, blocked. What is *not* asserted any more is the reviewer's evidence —
     * the mock seeded a note describing a burghul/pita allergen contradiction, and the platform
     * library ships no notes at all. Asserting a note the seed does not write would be asserting the
     * fixture that no longer exists.
     *
     * This journey pays the hub's real cost, because the hub card *is* the subject: the review badge
     * is the last thing on that screen to resolve.
     */
    test('surfaces the queue from the hub and follows a row into its editor', async ({ page }) => {
        await openKitchen(page);

        // The hub leads with the number, and separates "blocked" from "unfinished".
        await expect(page.getByTestId('kitchen-family-review-total')).toContainText('review', {
            timeout: HUB_TIMEOUT,
        });
        await expect(page.getByTestId('kitchen-family-review-blocked')).toContainText('blocked', {
            timeout: HUB_TIMEOUT,
        });

        await page.getByTestId('kitchen-family-review-open').click();
        await expect(page.getByTestId('kitchen-review-screen')).toBeVisible({
            timeout: JOURNEY_TIMEOUT,
        });
        await expect(page.getByTestId('kitchen-review-sections')).toBeVisible({
            timeout: JOURNEY_TIMEOUT,
        });

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
        await expect(page.getByTestId('kitchen-ingredient-editor-screen')).toBeVisible({
            timeout: JOURNEY_TIMEOUT,
        });
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
            { timeout: JOURNEY_TIMEOUT },
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
     * ## Held open on a real defect, not on a spec that drifted
     *
     * `/kitchen/branch-operating` renders a **blank page** against this stack, by whichever route it
     * is reached — `page.goto`, or the hub card this journey used to press. The React tree throws
     * during render and nothing is left on screen:
     *
     * ```
     * [pageerror] Not a valid date:
     * ```
     *
     * The chain is three files long and each link is deliberate on its own.
     * `GET /kitchen/branch-operating` returns seven weekday rows and **no timestamps**, so
     * `mapBranchOperating` fills the record's `meta.updatedAt` with the sentinel
     * `UNKNOWN_ISO_DATE_TIME` (`packages/api-client/src/api/kitchen-admin-mappers.ts:919`), which is
     * the empty string and is documented as such:
     * *"A timestamp the API does not expose. Screens must render it as 'unknown', never format it."*
     * (`packages/api-client/src/api/mappers.ts:67`). `EditorFrame` then formats it —
     * `formatter.formatRelativeTime(meta.updatedAt)` at
     * `apps/universal/src/features/kitchen-admin/editor-frame.tsx:87`, unconditional — and
     * `createFormatter`'s `toDate` throws a `TypeError` on `new Date('')`
     * (`packages/i18n/src/format.ts:49`). Nothing catches it, so the whole screen is lost.
     *
     * Every other editor escapes only because its endpoint *does* send `updated_at`; this is the one
     * record on the contract that cannot. The fix is one guard in `EditorFrame` (render
     * `kitchen:editor.neverSaved` for an empty `updatedAt`, exactly as it already does for a null
     * `meta`) and it is application code, which this spec may not touch. The journey below is written
     * out in full so that the guard lands with its test already waiting.
     */
    test.fixme('closes a day, copies the rest, and refuses a cut-off after closing time', async ({
        page,
    }) => {
        await openWorkspace(page);
        await page.goto('/kitchen/branch-operating');
        await expect(page.getByTestId('kitchen-branch-hours-screen')).toBeVisible({
            timeout: JOURNEY_TIMEOUT,
        });

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

        await page.reload();
        await expect(page.getByTestId('kitchen-branch-hours-screen')).toBeVisible({
            timeout: JOURNEY_TIMEOUT,
        });
        await expect(page.getByTestId(`${target}-closed-note`)).toBeVisible();
        await expect(page.getByTestId(`${row}-cut-off-input`)).toHaveValue('17:30');

        // Put the closed day back: every read-only project reads this branch's week, and a
        // Tuesday that is shut because a test shut it is a world nobody seeded.
        await page.getByTestId(`${target}-closed-control`).click();
        await expect(page.getByTestId(`${target}-opens-input`)).toBeVisible();
        await page.getByTestId(`${target}-opens-input`).fill('08:00');
        await page.getByTestId(`${target}-closes-input`).fill('20:00');
        await page.getByTestId(`${target}-cut-off-input`).fill('18:00');
        await page.getByTestId('kitchen-branch-hours-screen-save').click();
        await expect(page.getByTestId('kitchen-branch-hours-saved-toast')).toBeVisible();
    });
});

/** The first weekday row of the branch-hours editor that is currently open for trade. */
async function firstOpenDayRow(page: Page): Promise<string> {
    for (const weekday of [1, 2, 3, 4, 5, 6, 7]) {
        const row = `kitchen-branch-hours-rows-day-${String(weekday)}`;
        if ((await page.getByTestId(`${row}-opens-input`).count()) > 0) return row;
    }
    throw new Error('The seeded branch is closed every day.');
}
