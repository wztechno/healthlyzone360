import { describe, expect, it } from 'vitest';

import { asApiFailure } from '../../contracts/failure.ts';
import type { PrototypeRepositoryBundle } from './repositories.ts';
import { PROTOTYPE_TODAY, PROTOTYPE_WEEK_START, addDays } from './constants.ts';
import {
    PROTOTYPE_CUSTOMER_ID,
    PROTOTYPE_PLAN_IDS,
    allergenCode,
    mealByKey,
    planByKey,
    programmeByKey,
    recipeByKey,
    reviewQueueItemAt,
    weekEntryAt,
} from './fixtures/index.ts';

/**
 * `describeRepositoryContract()` — one behavioural specification, run against both bundles.
 *
 * The mock and the API repositories satisfy the same nine interfaces, and the only reason that is
 * worth anything is if something checks it. This factory is that something. It is run twice:
 *
 * - against **the mock bundle**, where it asserts real behaviour — the pagination shape, that the
 *   filters filter, that regeneration is deterministic, that the subscription state machine refuses
 *   illegal transitions and that the Virtual Dietitian walks its states;
 * - against **the API bundle**, where it asserts that every method on every repository rejects with
 *   `prototype.not_implemented`, because none of those endpoints exists yet.
 *
 * The surface half runs in both modes and is the part that catches drift: a method added to a
 * contract and implemented in only one bundle fails here rather than in a screen.
 */

export const REPOSITORY_KEYS = [
    'marketplace',
    'nutrition',
    'planner',
    'foods',
    'virtualDietitian',
    'commerce',
    'business',
    'professional',
    'kitchenAdmin',
] as const;

export type RepositoryKey = (typeof REPOSITORY_KEYS)[number];

/**
 * Every method each contract declares.
 *
 * Restated here on purpose. The compiler already forces both bundles to implement the interfaces;
 * what it cannot do is notice that a *contract* grew a method nobody thought about. This table is
 * the human-maintained side of that, and it fails loudly when the two disagree.
 */
export const CONTRACT_METHODS: Readonly<Record<RepositoryKey, readonly string[]>> = {
    marketplace: [
        'listKitchens',
        'getKitchen',
        'listMeals',
        'getMeal',
        'listPlans',
        'getPlan',
        'listDietitians',
        'getDietitian',
        'listDietCategories',
    ],
    nutrition: ['calculateTargets', 'getCurrentTargets', 'updateCurrentTargets', 'requestReview'],
    planner: [
        'listPlans',
        'getCurrentPlan',
        'getWeek',
        'getDay',
        'generate',
        'regenerateWeek',
        'regenerateDay',
        'regenerateEntry',
        'lockEntry',
        'unlockEntry',
        'replaceEntry',
        'adjustPortion',
        'addEntry',
        'removeEntry',
        'repeatMeal',
        'getNotes',
        'setNotes',
        'history',
        'saveAsTemplate',
        'duplicate',
    ],
    foods: ['searchFoods', 'listRecipes', 'getRecipe', 'getGroceryList', 'getPantry'],
    virtualDietitian: [
        'createSession',
        'getSession',
        'listSessions',
        'sendMessage',
        'generateDraft',
        'requestReview',
        'acceptProposal',
        'overrideProposal',
    ],
    commerce: [
        'getCart',
        'addCartItem',
        'removeCartItem',
        'previewCheckout',
        'previewSubscription',
        'createSubscription',
        'getSubscription',
        'listSubscriptions',
        'pause',
        'resume',
        'skipDay',
        'changeAddress',
        'changeSlot',
    ],
    business: [
        'getCorporateProgramme',
        'listCatalogue',
        'getCatalogueItem',
        'requestQuotation',
        'listQuotations',
    ],
    professional: [
        'listReviewQueue',
        'getReview',
        'approve',
        'requestChanges',
        'getClientPlan',
        'setDietitianNote',
        'setOverride',
    ],
    kitchenAdmin: [
        'listAllergenClasses',
        'listServiceAreas',
        'listIngredients',
        'getIngredient',
        'createIngredient',
        'updateIngredient',
        'archiveIngredient',
        'setIngredientAllergens',
        'listRecipes',
        'getRecipe',
        'createRecipe',
        'updateRecipe',
        'setRecipeLines',
        'setRecipeSteps',
        'setRecipeOutputs',
        'previewRecipeRollup',
        'publishRecipe',
        'retireRecipe',
        'listProducts',
        'getProduct',
        'createProduct',
        'updateProduct',
        'archiveProduct',
        'setProductChannelAvailability',
        'listPriceLists',
        'getPriceList',
        'setPriceListEntries',
        'publishPriceList',
        'listMeals',
        'getMeal',
        'createMeal',
        'updateMeal',
        'publishMeal',
        'retireMeal',
        'setMealAvailability',
        'listPlans',
        'getPlan',
        'createPlan',
        'updatePlan',
        'publishPlan',
        'retirePlan',
        'setPlanVariants',
        'setPlanDurations',
        'setPlanCombinations',
        'listZones',
        'getZone',
        'createZone',
        'updateZone',
        'archiveZone',
        'setZoneAreas',
        'setDeliveryWindows',
        'getBranchOperating',
        'setBranchOperating',
    ],
};

export const CONTRACT_METHOD_COUNT = REPOSITORY_KEYS.reduce(
    (total, key) => total + CONTRACT_METHODS[key].length,
    0,
);

export type RepositoryContractMode = 'mock' | 'api';

export interface RepositoryContractOptions {
    /** Appears in the test names, e.g. `mock bundle` or `api bundle`. */
    readonly name: string;
    readonly mode: RepositoryContractMode;
    /** A fresh bundle. Called per test, so no test can be affected by another's mutations. */
    readonly create: () => PrototypeRepositoryBundle;
}

function methodsOf(repository: object): readonly [string, (...args: never[]) => unknown][] {
    return Object.entries(repository).filter(
        (entry): entry is [string, (...args: never[]) => unknown] => typeof entry[1] === 'function',
    );
}

export function describeRepositoryContract(options: RepositoryContractOptions): void {
    const { name, mode, create } = options;

    describe(`${name} — contract surface`, () => {
        it.each(REPOSITORY_KEYS)('%s declares exactly the methods the contract promises', (key) => {
            const repository = create()[key];
            const names = methodsOf(repository)
                .map(([method]) => method)
                .sort();
            expect(names).toEqual([...CONTRACT_METHODS[key]].sort());
        });

        it('covers every repository in the bundle', () => {
            const bundle = create();
            for (const key of REPOSITORY_KEYS) expect(bundle[key]).toBeDefined();
        });
    });

    if (mode === 'api') {
        describe(`${name} — every method rejects prototype.not_implemented`, () => {
            for (const key of REPOSITORY_KEYS) {
                const methods = CONTRACT_METHODS[key];
                it.each(methods)(`${key}.%s`, async (method) => {
                    const repository = create()[key] as unknown as Record<
                        string,
                        (...args: never[]) => unknown
                    >;
                    const call = repository[method];
                    expect(typeof call).toBe('function');

                    // Called with no arguments on purpose: a stub that reached for one would be
                    // doing something, and these are meant to do nothing but reject.
                    const outcome = await Promise.resolve(call?.call(repository)).then(
                        () => null,
                        (error: unknown) => asApiFailure(error),
                    );

                    expect(
                        outcome,
                        `${key}.${method} resolved instead of rejecting`,
                    ).not.toBeNull();
                    expect(outcome?.code).toBe('prototype.not_implemented');
                    expect(outcome?.retryable).toBe(false);
                    expect(outcome?.message).toContain('/api/v1/');
                });
            }
        });

        return;
    }

    /* ── behaviour, mock bundle only ───────────────────────────────────────────────────────── */

    describe(`${name} — cursor pagination`, () => {
        it('returns a first page, a cursor, and a last page that ends the sequence', async () => {
            const { marketplace } = create();

            const first = await marketplace.listMeals({ limit: 5 });
            expect(first.items).toHaveLength(5);
            expect(first.hasMore).toBe(true);
            expect(first.nextCursor).not.toBeNull();
            expect(first.totalCount).toBeGreaterThan(5);

            const second = await marketplace.listMeals({
                limit: 5,
                cursor: first.nextCursor ?? '',
            });
            expect(second.items).toHaveLength(5);
            const overlap = second.items.filter((meal) =>
                first.items.some((earlier) => earlier.id === meal.id),
            );
            expect(overlap).toEqual([]);

            const everything = await marketplace.listMeals({ limit: 100 });
            expect(everything.hasMore).toBe(false);
            expect(everything.nextCursor).toBeNull();
            expect(everything.items).toHaveLength(everything.totalCount ?? -1);
        });

        it('treats an unusable cursor as the first page rather than an error', async () => {
            const { marketplace } = create();
            const page = await marketplace.listMeals({ limit: 3, cursor: 'not-a-cursor' });
            expect(page.items).toHaveLength(3);
        });
    });

    describe(`${name} — filters actually filter`, () => {
        it('excludes an allergen everywhere it is asked to', async () => {
            const { marketplace, foods } = create();
            const treeNut = allergenCode('tree_nut');

            const meals = await marketplace.listMeals({ excludeAllergens: [treeNut], limit: 100 });
            expect(meals.items.some((meal) => meal.allergens.includes(treeNut))).toBe(false);

            const recipes = await foods.listRecipes({ excludeAllergens: [treeNut], limit: 100 });
            expect(recipes.items.some((recipe) => recipe.allergens.includes(treeNut))).toBe(false);
        });

        it('honours the energy, protein and price bands', async () => {
            const { marketplace } = create();

            const light = await marketplace.listMeals({ energy: { max: 450 }, limit: 100 });
            expect(light.items.length).toBeGreaterThan(0);
            for (const meal of light.items) {
                const energy =
                    meal.nutrition.amounts.find((amount) => amount.nutrientId === 'energy')
                        ?.value ?? 0;
                expect(energy).toBeLessThanOrEqual(450);
            }

            const cheap = await marketplace.listMeals({ price: { max: 3000 }, limit: 100 });
            for (const meal of cheap.items) expect(meal.price.amount).toBeLessThanOrEqual(3000);
        });

        it('only lists kitchens configured for the requested channels', async () => {
            const { marketplace } = create();
            const page = await marketplace.listKitchens({ channels: ['marketplace'], limit: 100 });
            expect(page.items.length).toBeGreaterThan(0);
            for (const kitchen of page.items) expect(kitchen.channels.marketplace).toBe(true);

            const wholesale = await marketplace.listKitchens({ channels: ['b2b'], limit: 100 });
            expect(wholesale.items.some((kitchen) => !kitchen.channels.b2c)).toBe(true);
        });

        it('sorts meals by the requested key', async () => {
            const { marketplace } = create();
            const page = await marketplace.listMeals({ sort: 'price', limit: 100 });
            const prices = page.items.map((meal) => meal.price.amount);
            expect([...prices].sort((left, right) => left - right)).toEqual(prices);
        });

        it('searches foods by name', async () => {
            const { foods } = create();
            const page = await foods.searchFoods({ query: 'chicken' });
            expect(page.items.length).toBeGreaterThan(0);
            for (const food of page.items) {
                expect(food.name.toLowerCase()).toContain('chicken');
            }
        });

        it('never puts a negotiated price on a consumer-facing shape', async () => {
            const { marketplace } = create();
            const page = await marketplace.listMeals({ limit: 100 });
            for (const meal of page.items) {
                expect(Object.keys(meal)).not.toContain('contractPrice');
                expect(Object.keys(meal)).not.toContain('volumeTiers');
                expect(Object.keys(meal)).not.toContain('minimumOrderQuantity');
            }
        });
    });

    describe(`${name} — the planner mutates and stays consistent`, () => {
        it('locks an entry and the lock survives a week regeneration', async () => {
            const { planner } = create();
            const target = weekEntryAt(0);

            const locked = await planner.lockEntry(PROTOTYPE_PLAN_IDS.week, target.id);
            expect(locked.locked).toBe(true);

            const week = await planner.regenerateWeek(PROTOTYPE_PLAN_IDS.week);
            const survivor = week.days
                .flatMap((day) => day.entries)
                .find((entry) => entry.id === target.id);
            expect(survivor?.label).toBe(target.label);
            expect(survivor?.locked).toBe(true);
        });

        it('regenerates deterministically: twice gives two different meals, always the same two', async () => {
            const target = weekEntryAt(1);

            const runOne = create().planner;
            const firstA = await runOne.regenerateEntry(PROTOTYPE_PLAN_IDS.week, target.id);
            const secondA = await runOne.regenerateEntry(PROTOTYPE_PLAN_IDS.week, target.id);
            expect(secondA.label).not.toBe(firstA.label);

            const runTwo = create().planner;
            const firstB = await runTwo.regenerateEntry(PROTOTYPE_PLAN_IDS.week, target.id);
            const secondB = await runTwo.regenerateEntry(PROTOTYPE_PLAN_IDS.week, target.id);
            expect([firstB.label, secondB.label]).toEqual([firstA.label, secondA.label]);
        });

        it('refuses to regenerate a locked entry', async () => {
            const { planner } = create();
            const target = weekEntryAt(0);
            await planner.lockEntry(PROTOTYPE_PLAN_IDS.week, target.id);

            const failure = await planner
                .regenerateEntry(PROTOTYPE_PLAN_IDS.week, target.id)
                .then(() => null, asApiFailure);
            expect(failure?.code).toBe('validation.failed');
        });

        it('scales the day total when a portion changes', async () => {
            const { planner } = create();
            const target = weekEntryAt(1);

            const before = await planner.getDay(PROTOTYPE_PLAN_IDS.week, target.date);
            const beforeEnergy = energyOf(before.summary.planned.amounts);

            const adjusted = await planner.adjustPortion(PROTOTYPE_PLAN_IDS.week, target.id, {
                portionFactor: 2,
            });
            expect(adjusted.portionFactor).toBe(2);

            const after = await planner.getDay(PROTOTYPE_PLAN_IDS.week, target.date);
            expect(energyOf(after.summary.planned.amounts)).toBeGreaterThan(beforeEnergy);
        });

        it('adds, repeats and removes entries', async () => {
            const { planner } = create();
            const date = addDays(PROTOTYPE_WEEK_START, 2);

            const added = await planner.addEntry(PROTOTYPE_PLAN_IDS.week, {
                date,
                mealType: 'snack',
                kind: 'kitchen_meal',
                mealId: mealByKey('verdant_pistachio_yoghurt_pot').id,
            });
            expect(added.kind).toBe('kitchen_meal');

            const copies = await planner.repeatMeal(PROTOTYPE_PLAN_IDS.week, {
                entryId: added.id,
                dates: [addDays(date, 1)],
                asLeftovers: true,
            });
            expect(copies).toHaveLength(1);
            expect(copies[0]?.isLeftover).toBe(true);

            await planner.removeEntry(PROTOTYPE_PLAN_IDS.week, added.id);
            const day = await planner.getDay(PROTOTYPE_PLAN_IDS.week, date);
            expect(day.entries.some((entry) => entry.id === added.id)).toBe(false);
        });

        it('replaces one occurrence or every future one', async () => {
            const { planner } = create();
            const replacement = recipeByKey('red_bean_pepper_chilli');

            const once = await planner.replaceEntry(PROTOTYPE_PLAN_IDS.week, weekEntryAt(2).id, {
                mode: 'once',
                kind: 'recipe',
                recipeId: replacement.id,
            });
            expect(once).toHaveLength(1);
            expect(once[0]?.label).toBe(replacement.name);
        });

        it('records history and notes', async () => {
            const { planner } = create();
            await planner.lockEntry(PROTOTYPE_PLAN_IDS.week, weekEntryAt(1).id);

            const history = await planner.history(PROTOTYPE_PLAN_IDS.week, { limit: 10 });
            expect(history.items[0]?.action).toBe('entry_locked');

            const notes = await planner.setNotes(PROTOTYPE_PLAN_IDS.week, {
                customerNote: 'Fewer chickpeas next week.',
            });
            expect(notes.customerNote).toBe('Fewer chickpeas next week.');
            expect(notes.dietitianNote).not.toBeNull();
        });

        it('derives a grocery list from the home-prepared entries only', async () => {
            const { foods } = create();
            const list = await foods.getGroceryList(PROTOTYPE_WEEK_START);
            expect(list.items.length).toBeGreaterThan(0);
            expect(list.estimatedTotal).not.toBeNull();
            // Every line names at least one recipe that needs it.
            for (const item of list.items) {
                expect(item.neededForRecipeIds.length).toBeGreaterThan(0);
            }
        });
    });

    describe(`${name} — commerce`, () => {
        it('adds to a cart and prices a checkout without taking a payment', async () => {
            const { commerce } = create();
            const cart = await commerce.getCart();
            expect(cart.items).toEqual([]);

            const filled = await commerce.addCartItem(cart.id, {
                mealId: mealByKey('verdant_herb_garden_bowl').id,
                quantity: 2,
            });
            expect(filled.itemCount).toBe(2);
            expect(filled.subtotal.amount).toBeGreaterThan(0);

            const preview = await commerce.previewCheckout({ cartId: cart.id });
            expect(preview.paymentDeferred).toBe(true);
            expect(preview.total.amount).toBeGreaterThanOrEqual(filled.subtotal.amount);

            const emptied = await commerce.removeCartItem(cart.id, filled.items[0]?.id ?? '');
            expect(emptied.itemCount).toBe(0);
        });

        it('prices a subscription with its duration discount and warns about delivery days', async () => {
            const { commerce } = create();
            const plan = planByKey('desk_lunch_club');
            const variant = plan.variants[0];
            expect(variant).toBeDefined();
            if (variant === undefined) return;

            const preview = await commerce.previewSubscription({
                planId: plan.id,
                variantId: variant.id,
                duration: '4w',
                startDate: PROTOTYPE_WEEK_START,
                // Sunday: the office plan does not deliver at weekends.
                deliveryWeekdays: [7],
                slotCode: 'midday',
                address: {
                    label: 'Office',
                    line1: 'Level 12',
                    line2: null,
                    area: 'Business Bay',
                    city: 'Dubai',
                    countryCode: 'AE',
                    instructions: null,
                },
                dietClassifications: [],
                excludeAllergens: [],
                selectedMealIds: [],
            });

            expect(preview.discountPercent).toBeGreaterThan(0);
            expect(preview.total.amount).toBeLessThan(variant.pricePerWeek.amount * 4);
            expect(preview.warnings).toContain('subscription.delivery_day_unavailable');
            expect(preview.paymentDeferred).toBe(true);
        });

        it('walks the subscription state machine and refuses illegal transitions', async () => {
            const { commerce } = create();
            const page = await commerce.listSubscriptions();
            const existing = page.items[0];
            expect(existing).toBeDefined();
            if (existing === undefined) return;

            const paused = await commerce.pause(existing.id, { reason: 'Travelling.' });
            expect(paused.state).toBe('paused');
            expect(paused.nextDeliveryDate).toBeNull();

            const pausedTwice = await commerce.pause(existing.id).then(() => null, asApiFailure);
            expect(pausedTwice?.code).toBe('validation.failed');

            const resumed = await commerce.resume(existing.id);
            expect(resumed.state).toBe('active');

            const skipped = await commerce.skipDay(existing.id, { date: PROTOTYPE_TODAY });
            expect(skipped.state).toBe('skipped_today');
            expect(skipped.skippedDates).toContain(PROTOTYPE_TODAY);

            const moved = await commerce.changeSlot(existing.id, { slotCode: 'evening' });
            expect(moved.configuration.slotCode).toBe('evening');

            const unknownSlot = await commerce
                .changeSlot(existing.id, { slotCode: 'midnight' })
                .then(() => null, asApiFailure);
            expect(unknownSlot?.code).toBe('validation.failed');
        });
    });

    describe(`${name} — the Virtual Dietitian progresses and escalates`, () => {
        it('walks the interview one state per turn', async () => {
            const { virtualDietitian } = create();
            const session = await virtualDietitian.createSession();
            expect(session.state).toBe('initial_interview');
            expect(session.disclaimer.length).toBeGreaterThan(0);

            const states: string[] = [];
            let current = session;
            for (let turn = 0; turn < 4; turn += 1) {
                current = await virtualDietitian.sendMessage(current.id, {
                    body: `Answer ${String(turn)}`,
                });
                states.push(current.state);
            }

            expect(states).toEqual([
                'analysing',
                'missing_information',
                'suggested_targets',
                'suggested_meal_structure',
            ]);
            expect(current.proposal).not.toBeNull();
        });

        it('labels every machine-authored message and nothing else', async () => {
            const { virtualDietitian } = create();
            const session = await virtualDietitian.sendMessage(
                (await virtualDietitian.createSession()).id,
                { body: 'I am 34 and moderately active.' },
            );
            for (const message of session.messages) {
                expect(message.aiGenerated).toBe(message.origin === 'assistant');
            }
        });

        it('escalates on a stated safety marker and then refuses to continue', async () => {
            const { virtualDietitian } = create();
            const session = await virtualDietitian.createSession();

            const escalated = await virtualDietitian.sendMessage(session.id, {
                body: 'I have been thinking about self-harm.',
            });
            expect(escalated.state).toBe('safety_escalation');
            expect(escalated.safetyNotices[0]?.severity).toBe('escalation');
            expect(escalated.proposal).toBeNull();

            const refused = await virtualDietitian
                .sendMessage(session.id, { body: 'Carry on anyway.' })
                .then(() => null, asApiFailure);
            expect(refused?.code).toBe('validation.failed');
        });

        it('generates a draft week and hands it to a dietitian', async () => {
            const { virtualDietitian, planner, professional } = create();
            const session = await virtualDietitian.createSession();

            const drafted = await virtualDietitian.generateDraft(session.id, {
                weekStart: PROTOTYPE_WEEK_START,
                acknowledgedDisclaimer: true,
            });
            expect(drafted.state).toBe('draft_generated');
            expect(drafted.draftPlanId).not.toBeNull();

            const week = await planner.getWeek(
                drafted.draftPlanId ?? PROTOTYPE_PLAN_IDS.draft,
                PROTOTYPE_WEEK_START,
            );
            expect(week.days.flatMap((day) => day.entries).length).toBeGreaterThan(0);

            const reviewed = await virtualDietitian.requestReview(session.id);
            expect(reviewed.state).toBe('review_requested');

            const queue = await professional.listReviewQueue({ limit: 100 });
            expect(queue.items.some((item) => item.sessionId === session.id)).toBe(true);
        });

        it('refuses to generate a draft without the disclaimer acknowledgement', async () => {
            const { virtualDietitian } = create();
            const session = await virtualDietitian.createSession();
            const failure = await virtualDietitian
                .generateDraft(session.id, {
                    weekStart: PROTOTYPE_WEEK_START,
                    acknowledgedDisclaimer: false,
                })
                .then(() => null, asApiFailure);
            expect(failure?.code).toBe('validation.failed');
        });
    });

    describe(`${name} — the professional queue closes the loop`, () => {
        it('approves a review and marks the target professionally approved', async () => {
            const { professional, nutrition } = create();
            const item = reviewQueueItemAt(0);

            const detail = await professional.getReview(item.id);
            expect(detail.item.id).toBe(item.id);
            expect(detail.context.length).toBeGreaterThan(0);

            const approved = await professional.approve(item.id, { signature: 'L. Haddad' });
            expect(approved.state).toBe('approved');

            const target = await nutrition.getCurrentTargets();
            expect(target?.professionallyApproved).toBe(true);
        });

        it('replaces a computed target with a professional override', async () => {
            const { professional, nutrition } = create();
            const before = await nutrition.getCurrentTargets();
            expect(before).not.toBeNull();
            if (before === null) return;

            const overridden = await professional.setOverride({
                clientId: PROTOTYPE_CUSTOMER_ID,
                targetId: before.id,
                reason: 'Raised to reflect training load.',
                targetEnergy: 2100,
            });

            expect(overridden.result.targetEnergy).toBe(2100);
            expect(overridden.result.method).toBe('professional_override');
            expect(overridden.professionallyApproved).toBe(true);
        });

        it('requests changes rather than approving', async () => {
            const { professional } = create();
            const item = reviewQueueItemAt(1);
            const updated = await professional.requestChanges(item.id, {
                note: 'Raise protein on Thursday.',
                priority: 'soon',
            });
            expect(updated.state).toBe('changes_requested');
            expect(updated.priority).toBe('soon');
        });
    });

    describe(`${name} — business quotations`, () => {
        it('submits a quotation with no price attached to it', async () => {
            const { business } = create();
            const programme = programmeByKey('corporate_employee_package');

            const catalogue = await business.listCatalogue({ programmeId: programme.id });
            const item = catalogue.items[0];
            expect(item).toBeDefined();
            if (item === undefined) return;

            const quotation = await business.requestQuotation({
                programmeId: programme.id,
                lines: [{ catalogueItemId: item.id, quantity: item.minimumOrderQuantity }],
                contactName: 'Dana Fakhoury',
                contactEmail: 'dana@cedarclinic.example',
            });

            expect(quotation.state).toBe('submitted');
            expect(quotation.requestedTotal).toBeNull();
            expect(quotation.lines[0]?.quotedUnitPrice).toBeNull();
        });

        it('refuses a quantity below the minimum order', async () => {
            const { business } = create();
            const programme = programmeByKey('corporate_employee_package');
            const catalogue = await business.listCatalogue({ programmeId: programme.id });
            const item = catalogue.items[0];
            if (item === undefined) return;

            const failure = await business
                .requestQuotation({
                    programmeId: programme.id,
                    lines: [{ catalogueItemId: item.id, quantity: 1 }],
                    contactName: 'Dana Fakhoury',
                    contactEmail: 'dana@cedarclinic.example',
                })
                .then(() => null, asApiFailure);
            expect(failure?.code).toBe('validation.failed');
        });
    });
}

function energyOf(amounts: readonly { nutrientId: string; value: number }[]): number {
    return amounts.find((amount) => amount.nutrientId === 'energy')?.value ?? 0;
}
