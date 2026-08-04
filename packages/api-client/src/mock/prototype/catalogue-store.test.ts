import { amountValue } from '@healthy360/nutrition';
import { describe, expect, it } from 'vitest';

import { asApiFailure } from '../../contracts/failure.ts';
import { isPriceEntryConsistent } from '../../contracts/kitchen-admin.ts';
import type { PublishableStatus } from '../../contracts/kitchen-admin.ts';
import { KitchenCatalogueStore } from './catalogue-store.ts';
import {
    PROTOTYPE_ALLERGENS,
    PROTOTYPE_INGREDIENTS,
    PROTOTYPE_KITCHENS,
    PROTOTYPE_MEALS,
    PROTOTYPE_PLANS,
    PROTOTYPE_RECIPES,
    allergenCode,
    ingredientByKey,
    mealByKey,
    planByKey,
    recipeByKey,
} from './fixtures/index.ts';
import { PROTOTYPE_RUNTIME_ORDINAL_START, prototypeId } from './ids.ts';
import { createPrototypeRepositories } from './repositories.ts';
import { untranslated } from './catalogue-model.ts';

/**
 * The mutable catalogue.
 *
 * Two things are being asserted, and the first matters more than the second: **the seed changes
 * nothing a consumer sees**, and the management surface then changes it honestly. A store that
 * quietly altered a meal's price or dropped an ingredient would break forty screens and two hundred
 * assertions elsewhere, so the counts and the identity of the seeded projections are pinned here as
 * well as inferred from the suites that use them.
 */

function store(): KitchenCatalogueStore {
    return new KitchenCatalogueStore();
}

/** The first failure a call rejects with, as an `ApiFailure`. */
function failureOf(run: () => unknown) {
    try {
        run();
        return null;
    } catch (error) {
        return asApiFailure(error);
    }
}

describe('the seeded catalogue', () => {
    it('hands the consumer surfaces exactly what the fixtures did', () => {
        const catalogue = store();

        expect(catalogue.consumerMeals()).toEqual([...PROTOTYPE_MEALS]);
        expect(catalogue.consumerPlans()).toEqual([...PROTOTYPE_PLANS]);
        expect(catalogue.consumerRecipes()).toEqual([...PROTOTYPE_RECIPES]);
        expect(catalogue.consumerIngredients()).toEqual([...PROTOTYPE_INGREDIENTS]);
        expect(catalogue.kitchens()).toEqual([...PROTOTYPE_KITCHENS]);
    });

    /**
     * Everything is published except the one row that exists to be unpublished.
     *
     * K1.8 seeds a single `review_required` ingredient — the synthetic stand-in for the source
     * data's burghul/pita allergen contradiction — so the review queue has something real to show.
     * It is asserted by name here rather than by allowing `review_required` anywhere in the set,
     * because "a second quarantined row appeared" is exactly the regression this test should catch.
     */
    it('publishes every seeded row bar the one quarantine sample', () => {
        const catalogue = store();
        const statuses = new Set<PublishableStatus>();
        for (const row of catalogue.listRecipes()) statuses.add(row.meta.status);
        for (const row of catalogue.listMeals()) statuses.add(row.meta.status);
        for (const row of catalogue.listPlans()) statuses.add(row.meta.status);
        for (const row of catalogue.listZones()) statuses.add(row.meta.status);

        expect([...statuses]).toEqual(['published']);

        const quarantined = catalogue
            .listIngredients()
            .filter((row) => row.meta.status !== 'published');
        expect(quarantined).toHaveLength(1);
        expect(quarantined[0]?.meta.status).toBe('review_required');
        expect(quarantined[0]?.name.en).toContain('synthetic');
        // No mapping at all is the contradiction itself, and the note is what a reviewer reads.
        expect(quarantined[0]?.allergens).toEqual([]);
        expect(quarantined[0]?.notes).toContain('gluten');
    });

    it('keeps the quarantine sample off every consumer surface', () => {
        const catalogue = store();
        const ids = new Set(catalogue.consumerIngredients().map((row) => String(row.id)));
        const quarantined = catalogue
            .listIngredients()
            .filter((row) => row.meta.status === 'review_required');

        for (const row of quarantined) expect(ids.has(String(row.id))).toBe(false);
    });

    it('carries the fourteen allergen classes with their regulatory metadata', () => {
        const classes = store().allergenClasses();
        expect(classes).toHaveLength(PROTOTYPE_ALLERGENS.length);

        const sulphites = classes.find((entry) => entry.code === allergenCode('sulphites'));
        expect(sulphites?.declarationThreshold).toEqual({ value: 10, unit: 'mg/kg' });
        expect(sulphites?.markets).toContain('EU');
        // Sulphites are not one of the nine the United States requires.
        expect(sulphites?.markets).not.toContain('US');

        const milk = classes.find((entry) => entry.code === allergenCode('milk'));
        expect(milk?.markets).toContain('US');
        expect(classes.every((entry) => entry.isActive)).toBe(true);
    });

    it('gives every ingredient a confidential cost in major units', () => {
        const chicken = store().getIngredient(ingredientByKey('chicken_breast').id);
        // The fixture records 340 fils per 100 g; a cost is major units, never minor (plan §4.4).
        expect(chicken.costPer100g).toEqual({ amount: 3.4, currency: 'USD' });
    });

    it('models every seeded price entry consistently with its status', () => {
        for (const list of store().listPriceLists()) {
            for (const entry of list.entries) {
                expect(isPriceEntryConsistent(entry), `${list.name.en}`).toBe(true);
            }
        }
    });

    it('states plan durations in days rather than the consumer week union', () => {
        const plan = store().getPlan(planByKey('balanced_week').id);
        expect(plan.durations.map((duration) => duration.days)).toEqual([7, 14, 28, 84]);
        expect(plan.durations.every((duration) => duration.kind === 'fixed_days')).toBe(true);
    });

    it('keeps two stores independent', () => {
        const first = store();
        const second = store();
        const meal = mealByKey('verdant_herb_garden_bowl');

        first.retireMeal(meal.id, { lockVersion: 1 });

        expect(first.consumerMealById(meal.id)).toBeNull();
        expect(second.consumerMealById(meal.id)).not.toBeNull();
    });
});

describe('optimistic locking', () => {
    it('increments the lock version on every accepted write', () => {
        const catalogue = store();
        const id = ingredientByKey('tahini').id;
        expect(catalogue.getIngredient(id).meta.lockVersion).toBe(1);

        catalogue.updateIngredient(id, { lockVersion: 1, notes: 'Decanted daily.' });
        expect(catalogue.getIngredient(id).meta.lockVersion).toBe(2);
        expect(catalogue.getIngredient(id).meta.updatedByName).not.toBeNull();

        catalogue.updateIngredient(id, { lockVersion: 2, notes: 'Decanted twice daily.' });
        expect(catalogue.getIngredient(id).meta.lockVersion).toBe(3);
    });

    it('rejects a stale version with resource.conflict and the version it holds', () => {
        const catalogue = store();
        const id = ingredientByKey('tahini').id;
        catalogue.updateIngredient(id, { lockVersion: 1, notes: 'First edit.' });

        const failure = failureOf(() =>
            catalogue.updateIngredient(id, { lockVersion: 1, notes: 'Second editor, stale copy.' }),
        );

        expect(failure?.code).toBe('resource.conflict');
        expect((failure as { currentLockVersion?: number } | null)?.currentLockVersion).toBe(2);
        expect(failure?.retryable).toBe(false);
        // The rejected write changed nothing.
        expect(catalogue.getIngredient(id).meta.lockVersion).toBe(2);
    });

    it('answers resource.not_found for a row this world does not have', () => {
        const missing = prototypeId('ingredient', 0xfe) as never;
        expect(failureOf(() => store().getIngredient(missing))?.code).toBe('resource.not_found');
    });
});

describe('the recipe listing filters', () => {
    /**
     * `RecipeAdminFilter.staleOnly` was declared on the contract and ignored by the repository, so
     * "recipes whose figures are out of date" answered with the whole book. The K1.8 review queue is
     * its first caller, and a queue that reported twenty stale recipes in a world with none would be
     * worse than no queue at all.
     */
    it('answers staleOnly from the version flag rather than matching everything', async () => {
        const catalogue = store();
        const { kitchenAdmin } = createPrototypeRepositories();

        const all = await kitchenAdmin.listRecipes({ limit: 100 });
        expect(all.items.length).toBeGreaterThan(0);

        /*
         * Nothing in this world sets `derivationStale`. Every setter recomputes the roll-up in the
         * same call and clears the flag, so a stale version is a state only a *server* that defers
         * derivation to a job can produce (the allergen-recompute job, plan K1.8). The honest
         * answer is therefore "none", and the point of this assertion is that it is no longer
         * "all twenty".
         */
        expect(all.items.every((row) => !catalogue.isRecipeDerivationStale(row.id))).toBe(true);

        const stale = await kitchenAdmin.listRecipes({ limit: 100, staleOnly: true });
        expect(stale.items).toEqual([]);
    });
});

describe('publication and consumer visibility', () => {
    it('hides a draft meal from the marketplace and shows it once published', async () => {
        const { marketplace, kitchenAdmin } = createPrototypeRepositories();

        const created = await kitchenAdmin.createMeal({
            name: untranslated('Roast pepper bowl'),
            description: untranslated('A new bowl, not yet on sale.'),
        });
        expect(created.meta.status).toBe('draft');

        const before = await marketplace.listMeals({ limit: 100 });
        expect(before.items.some((meal) => meal.id === created.id)).toBe(false);

        await kitchenAdmin.publishMeal(created.id, { lockVersion: created.meta.lockVersion });

        const after = await marketplace.listMeals({ limit: 100 });
        expect(after.items.some((meal) => meal.id === created.id)).toBe(true);
    });

    it('removes a retired meal from the marketplace listing and detail', async () => {
        const { marketplace, kitchenAdmin } = createPrototypeRepositories();
        const meal = mealByKey('verdant_herb_garden_bowl');

        const before = await marketplace.listMeals({ limit: 100 });
        expect(before.items.some((candidate) => candidate.id === meal.id)).toBe(true);

        await kitchenAdmin.retireMeal(meal.id, { lockVersion: 1 });

        const after = await marketplace.listMeals({ limit: 100 });
        expect(after.items.some((candidate) => candidate.id === meal.id)).toBe(false);
        await expect(marketplace.getMeal(meal.id)).rejects.toBeInstanceOf(Error);
    });

    it('mints rows a person created above the fixture ordinals', async () => {
        const { kitchenAdmin } = createPrototypeRepositories();
        const created = await kitchenAdmin.createIngredient({
            name: untranslated('Sumac'),
            categoryCode: 'store-cupboard',
            measurementUnit: 'g',
        });

        const runtimeStart = prototypeId('ingredient', PROTOTYPE_RUNTIME_ORDINAL_START);
        expect(String(created.id) >= runtimeStart).toBe(true);
    });

    it('refuses to publish a plan whose prices are all placeholders', () => {
        const catalogue = store();
        const created = catalogue.createPlan({
            name: untranslated('Imported plan'),
            summary: untranslated('No price has been supplied for this plan.'),
            description: untranslated('Exactly the state an imported GreenLife plan arrives in.'),
        });

        const failure = failureOf(() =>
            catalogue.publishPlan(created.id, { lockVersion: created.meta.lockVersion }),
        );
        expect(failure?.code).toBe('validation.failed');
        expect(catalogue.getPlan(created.id).meta.status).toBe('draft');
    });
});

describe('the allergen quarantine', () => {
    /**
     * The worked example from the source data: a cereal row whose allergen list is emptied while a
     * published recipe still declares gluten because of it. That is a food-safety contradiction, so
     * both records are quarantined rather than warned about.
     */
    it('quarantines the ingredient and the recipes that contradicted it', () => {
        const catalogue = store();
        const bulgur = ingredientByKey('bulgur_wheat');
        const lamb = recipeByKey('slow_braised_lamb_bulgur');

        expect(catalogue.getRecipe(lamb.id).meta.status).toBe('published');

        catalogue.setIngredientAllergens(bulgur.id, { lockVersion: 1, mappings: [] });

        expect(catalogue.getIngredient(bulgur.id).meta.status).toBe('review_required');
        expect(catalogue.getRecipe(lamb.id).meta.status).toBe('review_required');
    });

    it('refuses publication from the quarantine', () => {
        const catalogue = store();
        const bulgur = ingredientByKey('bulgur_wheat');
        const lamb = recipeByKey('slow_braised_lamb_bulgur');
        catalogue.setIngredientAllergens(bulgur.id, { lockVersion: 1, mappings: [] });

        const quarantined = catalogue.getRecipe(lamb.id);
        const failure = failureOf(() =>
            catalogue.publishRecipe(lamb.id, { lockVersion: quarantined.meta.lockVersion }),
        );

        expect(failure?.code).toBe('validation.failed');
        expect(
            (failure as { fields?: Record<string, string[]> } | null)?.fields?.['status']?.[0],
        ).toContain('quarantined');
    });

    it('leaves unrelated recipes alone', () => {
        const catalogue = store();
        catalogue.setIngredientAllergens(ingredientByKey('bulgur_wheat').id, {
            lockVersion: 1,
            mappings: [],
        });

        expect(catalogue.getRecipe(recipeByKey('harbour_prawn_quinoa').id).meta.status).toBe(
            'published',
        );
    });
});

describe('the recipe roll-up preview', () => {
    it('reproduces a seeded recipe’s figures from its own lines', () => {
        const catalogue = store();
        const recipe = recipeByKey('herbed_chicken_freekeh');
        const version = catalogue.getRecipe(recipe.id).currentVersion;

        const preview = catalogue.previewRecipeRollup({
            recipeId: recipe.id,
            servings: recipe.servings,
            serving: recipe.serving,
            lines: version.lines.map((line) => ({
                ingredientId: line.ingredientId,
                quantity: line.quantity,
                unit: line.unit,
            })),
        });

        expect(amountValue(preview.perRecipe, 'energy')).toBe(
            amountValue(recipe.nutrition.perRecipe, 'energy'),
        );
        expect(amountValue(preview.perServing, 'protein')).toBe(
            amountValue(recipe.nutrition.perServing, 'protein'),
        );
    });

    it('names the ingredients behind every allergen it would declare', () => {
        const catalogue = store();
        const preview = catalogue.previewRecipeRollup({
            recipeId: null,
            servings: 2,
            lines: [
                { ingredientId: ingredientByKey('halloumi').id, quantity: 200, unit: 'g' },
                { ingredientId: ingredientByKey('almonds').id, quantity: 40, unit: 'g' },
            ],
        });

        const milk = preview.allergenSources.find(
            (source) => source.allergenCode === allergenCode('milk'),
        );
        expect(milk?.containment).toBe('contains');
        expect(milk?.ingredientIds).toEqual([ingredientByKey('halloumi').id]);

        const treeNut = preview.allergenSources.find(
            (source) => source.allergenCode === allergenCode('tree_nut'),
        );
        expect(treeNut?.ingredientIds).toEqual([ingredientByKey('almonds').id]);
    });

    it('applies the waste allowance to the cost and never to the nutrition', () => {
        const catalogue = store();
        const lines = [
            {
                ingredientId: ingredientByKey('chicken_breast').id,
                quantity: 100,
                unit: 'g' as const,
            },
        ];

        const plain = catalogue.previewRecipeRollup({ recipeId: null, servings: 1, lines });
        const wasted = catalogue.previewRecipeRollup({
            recipeId: null,
            servings: 1,
            wastePercent: 3,
            lines,
        });

        expect(plain.estimatedCost?.amount).toBe(3.4);
        expect(wasted.estimatedCost?.amount).toBe(3.502);
        expect(amountValue(wasted.perRecipe, 'energy')).toBe(
            amountValue(plain.perRecipe, 'energy'),
        );
    });

    it('reports a line it cannot convert rather than counting it as nothing', () => {
        const catalogue = store();
        const preview = catalogue.previewRecipeRollup({
            recipeId: null,
            servings: 1,
            lines: [
                { ingredientId: ingredientByKey('chicken_breast').id, quantity: 100, unit: 'g' },
                { ingredientId: ingredientByKey('olive_oil').id, quantity: 2, unit: 'tbsp' },
            ],
        });

        expect(preview.warnings.map((warning) => warning.code)).toEqual([
            'rollup.unconvertible_unit',
        ]);
        expect(preview.warnings[0]?.ingredientIds).toEqual([ingredientByKey('olive_oil').id]);
    });

    it('refuses a draft with nothing usable in it', () => {
        const failure = failureOf(() =>
            store().previewRecipeRollup({
                recipeId: null,
                servings: 1,
                lines: [
                    { ingredientId: ingredientByKey('olive_oil').id, quantity: 1, unit: 'tbsp' },
                ],
            }),
        );
        expect(failure?.code).toBe('validation.failed');
    });
});

describe('recipe versions', () => {
    it('opens a new draft version rather than editing a published one', () => {
        const catalogue = store();
        const recipe = recipeByKey('grilled_halloumi_rocket');
        const before = catalogue.getRecipe(recipe.id);
        expect(before.currentVersion.status).toBe('published');
        expect(before.versions).toHaveLength(1);

        const after = catalogue.setRecipeLines(recipe.id, {
            lockVersion: before.meta.lockVersion,
            lines: [{ ingredientId: ingredientByKey('halloumi').id, quantity: 250, unit: 'g' }],
        });

        expect(after.currentVersion.status).toBe('draft');
        expect(after.currentVersion.versionNumber).toBe(2);
        expect(after.versions).toHaveLength(2);
        // Consumers keep reading the published version until the draft is published in turn.
        expect(catalogue.consumerRecipeById(recipe.id)?.ingredients).toHaveLength(
            recipe.ingredients.length,
        );
    });

    it('refuses more than one primary output on a version', () => {
        const catalogue = store();
        const recipe = recipeByKey('grilled_halloumi_rocket');
        const failure = failureOf(() =>
            catalogue.setRecipeOutputs(recipe.id, {
                lockVersion: 1,
                outputs: [
                    {
                        ingredientId: ingredientByKey('halloumi').id,
                        quantity: 1,
                        unit: 'kg',
                        isPrimary: true,
                    },
                    {
                        ingredientId: ingredientByKey('rocket').id,
                        quantity: 1,
                        unit: 'kg',
                        isPrimary: true,
                    },
                ],
            }),
        );
        expect(failure?.code).toBe('validation.failed');
    });
});

describe('delivery zones and branch operating data', () => {
    it('changes what a branch publishes when a zone is archived', async () => {
        const { marketplace, kitchenAdmin } = createPrototypeRepositories();
        const zones = await kitchenAdmin.listZones({ limit: 100 });
        const downtown = zones.items.find((zone) => zone.name.en === 'Downtown ring');
        expect(downtown).toBeDefined();
        if (downtown === undefined) return;

        const branchId = downtown.branchIds[0];
        expect(branchId).toBeDefined();
        if (branchId === undefined) return;

        await kitchenAdmin.archiveZone(downtown.id, { lockVersion: downtown.meta.lockVersion });

        const kitchens = await marketplace.listKitchens({ limit: 100 });
        const branch = kitchens.items
            .flatMap((kitchen) => kitchen.branches)
            .find((candidate) => candidate.id === branchId);
        expect(branch?.deliveryZones.some((zone) => zone.id === downtown.id)).toBe(false);
    });

    it('changes what a branch publishes when its trading week changes', async () => {
        const { marketplace, kitchenAdmin } = createPrototypeRepositories();
        const kitchen = PROTOTYPE_KITCHENS[0];
        const branchId = kitchen?.branches[0]?.id;
        expect(kitchen).toBeDefined();
        expect(branchId).toBeDefined();
        if (kitchen === undefined || branchId === undefined) return;

        const operating = await kitchenAdmin.getBranchOperating(branchId);
        await kitchenAdmin.setBranchOperating(branchId, {
            lockVersion: operating.meta.lockVersion,
            days: operating.days.map((day) =>
                day.weekday === 7
                    ? { weekday: 7, opensAt: null, closesAt: null, orderCutOffAt: null }
                    : day,
            ),
        });

        const refreshed = await marketplace.getKitchen(kitchen.id);
        const sunday = refreshed.branches
            .find((candidate) => candidate.id === branchId)
            ?.openingHours.find((hours) => hours.weekday === 7);
        expect(sunday?.opensAt).toBeNull();
    });

    it('refuses a trading week that is not seven rows', async () => {
        const { kitchenAdmin } = createPrototypeRepositories();
        const branchId = PROTOTYPE_KITCHENS[0]?.branches[0]?.id;
        expect(branchId).toBeDefined();
        if (branchId === undefined) return;

        const operating = await kitchenAdmin.getBranchOperating(branchId);
        await expect(
            kitchenAdmin.setBranchOperating(branchId, {
                lockVersion: operating.meta.lockVersion,
                days: operating.days.slice(0, 5),
            }),
        ).rejects.toBeInstanceOf(Error);
    });
});
